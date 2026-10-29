import type { DocumentType } from "@/lib/types";

/**
 * Conversión entre el JSON extraído (o el que se va a guardar) y los valores
 * de texto del formulario editable. Los números y fechas viajan como string
 * en el formulario; aquí se parsean para validarlos con Zod.
 */

export type FormValues = {
  titulo: string;
  resumen: string;
  emisor_nombre: string;
  emisor_id: string;
  emisor_direccion: string;
  receptor_nombre: string;
  receptor_id: string;
  emision: string;
  vencimiento: string;
  moneda: string;
  base_imponible: string;
  impuestos: string;
  total: string;
  datos_clave: string;
};

function getPath(source: unknown, keys: string[]): unknown {
  let current: unknown = source;
  for (const key of keys) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/** JSON → valores del formulario (tolerante a null, ausencias y números). */
export function toFormValues(raw: unknown): FormValues {
  const source = raw && typeof raw === "object" ? raw : {};
  const text = (...keys: string[]) => asString(getPath(source, keys));

  const datosClave = getPath(source, ["datos_clave"]);
  const datosClaveText =
    datosClave && typeof datosClave === "object" && !Array.isArray(datosClave)
      ? JSON.stringify(datosClave, null, 2)
      : "";

  return {
    titulo: text("titulo"),
    resumen: text("resumen"),
    emisor_nombre: text("partes", "emisor", "nombre"),
    emisor_id: text("partes", "emisor", "identificador_fiscal"),
    emisor_direccion: text("partes", "emisor", "direccion"),
    receptor_nombre: text("partes", "receptor", "nombre"),
    receptor_id: text("partes", "receptor", "identificador_fiscal"),
    emision: text("fechas", "emision"),
    vencimiento: text("fechas", "vencimiento"),
    moneda: text("importes", "moneda"),
    base_imponible: text("importes", "base_imponible"),
    impuestos: text("importes", "impuestos"),
    total: text("importes", "total"),
    datos_clave: datosClaveText,
  };
}

function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function optionalNumber(value: string): number | undefined {
  const trimmed = value.trim().replace(/\s/g, "").replace(",", ".");
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function parseDatosClave(text: string): unknown {
  if (!text.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : undefined;
  } catch {
    return Number.NaN; // JSON inválido: Zod lo rechaza con mensaje propio
  }
}

/**
 * Valores del formulario → JSON a guardar.
 * Preserva claves extra del original (confianza, documento_adicional…).
 */
export function fromFormValues(
  values: FormValues,
  tipo: DocumentType,
  original: Record<string, unknown> | null
): Record<string, unknown> {
  const json: Record<string, unknown> = {
    ...(original && typeof original === "object" ? original : {}),
    tipo_documento: tipo,
    titulo: optionalText(values.titulo),
    resumen: optionalText(values.resumen),
    partes: {
      emisor: {
        nombre: optionalText(values.emisor_nombre),
        identificador_fiscal: optionalText(values.emisor_id),
        direccion: optionalText(values.emisor_direccion),
      },
      receptor: {
        nombre: optionalText(values.receptor_nombre),
        identificador_fiscal: optionalText(values.receptor_id),
      },
    },
    fechas: {
      emision: optionalText(values.emision),
      vencimiento: optionalText(values.vencimiento),
    },
    importes: {
      moneda: optionalText(values.moneda),
      base_imponible: optionalNumber(values.base_imponible),
      impuestos: optionalNumber(values.impuestos),
      total: optionalNumber(values.total),
    },
    datos_clave: parseDatosClave(values.datos_clave),
  };

  // Se devuelve "en memoria" (con undefined/NaN) para que Zod pueda señalar
  // los campos inválidos; JSON.stringify descarta undefined al guardar.
  return json;
}
