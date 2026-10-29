// Migración idempotente que se ejecuta al arrancar la app (run_command).
// Aplica db/init.sql (pgvector + documents + document_data) en la BD enlazada.
// Sin DATABASE_URL (p. ej. primer arranque antes de enlazar la BD) se omite.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.log("[migrate] DATABASE_URL no disponible todavía; se omite (se aplicará en el siguiente arranque).");
  process.exit(0);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(here, "..", "db", "init.sql");
const sql = readFileSync(sqlPath, "utf8");

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });

try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    console.log("[migrate] esquema aplicado correctamente (pgvector + documents + document_data).");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[migrate] ERROR: ${message}`);
  if (/extension .* vector/i.test(message) || /pgvector/i.test(message)) {
    console.error(
      "[migrate] La extensión pgvector no está disponible en esta base de datos. " +
        "El chat y los embeddings no funcionarán sin ella."
    );
  }
  process.exitCode = 1;
} finally {
  await pool.end();
}
