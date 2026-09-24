import type { Tombstone } from './library';
import type { Folder, Glyph, Notebook, Page, StoredFile, Todo, Transcript } from './schema';

/**
 * Format du fichier de sauvegarde `.json` et sa validation. Sans dépendance (ni base, ni React) :
 * testable directement avec Node (`tests/backupFormat.test.ts`).
 */

export type FileEntry = Omit<StoredFile, 'blob'> & { data: string };

export interface BackupFile {
  app: 'notes-maths';
  version: 1;
  createdAt: number;
  folders: Folder[];
  notebooks: Notebook[];
  pages: Page[];
  transcripts: Transcript[];
  glyphs: Glyph[];
  files: FileEntry[];
  todos: Todo[];
  tombstones: Record<string, Tombstone>;
}

const TOMBSTONE_KINDS = new Set<Tombstone['kind']>(['folder', 'notebook', 'page', 'file', 'transcript', 'glyph', 'todo']);

/** Objet JSON « simple » (ni null, ni tableau). Partagé avec la synchronisation Drive. */
export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNullableTime = (v: unknown): v is number | null => v === null || v === undefined || isFiniteNumber(v);

/** Élément daté, identifié par `idKey` (id, pageId ou char selon le magasin). */
function isVersioned(v: unknown, idKey: string): v is Record<string, unknown> & { updatedAt: number } {
  return isRecord(v) && typeof v[idKey] === 'string' && (v[idKey] as string).length > 0 && isFiniteNumber(v.updatedAt) && isNullableTime(v.deletedAt);
}

/** Garde les éléments bien formés d'un tableau : un fichier abîmé ou trafiqué ne fait pas planter la restauration. */
function cleanList<T>(raw: unknown, keep: (item: unknown) => item is T): T[] {
  return Array.isArray(raw) ? raw.filter(keep) : [];
}

function cleanTombstones(raw: unknown): Record<string, Tombstone> {
  const out: Record<string, Tombstone> = {};
  if (!isRecord(raw)) return out;
  for (const [id, stone] of Object.entries(raw)) {
    if (isRecord(stone) && isFiniteNumber(stone.deletedAt) && TOMBSTONE_KINDS.has(stone.kind as Tombstone['kind'])) {
      out[id] = { kind: stone.kind as Tombstone['kind'], deletedAt: stone.deletedAt };
    }
  }
  return out;
}

export const isFolder = (f: unknown): f is Folder => isVersioned(f, 'id') && typeof f.name === 'string';
export const isNotebook = (n: unknown): n is Notebook => isVersioned(n, 'id') && typeof n.title === 'string' && Array.isArray(n.pageIds);
export const isPage = (p: unknown): p is Page => isVersioned(p, 'id') && typeof p.notebookId === 'string' && Array.isArray(p.strokes);
export const isTranscript = (t: unknown): t is Transcript => isVersioned(t, 'pageId') && Array.isArray(t.blocks);
export const isGlyph = (g: unknown): g is Glyph => isVersioned(g, 'char') && Array.isArray(g.strokes);
export const isFileEntry = (f: unknown): f is FileEntry => isVersioned(f, 'id') && typeof f.data === 'string' && typeof f.type === 'string';
export const isTodo = (t: unknown): t is Todo =>
  isVersioned(t, 'id') && typeof t.text === 'string' && typeof t.done === 'boolean' && isNullableTime(t.dueAt);

/**
 * Vérifie la forme d'une sauvegarde AVANT d'écrire quoi que ce soit dans la base : un fichier tronqué,
 * d'une autre appli ou modifié à la main est rejeté (ou nettoyé de ses éléments illisibles), jamais
 * appliqué à moitié.
 */
export function validateBackup(raw: unknown): BackupFile {
  if (!isRecord(raw) || raw.app !== 'notes-maths') throw new Error('Ce fichier n’est pas une sauvegarde de Notes Maths.');
  if (raw.version !== 1) throw new Error(`Version de sauvegarde inconnue (${String(raw.version)}) : mets l’appli à jour.`);
  return {
    app: 'notes-maths',
    version: 1,
    createdAt: isFiniteNumber(raw.createdAt) ? raw.createdAt : 0,
    folders: cleanList(raw.folders, isFolder),
    notebooks: cleanList(raw.notebooks, isNotebook),
    pages: cleanList(raw.pages, isPage),
    transcripts: cleanList(raw.transcripts, isTranscript),
    glyphs: cleanList(raw.glyphs, isGlyph),
    files: cleanList(raw.files, isFileEntry),
    todos: cleanList(raw.todos, isTodo),
    tombstones: cleanTombstones(raw.tombstones),
  };
}
