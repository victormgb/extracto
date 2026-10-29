import path from "node:path";
import { createCanvas, DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

// pdf.js espera primitivas del DOM que Node no trae; @napi-rs/canvas las provee
const globals = globalThis as unknown as Record<string, unknown>;
globals.DOMMatrix ??= DOMMatrix;
globals.ImageData ??= ImageData;
globals.Path2D ??= Path2D;

/** Páginas renderizadas como JPEG listas para enviar a un modelo de visión. */
export type PdfPageImage = {
  mimeType: "image/jpeg";
  bytes: Buffer;
};

export type PdfConversionResult = {
  images: PdfPageImage[];
  totalPages: number;
  renderedPages: number;
};

/**
 * Ruta determinista a pdfjs-dist: el servidor arranca en la raíz del proyecto.
 * (evitamos require.resolve: Turbopack lo transforma en tiempo de build y
 * devuelve un descriptor interno en lugar de una ruta de disco)
 */
function resolvePdfjsDir(): string {
  return path.join(process.cwd(), "node_modules", "pdfjs-dist");
}

/** pdf.js exige URLs con "/" final aunque sea Windows (fs acepta "/"). */
function asFactoryUrl(dir: string): string {
  return dir.replace(/\\/g, "/") + "/";
}

/**
 * Convierte las primeras `maxPages` páginas de un PDF en imágenes JPEG
 * (los modelos de visión tipo DeepSeek solo aceptan texto + imagen).
 * Usa el soporte oficial de pdf.js para Node con @napi-rs/canvas.
 */
export async function pdfToPageImages(
  buffer: Buffer,
  maxPages: number
): Promise<PdfConversionResult> {
  const pdfjsDir = resolvePdfjsDir();

  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    // Rutas del sistema de archivos: pdf.js las lee con fs en Node
    standardFontDataUrl: asFactoryUrl(path.join(pdfjsDir, "standard_fonts")),
    cMapUrl: asFactoryUrl(path.join(pdfjsDir, "cmaps")),
    cMapPacked: true,
    wasmUrl: asFactoryUrl(path.join(pdfjsDir, "wasm")),
  });

  let totalPages = 0;
  const images: PdfPageImage[] = [];

  try {
    const document = await loadingTask.promise;
    totalPages = document.numPages;
    const pagesToRender = Math.min(totalPages, Math.max(1, maxPages));

    for (let pageNumber = 1; pageNumber <= pagesToRender; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });

      // Buena calidad de OCR sin pasarnos: hasta ~2000 px por lado
      const scale = Math.max(0.5, Math.min(2, 2000 / base.width, 2000 / base.height));
      const viewport = page.getViewport({ scale });

      const canvas = createCanvas(
        Math.max(1, Math.round(viewport.width)),
        Math.max(1, Math.round(viewport.height))
      );
      const context = canvas.getContext("2d");

      // El JPEG no admite transparencia: fondo blanco
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);

      const renderTask = page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
        background: "#ffffff",
      });
      await renderTask.promise;

      images.push({ mimeType: "image/jpeg", bytes: canvas.toBuffer("image/jpeg", 85) });
      page.cleanup();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`No se pudo convertir el PDF a imágenes: ${message}`);
  } finally {
    await loadingTask.destroy().catch(() => {});
  }

  return { images, totalPages, renderedPages: images.length };
}
