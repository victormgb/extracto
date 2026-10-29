"use client";

import { useEffect, useState } from "react";
import ChatPanel from "@/components/chat-panel";
import DocumentCard from "@/components/document-card";
import DocumentDetail from "@/components/document-detail";
import SavedList from "@/components/saved-list";
import UploadArea from "@/components/upload-area";
import type {
  ChatMessage,
  ChatResponse,
  ChatTurn,
  DocumentDTO,
  DocumentType,
  DocumentsResponse,
  ExtractResponse,
  MutationResponse,
  PendingFile,
  UpdateResponse,
  UploadResponse,
} from "@/lib/types";

type Props = {
  maxUploadMB: number;
};

export default function ExtractoApp({ maxUploadMB }: Props) {
  const [documents, setDocuments] = useState<DocumentDTO[]>([]);
  const [pending, setPending] = useState<PendingFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [extractingId, setExtractingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatBusy, setChatBusy] = useState(false);

  const selectedDoc =
    documents.find((document) => document.id === selectedId) ?? null;

  const savedDocs = documents
    .filter((document) => document.saved)
    .sort((a, b) => (b.savedAt ?? "").localeCompare(a.savedAt ?? ""));

  const indexedCount = documents.filter(
    (document) => document.hasEmbedding
  ).length;

  // Carga inicial de documentos (solo en el navegador)
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/documents");
        const data: DocumentsResponse = await res
          .json()
          .catch(() => ({ error: "Respuesta no válida del servidor" }));
        if (cancelled) return;
        if (!res.ok || !("documents" in data) || !data.documents) {
          throw new Error(
            "error" in data && data.error
              ? data.error
              : "No se pudo cargar la lista de documentos"
          );
        }
        setDocuments(data.documents);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "No se pudo cargar la lista"
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelect = (file: File) => {
    setError(null);
    setWarning(null);
    setNotice(null);

    const isImage = file.type.startsWith("image/");
    const isPdf = file.type === "application/pdf";

    if (!isImage && !isPdf) {
      setError("Solo se aceptan archivos de imagen o PDF.");
      return;
    }
    if (file.size === 0) {
      setError("El archivo está vacío.");
      return;
    }
    if (file.size > maxUploadMB * 1024 * 1024) {
      setError(`El archivo supera el límite de ${maxUploadMB} MB.`);
      return;
    }

    // La blob URL se crea aquí (event handler), no en un effect
    if (pending) URL.revokeObjectURL(pending.previewUrl);
    setPending({ file, previewUrl: URL.createObjectURL(file) });
  };

  const clearPending = () => {
    if (pending) URL.revokeObjectURL(pending.previewUrl);
    setPending(null);
  };

  /** Lleva la vista al panel de detalle (fuera de un effect: solo en acciones). */
  const scrollToDetail = () =>
    requestAnimationFrame(() =>
      document
        .getElementById("detalle")
        ?.scrollIntoView({ behavior: "smooth", block: "start" })
    );

  /**
   * Envía el archivo al LLM de visión, guarda el JSON en Postgres y abre el
   * detalle del documento con los datos extraídos.
   */
  const handleExtract = async (doc: DocumentDTO) => {
    if (extractingId) return;

    setError(null);
    setWarning(null);
    setExtractingId(doc.id);

    try {
      const res = await fetch(`/api/documents/${doc.id}/extract`, {
        method: "POST",
      });
      const data: ExtractResponse = await res.json().catch(() => ({
        error: "Respuesta no válida del servidor",
      } as ExtractResponse));

      if (!res.ok || !("document" in data) || !data.document) {
        throw new Error(
          "error" in data && data.error
            ? data.error
            : "No se pudo extraer el documento"
        );
      }

      const analyzed = data.document;
      setDocuments((prev) =>
        prev.map((item) => (item.id === analyzed.id ? analyzed : item))
      );
      setSelectedId(analyzed.id);
      scrollToDetail();
      setNotice(
        `«${analyzed.originalName}» analizado: ${
          analyzed.documentType ?? "otro"
        }.`
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Error al extraer el documento"
      );
    } finally {
      setExtractingId(null);
    }
  };

  const handleOpen = (doc: DocumentDTO) => {
    setSelectedId(doc.id);
    scrollToDetail();
  };

  /** Guarda los datos corregidos en el formulario (validados con Zod). */
  const handleSave = async (
    json: Record<string, unknown>,
    tipo: DocumentType
  ) => {
    if (!selectedDoc || savingId) return;

    setError(null);
    setWarning(null);
    setNotice(null);
    setSavingId(selectedDoc.id);

    try {
      const res = await fetch(`/api/documents/${selectedDoc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentType: tipo, extractedJson: json }),
      });
      const data: UpdateResponse = await res.json().catch(() => ({
        error: "Respuesta no válida del servidor",
      } as UpdateResponse));

      if (!res.ok || !("document" in data) || !data.document) {
        const issues =
          "issues" in data && data.issues?.length
            ? ` — ${data.issues
                .slice(0, 3)
                .map((issue) => `${issue.path}: ${issue.message}`)
                .join(" · ")}`
            : "";
        throw new Error(
          ("error" in data && data.error
            ? data.error
            : "No se pudieron guardar los cambios") + issues
        );
      }

      const updated = data.document;
      setDocuments((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item))
      );
      setNotice(`Cambios guardados en «${updated.originalName}».`);
      if (data.warning) {
        // Guardado, pero el embedding falló (p. ej. sin créditos o sin red)
        setWarning(data.warning);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Error al guardar los cambios"
      );
    } finally {
      setSavingId(null);
    }
  };

  /** Pregunta al chat semántico (embeddings → pgvector → LLM con citas). */
  const handleAsk = async (question: string) => {
    if (chatBusy) return;

    const history: ChatTurn[] = chatMessages
      .slice(-8)
      .map(({ role, content }) => ({ role, content }));

    setChatMessages((previous) => [
      ...previous,
      { role: "user", content: question },
    ]);
    setChatBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history }),
      });
      const data: ChatResponse = await res.json().catch(() => ({
        error: "Respuesta no válida del servidor",
      } as ChatResponse));

      if (!res.ok || !("answer" in data) || !data.answer) {
        throw new Error(
          "error" in data && data.error
            ? data.error
            : "No se pudo obtener una respuesta"
        );
      }

      const answer = data.answer;
      const sources = "sources" in data && data.sources ? data.sources : [];
      const sql = "sql" in data && data.sql ? data.sql : undefined;
      setChatMessages((previous) => [
        ...previous,
        { role: "assistant", content: answer, sources, ...(sql ? { sql } : {}) },
      ]);
    } catch (err) {
      setChatMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          content: `⚠ ${err instanceof Error ? err.message : "Error al preguntar"}`,
        },
      ]);
    } finally {
      setChatBusy(false);
    }
  };

  /** Chip de fuente del chat → abre el detalle del documento. */
  const handleOpenSource = (id: string) => {
    const doc = documents.find((document) => document.id === id);
    if (doc) {
      handleOpen(doc);
    } else {
      setError("Ese documento ya no existe.");
    }
  };

  const handleUpload = async () => {
    if (!pending || uploading) return;

    setUploading(true);
    setError(null);
    setWarning(null);
    setNotice(null);

    try {
      const formData = new FormData();
      formData.append("file", pending.file);

      const res = await fetch("/api/documents", {
        method: "POST",
        body: formData,
      });
      const data: UploadResponse = await res.json().catch(() => ({
        error: "Respuesta no válida del servidor",
      } as UploadResponse));

      if (!res.ok || !("document" in data) || !data.document) {
        throw new Error(
          "error" in data && data.error
            ? data.error
            : "No se pudo subir el archivo"
        );
      }

      const uploaded = data.document;
      setDocuments((prev) => [uploaded, ...prev]);
      setNotice(`«${uploaded.originalName}» se subió correctamente.`);
      clearPending();
      // Análisis automático con el LLM de visión (los errores se muestran solos)
      void handleExtract(uploaded);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al subir el archivo");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (doc: DocumentDTO) => {
    if (deletingId) return;
    setError(null);
    setWarning(null);
    setNotice(null);
    setDeletingId(doc.id);

    try {
      const res = await fetch(`/api/documents/${doc.id}`, {
        method: "DELETE",
      });
      const data: MutationResponse = await res.json().catch(() => ({
        error: "Respuesta no válida del servidor",
      } as MutationResponse));

      if (!res.ok || !("ok" in data)) {
        throw new Error(
          "error" in data && data.error
            ? data.error
            : "No se pudo eliminar el documento"
        );
      }

      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
      setSelectedId((current) => (current === doc.id ? null : current));
      setNotice(`«${doc.originalName}» se eliminó.`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Error al eliminar el documento"
      );
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="border-b border-zinc-200 bg-white/70 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/70">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-6 py-6">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
            >
              <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
              <path d="M14 3v5h5M9 13h6M9 17h4" />
            </svg>
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Extracto</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Sube imágenes o PDFs · se guardan en disco y en PostgreSQL con
              pgvector
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8">
        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300"
          >
            {error}
          </div>
        )}
        {warning && (
          <div
            role="status"
            className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300"
          >
            ⚠ {warning}
          </div>
        )}
        {notice && (
          <div
            role="status"
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300"
          >
            {notice}
          </div>
        )}

        <UploadArea
          pending={pending}
          maxUploadMB={maxUploadMB}
          uploading={uploading}
          onSelect={handleSelect}
          onClear={clearPending}
          onUpload={handleUpload}
        />

        {selectedDoc && (
          <DocumentDetail
            key={`${selectedDoc.id}|${selectedDoc.extractedAt ?? ""}`}
            doc={selectedDoc}
            saving={savingId === selectedDoc.id}
            extracting={extractingId === selectedDoc.id}
            onSave={handleSave}
            onExtract={handleExtract}
            onClose={() => setSelectedId(null)}
          />
        )}

        <section className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-base font-semibold">Documentos</h2>
            <span className="text-sm text-zinc-500 dark:text-zinc-400">
              {documents.length} en total
            </span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white py-12 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-emerald-600" />
              Cargando documentos…
            </div>
          ) : documents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-300 bg-white py-12 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
              Aún no hay documentos. Sube tu primera imagen o PDF.
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {documents.map((doc) => (
                <DocumentCard
                  key={doc.id}
                  doc={doc}
                  deleting={deletingId === doc.id}
                  extracting={extractingId === doc.id}
                  locked={extractingId !== null && extractingId !== doc.id}
                  onDelete={handleDelete}
                  onExtract={handleExtract}
                  onOpen={handleOpen}
                />
              ))}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-base font-semibold">Documentos guardados</h2>
            <span className="text-sm text-zinc-500 dark:text-zinc-400">
              {savedDocs.length} confirmados
            </span>
          </div>
          <SavedList documents={savedDocs} onOpen={handleOpen} />
        </section>

        <ChatPanel
          messages={chatMessages}
          busy={chatBusy}
          indexedCount={indexedCount}
          onAsk={handleAsk}
          onOpenSource={handleOpenSource}
        />
      </main>

      <footer className="mx-auto w-full max-w-4xl px-6 pb-8 text-xs text-zinc-400 dark:text-zinc-500">
        Extracto · Next.js + PostgreSQL (pgvector)
      </footer>
    </div>
  );
}
