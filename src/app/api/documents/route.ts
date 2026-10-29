import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { getPool, listDocumentRows, toDocumentDTO, type DocumentRow } from "@/lib/db";
import {
  classifyFile,
  getUploadDir,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_MB,
} from "@/lib/files";

// Nota: el runtime por defecto (node.js) es el correcto; con `cacheComponents`
// habilitado no se puede declarar `export const runtime` en la ruta.

// Margen para el overhead del multipart (boundary + campos adicionales)
const MULTIPART_OVERHEAD = 1024 * 1024;

function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return jsonError(415, "Se esperaba un formulario multipart/form-data");
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD) {
    return jsonError(413, `El archivo supera el límite de ${MAX_UPLOAD_MB} MB`);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError(400, "No se pudo leer el formulario");
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return jsonError(400, "Falta el archivo a subir");
  }

  const classification = classifyFile(file.type);
  if (!classification) {
    return jsonError(415, "Solo se aceptan imágenes (PNG, JPG, WEBP…) o PDF");
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return jsonError(413, `El archivo supera el límite de ${MAX_UPLOAD_MB} MB`);
  }

  const id = randomUUID();
  const storedName = `${id}${classification.ext}`;
  const uploadDir = getUploadDir();
  const filePath = path.join(uploadDir, storedName);

  await mkdir(uploadDir, { recursive: true });

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);
  } catch {
    return jsonError(500, "No se pudo guardar el archivo en disco");
  }

  // Defensa contra nombres con rutas o caracteres raros del sistema de archivos
  const originalName =
    (file.name || storedName)
      .replace(/[/\\:*?"<>|\u0000-\u001f]/g, "_")
      .trim()
      .slice(0, 200) || storedName;

  try {
    const { rows } = await getPool().query<DocumentRow>(
      `INSERT INTO documents (id, stored_name, original_name, mime_type, kind, size_bytes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        id,
        storedName,
        originalName,
        file.type.split(";")[0].trim(),
        classification.kind,
        file.size,
      ]
    );

    return Response.json(
      { document: toDocumentDTO(rows[0]) },
      { status: 201 }
    );
  } catch (error) {
    // Si falla el INSERT, no dejamos archivos huérfanos en disco
    await unlink(filePath).catch(() => {});
    console.error("[documents] INSERT fallido:", error);
    return jsonError(
      500,
      "No se pudo registrar el archivo en la base de datos. ¿Está PostgreSQL levantado? (docker compose up -d)"
    );
  }
}

export async function GET() {
  try {
    const rows = await listDocumentRows();
    return Response.json({ documents: rows.map(toDocumentDTO) });
  } catch (error) {
    console.error("[documents] SELECT fallido:", error);
    return jsonError(
      500,
      "No se pudo consultar la base de datos. ¿Está PostgreSQL levantado? (docker compose up -d)"
    );
  }
}
