import type { DocumentType } from "@/lib/types";

/**
 * Conversión del JSON extraído/confirmado a:
 *  - fila de la tabla `document_data` (datos estructurados al confirmar)
 *  - texto de respaldo para el embedding (si no hay OCR `texto`)
 */

export type DocumentDataRow = {
  document_id: string;
  document_type: DocumentType;
  titulo: string | null;
  resumen: string | null;
  emisor_nombre: string | null;
  emisor_identificador: string | null;
  emisor_direccion: string | null;
  receptor_nombre: string | null;
  receptor_identificador: string | null;
  fecha_emision: string | null;
  fecha_vencimiento: string | null;
  moneda: string | null;
  base_imponible: number | null;
  impuestos: number | null;
  total: number | null;
  datos_clave: string | null;
};

function getPath(source: unknown, keys: string[]): unknown {
  let current: unknown = source;
  for (const key of keys) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function amount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  // redondeo bancario a 2 decimales para numeric(14,2)
  return Math.round(value * 100) / 100;
}

/** Fecha YYYY-MM-DD válida o null (defensa ante datos libres en "otro"). */
function date(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const parsed = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === trimmed ? trimmed : null;
}

export function buildDocumentDataRow(
  documentId: string,
  documentType: DocumentType,
  json: Record<string, unknown> | null | undefined
): DocumentDataRow {
  const source = json && typeof json === "object" ? json : {};
  const datosClave = getPath(source, ["datos_clave"]);

  return {
    document_id: documentId,
    document_type: documentType,
    titulo: text(getPath(source, ["titulo"])),
    resumen: text(getPath(source, ["resumen"])),
    emisor_nombre: text(getPath(source, ["partes", "emisor", "nombre"])),
    emisor_identificador: text(
      getPath(source, ["partes", "emisor", "identificador_fiscal"])
    ),
    emisor_direccion: text(getPath(source, ["partes", "emisor", "direccion"])),
    receptor_nombre: text(getPath(source, ["partes", "receptor", "nombre"])),
    receptor_identificador: text(
      getPath(source, ["partes", "receptor", "identificador_fiscal"])
    ),
    fecha_emision: date(getPath(source, ["fechas", "emision"])),
    fecha_vencimiento: date(getPath(source, ["fechas", "vencimiento"])),
    moneda: text(getPath(source, ["importes", "moneda"])),
    base_imponible: amount(getPath(source, ["importes", "base_imponible"])),
    impuestos: amount(getPath(source, ["importes", "impuestos"])),
    total: amount(getPath(source, ["importes", "total"])),
    datos_clave:
      datosClave && typeof datosClave === "object" && !Array.isArray(datosClave)
        ? JSON.stringify(datosClave)
        : null,
  };
}

/**
 * Texto a vectorizar: el OCR (`texto` del LLM, columna content_text) o, si no
 * existe (extracciones antiguas), los propios datos estructurados.
 */
export function textForEmbedding(
  contentText: string | null,
  json: Record<string, unknown> | null | undefined
): string {
  const ocr = contentText?.trim();
  if (ocr) return ocr;

  const source = json && typeof json === "object" ? json : {};
  const parts: string[] = [];

  const push = (label: string, value: unknown) => {
    if (typeof value === "string" && value.trim()) {
      parts.push(`${label}: ${value.trim()}`);
    }
  };

  push("Título", getPath(source, ["titulo"]));
  push("Resumen", getPath(source, ["resumen"]));
  push("Emisor", getPath(source, ["partes", "emisor", "nombre"]));
  push("Receptor", getPath(source, ["partes", "receptor", "nombre"]));
  push("Fecha de emisión", getPath(source, ["fechas", "emision"]));
  push("Fecha de vencimiento", getPath(source, ["fechas", "vencimiento"]));

  const total = getPath(source, ["importes", "total"]);
  if (typeof total === "number" && Number.isFinite(total)) {
    const moneda = getPath(source, ["importes", "moneda"]);
    parts.push(`Total: ${total}${typeof moneda === "string" ? ` ${moneda}` : ""}`);
  }

  const datosClave = getPath(source, ["datos_clave"]);
  if (datosClave && typeof datosClave === "object" && !Array.isArray(datosClave)) {
    parts.push(JSON.stringify(datosClave));
  }

  if (parts.length === 0) {
    return JSON.stringify(source);
  }

  return parts.join("\n");
}
