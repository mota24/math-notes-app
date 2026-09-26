import { coverKey } from '../components/libraryModel';
import type { CoverSource } from '../components/libraryModel';
import { db } from '../db/db';
import { lruGet, lruSet } from '../lru';
import { renderPdfThumbnail } from './pdfjs';

/**
 * Les couvertures des cahiers dans la bibliothèque : la première page du PDF (ou la photo de fond), en petite
 * image JPEG. Rendue une seule fois par fichier et par page, puis gardée sur l'appareil (Cache Storage, à part
 * du cache de l'appli que le service worker nettoie) : les visites suivantes ne relisent ni ne redécodent le PDF.
 * Les rendus passent un par un : ouvrir une bibliothèque de vingt PDF n'en charge pas vingt à la fois en mémoire.
 */

const CACHE = 'notes-maths-couvertures';
/** Largeur des miniatures, en pixels : une carte fait au plus ~300 px de large, écran à haute densité compris */
const WIDTH = 480;
/** À changer si le rendu des miniatures change : les anciennes seront refaites */
const VERSION = 1;

const cacheUrl = (key: string) => new URL(`/couvertures/v${VERSION}/${encodeURIComponent(key)}.jpg`, location.origin).href;

async function fromCache(key: string): Promise<Blob | null> {
  try {
    if (typeof caches === 'undefined') return null;
    const hit = await (await caches.open(CACHE)).match(cacheUrl(key));
    return hit ? await hit.blob() : null;
  } catch {
    return null;
  }
}

async function toCache(key: string, blob: Blob): Promise<void> {
  try {
    if (typeof caches === 'undefined') return;
    await (await caches.open(CACHE)).put(cacheUrl(key), new Response(blob, { headers: { 'Content-Type': 'image/jpeg' } }));
  } catch {
    /* stockage plein ou indisponible : la miniature sera refaite à la prochaine visite */
  }
}

const toJpeg = (canvas: HTMLCanvasElement) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82)).finally(() => {
    // Libère tout de suite la mémoire du canevas (la tablette en a peu)
    canvas.width = 0;
    canvas.height = 0;
  });

async function render(source: CoverSource): Promise<Blob | null> {
  if (source.kind === 'pdf') return toJpeg(await renderPdfThumbnail(source.fileId, source.pageIndex, WIDTH));
  const file = await db.getFile(source.fileId);
  if (!file) return null;
  const bitmap = await createImageBitmap(file.blob);
  try {
    const scale = Math.min(1, WIDTH / bitmap.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return toJpeg(canvas);
  } finally {
    bitmap.close();
  }
}

/** Une seule miniature rendue à la fois */
let queue: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

/**
 * Adresse locale (blob:) des miniatures prêtes, bornée : au-delà, la plus ancienne est libérée (une image déjà
 * affichée le reste ; une carte réaffichée plus tard redemande sa miniature, relue en un instant sur l'appareil)
 */
const ready = new Map<string, Promise<string | null>>();
const READY_MAX = 150;
const release = (url: Promise<string | null>) => void url.then((u) => u && URL.revokeObjectURL(u)).catch(() => undefined);

/** Une fois par session : les miniatures d'une version précédente du rendu sont retirées de l'appareil */
let pruned = false;
function pruneOldVersions() {
  if (pruned || typeof caches === 'undefined') return;
  pruned = true;
  void caches
    .open(CACHE)
    .then(async (cache) => {
      for (const request of await cache.keys()) if (!request.url.includes(`/couvertures/v${VERSION}/`)) await cache.delete(request);
    })
    .catch(() => undefined);
}

/**
 * L'image de couverture de `source`, ou `null` si elle ne peut pas être faite (fichier pas encore arrivé sur
 * l'appareil, PDF illisible) : la carte garde alors son visuel dégradé, et un prochain affichage réessaiera.
 */
export function coverUrl(source: CoverSource): Promise<string | null> {
  const key = coverKey(source);
  pruneOldVersions();
  let url = lruGet(ready, key);
  if (!url) {
    url = (async () => {
      const cached = await fromCache(key);
      if (cached) return URL.createObjectURL(cached);
      const blob = await oneAtATime(() => render(source));
      if (!blob) return null;
      await toCache(key, blob);
      return URL.createObjectURL(blob);
    })().catch(() => null);
    lruSet(ready, key, url, READY_MAX, release);
    void url.then((u) => {
      if (!u) ready.delete(key);
    });
  }
  return url;
}
