import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import { useEffect, useState } from 'react';
import type { ConversionResult, Folder, Glyph, Notebook, Page, PageVersion, StoredFile, Transcript } from './schema';

/** Base locale (IndexedDB) : tout fonctionne hors-ligne, la synchronisation Drive vient par-dessus. */

interface NotesDB extends DBSchema {
  folders: { key: string; value: Folder };
  notebooks: { key: string; value: Notebook };
  pages: { key: string; value: Page; indexes: { notebookId: string } };
  files: { key: string; value: StoredFile };
  transcripts: { key: string; value: Transcript; indexes: { notebookId: string } };
  results: { key: string; value: ConversionResult; indexes: { pageId: string } };
  glyphs: { key: string; value: Glyph };
  meta: { key: string; value: { key: string; value: unknown } };
}

export type StoreName = 'folders' | 'notebooks' | 'pages' | 'files' | 'transcripts' | 'results' | 'glyphs' | 'meta';

let dbPromise: Promise<IDBPDatabase<NotesDB>> | null = null;

function database() {
  dbPromise ??= openDB<NotesDB>('notes-maths', 1, {
    upgrade(db) {
      db.createObjectStore('folders', { keyPath: 'id' });
      db.createObjectStore('notebooks', { keyPath: 'id' });
      db.createObjectStore('pages', { keyPath: 'id' }).createIndex('notebookId', 'notebookId');
      db.createObjectStore('files', { keyPath: 'id' });
      db.createObjectStore('transcripts', { keyPath: 'pageId' }).createIndex('notebookId', 'notebookId');
      db.createObjectStore('results', { keyPath: 'id' }).createIndex('pageId', 'pageId');
      db.createObjectStore('glyphs', { keyPath: 'char' });
      db.createObjectStore('meta', { keyPath: 'key' });
    },
  });
  return dbPromise;
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
      query().then((v) => alive && mine === seq && setValue(v));
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

async function pageVersions(): Promise<Record<string, PageVersion>> {
  const d = await database();
  return ((await d.get('meta', 'pageVersions'))?.value as Record<string, PageVersion>) ?? {};
}

export const db = {
  async folders() {
    return (await database()).getAll('folders');
  },
  async getFolder(id: string) {
    return (await database()).get('folders', id);
  },
  async putFolder(folder: Folder) {
    await (await database()).put('folders', folder);
    notify('folders');
  },
  async deleteFolder(id: string) {
    await (await database()).delete('folders', id);
    notify('folders');
  },

  async notebooks() {
    return (await database()).getAll('notebooks');
  },
  async getNotebook(id: string) {
    return (await database()).get('notebooks', id);
  },
  async putNotebook(notebook: Notebook) {
    await (await database()).put('notebooks', notebook);
    notify('notebooks');
  },
  async deleteNotebook(id: string) {
    await (await database()).delete('notebooks', id);
    notify('notebooks');
  },
  /** Lecture + écriture dans une seule transaction : deux modifications simultanées ne s'écrasent pas. */
  async mutateNotebook(id: string, change: (n: Notebook) => Notebook): Promise<Notebook | undefined> {
    const tx = (await database()).transaction('notebooks', 'readwrite');
    const current = await tx.store.get(id);
    const next = current ? change(current) : undefined;
    if (next) await tx.store.put(next);
    await tx.done;
    if (next) notify('notebooks');
    return next;
  },

  async getPage(id: string) {
    return (await database()).get('pages', id);
  },
  async allPages() {
    return (await database()).getAll('pages');
  },
  async pagesOf(notebookId: string) {
    return (await database()).getAllFromIndex('pages', 'notebookId', notebookId);
  },
  /** Enregistre la page et sa version (utilisée par la synchronisation sans charger les traits). */
  async putPage(page: Page, silent = false) {
    const d = await database();
    const tx = d.transaction(['pages', 'meta'], 'readwrite');
    await tx.objectStore('pages').put(page);
    const versions = ((await tx.objectStore('meta').get('pageVersions'))?.value as Record<string, PageVersion>) ?? {};
    versions[page.id] = { notebookId: page.notebookId, updatedAt: page.updatedAt, deletedAt: page.deletedAt };
    await tx.objectStore('meta').put({ key: 'pageVersions', value: versions });
    await tx.done;
    if (!silent) notify('pages');
  },
  async deletePage(id: string) {
    const d = await database();
    const tx = d.transaction(['pages', 'meta', 'transcripts'], 'readwrite');
    await tx.objectStore('pages').delete(id);
    await tx.objectStore('transcripts').delete(id);
    const versions = ((await tx.objectStore('meta').get('pageVersions'))?.value as Record<string, PageVersion>) ?? {};
    delete versions[id];
    await tx.objectStore('meta').put({ key: 'pageVersions', value: versions });
    await tx.done;
    notify('pages', 'transcripts');
  },
  pageVersions,

  async getFile(id: string) {
    return (await database()).get('files', id);
  },
  async putFile(file: StoredFile) {
    await (await database()).put('files', file);
    notify('files');
  },
  async deleteFile(id: string) {
    await (await database()).delete('files', id);
    notify('files');
  },
  async fileIds() {
    return (await database()).getAllKeys('files');
  },

  async getTranscript(pageId: string) {
    return (await database()).get('transcripts', pageId);
  },
  async transcripts() {
    return (await database()).getAll('transcripts');
  },
  async transcriptsOf(notebookId: string) {
    return (await database()).getAllFromIndex('transcripts', 'notebookId', notebookId);
  },
  async putTranscript(t: Transcript) {
    await (await database()).put('transcripts', t);
    notify('transcripts');
  },

  async resultsOf(pageId: string) {
    const list = await (await database()).getAllFromIndex('results', 'pageId', pageId);
    return list.sort((a, b) => b.createdAt - a.createdAt);
  },
  async putResult(r: ConversionResult) {
    const { progress: _progress, ...stored } = r;
    await (await database()).put('results', stored);
    notify('results');
  },
  async deleteResult(id: string) {
    await (await database()).delete('results', id);
    notify('results');
  },

  async glyphs() {
    return (await database()).getAll('glyphs');
  },
  async putGlyph(g: Glyph) {
    await (await database()).put('glyphs', g);
    notify('glyphs');
  },
  async deleteGlyph(char: string) {
    await (await database()).delete('glyphs', char);
    notify('glyphs');
  },

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await (await database()).get('meta', key))?.value as T | undefined;
  },
  async setMeta(key: string, value: unknown) {
    await (await database()).put('meta', { key, value });
    notify('meta');
  },
};
