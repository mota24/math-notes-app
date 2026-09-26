import { db } from '../db/db';
import { lruGet, lruSet } from '../lru';
import type { Page } from '../db/schema';
import { pdfTextItems, renderPdfPage } from '../pdf/pdfjs';
import { recognize } from './engine';
import { fromPdfItems, hasRealText } from './textModel';
import type { PageText } from './textModel';

/**
 * Le texte du fond d'une page (PDF ou photo). D'abord le texte déjà présent dans le PDF — instantané et exact —,
 * et seulement pour un scan, la lecture de l'image (OCR). Le résultat est gardé : en mémoire pour la session,
 * et sur l'appareil (Cache Storage, à part du cache de l'appli) pour ne jamais relire deux fois la même page.
 * Un fichier ne change jamais de contenu : la clé (fichier + page) suffit.
 */

const CACHE = 'notes-maths-texte';
/** À changer si l'extraction change : les pages seront relues */
const VERSION = 3;
/** Résolution de lecture d'un scan : 200 points par pouce, le bon compromis précision / mémoire de Tesseract */
const OCR_PX_PER_MM = 200 / 25.4;
/** Photo trop grande : réduite (la lecture d'une image de 48 Mpx saturerait la mémoire de la tablette) */
const MAX_PIXELS = 12_000_000;

export type TextSource = Pick<Page, 'pdf' | 'image'>;

/** La clé du texte d'une page, ou null si elle n'a pas de fond à lire */
export function textKey(page: TextSource): string | null {
  if (page.pdf) return `pdf-${page.pdf.fileId}-${page.pdf.pageIndex}`;
  if (page.image) return `image-${page.image.fileId}`;
  return null;
}

const cacheUrl = (key: string) => new URL(`/texte/v${VERSION}/${encodeURIComponent(key)}.json`, location.origin).href;

/** Pages lues gardées en mémoire (les autres restent sur l'appareil, dans le Cache Storage) */
const MEMORY_PAGES = 200;

/**
 * Une fois par session : les textes lus avec une version précédente de l'extraction sont retirés de l'appareil.
 * Avant, chaque changement de version laissait les anciens en place pour toujours.
 */
let pruned = false;
function pruneOldVersions() {
  if (pruned || typeof caches === 'undefined') return;
  pruned = true;
  void caches
    .open(CACHE)
    .then(async (cache) => {
      for (const request of await cache.keys()) if (!request.url.includes(`/texte/v${VERSION}/`)) await cache.delete(request);
    })
    .catch(() => undefined);
}

async function fromCache(key: string): Promise<PageText | null> {
  try {
    if (typeof caches === 'undefined') return null;
    const hit = await (await caches.open(CACHE)).match(cacheUrl(key));
    return hit ? ((await hit.json()) as PageText) : null;
  } catch {
    return null;
  }
}

async function toCache(key: string, text: PageText) {
  try {
    if (typeof caches === 'undefined') return;
    await (await caches.open(CACHE)).put(cacheUrl(key), new Response(JSON.stringify(text), { headers: { 'Content-Type': 'application/json' } }));
  } catch {
    /* stockage plein : la page sera relue la prochaine fois */
  }
}

async function photoForOcr(fileId: string): Promise<HTMLCanvasElement> {
  const file = await db.getFile(fileId);
  if (!file) throw new Error('Photo introuvable sur cet appareil (pas encore synchronisée ?)');
  const bitmap = await createImageBitmap(file.blob);
  try {
    const k = Math.min(1, Math.sqrt(MAX_PIXELS / (bitmap.width * bitmap.height)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * k);
    canvas.height = Math.round(bitmap.height * k);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    bitmap.close();
  }
}

async function extract(page: TextSource): Promise<PageText | null> {
  let image: HTMLCanvasElement;
  if (page.pdf) {
    const { fileId, pageIndex } = page.pdf;
    const native = await pdfTextItems(fileId, pageIndex);
    const words = fromPdfItems(native.items, native.width, native.height);
    if (hasRealText(words)) return { source: 'pdf', words };
    image = await renderPdfPage(fileId, pageIndex, OCR_PX_PER_MM);
  } else if (page.image) {
    image = await photoForOcr(page.image.fileId);
  } else return null;
  try {
    return { source: 'ocr', words: await recognize(image) };
  } finally {
    // Libère tout de suite la mémoire de l'image (plusieurs Mo)
    image.width = 0;
    image.height = 0;
  }
}

const memory = new Map<string, Promise<PageText | null>>();
const done = new Map<string, PageText | null>();

/** Le texte déjà connu d'une page (sans rien lancer) : undefined s'il n'a pas encore été lu */
export function knownText(page: TextSource): PageText | null | undefined {
  const key = textKey(page);
  return key ? lruGet(done, key) : null;
}

/** Le texte d'une page ; lu (et gardé) au premier appel. null : page sans fond. */
export function pageText(page: TextSource): Promise<PageText | null> {
  const key = textKey(page);
  if (!key) return Promise.resolve(null);
  pruneOldVersions();
  let text = lruGet(memory, key);
  if (!text) {
    text = (async () => {
      const cached = await fromCache(key);
      if (cached) return cached;
      const read = await extract(page);
      if (read) await toCache(key, read);
      return read;
    })();
    lruSet(memory, key, text, MEMORY_PAGES);
    text.then(
      (t) => lruSet(done, key, t, MEMORY_PAGES),
      () => memory.delete(key), // échec (fichier pas encore arrivé, moteur injoignable) : on pourra réessayer
    );
  }
  return text;
}
