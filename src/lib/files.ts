import path from "path";

export const MAX_UPLOAD_BYTES = (() => {
  const mb = Number(process.env.MAX_UPLOAD_MB ?? "25");
  const safeMb = Number.isFinite(mb) && mb > 0 ? mb : 25;
  return safeMb * 1024 * 1024;
})();

export const MAX_UPLOAD_MB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));

/** Carpeta donde se guardan los archivos subidos (relativa a la raíz del proyecto). */
export function getUploadDir(): string {
  const dir = process.env.UPLOAD_DIR?.trim() || "./uploads";
  // turbopackIgnore: los uploads son datos de ejecución, no hay que incluirlos
  // en el trazado de archivos del build (evita empaquetar todo el proyecto).
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), dir);
}

const MIME_TO_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif",
  "image/svg+xml": ".svg",
  "image/bmp": ".bmp",
  "image/tiff": ".tif",
  "application/pdf": ".pdf",
};

export type AcceptedFile = {
  kind: "image" | "pdf";
  ext: string;
};

/**
 * Valida el MIME del archivo: solo imágenes y PDF.
 * Devuelve el "tipo" interno y la extensión normalizada, o null si no es aceptado.
 */
export function classifyFile(mimeType: string): AcceptedFile | null {
  const normalized = mimeType.toLowerCase().split(";")[0].trim();

  if (normalized === "application/pdf") {
    return { kind: "pdf", ext: ".pdf" };
  }

  if (normalized.startsWith("image/")) {
    const ext = MIME_TO_EXT[normalized] ?? ".bin";
    return { kind: "image", ext };
  }

  return null;
}
