/* eslint-disable @next/next/no-img-element -- La miniatura es una URL de la API
   con dimensiones desconocidas; next/image no aporta aquí. */
"use client";

import { formatBytes, formatDate } from "@/lib/format";
import type { DocumentDTO, DocumentType } from "@/lib/types";

type Props = {
  doc: DocumentDTO;
  deleting: boolean;
  /** Este documento se está analizando ahora mismo */
  extracting: boolean;
  /** Hay otra extracción en curso (deshabilita los botones) */
  locked: boolean;
  onDelete: (doc: DocumentDTO) => void;
  onExtract: (doc: DocumentDTO) => void;
  /** Abre la vista de detalle: documento a la izquierda, datos a la derecha */
  onOpen: (doc: DocumentDTO) => void;
};

const TYPE_BADGES: Record<DocumentType, { label: string; className: string }> =
  {
    factura: { label: "Factura", className: "bg-amber-500" },
    recibo: { label: "Recibo", className: "bg-sky-600" },
    contrato: { label: "Contrato", className: "bg-violet-600" },
    otro: { label: "Otro", className: "bg-zinc-500" },
  };

function getResumen(json: Record<string, unknown> | null): string | null {
  if (json && typeof json.resumen === "string" && json.resumen.trim()) {
    return json.resumen.trim();
  }
  return null;
}

export default function DocumentCard({
  doc,
  deleting,
  extracting,
  locked,
  onDelete,
  onExtract,
  onOpen,
}: Props) {
  const badge = doc.documentType ? TYPE_BADGES[doc.documentType] : null;
  const resumen = getResumen(doc.extractedJson);

  return (
    <article className="group overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900">
      <div className="relative h-44 bg-zinc-100 dark:bg-zinc-800">
        {doc.kind === "image" ? (
          <img
            src={doc.url}
            alt={doc.originalName}
            loading="lazy"
            className="h-full w-full object-contain"
          />
        ) : (
          <iframe
            src={doc.url}
            title={doc.originalName}
            loading="lazy"
            className="h-full w-full border-0"
          />
        )}
        <span
          className={`absolute left-2 top-2 rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white ${
            doc.kind === "pdf" ? "bg-red-600" : "bg-zinc-700"
          }`}
        >
          {doc.kind === "pdf" ? "PDF" : "IMG"}
        </span>
        {extracting && (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-md bg-zinc-900/85 px-2 py-1 text-[11px] font-medium text-white">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            Analizando…
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2.5 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p
              title={doc.originalName}
              className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100"
            >
              {doc.originalName}
            </p>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {formatBytes(doc.sizeBytes)} · {formatDate(doc.createdAt)}
            </p>
          </div>

          <button
            type="button"
            onClick={() => onDelete(doc)}
            disabled={deleting}
            aria-label={`Eliminar ${doc.originalName}`}
            title="Eliminar"
            className="shrink-0 rounded-lg p-2 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950/50"
          >
            {deleting ? (
              <span className="block h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-red-600" />
            ) : (
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
              >
                <path d="M4 7h16M10 11v6M14 11v6" />
                <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
                <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
            )}
          </button>
        </div>

        {badge && (
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white ${badge.className}`}
            >
              {badge.label}
            </span>
            {doc.extractedAt && (
              <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                analizado {formatDate(doc.extractedAt)}
              </span>
            )}
          </div>
        )}

        {resumen && (
          <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
            {resumen}
          </p>
        )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onExtract(doc)}
              disabled={extracting || locked}
              className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              {extracting ? (
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white dark:border-zinc-400 dark:border-t-zinc-900" />
              ) : (
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3.5 w-3.5"
                >
                  <path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9z" />
                  <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
                </svg>
              )}
              {extracting
                ? "Extrayendo…"
                : doc.extractedJson
                  ? "Re-analizar"
                  : "Extraer datos"}
            </button>

            {doc.extractedJson && (
              <button
                type="button"
                onClick={() => onOpen(doc)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3.5 w-3.5"
                >
                  <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" />
                  <circle cx="12" cy="12" r="2.5" />
                </svg>
                Ver datos
              </button>
            )}
          </div>
      </div>
    </article>
  );
}
