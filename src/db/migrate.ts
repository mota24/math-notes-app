import { get } from 'idb-keyval';
import type { PaperStyle, Stroke } from '../ink/types';
import { db } from './db';
import { createNotebook } from './library';

let migration: Promise<void> | null = null;

/** Récupère la page du prototype (avant la bibliothèque) dans un cahier « Brouillon ». */
export function migrateLegacyDraft() {
  migration ??= run();
  return migration;
}

async function run() {
  if (await db.getMeta<boolean>('legacyMigrated')) return;
  try {
    const legacy = await get<{ strokes: Stroke[]; paper: PaperStyle }>('page:brouillon');
    if (legacy && legacy.strokes.length > 0) {
      const notebook = await createNotebook({ title: 'Brouillon (prototype)', folderId: null, paper: legacy.paper ?? 'grid' });
      const page = await db.getPage(notebook.pageIds[0]);
      if (page) await db.putPage({ ...page, strokes: legacy.strokes, updatedAt: Date.now() });
    }
  } finally {
    await db.setMeta('legacyMigrated', true);
  }
}
