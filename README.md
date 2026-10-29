# Extracto

App de una sola página para **subir imágenes o PDFs con vista previa**. Los archivos se guardan en disco y sus metadatos en **PostgreSQL con pgvector**. Además, cada documento se puede enviar a un **LLM con visión (DeepSeek vía OpenRouter)** que detecta si es **factura, recibo o contrato**, hace **OCR**, extrae sus datos en **JSON** y los guarda en Postgres para mostrarlos en pantalla.

Hecha con **Next.js 16** (App Router) + **TypeScript** + **Tailwind CSS 4**.

## Requisitos

- Node.js 20+
- Docker (para PostgreSQL + pgvector)

## Puesta en marcha

```bash
# 1. Base de datos (imagen pgvector/pgvector:pg16 en el puerto 5433)
docker compose up -d

# 2. Dependencias
npm install

# 3. Variables de entorno (ya incluidas por defecto)
cp .env.example .env

# 4. Servidor de desarrollo
npm run dev
```

Abre <http://localhost:3000>.

> El puerto **5433** está elegido para no chocar con otras instancias de
> PostgreSQL en local. Si no tienes conflicto, cámbialo a `5432` en `.env`.

## Qué hace la página

- Zona de **arrastrar y soltar** o clic para elegir un archivo (imágenes o PDF).
- **Vista previa local** antes de subir (blob URL del navegador).
- Al subir: el archivo se escribe en `./uploads/` y se inserta una fila en la
  tabla `documents`… y **se analiza automáticamente** con el LLM de visión.
- Listado de documentos con vista previa, badge con el tipo detectado,
  botón **Extraer datos / Re-analizar** y botón **Ver datos**.
- **Vista de detalle**: el documento a la **izquierda** y los datos extraídos a
  la **derecha** en un **formulario editable validado con Zod en tiempo real**
  (los campos inválidos se marcan en **rojo** con su motivo y no se pueden
  guardar hasta corregirlos).
- **Al confirmar** («Guardar cambios»): datos estructurados en la tabla
  `document_data` + **embedding del texto en pgvector** (`documents.embedding`).
- **Lista de «Documentos guardados»**: los confirmados, con su tipo, título,
  total, fecha de confirmación y badge `pgvector ✓` / `sin vector`.
- **Chat semántico**: pregunta en lenguaje natural — la pregunta se
  vectoriza y se busca por **similitud de coseno en pgvector** entre los
  documentos indexados; el LLM responde citando el origen
  (`[Fuente: …]`) y cada respuesta muestra chips de **fuentes con su
  porcentaje de similitud** (clic → abre el documento).
- Guardar correcciones (`PATCH`) y eliminar documentos.

## Extracción con LLM de visión (OpenRouter + DeepSeek)

1. El servidor prepara el contenido como **mensaje multimodal** (compatible con
   OpenAI): texto con el prompt + `image_url` en `data:` base64.
   - **Imágenes** → se envían tal cual.
   - **PDFs** → DeepSeek solo acepta texto+imagen, así que **pdf.js**
     (`pdfjs-dist` + `@napi-rs/canvas`) convierte las **primeras 3 páginas**
     (`EXTRACT_MAX_PDF_PAGES`) en JPEG y se envían como varias imágenes.
2. Se llama a **`POST https://openrouter.ai/api/v1/chat/completions`** con el
   modelo de DeepSeek (`EXTRACT_MODEL`) y `response_format: json_object`,
   con un prompt de clasificación + OCR en español. El modelo responde con:

```json
{
  "tipo_documento": "factura | recibo | contrato | otro",
  "titulo": "Factura FA-2026-001",
  "confianza": 0.95,
  "resumen": "Una frase en español…",
  "partes": { "emisor": {}, "receptor": {} },
  "fechas": { "emision": "2026-01-15" },
  "importes": { "moneda": "EUR", "base_imponible": 100, "impuestos": 21, "total": 121 },
  "datos_clave": {}
}
```

3. Se normaliza `tipo_documento`, se guarda en las columnas
   `document_type`, `extracted_json` y `extracted_at` y el cliente muestra el
   JSON en pantalla.

> **Nota sobre "DeepSeek OCR"**: OpenRouter no aloja `deepseek-ocr` (DeepSeek
> nunca publicó API para él); se usa **`deepseek/deepseek-v4.1-flash`**, un
> modelo con visión que hace OCR de documentos. Puedes cambiar de modelo con
> `EXTRACT_MODEL` (cualquiera de OpenRouter con entrada `image`).

Configura tu clave en `.env` (<https://openrouter.ai/keys>):

```bash
OPENROUTER_API_KEY=sk-or-v1-...
EXTRACT_MODEL=deepseek/deepseek-v4.1-flash
EXTRACT_MAX_PDF_PAGES=3
```

> Sin clave, la extracción responde `503` con un mensaje indicándolo; el resto
> de la app funciona igual. `OPENROUTER_BASE_URL` (opcional) permite apuntar a
> un proxy o mock local.

## Validación con Zod (`src/lib/schemas.ts`)

Hay un esquema por tipo de documento (`factura`, `recibo`, `contrato`, `otro`)
compartido entre cliente y servidor:

- **Fechas**: formato `YYYY-MM-DD`, día real de calendario (rechaza
  `2026-02-31`) y vencimiento nunca anterior a la emisión.
- **Importes**: `base_imponible + impuestos = total` con tolerancia de 1 céntimo.
- **Campos obligatorios por tipo**:
  | Tipo | Obligatorios |
  | ---- | ------------ |
  | `factura` | título, emisor, receptor, fecha de emisión, total |
  | `recibo` | título, fecha de emisión, total (partes opcionales) |
  | `contrato` | título, ambos contratantes (fechas e importes opcionales) |
  | `otro` | ninguno (todo opcional) |
- Tolera `null` y vacíos (típicos del LLM); los importes no numéricos dan
  *"Importe no válido"* y los ausentes *"Obligatorio"*.

El cliente valida **mientras escribes** (campo en rojo + resumen de errores +
botón Guardar deshabilitado) y el servidor **vuelve a validar** en el `PATCH`
(devolviendo `422` con la lista de `issues`).

## Guardado estructurado + embeddings (al confirmar)

Al pulsar **«Guardar cambios»** (`PATCH /api/documents/:id`) ocurren, en este
orden y solo después de validar con Zod:

1. **`document_data`** — upert de los campos tipados (título, partes, fechas
   como `date`, importes como `numeric(14,2)`, `datos_clave jsonb`,
   `saved_at`). FK con cascada a `documents`: es lo que marca un documento
   como **guardado/confirmado**.
2. **Embedding en pgvector** — se vectoriza el texto del documento con
   `EMBED_MODEL` (por defecto `openai/text-embedding-3-small`, **1536 dims**
   = columna `documents.embedding vector(1536)`) vía `POST /embeddings` de
   OpenRouter. La fuente del texto es `documents.content_text`:
   - el **OCR `texto`** que devuelve el LLM al analizar (campo obligatorio
     del prompt), o
   - si no existe (extracciones antiguas), un texto de respaldo construido
     con los propios datos estructurados.
3. Si el embedding **falla** (sin créditos, red, modelo inexistente…), la
   respuesta sigue siendo `200` con `warning` — la app lo muestra en ámbar y
   el texto queda guardado para reintentar en la próxima confirmación.

Si el LLM devuelve varios comprobantes en un PDF (p. ej. factura + recibo),
se aplanan a la raíz y los secundarios quedan en
`datos_clave.documentos_secundarios`.

## Chat semántico (RAG básico)

`POST /api/chat` con `{ question, history? }` — el servidor elige **dos caminos**:

### 1. Cálculos y totales → SQL (sin embeddings)

Si la pregunta parece numérica (`total`, `suma`, `cuánto(s)`, `promedio`,
`máximo`, `facturado`…), se genera una **consulta SQL** en lugar de buscar
por similitud:

1. DeepSeek recibe el DDL de `documents` + `document_data` y devuelve
   `{"sql": "..."}` (JSON mode, temperatura 0).
2. **Validación de seguridad**: una sola sentencia, solo `SELECT`/`WITH`,
   lista de operaciones prohibidas (`INSERT/UPDATE/DROP/COPY/pg_read_file`…)
   + transacción **`READ ONLY`** con `statement_timeout = 5s` en PostgreSQL
   (doble blindaje) + tope de 20 filas.
3. Si hay filas, una **2ª llamada** convierte el resultado en respuesta
   (con formato monetario y `[Fuente: <título>]` si aparecen documentos
   concretos — sus `id` se recuperan como fuentes clicables, **sin %** de
   similitud, etiquetadas `SQL`). Si no hay filas, se responde sin gastar
   la 2ª llamada. Si la consulta es insegura o falla, se contesta con el
   motivo sin ejecutar nada.
4. La respuesta incluye el campo `sql` y la UI muestra el bloque
   **«Consulta SQL»** bajo el mensaje.

### 2. Preguntas generales → búsqueda semántica

1. Si no hay ningún documento con embedding → respuesta amigable (sin gastar
   llamadas).
2. La pregunta se vectoriza con el **mismo modelo** de embeddings (`EMBED_MODEL`).
3. Búsqueda por similitud de coseno en pgvector:
   `ORDER BY embedding <=> $1::vector` (top-5, se quedan las ≥ 0,15, máx. 3).
4. El contexto recuperado (OCR + datos) se envía a DeepSeek con instrucciones
   de citar cada afirmación con `[Fuente: <título>]`; el historial de la
   conversación se mantiene (últimos 8 mensajes).
5. Respuesta: `{ answer, sources: [{ id, titulo, tipo, originalName,
   similarity }] }` — los chips de fuentes abren el detalle del documento.

Sin documentos indexados o sin coincidencias, responde sin llamar al LLM.

## API

| Método | Ruta                          | Descripción                                   |
| ------ | ----------------------------- | --------------------------------------------- |
| `POST` | `/api/documents`              | Sube un archivo (`multipart/form-data`, campo `file`). Devuelve `{ document }` |
| `GET`  | `/api/documents`              | Lista los documentos (`{ documents }`)         |
| `GET`  | `/api/documents/:id/file`     | Sirve el binario para la vista previa          |
| `POST` | `/api/documents/:id/extract`  | Envía el archivo al LLM, clasifica y guarda el JSON. Devuelve `{ document }` |
| `POST` | `/api/chat`                   | Chat: cálculos → **SQL** (campo `sql`); el resto → semántica en pgvector. `{ question, history? }` → `{ answer, sources[], sql? }` |
| `PATCH` | `/api/documents/:id`         | **Confirmar**: valida con Zod, guarda en `document_data` y genera el embedding en pgvector. `{ documentType, extractedJson }` → `{ document, warning? }` |
| `DELETE` | `/api/documents/:id`        | Elimina el registro y el archivo en disco      |

Límites: solo `image/*` y `application/pdf`, hasta `MAX_UPLOAD_MB` (25 MB por defecto).

## Esquema (`db/init.sql`)

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE documents (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    stored_name   text NOT NULL,
    original_name text NOT NULL,
    mime_type     text NOT NULL,
    kind          text NOT NULL CHECK (kind IN ('image', 'pdf')),
    size_bytes    bigint NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    embedding     vector(1536),          -- pgvector (1 embedding por documento)
    document_type text,                  -- factura | recibo | contrato | otro
    extracted_json jsonb,                -- JSON crudo del LLM
    extracted_at  timestamptz,
    content_text  text                   -- OCR/contenido: fuente del embedding
);

-- Datos estructurados confirmados (una fila por documento)
CREATE TABLE document_data (
    document_id  uuid PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
    document_type text NOT NULL,
    titulo text, resumen text,
    emisor_nombre text, emisor_identificador text, emisor_direccion text,
    receptor_nombre text, receptor_identificador text,
    fecha_emision date, fecha_vencimiento date,
    moneda text,
    base_imponible numeric(14,2),
    impuestos numeric(14,2),
    total numeric(14,2),
    datos_clave jsonb,
    saved_at timestamptz NOT NULL DEFAULT now()
);
```

El script `db/init.sql` se ejecuta automáticamente la primera vez que el
contenedor levanta (montado en `/docker-entrypoint-initdb.d`).

## Estructura

```
src/
├── app/
│   ├── page.tsx                  # Página única (server component)
│   ├── layout.tsx                # Metadata en español
│   └── api/
│       ├── chat/route.ts         # POST chat semántico (RAG)
│       └── documents/
│       ├── route.ts              # POST subir · GET listar
│       └── [id]/
│           ├── route.ts          # DELETE eliminar
│           ├── file/route.ts     # GET binario (vista previa)
│           └── extract/route.ts  # POST análisis con el LLM de visión
├── components/
│   ├── extracto-app.tsx          # Estado global de la página (client)
│   ├── upload-area.tsx           # Dropzone + vista previa pendiente
│   ├── document-card.tsx         # Tarjeta: vista previa, badge, botones
│   ├── document-detail.tsx       # Detalle: documento + formulario Zod
│   ├── saved-list.tsx            # Lista de documentos guardados
│   └── chat-panel.tsx            # Chat semántico con fuentes citadas
└── lib/
    ├── db.ts                     # Pool de pg, JOIN con document_data, DTO
    ├── extract.ts                # Cliente OpenRouter (DeepSeek) + prompt OCR
    ├── embed.ts                  # Embeddings vía POST /embeddings (pgvector)
    ├── sql-chat.ts               # Cálculos: generación + ejecución SQL segura
    ├── structured.ts             # JSON → fila document_data + texto respaldo
    ├── pdf-to-images.ts          # PDF → JPEG con pdf.js + @napi-rs/canvas
    ├── schemas.ts                # Esquemas Zod por tipo de documento
    ├── form.ts                   # Conversión JSON ↔ formulario editable
    ├── files.ts                  # Validación MIME, límites, rutas
    ├── format.ts                 # Formato de tamaño y fechas
    └── types.ts                  # Tipos compartidos cliente/servidor

docker-compose.yml                # PostgreSQL + pgvector
db/init.sql                       # Esquema inicial (+ migración idempotente)
```

## Variables de entorno

| Variable           | Descripción                              | Por defecto                                  |
| ------------------ | ---------------------------------------- | -------------------------------------------- |
| `DATABASE_URL`     | Cadena de conexión a PostgreSQL          | `postgresql://extracto:extracto@localhost:5433/extracto` |
| `POSTGRES_PORT`    | Puerto del contenedor (host)             | `5433`                                       |
| `UPLOAD_DIR`       | Carpeta de archivos subidos              | `./uploads`                                  |
| `MAX_UPLOAD_MB`    | Límite por archivo                       | `25`                                         |
| `OPENROUTER_API_KEY` | Clave de OpenRouter (DeepSeek con visión) | — (obligatoria para extraer)               |
| `EXTRACT_MODEL`    | Modelo de OpenRouter                     | `deepseek/deepseek-v4.1-flash`              |
| `EXTRACT_MAX_PDF_PAGES` | Páginas de PDF que se convierten a imagen | `3`                                     |
| `EMBED_MODEL`    | Modelo de embeddings (OpenRouter)        | `openai/text-embedding-3-small`          |
| `EMBED_DIMS`     | Dimensiones esperadas de la columna       | `1536`                                   |
| `OPENROUTER_BASE_URL` | Base URL alternativa (proxy/mock)      | `https://openrouter.ai/api/v1`              |

## Despliegue en Seenode

El proyecto está desplegado en **<https://extracto.seenode.app>** (proyecto
Seenode `extracto`, app `975432`, BD `extracto-db` `7934776`, PostgreSQL 18.6
en Frankfurt, tier freemium + prueba).

- **Código**: GitHub `victormgb/extracto` (rama `main`); cada push puede
  desplegarse con `create_deployment` (autoDeploy desactivado).
- **Build**: `npm ci && npm run build` · **Run**:
  `node scripts/migrate.mjs && npm start -- -H 0.0.0.0 -p 3000` (puerto3000).
- **Migración**: `scripts/migrate.mjs` se ejecuta **en cada arranque** (es
  idempotente): aplica `db/init.sql` (pgvector + tablas). Si la imagen
  gestionada no tuviera pgvector, degrada (`embedding text`) en vez de tumbar
  el arranque. Sin `DATABASE_URL` se omite.
- **Base de datos enlazada** con `link_database_to_application` → variables
  secretas `DATABASE_URL/HOST/PORT/USER/PASSWORD/NAME`.
- **TLS obligatorio**: el `pg_hba` de Seenode exige cifrado
  (`no encryption` rechaza conexiones planas). `withPlatformSsl()` fuerza
  `sslmode=no-verify` **dentro de la URL** porque el parser de `pg` pisa el
  objeto `ssl` de la configuración con el de la query string.
  `DATABASE_SSL=true` está puesto en la app por si acaso.
- **Secretos**: `OPENROUTER_API_KEY` y `DATABASE_*` son variables secretas
  (write-only) en Seenode; `.env` no se sube a git.
- **Volumen**: `/data` (5 GB) con `UPLOAD_DIR=/data/uploads` para los
  archivos subidos persistentes.
- **Variables de la app**: `EXTRACT_MODEL`, `EXTRACT_MAX_PDF_PAGES`,
  `EMBED_MODEL`, `EMBED_DIMS`, `UPLOAD_DIR`, `MAX_UPLOAD_MB`.
- **Dominio**: `extracto.seenode.app` (dominio por defecto `*.seenode.app`).

Verificación tras desplegar (9/9 OK): `GET /`201… subida de PDF → extracción
real con DeepSeek → confirmar (document_data + embedding pgvector) → chat SQL
y semántico con fuentes → `DELETE` limpio.

## Comandos útiles

```bash
npm run dev      # desarrollo (Turbopack)
npm run build    # build de producción
npm run lint     # ESLint
docker compose up -d        # levantar PostgreSQL
docker compose down         # parar PostgreSQL
docker compose down -v      # parar y borrar el volumen (¡borra los datos!)
```
