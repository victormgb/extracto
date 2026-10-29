import type { DocumentType } from "@/lib/types";
import { pdfToPageImages } from "@/lib/pdf-to-images";

/**
 * Cliente de OpenRouter (API compatible con OpenAI) para clasificar y extraer
 * datos del documento con un modelo de visión DeepSeek.
 */

const DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash";
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MAX_PDF_PAGES = 3;

/** Error con mensaje amigable en español y estado HTTP sugerido. */
export class ExtractError extends Error {
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "ExtractError";
    this.status = status;
  }
}

const PROMPT = `Eres un sistema experto de extracción de datos documentales y OCR. Se te adjunta un documento (imagen o páginas de un PDF).

Paso 1 - Clasificación:
El adjunto es UN solo documento de negocio: clasifícalo una única vez como "factura", "recibo" o "contrato". Si no es claramente ninguno de los tres, clasifícalo como "otro". Si contiene varias piezas (p. ej. una factura en una página y un recibo en otra), toma la principal como documento y guarda las demás en "datos_clave.documentos_secundarios".

Paso 2 - Extracción (OCR + estructuración):
Lee con atención todo el texto del documento (usa tus capacidades de OCR) y devuelve ÚnicAMENTE un objeto JSON válido (sin markdown, sin comentarios, sin texto fuera del JSON) con esta forma exacta:

{
  "tipo_documento": "factura" | "recibo" | "contrato" | "otro",
  "titulo": "identificador corto del documento, p. ej. 'Factura FA-2026-001' o 'Contrato de arrendamiento'",
  "confianza": 0.95,
  "resumen": "una frase en español que resuma el documento",
  "texto": "transcripción OCR completa de todo el texto visible del documento, en orden de lectura",
  "partes": {
    "emisor": { "nombre": "...", "identificador_fiscal": "...", "direccion": "..." },
    "receptor": { "nombre": "...", "identificador_fiscal": "..." }
  },
  "fechas": { "emision": "YYYY-MM-DD", "vencimiento": "YYYY-MM-DD" },
  "importes": { "moneda": "EUR", "base_imponible": 100, "impuestos": 21, "total": 121 },
  "datos_clave": { }
}

- En contratos, "partes" debe contener los contratantes (usa las claves que correspondan) y "datos_clave" debe recoger objeto del contrato, duración, precio y cláusulas principales.
- En recibos, "datos_clave" puede incluir nº de recibo, método de pago, concepto.
- En facturas, "datos_clave" puede incluir nº de factura, líneas de producto y forma de pago.

Reglas:
- Responde en español.
- Devuelve SIEMPRE las claves de la raíz descrita (tipo_documento, titulo, texto, partes, fechas, importes, datos_clave); nunca un array ni una lista de documentos en la raíz.
- Incluye SIEMPRE el campo "texto" con el OCR completo: se usará para indexar el documento.
- No inventes ningún dato: si un campo no aparece o no es legible, omite la clave o usa null.
- Las fechas van en formato ISO YYYY-MM-DD cuando sean legibles.
- Los importes van en números (sin símbolo de moneda); la moneda va en "moneda".`;

export function getOpenRouterConfig() {
  const apiKey =
    process.env.OPENROUTER_API_KEY?.trim() ||
    // por si se configuró con el nombre antiguo OPENROUTER_API
    process.env.OPENROUTER_API?.trim();
  const model = process.env.EXTRACT_MODEL?.trim() || DEFAULT_MODEL;
  const baseUrl =
    process.env.OPENROUTER_BASE_URL?.trim() || DEFAULT_BASE_URL;
  const rawPages = Number(process.env.EXTRACT_MAX_PDF_PAGES ?? "3");
  const maxPdfPages = Number.isFinite(rawPages)
    ? Math.min(10, Math.max(1, Math.trunc(rawPages)))
    : DEFAULT_MAX_PDF_PAGES;

  return { apiKey, model, baseUrl: baseUrl.replace(/\/+$/, ""), maxPdfPages };
}

/** Coincide el tipo devuelto por el modelo (o sus variantes) con nuestra enum. */
function normalizeDocumentType(value: unknown): DocumentType {
  if (typeof value !== "string") return "otro";
  const v = value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (v.includes("factur") || v.includes("invoice")) return "factura";
  if (v.includes("recib") || v.includes("receipt")) return "recibo";
  if (v.includes("contrat") || v.includes("contract")) return "contrato";
  return "otro";
}

function parseModelJson(raw: string): Record<string, unknown> {
  let text = raw.trim();

  // Por si el modelo enmarca el JSON en ```json ... ```
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) text = fenced[1].trim();

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // último recurso: del primer { al último }
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    }
  }

  throw new ExtractError("El modelo no devolvió JSON válido", 502);
}

export async function readOpenRouterError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } };
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // ignorar
  }
  return text.slice(0, 300) || `HTTP ${response.status}`;
}

export function openRouterErrorFor(status: number, detail: string, model: string): ExtractError {
  if (status === 401 || status === 403) {
    return new ExtractError(
      `OPENROUTER_API_KEY inválida o sin permisos (${status}): ${detail}`,
      503
    );
  }
  if (status === 402) {
    return new ExtractError(
      `Crédito insuficiente en OpenRouter: ${detail}`,
      402
    );
  }
  if (status === 404) {
    return new ExtractError(
      `El modelo "${model}" no existe en OpenRouter (404: ${detail}). Revisa EXTRACT_MODEL o EMBED_MODEL en .env.`,
      502
    );
  }
  if (status === 429) {
    return new ExtractError(
      "Límite de peticiones o créditos alcanzado en OpenRouter (429). Espera un poco y vuelve a intentarlo.",
      429
    );
  }
  return new ExtractError(`Error de la API de OpenRouter (${status}): ${detail}`, 502);
}

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

async function buildContent(
  buffer: Buffer,
  mimeType: string,
  maxPdfPages: number
): Promise<ContentPart[]> {
  let prompt = PROMPT;

  if (mimeType.startsWith("image/")) {
    return [
      { type: "text", text: prompt },
      {
        type: "image_url",
        image_url: { url: `data:${mimeType};base64,${buffer.toString("base64")}` },
      },
    ];
  }

  if (mimeType === "application/pdf") {
    let conversion;
    try {
      conversion = await pdfToPageImages(buffer, maxPdfPages);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ExtractError(message, 422);
    }

    if (conversion.images.length === 0) {
      throw new ExtractError("El PDF no tiene páginas renderizables", 422);
    }

    if (conversion.renderedPages < conversion.totalPages) {
      prompt += `\n\nNota: el PDF tiene ${conversion.totalPages} páginas y se adjuntan las ${conversion.renderedPages} primeras.`;
    }

    const parts: ContentPart[] = [{ type: "text", text: prompt }];
    for (const image of conversion.images) {
      parts.push({
        type: "image_url",
        image_url: {
          url: `data:${image.mimeType};base64,${image.bytes.toString("base64")}`,
        },
      });
    }
    return parts;
  }

  throw new ExtractError(
    `Tipo de archivo no soportado para extracción: ${mimeType}`,
    415
  );
}

/**
 * Red de seguridad: si el modelo devuelve `{ documentos: [...], tipo_documento }`
 * (varios comprobantes en un PDF), aplanamos el primero a la raíz y guardamos
 * el resto en datos_clave.documentos_secundarios.
 */
function normalizeExtractionShape(
  data: Record<string, unknown>
): Record<string, unknown> {
  const docs = data.documentos;
  if (
    !Array.isArray(docs) ||
    docs.length === 0 ||
    typeof data.titulo === "string"
  ) {
    return data;
  }

  const objects = docs.filter(
    (item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null && !Array.isArray(item)
  );
  if (objects.length === 0) return data;

  const [principal, ...rest] = objects;
  const merged: Record<string, unknown> = { ...data, ...principal };
  delete merged.documentos;

  if (rest.length > 0) {
    const datosClave =
      merged.datos_clave &&
      typeof merged.datos_clave === "object" &&
      !Array.isArray(merged.datos_clave)
        ? { ...(merged.datos_clave as Record<string, unknown>) }
        : {};
    datosClave.documentos_secundarios = rest;
    merged.datos_clave = datosClave;
  }

  return merged;
}

export type ExtractionResult = {
  documentType: DocumentType;
  data: Record<string, unknown>;
};

export type OpenRouterRole = "system" | "user" | "assistant";

export type OpenRouterMessage = {
  role: OpenRouterRole;
  /** Texto plano o partes multimodales (texto + imágenes) */
  content: string | ContentPart[];
};

/**
 * Llamada genérica a /chat/completions de OpenRouter.
 * La usan la extracción (json: true) y el chat semántico.
 */
export async function chatCompletion(
  messages: OpenRouterMessage[],
  options: { json?: boolean; maxTokens?: number; temperature?: number } = {}
): Promise<string> {
  const { apiKey, model, baseUrl } = getOpenRouterConfig();

  if (!apiKey) {
    throw new ExtractError(
      "Falta OPENROUTER_API_KEY en .env. Consigue una clave en https://openrouter.ai/keys y reinicia el servidor.",
      503
    );
  }

  const body = {
    model,
    messages,
    temperature: options.temperature ?? 0.2,
    max_tokens: options.maxTokens ?? 4096,
    ...(options.json
      ? { response_format: { type: "json_object" as const } }
      : {}),
  };

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-Title": "Extracto",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ExtractError(
      `No se pudo contactar con OpenRouter: ${reason}`,
      502
    );
  }

  if (!response.ok) {
    const detail = await readOpenRouterError(response);
    throw openRouterErrorFor(response.status, detail, model);
  }

  const payload = (await response.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string | null } }>;
    error?: { message?: string };
  } | null;

  if (!payload) {
    throw new ExtractError("Respuesta vacía de OpenRouter", 502);
  }

  if (payload.error?.message) {
    throw new ExtractError(`OpenRouter: ${payload.error.message}`, 502);
  }

  const content = payload.choices?.[0]?.message?.content?.trim();

  if (!content) {
    throw new ExtractError("El modelo no devolvió contenido", 502);
  }

  return content;
}

export async function classifyAndExtract(params: {
  buffer: Buffer;
  mimeType: string;
}): Promise<ExtractionResult> {
  const { maxPdfPages } = getOpenRouterConfig();

  const content = await buildContent(params.buffer, params.mimeType, maxPdfPages);

  const contentText = await chatCompletion(
    [{ role: "user", content }],
    { json: true, maxTokens: 8192 }
  );

  const data = normalizeExtractionShape(parseModelJson(contentText));
  const documentType = normalizeDocumentType(data.tipo_documento);
  data.tipo_documento = documentType;

  return { documentType, data };
}
