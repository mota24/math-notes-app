import type { InkPoint } from './types';

export type RecognizedShape = 'circle' | 'rect' | 'triangle' | 'arrow' | 'line';

/** En dessous de cette diagonale (mm), le tracé est trop petit pour qu'on tente une reconnaissance. */
const MIN_DIAG = 12;

function polylineLength(pts: [number, number][]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return d;
}

/** Aire du polygone (formule du lacet). */
function polygonArea(pts: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/**
 * Reconnaît un cercle, un rectangle, un triangle, une ligne ou une flèche dans un tracé à main
 * levée fini (appui long en fin de trait). Renvoie null si rien de net ne s'en dégage : le trait
 * reste un trait normal, rien ne change.
 *
 * Principe : un trait qui boucle (revient près de son départ) → une forme fermée, départagée par
 * sa forme (cercle, rectangle, triangle). Un trait qui ne boucle pas et reste droit jusqu'à son
 * point le plus loin du départ (la « pointe ») → une ligne, SAUF si un repli net suit cette pointe
 * (l'amorce d'une tête de flèche dessinée exprès, en un seul geste continu) : dans ce cas, une flèche.
 * Un simple trait droit, sans repli, ne devient donc jamais une flèche.
 */
export function recognizeShape(points: InkPoint[]): RecognizedShape | null {
  if (points.length < 4) return null;
  const pts: [number, number][] = points.map(([x, y]) => [x, y]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = maxX - minX;
  const h = maxY - minY;
  const diag = Math.hypot(w, h);
  if (diag < MIN_DIAG) return null;

  const path = polylineLength(pts);
  const [sx, sy] = pts[0];
  const [ex, ey] = pts[pts.length - 1];
  const gap = Math.hypot(ex - sx, ey - sy); // distance entre le départ et l'arrivée du trait
  const closed = gap < diag * 0.3;

  if (!closed) {
    // Le point le plus loin du départ : la fin du trait pour une ligne, la pointe pour une flèche
    // (un éventuel repli en dessinant la tête ramène le dernier point en arrière, pas la pointe).
    let tipIdx = 0;
    let tipDist = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i][0] - sx, pts[i][1] - sy);
      if (d > tipDist) {
        tipDist = d;
        tipIdx = i;
      }
    }
    if (tipDist < 1e-6) return null;
    let pathToTip = 0;
    for (let i = 1; i <= tipIdx; i++) pathToTip += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    // Pas assez droit jusqu'à la pointe : ni une ligne, ni l'amorce d'une flèche
    if (pathToTip > tipDist * 1.15 + 2) return null;

    let pathAfterTip = 0;
    for (let i = tipIdx + 1; i < pts.length; i++) pathAfterTip += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const [tx, ty] = pts[tipIdx];
    const backtrack = Math.hypot(ex - tx, ey - ty);
    // Repli net après la pointe : une vraie amorce de tête a été dessinée, pas juste un tremblement
    const hasHead = tipIdx < pts.length - 1 && pathAfterTip >= Math.max(3, tipDist * 0.12) && backtrack >= Math.max(2, tipDist * 0.08);
    return hasHead ? 'arrow' : 'line';
  }
  if (path < diag * 1.3) return null; // ni assez droit pour une ligne, ni assez refermé pour une forme

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const radii = pts.map(([x, y]) => Math.hypot(x - cx, y - cy));
  const meanR = radii.reduce((a, b) => a + b, 0) / radii.length;
  if (meanR < 1e-6) return null;
  const variance = radii.reduce((a, r) => a + (r - meanR) ** 2, 0) / radii.length;
  const relStd = Math.sqrt(variance) / meanR;
  // Même un carré varie d'environ 13 % (coin à ~0,71×côté, milieu de côté à 0,5×côté) : le seuil
  // doit rester net en dessous pour ne pas confondre un rectangle presque carré avec un cercle.
  if (relStd < 0.11) return 'circle';

  const area = polygonArea(pts);
  const bboxArea = Math.max(1, w * h);
  const fill = area / bboxArea;
  if (fill >= 0.65) return 'rect';
  if (fill >= 0.28) return 'triangle';
  return null;
}

/** Écart relatif largeur / hauteur en dessous duquel une ellipse devient un cercle, un rectangle un carré */
const SQUARE_TOLERANCE = 0.18;
/** Écart (degrés) sous lequel une ligne s'aligne sur l'horizontale, la verticale ou une diagonale à 45° */
const ANGLE_TOLERANCE = 7;

/**
 * « Géométriquement parfait » : la main tremble, la forme reconnue ne doit pas. Une ellipse presque ronde
 * devient un cercle, un rectangle presque carré un carré (le coin fixe `anchor` ne bouge pas, `far` est
 * recalé) ; une ligne ou une flèche presque horizontale, verticale ou à 45° s'aligne exactement, en gardant
 * sa longueur. Une forme franchement allongée ou penchée reste telle qu'elle a été dessinée.
 */
export function regularizeShape(kind: RecognizedShape, anchor: InkPoint, far: InkPoint): InkPoint {
  const dx = far[0] - anchor[0];
  const dy = far[1] - anchor[1];
  if (kind === 'line' || kind === 'arrow') {
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) return far;
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const snapped = Math.round(angle / 45) * 45;
    if (Math.abs(angle - snapped) > ANGLE_TOLERANCE) return far;
    const rad = (snapped * Math.PI) / 180;
    return [anchor[0] + length * Math.cos(rad), anchor[1] + length * Math.sin(rad), far[2]];
  }
  if (kind === 'triangle') return far;
  const w = Math.abs(dx);
  const h = Math.abs(dy);
  if (Math.max(w, h) < 1e-6 || Math.abs(w - h) / Math.max(w, h) > SQUARE_TOLERANCE) return far;
  const side = (w + h) / 2;
  return [anchor[0] + Math.sign(dx || 1) * side, anchor[1] + Math.sign(dy || 1) * side, far[2]];
}

/**
 * Le point du tracé le plus loin (distance euclidienne) d'un point donné. Sert à retrouver la
 * vraie pointe d'une flèche reconnue même si le geste s'est replié en dessinant sa tête.
 */
export function farthestPoint(points: InkPoint[], from: InkPoint): InkPoint {
  let best = points[0];
  let bestDist = -1;
  for (const p of points) {
    const d = Math.hypot(p[0] - from[0], p[1] - from[1]);
    if (d > bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}
