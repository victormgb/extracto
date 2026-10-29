export type DocumentKind = "image" | "pdf";

/** Tipo de documento detectado por el LLM de visión. */
export type DocumentType = "factura" | "recibo" | "contrato" | "otro";

/** Archivo elegido por el usuario + su blob URL de vista previa local. */
export type PendingFile = {
  file: File;
  previewUrl: string;
};

export type DocumentDTO = {
  id: string;
  originalName: string;
  mimeType: string;
  kind: DocumentKind;
  sizeBytes: number;
  createdAt: string;
  url: string;
  documentType: DocumentType | null;
  extractedJson: Record<string, unknown> | null;
  extractedAt: string | null;
  /** true cuando se ha confirmado (datos estructurados en document_data) */
  saved: boolean;
  savedAt: string | null;
  /** true si documents.embedding está poblado */
  hasEmbedding: boolean;
};

export type UploadResponse =
  | { document: DocumentDTO; error?: never }
  | { document?: never; error: string };

export type DocumentsResponse =
  | { documents: DocumentDTO[]; error?: never }
  | { documents?: never; error: string };

export type ExtractResponse =
  | { document: DocumentDTO; error?: never }
  | { document?: never; error: string };

export type MutationResponse = { ok: true } | { error: string };

export type ValidationIssue = { path: string; message: string };

// --- Chat semántico ---

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export type ChatMessage = ChatTurn & {
  /** Solo en respuestas del asistente: documentos recuperados */
  sources?: ChatSource[];
  /** Consulta SQL ejecutada (camino de cálculos/totales) */
  sql?: string;
};

export type ChatSource = {
  id: string;
  titulo: string;
  tipo: DocumentType;
  originalName: string;
  /** Similitud de coseno — solo en la búsqueda semántica (ausente en SQL) */
  similarity?: number;
};

export type ChatResponse =
  | { answer: string; sources: ChatSource[]; sql?: string; error?: never }
  | {
      answer?: never;
      sources?: never;
      sql?: never;
      error: string;
      issues?: ValidationIssue[];
    };

export type UpdateResponse =
  | { document: DocumentDTO; warning?: string; error?: never }
  | { document?: never; error: string; issues?: ValidationIssue[] };
