import { Pool } from "pg";
import type { DocumentDTO, DocumentType } from "@/lib/types";

// Pool perezoso: no abre conexiones hasta la primera query,
// por lo que `next build` no necesita la base de datos levantada.
const globalForPool = globalThis as unknown as { extractoPool?: Pool };

export function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL no está definido. Copia .env.example a .env y arranca la base de datos con `docker compose up -d`."
    );
  }

  if (!globalForPool.extractoPool) {
    // Las bases de datos gestionadas (p. ej. Seenode) exigen conexión cifrada:
    // DATABASE_SSL=true añade TLS sin verificar la CA del certificado.
    const useSsl =
      (process.env.DATABASE_SSL ?? "").toLowerCase() === "true";

    globalForPool.extractoPool = new Pool({
      connectionString,
      max: 10,
      ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
    });
  }

  return globalForPool.extractoPool;
}

export type DocumentRow = {
  id: string;
  stored_name: string;
  original_name: string;
  mime_type: string;
  kind: "image" | "pdf";
  size_bytes: number;
  created_at: Date;
  embedding: string | null;
  content_text: string | null;
  document_type: DocumentType | null;
  extracted_json: Record<string, unknown> | null;
  extracted_at: Date | null;
  /** Solo en consultas con LEFT JOIN a document_data */
  saved_at_join?: Date | null;
};

export type { DocumentDTO };

/**
 * SELECT con la marca de confirmación (document_data.saved_at).
 * El alias `saved_at_join` evita chocar con documents.extracted_at etc.
 */
const DOCUMENT_SELECT = `
  SELECT d.*, dd.saved_at AS saved_at_join
  FROM documents d
  LEFT JOIN document_data dd ON dd.document_id = d.id`;

export async function listDocumentRows(): Promise<DocumentRow[]> {
  const { rows } = await getPool().query<DocumentRow>(
    `${DOCUMENT_SELECT} ORDER BY d.created_at DESC, d.id ASC`
  );
  return rows;
}

export async function findDocumentRow(id: string): Promise<DocumentRow | null> {
  const { rows } = await getPool().query<DocumentRow>(
    `${DOCUMENT_SELECT} WHERE d.id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export function toDocumentDTO(row: DocumentRow): DocumentDTO {
  return {
    id: row.id,
    originalName: row.original_name,
    mimeType: row.mime_type,
    kind: row.kind,
    sizeBytes: Number(row.size_bytes),
    createdAt: row.created_at.toISOString(),
    url: `/api/documents/${row.id}/file`,
    documentType: row.document_type,
    extractedJson: row.extracted_json,
    extractedAt: row.extracted_at ? row.extracted_at.toISOString() : null,
    saved: row.saved_at_join != null,
    savedAt: row.saved_at_join
      ? new Date(row.saved_at_join).toISOString()
      : null,
    hasEmbedding: row.embedding != null,
  };
}
