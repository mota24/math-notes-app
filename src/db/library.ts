import { plainText } from '../ai/notesText';
import { newId } from '../ink/types';
import type { PaperColor, PaperStyle } from '../ink/types';
import { pdfPageSizes } from '../pdf/pdfjs';
import { db } from './db';
import { NOTEBOOK_COLORS, PAPER_SIZES } from './schema';
import type { Folder, Notebook, Page, StoredFile, Todo } from './schema';

/** Opérations de la bibliothèque (dossiers, cahiers, pages, corbeille, recherche). */

const now = () => Date.now();

export interface Tombstone {
  kind: 'folder' | 'notebook' | 'page' | 'file' | 'transcript' | 'todo';
  deletedAt: number;
}

/** Suppressions définitives, transmises aux autres appareils par la synchronisation. */
async function addTombstones(entries: Record<string, Tombstone>) {
  const current = (await db.getMeta<Record<string, Tombstone>>('tombstones')) ?? {};
  await db.setMeta('tombstones', { ...current, ...entries });
}

export function blankPage(notebookId: string, paper: PaperStyle, paperColor: PaperColor = 'light'): Page {
  const t = now();
  return {
    id: newId(),
    notebookId,
    width: PAPER_SIZES.a4.width,
    height: PAPER_SIZES.a4.height,
    paper,
    paperColor,
    pdf: null,
    strokes: [],
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
  };
}

// ------------------------------------------------------------------ dossiers

export async function createFolder(name: string, parentId: string | null): Promise<Folder> {
  const t = now();
  const folders = await db.folders();
  const folder: Folder = {
    id: newId(),
    name: name.trim() || 'Nouveau dossier',
    parentId,
    color: NOTEBOOK_COLORS[folders.length % NOTEBOOK_COLORS.length],
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
  };
  await db.putFolder(folder);
  return folder;
}

export async function updateFolder(id: string, patch: Partial<Pick<Folder, 'name' | 'color' | 'parentId'>>) {
  const folder = await db.getFolder(id);
  if (!folder) return;
  if (patch.parentId !== undefined && patch.parentId !== null) {
    // Interdit de ranger un dossier dans lui-même ou dans un de ses sous-dossiers
    const path = await folderPath(patch.parentId);
    if (path.some((f) => f.id === id)) throw new Error('Impossible de déplacer un dossier dans lui-même.');
  }
  await db.putFolder({ ...folder, ...patch, updatedAt: now() });
}

/** Dossiers de la racine jusqu'à folderId inclus. */
export async function folderPath(folderId: string | null): Promise<Folder[]> {
  const folders = new Map((await db.folders()).map((f) => [f.id, f]));
  const path: Folder[] = [];
  const seen = new Set<string>();
  let current = folderId ? folders.get(folderId) : undefined;
  // Profondeur illimitée ; seul un cycle (données abîmées) arrête la montée
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parentId ? folders.get(current.parentId) : undefined;
  }
  return path;
}

async function descendants(folderId: string) {
  const folders = await db.folders();
  const notebooks = await db.notebooks();
  const ids = new Set([folderId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) {
        ids.add(f.id);
        grew = true;
      }
    }
  }
  return {
    folders: folders.filter((f) => ids.has(f.id)),
    notebooks: notebooks.filter((n) => n.folderId && ids.has(n.folderId)),
  };
}

export async function trashFolder(id: string) {
  const t = now();
  const { folders, notebooks } = await descendants(id);
  for (const f of folders) if (!f.deletedAt) await db.putFolder({ ...f, deletedAt: t, updatedAt: t });
  for (const n of notebooks) if (!n.deletedAt) await db.putNotebook({ ...n, deletedAt: t, updatedAt: t });
}

export async function restoreFolder(id: string) {
  const t = now();
  const folder = await db.getFolder(id);
  if (!folder) return;
  const { folders, notebooks } = await descendants(id);
  // Restaure ce qui a été supprimé en même temps que le dossier
  for (const f of folders) if (f.deletedAt === folder.deletedAt) await db.putFolder({ ...f, deletedAt: null, updatedAt: t });
  for (const n of notebooks) if (n.deletedAt === folder.deletedAt) await db.putNotebook({ ...n, deletedAt: null, updatedAt: t });
  // Si le parent est dans la corbeille, on remonte le dossier à la racine
  if (folder.parentId) {
    const parent = await db.getFolder(folder.parentId);
    if (!parent || parent.deletedAt) await updateFolder(id, { parentId: null });
  }
}

export async function purgeFolder(id: string) {
  const { folders, notebooks } = await descendants(id);
  for (const n of notebooks) await purgeNotebook(n.id);
  const t = now();
  const stones: Record<string, Tombstone> = {};
  for (const f of folders) {
    await db.deleteFolder(f.id);
    stones[f.id] = { kind: 'folder', deletedAt: t };
  }
  await addTombstones(stones);
}

// ------------------------------------------------------------------ cahiers

export async function createNotebook(options: {
  title: string;
  folderId: string | null;
  paper: PaperStyle;
  paperColor?: PaperColor;
  color?: string;
  subject?: string;
}): Promise<Notebook> {
  const t = now();
  const id = newId();
  const paperColor = options.paperColor ?? 'dark';
  const first = blankPage(id, options.paper, paperColor);
  const notebooks = await db.notebooks();
  const notebook: Notebook = {
    id,
    folderId: options.folderId,
    title: options.title.trim() || 'Sans titre',
    color: options.color ?? NOTEBOOK_COLORS[notebooks.length % NOTEBOOK_COLORS.length],
    paper: options.paper,
    paperColor,
    pageIds: [first.id],
    favorite: false,
    subject: options.subject ?? '',
    createdAt: t,
    updatedAt: t,
    openedAt: t,
    deletedAt: null,
  };
  await db.putPage(first);
  await db.putNotebook(notebook);
  return notebook;
}

/** Taille maximale d'un PDF importé : au-delà, la tablette peine à l'afficher et il ne tiendrait pas dans le cloud gratuit */
const MAX_PDF_BYTES = 80 * 1024 * 1024;

/**
 * Lit le PDF et prépare le fichier et ses pages, SANS rien écrire : un PDF illisible, protégé ou vide est
 * refusé avant toute écriture (plus de cahier vide ni de fichier orphelin laissés par un import raté).
 */
async function preparePdf(file: File, notebookId: string): Promise<{ stored: StoredFile; pages: Page[] }> {
  if (file.size > MAX_PDF_BYTES) throw new Error(`Ce PDF pèse ${Math.round(file.size / 1048576)} Mo : 80 Mo au maximum.`);
  const bytes = await file.arrayBuffer();
  let sizes: { width: number; height: number }[];
  try {
    sizes = await pdfPageSizes(bytes);
  } catch (e) {
    const name = (e as { name?: string })?.name ?? '';
    if (name === 'PasswordException') throw new Error('Ce PDF est protégé par un mot de passe : enlève la protection puis réimporte-le.', { cause: e });
    throw new Error('Ce fichier n’est pas un PDF lisible (fichier abîmé ou incomplet ?).', { cause: e });
  }
  if (sizes.length === 0) throw new Error('Ce PDF ne contient aucune page.');
  const t = now();
  const fileId = newId();
  const blob = new Blob([bytes], { type: 'application/pdf' });
  // Contrôle : le fichier stocké a bien la taille du fichier lu (pdf.js travaille sur une copie)
  if (blob.size !== file.size) throw new Error('Lecture du PDF incomplète : réessaie l’import.');
  const stored: StoredFile = { id: fileId, name: file.name, type: 'application/pdf', size: blob.size, blob, createdAt: t, updatedAt: t, deletedAt: null };
  const pages = sizes.map(
    (size, pageIndex): Page => ({
      ...blankPage(notebookId, 'blank'),
      width: size.width,
      height: size.height,
      pdf: { fileId, pageIndex },
    }),
  );
  return { stored, pages };
}

/** Un PDF devient un cahier : le fichier, ses pages et le cahier sont écrits d'un seul coup (tout ou rien). */
export async function importPdfNotebook(file: File, folderId: string | null): Promise<Notebook> {
  const id = newId();
  const { stored, pages } = await preparePdf(file, id);
  const t = now();
  const count = (await db.notebooks()).length;
  const notebook: Notebook = {
    id,
    folderId,
    title: file.name.replace(/\.pdf$/i, '').trim() || 'PDF importé',
    color: NOTEBOOK_COLORS[count % NOTEBOOK_COLORS.length],
    paper: 'blank',
    paperColor: 'dark',
    pageIds: pages.map((p) => p.id),
    favorite: false,
    subject: '',
    createdAt: t,
    updatedAt: t,
    openedAt: t,
    deletedAt: null,
  };
  await db.putBundle({ file: stored, pages, notebook });
  return notebook;
}

/** Ajoute les pages d'un PDF à la fin d'un cahier existant (fichier, pages et cahier : tout ou rien). */
export async function appendPdf(notebookId: string, file: File) {
  if (!(await db.getNotebook(notebookId))) return;
  const { stored, pages } = await preparePdf(file, notebookId);
  await db.putBundle({ file: stored, pages, appendTo: notebookId });
}

export async function updateNotebook(
  id: string,
  patch: Partial<Pick<Notebook, 'title' | 'color' | 'folderId' | 'favorite' | 'subject' | 'paper' | 'paperColor' | 'openedAt' | 'shareId'>>,
) {
  // Ouvrir un cahier ne compte pas comme une modification à synchroniser
  const touched = Object.keys(patch).some((k) => k !== 'openedAt');
  await db.mutateNotebook(id, (n) => ({ ...n, ...patch, updatedAt: touched ? now() : n.updatedAt }));
}

/** Le contenu d'une page a changé. */
export async function touchNotebook(id: string) {
  const t = now();
  await db.mutateNotebook(id, (n) => ({ ...n, updatedAt: t, openedAt: t }));
}

export async function trashNotebook(id: string) {
  const t = now();
  const notebook = await db.getNotebook(id);
  if (notebook) await db.putNotebook({ ...notebook, deletedAt: t, updatedAt: t });
}

export async function restoreNotebook(id: string) {
  const notebook = await db.getNotebook(id);
  if (!notebook) return;
  let folderId = notebook.folderId;
  if (folderId) {
    const folder = await db.getFolder(folderId);
    if (!folder || folder.deletedAt) folderId = null;
  }
  await db.putNotebook({ ...notebook, folderId, deletedAt: null, updatedAt: now() });
}

export async function purgeNotebook(id: string) {
  const t = now();
  const pages = await db.pagesOf(id);
  const stones: Record<string, Tombstone> = { [id]: { kind: 'notebook', deletedAt: t } };
  const fileIds = new Set(pages.flatMap((p) => [p.pdf?.fileId, p.image?.fileId].filter((id): id is string => !!id)));
  for (const page of pages) {
    for (const r of await db.resultsOf(page.id)) await db.deleteResult(r.id);
    await db.deletePage(page.id);
    stones[page.id] = { kind: 'page', deletedAt: t };
    stones[`transcript:${page.id}`] = { kind: 'transcript', deletedAt: t };
  }
  // Un PDF n'est supprimé que s'il n'est plus utilisé ailleurs
  const others = (await db.notebooks()).filter((n) => n.id !== id).map((n) => n.id);
  for (const fileId of fileIds) {
    let used = false;
    for (const nid of others) {
      if ((await db.pagesOf(nid)).some((p) => p.pdf?.fileId === fileId || p.image?.fileId === fileId)) used = true;
    }
    if (!used) {
      await db.deleteFile(fileId);
      stones[fileId] = { kind: 'file', deletedAt: t };
    }
  }
  await db.deleteNotebook(id);
  await addTombstones(stones);
}

/**
 * Vide la corbeille : suppression définitive de tout ce qui s'y trouve. Chaque élément laisse une pierre
 * tombale, que la synchronisation transmet aux autres appareils et au cloud (documents Firestore effacés).
 * Les dossiers d'abord — un dossier emporte ses sous-dossiers et ses cahiers — puis les cahiers mis à la
 * corbeille seuls. Renvoie le nombre d'éléments supprimés.
 */
export async function emptyTrash(): Promise<number> {
  const trashedFolders = (await db.folders()).filter((f) => f.deletedAt);
  const inTrash = new Set(trashedFolders.map((f) => f.id));
  let count = 0;
  // Seuls les dossiers « racines » de la corbeille : leurs descendants partent avec eux
  for (const f of trashedFolders) {
    if (f.parentId && inTrash.has(f.parentId)) continue;
    await purgeFolder(f.id);
    count++;
  }
  // Relu après les dossiers : ceux-ci ont déjà emporté les cahiers qu'ils contenaient
  for (const n of (await db.notebooks()).filter((nb) => nb.deletedAt)) {
    await purgeNotebook(n.id);
    count++;
  }
  return count;
}

// ------------------------------------------------------------------ pages

export async function addPage(notebookId: string, afterIndex: number): Promise<number> {
  const notebook = await db.getNotebook(notebookId);
  if (!notebook) return 0;
  const page = blankPage(notebookId, notebook.paper, notebook.paperColor ?? 'light');
  await db.putPage(page);
  let index = 0;
  await db.mutateNotebook(notebookId, (n) => {
    const pageIds = [...n.pageIds];
    index = Math.min(afterIndex + 1, pageIds.length);
    pageIds.splice(index, 0, page.id);
    return { ...n, pageIds, updatedAt: now() };
  });
  return index;
}

/** Photo (tableau, page de livre) ajoutée comme page annotable, réduite à 2400 px. */
export async function insertPhotoPage(notebookId: string, afterIndex: number, file: File): Promise<number> {
  const bitmap = await createImageBitmap(file);
  const ratio = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * ratio);
  canvas.height = Math.round(bitmap.height * ratio);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Photo illisible.'))), 'image/jpeg', 0.9),
  );
  const { width: photoW, height: photoH } = canvas;
  canvas.width = 0;
  const t = now();
  const fileId = newId();
  const stored: StoredFile = { id: fileId, name: file.name || 'photo.jpg', type: 'image/jpeg', size: blob.size, blob, createdAt: t, updatedAt: t, deletedAt: null };
  const page: Page = {
    ...blankPage(notebookId, 'blank'),
    width: 210,
    height: Math.round(((210 * photoH) / photoW) * 10) / 10,
    image: { fileId },
  };
  // Fichier et page d'abord, en une transaction ; la page n'apparaît dans le cahier qu'une fois tout écrit
  await db.putBundle({ file: stored, pages: [page] });
  let index = 0;
  await db.mutateNotebook(notebookId, (n) => {
    const pageIds = [...n.pageIds];
    index = Math.min(afterIndex + 1, pageIds.length);
    pageIds.splice(index, 0, page.id);
    return { ...n, pageIds, updatedAt: now() };
  });
  return index;
}

export async function removePage(notebookId: string, pageId: string) {
  return removePages(notebookId, [pageId]);
}

/** Supprime plusieurs pages d'un coup (sélection multiple dans « Toutes les pages »). */
export async function removePages(notebookId: string, pageIds: string[]) {
  const notebook = await db.getNotebook(notebookId);
  if (!notebook) return;
  const toDelete = new Set(pageIds);
  const t = now();
  for (const id of toDelete) {
    const page = await db.getPage(id);
    if (page) await db.putPage({ ...page, deletedAt: t, updatedAt: t });
  }
  const remaining = notebook.pageIds.filter((id) => !toDelete.has(id));
  const fresh = remaining.length === 0 ? blankPage(notebookId, notebook.paper, notebook.paperColor ?? 'light') : null;
  if (fresh) await db.putPage(fresh);
  await db.mutateNotebook(notebookId, (n) => {
    const pageIds2 = n.pageIds.filter((id) => !toDelete.has(id));
    if (pageIds2.length === 0 && fresh) pageIds2.push(fresh.id);
    return { ...n, pageIds: pageIds2, updatedAt: t };
  });
}

export async function movePage(notebookId: string, from: number, to: number) {
  await db.mutateNotebook(notebookId, (n) => {
    if (to < 0 || to >= n.pageIds.length) return n;
    const pageIds = [...n.pageIds];
    const [id] = pageIds.splice(from, 1);
    pageIds.splice(to, 0, id);
    return { ...n, pageIds, updatedAt: now() };
  });
}

// ------------------------------------------------------------------ à faire

export async function createTodo(text: string, dueAt: number | null): Promise<Todo> {
  const t = now();
  const todo: Todo = { id: newId(), text: text.trim(), dueAt, done: false, createdAt: t, updatedAt: t, deletedAt: null };
  await db.putTodo(todo);
  return todo;
}

export async function toggleTodo(todo: Todo) {
  await db.putTodo({ ...todo, done: !todo.done, updatedAt: now() });
}

/** Déplace une tâche à une autre date (ou la libère avec `null`), depuis le calendrier. */
export async function setTodoDue(todo: Todo, dueAt: number | null) {
  await db.putTodo({ ...todo, dueAt, updatedAt: now() });
}

/** Suppression définitive (pas de corbeille pour les tâches) : un tombstone porte l'info aux autres appareils. */
export async function removeTodo(id: string) {
  await db.deleteTodo(id);
  await addTombstones({ [id]: { kind: 'todo', deletedAt: now() } });
}

// ------------------------------------------------------------------ recherche

export interface SearchResults {
  folders: Folder[];
  notebooks: Notebook[];
  pages: { notebook: Notebook; pageIndex: number; snippet: string }[];
}

function normalize(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export async function search(query: string): Promise<SearchResults> {
  const q = normalize(query.trim());
  if (!q) return { folders: [], notebooks: [], pages: [] };
  const folders = (await db.folders()).filter((f) => !f.deletedAt && normalize(f.name).includes(q));
  const allNotebooks = (await db.notebooks()).filter((n) => !n.deletedAt);
  const byId = new Map(allNotebooks.map((n) => [n.id, n]));
  const notebooks = allNotebooks.filter((n) => normalize(`${n.title} ${n.subject}`).includes(q));
  const pages: SearchResults['pages'] = [];
  for (const t of await db.transcripts()) {
    const notebook = byId.get(t.notebookId);
    if (!notebook || t.deletedAt) continue;
    const text = plainText(t.blocks);
    const at = normalize(text).indexOf(q);
    if (at < 0) continue;
    const pageIndex = notebook.pageIds.indexOf(t.pageId);
    if (pageIndex < 0) continue;
    const start = Math.max(0, at - 40);
    pages.push({ notebook, pageIndex, snippet: `${start > 0 ? '…' : ''}${text.slice(start, at + q.length + 60)}…` });
  }
  return { folders, notebooks, pages: pages.slice(0, 50) };
}
