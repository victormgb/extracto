-- Extracto: esquema inicial (se ejecuta la primera vez que el contenedor levanta)
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    stored_name   text NOT NULL,
    original_name text NOT NULL,
    mime_type     text NOT NULL,
    kind          text NOT NULL CHECK (kind IN ('image', 'pdf')),
    size_bytes    bigint NOT NULL CHECK (size_bytes > 0),
    created_at    timestamptz NOT NULL DEFAULT now(),
    -- Preparado para RAG: embeddings de 1536 dimensiones (aún sin poblar)
    embedding     vector(1536),
    -- Resultado del análisis con el LLM de visión
    document_type text CHECK (document_type IN ('factura', 'recibo', 'contrato', 'otro')),
    extracted_json jsonb,
    extracted_at  timestamptz
);

-- Migración para volúmenes creados antes de añadir la extracción (idempotente)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS document_type text
    CHECK (document_type IN ('factura', 'recibo', 'contrato', 'otro'));
ALTER TABLE documents ADD COLUMN IF NOT EXISTS extracted_json jsonb;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS extracted_at timestamptz;

-- Texto OCR/contenido del documento (fuente de los embeddings) y marca de
-- confirmación: los datos estructurados viven en document_data (al confirmar).
ALTER TABLE documents ADD COLUMN IF NOT EXISTS content_text text;

-- Datos estructurados confirmados (una fila por documento, FK en cascada)
CREATE TABLE IF NOT EXISTS document_data (
    document_id uuid PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
    document_type text NOT NULL
        CHECK (document_type IN ('factura', 'recibo', 'contrato', 'otro')),
    titulo text,
    resumen text,
    emisor_nombre text,
    emisor_identificador text,
    emisor_direccion text,
    receptor_nombre text,
    receptor_identificador text,
    fecha_emision date,
    fecha_vencimiento date,
    moneda text,
    base_imponible numeric(14, 2),
    impuestos numeric(14, 2),
    total numeric(14, 2),
    datos_clave jsonb,
    saved_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS document_data_saved_at_idx
    ON document_data (saved_at DESC);

CREATE INDEX IF NOT EXISTS documents_created_at_idx
    ON documents (created_at DESC);

CREATE INDEX IF NOT EXISTS documents_embedding_idx
    ON documents USING hnsw (embedding vector_cosine_ops);
