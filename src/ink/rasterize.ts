import { drawStroke } from './draw';
import { strokeBBox, unionBBox } from './geometry';
import type { BBox, Stroke } from './types';

export interface EncodedImage {
  dataUrl: string;
  base64: string;
  mimeType: string;
  width: number;
  height: number;
}

function encode(canvas: HTMLCanvasElement, mimeType: string, quality?: number): EncodedImage {
  const dataUrl = canvas.toDataURL(mimeType, quality);
  return {
    dataUrl,
    base64: dataUrl.slice(dataUrl.indexOf(',') + 1),
    mimeType,
    width: canvas.width,
    height: canvas.height,
  };
}

/**
 * Image envoyée à Gemini : l'encre (sans surligneur, sans quadrillage) et, si demandé, le fond de
 * la page (PDF ou photo). Sans fond, on cadre sur l'écriture ; avec un fond, sur la page ou la sélection.
 */
export function rasterizeForAi(options: {
  strokes: Stroke[];
  page: { width: number; height: number };
  background?: HTMLCanvasElement | null;
  region?: BBox | null;
}): EncodedImage | null {
  // Une image glissée sur la page est déjà une transcription : Gemini n'a pas besoin de la relire
  const ink = options.strokes.filter((s) => s.tool !== 'highlighter' && s.tool !== 'image');
  const background = options.background ?? null;
  const region = options.region ?? (background ? { minX: 0, minY: 0, maxX: options.page.width, maxY: options.page.height } : unionBBox(ink.map(strokeBBox)));
  if (!region || (!background && ink.length === 0)) return null;

  const pad = options.region || !background ? 3 : 0; // mm
  const wmm = region.maxX - region.minX + 2 * pad;
  const hmm = region.maxY - region.minY + 2 * pad;
  // ~150 dpi pour une page entière, plus fin pour une petite formule, 1800 px au plus
  // ...mais jamais plus de 16 000 px de côté : une page très longue (canevas infini) dépasserait la taille maximale d'un canevas
  const k = Math.min(16, Math.max(5, 1800 / Math.max(wmm, hmm)), 16000 / Math.max(wmm, hmm));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(wmm * k));
  canvas.height = Math.max(1, Math.round(hmm * k));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(k, 0, 0, k, (pad - region.minX) * k, (pad - region.minY) * k);
  if (background) ctx.drawImage(background, 0, 0, options.page.width, options.page.height);
  for (const s of ink) drawStroke(ctx, s);
  return background ? encode(canvas, 'image/jpeg', 0.92) : encode(canvas, 'image/png');
}

/**
 * Capture rectangulaire (Lasso de capture) : reproduit EXACTEMENT ce qui se voit sur cette zone de
 * la page — fond (PDF/photo) et tous les traits sans exception (contrairement à `rasterizeForAi`,
 * rien n'est filtré ici : c'est une vraie « capture d'écran locale »). Fond transparent si la page
 * n'a pas de PDF/photo, pour pouvoir reposer la capture ailleurs sans cacher ce qu'il y a dessous.
 */
export function rasterizeRegion(options: {
  strokes: Stroke[];
  page: { width: number; height: number };
  background: HTMLCanvasElement | null;
  region: BBox;
}): EncodedImage {
  const { strokes, page, background, region } = options;
  const wmm = Math.max(0.5, region.maxX - region.minX);
  const hmm = Math.max(0.5, region.maxY - region.minY);
  const k = Math.min(16, Math.max(4, 1800 / Math.max(wmm, hmm)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(wmm * k));
  canvas.height = Math.max(1, Math.round(hmm * k));
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(k, 0, 0, k, -region.minX * k, -region.minY * k);
  if (background) ctx.drawImage(background, 0, 0, page.width, page.height);
  for (const s of strokes) {
    const bb = strokeBBox(s);
    if (bb.maxX < region.minX || bb.minX > region.maxX || bb.maxY < region.minY || bb.minY > region.maxY) continue;
    drawStroke(ctx, s);
  }
  return background ? encode(canvas, 'image/jpeg', 0.92) : encode(canvas, 'image/png');
}

/** Photo ou capture d'écran de notes existantes, réduite à 2000 px maximum. */
export async function imageFileToEncoded(file: File): Promise<EncodedImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const ratio = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * ratio);
    canvas.height = Math.round(img.naturalHeight * ratio);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return encode(canvas, 'image/jpeg', 0.9);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Image déjà encodée en data URL (capture au lasso, formule posée) : sans dimensions connues. */
export function imageFromDataUrl(dataUrl: string): EncodedImage {
  const mimeType = dataUrl.slice(5, dataUrl.indexOf(';'));
  return { dataUrl, base64: dataUrl.slice(dataUrl.indexOf(',') + 1), mimeType, width: 0, height: 0 };
}
