import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import { useEffect, useState } from 'react';
import type { ConversionResult, Folder, Glyph, Notebook, Page, PageVersion, StoredFile, Todo, Transcript } from './schema';

/** Base locale (IndexedDB) : tout fonctionne hors-ligne, la synchronisation vient par-dessus. */

interface NotesDB extends DBSchema {
  folders: { key: string; value: Folder };
  notebooks: { key: string; value: Notebook };
  pages: { key: string; value: Page; indexes: { notebookId: string } };
  files: { key: string; value: StoredFile };
  transcripts: { key: string; value: Transcript; indexes: { notebookId: string } };
  results: { key: string; value: ConversionResult; indexes: { pageId: string } };
  glyphs: { key: string; value: Glyph };
  todos: { key: string; value: Todo };
  meta: { key: string; value: { key: string; value: unknown } };
}

export type StoreName = 'folders' | 'notebooks' | 'pages' | 'files' | 'transcripts' | 'results' | 'glyphs' | 'todos' | 'meta';

type Db = IDBPDatabase<NotesDB>;
let dbPromise: Promise<Db> | null = null;

function database(): Promise<Db> {
  // Version 2 : ajout du magasin « todos ». `oldVersion` protège les bases existantes (v1) : leurs magasins
  // ne sont jamais recréés (IndexedDB refuse un createObjectStore sur un nom déjà pris), seul « todos » s'ajoute.
  dbPromise ??= openDB<NotesDB>('notes-maths', 2, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('folders', { keyPath: 'id' });
        db.createObjectStore('notebooks', { keyPath: 'id' });
        db.createObjectStore('pages', { keyPath: 'id' }).createIndex('notebookId', 'notebookId');
        db.createObjectStore('files', { keyPath: 'id' });
        db.createObjectStore('transcripts', { keyPath: 'pageId' }).createIndex('notebookId', 'notebookId');
        db.createObjectStore('results', { keyPath: 'id' }).createIndex('pageId', 'pageId');
        db.createObjectStore('glyphs', { keyPath: 'char' });
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      if (oldVersion < 2) {
        db.createObjectStore('todos', { keyPath: 'id' });
      }
    },
    // Le navigateur a coupé la connexion (iOS/iPadOS le fait après une mise en arrière-plan : « Connection to
    // Indexed Database server lost ») : la prochaine opération en ouvre une neuve au lieu d'échouer pour toujours.
    terminated() {
      dbPromise = null;
    },
    // Une version plus récente de l'appli (autre onglet) doit mettre la base à jour : on lui laisse la place
    blocking() {
      const closing = dbPromise;
      dbPromise = null;
      void closing?.then((d) => d.close());
    },
  });
  // Ouverture ratée (stockage indisponible sur le moment) : on retentera au prochain appel
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}

/** Connexion perdue ou fermée en cours de route (iOS, onglet endormi, mise à jour dans un autre onglet) */
export function isConnectionLost(e: unknown): boolean {
  const name = (e as { name?: string })?.name ?? '';
  const message = (e as { message?: string })?.message ?? '';
  return (
    name === 'InvalidStateError' ||
    (name === 'UnknownError' && /connection|closing|lost|server/i.test(message)) ||
    /database connection is closing|connection to indexed database server lost/i.test(message)
  );
}

/**
 * Exécute une opération ; si la connexion a été perdue entre-temps, en ouvre une neuve et réessaie UNE fois.
 * Chaque opération est une transaction complète et idempotente (lecture, put, delete) : la rejouer ne duplique
 * rien. Sans cela, sur iPad, chaque enregistrement échouait jusqu'au rechargement : les derniers traits
 * étaient perdus.
 */
async function withDb<T>(op: (d: Db) => Promise<T>): Promise<T> {
  try {
    return await op(await database());
  } catch (e) {
    if (!isConnectionLost(e)) throw e;
    dbPromise = null;
    return op(await database());
  }
}

// ------------------------------------------------------------------ notifications

const bus = new EventTarget();

export function notify(...stores: StoreName[]) {
  bus.dispatchEvent(new CustomEvent<StoreName[]>('change', { detail: stores }));
}

export function onDbChange(fn: (stores: StoreName[]) => void) {
  const handler = (e: Event) => fn((e as CustomEvent<StoreName[]>).detail);
  bus.addEventListener('change', handler);
  return () => bus.removeEventListener('change', handler);
}

/** Relance la requête quand une des tables concernées change. */
export function useQuery<T>(query: () => Promise<T>, deps: unknown[], stores: StoreName[]): T | undefined {
  const [value, setValue] = useState<T>();
  useEffect(() => {
    let alive = true;
    let seq = 0;
    const run = () => {
      const mine = ++seq;
      // Une lecture ratée (stockage momentanément indisponible) garde l'affichage précédent au lieu de
      // laisser une promesse rejetée sans suite
      query()
        .then((v) => alive && mine === seq && setValue(v))
        .catch(() => undefined);
    };
    run();
    const off = onDbChange((changed) => {
      if (changed.some((s) => stores.includes(s))) run();
    });
    return () => {
      alive = false;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

// ------------------------------------------------------------------ accès

/**
 * L'outil « Ruban d'étude » a été retiré : ses traits (opaques, ils cachaient l'encre) s'afficheraient
 * comme de gros traits de couleur. On les écarte à la lecture ; la page enregistrée sans eux à sa prochaine
 * modification.
 */
function withoutStudyTape(page: Page): Page {
  if (!page.strokes.some((s) => (s.tool as string) === 'tape')) return page;
  return { ...page, strokes: page.strokes.filter((s) => (s.tool as string) !== 'tape') };
}

/** Versions des pages (lues par la synchronisation sans charger les traits) */
type Versions = Record<string, PageVersion>;
const versionOf = (page: Page): PageVersion => ({ notebookId: page.notebookId, updatedAt: page.updatedAt, deletedAt: page.deletedAt });

/** Ce qu'un import écrit d'un seul coup : le fichier, ses pages, le cahier */
export interface Bundle {
  file?: StoredFile;
  pages: Page[];
  notebook?: Notebook;
  /** Ajoute ces pages à la fin d'un cahier existant (même transaction) */
  appendTo?: string;
}

export const db = {
  folders: () => withDb((d) => d.getAll('folders')),
  getFolder: (id: string) => withDb((d) => d.get('folders', id)),
  async putFolder(folder: Folder) {
    await withDb((d) => d.put('folders', folder));
    notify('folders');
  },
  async deleteFolder(id: string) {
    await withDb((d) => d.delete('folders', id));
    notify('folders');
  },

  notebooks: () => withDb((d) => d.getAll('notebooks')),
  getNotebook: (id: string) => withDb((d) => d.get('notebooks', id)),
  async putNotebook(notebook: Notebook) {
    await withDb((d) => d.put('notebooks', notebook));
    notify('notebooks');
  },
  async deleteNotebook(id: string) {
    await withDb((d) => d.delete('notebooks', id));
    notify('notebooks');
  },
  /** Lecture + écriture dans une seule transaction : deux modifications simultanées ne s'écrasent pas. */
  async mutateNotebook(id: string, change: (n: Notebook) => Notebook): Promise<Notebook | undefined> {
    const next = await withDb(async (d) => {
      const tx = d.transaction('notebooks', 'readwrite');
      const current = await tx.store.get(id);
      const changed = current ? change(current) : undefined;
      if (changed) await tx.store.put(changed);
      await tx.done;
      return changed;
    });
    if (next) notify('notebooks');
    return next;
  },

  async getPage(id: string) {
    const page = await withDb((d) => d.get('pages', id));
    return page && withoutStudyTape(page);
  },
  allPages: async () => (await withDb((d) => d.getAll('pages'))).map(withoutStudyTape),
  pagesOf: async (notebookId: string) => (await withDb((d) => d.getAllFromIndex('pages', 'notebookId', notebookId))).map(withoutStudyTape),
  /** Enregistre la page et sa version, dans la même transaction. */
  async putPage(page: Page, silent = false) {
    await withDb(async (d) => {
      const tx = d.transaction(['pages', 'meta'], 'readwrite');
      const versions = ((await tx.objectStore('meta').get('pageVersions'))?.value as Versions) ?? {};
      await tx.objectStore('pages').put(page);
      versions[page.id] = versionOf(page);
      await tx.objectStore('meta').put({ key: 'pageVersions', value: versions });
      await tx.done;
    });
    if (!silent) notify('pages');
  },
  /**
   * Lecture + écriture d'une page dans UNE transaction. Ajouter un trait à une page qui n'est pas la page
   * courante (défilement continu d'un PDF) se faisait en deux temps — lire la page, puis l'écrire — : deux
   * traits rapprochés, ou l'ouverture de la page entre les deux, et l'un des traits était perdu.
   */
  async mutatePage(id: string, change: (p: Page) => Page): Promise<Page | undefined> {
    const next = await withDb(async (d) => {
      const tx = d.transaction(['pages', 'meta'], 'readwrite');
      const current = await tx.objectStore('pages').get(id);
      if (!current) {
        await tx.done;
        return undefined;
      }
      const changed = change(withoutStudyTape(current));
      await tx.objectStore('pages').put(changed);
      const versions = ((await tx.objectStore('meta').get('pageVersions'))?.value as Versions) ?? {};
      versions[id] = versionOf(changed);
      await tx.objectStore('meta').put({ key: 'pageVersions', value: versions });
      await tx.done;
      return changed;
    });
    if (next) notify('pages');
    return next;
  },
  async deletePage(id: string) {
    await withDb(async (d) => {
      const tx = d.transaction(['pages', 'meta', 'transcripts'], 'readwrite');
      await tx.objectStore('pages').delete(id);
      await tx.objectStore('transcripts').delete(id);
      const versions = ((await tx.objectStore('meta').get('pageVersions'))?.value as Versions) ?? {};
      delete versions[id];
      await tx.objectStore('meta').put({ key: 'pageVersions', value: versions });
      await tx.done;
    });
    notify('pages', 'transcripts');
  },
  pageVersions: () => withDb(async (d) => ((await d.get('meta', 'pageVersions'))?.value as Versions) ?? {}),

  /**
   * Import d'un PDF ou d'une photo : le fichier, toutes ses pages et le cahier sont écrits dans UNE seule
   * transaction. Si quelque chose échoue (stockage plein, onglet fermé en plein import), rien n'est écrit :
   * plus de cahier vide ni de fichier orphelin, et jamais de pages qui pointent vers un PDF absent.
   */
  async putBundle(bundle: Bundle): Promise<Notebook | undefined> {
    const result = await withDb(async (d) => {
      const tx = d.transaction(['files', 'pages', 'meta', 'notebooks'], 'readwrite');
      try {
        // Le cahier visé d'abord : s'il manque, rien n'a encore été écrit
        let notebook = bundle.notebook;
        if (bundle.appendTo) {
          const current = await tx.objectStore('notebooks').get(bundle.appendTo);
          if (!current) throw new Error('Cahier introuvable.');
          notebook = { ...current, pageIds: [...current.pageIds, ...bundle.pages.map((p) => p.id)], updatedAt: Date.now() };
        }
        if (bundle.file) await tx.objectStore('files').put(bundle.file);
        const versions = ((await tx.objectStore('meta').get('pageVersions'))?.value as Versions) ?? {};
        for (const page of bundle.pages) {
          await tx.objectStore('pages').put(page);
          versions[page.id] = versionOf(page);
        }
        await tx.objectStore('meta').put({ key: 'pageVersions', value: versions });
        if (notebook) await tx.objectStore('notebooks').put(notebook);
        await tx.done;
        return notebook;
      } catch (e) {
        // Une exception JavaScript n'annule PAS une transaction IndexedDB : ce qui était déjà écrit serait
        // validé. On l'annule explicitement : tout ou rien.
        try {
          tx.abort();
        } catch {
          // déjà terminée ou annulée par le navigateur
        }
        await tx.done.catch(() => undefined);
        throw e;
      }
    });
    notify('files', 'pages', 'notebooks');
    return result;
  },

  getFile: (id: string) => withDb((d) => d.get('files', id)),
  async putFile(file: StoredFile) {
    await withDb((d) => d.put('files', file));
    notify('files');
  },
  async deleteFile(id: string) {
    await withDb((d) => d.delete('files', id));
    notify('files');
  },
  fileIds: () => withDb((d) => d.getAllKeys('files')),

  getTranscript: (pageId: string) => withDb((d) => d.get('transcripts', pageId)),
  transcripts: () => withDb((d) => d.getAll('transcripts')),
  transcriptsOf: (notebookId: string) => withDb((d) => d.getAllFromIndex('transcripts', 'notebookId', notebookId)),
  async putTranscript(t: Transcript) {
    await withDb((d) => d.put('transcripts', t));
    notify('transcripts');
  },

  async resultsOf(pageId: string) {
    const list = await withDb((d) => d.getAllFromIndex('results', 'pageId', pageId));
    return list.sort((a, b) => b.createdAt - a.createdAt);
  },
  async deleteResult(id: string) {
    await withDb((d) => d.delete('results', id));
    notify('results');
  },

  glyphs: () => withDb((d) => d.getAll('glyphs')),
  async putGlyph(g: Glyph) {
    await withDb((d) => d.put('glyphs', g));
    notify('glyphs');
  },
  async deleteGlyph(char: string) {
    await withDb((d) => d.delete('glyphs', char));
    notify('glyphs');
  },

  todos: () => withDb((d) => d.getAll('todos')),
  async putTodo(todo: Todo) {
    await withDb((d) => d.put('todos', todo));
    notify('todos');
  },
  async deleteTodo(id: string) {
    await withDb((d) => d.delete('todos', id));
    notify('todos');
  },

  getMeta: async <T,>(key: string): Promise<T | undefined> => (await withDb((d) => d.get('meta', key)))?.value as T | undefined,
  async setMeta(key: string, value: unknown) {
    await withDb((d) => d.put('meta', { key, value }));
    notify('meta');
  },
};
