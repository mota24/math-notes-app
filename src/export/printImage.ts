import { printRgb } from './printInk';

/** Part minimale de pixels transparents pour qu'une image soit de « l'encre » (formule, capture de traits) et non une photo */
const MIN_CLEAR_SHARE = 0.5;

/**
 * Mode impression pour une image posée sur la page (formule LaTeX, capture de traits) : ses pixels
 * clairs, faits pour le papier sombre, deviennent foncés — même règle que pour l'encre. Renvoie le PNG
 * converti, ou `null` s'il faut la garder telle quelle (photo ou capture d'un fond opaque, qu'inverser
 * noircirait).
 */
export async function printPngBytes(dataUrl: string): Promise<Uint8Array | null> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;

  let clear = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i] < 16) clear++;
  if (clear < (px.length / 4) * MIN_CLEAR_SHARE) return null;

  // Une formule n'a que quelques teintes (l'anti-crénelage ne change que la transparence) : on mémorise
  const mapped = new Map<number, number>();
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    const key = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
    let out = mapped.get(key);
    if (out === undefined) {
      const [r, g, b] = printRgb(px[i], px[i + 1], px[i + 2]);
      out = (r << 16) | (g << 8) | b;
      mapped.set(key, out);
    }
    px[i] = out >> 16;
    px[i + 1] = (out >> 8) & 255;
    px[i + 2] = out & 255;
  }
  ctx.putImageData(data, 0, 0);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}
