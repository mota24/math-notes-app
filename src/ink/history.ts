import type { Stroke } from './types';

/**
 * Historique d'une page (annuler / rétablir) : chaque geste est une action réversible sur la liste
 * des traits. Sans DOM ni import de valeur : testé sous Node (`tests/history.test.ts`).
 */
export type Action =
  | { type: 'add'; strokes: Stroke[] }
  | { type: 'remove'; items: { stroke: Stroke; index: number }[] }
  /** Déplacement, changement de couleur : état complet avant / après */
  | { type: 'replace'; before: Stroke[]; after: Stroke[] };

/** Sépare les traits dont l'id est dans `ids` (avec leur position, pour pouvoir les remettre) du reste. */
export function splitStrokes(list: Stroke[], ids: Set<string>) {
  const items: { stroke: Stroke; index: number }[] = [];
  const kept: Stroke[] = [];
  list.forEach((stroke, index) => (ids.has(stroke.id) ? items.push({ stroke, index }) : kept.push(stroke)));
  return { items, kept };
}

export function applyAction(list: Stroke[], a: Action): Stroke[] {
  if (a.type === 'add') return [...list, ...a.strokes];
  if (a.type === 'replace') return a.after;
  return splitStrokes(list, new Set(a.items.map((i) => i.stroke.id))).kept;
}

export function invertAction(list: Stroke[], a: Action): Stroke[] {
  if (a.type === 'add') return splitStrokes(list, new Set(a.strokes.map((s) => s.id))).kept;
  if (a.type === 'replace') return a.before;
  const out = list.slice();
  for (const it of [...a.items].sort((x, y) => x.index - y.index)) out.splice(Math.min(it.index, out.length), 0, it.stroke);
  return out;
}
