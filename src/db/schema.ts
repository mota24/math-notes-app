import type { Block } from '../ai/blocks';
import type { InkPoint, PaperColor, PaperStyle, Stroke } from '../ink/types';

/** Toutes les entités portent updatedAt / deletedAt : la synchronisation garde la version la plus récente. */
interface Versioned {
  id: string;
  createdAt: number;
  updatedAt: number;
  /** Corbeille (null = présent) */
  deletedAt: number | null;
}

export interface Folder extends Versioned {
  name: string;
  parentId: string | null;
  color: string;
}

export interface Notebook extends Versioned {
  folderId: string | null;
  title: string;
  color: string;
  paper: PaperStyle;
  /** Absent = clair (papier blanc), pour les cahiers créés avant l'ajout du papier sombre */
  paperColor?: PaperColor;
  /** Ordre des pages */
  pageIds: string[];
  favorite: boolean;
  /** Matière / contexte transmis à Gemini */
  subject: string;
  openedAt: number;
  /** Lien de partage en lecture seule (identifiant secret du document shares/<id> de Firestore) ; absent = non partagé */
  shareId?: string | null;
}

export interface PdfBackground {
  fileId: string;
  /** Index 0-based dans le PDF */
  pageIndex: number;
}

export interface Page extends Versioned {
  notebookId: string;
  /** Dimensions en mm */
  width: number;
  height: number;
  paper: PaperStyle;
  /** Absent = celle du cahier */
  paperColor?: PaperColor;
  pdf: PdfBackground | null;
  /** Photo en fond de page (tableau, livre…) ; absent sur les anciennes pages */
  image?: { fileId: string } | null;
  strokes: Stroke[];
}

export interface StoredFile extends Versioned {
  name: string;
  type: string;
  size: number;
  blob: Blob;
}

/** Transcription LaTeX d'une page entière (modifiable) */
export interface Transcript {
  pageId: string;
  notebookId: string;
  blocks: Block[];
  model: string;
  /** Nombre de traits au moment de la conversion : sert à signaler une transcription périmée */
  strokeCount: number;
  edited: boolean;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export type ResultSource = 'selection' | 'page' | 'image';

/** Conversion ponctuelle (sélection au lasso, photo importée) */
export interface ConversionResult {
  id: string;
  notebookId: string;
  pageId: string;
  source: ResultSource;
  createdAt: number;
  model: string;
  imageDataUrl: string;
  status: 'loading' | 'done' | 'error';
  progress?: string;
  blocks?: Block[];
  error?: string;
  errorKind?: string;
  durationMs?: number;
}

/**
 * Un caractère de TON écriture. Coordonnées en « em » : x ≥ 0 depuis le début du tracé,
 * y relatif à la ligne de base (négatif au-dessus). advance = largeur occupée.
 */
export interface Glyph {
  char: string;
  strokes: InkPoint[][];
  advance: number;
  updatedAt: number;
}

/** Tâche à faire, avec échéance optionnelle. Même contrat updatedAt/deletedAt que le reste : la synchronisation garde la version la plus récente. */
export interface Todo extends Versioned {
  text: string;
  /** Échéance (ms epoch), absente si pas de date */
  dueAt: number | null;
  done: boolean;
}

export interface PageVersion {
  notebookId: string;
  updatedAt: number;
  deletedAt: number | null;
}

export const PAPER_SIZES = { a4: { width: 210, height: 297 } } as const;

export const NOTEBOOK_COLORS = ['#2456c9', '#c0392b', '#1e8449', '#8e44ad', '#d68910', '#16a085', '#34495e', '#b03a5b'];
