import { createHash } from 'node:crypto';
import type { BackupFile, FileEntry } from '../../src/db/backupFormat';
import type { Tombstone } from '../../src/db/library';
import type { Folder, Notebook, Page, Todo, Transcript } from '../../src/db/schema';

/**
 * Reconstruit, à partir de Firestore, EXACTEMENT le fichier que produit l'export manuel de l'appli
 * (`createBackup`, src/db/backup.ts ; format et validation : src/db/backupFormat.ts). Sans import de valeur
 * (ni Firebase, ni fichier voisin) : testé sous Node avec un lecteur en mémoire (tests/driveBackup.test.ts).
 *
 * Firestore range les données ainsi (src/sync/firestore.ts) :
 *  - users/<uid>/state/index : dossiers, cahiers, tâches et suppressions, en JSON texte ;
 *  - users/<uid>/pages/<id> : la page en JSON, ou découpée en `parts` morceaux (pages lourdes) ;
 *  - users/<uid>/transcripts/<id> : la transcription en JSON ;
 *  - users/<uid>/files/<id> + chunks/<n> : les PDF et photos, en morceaux binaires, avec leur SHA-256 ;
 *  - users/<uid>/state/prefs : les réglages d'apparence (couleurs…), en JSON.
 */

export interface RemoteFileMeta {
  id: string;
  name: string;
  type: string;
  size: number;
  chunks: number;
  sha256: string;
  updatedAt: number;
}

/** Ce que la sauvegarde lit dans Firestore (le SDK Admin côté serveur, un faux lecteur dans les tests) */
export interface BackupReader {
  index(): Promise<Record<string, unknown> | null>;
  pages(): Promise<{ id: string; json: string; parts: number }[]>;
  pageParts(id: string, count: number): Promise<(string | null)[]>;
  transcripts(): Promise<{ id: string; json: string }[]>;
  files(): Promise<RemoteFileMeta[]>;
  fileChunks(id: string, count: number): Promise<(Uint8Array | null)[]>;
  prefs(): Promise<string | null>;
}

export interface CollectedBackup {
  backup: BackupFile;
  /** Ce qui n'a pas pu entrer dans la sauvegarde (page illisible, PDF abîmé…) : affiché dans l'appli */
  warnings: string[];
  counts: { folders: number; notebooks: number; pages: number; files: number; todos: number };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseJson(raw: unknown): unknown {
  if (typeof raw !== 'string' || raw === '') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Une liste rangée en JSON dans l'index, réduite à ses éléments bien formés (un objet avec son identifiant) */
function jsonList<T>(raw: unknown, idKey: string): T[] {
  const list = parseJson(raw);
  return Array.isArray(list) ? (list.filter((x) => isRecord(x) && typeof x[idKey] === 'string') as T[]) : [];
}

function tombstonesOf(raw: unknown): Record<string, Tombstone> {
  const obj = parseJson(raw);
  return isRecord(obj) ? (obj as Record<string, Tombstone>) : {};
}

export async function collectBackup(reader: BackupReader, now = Date.now()): Promise<CollectedBackup> {
  const warnings: string[] = [];
  const index = await reader.index();
  if (!index) {
    // Rien dans le cloud : une « sauvegarde » vide passerait pour un succès et masquerait le vrai problème
    throw new Error(
      'Aucune donnée dans Firestore : active la synchronisation (Réglages → Cloud) sur l’appareil où sont tes cahiers.',
    );
  }
  const tombstones = tombstonesOf(index.tombstonesJson);

  const pages: Page[] = [];
  for (const doc of await reader.pages()) {
    if (tombstones[doc.id]) continue;
    let json = doc.json;
    if (doc.parts > 0) {
      const parts = await reader.pageParts(doc.id, doc.parts);
      if (parts.some((p) => typeof p !== 'string')) {
        warnings.push(`Page ${doc.id} : un morceau manque dans le cloud (page lourde encore en cours d’envoi ?).`);
        continue;
      }
      json = parts.join('');
    }
    const page = parseJson(json);
    if (!isRecord(page) || page.id !== doc.id || !Array.isArray(page.strokes)) {
      warnings.push(`Page ${doc.id} : contenu illisible, ignorée.`);
      continue;
    }
    pages.push(page as unknown as Page);
  }

  const transcripts: Transcript[] = [];
  for (const doc of await reader.transcripts()) {
    if (tombstones[`transcript:${doc.id}`]) continue;
    const t = parseJson(doc.json);
    if (isRecord(t) && t.pageId === doc.id && Array.isArray(t.blocks)) transcripts.push(t as unknown as Transcript);
    else warnings.push(`Transcription ${doc.id} : contenu illisible, ignorée.`);
  }

  const files: FileEntry[] = [];
  for (const meta of await reader.files()) {
    if (tombstones[meta.id]) continue;
    const chunks = await reader.fileChunks(meta.id, meta.chunks);
    if (chunks.some((c) => !c)) {
      warnings.push(`« ${meta.name} » : un morceau manque dans le cloud, fichier non sauvegardé cette fois.`);
      continue;
    }
    const bytes = Buffer.concat(chunks as Uint8Array[]);
    const sha = createHash('sha256').update(bytes).digest('hex');
    // Le même contrôle que l'appli à la réception : jamais un PDF abîmé dans une sauvegarde
    if (bytes.length !== meta.size || sha !== meta.sha256) {
      warnings.push(`« ${meta.name} » : contenu différent de son empreinte dans le cloud, fichier non sauvegardé cette fois.`);
      continue;
    }
    files.push({
      id: meta.id,
      name: meta.name,
      type: meta.type,
      size: meta.size,
      createdAt: meta.updatedAt,
      updatedAt: meta.updatedAt,
      deletedAt: null,
      data: bytes.toString('base64'),
    });
  }

  const prefs = parseJson(await reader.prefs());
  const backup: BackupFile = {
    app: 'notes-maths',
    version: 1,
    createdAt: now,
    folders: jsonList<Folder>(index.foldersJson, 'id'),
    notebooks: jsonList<Notebook>(index.notebooksJson, 'id'),
    pages,
    transcripts,
    files,
    todos: jsonList<Todo>(index.todosJson, 'id'),
    tombstones,
    ...(isRecord(prefs) ? { settings: prefs } : {}),
  };
  return {
    backup,
    warnings,
    counts: {
      folders: backup.folders.length,
      notebooks: backup.notebooks.length,
      pages: pages.length,
      files: files.length,
      todos: backup.todos.length,
    },
  };
}

/** « notes-maths-sauvegarde-AAAA-MM-JJ.json », à la date du fuseau de l'utilisateur */
export function backupFileName(date: Date, timeZone: string): string {
  let day: string;
  try {
    day = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  } catch {
    day = date.toISOString().slice(0, 10); // fuseau inconnu : date UTC
  }
  return `notes-maths-sauvegarde-${day}.json`;
}

/** Le fichier JSON tel qu'il sera téléversé (même mise en forme que l'export manuel : JSON compact) */
export function encodeBackup(backup: BackupFile): Buffer {
  return Buffer.from(JSON.stringify(backup), 'utf8');
}
