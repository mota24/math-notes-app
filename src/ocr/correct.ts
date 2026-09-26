import { db } from '../db/db';
import type { Page } from '../db/schema';
import { fitTextBox } from '../ink/draw';
import { TEXT_LINE_HEIGHT, textPadding } from '../ink/textLayout';
import { newId } from '../ink/types';
import type { BBox, Stroke } from '../ink/types';
import { renderPdfRegion } from '../pdf/pdfjs';
import { correctionLayout, toHex, wordsInRegion } from './correctionModel';
import type { EraseResult, Rect } from './inpaint';
import type { EraseJob } from './inpaint.worker';
import { pageText } from './pageText';

/**
 * « Corriger le texte » d'une zone choisie au lasso sur un PDF scanné ou une photo :
 *  1. le texte de la zone est lu (OCR de la page, déjà en cache s'il a servi) ;
 *  2. son encre est effacée dans une RUSTINE — une image posée sur la page, comme un calque : le scan d'origine
 *     n'est jamais modifié, supprimer la rustine le fait réapparaître tel quel ;
 *  3. une zone de texte est posée par-dessus, à la hauteur des lettres d'origine et de la couleur de leur encre,
 *     pré-remplie avec le texte lu, prête à être corrigée.
 * Le rendu du morceau de page et l'effacement se font hors du fil de l'interface (pdf.js, Web Worker).
 */

/** Finesse de la rustine : 12 px/mm (~300 dpi), réduite si la zone est très grande (mémoire de la tablette) */
const PX_PER_MM = 12;
const MAX_PIXELS = 4_000_000;
/** Papier gardé autour des mots pour connaître sa couleur et son grain (mm) */
const CONTEXT_MM = 2.5;

let worker: Worker | null = null;
let idle = 0;
let nextId = 1;

function erase(job: Omit<EraseJob, 'id'>): Promise<EraseResult> {
  worker ??= new Worker(new URL('./inpaint.worker.ts', import.meta.url), { type: 'module' });
  window.clearTimeout(idle);
  const w = worker;
  const id = nextId++;
  return new Promise<EraseResult>((resolve, reject) => {
    const onMessage = (e: MessageEvent<{ id: number; ok: boolean; error?: string } & EraseResult>) => {
      if (e.data.id !== id) return;
      w.removeEventListener('message', onMessage);
      if (e.data.ok) resolve(e.data);
      else reject(new Error(e.data.error ?? 'Effacement impossible.'));
    };
    w.addEventListener('message', onMessage);
    w.postMessage({ ...job, id }, [job.data.buffer]);
  }).finally(() => {
    // Libéré après une minute sans correction
    idle = window.setTimeout(() => {
      worker?.terminate();
      worker = null;
    }, 60_000);
  });
}

/** Le fond de la page sur ce morceau (mm), à `px` pixels par mm */
async function backgroundCrop(page: Page, crop: Rect, px: number): Promise<HTMLCanvasElement> {
  const part = { x: crop.x / page.width, y: crop.y / page.height, w: crop.w / page.width, h: crop.h / page.height };
  if (page.pdf) return renderPdfRegion(page.pdf.fileId, page.pdf.pageIndex, px, part);
  if (!page.image) throw new Error('Cette page n’a ni PDF ni photo.');
  const file = await db.getFile(page.image.fileId);
  if (!file) throw new Error('Photo introuvable sur cet appareil (pas encore synchronisée ?)');
  const bitmap = await createImageBitmap(file.blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(crop.w * px));
    canvas.height = Math.max(1, Math.round(crop.h * px));
    // La photo est étirée sur toute la page : même correspondance ici
    canvas
      .getContext('2d')!
      .drawImage(bitmap, part.x * bitmap.width, part.y * bitmap.height, part.w * bitmap.width, part.h * bitmap.height, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    bitmap.close();
  }
}

export interface Correction {
  /** Rustine (image) ; null si aucune encre n'a été trouvée à effacer */
  patch: Stroke | null;
  /** Zone de texte pré-remplie */
  text: Stroke;
}

/** Prépare la correction de la zone `region` (mm) de `page`. null : aucun texte lu dans la zone. */
export async function prepareCorrection(page: Page, region: BBox, progress: (message: string) => void): Promise<Correction | null> {
  progress('Lecture du texte de la zone…');
  const read = await pageText(page);
  const layout = read ? correctionLayout(wordsInRegion(read.words, page, region), page, read.words) : null;
  if (!layout) return null;

  progress('Effacement du texte d’origine…');
  const { box } = layout;
  const cx0 = Math.max(0, box.x - CONTEXT_MM);
  const cy0 = Math.max(0, box.y - CONTEXT_MM);
  const crop = { x: cx0, y: cy0, w: Math.min(page.width, box.x + box.w + CONTEXT_MM) - cx0, h: Math.min(page.height, box.y + box.h + CONTEXT_MM) - cy0 };
  const px = Math.min(PX_PER_MM, Math.sqrt(MAX_PIXELS / (crop.w * crop.h)));
  const canvas = await backgroundCrop(page, crop, px);
  const { width, height } = canvas;
  const data = canvas.getContext('2d')!.getImageData(0, 0, width, height).data;
  canvas.width = 0; // mémoire rendue tout de suite
  const toPx = (r: Rect): Rect => ({ x: (r.x - crop.x) * px, y: (r.y - crop.y) * px, w: r.w * px, h: r.h * px });
  const patchPx = toPx(box);
  const result = await erase({ data, width, height, words: layout.wordBoxes.map(toPx), patch: patchPx, halo: Math.max(1, Math.round(0.12 * px)) });

  let patch: Stroke | null = null;
  if (result.inkPixels > 0) {
    const pw = Math.max(1, Math.min(width - Math.max(0, Math.floor(patchPx.x)), Math.round(patchPx.w)));
    const ph = Math.max(1, Math.min(height - Math.max(0, Math.floor(patchPx.y)), Math.round(patchPx.h)));
    const out = document.createElement('canvas');
    out.width = pw;
    out.height = ph;
    out.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(result.pixels), pw, ph), 0, 0);
    // JPEG de haute qualité : dix fois plus léger qu'un PNG pour du papier numérisé (la page reste légère à synchroniser)
    const image = out.toDataURL('image/jpeg', 0.92);
    out.width = 0;
    const x = crop.x + Math.max(0, Math.floor(patchPx.x)) / px;
    const y = crop.y + Math.max(0, Math.floor(patchPx.y)) / px;
    patch = { id: newId(), tool: 'image', image, points: [[x, y, 1], [x + pw / px, y + ph / px, 1]], color: '#000000', size: 0, input: 'mouse' };
  }

  const size = layout.size;
  const pad = textPadding(size);
  // Le haut des lettres de la première ligne tombe là où étaient les lettres d'origine ; la zone garde sa marge
  // intérieure au-dessus et au-dessous (accents, lettres montantes et descendantes ont la place de respirer)
  const top = Math.max(0, layout.firstLineTop - pad - ((TEXT_LINE_HEIGHT - 1) / 2) * size);
  const left = Math.max(0, layout.left - pad);
  // Nettement plus large que le texte lu : une correction un peu plus longue tient encore sur la même ligne
  const textWidth = Math.min(page.width - left, Math.max(15, layout.width * 1.35 + 2 * pad + size));
  const text = fitTextBox({
    id: newId(),
    tool: 'text',
    text: layout.text,
    points: [[left, top, 0.5], [left + textWidth, top + 1, 0.5]],
    color: result.inkPixels > 0 ? toHex(result.ink) : '#1d2433',
    size,
    input: 'mouse',
  });
  return { patch, text };
}
