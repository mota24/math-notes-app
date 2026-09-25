import type { Folder, Notebook, Page } from '../db/schema';
import type { PaperColor, PaperStyle } from '../ink/types';

/**
 * Ce que la bibliothèque calcule à partir de ses données (arbre des dossiers, chemin, compteurs, titre de la
 * page, papier en miniature), sans DOM ni import de valeur : testé sous Node (`npm test`).
 */

/**
 * Profondeur illimitée en pratique : ce n'est qu'un garde-fou (les cycles sont de toute façon cassés par
 * `folderParents` et les chemins suivis avec un ensemble de dossiers déjà vus).
 */
const MAX_DEPTH = 10_000;

const collator = new Intl.Collator('fr');

/** Un dossier et ses sous-dossiers, pour l'arbre de la barre latérale */
export interface FolderNode {
  folder: Folder;
  depth: number;
  children: FolderNode[];
}

/**
 * Le parent EFFECTIF de chaque dossier présent (hors corbeille). Les données peuvent être abîmées par une
 * synchronisation croisée : un sous-dossier créé ici pendant que son parent était supprimé définitivement
 * ailleurs, ou deux dossiers déplacés l'un dans l'autre sur deux appareils (cycle A → B → A). Avant, ces
 * dossiers n'étaient plus accessibles depuis la racine : ils disparaissaient, avec tout leur contenu.
 *  - parent introuvable → rattaché à la racine ;
 *  - cycle → cassé au dossier d'identifiant le plus petit (toujours le même, sur tous les appareils), qui
 *    passe à la racine ;
 *  - parent à la corbeille → inchangé : le dossier est caché avec lui, comme son contenu.
 */
export function folderParents(folders: readonly Folder[]): Map<string, string | null> {
  const exists = new Set(folders.map((f) => f.id));
  const parents = new Map<string, string | null>();
  for (const f of folders) {
    if (f.deletedAt) continue;
    parents.set(f.id, f.parentId && exists.has(f.parentId) && f.parentId !== f.id ? f.parentId : null);
  }
  for (const start of parents.keys()) {
    const path: string[] = [];
    const seen = new Set<string>();
    let at: string | null | undefined = start;
    // On remonte tant qu'on reste parmi les dossiers présents (un parent à la corbeille arrête la montée)
    while (at && parents.has(at) && !seen.has(at)) {
      seen.add(at);
      path.push(at);
      at = parents.get(at);
    }
    if (at && seen.has(at)) {
      const cycle = path.slice(path.indexOf(at));
      parents.set(cycle.reduce((x, y) => (x < y ? x : y)), null);
    }
  }
  return parents;
}

/** Le dossier effectif d'un cahier : le sien s'il est présent, sinon la racine (dossier disparu ou à la corbeille). */
export function notebookFolder(notebook: Pick<Notebook, 'folderId'>, parents: ReadonlyMap<string, string | null>): string | null {
  return notebook.folderId && parents.has(notebook.folderId) ? notebook.folderId : null;
}

/** Les dossiers présents (hors corbeille) en arbre, à partir de la racine ; chaque niveau est trié par nom. */
export function buildFolderTree(folders: readonly Folder[]): FolderNode[] {
  const parents = folderParents(folders);
  const childrenOf = new Map<string | null, Folder[]>();
  for (const f of folders) {
    if (!parents.has(f.id)) continue;
    const parent = parents.get(f.id) ?? null;
    const list = childrenOf.get(parent) ?? [];
    list.push(f);
    childrenOf.set(parent, list);
  }
  const seen = new Set<string>();
  const level = (parentId: string | null, depth: number): FolderNode[] => {
    if (depth >= MAX_DEPTH) return [];
    const nodes: FolderNode[] = [];
    for (const folder of (childrenOf.get(parentId) ?? []).sort((a, b) => collator.compare(a.name, b.name))) {
      if (seen.has(folder.id)) continue;
      seen.add(folder.id);
      nodes.push({ folder, depth, children: level(folder.id, depth + 1) });
    }
    return nodes;
  };
  return level(null, 0);
}

/** Les nœuds qu'on voit à l'écran : un dossier n'affiche ses sous-dossiers que s'il est dans `open`. */
export function visibleNodes(tree: readonly FolderNode[], open: ReadonlySet<string>): FolderNode[] {
  const out: FolderNode[] = [];
  const walk = (nodes: readonly FolderNode[]) => {
    for (const node of nodes) {
      out.push(node);
      if (open.has(node.folder.id)) walk(node.children);
    }
  };
  walk(tree);
  return out;
}

/** De la racine jusqu'au dossier courant (le fil d'Ariane) ; un cycle dans des données abîmées s'arrête net. */
export function folderPath(byId: ReadonlyMap<string, Folder>, current: Folder | undefined): Folder[] {
  const path: Folder[] = [];
  const seen = new Set<string>();
  for (let f = current; f && !seen.has(f.id) && path.length < MAX_DEPTH; f = f.parentId ? byId.get(f.parentId) : undefined) {
    seen.add(f.id);
    path.unshift(f);
  }
  return path;
}

/** Ce que contient chaque dossier : nombre de sous-dossiers et de cahiers (hors corbeille) */
export interface Counts {
  folders: number;
  notebooks: number;
}

export function countChildren(folders: readonly Folder[], notebooks: readonly Notebook[]): Map<string, Counts> {
  const counts = new Map<string, Counts>();
  const of = (id: string) => {
    let c = counts.get(id);
    if (!c) counts.set(id, (c = { folders: 0, notebooks: 0 }));
    return c;
  };
  for (const f of folders) if (!f.deletedAt && f.parentId) of(f.parentId).folders++;
  for (const n of notebooks) if (!n.deletedAt && n.folderId) of(n.folderId).notebooks++;
  return counts;
}

/** « 2 dossiers · 3 cahiers » (les dossiers ne sont mentionnés que s'il y en a) */
export function countLabel({ folders, notebooks }: Counts = { folders: 0, notebooks: 0 }): string {
  return [folders && `${folders} dossier${folders > 1 ? 's' : ''}`, `${notebooks} cahier${notebooks > 1 ? 's' : ''}`].filter(Boolean).join(' · ');
}

/**
 * Le grand titre de la page. Il suit ce qu'on regarde : le résultat d'une recherche, la corbeille, le dossier
 * ouvert ; à l'accueil, ce sont les cahiers récents (ou « Bibliothèque » tant qu'il n'y en a aucun).
 */
export function viewTitle(view: { query: string; trash: boolean; folder?: Folder; hasRecents: boolean }): string {
  if (view.query.trim()) return 'Résultats';
  if (view.trash) return 'Corbeille';
  if (view.folder) return view.folder.name;
  return view.hasRecents ? 'Récents' : 'Bibliothèque';
}

/** Le papier d'un cahier en miniature : une couleur de fond et des réglures en dégradés CSS */
export interface PaperPreview {
  backgroundColor: string;
  backgroundImage?: string;
}

/**
 * Aux couleurs du vrai papier (voir `paperLines` dans ink/draw.ts) : la carte d'un cahier laisse deviner son
 * papier — carreaux, Seyès, lignes ou blanc, clair ou sombre — sans lire la moindre page.
 */
export function paperPreview(paper: PaperStyle, color: PaperColor = 'light'): PaperPreview {
  const dark = color === 'dark';
  const backgroundColor = dark ? '#111214' : '#ffffff';
  const fine = dark ? '#292b33' : '#e3ddf3';
  const line = dark ? '#31353d' : '#cddcea';
  const strong = dark ? '#454a58' : '#b3a8dc';
  const margin = dark ? '#7a3d3d' : '#e8a3a3';
  const horizontal = (c: string, step: number) => `repeating-linear-gradient(to bottom, ${c} 0 1px, transparent 1px ${step}px)`;
  const vertical = (c: string, step: number) => `repeating-linear-gradient(to right, ${c} 0 1px, transparent 1px ${step}px)`;
  switch (paper) {
    case 'grid':
      return { backgroundColor, backgroundImage: `${horizontal(line, 10)}, ${vertical(line, 10)}` };
    case 'seyes':
      return { backgroundColor, backgroundImage: `linear-gradient(to right, transparent 26px, ${margin} 26px 27px, transparent 27px), ${horizontal(strong, 16)}, ${vertical(strong, 16)}, ${horizontal(fine, 4)}` };
    case 'lined':
      return { backgroundColor, backgroundImage: `linear-gradient(to right, transparent 22px, ${margin} 22px 23px, transparent 23px), ${horizontal(line, 12)}` };
    case 'blank':
      return { backgroundColor };
  }
}

/** Ce que montre la couverture d'un cahier : la page du PDF, ou la photo, qui sert de fond à sa première page. */
export type CoverSource = { kind: 'pdf'; fileId: string; pageIndex: number } | { kind: 'image'; fileId: string };

export function coverSource(page: Pick<Page, 'pdf' | 'image'> | undefined): CoverSource | null {
  if (page?.pdf) return { kind: 'pdf', fileId: page.pdf.fileId, pageIndex: page.pdf.pageIndex };
  if (page?.image) return { kind: 'image', fileId: page.image.fileId };
  return null;
}

/** Clé de la miniature enregistrée : un fichier ne change jamais de contenu, la même page donne toujours la même image. */
export const coverKey = (s: CoverSource): string => (s.kind === 'pdf' ? `pdf-${s.fileId}-${s.pageIndex}` : `image-${s.fileId}`);

/**
 * Le visuel d'un cahier sans rien à montrer (papier blanc, PDF pas encore rendu ou absent de l'appareil) : un
 * dégradé discret tiré de la couleur du cahier, sur le gris des cartes.
 */
export const coverGradient = (color: string): string =>
  `radial-gradient(120% 140% at 50% 0%, color-mix(in srgb, ${color} 30%, transparent) 0%, transparent 70%), linear-gradient(160deg, color-mix(in srgb, ${color} 14%, #1c1d22) 0%, #141518 100%)`;

/** Ce que montre le mini-explorateur de l'écran partagé : un dossier (ses sous-dossiers et ses cahiers), ou une recherche */
export interface Browse {
  folders: Folder[];
  notebooks: Notebook[];
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'fr', { numeric: true, sensitivity: 'base' });
const byTitle = (a: Notebook, b: Notebook) => a.title.localeCompare(b.title, 'fr', { numeric: true, sensitivity: 'base' });
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Le contenu d'un dossier (`folderId`, null = racine), ou, si `query` n'est pas vide, les dossiers et cahiers de
 * TOUTE la bibliothèque dont le nom contient chaque mot tapé (sans accents ni majuscules ; un cahier se trouve
 * aussi par sa matière). Corbeille et cahier `exclude` (celui de l'éditeur) écartés.
 */
export function browseNotebooks(folders: readonly Folder[], notebooks: readonly Notebook[], folderId: string | null, query: string, exclude: string | null): Browse {
  const parents = folderParents(folders);
  const live = folders.filter((f) => parents.has(f.id));
  const books = notebooks.filter((n) => !n.deletedAt && n.id !== exclude && (!n.folderId || !folders.some((f) => f.id === n.folderId && f.deletedAt)));
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length) {
    const hit = (text: string) => words.every((w) => fold(text).includes(w));
    return { folders: live.filter((f) => hit(f.name)).sort(byName), notebooks: books.filter((n) => hit(`${n.title} ${n.subject}`)).sort(byTitle) };
  }
  return {
    folders: live.filter((f) => parents.get(f.id) === folderId).sort(byName),
    notebooks: books.filter((n) => notebookFolder(n, parents) === folderId).sort(byTitle),
  };
}
