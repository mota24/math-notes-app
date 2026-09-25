import { drawStroke } from './draw';
import { strokeBBox } from './geometry';
import type { BBox, Stroke } from './types';

/**
 * Capture rectangulaire (Lasso de capture) : reproduit EXACTEMENT ce qui se voit sur cette zone de la page —
 * fond (PDF/photo) et tous les traits sans exception, comme une capture d'écran locale. Fond transparent si la
 * page n'a pas de PDF/photo, pour pouvoir reposer la capture ailleurs sans cacher ce qu'il y a dessous.
 */
export function rasterizeRegion(options: {
  strokes: Stroke[];
  page: { width: number; height: number };
  background: HTMLCanvasElement | null;
  region: BBox;
}): { dataUrl: string } {
  const { strokes, page, background, region } = options;
  const wmm = Math.max(0.5, region.maxX - region.minX);
  const hmm = Math.max(0.5, region.maxY - region.minY);
  const k = Math.min(16, Math.max(4, 1800 / Math.max(wmm, hmm)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(wmm * k));
  canvas.height = Math.max(1, Math.round(hmm * k));
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(k, 0, 0, k, -region.minX * k, -region.minY * k);
  ctx.imageSmoothingQuality = 'high';
  if (background) ctx.drawImage(background, 0, 0, page.width, page.height);
  for (const s of strokes) {
    const bb = strokeBBox(s);
    if (bb.maxX < region.minX || bb.minX > region.maxX || bb.maxY < region.minY || bb.minY > region.maxY) continue;
    drawStroke(ctx, s);
  }
  const dataUrl = background ? canvas.toDataURL('image/jpeg', 0.92) : canvas.toDataURL('image/png');
  canvas.width = 0; // mémoire rendue tout de suite (tablette)
  return { dataUrl };
}
