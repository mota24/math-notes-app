import { db, notify } from '../db/db';
import type { Tombstone } from '../db/library';
import { isFolder, isGlyph, isNotebook, isPage, isRecord, isTodo, isTranscript } from '../db/backupFormat';
import type { Folder, Glyph, Notebook, Page, Todo, Transcript } from '../db/schema';
import { getFirestoreDb } from '../firebase';
import { byKey, mergeRecords, mergeTombstones } from './merge';

/**
 * Synchronisation temps réel via Firebase Firestore, EN OPTION et sans risque pour les données locales :
 *
 *  - Ne synchronise que les structures : dossiers, cahiers, pages (traits), transcriptions, tâches, écriture
 *    perso. Les PDF importés et les gros fichiers restent LOCAUX (jamais envoyés), comme demandé.
 *  - Économie d'écritures (plan gratuit : 20 000/jour) : les envois sont regroupés (voir QUIET_MS et
 *    MAX_WAIT_MS), et partent aussitôt quand on quitte l'éditeur ou que l'appli passe en arrière-plan.
 *    On n'écrit jamais à chaque trait.
 *  - Fusion « la plus récente gagne », entité par entité, avec le MÊME code éprouvé que la synchro Drive
 *    (mergeRecords/mergeTombstones, 212 tests). Une donnée locale n'est jamais écrasée par une version
 *    distante plus ancienne, et une suppression ne se propage que par pierre tombale.
 *  - Firestore n'accepte pas les tableaux de tableaux (or Stroke.points et Glyph.strokes en sont) : chaque
 *    entité est donc rangée en JSON (champ texte), ce qui évite aussi toute surprise de schéma.
 *  - Tout appel réseau est protégé : si Firestore n'est pas activé côté console ou si la connexion échoue,
 *    on passe en état « erreur » proprement, sans jamais planter ni toucher à la base locale.
 */

/**
 * Rythme des envois. L'ancien réglage (45 s de calme, remis à zéro à chaque modification) repoussait
 * l'envoi tant qu'on écrivait — l'éditeur enregistre la page ~600 ms après chaque trait — d'où des
 * minutes d'attente. Désormais : 4 s de calme pour regrouper une rafale de traits, mais JAMAIS plus de
 * 20 s après la première modification non envoyée. En écriture continue, cela fait au pire ~2 écritures
 * (la page + l'index) toutes les 20 s, soit ~360 par heure : très loin des 20 000 par jour du plan gratuit.
 */
const QUIET_MS = 4_000;
const MAX_WAIT_MS = 20_000;
/** Après un envoi « urgent » (sortie de l'éditeur, appli en arrière-plan), les écritures qui suivent partent aussitôt. */
const URGENT_WINDOW_MS = 2_500;
const MAX_DOC_BYTES = 1_000_000; // limite Firestore par document (1 Mio) ; on garde une marge
const BATCH_LIMIT = 400; // Firestore : 500 opérations max par lot

type GlyphRow = Glyph & { deletedAt: null };

interface RemoteIndex {
  updatedAt: number;
  folders: Folder[];
  notebooks: Notebook[];
  todos: Todo[];
  glyphs: Glyph[];
  tombstones: Record<string, Tombstone>;
}

interface DocMeta {
  updatedAt: number;
  deletedAt: number | null;
}

const EMPTY_INDEX: RemoteIndex = { updatedAt: 0, folders: [], notebooks: [], todos: [], glyphs: [], tombstones: {} };

// ------------------------------------------------------------------ état exposé à l'UI

export type FirestoreStatus = 'off' | 'unavailable' | 'signed-out' | 'connecting' | 'live' | 'error';

export interface FirestoreState {
  status: FirestoreStatus;
  error: string;
  email: string | null;
  lastPushAt: number | null;
  /** Des modifications locales attendent d'être envoyées */
  pending: boolean;
  /** Un envoi est en cours */
  syncing: boolean;
  skippedHeavy: number; // pages trop lourdes (images embarquées) non envoyées
}

let state: FirestoreState = { status: 'off', error: '', email: null, lastPushAt: null, pending: false, syncing: false, skippedHeavy: 0 };
const listeners = new Set<() => void>();
function set(patch: Partial<FirestoreState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

// ------------------------------------------------------------------ contexte de session

interface Session {
  uid: string;
  unsub: Array<() => void>;
  remoteIndex: RemoteIndex;
  remotePages: Map<string, DocMeta>;
  remoteTranscripts: Map<string, DocMeta>;
  ready: { index: boolean; pages: boolean; transcripts: boolean };
}
let session: Session | null = null;
let applyingRemote = false; // vrai pendant qu'on écrit une donnée venue du distant (ne pas la renvoyer)
let flushTimer = 0;
let pullTimer = 0;
/** Moment de la première modification pas encore envoyée (0 = rien en attente) */
let firstPendingAt = 0;
/** Jusqu'à quand les modifications partent tout de suite (après une sortie d'éditeur, une mise en pause…) */
let urgentUntil = 0;
/** Un seul envoi à la fois : deux envois concurrents écriraient deux fois les mêmes documents. */
let running: Promise<void> | null = null;
let again = false;

function scheduleFlush(delay: number) {
  window.clearTimeout(flushTimer);
  flushTimer = window.setTimeout(() => void runFlush(), Math.max(0, delay));
}

function runFlush(): Promise<void> {
  window.clearTimeout(flushTimer);
  if (running) {
    again = true; // on relancera une fois l'envoi courant terminé
    return running;
  }
  running = (async () => {
    do {
      again = false;
      firstPendingAt = 0;
      await flushNow();
    } while (again);
  })().finally(() => {
    running = null;
  });
  return running;
}

// json brut des pages/transcriptions distantes, gardé pour ne le lire qu'en cas de pull réel
const pageDocCache = new Map<string, unknown>();
const transcriptDocCache = new Map<string, unknown>();

// ------------------------------------------------------------------ helpers JSON tolérants

function parseIndex(data: unknown): RemoteIndex {
  const list = <T>(raw: unknown, keep: (x: unknown) => x is T): T[] => {
    try {
      const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return Array.isArray(arr) ? arr.filter(keep) : [];
    } catch {
      return [];
    }
  };
  const rec = <T>(raw: unknown): Record<string, T> => {
    try {
      const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return isRecord(obj) ? (obj as Record<string, T>) : {};
    } catch {
      return {};
    }
  };
  const d = isRecord(data) ? data : {};
  return {
    updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : 0,
    folders: list(d.foldersJson, isFolder),
    notebooks: list(d.notebooksJson, isNotebook),
    todos: list(d.todosJson, isTodo),
    glyphs: list(d.glyphsJson, isGlyph),
    tombstones: rec<Tombstone>(d.tombstonesJson),
  };
}

function parseDoc<T>(json: unknown, keep: (x: unknown) => x is T): T | null {
  try {
    const raw = typeof json === 'string' ? JSON.parse(json) : json;
    return keep(raw) ? raw : null;
  } catch {
    return null;
  }
}

function friendlyError(e: unknown): string {
  const msg = (e as Error)?.message ?? String(e);
  if (/permission|insufficient|PERMISSION_DENIED/i.test(msg))
    return 'Firestore refuse l’accès : vérifie que la base est créée et que les règles autorisent chaque utilisateur à lire/écrire ses propres données.';
  if (/not.?found|NOT_FOUND|Cloud Firestore API|has not been used|disabled/i.test(msg))
    return 'Firestore n’est pas encore activé pour ce projet (Console Firebase → Firestore Database → Créer une base). La synchro locale et Drive continuent normalement.';
  return msg;
}

// ------------------------------------------------------------------ fusion locale ← distante (pull)

async function pullNow() {
  if (!session) return;
  const s = session;
  applyingRemote = true;
  try {
    const now = Date.now();
    const localTomb = (await db.getMeta<Record<string, Tombstone>>('tombstones')) ?? {};
    const tombstones = mergeTombstones(localTomb, s.remoteIndex.tombstones, now);

    const folderPlan = mergeRecords(byKey(await db.folders(), (f) => f.id), byKey(s.remoteIndex.folders, (f) => f.id), tombstones);
    for (const id of folderPlan.pull) await db.putFolder(folderPlan.merged[id]);
    for (const id of folderPlan.purge) await db.deleteFolder(id);

    const notebookPlan = mergeRecords(byKey(await db.notebooks(), (n) => n.id), byKey(s.remoteIndex.notebooks, (n) => n.id), tombstones);
    for (const id of notebookPlan.pull) await db.putNotebook(notebookPlan.merged[id]);
    for (const id of notebookPlan.purge) await db.deleteNotebook(id);

    const todoPlan = mergeRecords(byKey(await db.todos(), (t) => t.id), byKey(s.remoteIndex.todos, (t) => t.id), tombstones);
    for (const id of todoPlan.pull) await db.putTodo(todoPlan.merged[id]);
    for (const id of todoPlan.purge) await db.deleteTodo(id);

    const localGlyphs = byKey((await db.glyphs()).map((g): GlyphRow => ({ ...g, deletedAt: null })), (g) => g.char);
    const remoteGlyphs = byKey(s.remoteIndex.glyphs.map((g): GlyphRow => ({ ...g, deletedAt: null })), (g) => g.char);
    const glyphPlan = mergeRecords(localGlyphs, remoteGlyphs, tombstones, (c) => `glyph:${c}`);
    for (const c of glyphPlan.pull) {
      const { deletedAt: _d, ...glyph } = glyphPlan.merged[c];
      await db.putGlyph(glyph);
    }
    for (const c of glyphPlan.purge) await db.deleteGlyph(c);

    // pages : la version distante n'est chargée (json) que si elle est réellement plus récente
    const pagePlan = mergeRecords(await db.pageVersions(), Object.fromEntries(s.remotePages), tombstones);
    for (const id of pagePlan.pull) {
      const raw = pageDocCache.get(id);
      const page = raw ? parseDoc<Page>(raw, isPage) : null;
      if (page) await db.putPage(page, true);
    }
    for (const id of pagePlan.purge) await db.deletePage(id);
    if (pagePlan.pull.length) notify('pages');

    const localTr: Record<string, DocMeta> = {};
    for (const t of await db.transcripts()) localTr[t.pageId] = { updatedAt: t.updatedAt, deletedAt: t.deletedAt };
    const trPlan = mergeRecords(localTr, Object.fromEntries(s.remoteTranscripts), tombstones, (id) => `transcript:${id}`);
    for (const id of trPlan.pull) {
      const raw = transcriptDocCache.get(id);
      const tr = raw ? parseDoc<Transcript>(raw, isTranscript) : null;
      if (tr) await db.putTranscript(tr);
    }

    await db.setMeta('tombstones', tombstones);
  } catch (e) {
    set({ status: 'error', error: friendlyError(e) });
  } finally {
    applyingRemote = false;
  }
}

// ------------------------------------------------------------------ envoi local → distant (flush)

async function flushNow() {
  if (!session) return;
  const s = session;
  set({ pending: false, syncing: true });
  try {
    const fs = await import('firebase/firestore');
    const store = await getFirestoreDb();
    const now = Date.now();
    const localTomb = (await db.getMeta<Record<string, Tombstone>>('tombstones')) ?? {};
    const tombstones = mergeTombstones(localTomb, s.remoteIndex.tombstones, now);

    const folders = await db.folders();
    const notebooks = await db.notebooks();
    const todos = await db.todos();
    const glyphs = await db.glyphs();

    const folderPlan = mergeRecords(byKey(folders, (f) => f.id), byKey(s.remoteIndex.folders, (f) => f.id), tombstones);
    const notebookPlan = mergeRecords(byKey(notebooks, (n) => n.id), byKey(s.remoteIndex.notebooks, (n) => n.id), tombstones);
    const todoPlan = mergeRecords(byKey(todos, (t) => t.id), byKey(s.remoteIndex.todos, (t) => t.id), tombstones);
    const localGlyphs = byKey(glyphs.map((g): GlyphRow => ({ ...g, deletedAt: null })), (g) => g.char);
    const remoteGlyphs = byKey(s.remoteIndex.glyphs.map((g): GlyphRow => ({ ...g, deletedAt: null })), (g) => g.char);
    const glyphPlan = mergeRecords(localGlyphs, remoteGlyphs, tombstones, (c) => `glyph:${c}`);

    const nextIndex: RemoteIndex = {
      updatedAt: now,
      folders: Object.values(folderPlan.merged),
      notebooks: Object.values(notebookPlan.merged),
      todos: Object.values(todoPlan.merged),
      glyphs: Object.values(glyphPlan.merged).map(({ deletedAt: _d, ...g }) => g),
      tombstones,
    };

    const fsMod = fs;
    const batchOps: Array<(b: ReturnType<typeof fsMod.writeBatch>) => void> = [];
    // Un seul document « index » pour tout le petit : réécrit uniquement s'il a changé (économie d'écritures)
    const indexChanged =
      folderPlan.push.length > 0 ||
      notebookPlan.push.length > 0 ||
      todoPlan.push.length > 0 ||
      glyphPlan.push.length > 0 ||
      JSON.stringify(tombstones) !== JSON.stringify(s.remoteIndex.tombstones);
    if (indexChanged) {
      const indexRef = fs.doc(store, 'users', s.uid, 'state', 'index');
      const payload = {
        v: 1,
        updatedAt: now,
        foldersJson: JSON.stringify(nextIndex.folders),
        notebooksJson: JSON.stringify(nextIndex.notebooks),
        todosJson: JSON.stringify(nextIndex.todos),
        glyphsJson: JSON.stringify(nextIndex.glyphs),
        tombstonesJson: JSON.stringify(tombstones),
      };
      batchOps.push((b) => b.set(indexRef, payload));
    }

    // pages : envoi des seules pages localement plus récentes ; on saute (sans bloquer) une page trop lourde
    let skipped = 0;
    const pagePlan = mergeRecords(await db.pageVersions(), Object.fromEntries(s.remotePages), tombstones);
    for (const id of pagePlan.push) {
      const page = await db.getPage(id);
      if (!page) continue;
      const json = JSON.stringify(page);
      if (json.length > MAX_DOC_BYTES) {
        skipped++;
        continue; // page avec images embarquées > 1 Mio : gardée en local, non synchronisée
      }
      const ref = fs.doc(store, 'users', s.uid, 'pages', id);
      batchOps.push((b) => b.set(ref, { id, notebookId: page.notebookId, updatedAt: page.updatedAt, deletedAt: page.deletedAt, json }));
    }
    // Suppression définitive (corbeille vidée, page effacée) : tout document distant frappé d'une pierre
    // tombale est retiré de Firestore. L'ancienne boucle ne visait que les pages encore présentes en local,
    // si bien qu'une page supprimée ici n'était jamais effacée du cloud.
    for (const id of s.remotePages.keys()) {
      if (!tombstones[id]) continue;
      const ref = fs.doc(store, 'users', s.uid, 'pages', id);
      batchOps.push((b) => b.delete(ref));
    }
    for (const id of s.remoteTranscripts.keys()) {
      if (!tombstones[`transcript:${id}`]) continue;
      const ref = fs.doc(store, 'users', s.uid, 'transcripts', id);
      batchOps.push((b) => b.delete(ref));
    }

    const transcripts = await db.transcripts();
    const localTr: Record<string, DocMeta> = {};
    for (const t of transcripts) localTr[t.pageId] = { updatedAt: t.updatedAt, deletedAt: t.deletedAt };
    const trPlan = mergeRecords(localTr, Object.fromEntries(s.remoteTranscripts), tombstones, (id) => `transcript:${id}`);
    const trById = byKey(transcripts, (t) => t.pageId);
    for (const id of trPlan.push) {
      const t = trById[id];
      if (!t) continue;
      const json = JSON.stringify(t);
      if (json.length > MAX_DOC_BYTES) {
        skipped++;
        continue;
      }
      const ref = fs.doc(store, 'users', s.uid, 'transcripts', id);
      batchOps.push((b) => b.set(ref, { pageId: id, notebookId: t.notebookId, updatedAt: t.updatedAt, deletedAt: t.deletedAt, json }));
    }

    if (batchOps.length) {
      for (let i = 0; i < batchOps.length; i += BATCH_LIMIT) {
        const batch = fs.writeBatch(store);
        for (const op of batchOps.slice(i, i + BATCH_LIMIT)) op(batch);
        await batch.commit();
      }
      // on tient notre vue distante à jour pour ne pas réécrire les mêmes documents au prochain vidage
      s.remoteIndex = nextIndex;
    }
    await db.setMeta('tombstones', tombstones);
    set({ status: 'live', error: '', lastPushAt: now, skippedHeavy: skipped, syncing: false });
  } catch (e) {
    set({ status: 'error', error: friendlyError(e), syncing: false });
  }
}

// ------------------------------------------------------------------ abonnement temps réel

async function subscribe() {
  if (!session) return;
  const s = session;
  const fs = await import('firebase/firestore');
  const store = await getFirestoreDb();

  const schedulePull = () => {
    if (!(s.ready.index && s.ready.pages && s.ready.transcripts)) return;
    window.clearTimeout(pullTimer);
    pullTimer = window.setTimeout(() => void pullNow(), 200);
  };

  s.unsub.push(
    fs.onSnapshot(
      fs.doc(store, 'users', s.uid, 'state', 'index'),
      (snap) => {
        s.remoteIndex = snap.exists() ? parseIndex(snap.data()) : EMPTY_INDEX;
        s.ready.index = true;
        if (state.status === 'connecting') set({ status: 'live' });
        schedulePull();
      },
      (e) => set({ status: 'error', error: friendlyError(e) }),
    ),
  );
  s.unsub.push(
    fs.onSnapshot(
      fs.collection(store, 'users', s.uid, 'pages'),
      (snap) => {
        s.remotePages.clear();
        pageDocCache.clear();
        snap.forEach((d) => {
          const data = d.data() as { updatedAt?: number; deletedAt?: number | null; json?: unknown };
          s.remotePages.set(d.id, { updatedAt: data.updatedAt ?? 0, deletedAt: data.deletedAt ?? null });
          pageDocCache.set(d.id, data.json);
        });
        s.ready.pages = true;
        schedulePull();
      },
      (e) => set({ status: 'error', error: friendlyError(e) }),
    ),
  );
  s.unsub.push(
    fs.onSnapshot(
      fs.collection(store, 'users', s.uid, 'transcripts'),
      (snap) => {
        s.remoteTranscripts.clear();
        transcriptDocCache.clear();
        snap.forEach((d) => {
          const data = d.data() as { updatedAt?: number; deletedAt?: number | null; json?: unknown };
          s.remoteTranscripts.set(d.id, { updatedAt: data.updatedAt ?? 0, deletedAt: data.deletedAt ?? null });
          transcriptDocCache.set(d.id, data.json);
        });
        s.ready.transcripts = true;
        schedulePull();
      },
      (e) => set({ status: 'error', error: friendlyError(e) }),
    ),
  );
}

// ------------------------------------------------------------------ contrôleur public

const SYNCED = new Set(['folders', 'notebooks', 'pages', 'files', 'transcripts', 'glyphs', 'todos']);
let enabled = false;

export const firestoreController = {
  /** Appelé par App quand le réglage change. Rien ne se passe tant que ce n'est pas activé. */
  configure(on: boolean, email: string | null) {
    enabled = on;
    if (!on) {
      firestoreController.stop();
      set({ status: 'off', error: '' });
      return;
    }
    set({ email });
    if (!session) set({ status: email ? 'connecting' : 'signed-out' });
  },

  async start(uid: string, email: string | null) {
    if (!enabled || session) return;
    session = {
      uid,
      unsub: [],
      remoteIndex: EMPTY_INDEX,
      remotePages: new Map(),
      remoteTranscripts: new Map(),
      ready: { index: false, pages: false, transcripts: false },
    };
    set({ status: 'connecting', error: '', email });
    try {
      await subscribe();
      await runFlush(); // pousse tout de suite l'état local vers le cloud (le crée le cas échéant)
    } catch (e) {
      set({ status: 'error', error: friendlyError(e) });
    }
  },

  stop() {
    window.clearTimeout(flushTimer);
    window.clearTimeout(pullTimer);
    firstPendingAt = 0;
    urgentUntil = 0;
    if (session) {
      for (const u of session.unsub) {
        try {
          u();
        } catch {
          /* déjà désabonné */
        }
      }
      session = null;
    }
    pageDocCache.clear();
    transcriptDocCache.clear();
  },

  /** La base locale a changé : envoi groupé, au plus tard MAX_WAIT_MS après la première modification. */
  onLocalChange(stores: string[]) {
    if (!enabled || !session || applyingRemote) return;
    if (!stores.some((st) => SYNCED.has(st))) return;
    const now = Date.now();
    if (!firstPendingAt) firstPendingAt = now;
    set({ pending: true });
    if (now < urgentUntil) {
      scheduleFlush(150); // juste de quoi regrouper les dernières écritures de la page qu'on quitte
      return;
    }
    scheduleFlush(Math.min(QUIET_MS, firstPendingAt + MAX_WAIT_MS - now));
  },

  /** Envoi immédiat : appli mise en arrière-plan, bouton de l'indicateur, corbeille vidée. */
  flush() {
    if (!enabled || !session) return;
    urgentUntil = Date.now() + URGENT_WINDOW_MS;
    void runFlush();
  },

  /**
   * Envoi dans un instant : on vient de quitter l'éditeur, qui enregistre encore sa dernière page. On laisse
   * à cette écriture le temps d'arriver en base, puis tout part, sans attendre le rythme habituel.
   */
  flushSoon(delay = 900) {
    if (!enabled || !session) return;
    urgentUntil = Date.now() + delay + URGENT_WINDOW_MS;
    scheduleFlush(delay);
  },
};

export function subscribeFirestoreState(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function getFirestoreState(): FirestoreState {
  return state;
}
