import { byKey, mergeRecords, mergeTombstones } from '../sync/merge';
import { backupPrefs, currentSettings } from '../settings';
import { db } from './db';
import type { Tombstone } from './library';
import { validateBackup } from './backupFormat';
import type { BackupFile, FileEntry } from './backupFormat';
import type { PageVersion } from './schema';

/** Sauvegarde complète dans un fichier (sans compte Google) et restauration par fusion. */

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function base64ToBlob(data: string, type: string): Blob {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

export async function createBackup(): Promise<Blob> {
  const files: FileEntry[] = [];
  for (const id of await db.fileIds()) {
    const file = await db.getFile(id);
    if (!file) continue;
    const { blob, ...meta } = file;
    files.push({ ...meta, data: await blobToBase64(blob) });
  }
  const backup: BackupFile = {
    app: 'notes-maths',
    version: 1,
    createdAt: Date.now(),
    folders: await db.folders(),
    notebooks: await db.notebooks(),
    pages: await db.allPages(),
    transcripts: await db.transcripts(),
    files,
    todos: await db.todos(),
    tombstones: (await db.getMeta<Record<string, Tombstone>>('tombstones')) ?? {},
    settings: backupPrefs(currentSettings()),
  };
  return new Blob([JSON.stringify(backup)], { type: 'application/json' });
}

/** Fusionne une sauvegarde : pour chaque élément, la version la plus récente gagne. */
export async function restoreBackup(file: File): Promise<{ imported: number }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('Fichier illisible.');
  }
  const data = validateBackup(parsed);

  const tombstones = mergeTombstones((await db.getMeta<Record<string, Tombstone>>('tombstones')) ?? {}, data.tombstones, Date.now());
  let imported = 0;

  const folders = mergeRecords(byKey(await db.folders(), (f) => f.id), byKey(data.folders, (f) => f.id), tombstones);
  for (const id of folders.pull) await db.putFolder(folders.merged[id]);
  const notebooks = mergeRecords(byKey(await db.notebooks(), (n) => n.id), byKey(data.notebooks, (n) => n.id), tombstones);
  for (const id of notebooks.pull) await db.putNotebook(notebooks.merged[id]);

  const pages = mergeRecords<PageVersion>(await db.pageVersions(), byKey(data.pages, (p) => p.id), tombstones);
  const backupPages = byKey(data.pages, (p) => p.id);
  for (const id of pages.pull) await db.putPage(backupPages[id], true);

  const transcripts = mergeRecords(
    byKey(await db.transcripts(), (t) => t.pageId),
    byKey(data.transcripts, (t) => t.pageId),
    tombstones,
    (id) => `transcript:${id}`,
  );
  for (const id of transcripts.pull) await db.putTranscript(transcripts.merged[id]);

  const localFiles = new Set(await db.fileIds());
  for (const entry of data.files) {
    if (localFiles.has(entry.id) || tombstones[entry.id]) continue;
    const { data: encoded, ...meta } = entry;
    let blob: Blob;
    try {
      blob = base64ToBlob(encoded, meta.type);
    } catch {
      continue; // contenu base64 abîmé : on saute ce fichier, le reste est restauré
    }
    await db.putFile({ ...meta, blob });
    imported++;
  }

  const todos = mergeRecords(byKey(await db.todos(), (t) => t.id), byKey(data.todos, (t) => t.id), tombstones);
  for (const id of todos.pull) await db.putTodo(todos.merged[id]);

  await db.setMeta('tombstones', tombstones);
  imported += folders.pull.length + notebooks.pull.length + pages.pull.length + transcripts.pull.length + todos.pull.length;
  return { imported };
}
