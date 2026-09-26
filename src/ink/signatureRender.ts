import { buildPath } from './draw';
import type { Signature } from './signature';

/** Épaisseur du trait d'une signature (mm, à la taille enregistrée) */
export const SIGNATURE_PEN = 0.55;

/** Dessine la signature dans `ctx`, `scale` pixels par mm, de la couleur `color` */
export function drawSignature(ctx: CanvasRenderingContext2D, sig: Pick<Signature, 'strokes'>, scale: number, color: string) {
  ctx.save();
  ctx.scale(scale, scale);
  ctx.fillStyle = color;
  for (const s of sig.strokes) if (s.length) ctx.fill(buildPath(s, 'pen', SIGNATURE_PEN, true));
  ctx.restore();
}

/**
 * La signature en PNG transparent, pour la poser sur une page comme une image (un seul objet : elle se déplace,
 * s'agrandit et tourne d'un geste, la gomme ne l'abîme jamais). Rendue à ~300 dpi à sa taille posée : nette à
 * l'impression.
 */
export function signatureImage(sig: Signature, placedWidth: number, color: string): string {
  const pxPerMm = 12;
  const k = placedWidth / sig.width; // taille posée / taille enregistrée
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sig.width * k * pxPerMm));
  canvas.height = Math.max(1, Math.round(sig.height * k * pxPerMm));
  drawSignature(canvas.getContext('2d')!, sig, k * pxPerMm, color);
  const url = canvas.toDataURL('image/png');
  canvas.width = 0;
  return url;
}
