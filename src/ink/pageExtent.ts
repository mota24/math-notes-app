import type { Stroke } from './types';

/**
 * Canevas infini vers le bas : une page d'écriture s'allonge par feuilles A4 entières, comme du papier
 * qu'on déroule. Sa hauteur enregistrée suit ce qui est écrit (jamais de feuilles vides gardées) ; le
 * défilement, lui, peut aller plus loin le temps de la session. Sans DOM ni import de valeur : testé
 * sous Node.
 */

/** Une feuille A4 (mm), comme PAGE_H : l'unité d'allongement, et la coupure à l'impression et à l'export PDF */
export const SHEET_H = 297;

/** Longueur maximale d'un canevas, en feuilles (~9 m) : plus qu'assez, sans emballer la mémoire */
export const MAX_SHEETS = 30;
export const MAX_PAGE_HEIGHT = SHEET_H * MAX_SHEETS;

/** Un trait qui dépasse le bas d'une feuille de moins que ça (l'épaisseur du trait) n'en ouvre pas une nouvelle */
const OVERSHOOT_MM = 2;

/** Une page d'écriture s'allonge ; une page de PDF ou de photo garde la taille de son fond. */
export function isExtendable(page: { pdf?: unknown; image?: unknown }): boolean {
  return !page.pdf && !page.image;
}

/** Nombre de feuilles A4 qu'occupe une hauteur (au moins une) */
export function sheetCount(height: number): number {
  return Math.min(MAX_SHEETS, Math.max(1, Math.ceil((height - OVERSHOOT_MM) / SHEET_H)));
}

/** Hauteur enregistrée d'une page : les feuilles entières qui contiennent son encre, au moins une. */
export function fitHeight(strokes: readonly Stroke[]): number {
  // Le bas de chaque trait, épaisseur comprise (comme sa boîte englobante)
  let maxY = 0;
  for (const s of strokes) {
    const r = s.size / 2;
    for (const point of s.points) if (point[1] + r > maxY) maxY = point[1] + r;
  }
  return sheetCount(maxY) * SHEET_H;
}

/**
 * Hauteur à afficher pour qu'il reste au moins `ahead` mm de papier sous `y` : la hauteur actuelle
 * si elle suffit, sinon rallongée d'assez de feuilles entières. Ne raccourcit jamais.
 */
export function growHeight(current: number, y: number, ahead: number): number {
  const needed = y + ahead;
  if (needed <= current) return current;
  return Math.min(MAX_PAGE_HEIGHT, Math.max(current, Math.ceil(needed / SHEET_H) * SHEET_H));
}

/** Les feuilles d'une page longue, de haut en bas : où elles commencent et finissent (mm). */
export function sheetRanges(height: number): { top: number; bottom: number }[] {
  return Array.from({ length: sheetCount(height) }, (_, i) => ({
    top: i * SHEET_H,
    bottom: Math.min(height, (i + 1) * SHEET_H),
  }));
}
