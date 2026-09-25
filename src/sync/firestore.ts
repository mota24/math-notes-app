import { db, notify } from '../db/db';
import type { Tombstone } from '../db/library';
import { isFolder, isGlyph, isNotebook, isPage, isRecord, isTodo, isTranscript } from '../db/backupFormat';
import type { Folder, Glyph, Notebook, Page, StoredFile, Todo, Transcript } from '../db/schema';
import { getFirestoreDb } from '../firebase';
import { FILE_CHUNK_BYTES, MAX_SYNC_FILE_BYTES, MAX_SYNC_PAGE_CHARS, PAGE_PART_CHARS, joinBytes, splitBytes, splitText, toHex } from './chunks';
import { byKey, mergeRecords, mergeTombstones } from './merge';

/**
 * Synchronisation temps réel via Firebase Firestore, EN OPTION et sans risque pour les données locales :
 *
 *  - Synchronise dossiers, cahiers, pages (traits), transcriptions, tâches, écriture perso, ET les fichiers de
 *    fond (PDF de cours, photos), découpés en morceaux binaires vérifiés par SHA-256 (voir chunks.ts). Avant,
 *    les PDF restaient sur l'appareil : sur un autre appareil, ou après un nettoyage du stockage par le
 *    navigateur (Safari efface au bout de 7 jours un site non installé), le cours était perdu pour de bon.
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
  /** Page trop lourde pour un document : son JSON est en `parts` morceaux (sous-collection parts/) */
  parts?: number;
}

/** Ce que dit le document users/<uid>/files/<id> d'un fichier de fond (ses octets sont dans chunks/) */
interface RemoteFile {
  name: string;
  type: string;
  size: number;
  chunks: number;
  sha256: string;
  updatedAt: number;
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
  /** Pas de réseau : les modifications partiront à son retour */
  offline: boolean;
  skippedHeavy: number; // pages ou fichiers trop lourds, gardés sur l'appareil seulement
  /** Transfert de fichier en cours (« Envoi de Cours.pdf… »), null sinon */
  transfer: string | null;
}

let state: FirestoreState = {
  status: 'off',
  error: '',
  email: null,
  lastPushAt: null,
  pending: false,
  syncing: false,
  offline: typeof navigator !== 'undefined' && !navigator.onLine,
  skippedHeavy: 0,
  transfer: null,
};
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
  remoteFiles: Map<string, RemoteFile>;
  ready: { index: boolean; pages: boolean; transcripts: boolean; files: boolean };
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
/** Nombre d'échecs d'envoi d'affilée : fixe le délai avant le prochain essai (5 s, 10 s, 20 s… jusqu'à 2 min). */
let failures = 0;

function scheduleRetry() {
  failures++;
  scheduleFlush(Math.min(120_000, 5_000 * 2 ** (failures - 1)));
}

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

/**
 * Contenu (json) d'un document distant, lu seulement quand il faut vraiment l'importer. Il vient du cache du
 * SDK Firestore, déjà rempli par les écouteurs : aucune lecture réseau en plus. Avant, une copie du json de
 * TOUTES les pages restait en mémoire en permanence, en double de ce cache.
 */
async function remoteJson(collection: 'pages' | 'transcripts', id: string): Promise<unknown> {
  if (!session) return null;
  const fs = await import('firebase/firestore');
  const store = await getFirestoreDb();
  const uid = session.uid;
  const ref = fs.doc(store, 'users', uid, collection, id);
  const snap = await fs.getDocFromCache(ref).catch(() => fs.getDoc(ref));
  if (!snap.exists()) return null;
  const data = snap.data() as { json?: unknown; parts?: unknown };
  const parts = typeof data.parts === 'number' ? data.parts : 0;
  if (collection !== 'pages' || parts <= 0) return data.json;
  // Page lourde : recollée depuis ses morceaux (lus sur le serveur, ils ne sont dans aucun écouteur)
  const texts: string[] = [];
  for (let i = 0; i < parts; i++) {
    const part = await fs.getDoc(fs.doc(store, 'users', uid, 'pages', id, 'parts', String(i)));
    const text = part.exists() ? (part.data() as { data?: unknown }).data : null;
    if (typeof text !== 'string') return null; // morceau pas encore arrivé : on réessaiera au prochain instantané
    texts.push(text);
  }
  return texts.join('');
}

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
      const raw = await remoteJson('pages', id);
      const page = raw ? parseDoc<Page>(raw, isPage) : null;
      if (page) await db.putPage(page, true);
    }
    for (const id of pagePlan.purge) await db.deletePage(id);
    if (pagePlan.pull.length) notify('pages');

    const localTr: Record<string, DocMeta> = {};
    for (const t of await db.transcripts()) localTr[t.pageId] = { updatedAt: t.updatedAt, deletedAt: t.deletedAt };
    const trPlan = mergeRecords(localTr, Object.fromEntries(s.remoteTranscripts), tombstones, (id) => `transcript:${id}`);
    for (const id of trPlan.pull) {
      const raw = await remoteJson('transcripts', id);
      const tr = raw ? parseDoc<Transcript>(raw, isTranscript) : null;
      if (tr) await db.putTranscript(tr);
    }

    await db.setMeta('tombstones', tombstones);
  } catch (e) {
    set({ status: 'error', error: friendlyError(e) });
  } finally {
    applyingRemote = false;
  }
  // Hors de applyingRemote : un fichier téléchargé est une vraie écriture locale, que la synchro doit voir
  void syncFiles();
}

// ------------------------------------------------------------------ fichiers de fond (PDF, photos)

let filesRunning: Promise<void> | null = null;
let filesAgain = false;
/** Passages ratés d'affilée : le suivant attend 30 s, 1 min, 2 min… jusqu'à 10 min */
let filesFailures = 0;
let filesRetry = 0;

/** Un seul transfert de fichiers à la fois ; relancé une fois de plus si on l'a redemandé entre-temps. */
function syncFiles(): Promise<void> {
  if (filesRunning) {
    filesAgain = true;
    return filesRunning;
  }
  filesRunning = (async () => {
    do {
      filesAgain = false;
      await syncFilesNow();
    } while (filesAgain);
  })().finally(() => {
    filesRunning = null;
  });
  return filesRunning;
}

async function sha256(buffer: ArrayBuffer): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', buffer));
}

/**
 * Envoie les fichiers de fond absents du cloud, télécharge ceux absents de l'appareil, applique les
 * suppressions définitives. Un fichier ne change jamais une fois importé (un nouvel import crée un nouvel
 * identifiant) : il suffit de savoir s'il existe de chaque côté. Le document de description est écrit APRÈS
 * tous les morceaux, et un fichier téléchargé n'est enregistré qu'une fois sa taille et son empreinte
 * vérifiées : jamais de PDF tronqué ou corrompu, ni d'un côté ni de l'autre.
 */
async function syncFilesNow() {
  const s = session;
  // Il faut aussi l'index distant : ses pierres tombales disent quels fichiers ont été supprimés ailleurs
  if (!s || !s.ready.files || !s.ready.index) return;
  const fs = await import('firebase/firestore');
  const store = await getFirestoreDb();
  const fileDoc = (id: string) => fs.doc(store, 'users', s.uid, 'files', id);
  const chunkDoc = (id: string, i: number) => fs.doc(store, 'users', s.uid, 'files', id, 'chunks', String(i));
  let tooBig = 0;
  try {
    const tombstones = mergeTombstones((await db.getMeta<Record<string, Tombstone>>('tombstones')) ?? {}, s.remoteIndex.tombstones, Date.now());
    const local = new Set((await db.fileIds()).map(String));

    // Suppressions définitives (cahier purgé) : de l'appareil et du cloud
    for (const id of local) {
      if (tombstones[id]) {
        await db.deleteFile(id);
        local.delete(id);
      }
    }
    for (const [id, meta] of s.remoteFiles) {
      if (!tombstones[id] || session !== s) continue;
      const batch = fs.writeBatch(store);
      for (let i = 0; i < meta.chunks; i++) batch.delete(chunkDoc(id, i));
      batch.delete(fileDoc(id));
      await batch.commit();
      s.remoteFiles.delete(id);
    }

    // Chaque fichier à part : un fichier distant abîmé ne bloque plus tous ceux qui suivent
    const errors: string[] = [];
    const attempt = async (task: () => Promise<void>) => {
      try {
        await task();
      } catch (e) {
        errors.push(friendlyError(e));
      }
    };

    // Envoi
    for (const id of local) {
      if (s.remoteFiles.has(id) || session !== s) continue;
      await attempt(async () => {
        const file = await db.getFile(id);
        if (!file) return;
        if (file.blob.size > MAX_SYNC_FILE_BYTES) {
          tooBig++;
          return;
        }
        set({ transfer: `Envoi de « ${file.name} »…` });
        const buffer = await file.blob.arrayBuffer();
        const parts = splitBytes(new Uint8Array(buffer), FILE_CHUNK_BYTES);
        for (let i = 0; i < parts.length; i += 8) {
          const batch = fs.writeBatch(store);
          parts.slice(i, i + 8).forEach((part, k) => batch.set(chunkDoc(id, i + k), { data: fs.Bytes.fromUint8Array(part) }));
          await batch.commit();
        }
        // La description en dernier : tant qu'elle manque, les autres appareils ne voient pas le fichier
        const meta: RemoteFile = { name: file.name.slice(0, 300), type: (file.type || 'application/octet-stream').slice(0, 100), size: buffer.byteLength, chunks: parts.length, sha256: await sha256(buffer), updatedAt: file.updatedAt };
        await fs.setDoc(fileDoc(id), { id, ...meta, deletedAt: null });
        s.remoteFiles.set(id, meta);
      });
    }

    // Téléchargement
    for (const [id, meta] of s.remoteFiles) {
      if (local.has(id) || tombstones[id] || session !== s) continue;
      await attempt(async () => {
        set({ transfer: `Réception de « ${meta.name} »…` });
        const parts: Uint8Array[] = [];
        for (let i = 0; i < meta.chunks; i++) {
          const snap = await fs.getDoc(chunkDoc(id, i));
          const data = snap.exists() ? (snap.data() as { data?: { toUint8Array?: () => Uint8Array } }).data : undefined;
          if (!data?.toUint8Array) throw new Error(`Morceau ${i + 1}/${meta.chunks} de « ${meta.name} » introuvable dans le cloud.`);
          parts.push(data.toUint8Array());
        }
        const bytes = joinBytes(parts);
        parts.length = 0;
        if (bytes.length !== meta.size || (await sha256(bytes.buffer)) !== meta.sha256) {
          throw new Error(`« ${meta.name} » est arrivé abîmé (taille ou empreinte différente) : nouvel essai plus tard.`);
        }
        const stored: StoredFile = { id, name: meta.name, type: meta.type, size: meta.size, blob: new Blob([bytes], { type: meta.type }), createdAt: meta.updatedAt, updatedAt: meta.updatedAt, deletedAt: null };
        await db.putFile(stored);
        local.add(id);
      });
    }

    if (errors.length) throw new Error(errors[0]);
    filesFailures = 0;
    set({ transfer: null, skippedHeavy: Math.max(state.skippedHeavy, tooBig) });
  } catch (e) {
    // Rien de perdu : l'original reste de son côté ; le prochain passage reprendra ce qui manque
    set({ transfer: null, status: 'error', error: friendlyError(e) });
    filesFailures++;
    window.clearTimeout(filesRetry);
    filesRetry = window.setTimeout(() => void syncFiles(), Math.min(600_000, 30_000 * 2 ** (filesFailures - 1)));
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

    // pages : envoi des seules pages localement plus récentes. Une page de plus de 1 Mio (photos posées dessus)
    // part en morceaux au lieu d'être ignorée ; seule une page démesurée reste sur l'appareil.
    let skipped = 0;
    const heavy: { id: string; parts: string[]; doc: Record<string, unknown> }[] = [];
    const pagePlan = mergeRecords(await db.pageVersions(), Object.fromEntries(s.remotePages), tombstones);
    for (const id of pagePlan.push) {
      const page = await db.getPage(id);
      if (!page) continue;
      const json = JSON.stringify(page);
      const meta = { id, notebookId: page.notebookId, updatedAt: page.updatedAt, deletedAt: page.deletedAt };
      const oldParts = s.remotePages.get(id)?.parts ?? 0;
      if (json.length <= MAX_DOC_BYTES) {
        const ref = fs.doc(store, 'users', s.uid, 'pages', id);
        batchOps.push((b) => b.set(ref, { ...meta, json }));
        // Elle était découpée et ne l'est plus : ses anciens morceaux s'en vont
        for (let i = 0; i < oldParts; i++) {
          const part = fs.doc(store, 'users', s.uid, 'pages', id, 'parts', String(i));
          batchOps.push((b) => b.delete(part));
        }
        continue;
      }
      if (json.length > MAX_SYNC_PAGE_CHARS) {
        skipped++;
        continue;
      }
      heavy.push({ id, parts: splitText(json, PAGE_PART_CHARS), doc: { ...meta, json: '' } });
    }
    // Suppression définitive (corbeille vidée, page effacée) : tout document distant frappé d'une pierre
    // tombale est retiré de Firestore, morceaux compris.
    for (const [id, meta] of s.remotePages) {
      if (!tombstones[id]) continue;
      const ref = fs.doc(store, 'users', s.uid, 'pages', id);
      batchOps.push((b) => b.delete(ref));
      for (let i = 0; i < (meta.parts ?? 0); i++) {
        const part = fs.doc(store, 'users', s.uid, 'pages', id, 'parts', String(i));
        batchOps.push((b) => b.delete(part));
      }
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
    // Pages lourdes : les morceaux d'abord (10 par lot, sous la limite de 10 Mio d'une écriture groupée), le
    // document de la page en dernier — un autre appareil ne la lit qu'une fois tous ses morceaux en place.
    for (const page of heavy) {
      for (let i = 0; i < page.parts.length; i += 10) {
        const batch = fs.writeBatch(store);
        page.parts.slice(i, i + 10).forEach((data, k) => batch.set(fs.doc(store, 'users', s.uid, 'pages', page.id, 'parts', String(i + k)), { data }));
        await batch.commit();
      }
      await fs.setDoc(fs.doc(store, 'users', s.uid, 'pages', page.id), { ...page.doc, parts: page.parts.length });
    }
    await db.setMeta('tombstones', tombstones);
    failures = 0;
    set({ status: 'live', error: '', lastPushAt: now, skippedHeavy: skipped, syncing: false });
    void syncFiles();
  } catch (e) {
    // L'envoi a échoué (coupure, droits, service indisponible) : rien n'est perdu — tout est encore en base
    // locale —, les modifications restent « en attente » et on réessaie de plus en plus espacé. Avant, elles
    // étaient marquées comme envoyées et rien ne repartait avant la modification suivante.
    set({ status: 'error', error: friendlyError(e), syncing: false, pending: true });
    scheduleRetry();
  }
}

// ------------------------------------------------------------------ abonnement temps réel

/**
 * Ne traite que les documents qui ont changé depuis le dernier instantané (le tout premier les contient
 * tous). Avant, chaque modification distante reconstruisait la carte entière de toutes les pages.
 */
type Changes = { docChanges(): Array<{ type: 'added' | 'modified' | 'removed'; doc: { id: string; data(): unknown } }> };

function applyChanges(snap: Changes, into: Map<string, DocMeta>) {
  for (const change of snap.docChanges()) {
    if (change.type === 'removed') {
      into.delete(change.doc.id);
      continue;
    }
    const data = change.doc.data() as { updatedAt?: number; deletedAt?: number | null; parts?: number };
    into.set(change.doc.id, {
      updatedAt: data.updatedAt ?? 0,
      deletedAt: data.deletedAt ?? null,
      ...(typeof data.parts === 'number' && data.parts > 0 ? { parts: data.parts } : {}),
    });
  }
}

function applyFileChanges(snap: Changes, into: Map<string, RemoteFile>) {
  for (const change of snap.docChanges()) {
    if (change.type === 'removed') {
      into.delete(change.doc.id);
      continue;
    }
    const d = change.doc.data() as Partial<RemoteFile>;
    if (typeof d.chunks !== 'number' || typeof d.size !== 'number' || typeof d.sha256 !== 'string') continue;
    into.set(change.doc.id, {
      name: typeof d.name === 'string' ? d.name : 'fichier',
      type: typeof d.type === 'string' ? d.type : 'application/octet-stream',
      size: d.size,
      chunks: d.chunks,
      sha256: d.sha256,
      updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : 0,
    });
  }
}

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
        applyChanges(snap, s.remotePages);
        s.ready.pages = true;
        schedulePull();
      },
      (e) => set({ status: 'error', error: friendlyError(e) }),
    ),
  );
  s.unsub.push(
    fs.onSnapshot(
      fs.collection(store, 'users', s.uid, 'files'),
      (snap) => {
        applyFileChanges(snap, s.remoteFiles);
        s.ready.files = true;
        void syncFiles();
      },
      (e) => set({ status: 'error', error: friendlyError(e) }),
    ),
  );
  s.unsub.push(
    fs.onSnapshot(
      fs.collection(store, 'users', s.uid, 'transcripts'),
      (snap) => {
        applyChanges(snap, s.remoteTranscripts);
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
      remoteFiles: new Map(),
      ready: { index: false, pages: false, transcripts: false, files: false },
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
    window.clearTimeout(filesRetry);
    filesFailures = 0;
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
    set({ transfer: null });
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

  /** Le réseau change : on l'affiche, et au retour tout ce qui attend (ou a échoué) repart aussitôt. */
  setOnline(online: boolean) {
    set({ offline: !online });
    if (!online || !enabled || !session) return;
    if (state.pending || state.status === 'error') {
      failures = 0;
      filesFailures = 0;
      void runFlush(); // relance aussi les fichiers une fois l'envoi réussi
    }
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
