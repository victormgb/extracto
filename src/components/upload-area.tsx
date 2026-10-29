/* eslint-disable @next/next/no-img-element -- Las previsualizaciones son URLs de
   usuario (blob: o /api/documents/...) con dimensiones desconocidas; next/image
   no aporta nada aquí. */
"use client";

import { useRef, useState } from "react";
import type { PendingFile } from "@/lib/types";

type Props = {
  pending: PendingFile | null;
  maxUploadMB: number;
  uploading: boolean;
  onSelect: (file: File) => void;
  onClear: () => void;
  onUpload: () => void;
};

export default function UploadArea({
  pending,
  maxUploadMB,
  uploading,
  onSelect,
  onClear,
  onUpload,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const file = pending?.file ?? null;
  const previewUrl = pending?.previewUrl ?? null;

  const pickFile = () => inputRef.current?.click();

  const handleInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    if (picked) onSelect(picked);
    event.target.value = "";
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) onSelect(dropped);
  };

  const isPdf = file?.type === "application/pdf";

  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setDragging(false);
        }
      }}
      onDrop={handleDrop}
      className={`rounded-2xl border-2 border-dashed transition-colors ${
        dragging
          ? "border-emerald-500 bg-emerald-50 dark:border-emerald-400 dark:bg-emerald-950/40"
          : "border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={handleInput}
      />

      {!file ? (
        <button
          type="button"
          onClick={pickFile}
          className="flex w-full flex-col items-center justify-center gap-3 rounded-2xl px-6 py-14 text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-7 w-7"
            >
              <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
              <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
            </svg>
          </span>
          <span className="text-base font-medium text-zinc-800 dark:text-zinc-100">
            Arrastra una imagen o un PDF aquí
          </span>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            o haz clic para elegir un archivo · PNG, JPG, WEBP, GIF, PDF · hasta{" "}
            {maxUploadMB} MB
          </span>
        </button>
      ) : (
        <div className="flex flex-col gap-4 p-4">
          <div className="overflow-hidden rounded-xl bg-zinc-100 dark:bg-zinc-800">
            {previewUrl && isPdf ? (
              <iframe
                src={previewUrl}
                title="Vista previa del PDF"
                className="h-96 w-full border-0 bg-zinc-100 dark:bg-zinc-800"
              />
            ) : previewUrl ? (
              <img
                src={previewUrl}
                alt={file.name}
                className="max-h-80 w-full object-contain"
              />
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p
                title={file.name}
                className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100"
              >
                {file.name}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {(file.size / 1024 / 1024).toFixed(2)} MB ·{" "}
                {isPdf ? "PDF" : "Imagen"} · listo para subir
              </p>
            </div>

            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={onClear}
                disabled={uploading}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={onUpload}
                disabled={uploading}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {uploading && (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                )}
                {uploading ? "Subiendo…" : "Subir archivo"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
