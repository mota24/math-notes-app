import { db } from '../db/db';
import type { Page } from '../db/schema';
import { renderPdfPage } from '../pdf/pdfjs';

const photos = new Map<string, Promise<HTMLCanvasElement>>();

function photoCanvas(fileId: string): Promise<HTMLCanvasElement> {
  let canvas = photos.get(fileId);
  if (!canvas) {
    canvas = (async () => {
      const file = await db.getFile(fileId);
      if (!file) throw new Error('Photo introuvable sur cet appareil (pas encore synchronisée ?)');
      const bitmap = await createImageBitmap(file.blob);
      const c = document.createElement('canvas');
      c.width = bitmap.width;
      c.height = bitmap.height;
      c.getContext('2d')!.drawImage(bitmap, 0, 0);
      bitmap.close();
      return c;
    })();
    photos.set(fileId, canvas);
    canvas.catch(() => photos.delete(fileId));
    if (photos.size > 4) photos.delete(photos.keys().next().value as string);
  }
  return canvas;
}

export function hasBackground(page: Pick<Page, 'pdf' | 'image'>): boolean {
  return !!page.pdf || !!page.image;
}

/** Fond d'une page : page de PDF rendue à la résolution demandée (px par mm), ou photo. */
export async function pageBackground(page: Pick<Page, 'pdf' | 'image'>, pxPerMm: number): Promise<HTMLCanvasElement | null> {
  if (page.pdf) return renderPdfPage(page.pdf.fileId, page.pdf.pageIndex, pxPerMm);
  if (page.image) return photoCanvas(page.image.fileId);
  return null;
}
