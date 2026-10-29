// Migración idempotente que se ejecuta al arrancar la app (run_command).
// Diseñada para el entorno gestionado:
//  - Fail-fast: cada fase se registra y cualquier error termina el proceso
//    con código distinto de cero para que el mensaje aparezca en los logs.
//  - Sin DATABASE_URL (p. ej. primer arranque antes de enlazar la BD) se omite.
//  - Si la extensión pgvector no está disponible, degrada el esquema
//    (embedding como text) en lugar de tumbar el arranque.
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

let target = "(URL no parseable)";
try {
  const parsed = new URL(databaseUrl);
  target = `${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`;
} catch {
  /* se deja el marcador */
}
console.log(`[migrate] iniciando → ${target} (pid ${process.pid})`);
console.log(
  `[migrate] DATABASE_SSL=${JSON.stringify(process.env.DATABASE_SSL ?? null)}`
);

/** Igual que lib/db.ts: fuerza TLS en la URL (la sslmode de la URL gana en pg). */
function withPlatformSsl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const isManaged = url.hostname.endsWith(".run-on-seenode.com");
    const forced = (process.env.DATABASE_SSL ?? "").toLowerCase() === "true";
    if (isManaged || forced) {
      url.searchParams.delete("sslmode");
      url.searchParams.delete("ssl");
      url.searchParams.set("sslmode", "no-verify");
      return { url: url.toString(), ssl: true };
    }
  } catch {
    /* URL no parseable: se usa tal cual */
  }
  return { url: rawUrl, ssl: false };
}

const prepared = withPlatformSsl(databaseUrl);
console.log(`[migrate] tls_forzado=${prepared.ssl}`);

const here = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(here, "..", "db", "init.sql");
const fullSql = readFileSync(sqlPath, "utf8");

/** Esquema sin pgvector: columna embedding como text e sin índice HNSW. */
function degradedSql(sql) {
  return sql
    .replace(/vector\(1536\)/gi, "text")
    .replace(/CREATE INDEX IF NOT EXISTS documents_embedding_idx[\s\S]*?;/i, "");
}

const pool = new pg.Pool({
  connectionString: prepared.url,
  max: 2,
  // Fail-fast: en vez de esperar en silencio si el TCP no llega
  connectionTimeoutMillis: 15_000,
  idleTimeoutMillis: 10_000,
  // Complemento defensivo por si la sslmode de la URL se pierde
  ...(prepared.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
});
pool.on("error", (error) => {
  console.error(`[migrate] cliente inactivo con error: ${error.message}`);
});

let client;
try {
  client = await pool.connect();
} catch (error) {
  console.error(
    `[migrate] NO SE PUDO CONECTAR a la base de datos: ${
      error instanceof Error ? error.message : error
    }`
  );
  await pool.end();
  process.exit(1);
}

console.log("[migrate] conectado a PostgreSQL.");

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
  }

  // 2. Esquema completo (o degradado) en una transacción idempotente
  const sql = vectorOk ? fullSql : degradedSql(fullSql);
  await client.query("BEGIN");
  await client.query(sql);
  await client.query("COMMIT");

  console.log(
    vectorOk
      ? "[migrate] OK: esquema aplicado (pgvector + documents + document_data)."
      : "[migrate] OK: esquema degradado aplicado (sin pgvector)."
  );
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(
    `[migrate] ERROR DE ESQUEMA: ${
      error instanceof Error ? error.message : error
    }`
  );
  client.release();
  await pool.end();
  process.exit(1);
}

client.release();
await pool.end();
