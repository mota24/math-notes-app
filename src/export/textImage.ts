import { drawStroke } from '../ink/draw';
import { TEXT_FONT, fontCss } from '../ink/textLayout';
import type { Stroke } from '../ink/types';

/** ~300 dpi : net à l'impression */
const PX_PER_MM = 12;
const MAX_SIDE = 6000;

/**
 * Une zone de texte pour le PDF : son texte rendu en PNG transparent, à la taille exacte de sa boîte (sans sa
 * rotation, que le PDF applique lui-même). Même police et mêmes retours à la ligne qu'à l'écran, et tous les
 * caractères passent (≠, θ, ∫…), ce que les polices standard d'un PDF ne savent pas afficher.
 */
export async function textStrokePng(s: Stroke): Promise<Uint8Array | null> {
  if (s.tool !== 'text' || !s.text || s.points.length < 2) return null;
  // La vraie police, pas celle de secours (un canevas ne la fait pas charger tout seul)
  await document.fonts?.load(`100px ${TEXT_FONT}`).catch(() => undefined);
  // …et la police assortie au document (Tinos, Arimo, Cousine), si la zone en a une
  if (s.family) await document.fonts?.load(fontCss(s, 100)).catch(() => undefined);
  const [a, b] = s.points;
  const x0 = Math.min(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]);
  const w = Math.max(1, Math.abs(b[0] - a[0]));
  const h = Math.max(1, Math.abs(b[1] - a[1]));
  const k = Math.min(PX_PER_MM, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * k);
  canvas.height = Math.ceil(h * k);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
  // Copie sans rotation : mise en page recalculée avec la vraie police, rotation appliquée par le PDF
  drawStroke(ctx, { ...s, angle: undefined });
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  canvas.width = 0;
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}
