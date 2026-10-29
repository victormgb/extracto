"use client";

import { formatDate } from "@/lib/format";
import type { DocumentDTO, DocumentType } from "@/lib/types";

const TIPO_BADGES: Record<DocumentType, { label: string; className: string }> =
  {
    factura: { label: "Factura", className: "bg-amber-500" },
    recibo: { label: "Recibo", className: "bg-sky-600" },
    contrato: { label: "Contrato", className: "bg-violet-600" },
    otro: { label: "Otro", className: "bg-zinc-500" },
  };

type Props = {
  documents: DocumentDTO[];
  onOpen: (doc: DocumentDTO) => void;
};

function readImportes(doc: DocumentDTO): {
  total: number | null;
  moneda: string;
} {
  const json = doc.extractedJson;
  const importes =
    json && typeof json.importes === "object" && json.importes !== null
      ? (json.importes as Record<string, unknown>)
      : null;

  return {
    total:
      importes && typeof importes.total === "number"
        ? importes.total
        : null,
    moneda:
      importes && typeof importes.moneda === "string" ? importes.moneda : "",
  };
}

function readTitulo(doc: DocumentDTO): string {
  const json = doc.extractedJson;
  if (json && typeof json.titulo === "string" && json.titulo.trim()) {
    return json.titulo.trim();
  }
  return doc.originalName;
}

export default function SavedList({ documents, onOpen }: Props) {
  if (documents.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 bg-white py-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
        Aún no has confirmado ningún documento. Abre uno con{" "}
        <span className="font-medium">«Ver datos»</span> y pulsa{" "}
        <span className="font-medium">«Guardar cambios»</span>.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {documents.map((doc) => {
          const badge = doc.documentType
            ? TIPO_BADGES[doc.documentType]
            : TIPO_BADGES.otro;
          const { total, moneda } = readImportes(doc);

          return (
            <li
              key={doc.id}
              className="flex flex-wrap items-center gap-3 px-4 py-3"
            >
              <span
                className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white ${badge.className}`}
              >
                {badge.label}
              </span>

              <div className="min-w-0 flex-1">
                <p
                  title={readTitulo(doc)}
                  className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100"
                >
                  {readTitulo(doc)}
                </p>
                <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                  {doc.originalName}
                  {doc.savedAt && ` · confirmado ${formatDate(doc.savedAt)}`}
                </p>
              </div>

              {total !== null && (
                <span className="shrink-0 text-sm font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
                  {total.toLocaleString("es-ES", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                  {moneda && <span className="ml-1 text-xs font-normal text-zinc-500">{moneda}</span>}
                </span>
              )}

              <span
                className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                  doc.hasEmbedding
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                    : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                }`}
                title={
                  doc.hasEmbedding
                    ? "Texto vectorizado en pgvector"
                    : "Todavía sin embedding en pgvector"
                }
              >
                {doc.hasEmbedding ? "pgvector ✓" : "sin vector"}
              </span>

              <button
                type="button"
                onClick={() => onOpen(doc)}
                className="shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Ver datos
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
