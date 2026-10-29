import { z } from "zod";

/**
 * Esquemas Zod por tipo de documento para el JSON extraído por el LLM.
 * Reglas de negocio:
 *  - Fechas: formato ISO YYYY-MM-DD, día real de calendario y vencimiento
 *    nunca anterior a la emisión.
 *  - Importes: base_imponible + impuestos = total (tolerancia de 1 céntimo).
 *  - Campos obligatorios según el tipo de documento.
 * Tolera null y cadenas vacías (los LLM devuelven null con frecuencia).
 */

export const DOCUMENT_TYPE_VALUES = [
  "factura",
  "recibo",
  "contrato",
  "otro",
] as const;

export const tipoDocumentoSchema = z.enum(DOCUMENT_TYPE_VALUES);

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

/** Texto obligatorio: no puede faltar, ser null ni quedar vacío. */
const textoObligatorio = z
  .string({ error: "Obligatorio" })
  .nullish()
  .transform((v) => v?.trim() ?? "")
  .refine((v) => v.length > 0, { error: "Obligatorio" });

/** Texto opcional: null, undefined o vacío → undefined. */
const textoOpcional = z
  .string()
  .nullish()
  .transform((v) => v?.trim() || undefined);

/** Fecha base: acepta vacío/null y valida formato + día real de calendario. */
const fechaBase = z
  .string({ error: "Obligatorio" })
  .nullish()
  .transform((v) => v?.trim() ?? "")
  .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), {
    error: "Debe ser una fecha YYYY-MM-DD",
  })
  .refine(
    (v) => {
      if (v === "") return true;
      const date = new Date(`${v}T00:00:00Z`);
      return (
        !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === v
      );
    },
    { error: "Fecha no válida (día inexistente)" }
  );

/** Fecha obligatoria. */
const fecha = fechaBase.refine((v) => v.length > 0, { error: "Obligatorio" });

/** Fecha opcional: vacío → undefined. */
const fechaOpcional = fechaBase.transform((v) => (v === "" ? undefined : v));

/** Importe numérico no negativo (falta → "Obligatorio"; NaN → "no válido"). */
const importe = z
  .number({
    error: (issue) =>
      issue.input === undefined || issue.input === null
        ? "Obligatorio"
        : "Importe no válido",
  })
  .min(0, "No puede ser negativo");

const importeOpcional = importe.nullish().transform((v) => v ?? undefined);

const confianza = z
  .number()
  .nullish()
  .transform((v) => v ?? undefined)
  .refine((v) => v === undefined || (v >= 0 && v <= 1), {
    error: "Entre 0 y 1",
  });

/** datos_clave: objeto libre (líneas de producto, cláusulas…). */
const jsonObject = z
  .unknown()
  .optional()
  .refine(
    (v) =>
      v === undefined ||
      v === null ||
      (typeof v === "object" && !Array.isArray(v)),
    "Debe ser un objeto JSON"
  );

const parte = z.object({
  nombre: textoObligatorio,
  identificador_fiscal: textoOpcional,
  direccion: textoOpcional,
});

const parteOpcional = z.object({
  nombre: textoOpcional,
  identificador_fiscal: textoOpcional,
  direccion: textoOpcional,
});

/** Partes obligatorias (factura y contrato: emisor + receptor). */
const partesRequeridas = z.object({ emisor: parte, receptor: parte });

/** Partes libres (recibo y otro): cualquiera puede faltar. */
const partesRecibibles = z.object({
  emisor: parteOpcional.optional(),
  receptor: parteOpcional.optional(),
});

/** base_imponible + impuestos = total (solo si están los tres). */
const sumaImportes = <T extends z.ZodType>(schema: T) =>
  schema.refine(
    (value) => {
      const v = value as {
        base_imponible?: number;
        impuestos?: number;
        total?: number;
      };
      if (
        v.base_imponible == null ||
        v.impuestos == null ||
        v.total == null
      ) {
        return true;
      }
      return Math.abs(v.base_imponible + v.impuestos - v.total) < 0.01;
    },
    { error: "El total no coincide con base + impuestos", path: ["total"] }
  );

// ---------------------------------------------------------------------------
// Esquemas por tipo
// ---------------------------------------------------------------------------

export const facturaSchema = z.object({
  tipo_documento: z.literal("factura"),
  titulo: textoObligatorio,
  confianza,
  resumen: textoOpcional,
  partes: partesRequeridas,
  fechas: z
    .object({ emision: fecha, vencimiento: fechaOpcional })
    .refine(
      (v) => !v.vencimiento || !v.emision || v.vencimiento >= v.emision,
      { error: "Anterior a la fecha de emisión", path: ["vencimiento"] }
    ),
  importes: sumaImportes(
    z.object({
      moneda: textoOpcional,
      base_imponible: importeOpcional,
      impuestos: importeOpcional,
      total: importe,
    })
  ),
  datos_clave: jsonObject,
});

export const reciboSchema = z.object({
  tipo_documento: z.literal("recibo"),
  titulo: textoObligatorio,
  confianza,
  resumen: textoOpcional,
  partes: partesRecibibles.optional(),
  fechas: z
    .object({ emision: fecha, vencimiento: fechaOpcional })
    .refine(
      (v) => !v.vencimiento || !v.emision || v.vencimiento >= v.emision,
      { error: "Anterior a la fecha de emisión", path: ["vencimiento"] }
    ),
  importes: sumaImportes(
    z.object({
      moneda: textoOpcional,
      base_imponible: importeOpcional,
      impuestos: importeOpcional,
      total: importe,
    })
  ),
  datos_clave: jsonObject,
});

export const contratoSchema = z.object({
  tipo_documento: z.literal("contrato"),
  titulo: textoObligatorio,
  confianza,
  resumen: textoOpcional,
  partes: partesRequeridas,
  fechas: z
    .object({
      emision: fechaOpcional,
      vencimiento: fechaOpcional,
    })
    .refine(
      (v) =>
        !v.vencimiento ||
        !v.emision ||
        v.vencimiento >= v.emision,
      { error: "Anterior a la fecha de emisión", path: ["vencimiento"] }
    ),
  importes: sumaImportes(
    z.object({
      moneda: textoOpcional,
      base_imponible: importeOpcional,
      impuestos: importeOpcional,
      total: importeOpcional,
    })
  ),
  datos_clave: jsonObject,
});

export const otroSchema = z.object({
  tipo_documento: z.literal("otro"),
  titulo: textoOpcional,
  confianza,
  resumen: textoOpcional,
  partes: partesRecibibles.optional(),
  fechas: z
    .object({ emision: fechaOpcional, vencimiento: fechaOpcional })
    .optional(),
  importes: sumaImportes(
    z.object({
      moneda: textoOpcional,
      base_imponible: importeOpcional,
      impuestos: importeOpcional,
      total: importeOpcional,
    })
  ),
  datos_clave: jsonObject,
});

// ---------------------------------------------------------------------------
// Acceso por tipo
// ---------------------------------------------------------------------------

export const extractedJsonSchemas = {
  factura: facturaSchema,
  recibo: reciboSchema,
  contrato: contratoSchema,
  otro: otroSchema,
} as const;

export function schemaForType(
  tipo: (typeof DOCUMENT_TYPE_VALUES)[number]
): z.ZodType {
  return extractedJsonSchemas[tipo] as unknown as z.ZodType;
}
