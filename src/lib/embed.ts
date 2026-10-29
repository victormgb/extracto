import {
  ExtractError,
  getOpenRouterConfig,
  openRouterErrorFor,
  readOpenRouterError,
} from "@/lib/extract";

/**
 * Embeddings vía OpenRouter (`POST /embeddings`).
 * Por defecto openai/text-embedding-3-small → 1536 dimensiones, que es lo
 * que alberga la columna documents.embedding vector(1536).
 */

const DEFAULT_EMBED_MODEL = "openai/text-embedding-3-small";
const DEFAULT_DIMS = 1536;
const MAX_INPUT_CHARS = 40_000;

export function getEmbedModel(): string {
  return process.env.EMBED_MODEL?.trim() || DEFAULT_EMBED_MODEL;
}

function getExpectedDims(): number {
  const dims = Number(process.env.EMBED_DIMS ?? DEFAULT_DIMS);
  return Number.isInteger(dims) && dims > 0 ? dims : DEFAULT_DIMS;
}

export type EmbeddingResult = {
  vector: number[];
  dims: number;
  model: string;
};

export async function embedText(text: string): Promise<EmbeddingResult> {
  const { apiKey, baseUrl } = getOpenRouterConfig();
  if (!apiKey) {
    throw new ExtractError(
      "Falta OPENROUTER_API_KEY en .env. Consigue una clave en https://openrouter.ai/keys y reinicia el servidor.",
      503
    );
  }

  const input = text.trim().slice(0, MAX_INPUT_CHARS);
  if (!input) {
    throw new ExtractError("No hay texto para vectorizar", 422);
  }

  const model = getEmbedModel();
  const expectedDims = getExpectedDims();

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-Title": "Extracto",
      },
      body: JSON.stringify({ model, input }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ExtractError(
      `No se pudo contactar con OpenRouter para el embedding: ${reason}`,
      502
    );
  }

  if (!response.ok) {
    const detail = await readOpenRouterError(response);
    throw openRouterErrorFor(response.status, detail, model);
  }

  const payload = (await response.json().catch(() => null)) as {
    data?: Array<{ embedding?: number[] }>;
  } | null;

  const vector = payload?.data?.[0]?.embedding;
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new ExtractError("OpenRouter devolvió un embedding vacío", 502);
  }

  if (vector.length !== expectedDims) {
    throw new ExtractError(
      `El modelo devolvió ${vector.length} dimensiones y la columna espera vector(${expectedDims}). ` +
        `Ajusta EMBED_DIMS o migra la columna en PostgreSQL.`,
      500
    );
  }

  return { vector, dims: vector.length, model };
}

/** Formatea un vector para la query parametrizada de pg (`$2::vector`). */
export function vectorToLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}
