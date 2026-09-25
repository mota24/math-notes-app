import type { BBox, InkPoint, Stroke } from './types';

const bboxCache = new WeakMap<Stroke, BBox>();

/**
 * Contour réel des formes que ce module ne sait pas décrire seul (repères, volumes 3D) : il est fourni par
 * draw.ts, qui connaît leur géométrie. Passer par un enregistrement garde geometry.ts sans import de valeur,
 * donc testable sous Node. Sans fournisseur (tests), on retombe sur l'ancien comportement (boîte pleine).
 */
let extraOutlines: ((s: Stroke) => InkPoint[][] | null) | null = null;
export function registerShapeOutlines(fn: (s: Stroke) => InkPoint[][] | null) {
  extraOutlines = fn;
}

/**
 * Une forme à deux coins (cercle, rectangle, volumes…) ou une image tourne par son `angle` ; une ligne,
 * une flèche et un trait à main levée tournent en réécrivant leurs points.
 */
export function rotates(s: Stroke): boolean {
  return s.tool === 'image' || s.tool === 'text' || (s.tool === 'shape' && s.shape !== 'line' && s.shape !== 'arrow');
}

/** Image ou zone de texte : un rectangle plein (on le touche partout dedans, pas seulement sur un trait) */
const isBox = (s: Stroke) => s.tool === 'image' || s.tool === 'text';

/** Boîte des points, épaisseur du trait comprise, sans tenir compte d'une éventuelle rotation. */
function pointsBounds(s: Stroke): BBox {
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
  // L'épaisseur du trait déborde des points ; pour une zone de texte, `size` est la taille du texte, pas un trait
  const r = s.tool === 'text' ? 0 : s.size / 2;
  return { minX: minX - r, minY: minY - r, maxX: maxX + r, maxY: maxY + r };
}

/** Un point tourné de `angle` autour de (cx, cy). */
function rotatePoint(x: number, y: number, cx: number, cy: number, angle: number): [number, number] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos];
}

/** Les quatre coins du rectangle d'une forme ou d'une image, tournés s'il y a lieu (sens horaire depuis le haut-gauche). */
export function strokeCorners(s: Stroke): [number, number][] {
  const b = pointsBounds(s);
  const corners: [number, number][] = [
    [b.minX, b.minY],
    [b.maxX, b.minY],
    [b.maxX, b.maxY],
    [b.minX, b.maxY],
  ];
  if (!rotates(s) || !s.angle) return corners;
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const angle = s.angle;
  return corners.map(([x, y]) => rotatePoint(x, y, cx, cy, angle));
}

export function strokeBBox(s: Stroke): BBox {
  let bb = bboxCache.get(s);
  if (bb) return bb;
  if (rotates(s) && s.angle && s.points.length >= 2) {
    const c = strokeCorners(s);
    bb = {
      minX: Math.min(...c.map((p) => p[0])),
      minY: Math.min(...c.map((p) => p[1])),
      maxX: Math.max(...c.map((p) => p[0])),
      maxY: Math.max(...c.map((p) => p[1])),
    };
  } else {
    bb = pointsBounds(s);
  }
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
  // Une image, un texte ou une forme occupe tout son rectangle, pas juste la diagonale entre ses deux coins mesurés
  if (isBox(s) || s.tool === 'shape') {
    if (s.tool === 'shape' && (s.shape === 'line' || s.shape === 'arrow') && s.points.length >= 2) {
      // Sa seule diagonale (et la pointe d'une flèche), pas toute la boîte qui l'entoure
      const wing = s.shape === 'arrow' ? 0.44 * Math.max(Math.max(0.35, s.size) * 3.4, 3) : 0;
      const reach = r + s.size / 2 + wing;
      return distToSegmentSq(x, y, s.points[0][0], s.points[0][1], s.points[1][0], s.points[1][1]) <= reach * reach;
    }
    // Une forme est creuse : on ne la touche qu'en touchant son trait, jamais en survolant son intérieur vide
    if (s.tool === 'shape') {
      const outline = shapeInkLines(s);
      if (outline) {
        const reach = r + s.size / 2;
        const reachSq = reach * reach;
        for (const line of outline) {
          for (let i = 1; i < line.length; i++) {
            if (distToSegmentSq(x, y, line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]) <= reachSq) return true;
          }
        }
        return false;
      }
    }
    if (!rotates(s) || !s.angle) return true;
    // Tournée : on ramène le point dans le repère de la forme, où son rectangle est à nouveau droit
    const own = pointsBounds(s);
    const [lx, ly] = rotatePoint(x, y, (own.minX + own.maxX) / 2, (own.minY + own.maxY) / 2, -s.angle);
    return lx >= own.minX - r && lx <= own.maxX + r && ly >= own.minY - r && ly <= own.maxY + r;
  }
  const reach = r + s.size / 2;
  const reachSq = reach * reach;
  const pts = s.points;
  if (pts.length === 1) return distToSegmentSq(x, y, pts[0][0], pts[0][1], pts[0][0], pts[0][1]) <= reachSq;
  for (let i = 1; i < pts.length; i++) {
    if (distToSegmentSq(x, y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) <= reachSq) return true;
  }
  return false;
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

    if (isBox(s) || s.tool === 'shape') {
      const corners = strokeCorners(s);
      // Un sommet du lasso dans le rectangle (tourné s'il l'est), un coin du rectangle dans le lasso, ou un bord qui se croisent
      const vertexInside = lasso.some(([x, y]) => pointInPolygon(x, y, corners));
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
  const lines = ownShapePolylines(s);
  return lines && spun(s, lines);
}

/** Les mêmes polylignes, tournées de l'angle de la forme autour de son centre (rien à faire sans rotation). */
function spun(s: Stroke, lines: InkPoint[][]): InkPoint[][] {
  if (!rotates(s) || !s.angle) return lines;
  const own = pointsBounds(s);
  const cx = (own.minX + own.maxX) / 2;
  const cy = (own.minY + own.maxY) / 2;
  const angle = s.angle;
  return lines.map((line) =>
    line.map(([x, y, p]): InkPoint => {
      const [nx, ny] = rotatePoint(x, y, cx, cy, angle);
      return [nx, ny, p];
    }),
  );
}

function ownShapePolylines(s: Stroke): InkPoint[][] | null {
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
/** Tout l'encre d'une forme : ce que ce module sait tracer, complété par le fournisseur de draw.ts. */
function shapeInkLines(s: Stroke): InkPoint[][] | null {
  const known = shapeHitLines(s);
  if (known) return known;
  const extra = extraOutlines?.(s);
  return extra && extra.length ? spun(s, extra) : null;
}

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
  return spun(s, [
    [
      [x0, y0, 0.5],
      [x0, y1, 0.5],
    ],
    [
      [x1, y0, 0.5],
      [x1, y1, 0.5],
    ],
  ]);
}

/**
 * Poignées d'étirement d'une forme seule : les 4 bords (et, pour l'API, les coins), ou les 2 bouts d'un
 * segment. Les coins de l'interface, eux, mettent à l'échelle sans déformer (voir `cornerScale`).
 */
export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'start' | 'end';

/** Taille minimale (mm) d'un objet redimensionné : il ne s'écrase jamais en un simple trait. */
export const MIN_OBJECT_SIZE = 3;

/**
 * Nouveaux points d'un objet (deux points : coins opposés d'un rectangle, ou bouts d'un segment) quand
 * on tire une poignée de (dx, dy) mm. L'objet reste dans la page.
 */
export function resizedPoints(
  points: InkPoint[],
  handle: ResizeHandle,
  dx: number,
  dy: number,
  page: { width: number; height: number },
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
  if (west) minX = Math.min(clampX(minX0 + dx), maxX0 - MIN_OBJECT_SIZE);
  if (east) maxX = Math.max(clampX(maxX0 + dx), minX0 + MIN_OBJECT_SIZE);
  if (north) minY = Math.min(clampY(minY0 + dy), maxY0 - MIN_OBJECT_SIZE);
  if (south) maxY = Math.max(clampY(maxY0 + dy), minY0 + MIN_OBJECT_SIZE);
  return [
    [minX, minY, a[2]],
    [maxX, maxY, b[2]],
  ];
}

/** La gomme n'efface jamais les images posées sur la page (on écrit souvent par-dessus) : seuls les traits et les formes. */
/** Images et zones de texte ne s'effacent pas à la gomme (on écrit par-dessus) : lasso → Supprimer */
export const isErasable = (s: Stroke): boolean => !isBox(s);

const TAU = Math.PI * 2;

/** Un angle ramené à ]-π, π] ; un angle quasi nul devient 0. */
export function normalizeAngle(a: number): number {
  let x = a % TAU;
  if (x > Math.PI) x -= TAU;
  else if (x <= -Math.PI) x += TAU;
  return Math.abs(x) < 1e-9 ? 0 : x;
}

/**
 * Une similitude : mise à l'échelle uniforme `k` et rotation `theta` autour de (px, py), puis
 * translation (dx, dy). p' = pivot + k · R(theta) · (p - pivot) + (dx, dy).
 */
export interface Similarity {
  px: number;
  py: number;
  k: number;
  theta: number;
  dx?: number;
  dy?: number;
}

/** Épaisseurs limites (mm) d'un trait qu'on agrandit ou réduit */
const MIN_STROKE = 0.1;
const MAX_STROKE = 40;
/** Taille d'un texte (mm) : de ~4 points à ~170 points */
const MIN_TEXT = 1.5;
const MAX_TEXT = 60;

/**
 * Le trait transformé. Un trait à main levée, une ligne ou une flèche : ses points sont réécrits (et
 * l'épaisseur d'un trait à main levée suit l'échelle). Une forme à deux coins ou une image : son centre
 * suit la similitude, ses demi-côtés suivent l'échelle et la rotation s'ajoute à son `angle` (un rectangle
 * défini par deux coins ne peut pas tourner autrement). L'épaisseur d'une forme ne change pas.
 */
export function transformStroke(s: Stroke, m: Similarity): Stroke {
  const cos = Math.cos(m.theta);
  const sin = Math.sin(m.theta);
  const map = (x: number, y: number): [number, number] => {
    const vx = x - m.px;
    const vy = y - m.py;
    return [m.px + m.k * (vx * cos - vy * sin) + (m.dx ?? 0), m.py + m.k * (vx * sin + vy * cos) + (m.dy ?? 0)];
  };
  if (rotates(s) && s.points.length >= 2) {
    const own = pointsBounds({ ...s, size: 0 });
    const cx = (own.minX + own.maxX) / 2;
    const cy = (own.minY + own.maxY) / 2;
    const [nx, ny] = map(cx, cy);
    const out: Stroke = { ...s, points: s.points.map(([x, y, p]): InkPoint => [nx + (x - cx) * m.k, ny + (y - cy) * m.k, p]) };
    // Un texte agrandi grossit avec sa boîte (comme une image), dans des limites lisibles
    if (s.tool === 'text') out.size = Math.min(MAX_TEXT, Math.max(MIN_TEXT, s.size * m.k));
    const angle = normalizeAngle((s.angle ?? 0) + m.theta);
    if (angle) out.angle = angle;
    else delete out.angle;
    return out;
  }
  const points = s.points.map(([x, y, p]): InkPoint => {
    const [nx, ny] = map(x, y);
    return [nx, ny, p];
  });
  const freehand = s.tool !== 'shape' && !isBox(s);
  return { ...s, points, size: freehand ? Math.min(MAX_STROKE, Math.max(MIN_STROKE, s.size * m.k)) : s.size };
}

/**
 * L'orientation (radians, sens horaire à l'écran) d'un trait seul : l'angle de sa ligne ou de sa flèche,
 * son `angle` pour une forme ou une image, 0 pour le reste. Sert de repère à l'aimantation de la rotation.
 */
export function orientation(s: Stroke): number {
  if (s.tool === 'shape' && (s.shape === 'line' || s.shape === 'arrow') && s.points.length >= 2) {
    return Math.atan2(s.points[1][1] - s.points[0][1], s.points[1][0] - s.points[0][0]);
  }
  return s.angle ?? 0;
}

/** Les quatre coins d'une sélection, où se tirent les poignées de mise à l'échelle. */
export type ScaleCorner = 'nw' | 'ne' | 'se' | 'sw';

/**
 * Mise à l'échelle proportionnelle par un coin : le coin opposé reste fixe, le facteur est la projection
 * du pointeur sur la diagonale (le coin suit le doigt sans jamais déformer). Le facteur reste assez grand
 * pour que la sélection ne s'écrase pas en un point, et assez petit pour qu'elle ne sorte pas de la page.
 */
export function cornerScale(
  box: BBox,
  corner: ScaleCorner,
  pointer: [number, number],
  page: { width: number; height: number },
): { k: number; anchor: [number, number] } {
  const west = corner.includes('w');
  const north = corner.includes('n');
  const anchor: [number, number] = [west ? box.maxX : box.minX, north ? box.maxY : box.minY];
  const dx = (west ? box.minX : box.maxX) - anchor[0];
  const dy = (north ? box.minY : box.maxY) - anchor[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { k: 1, anchor };
  let k = ((pointer[0] - anchor[0]) * dx + (pointer[1] - anchor[1]) * dy) / len2;
  const w = Math.abs(dx);
  const h = Math.abs(dy);
  // La sélection s'étend du coin fixe vers le haut/bas et la gauche/droite : elle atteint le bord de page la première
  let kMax = Infinity;
  if (w > 0) kMax = Math.min(kMax, (west ? anchor[0] : page.width - anchor[0]) / w);
  if (h > 0) kMax = Math.min(kMax, (north ? anchor[1] : page.height - anchor[1]) / h);
  const kMin = Math.max(0.05, MIN_OBJECT_SIZE / Math.max(w, h));
  k = Math.max(kMin, k);
  return { k: Math.min(kMax, k), anchor };
}

/**
 * De combien tourner la sélection quand le pointeur passe de `from` à `to` autour de `pivot`. Près d'un
 * multiple de 15° (angle final, en comptant l'orientation de départ `base`), la rotation s'aimante dessus :
 * remettre une ligne à l'horizontale ou à la verticale se fait sans viser.
 */
export function rotationDelta(
  pivot: [number, number],
  from: [number, number],
  to: [number, number],
  base = 0,
  step = Math.PI / 12,
  window = (3 * Math.PI) / 180,
): number {
  const theta = Math.atan2(to[1] - pivot[1], to[0] - pivot[0]) - Math.atan2(from[1] - pivot[1], from[0] - pivot[0]);
  const target = base + theta;
  const snapped = Math.round(target / step) * step;
  return normalizeAngle(Math.abs(target - snapped) <= window ? snapped - base : theta);
}

/** Le décalage (dx, dy) qui ramène des traits transformés dans la page, sans les déformer. */
export function fitShift(strokes: Stroke[], page: { width: number; height: number }): [number, number] {
  const box = unionBBox(strokes.map(strokeBBox));
  if (!box) return [0, 0];
  const dx = box.minX < 0 ? -box.minX : box.maxX > page.width ? Math.max(page.width - box.maxX, -box.minX) : 0;
  const dy = box.minY < 0 ? -box.minY : box.maxY > page.height ? Math.max(page.height - box.maxY, -box.minY) : 0;
  return [dx, dy];
}
