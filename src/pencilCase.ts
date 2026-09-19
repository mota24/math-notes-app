import type { Tool } from './ink/types';

/**
 * La trousse : trois favoris dans la barre d'outils. Un favori garde un outil d'écriture, sa couleur et
 * son épaisseur (« Stylo rouge fin », « Surligneur jaune épais ») ; un tap le rappelle d'un coup.
 * Sans DOM : testé sous Node (`npm test`).
 */

export type PencilTool = 'pen' | 'highlighter' | 'tape';

export interface PencilSlot {
  tool: PencilTool;
  color: string;
  /** Épaisseur en mm (comme dans les réglages) */
  size: number;
  /** Trait en pointillés : seulement pour le stylo */
  dashed?: boolean;
}

export type PencilCase = (PencilSlot | null)[];

export const SLOT_COUNT = 3;

/** Deux exemples et un stylo bleu, pour que la trousse serve tout de suite ; chaque favori se remplace. */
export const DEFAULT_PENCIL_CASE: PencilCase = [
  { tool: 'pen', color: '#c0392b', size: 0.4 },
  { tool: 'highlighter', color: '#facc15', size: 5.3 },
  { tool: 'pen', color: '#1f4fbf', size: 0.66 },
];

export const TOOL_LABEL: Record<PencilTool, string> = { pen: 'Stylo', highlighter: 'Surligneur', tape: 'Ruban' };

/** Les épaisseurs sont en mm (indépendantes du zoom) ; le curseur, lui, parle en px d'écran. */
export const PX_PER_MM = 3.7795;
export const mmToPx = (mm: number) => Math.round(mm * PX_PER_MM * 2) / 2;

const COLOR_NAMES: Record<string, string> = {
  '#1d2433': 'noir',
  '#1f4fbf': 'bleu',
  '#c0392b': 'rouge',
  '#1e8449': 'vert',
  '#ffffff': 'blanc',
  '#facc15': 'jaune',
  '#4ade80': 'vert clair',
  '#f472b6': 'rose',
  '#60a5fa': 'bleu clair',
  '#fb923c': 'orange',
  '#a78bfa': 'violet',
};

export const colorName = (hex: string) => COLOR_NAMES[hex.toLowerCase()] ?? hex.toLowerCase();

const fmtPx = (px: number) => (px % 1 ? px.toFixed(1).replace('.', ',') : String(px));

/** « Stylo rouge, 1,5 px » */
export function describeSlot(slot: PencilSlot): string {
  return `${TOOL_LABEL[slot.tool]} ${colorName(slot.color)}${slot.dashed ? ' pointillé' : ''}, ${fmtPx(mmToPx(slot.size))} px`;
}

export interface InkSettings {
  color: string;
  size: number;
  dashed: boolean;
  highlightColor: string;
  highlightSize: number;
  tapeColor: string;
  tapeSize: number;
}

/**
 * Le favori que donnerait le réglage courant, ou `null` quand l'outil actif n'a ni couleur ni
 * épaisseur à mémoriser (gomme, lasso, formes…).
 */
export function slotFromCurrent(tool: Tool, s: InkSettings): PencilSlot | null {
  switch (tool) {
    case 'pen':
      return { tool: 'pen', color: s.color, size: s.size, ...(s.dashed ? { dashed: true } : {}) };
    case 'highlighter':
      return { tool: 'highlighter', color: s.highlightColor, size: s.highlightSize };
    case 'tape':
      return { tool: 'tape', color: s.tapeColor, size: s.tapeSize };
    default:
      return null;
  }
}

/** Les réglages à appliquer pour rappeler un favori (l'outil, lui, se règle à part). */
export function settingsPatchFor(slot: PencilSlot): Partial<InkSettings> {
  switch (slot.tool) {
    case 'pen':
      return { color: slot.color, size: slot.size, dashed: !!slot.dashed };
    case 'highlighter':
      return { highlightColor: slot.color, highlightSize: slot.size };
    case 'tape':
      return { tapeColor: slot.color, tapeSize: slot.size };
  }
}

/** Deux favoris identiques (couleur sans tenir compte de la casse, épaisseur à 0,02 mm près) */
export function sameSlot(a: PencilSlot | null, b: PencilSlot | null): boolean {
  if (!a || !b) return false;
  return a.tool === b.tool && a.color.toLowerCase() === b.color.toLowerCase() && Math.abs(a.size - b.size) < 0.02 && !!a.dashed === !!b.dashed;
}

const TOOLS: readonly string[] = ['pen', 'highlighter', 'tape'];

/**
 * La trousse lue dans les réglages enregistrés : toujours SLOT_COUNT emplacements, tout ce qui est
 * abîmé (ancienne version, réglage modifié à la main) est écarté au lieu de faire planter la barre.
 * Rien d'enregistré : les favoris d'origine.
 */
export function normalizePencilCase(raw: unknown): PencilCase {
  if (!Array.isArray(raw)) return DEFAULT_PENCIL_CASE.map((slot) => (slot ? { ...slot } : null));
  return Array.from({ length: SLOT_COUNT }, (_, i): PencilSlot | null => {
    const s = raw[i] as Partial<PencilSlot> | null | undefined;
    if (!s || typeof s !== 'object') return null;
    if (typeof s.tool !== 'string' || !TOOLS.includes(s.tool)) return null;
    if (typeof s.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(s.color)) return null;
    if (typeof s.size !== 'number' || !Number.isFinite(s.size)) return null;
    const size = Math.min(12, Math.max(0.1, s.size));
    return { tool: s.tool as PencilTool, color: s.color, size, ...(s.tool === 'pen' && s.dashed ? { dashed: true } : {}) };
  });
}
