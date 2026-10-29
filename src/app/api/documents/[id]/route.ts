import type { NextRequest } from "next/server";
import { z } from "zod";
import { unlink } from "node:fs/promises";
import path from "node:path";
import {
  findDocumentRow,
  getPool,
  toDocumentDTO,
  type DocumentRow,
} from "@/lib/db";
import { getUploadDir } from "@/lib/files";
import { schemaForType, tipoDocumentoSchema } from "@/lib/schemas";
import { embedText, vectorToLiteral } from "@/lib/embed";
import { buildDocumentDataRow, textForEmbedding } from "@/lib/structured";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonError(
  status: number,
  error: string,
  issues?: Array<{ path: string; message: string }>
) {
  return Response.json(issues ? { error, issues } : { error }, { status });
}

const updateBodySchema = z.object({
  documentType: tipoDocumentoSchema,
  extractedJson: z.unknown(),
});

/**
 * Guarda los datos corregidos por el usuario (formulario editable).
 * Valida el JSON con el esquema Zod del tipo de documento.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return jsonError(404, "Documento no encontrado");
  }

  const body = (await request.json().catch(() => null)) as {
    documentType?: unknown;
    extractedJson?: unknown;
  } | null;

  if (!body || !("extractedJson" in body)) {
    return jsonError(400, "Cuerpo de la petición no válido");
  }

  const parsedBody = updateBodySchema.safeParse(body);
  if (!parsedBody.success) {
    return jsonError(
      400,
      "Tipo de documento no válido",
      parsedBody.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }))
    );
  }

  const { documentType, extractedJson } = parsedBody.data;

  // "otro" es libre, pero debe ser un objeto (o null para vaciar)
  const isObject =
    extractedJson === null ||
    (typeof extractedJson === "object" && !Array.isArray(extractedJson));

  if (documentType !== "otro" && isObject) {
    const result = schemaForType(documentType).safeParse(extractedJson);
    if (!result.success) {
      return jsonError(
        422,
        "Los datos no son válidos según el esquema del documento",
        result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        }))
      );
    }
  } else if (!isObject) {
    return jsonError(422, "extractedJson debe ser un objeto JSON");
  }

  try {
    const current = await findDocumentRow(id);
    if (!current) {
      return jsonError(404, "Documento no encontrado");
    }

    const json = extractedJson as Record<string, unknown> | null;

    // 1. Datos crudos del documento en documents
    await getPool().query(
      `UPDATE documents
         SET document_type = $2,
             extracted_json = $3
       WHERE id = $1`,
      [id, documentType, json === null ? null : JSON.stringify(json)]
    );

    // 2. Datos estructurados en la tabla document_data (confirmación)
    const row = buildDocumentDataRow(id, documentType, json);
    await getPool().query(
      `INSERT INTO document_data (
         document_id, document_type, titulo, resumen,
         emisor_nombre, emisor_identificador, emisor_direccion,
         receptor_nombre, receptor_identificador,
         fecha_emision, fecha_vencimiento,
         moneda, base_imponible, impuestos, total, datos_clave
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
       )
       ON CONFLICT (document_id) DO UPDATE SET
         document_type = EXCLUDED.document_type,
         titulo = EXCLUDED.titulo,
         resumen = EXCLUDED.resumen,
         emisor_nombre = EXCLUDED.emisor_nombre,
         emisor_identificador = EXCLUDED.emisor_identificador,
         emisor_direccion = EXCLUDED.emisor_direccion,
         receptor_nombre = EXCLUDED.receptor_nombre,
         receptor_identificador = EXCLUDED.receptor_identificador,
         fecha_emision = EXCLUDED.fecha_emision,
         fecha_vencimiento = EXCLUDED.fecha_vencimiento,
         moneda = EXCLUDED.moneda,
         base_imponible = EXCLUDED.base_imponible,
         impuestos = EXCLUDED.impuestos,
         total = EXCLUDED.total,
         datos_clave = EXCLUDED.datos_clave,
         saved_at = now()`,
      [
        row.document_id,
        row.document_type,
        row.titulo,
        row.resumen,
        row.emisor_nombre,
        row.emisor_identificador,
        row.emisor_direccion,
        row.receptor_nombre,
        row.receptor_identificador,
        row.fecha_emision,
        row.fecha_vencimiento,
        row.moneda,
        row.base_imponible,
        row.impuestos,
        row.total,
        row.datos_clave,
      ]
    );

    // 3. Embedding del texto del documento en pgvector
    const texto = textForEmbedding(current.content_text, json);
    let warning: string | undefined;

    try {
      const { vector } = await embedText(texto);
      await getPool().query(
        `UPDATE documents
           SET embedding = $2::vector,
               content_text = COALESCE(content_text, $3)
         WHERE id = $1`,
        [id, vectorToLiteral(vector), current.content_text ? null : texto]
      );
    } catch (embedError) {
      warning =
        embedError instanceof Error
          ? embedError.message
          : "No se pudo generar el embedding";
      // Conserva el texto para poder reintentar en la próxima confirmación
      if (!current.content_text) {
        await getPool()
          .query(`UPDATE documents SET content_text = $2 WHERE id = $1`, [
            id,
            texto,
          ])
          .catch(() => {});
      }
    }

    const finalDoc = await findDocumentRow(id);
    if (!finalDoc) {
      return jsonError(404, "Documento no encontrado");
    }

    return Response.json({
      document: toDocumentDTO(finalDoc),
      ...(warning ? { warning } : {}),
    });
  } catch (error) {
    console.error("[document] PATCH fallido:", error);
    return jsonError(500, "No se pudieron guardar los cambios");
  }
}

/** Elimina el registro y el archivo en disco. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return jsonError(404, "Documento no encontrado");
  }

  try {
    const { rows } = await getPool().query<DocumentRow>(
      `SELECT * FROM documents WHERE id = $1`,
      [id]
    );
    const doc = rows[0];

    if (!doc) {
      return jsonError(404, "Documento no encontrado");
    }

    await getPool().query(`DELETE FROM documents WHERE id = $1`, [id]);
    await unlink(path.join(getUploadDir(), doc.stored_name)).catch(() => {});

    return Response.json({ ok: true });
  } catch (error) {
    console.error("[document] DELETE fallido:", error);
    return jsonError(500, "No se pudo eliminar el documento");
  }
}
