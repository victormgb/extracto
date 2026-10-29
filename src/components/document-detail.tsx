/* eslint-disable @next/next/no-img-element -- La vista previa es la URL de la
   API con dimensiones desconocidas; next/image no aporta aquí. */
"use client";

import { useMemo, useState } from "react";
import { formatDate } from "@/lib/format";
import { fromFormValues, toFormValues, type FormValues } from "@/lib/form";
import { schemaForType } from "@/lib/schemas";
import type { DocumentDTO, DocumentType, ValidationIssue } from "@/lib/types";

const TIPO_LABELS: Record<DocumentType, string> = {
  factura: "Factura",
  recibo: "Recibo",
  contrato: "Contrato",
  otro: "Otro",
};

const TIPO_BADGE: Record<DocumentType, string> = {
  factura: "bg-amber-500",
  recibo: "bg-sky-600",
  contrato: "bg-violet-600",
  otro: "bg-zinc-500",
};

/** Campos obligatorios según el tipo de documento. */
const REQUIRED_FIELDS: Record<DocumentType, ReadonlySet<string>> = {
  factura: new Set([
    "titulo",
    "partes.emisor.nombre",
    "partes.receptor.nombre",
    "fechas.emision",
    "importes.total",
  ]),
  recibo: new Set(["titulo", "fechas.emision", "importes.total"]),
  contrato: new Set(["titulo", "partes.emisor.nombre", "partes.receptor.nombre"]),
  otro: new Set(),
};

/** Campos del formulario ↔ rutas del JSON. */
const FIELD_ROUTES: Record<keyof FormValues, string> = {
  titulo: "titulo",
  resumen: "resumen",
  emisor_nombre: "partes.emisor.nombre",
  emisor_id: "partes.emisor.identificador_fiscal",
  emisor_direccion: "partes.emisor.direccion",
  receptor_nombre: "partes.receptor.nombre",
  receptor_id: "partes.receptor.identificador_fiscal",
  emision: "fechas.emision",
  vencimiento: "fechas.vencimiento",
  moneda: "importes.moneda",
  base_imponible: "importes.base_imponible",
  impuestos: "importes.impuestos",
  total: "importes.total",
  datos_clave: "datos_clave",
};

type Props = {
  doc: DocumentDTO;
  saving: boolean;
  extracting: boolean;
  onSave: (json: Record<string, unknown>, tipo: DocumentType) => void;
  onExtract: (doc: DocumentDTO) => void;
  onClose: () => void;
};

function issuesToMap(issues: ValidationIssue[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const issue of issues) {
    if (!(issue.path in map)) map[issue.path] = issue.message;
  }
  return map;
}

function Field({
  label,
  error,
  hint,
  required,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
      {error ? (
        <span className="text-xs font-medium text-red-600 dark:text-red-400">
          {error}
        </span>
      ) : hint ? (
        <span className="text-xs text-zinc-400 dark:text-zinc-500">{hint}</span>
      ) : null}
    </label>
  );
}

function inputClass(error?: string): string {
  return `w-full rounded-lg border px-3 py-2 text-sm text-zinc-900 outline-none transition-colors dark:text-zinc-100 dark:bg-zinc-950/40 focus:ring-2 ${
    error
      ? "border-red-500 bg-red-50/60 focus:ring-red-300 dark:border-red-500 dark:bg-red-950/30"
      : "border-zinc-300 bg-white focus:ring-emerald-300 dark:border-zinc-700"
  }`;
}

export default function DocumentDetail({
  doc,
  saving,
  extracting,
  onSave,
  onExtract,
  onClose,
}: Props) {
  const [tipo, setTipo] = useState<DocumentType>(doc.documentType ?? "otro");
  const [values, setValues] = useState<FormValues>(() =>
    toFormValues(doc.extractedJson)
  );
  const [showJson, setShowJson] = useState(false);

  const validation = useMemo(() => {
    const candidate = fromFormValues(values, tipo, doc.extractedJson);
    const result = schemaForType(tipo).safeParse(candidate);
    return { candidate, result };
  }, [values, tipo, doc.extractedJson]);

  const errors = useMemo(() => {
    if (validation.result.success) return {} as Record<string, string>;
    return issuesToMap(
      validation.result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }))
    );
  }, [validation.result]);

  const errorCount = Object.keys(errors).length;
  const isValid = validation.result.success;
  const required = REQUIRED_FIELDS[tipo];
  const isRequired = (field: keyof FormValues) =>
    required.has(FIELD_ROUTES[field]);

  const setValue = (key: keyof FormValues, value: string) =>
    setValues((previous) => ({ ...previous, [key]: value }));

  const emisorLabel = tipo === "contrato" ? "Contratante 1" : "Emisor";
  const receptorLabel = tipo === "contrato" ? "Contratante 2" : "Receptor";
  const partesRequired = tipo === "factura" || tipo === "contrato";
  const confianza =
    typeof doc.extractedJson?.confianza === "number"
      ? doc.extractedJson.confianza
      : null;

  return (
    <section
      id="detalle"
      className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h3
          className="max-w-[40%] truncate text-sm font-semibold"
          title={doc.originalName}
        >
          {doc.originalName}
        </h3>
        <span
          className={`rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white ${TIPO_BADGE[tipo]}`}
        >
          {TIPO_LABELS[tipo]}
        </span>
        {confianza !== null && (
          <span className="text-xs text-zinc-400 dark:text-zinc-500">
            confianza {Math.round(confianza * 100)}%
          </span>
        )}
        {doc.saved && doc.savedAt && (
          <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            Guardado {formatDate(doc.savedAt)}
          </span>
        )}
        {doc.hasEmbedding && (
          <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
            vectorizado
          </span>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onExtract(doc)}
            disabled={extracting || saving}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {extracting ? "Extrayendo…" : "Re-analizar"}
          </button>
          <button
            type="button"
            onClick={() => setShowJson((v) => !v)}
            aria-pressed={showJson}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {showJson ? "Ocultar JSON" : "Ver JSON"}
          </button>
          <button
            type="button"
            onClick={() => onSave(validation.candidate, tipo)}
            disabled={!isValid || saving}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving && (
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            )}
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar detalle"
            className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              className="h-4 w-4"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      </header>

      <div className="grid lg:grid-cols-2">
        {/* Izquierda: vista previa del documento */}
        <div className="border-b border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950/40 lg:border-b-0 lg:border-r">
          <div className="lg:sticky lg:top-4">
            {doc.kind === "image" ? (
              <img
                src={doc.url}
                alt={doc.originalName}
                className="max-h-[70vh] w-full rounded-lg object-contain"
              />
            ) : (
              <iframe
                src={doc.url}
                title={doc.originalName}
                className="h-[70vh] w-full rounded-lg border-0 bg-white"
              />
            )}
          </div>
        </div>

        {/* Derecha: datos extraídos editables */}
        <div className="flex max-h-[80vh] flex-col gap-5 overflow-y-auto p-4">
          <div
            role={isValid ? "status" : "alert"}
            className={`rounded-lg border px-3 py-2 text-xs font-medium ${
              isValid
                ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300"
                : "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300"
            }`}
          >
            {isValid
              ? "Datos válidos: listos para guardar."
              : `${errorCount} ${errorCount === 1 ? "campo requiere" : "campos requieren"} revisión (en rojo).`}
          </div>

          {showJson && (
            <pre className="max-h-56 overflow-auto rounded-lg bg-zinc-950 p-3 text-[11px] leading-relaxed text-emerald-300">
              {JSON.stringify(validation.candidate, null, 2)}
            </pre>
          )}

          <section className="flex flex-col gap-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
              Clasificación
            </h4>

            <Field label="Tipo de documento" error={errors.tipo_documento}>
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value as DocumentType)}
                className={inputClass(errors.tipo_documento)}
              >
                {(Object.keys(TIPO_LABELS) as DocumentType[]).map((value) => (
                  <option key={value} value={value}>
                    {TIPO_LABELS[value]}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="Título / identificador"
              error={errors.titulo}
              required={isRequired("titulo")}
            >
              <input
                type="text"
                value={values.titulo}
                onChange={(e) => setValue("titulo", e.target.value)}
                placeholder="Factura FA-2026-001"
                className={inputClass(errors.titulo)}
              />
            </Field>

            <Field label="Resumen" error={errors.resumen}>
              <textarea
                value={values.resumen}
                onChange={(e) => setValue("resumen", e.target.value)}
                rows={2}
                className={inputClass(errors.resumen)}
              />
            </Field>
          </section>

          <section className="flex flex-col gap-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
              Partes
            </h4>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-3">
                <Field
                  label={`${emisorLabel} · nombre`}
                  error={errors["partes.emisor.nombre"]}
                  required={isRequired("emisor_nombre")}
                  hint={partesRequired ? undefined : "Opcional"}
                >
                  <input
                    type="text"
                    value={values.emisor_nombre}
                    onChange={(e) => setValue("emisor_nombre", e.target.value)}
                    className={inputClass(errors["partes.emisor.nombre"])}
                  />
                </Field>
                <Field
                  label={`${emisorLabel} · NIF/CIF`}
                  error={errors["partes.emisor.identificador_fiscal"]}
                >
                  <input
                    type="text"
                    value={values.emisor_id}
                    onChange={(e) => setValue("emisor_id", e.target.value)}
                    className={inputClass(
                      errors["partes.emisor.identificador_fiscal"]
                    )}
                  />
                </Field>
                <Field
                  label={`${emisorLabel} · dirección`}
                  error={errors["partes.emisor.direccion"]}
                >
                  <input
                    type="text"
                    value={values.emisor_direccion}
                    onChange={(e) =>
                      setValue("emisor_direccion", e.target.value)
                    }
                    className={inputClass(errors["partes.emisor.direccion"])}
                  />
                </Field>
              </div>

              <div className="flex flex-col gap-3">
                <Field
                  label={`${receptorLabel} · nombre`}
                  error={errors["partes.receptor.nombre"]}
                  required={isRequired("receptor_nombre")}
                  hint={partesRequired ? undefined : "Opcional"}
                >
                  <input
                    type="text"
                    value={values.receptor_nombre}
                    onChange={(e) => setValue("receptor_nombre", e.target.value)}
                    className={inputClass(errors["partes.receptor.nombre"])}
                  />
                </Field>
                <Field
                  label={`${receptorLabel} · NIF/CIF`}
                  error={errors["partes.receptor.identificador_fiscal"]}
                >
                  <input
                    type="text"
                    value={values.receptor_id}
                    onChange={(e) => setValue("receptor_id", e.target.value)}
                    className={inputClass(
                      errors["partes.receptor.identificador_fiscal"]
                    )}
                  />
                </Field>
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
              Fechas
            </h4>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Fecha de emisión"
                error={errors["fechas.emision"]}
                required={isRequired("emision")}
              >
                <input
                  type="date"
                  value={values.emision}
                  onChange={(e) => setValue("emision", e.target.value)}
                  className={inputClass(errors["fechas.emision"])}
                />
              </Field>
              <Field
                label="Fecha de vencimiento"
                error={errors["fechas.vencimiento"]}
                hint="No puede ser anterior a la emisión"
              >
                <input
                  type="date"
                  value={values.vencimiento}
                  onChange={(e) => setValue("vencimiento", e.target.value)}
                  className={inputClass(errors["fechas.vencimiento"])}
                />
              </Field>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
              Importes
            </h4>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Moneda" error={errors["importes.moneda"]}>
                <input
                  type="text"
                  value={values.moneda}
                  onChange={(e) => setValue("moneda", e.target.value)}
                  placeholder="EUR"
                  className={inputClass(errors["importes.moneda"])}
                />
              </Field>
              <Field
                label="Base imponible"
                error={errors["importes.base_imponible"]}
              >
                <input
                  type="text"
                  inputMode="decimal"
                  value={values.base_imponible}
                  onChange={(e) => setValue("base_imponible", e.target.value)}
                  placeholder="100,00"
                  className={inputClass(errors["importes.base_imponible"])}
                />
              </Field>
              <Field label="Impuestos" error={errors["importes.impuestos"]}>
                <input
                  type="text"
                  inputMode="decimal"
                  value={values.impuestos}
                  onChange={(e) => setValue("impuestos", e.target.value)}
                  placeholder="21,00"
                  className={inputClass(errors["importes.impuestos"])}
                />
              </Field>
              <Field
                label="Total"
                error={errors["importes.total"]}
                required={isRequired("total")}
                hint="Base + impuestos"
              >
                <input
                  type="text"
                  inputMode="decimal"
                  value={values.total}
                  onChange={(e) => setValue("total", e.target.value)}
                  placeholder="121,00"
                  className={inputClass(errors["importes.total"])}
                />
              </Field>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
              Datos clave (JSON)
            </h4>
            <Field
              label="datos_clave"
              error={errors.datos_clave}
              hint="Objeto JSON libre: nº de factura, líneas, cláusulas…"
            >
              <textarea
                value={values.datos_clave}
                onChange={(e) => setValue("datos_clave", e.target.value)}
                rows={8}
                spellCheck={false}
                className={`${inputClass(errors.datos_clave)} font-mono text-xs leading-relaxed`}
              />
            </Field>
          </section>
        </div>
      </div>
    </section>
  );
}
