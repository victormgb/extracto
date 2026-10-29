import type { NextRequest } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getPool, type DocumentRow } from "@/lib/db";
import { getUploadDir } from "@/lib/files";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

/** Sirve el binario del archivo para la vista previa (inline). */
export async function GET(
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
    console.error("[document/file] SELECT fallido:", error);
    return jsonError(500, "No se pudo consultar la base de datos");
  }

  if (!doc) {
    return jsonError(404, "Documento no encontrado");
  }

  let buffer: Buffer;
  try {
    buffer = await readFile(path.join(getUploadDir(), doc.stored_name));
  } catch (error) {
    console.error("[document/file] archivo no encontrado en disco:", error);
    return jsonError(404, "El archivo no existe en disco");
  }

  const headers: Record<string, string> = {
    "Content-Type": doc.mime_type,
    "Content-Length": String(buffer.byteLength),
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(doc.original_name)}`,
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  };

  // Los SVG pueden llevar scripts: al servirlos en el mismo origen,
  // los aislamos con un CSP sandbox para evitar XSS.
  if (doc.mime_type === "image/svg+xml") {
    headers["Content-Security-Policy"] =
      "default-src 'none'; style-src 'unsafe-inline'; sandbox";
  }

  return new Response(new Uint8Array(buffer), { headers });
}
