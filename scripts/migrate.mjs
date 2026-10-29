// Migración idempotente que se ejecuta al arrancar la app (run_command).
// Aplica db/init.sql en la BD enlazada. Si la extensión pgvector no está
// disponible en la imagen gestionada, degrada el esquema (embedding como text)
// en lugar de tumbar el arranque: el chat semántico perdería funciones, pero
// la app, la subida, la validación, el chat SQL y los guardados siguen vivos.
// Sin DATABASE_URL (p. ej. primer arranque antes de enlazar la BD) se omite.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.log(
    "[migrate] DATABASE_URL no disponible todavía; se omite (se aplicará en el siguiente arranque)."
  );
  process.exit(0);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(here, "..", "db", "init.sql");
const fullSql = readFileSync(sqlPath, "utf8");

/** Esquema sin pgvector: columna embedding como text e sin índice HNSW. */
function degradedSql(sql) {
  return sql
    .replace(/vector\(1536\)/gi, "text")
    .replace(
      /CREATE INDEX IF NOT EXISTS documents_embedding_idx[\s\S]*?;/i,
      ""
    );
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
const client = await pool.connect();

try {
  // 1. Extensión en su propia sentencia (auto-commit): fallo no fatal
  let vectorOk = true;
  try {
    await client.query("CREATE EXTENSION IF NOT EXISTS vector");
  } catch (error) {
    vectorOk = false;
    console.error(
      `[migrate] AVISO: no se pudo crear la extensión vector: ${
        error instanceof Error ? error.message : error
      }`
    );
    console.error(
      "[migrate] Se usará un esquema degradado (embedding como text): el chat semántico y los embeddings quedarán limitados."
    );
  }

  // 2. Esquema completo (o degradado) en una transacción idempotente
  const sql = vectorOk ? fullSql : degradedSql(fullSql);
  await client.query("BEGIN");
  await client.query(sql);
  await client.query("COMMIT");

  console.log(
    vectorOk
      ? "[migrate] esquema aplicado correctamente (pgvector + documents + document_data)."
      : "[migrate] esquema degradado aplicado (sin pgvector)."
  );
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(
    `[migrate] ERROR: ${error instanceof Error ? error.message : error}`
  );
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
