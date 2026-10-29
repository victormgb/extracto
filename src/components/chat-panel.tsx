"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage, DocumentType } from "@/lib/types";

type Props = {
  messages: ChatMessage[];
  busy: boolean;
  indexedCount: number;
  onAsk: (question: string) => void;
  onOpenSource: (id: string) => void;
};

const TIPO_COLORS: Record<DocumentType, string> = {
  factura: "bg-amber-500",
  recibo: "bg-sky-600",
  contrato: "bg-violet-600",
  otro: "bg-zinc-500",
};

const SUGGESTIONS = [
  "¿Cuánto es el total de la factura?",
  "¿Cuánto suman las facturas?",
  "¿Quién emitió los documentos?",
  "¿Qué recibos tengo?",
];

export default function ChatPanel({
  messages,
  busy,
  indexedCount,
  onAsk,
  onOpenSource,
}: Props) {
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  // Scroll del log al final (solo DOM, sin setState)
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTo({ top: log.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const question = draft.trim();
    if (!question || busy) return;
    setDraft("");
    onAsk(question);
  };

  return (
    <section id="chat" className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Chat semántico</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Busca por significado sobre los embeddings (pgvector) y cita el
            documento de origen
          </p>
        </div>
        <span
          className={
            indexedCount > 0
              ? "text-sm text-zinc-500 dark:text-zinc-400"
              : "text-sm font-medium text-amber-600 dark:text-amber-400"
          }
        >
          {indexedCount > 0
            ? `${indexedCount} ${indexedCount === 1 ? "documento indexado" : "documentos indexados"}`
            : "sin documentos indexados"}
        </span>
      </div>

      <div
        ref={logRef}
        className="flex max-h-[28rem] min-h-[10rem] flex-col gap-3 overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
      >
        {messages.length === 0 && !busy && (
          <p className="m-auto max-w-sm text-center text-sm text-zinc-400 dark:text-zinc-500">
            Pregunta por los contenidos de tus documentos: facturas, recibos,
            contratos… Elige arriba <strong>«Ver datos»</strong> y confirma un
            documento para indexarlo.
          </p>
        )}

        {messages.map((message, index) =>
          message.role === "user" ? (
            <div
              key={index}
              className="max-w-[85%] self-end whitespace-pre-wrap rounded-2xl rounded-br-md bg-zinc-900 px-4 py-2.5 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900"
            >
              {message.content}
            </div>
          ) : (
            <div key={index} className="flex max-w-[92%] flex-col gap-2 self-start">
              <div className="whitespace-pre-wrap rounded-2xl rounded-bl-md border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm leading-relaxed dark:border-zinc-700 dark:bg-zinc-800/60">
                {message.content}
              </div>

              {message.sql && (
                <div className="w-full overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
                  <div className="bg-zinc-100 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                    Consulta SQL
                  </div>
                  <pre className="overflow-x-auto bg-zinc-950 px-3 py-2 text-[11px] leading-relaxed text-sky-300">
                    {message.sql}
                  </pre>
                </div>
              )}

              {message.sources && message.sources.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
                    Fuentes:
                  </span>
                  {message.sources.map((source) => (
                    <button
                      key={source.id}
                      type="button"
                      onClick={() => onOpenSource(source.id)}
                      title={
                        source.similarity != null
                          ? `${source.originalName} · similitud ${Math.round(source.similarity * 100)}%`
                          : `${source.originalName} · consulta SQL`
                      }
                      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-600 transition-colors hover:border-emerald-300 hover:text-emerald-700 dark:border-zinc-700 dark:bg-zinc-950/60 dark:text-zinc-300 dark:hover:border-emerald-700 dark:hover:text-emerald-300"
                    >
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${TIPO_COLORS[source.tipo]}`}
                      />
                      <span className="truncate">{source.titulo}</span>
                      {source.similarity != null ? (
                        <span className="shrink-0 text-zinc-400 dark:text-zinc-500">
                          {Math.round(source.similarity * 100)}%
                        </span>
                      ) : (
                        <span className="shrink-0 rounded bg-zinc-100 px-1 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                          SQL
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        )}

        {busy && (
          <div className="flex items-center gap-2 self-start rounded-2xl rounded-bl-md border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/60">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-300 border-t-emerald-600" />
            Consultando tus documentos…
          </div>
        )}
      </div>

      {messages.length === 0 && !busy && (
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => onAsk(suggestion)}
              className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 transition-colors hover:border-emerald-300 hover:text-emerald-700 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-emerald-700 dark:hover:text-emerald-300"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={submit} className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={500}
          placeholder={
            indexedCount > 0
              ? "Pregunta por tus documentos…"
              : "Confirma un documento para poder preguntar…"
          }
          aria-label="Pregunta para el chat"
          className="min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm outline-none transition-colors focus:ring-2 focus:ring-emerald-300 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy && (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          )}
          {busy ? "…" : "Preguntar"}
        </button>
      </form>
    </section>
  );
}
