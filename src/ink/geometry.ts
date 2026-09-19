import type { BBox, InkPoint, Stroke } from './types';

const bboxCache = new WeakMap<Stroke, BBox>();

export function strokeBBox(s: Stroke): BBox {
  let bb = bboxCache.get(s);
  if (bb) return bb;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of s.points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const r = s.size / 2;
  bb = { minX: minX - r, minY: minY - r, maxX: maxX + r, maxY: maxY + r };
  bboxCache.set(s, bb);
  return bb;
}

export function unionBBox(boxes: BBox[]): BBox | null {
  if (boxes.length === 0) return null;
  const out = { ...boxes[0] };
  for (const b of boxes) {
    out.minX = Math.min(out.minX, b.minX);
    out.minY = Math.min(out.minY, b.minY);
    out.maxX = Math.max(out.maxX, b.maxX);
    out.maxY = Math.max(out.maxY, b.maxY);
  }
  return out;
}

export function pointInPolygon(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distToSegmentSq(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx - px;
  const cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}

/** Le point (x, y) touche-t-il le trait, à r mm près ? */
export function strokeHit(s: Stroke, x: number, y: number, r: number): boolean {
  const bb = strokeBBox(s);
  if (x < bb.minX - r || x > bb.maxX + r || y < bb.minY - r || y > bb.maxY + r) return false;
  // Une image ou une forme occupe tout son rectangle, pas juste la diagonale entre ses deux coins mesurés
  if (s.tool === 'image' || s.tool === 'shape') return true;
  const reach = r + s.size / 2;
  const reachSq = reach * reach;
  const pts = s.points;
  if (pts.length === 1) return distToSegmentSq(x, y, pts[0][0], pts[0][1], pts[0][0], pts[0][1]) <= reachSq;
  for (let i = 1; i < pts.length; i++) {
    if (distToSegmentSq(x, y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) <= reachSq) return true;
  }
  return false;
}

/** Marge (mm) autour d'un ruban où un tap le touche encore : un doigt n'est pas précis. */
const TAPE_TAP_PAD = 1.5;

/**
 * Le ruban d'étude touché en (x, y), le plus haut dans l'empilement d'abord (celui qu'on voit).
 * `skip` : les traits masqués, en cours de modification.
 */
export function tapeAt(strokes: readonly Stroke[], x: number, y: number, skip?: ReadonlySet<string>): Stroke | null {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i];
    if (s.tool === 'tape' && !skip?.has(s.id) && strokeHit(s, x, y, TAPE_TAP_PAD)) return s;
  }
  return null;
}

/**
 * Un ruban tracé presque droit devient une bande bien droite d'un bout à l'autre, comme un vrai ruban
 * adhésif. Un tracé qui s'écarte franchement de sa corde (courbe, coude) reste tel que dessiné.
 */
export function straightenedTape(points: InkPoint[], size: number): InkPoint[] {
  if (points.length < 3) return points;
  const [ax, ay] = points[0];
  const [bx, by] = points[points.length - 1];
  const len = Math.hypot(bx - ax, by - ay);
  if (len < Math.max(8, size * 1.5)) return points;
  const tolerance = Math.max(1, size * 0.3);
  for (const [x, y] of points) if (distToSegmentSq(x, y, ax, ay, bx, by) > tolerance * tolerance) return points;
  const steps = Math.max(2, Math.ceil(len));
  return Array.from({ length: steps + 1 }, (_, i): InkPoint => [ax + ((bx - ax) * i) / steps, ay + ((by - ay) * i) / steps, 0.5]);
}

function segmentsIntersect(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const o = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => (qx - px) * (ry - py) - (qy - py) * (rx - px);
  const d1 = o(ax, ay, bx, by, cx, cy);
  const d2 = o(ax, ay, bx, by, dx, dy);
  const d3 = o(cx, cy, dx, dy, ax, ay);
  const d4 = o(cx, cy, dx, dy, bx, by);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Distance² entre deux segments : 0 s'ils se croisent, sinon la plus courte des quatre distances point-segment. */
function segmentsDistSq(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): number {
  if (segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
  return Math.min(
    distToSegmentSq(ax, ay, cx, cy, dx, dy),
    distToSegmentSq(bx, by, cx, cy, dx, dy),
    distToSegmentSq(cx, cy, ax, ay, bx, by),
    distToSegmentSq(dx, dy, ax, ay, bx, by),
  );
}

/** Le tracé du lasso, allégé (un point tous les ~0,5 mm) et refermé sur son départ. */
function closedLasso(poly: [number, number][]): [number, number][] {
  const out: [number, number][] = [poly[0]];
  for (let i = 1; i < poly.length; i++) {
    const last = out[out.length - 1];
    if (Math.hypot(poly[i][0] - last[0], poly[i][1] - last[1]) >= 0.5) out.push(poly[i]);
  }
  const end = poly[poly.length - 1];
  if (out[out.length - 1] !== end) out.push(end);
  return out;
}

/**
 * Lasso « intelligent » : un élément est sélectionné dès que le lasso le touche, le croise, ou
 * l'entoure — même d'un tout petit bout. Le lasso est traité comme une forme fermée (son dernier
 * point rejoint le premier), et un simple trait qui traverse un élément suffit aussi.
 * Une image compte pour son rectangle plein. Une forme creuse (cadre, cercle, triangle, flèche,
 * accolade, matrice…) compte pour son contour seulement : un lasso tracé à l'intérieur d'un cadre,
 * autour du texte qu'il contient, ne prend pas le cadre avec. Repères et volumes, dessinés dans
 * toute leur boîte, comptent pour leur rectangle plein.
 */
export function strokesInLasso(strokes: Stroke[], poly: [number, number][]): string[] {
  if (poly.length < 2) return [];
  const lasso = closedLasso(poly);
  let lMinX = Infinity;
  let lMinY = Infinity;
  let lMaxX = -Infinity;
  let lMaxY = -Infinity;
  for (const [x, y] of lasso) {
    if (x < lMinX) lMinX = x;
    if (y < lMinY) lMinY = y;
    if (x > lMaxX) lMaxX = x;
    if (y > lMaxY) lMaxY = y;
  }
  const n = lasso.length;
  const edge = (i: number) => [lasso[i], lasso[(i + 1) % n]] as const;

  /** Un segment (a, b) épaissi de `reach` touche-t-il le contour du lasso ? */
  const touchesBoundary = (ax: number, ay: number, bx: number, by: number, reach: number) => {
    const sMinX = Math.min(ax, bx) - reach;
    const sMaxX = Math.max(ax, bx) + reach;
    const sMinY = Math.min(ay, by) - reach;
    const sMaxY = Math.max(ay, by) + reach;
    const reachSq = reach * reach;
    for (let i = 0; i < n; i++) {
      const [[cx, cy], [dx, dy]] = edge(i);
      if (Math.max(cx, dx) < sMinX || Math.min(cx, dx) > sMaxX || Math.max(cy, dy) < sMinY || Math.min(cy, dy) > sMaxY) continue;
      if (segmentsDistSq(ax, ay, bx, by, cx, cy, dx, dy) <= reachSq) return true;
    }
    return false;
  };

  /** Un tracé (points épaissis de `reach`) est-il entouré par le lasso, ou en touche-t-il le contour ? */
  const polylineHit = (pts: readonly (readonly number[])[], reach: number) => {
    for (const [x, y] of pts) {
      if (x >= lMinX - reach && x <= lMaxX + reach && y >= lMinY - reach && y <= lMaxY + reach && pointInPolygon(x, y, lasso)) return true;
    }
    if (pts.length === 1) return touchesBoundary(pts[0][0], pts[0][1], pts[0][0], pts[0][1], reach);
    for (let i = 1; i < pts.length; i++) {
      if (touchesBoundary(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], reach)) return true;
    }
    return false;
  };

  const ids: string[] = [];
  for (const s of strokes) {
    const bb = strokeBBox(s);
    if (bb.maxX < lMinX || bb.minX > lMaxX || bb.maxY < lMinY || bb.minY > lMaxY) continue;

    const outline = s.tool === 'shape' ? shapeHitLines(s) : null;
    if (outline) {
      const reach = s.size / 2 + 0.15;
      if (outline.some((part) => polylineHit(part, reach))) ids.push(s.id);
      continue;
    }

    if (s.tool === 'image' || s.tool === 'shape') {
      const corners: [number, number][] = [
        [bb.minX, bb.minY],
        [bb.maxX, bb.minY],
        [bb.maxX, bb.maxY],
        [bb.minX, bb.maxY],
      ];
      // Un sommet du lasso dans le rectangle, un coin du rectangle dans le lasso, ou un bord qui se croisent
      const vertexInside = lasso.some(([x, y]) => x >= bb.minX && x <= bb.maxX && y >= bb.minY && y <= bb.maxY);
      const cornerInside = corners.some(([x, y]) => pointInPolygon(x, y, lasso));
      let crossing = false;
      for (let i = 0; i < 4 && !crossing; i++) {
        const [ax, ay] = corners[i];
        const [bx, by] = corners[(i + 1) % 4];
        crossing = touchesBoundary(ax, ay, bx, by, 0);
      }
      if (vertexInside || cornerInside || crossing) ids.push(s.id);
      continue;
    }

    if (polylineHit(s.points, s.size / 2 + 0.15)) ids.push(s.id);
  }
  return ids;
}

/**
 * Gomme de précision : retire d'un tracé les parties à moins de `r` mm de la trajectoire de la gomme
 * (une capsule le long de ses positions successives) et renvoie les morceaux restants. `null` si la
 * gomme n'a rien touché ; une liste vide si tout a disparu. Le tracé est d'abord rééchantillonné (au
 * plus ~0,5 mm entre deux points) pour que la coupe reste nette même sur un trait fait de longs segments.
 */
export function eraseFromPolyline(points: InkPoint[], trail: InkPoint[], r: number): InkPoint[][] | null {
  if (points.length === 0 || trail.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  let tMinX = Infinity;
  let tMinY = Infinity;
  let tMaxX = -Infinity;
  let tMaxY = -Infinity;
  for (const [x, y] of trail) {
    if (x < tMinX) tMinX = x;
    if (y < tMinY) tMinY = y;
    if (x > tMaxX) tMaxX = x;
    if (y > tMaxY) tMaxY = y;
  }
  if (maxX < tMinX - r || minX > tMaxX + r || maxY < tMinY - r || minY > tMaxY + r) return null;

  const step = Math.max(0.15, Math.min(0.5, r / 3));
  const dense: InkPoint[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const [ax, ay, ap] = points[i - 1];
    const [bx, by, bp] = points[i];
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) / step);
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      dense.push([ax + (bx - ax) * t, ay + (by - ay) * t, ap + (bp - ap) * t]);
    }
  }

  const rSq = r * r;
  const segments: [InkPoint, InkPoint][] = trail.length === 1 ? [[trail[0], trail[0]]] : trail.slice(1).map((b, i): [InkPoint, InkPoint] => [trail[i], b]);
  const erased = dense.map(([x, y]) => segments.some(([a, b]) => distToSegmentSq(x, y, a[0], a[1], b[0], b[1]) <= rSq));
  if (!erased.includes(true)) return null;

  const runs: InkPoint[][] = [];
  let run: InkPoint[] = [];
  dense.forEach((pt, i) => {
    if (erased[i]) {
      if (run.length) runs.push(run);
      run = [];
    } else run.push(pt);
  });
  if (run.length) runs.push(run);
  // Un reste d'un seul point ne ferait qu'une tache isolée au bord de la coupe
  return runs.filter((part) => part.length >= 2);
}

/**
 * Les contours d'une forme simple, en polylignes, pour pouvoir l'effacer en partie. `null` pour ce qui
 * ne se découpe pas (image, repères, torseur, matrice, volumes : effacés en entier).
 */
export function shapePolylines(s: Stroke): InkPoint[][] | null {
  if (s.tool !== 'shape' || !s.shape || s.points.length < 2) return null;
  const [ax, ay] = s.points[0];
  const [bx, by] = s.points[1];
  const x0 = Math.min(ax, bx);
  const y0 = Math.min(ay, by);
  const x1 = Math.max(ax, bx);
  const y1 = Math.max(ay, by);
  const pt = (x: number, y: number): InkPoint => [x, y, 0.5];
  switch (s.shape) {
    case 'circle': {
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const rx = (x1 - x0) / 2;
      const ry = (y1 - y0) / 2;
      const n = Math.min(720, Math.max(48, Math.ceil((Math.PI * (rx + ry)) / 0.5)));
      return [Array.from({ length: n + 1 }, (_, i) => pt(cx + rx * Math.cos((i / n) * Math.PI * 2), cy + ry * Math.sin((i / n) * Math.PI * 2)))];
    }
    case 'rect':
      return [[pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1), pt(x0, y0)]];
    case 'triangle':
      return [[pt((x0 + x1) / 2, y0), pt(x1, y1), pt(x0, y1), pt((x0 + x1) / 2, y0)]];
    case 'line':
      return [[pt(ax, ay), pt(bx, by)]];
    case 'arrow': {
      const weight = Math.max(0.35, s.size);
      const angle = Math.atan2(by - ay, bx - ax);
      const len = Math.max(weight * 3.4, 3);
      return [
        [pt(ax, ay), pt(bx, by)],
        [pt(bx, by), pt(bx - len * Math.cos(angle - 0.46), by - len * Math.sin(angle - 0.46))],
        [pt(bx, by), pt(bx - len * Math.cos(angle + 0.46), by - len * Math.sin(angle + 0.46))],
      ];
    }
    default:
      return null;
  }
}

/**
 * Là où une forme a réellement de l'encre, pour la sélectionner au lasso : son contour pour les formes
 * simples, les deux côtés (accolades, parenthèses) pour torseur et matrice. `null` pour ce qui occupe
 * toute sa boîte (repères, volumes), qui se sélectionne alors comme un rectangle plein.
 */
function shapeHitLines(s: Stroke): InkPoint[][] | null {
  const simple = shapePolylines(s);
  if (simple) return simple;
  if ((s.shape !== 'torseur' && s.shape !== 'matrix') || s.points.length < 2) return null;
  const [ax, ay] = s.points[0];
  const [bx, by] = s.points[1];
  const x0 = Math.min(ax, bx);
  const x1 = Math.max(ax, bx);
  const y0 = Math.min(ay, by);
  const y1 = Math.max(ay, by);
  return [
    [
      [x0, y0, 0.5],
      [x0, y1, 0.5],
    ],
    [
      [x1, y0, 0.5],
      [x1, y1, 0.5],
    ],
  ];
}

/** Poignées de redimensionnement d'un objet sélectionné (forme ou image) : 8 autour du rectangle, ou les 2 bouts d'un segment. */
export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'start' | 'end';

/** Taille minimale (mm) d'un objet redimensionné : il ne s'écrase jamais en un simple trait. */
export const MIN_OBJECT_SIZE = 3;

/**
 * Nouveaux points d'un objet (deux points : coins opposés d'un rectangle, ou bouts d'un segment) quand
 * on tire une poignée de (dx, dy) mm. L'objet reste dans la page. `keepAspect` (images, coins seulement) :
 * le rectangle garde ses proportions, le coin opposé à la poignée reste fixe.
 */
export function resizedPoints(
  points: InkPoint[],
  handle: ResizeHandle,
  dx: number,
  dy: number,
  page: { width: number; height: number },
  keepAspect = false,
): InkPoint[] {
  const clampX = (v: number) => Math.min(page.width, Math.max(0, v));
  const clampY = (v: number) => Math.min(page.height, Math.max(0, v));
  if (handle === 'start' || handle === 'end') {
    const i = handle === 'start' ? 0 : 1;
    return points.map((p, k): InkPoint => (k === i ? [clampX(p[0] + dx), clampY(p[1] + dy), p[2]] : p));
  }
  const [a, b] = points;
  const minX0 = Math.min(a[0], b[0]);
  const maxX0 = Math.max(a[0], b[0]);
  const minY0 = Math.min(a[1], b[1]);
  const maxY0 = Math.max(a[1], b[1]);
  let minX = minX0;
  let maxX = maxX0;
  let minY = minY0;
  let maxY = maxY0;
  const west = handle.includes('w');
  const east = handle.includes('e');
  const north = handle.includes('n');
  const south = handle.includes('s');
  if (keepAspect) {
    const w0 = Math.max(1e-6, maxX0 - minX0);
    const h0 = Math.max(1e-6, maxY0 - minY0);
    const sW = (west ? w0 - dx : w0 + dx) / w0;
    const sH = (north ? h0 - dy : h0 + dy) / h0;
    let s = Math.abs(sW - 1) > Math.abs(sH - 1) ? sW : sH;
    const fixedX = west ? maxX0 : minX0;
    const fixedY = north ? maxY0 : minY0;
    const roomW = west ? fixedX : page.width - fixedX;
    const roomH = north ? fixedY : page.height - fixedY;
    s = Math.min(s, roomW / w0, roomH / h0);
    s = Math.max(s, MIN_OBJECT_SIZE / w0, MIN_OBJECT_SIZE / h0);
    const w = w0 * s;
    const h = h0 * s;
    minX = west ? fixedX - w : fixedX;
    maxX = west ? fixedX : fixedX + w;
    minY = north ? fixedY - h : fixedY;
    maxY = north ? fixedY : fixedY + h;
  } else {
    if (west) minX = Math.min(clampX(minX0 + dx), maxX0 - MIN_OBJECT_SIZE);
    if (east) maxX = Math.max(clampX(maxX0 + dx), minX0 + MIN_OBJECT_SIZE);
    if (north) minY = Math.min(clampY(minY0 + dy), maxY0 - MIN_OBJECT_SIZE);
    if (south) maxY = Math.max(clampY(maxY0 + dy), minY0 + MIN_OBJECT_SIZE);
  }
  return [
    [minX, minY, a[2]],
    [maxX, maxY, b[2]],
  ];
}
