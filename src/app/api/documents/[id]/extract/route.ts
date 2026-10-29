import type { NextRequest } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { findDocumentRow, getPool, toDocumentDTO, type DocumentRow } from "@/lib/db";
import { getUploadDir } from "@/lib/files";
import { classifyAndExtract, ExtractError } from "@/lib/extract";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

/**
 * Envía el archivo a un LLM con visión (Gemini), detecta si es factura,
 * recibo o contrato, extrae los datos en JSON y los guarda en Postgres.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return jsonError(404, "Documento no encontrado");
  }

  let doc: DocumentRow | null;
  try {
    const { rows } = await getPool().query<DocumentRow>(
      `SELECT * FROM documents WHERE id = $1`,
      [id]
    );
    doc = rows[0] ?? null;
  } catch (error) {
    console.error("[extract] SELECT fallido:", error);
    return jsonError(500, "No se pudo consultar la base de datos");
  }

  if (!doc) {
    return jsonError(404, "Documento no encontrado");
  }

  let buffer: Buffer;
  try {
    buffer = await readFile(path.join(getUploadDir(), doc.stored_name));
  } catch (error) {
    console.error("[extract] archivo no encontrado en disco:", error);
    return jsonError(410, "El archivo no existe en disco; vuelve a subirlo");
  }

  try {
    const { documentType, data } = await classifyAndExtract({
      buffer,
      mimeType: doc.mime_type,
    });

    // El OCR del LLM es la fuente de los embeddings (se conserva si ya había)
    const texto =
      typeof data.texto === "string" && data.texto.trim()
        ? data.texto.trim()
        : null;

    await getPool().query(
      `UPDATE documents
         SET document_type = $2,
             extracted_json = $3,
             extracted_at = now(),
             content_text = COALESCE($4, content_text)
       WHERE id = $1`,
      [id, documentType, JSON.stringify(data), texto]
    );

    const updated = await findDocumentRow(id);
    if (!updated) {
      return jsonError(404, "Documento no encontrado");
    }

    return Response.json({ document: toDocumentDTO(updated) });
  } catch (error) {
    if (error instanceof ExtractError) {
      console.error(`[extract] ExtractError (${error.status}):`, error.message);
      return jsonError(error.status, error.message);
    }
    console.error("[extract] error inesperado:", error);
    return jsonError(500, "No se pudo extraer el documento");
  }
}
