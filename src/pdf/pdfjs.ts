import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { db } from '../db/db';

export const PT_PER_MM = 72 / 25.4;

/**
 * pdf.js (≈ 500 ko) n'est chargé qu'à la première page PDF affichée ou importée, pas au démarrage :
 * un cahier de pages blanches s'ouvre sans lui.
 */
let lib: Promise<typeof import('pdfjs-dist')> | null = null;
function pdfjs(): Promise<typeof import('pdfjs-dist')> {
  lib ??= import('pdfjs-dist').then((m) => {
    m.GlobalWorkerOptions.workerSrc = workerUrl;
    return m;
  });
  lib.catch(() => (lib = null)); // hors-ligne au premier appel : on réessaiera
  return lib;
}

const docs = new Map<string, Promise<PDFDocumentProxy>>();

async function openBytes(bytes: ArrayBuffer): Promise<PDFDocumentProxy> {
  const { getDocument } = await pdfjs();
  // pdf.js transfère le tampon au worker : on lui donne une copie
  return getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
}

/** Document PDF d'un fichier stocké (les 3 derniers restent ouverts). */
export function pdfForFile(fileId: string): Promise<PDFDocumentProxy> {
  let doc = docs.get(fileId);
  if (!doc) {
    doc = (async () => {
      const file = await db.getFile(fileId);
      if (!file) throw new Error('PDF introuvable sur cet appareil (pas encore synchronisé ?)');
      return openBytes(await file.blob.arrayBuffer());
    })();
    docs.set(fileId, doc);
    doc.catch(() => docs.delete(fileId));
    if (docs.size > 3) {
      const oldest = docs.keys().next().value as string;
      void docs.get(oldest)?.then((d) => d.loadingTask.destroy());
      docs.delete(oldest);
    }
  }
  return doc;
}

/** Taille de chaque page en mm. */
export async function pdfPageSizes(bytes: ArrayBuffer): Promise<{ width: number; height: number }[]> {
  const doc = await openBytes(bytes);
  try {
    const sizes: { width: number; height: number }[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const viewport = (await doc.getPage(i)).getViewport({ scale: 1 });
      sizes.push({ width: viewport.width / PT_PER_MM, height: viewport.height / PT_PER_MM });
    }
    return sizes;
  } finally {
    await doc.loadingTask.destroy();
  }
}

/** Rend une page à la résolution demandée (pixels par mm), plafonnée pour la mémoire de la tablette. */
export async function renderPdfPage(fileId: string, pageIndex: number, pxPerMm: number): Promise<HTMLCanvasElement> {
  const doc = await pdfForFile(fileId);
  const page = await doc.getPage(pageIndex + 1);
  const unit = page.getViewport({ scale: 1 });
  let scale = pxPerMm / PT_PER_MM;
  const maxPixels = 8_000_000;
  if (unit.width * unit.height * scale * scale > maxPixels) scale = Math.sqrt(maxPixels / (unit.width * unit.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, viewport }).promise;
  return canvas;
}
