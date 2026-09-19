import type { Folder, Notebook } from '../db/schema';
import type { PaperColor, PaperStyle } from '../ink/types';

/**
 * Ce que la bibliothèque calcule à partir de ses données (arbre des dossiers, chemin, compteurs, titre de la
 * page, papier en miniature), sans DOM ni import de valeur : testé sous Node (`npm test`).
 */

/** Profondeur maximale d'un dossier : garde-fou contre un cycle dans des données abîmées */
const MAX_DEPTH = 50;

const collator = new Intl.Collator('fr');

/** Un dossier et ses sous-dossiers, pour l'arbre de la barre latérale */
export interface FolderNode {
  folder: Folder;
  depth: number;
  children: FolderNode[];
}

/** Les dossiers présents (hors corbeille) en arbre, à partir de la racine ; chaque niveau est trié par nom. */
export function buildFolderTree(folders: readonly Folder[]): FolderNode[] {
  const childrenOf = new Map<string | null, Folder[]>();
  for (const f of folders) {
    if (f.deletedAt) continue;
    const list = childrenOf.get(f.parentId) ?? [];
    list.push(f);
    childrenOf.set(f.parentId, list);
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

/** De la racine jusqu'au dossier courant (le chemin affiché au-dessus du titre) */
export function folderPath(byId: ReadonlyMap<string, Folder>, current: Folder | undefined): Folder[] {
  const path: Folder[] = [];
  for (let f = current; f && path.length < MAX_DEPTH; f = f.parentId ? byId.get(f.parentId) : undefined) path.unshift(f);
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
