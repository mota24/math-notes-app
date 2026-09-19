import { db, notify } from '../db/db';
import type { Tombstone } from '../db/library';
import type { Folder, Glyph, Notebook, Page, PageVersion, StoredFile, Transcript } from '../db/schema';
import { deleteFile, downloadFile, ensureFolder, listFiles, uploadFile } from './drive';
import { byKey, mergeRecords, mergeTombstones } from './merge';

/**
 * Synchronisation avec un dossier Google Drive :
 *   index.json            dossiers, cahiers, versions des pages, écriture perso, suppressions
 *   page-<id>.json        traits d'une page
 *   transcript-<id>.json  transcription LaTeX d'une page
 *   file-<id>             PDF importés
 * Pour chaque élément, la version la plus récente gagne.
 */

interface FileMeta {
  name: string;
  type: string;
  size: number;
  updatedAt: number;
  deletedAt: number | null;
}
interface TranscriptVersion {
  notebookId: string;
  updatedAt: number;
  deletedAt: number | null;
}
type GlyphRecord = Glyph & { deletedAt: null };

interface RemoteIndex {
  version: 1;
  updatedAt: number;
  folders: Folder[];
  notebooks: Notebook[];
  pages: Record<string, PageVersion>;
  transcripts: Record<string, TranscriptVersion>;
  files: Record<string, FileMeta>;
  glyphs: Glyph[];
  tombstones: Record<string, Tombstone>;
}

export interface SyncReport {
  pulled: number;
  pushed: number;
  purged: number;
  at: number;
}

const json = (value: unknown) => new Blob([JSON.stringify(value)], { type: 'application/json' });

export async function syncWithDrive(token: string, progress: (step: string) => void): Promise<SyncReport> {
  const now = Date.now();
  progress('Ouverture du dossier Drive…');
  const folderId = await ensureFolder(token);
  const remoteFiles = new Map((await listFiles(token, folderId)).map((f) => [f.name, f.id]));
  const indexId = remoteFiles.get('index.json');
  const remote: RemoteIndex = indexId
    ? (JSON.parse(await (await downloadFile(token, indexId)).text()) as RemoteIndex)
    : { version: 1, updatedAt: 0, folders: [], notebooks: [], pages: {}, transcripts: {}, files: {}, glyphs: [], tombstones: {} };

  const tombstones = mergeTombstones(
    (await db.getMeta<Record<string, Tombstone>>('tombstones')) ?? {},
    remote.tombstones ?? {},
    now,
  );
  const report: SyncReport = { pulled: 0, pushed: 0, purged: 0, at: now };
  const upload = async (name: string, blob: Blob) => {
    const id = await uploadFile(token, folderId, name, blob, remoteFiles.get(name));
    remoteFiles.set(name, id);
    report.pushed++;
  };
  const download = async (name: string) => {
    const id = remoteFiles.get(name);
    if (!id) return null;
    report.pulled++;
    return downloadFile(token, id);
  };

  // ---- dossiers et cahiers : objets complets dans l'index
  progress('Dossiers et cahiers…');
  const folderPlan = mergeRecords(byKey(await db.folders(), (f) => f.id), byKey(remote.folders ?? [], (f) => f.id), tombstones);
  for (const id of folderPlan.pull) await db.putFolder(folderPlan.merged[id]);
  for (const id of folderPlan.purge) await db.deleteFolder(id);
  const notebookPlan = mergeRecords(byKey(await db.notebooks(), (n) => n.id), byKey(remote.notebooks ?? [], (n) => n.id), tombstones);
  for (const id of notebookPlan.pull) await db.putNotebook(notebookPlan.merged[id]);
  for (const id of notebookPlan.purge) await db.deleteNotebook(id);
  report.pulled += folderPlan.pull.length + notebookPlan.pull.length;
  report.pushed += folderPlan.push.length + notebookPlan.push.length;

  // ---- fichiers PDF (immuables)
  progress('Fichiers PDF…');
  const localFiles: Record<string, FileMeta> = {};
  for (const id of await db.fileIds()) {
    const f = await db.getFile(id);
    if (f) localFiles[id] = { name: f.name, type: f.type, size: f.size, updatedAt: f.updatedAt, deletedAt: f.deletedAt };
  }
  const filePlan = mergeRecords(localFiles, remote.files ?? {}, tombstones);
  for (const id of filePlan.push) {
    const f = await db.getFile(id);
    if (f) await upload(`file-${id}`, f.blob);
  }
  for (const id of filePlan.pull) {
    const blob = await download(`file-${id}`);
    const meta = filePlan.merged[id];
    if (blob) {
      const stored: StoredFile = { id, ...meta, blob: new Blob([blob], { type: meta.type }), createdAt: meta.updatedAt };
      await db.putFile(stored);
    }
  }
  for (const id of filePlan.purge) await db.deleteFile(id);

  // ---- pages
  progress('Pages…');
  const pagePlan = mergeRecords(await db.pageVersions(), remote.pages ?? {}, tombstones);
  for (const [i, id] of pagePlan.push.entries()) {
    progress(`Envoi des pages (${i + 1}/${pagePlan.push.length})…`);
    const page = await db.getPage(id);
    if (page) await upload(`page-${id}.json`, json(page));
  }
  for (const [i, id] of pagePlan.pull.entries()) {
    progress(`Réception des pages (${i + 1}/${pagePlan.pull.length})…`);
    const blob = await download(`page-${id}.json`);
    if (blob) await db.putPage(JSON.parse(await blob.text()) as Page, true);
  }
  for (const id of pagePlan.purge) await db.deletePage(id);

  // ---- transcriptions
  progress('Transcriptions…');
  const localTranscripts: Record<string, TranscriptVersion> = {};
  for (const t of await db.transcripts()) localTranscripts[t.pageId] = { notebookId: t.notebookId, updatedAt: t.updatedAt, deletedAt: t.deletedAt };
  const transcriptPlan = mergeRecords(localTranscripts, remote.transcripts ?? {}, tombstones, (id) => `transcript:${id}`);
  for (const id of transcriptPlan.push) {
    const t = await db.getTranscript(id);
    if (t) await upload(`transcript-${id}.json`, json(t));
  }
  for (const id of transcriptPlan.pull) {
    const blob = await download(`transcript-${id}.json`);
    if (blob) await db.putTranscript(JSON.parse(await blob.text()) as Transcript);
  }

  // ---- écriture perso
  const localGlyphs = byKey((await db.glyphs()).map((g): GlyphRecord => ({ ...g, deletedAt: null })), (g) => g.char);
  const remoteGlyphs = byKey((remote.glyphs ?? []).map((g): GlyphRecord => ({ ...g, deletedAt: null })), (g) => g.char);
  const glyphPlan = mergeRecords(localGlyphs, remoteGlyphs, tombstones, (c) => `glyph:${c}`);
  for (const c of glyphPlan.pull) {
    const { deletedAt: _deleted, ...glyph } = glyphPlan.merged[c];
    await db.putGlyph(glyph);
  }
  for (const c of glyphPlan.purge) await db.deleteGlyph(c);

  // ---- nettoyage des fichiers supprimés définitivement
  progress('Nettoyage…');
  for (const key of Object.keys(tombstones)) {
    const name = key.startsWith('transcript:')
      ? `transcript-${key.slice(11)}.json`
      : tombstones[key].kind === 'page'
        ? `page-${key}.json`
        : tombstones[key].kind === 'file'
          ? `file-${key}`
          : null;
    const id = name ? remoteFiles.get(name) : undefined;
    if (name && id) {
      await deleteFile(token, id);
      remoteFiles.delete(name);
      report.purged++;
    }
  }
  report.purged += folderPlan.purge.length + notebookPlan.purge.length + pagePlan.purge.length;

  // ---- nouvel index
  progress('Mise à jour de l’index…');
  const index: RemoteIndex = {
    version: 1,
    updatedAt: now,
    folders: Object.values(folderPlan.merged),
    notebooks: Object.values(notebookPlan.merged),
    pages: pagePlan.merged,
    transcripts: transcriptPlan.merged,
    files: filePlan.merged,
    glyphs: Object.values(glyphPlan.merged).map(({ deletedAt: _deleted, ...g }) => g),
    tombstones,
  };
  await uploadFile(token, folderId, 'index.json', json(index), remoteFiles.get('index.json'));
  await db.setMeta('tombstones', tombstones);
  await db.setMeta('lastSyncAt', now);
  notify('folders', 'notebooks', 'pages', 'files', 'transcripts', 'glyphs');
  return report;
}
