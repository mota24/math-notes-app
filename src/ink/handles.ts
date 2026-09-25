import type { PointerEvent as ReactPointerEvent } from 'react';
import type { ResizeHandle, ScaleCorner } from './geometry';
import type { Stroke, View } from './types';

/**
 * Poignées de la sélection (mise à l'échelle, étirement, rotation) et du lasso de capture : où elles se
 * placent à l'écran, et le suivi d'un glissé de poignée. Rien ici ne touche au canevas lui-même.
 */

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Poignées du Lasso de capture : 4 coins + 4 milieux de bord, comme un crop d'image. */
export type Corner = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const CAPTURE_HANDLES: Corner[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
export const HANDLE_SIZE = 26;

/** Poignées de la sélection (diamètres en px) : les angles sont larges, pour un stylet capacitif */
export const CORNER_SIZE = 30;
export const EDGE_SIZE = 22;
export const ROTATE_SIZE = 34;
/** Distance entre le cadre de la sélection et la poignée de rotation (px) */
export const ROTATE_GAP = 42;
/** Largeur (px) du bandeau d'actions d'une sélection de traits, et d'une simple zone de lasso (moins de boutons) */
export const BAR_WIDTH = 640;
export const BAR_WIDTH_REGION = 260;

/** Cadre d'une sélection à l'écran (px) */
export interface ScreenBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface HandleView {
  id: ResizeHandle;
  /** Centre de la poignée (px) */
  left: number;
  top: number;
  size: number;
}

/**
 * Glissé d'une poignée de la sélection : les traits tels qu'ils seront au relâchement, pour que le cadre et
 * les poignées suivent l'aperçu au lieu de rester à la place d'origine.
 */
export interface TransformDrag {
  kind: 'scale' | 'rotate' | 'stretch';
  strokes: Stroke[];
  /** Rotation : où se tenait la poignée au départ (elle ne bouge pas pendant le glissé) */
  rot?: { left: number; top: number; above: boolean };
  /** Rotation : l'angle atteint (°), et où se tient le pointeur (px, dans la zone) pour l'afficher */
  angle?: number;
  at?: [number, number];
}

export const isCorner = (h: ResizeHandle): h is ScaleCorner => h === 'nw' || h === 'ne' || h === 'se' || h === 'sw';

/**
 * Les poignées autour du cadre : les 4 angles (mise à l'échelle proportionnelle), en plus le milieu des
 * bords pour une forme droite seule (étirement, si la place le permet), ou, pour une ligne ou une flèche
 * seule, les deux bouts (l'angle est libre).
 */
export function layoutHandles(box: ScreenBox, only: Stroke | null, view: View): HandleView[] {
  if (only && only.tool === 'shape' && (only.shape === 'line' || only.shape === 'arrow') && only.points.length >= 2) {
    return only.points.slice(0, 2).map(([x, y], i): HandleView => ({ id: i ? 'end' : 'start', left: x * view.scale + view.tx, top: y * view.scale + view.ty, size: EDGE_SIZE }));
  }
  const { left, top, width, height } = box;
  // Juste hors du cadre : sur une petite sélection, les angles ne se chevauchent jamais
  const off = 8;
  const out: HandleView[] = [
    { id: 'nw', left: left - off, top: top - off, size: CORNER_SIZE },
    { id: 'ne', left: left + width + off, top: top - off, size: CORNER_SIZE },
    { id: 'se', left: left + width + off, top: top + height + off, size: CORNER_SIZE },
    { id: 'sw', left: left - off, top: top + height + off, size: CORNER_SIZE },
  ];
  // Zone de texte seule : ses bords gauche et droit changent sa largeur (le texte revient à la ligne)
  if (only && only.tool === 'text' && !only.angle) {
    out.push({ id: 'w', left, top: top + height / 2, size: EDGE_SIZE }, { id: 'e', left: left + width, top: top + height / 2, size: EDGE_SIZE });
  }
  if (only && only.tool === 'shape' && !only.angle) {
    if (width >= 90) out.push({ id: 'n', left: left + width / 2, top, size: EDGE_SIZE }, { id: 's', left: left + width / 2, top: top + height, size: EDGE_SIZE });
    if (height >= 90) out.push({ id: 'w', left, top: top + height / 2, size: EDGE_SIZE }, { id: 'e', left: left + width, top: top + height / 2, size: EDGE_SIZE });
  }
  return out;
}

/** La poignée de rotation : sous le cadre (le bandeau d'actions est au-dessus), ou au-dessus s'il n'y a pas de place en bas. */
export function rotatePosition(box: ScreenBox, stage: { w: number; h: number }): { left: number; top: number; above: boolean } {
  const m = ROTATE_SIZE / 2 + 4;
  const left = clamp(box.left + box.width / 2, m, Math.max(m, stage.w - m));
  const below = box.top + box.height + ROTATE_GAP + ROTATE_SIZE / 2 <= stage.h - 6;
  const top = below ? box.top + box.height + ROTATE_GAP : clamp(box.top - ROTATE_GAP, m, Math.max(m, stage.h - m));
  return { left, top, above: !below };
}

/**
 * Glissé natif depuis une poignée, hors du classifieur anti-paume : `move` à chaque déplacement, `end` au
 * relâchement (`cancelled` : le système a annulé le contact, rien ne doit être appliqué). Les événements
 * sont suivis sur la fenêtre : la poignée peut être redessinée ou déplacée pendant le glissé sans que
 * celui-ci se perde.
 */
export function trackDrag(e: ReactPointerEvent<HTMLElement>, move: (ev: PointerEvent) => void, end?: (cancelled: boolean) => void) {
  e.preventDefault();
  e.stopPropagation();
  const id = e.pointerId;
  try {
    e.currentTarget.setPointerCapture(id);
  } catch {
    /* pointeur déjà relâché */
  }
  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId === id) move(ev);
  };
  const onEnd = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onEnd);
    window.removeEventListener('pointercancel', onEnd);
    end?.(ev.type === 'pointercancel');
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onEnd);
  window.addEventListener('pointercancel', onEnd);
}
