import { db } from '../db/db';
import { updateNotebook } from '../db/library';
import type { Page } from '../db/schema';
import { auth, getFirestoreDb } from '../firebase';
import { pageBackground } from '../ink/background';
import { SHARE_VERSION, bgKey, newShareId, planShare, toSharedPage } from './plan';
import type { ShareDoc } from './plan';

/**
 * Partage d'un cahier en LECTURE SEULE par lien secret (côté propriétaire). Voir plan.ts pour le format, et
 * firestore.rules : tout le monde peut LIRE un partage dont il connaît l'identifiant, personne ne peut lister
 * les partages, et seul le compte qui l'a créé peut l'écrire ou le supprimer.
 */

/** Firestore refuse un document de plus de 1 Mio : on garde une marge */
const MAX_DOC = 950_000;
/** Et une requête d'écriture groupée de plus de 10 Mio */
const MAX_BATCH_BYTES = 8_000_000;
const MAX_BATCH_OPS = 400;

export type ShareProgress = (message: string) => void;

export function shareUrl(shareId: string): string {
  return `${location.origin}/share/${shareId}`;
}

/** Un message qui dit quoi faire, plutôt qu'un code d'erreur Firebase */
export function shareErrorMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  if (/permission-denied/.test(code))
    return 'Firestore refuse l’écriture. Publie les règles à jour (fichier firestore.rules du projet) dans la console Firebase → Firestore Database → Règles.';
  if (/unavailable|deadline-exceeded/.test(code)) return 'Pas de connexion à Firestore pour l’instant. Réessaie une fois en ligne.';
  if (/not-found|failed-precondition/.test(code)) return 'Firestore n’est pas activé pour ce projet (console Firebase → Firestore Database → Créer une base).';
  if (/resource-exhausted/.test(code)) return 'Quota gratuit de Firestore atteint pour aujourd’hui. Réessaie demain.';
  return (e as Error)?.message || 'Partage impossible.';
}

function requireUid(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Connecte-toi pour partager un cahier.');
  return uid;
}

async function orderedPages(notebookId: string): Promise<{ title: string; pages: Page[] }> {
  const notebook = await db.getNotebook(notebookId);
  if (!notebook) throw new Error('Cahier introuvable.');
  const byId = new Map((await db.pagesOf(notebookId)).map((p) => [p.id, p]));
  return { title: notebook.title, pages: notebook.pageIds.map((id) => byId.get(id)).filter((p): p is Page => !!p) };
}

/** Réduit les images posées sur la page (photos, captures) quand la page dépasse la taille d'un document. */
async function shrinkImages(page: Page, maxSide: number): Promise<Page> {
  const strokes = await Promise.all(
    page.strokes.map(async (s) => {
      if (s.tool !== 'image' || !s.image) return s;
      try {
        const img = new Image();
        img.src = s.image;
        await img.decode();
        const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * k));
        c.height = Math.max(1, Math.round(img.naturalHeight * k));
        const ctx = c.getContext('2d');
        if (!ctx) return s;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, c.width, c.height);
        // JPEG pour les photos ; WebP (transparence gardée) pour les formules et captures
        const jpeg = /^data:image\/jpe?g/i.test(s.image);
        return { ...s, image: jpeg ? c.toDataURL('image/jpeg', 0.7) : c.toDataURL('image/webp', 0.8) };
      } catch {
        return s;
      }
    }),
  );
  return { ...page, strokes };
}

/** La page en JSON, réduite si besoin pour tenir dans un document ; null si elle reste trop lourde. */
async function pageJson(page: Page): Promise<string | null> {
  let json = JSON.stringify(toSharedPage(page));
  for (const side of [1000, 600, 360]) {
    if (json.length <= MAX_DOC) return json;
    json = JSON.stringify(toSharedPage(await shrinkImages(page, side)));
  }
  return json.length <= MAX_DOC ? json : null;
}

/** Le fond (page de PDF ou photo) en JPEG, assez net pour lire un cours, assez léger pour un document. */
async function backgroundJpeg(page: Page): Promise<string | null> {
  for (const [pxPerMm, quality] of [
    [6, 0.72],
    [4.5, 0.62],
    [3.2, 0.55],
  ] as const) {
    const source = await pageBackground(page, pxPerMm);
    if (!source) return null;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(page.width * pxPerMm));
    c.height = Math.max(1, Math.round(page.height * pxPerMm));
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, c.width, c.height);
    const data = c.toDataURL('image/jpeg', quality);
    c.width = 0; // libère la mémoire tout de suite (tablette)
    if (data.length <= MAX_DOC) return data;
  }
  return null;
}

/** Un lot d'écritures qui se vide tout seul avant de dépasser les limites de Firestore */
async function makeBatcher() {
  const fs = await import('firebase/firestore');
  const firestore = await getFirestoreDb();
  let batch = fs.writeBatch(firestore);
  let ops = 0;
  let bytes = 0;
  const flush = async () => {
    if (ops === 0) return;
    await batch.commit();
    batch = fs.writeBatch(firestore);
    ops = 0;
    bytes = 0;
  };
  return {
    fs,
    firestore,
    async set(path: string[], data: Record<string, unknown>, size: number) {
      if (ops >= MAX_BATCH_OPS || bytes + size > MAX_BATCH_BYTES) await flush();
      batch.set(fs.doc(firestore, path.join('/')), data);
      ops++;
      bytes += size;
    },
    async remove(path: string[]) {
      if (ops >= MAX_BATCH_OPS) await flush();
      batch.delete(fs.doc(firestore, path.join('/')));
      ops++;
    },
    flush,
  };
}

/**
 * Crée ou met à jour le partage d'un cahier. N'envoie que ce qui a changé depuis la dernière fois (pages
 * modifiées, fonds nouveaux), supprime ce qui a disparu, puis met à jour le document principal en dernier :
 * le lecteur ne voit jamais un ordre de pages qui pointe vers une page pas encore envoyée.
 */
export async function publishShare(notebookId: string, shareId: string, onProgress?: ShareProgress): Promise<{ skipped: number }> {
  const uid = requireUid();
  const w = await makeBatcher();
  const { fs, firestore } = w;
  const shareRef = fs.doc(firestore, 'shares', shareId);

  onProgress?.('Connexion…');
  const snap = await fs.getDoc(shareRef);
  let remote = snap.exists() ? (snap.data() as ShareDoc) : null;
  if (remote && remote.owner !== uid) throw new Error('Ce lien appartient à un autre compte.');

  const { title, pages } = await orderedPages(notebookId);
  const t = Date.now();
  if (!remote) {
    // Le document principal d'abord (vide) : les règles vérifient le propriétaire des sous-documents sur lui
    remote = { v: SHARE_VERSION, owner: uid, notebookId, title, pageIds: [], sizes: {}, versions: {}, bgKeys: {}, createdAt: t, updatedAt: t };
    await fs.setDoc(shareRef, remote);
  }

  const plan = planShare(pages, remote);
  const versions = { ...remote.versions };
  const bgKeys = { ...remote.bgKeys };
  let skipped = 0;

  for (const [i, page] of plan.bgs.entries()) {
    onProgress?.(`Fonds de page… ${i + 1}/${plan.bgs.length}`);
    const data = await backgroundJpeg(page);
    const key = bgKey(page);
    if (!data || !key) continue;
    await w.set(['shares', shareId, 'bgs', page.id], { data, key }, data.length);
    bgKeys[page.id] = key;
  }
  for (const [i, page] of plan.pages.entries()) {
    onProgress?.(`Pages… ${i + 1}/${plan.pages.length}`);
    const json = await pageJson(page);
    if (!json) {
      skipped++;
      continue;
    }
    await w.set(['shares', shareId, 'pages', page.id], { json, updatedAt: page.updatedAt }, json.length);
    versions[page.id] = page.updatedAt;
  }
  for (const id of plan.removed) {
    await w.remove(['shares', shareId, 'pages', id]);
    await w.remove(['shares', shareId, 'bgs', id]);
    delete versions[id];
    delete bgKeys[id];
  }
  for (const id of plan.bgRemoved) {
    await w.remove(['shares', shareId, 'bgs', id]);
    delete bgKeys[id];
  }
  await w.flush();

  onProgress?.('Finalisation…');
  const sent = pages.filter((p) => versions[p.id] !== undefined);
  const next: ShareDoc = {
    v: SHARE_VERSION,
    owner: uid,
    notebookId,
    title,
    pageIds: sent.map((p) => p.id),
    sizes: Object.fromEntries(sent.map((p) => [p.id, [p.width, p.height] as [number, number]])),
    versions,
    bgKeys,
    createdAt: remote.createdAt,
    updatedAt: Date.now(),
  };
  await fs.setDoc(shareRef, next);
  return { skipped };
}

/** Crée le lien d'un cahier (et le retient dans le cahier, pour les mises à jour automatiques). */
export async function createShare(notebookId: string, onProgress?: ShareProgress): Promise<{ shareId: string; skipped: number }> {
  requireUid();
  const shareId = newShareId();
  const { skipped } = await publishShare(notebookId, shareId, onProgress);
  await updateNotebook(notebookId, { shareId });
  return { shareId, skipped };
}

/** Désactive le lien : supprime tout ce qui a été partagé, puis l'oublie dans le cahier. */
export async function deleteShare(notebookId: string, shareId: string): Promise<void> {
  cancelShareUpdate(notebookId);
  const uid = requireUid();
  const w = await makeBatcher();
  const { fs, firestore } = w;
  const shareRef = fs.doc(firestore, 'shares', shareId);
  const snap = await fs.getDoc(shareRef);
  if (snap.exists()) {
    const remote = snap.data() as ShareDoc;
    if (remote.owner !== uid) throw new Error('Ce lien appartient à un autre compte.');
    // Les sous-documents d'abord : les règles vérifient le propriétaire sur le document principal
    const ids = new Set([...remote.pageIds, ...Object.keys(remote.versions ?? {}), ...Object.keys(remote.bgKeys ?? {})]);
    for (const id of ids) {
      await w.remove(['shares', shareId, 'pages', id]);
      await w.remove(['shares', shareId, 'bgs', id]);
    }
    await w.flush();
    await fs.deleteDoc(shareRef);
  }
  await updateNotebook(notebookId, { shareId: null });
}

// ------------------------------------------------------------------ mise à jour automatique

/** Délai après la dernière modification avant d'actualiser le lien (économie d'écritures) */
const AUTO_DELAY = 15_000;
const timers = new Map<string, { timer: number; shareId: string }>();
const running = new Map<string, Promise<unknown>>();

function runUpdate(notebookId: string, shareId: string) {
  const previous = running.get(notebookId) ?? Promise.resolve();
  // Une mise à jour à la fois par cahier ; un échec (hors ligne…) sera rattrapé par la prochaine modification
  const next = previous.then(() => publishShare(notebookId, shareId)).catch(() => undefined);
  running.set(notebookId, next);
  void next.finally(() => running.get(notebookId) === next && running.delete(notebookId));
}

/** À appeler après chaque enregistrement d'un cahier partagé : le lien suit, sans écrire à chaque trait. */
export function scheduleShareUpdate(notebookId: string, shareId: string) {
  const pending = timers.get(notebookId);
  if (pending) window.clearTimeout(pending.timer);
  const timer = window.setTimeout(() => {
    timers.delete(notebookId);
    if (navigator.onLine) runUpdate(notebookId, shareId);
  }, AUTO_DELAY);
  timers.set(notebookId, { timer, shareId });
}

/** En quittant le cahier : la mise à jour en attente part tout de suite. */
export function flushShareUpdate(notebookId: string) {
  const pending = timers.get(notebookId);
  if (!pending) return;
  window.clearTimeout(pending.timer);
  timers.delete(notebookId);
  if (navigator.onLine) runUpdate(notebookId, pending.shareId);
}

function cancelShareUpdate(notebookId: string) {
  const pending = timers.get(notebookId);
  if (pending) window.clearTimeout(pending.timer);
  timers.delete(notebookId);
}
