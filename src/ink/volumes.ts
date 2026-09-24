import type { ShapeKind } from './types';

/**
 * Volumes 3D dessinés en perspective dans le rectangle (x0, y0, w, h) : arêtes et courbes visibles en
 * continu, cachées à l'arrière en tirets (convention du dessin technique). Même géométrie pour l'écran
 * et le PDF (chemins SVG en mm). Sans DOM ni import de valeur : testé sous Node (`npm test`).
 */

/** Un tracé d'un volume : `hidden` = arête ou courbe cachée à l'arrière, toujours en tirets. */
export interface ShapePart {
  d: string;
  hidden?: boolean;
}

const f3 = (v: number) => v.toFixed(3);

const lineD = (ax: number, ay: number, bx: number, by: number) => `M${f3(ax)},${f3(ay)} L${f3(bx)},${f3(by)}`;
/** Ellipse entière (cercle vu en perspective). */
const ellipseD = (cx: number, cy: number, rx: number, ry: number) =>
  `M${f3(cx - rx)},${f3(cy)} A${f3(rx)},${f3(ry)} 0 0 1 ${f3(cx + rx)},${f3(cy)} A${f3(rx)},${f3(ry)} 0 0 1 ${f3(cx - rx)},${f3(cy)}`;
/** Moitié d'une ellipse : la face avant (en bas, visible) ou la face arrière (en haut, cachée). */
const halfEllipseD = (cx: number, cy: number, rx: number, ry: number, front: boolean) =>
  `M${f3(cx - rx)},${f3(cy)} A${f3(rx)},${f3(ry)} 0 0 ${front ? 0 : 1} ${f3(cx + rx)},${f3(cy)}`;

type V3 = [number, number, number];
type P2 = [number, number];

// ------------------------------------------------------------------ polyèdres convexes (cavalier)

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mean = (points: V3[]): V3 => [
  points.reduce((s, p) => s + p[0], 0) / points.length,
  points.reduce((s, p) => s + p[1], 0) / points.length,
  points.reduce((s, p) => s + p[2], 0) / points.length,
];

/**
 * Arêtes d'un polyèdre convexe en perspective cavalière, comme le pavé droit : la profondeur (Z) part vers
 * le haut et la droite. Sommets en coordonnées d'objet (X droite, Y haut, Z profondeur), faces = listes de
 * sommets ; le dessin remplit exactement le rectangle. Une arête est cachée quand aucune des deux faces qui
 * la bordent ne regarde vers l'observateur (règle des solides convexes).
 */
export function polyhedronParts(vertices: V3[], faces: number[][], kx: number, ky: number, x0: number, y0: number, w: number, h: number): ShapePart[] {
  const flat = vertices.map(([X, Y, Z]): P2 => [X + kx * Z, Y + ky * Z]);
  const minX = Math.min(...flat.map((p) => p[0]));
  const maxX = Math.max(...flat.map((p) => p[0]));
  const minY = Math.min(...flat.map((p) => p[1]));
  const maxY = Math.max(...flat.map((p) => p[1]));
  const sx = w / (maxX - minX || 1);
  const sy = h / (maxY - minY || 1);
  const at = (i: number): P2 => [x0 + (flat[i][0] - minX) * sx, y0 + h - (flat[i][1] - minY) * sy];

  // La direction de visée est celle que la projection écrase : de l'objet vers l'œil, (kx, ky, -1)
  const toEye: V3 = [kx, ky, -1];
  const center = mean(vertices);
  const facing = faces.map((face) => {
    const [a, b, c] = face.map((i) => vertices[i]);
    let normal = cross(sub(b, a), sub(c, a));
    // Normale vers l'extérieur : du centre du solide vers le centre de la face
    if (dot(normal, sub(mean(face.map((i) => vertices[i])), center)) < 0) normal = [-normal[0], -normal[1], -normal[2]];
    return dot(normal, toEye) > 1e-9;
  });

  const edges = new Map<string, { a: number; b: number; visible: boolean }>();
  faces.forEach((face, f) =>
    face.forEach((from, i) => {
      const to = face[(i + 1) % face.length];
      const key = from < to ? `${from}-${to}` : `${to}-${from}`;
      const edge = edges.get(key) ?? { a: Math.min(from, to), b: Math.max(from, to), visible: false };
      edge.visible = edge.visible || facing[f];
      edges.set(key, edge);
    }),
  );
  const parts = [...edges.values()].map(({ a, b, visible }): ShapePart => {
    const [ax, ay] = at(a);
    const [bx, by] = at(b);
    return visible ? { d: lineD(ax, ay, bx, by) } : { d: lineD(ax, ay, bx, by), hidden: true };
  });
  return [...parts.filter((p) => !p.hidden), ...parts.filter((p) => p.hidden)];
}

/** Prisme triangulaire droit posé sur une face rectangulaire : triangle de face devant, profondeur en arrière. */
const PRISM_VERTICES: V3[] = [
  [0, 0, 0],
  [1, 0, 0],
  [0.5, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [0.5, 1, 1],
];
const PRISM_FACES = [
  [0, 1, 2],
  [3, 4, 5],
  [0, 1, 4, 3],
  [0, 2, 5, 3],
  [1, 2, 5, 4],
];

/**
 * Tétraèdre : base triangulaire posée à plat (sommet arrière au milieu) et sommet au-dessus de son centre.
 * Vu de haut et de la droite, le sommet arrière ressort à droite de l'arête avant : seule l'arête arrière
 * gauche de la base est cachée, comme sur la figure de manuel.
 */
const TETRA_VERTICES: V3[] = [
  [0, 0, 0],
  [1, 0, 0],
  [0.5, 0, 1],
  [0.5, 1.05, 1 / 3],
];
const TETRA_FACES = [
  [0, 1, 2],
  [0, 1, 3],
  [1, 2, 3],
  [0, 2, 3],
];

// ------------------------------------------------------------------ courbes sur une surface (tore, ellipsoïde)

/** Une courbe du dessin, dans le carré unité (y vers le haut) ; `hidden` : passe derrière le volume. */
interface Curve {
  pts: P2[];
  hidden: boolean;
}

const SAMPLES = 120;

/**
 * Découpe une courbe fermée en morceaux continus, visibles ou cachés. Le point où la visibilité change
 * appartient aux deux morceaux voisins : le tracé reste continu.
 */
function splitRuns(pts: P2[], hidden: boolean[]): Curve[] {
  const n = pts.length;
  let start = 0;
  for (let i = 0; i < n; i++) {
    if (hidden[i] !== hidden[(i + n - 1) % n]) {
      start = i;
      break;
    }
  }
  const out: Curve[] = [];
  let run: P2[] = [pts[start]];
  let state = hidden[start];
  for (let k = 1; k <= n; k++) {
    const i = (start + k) % n;
    run.push(pts[i]);
    if (hidden[i] !== state) {
      out.push({ pts: run, hidden: state });
      run = [pts[i]];
      state = hidden[i];
    }
  }
  if (run.length > 1) out.push({ pts: run, hidden: state });
  return out;
}

/** Ramène des courbes (coordonnées d'écran, y vers le haut) dans le carré unité, sur l'étendue de `extent`. */
function normalize(curves: Curve[], extent: P2[]): Curve[] {
  const minX = Math.min(...extent.map((p) => p[0]));
  const maxX = Math.max(...extent.map((p) => p[0]));
  const minY = Math.min(...extent.map((p) => p[1]));
  const maxY = Math.max(...extent.map((p) => p[1]));
  const sx = 1 / (maxX - minX || 1);
  const sy = 1 / (maxY - minY || 1);
  return curves.map((c) => ({ hidden: c.hidden, pts: c.pts.map(([x, y]): P2 => [(x - minX) * sx, (y - minY) * sy]) }));
}

/** Les courbes du carré unité placées dans le rectangle (x0, y0, w, h), en chemins SVG. */
function curveParts(curves: Curve[], x0: number, y0: number, w: number, h: number): ShapePart[] {
  const parts = curves.map(({ pts, hidden }): ShapePart => {
    const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f3(x0 + x * w)},${f3(y0 + (1 - y) * h)}`).join(' ');
    return hidden ? { d, hidden: true } : { d };
  });
  return [...parts.filter((p) => !p.hidden), ...parts.filter((p) => p.hidden)];
}

/**
 * Le tore, vu de dessus sous une élévation de 40° : deux contours (extérieur, et bord du trou) et les deux
 * cercles de l'équateur, dont les parties cachées derrière le tube passent en tirets. La visibilité de
 * chaque point vient d'un vrai test : un rayon est lancé vers l'œil et s'il rentre dans le tore, le point
 * est caché. Le calcul se fait une fois (dessin en coordonnées unité), puis se place dans n'importe quel
 * rectangle : une mise à l'échelle des axes ne change pas ce qui est caché.
 */
let torusCache: Curve[] | null = null;
function torusCurves(): Curve[] {
  if (torusCache) return torusCache;
  const R = 1;
  const r = 0.42;
  const el = (40 * Math.PI) / 180;
  const eye: V3 = [0, -Math.cos(el), Math.sin(el)];
  const project = ([x, y, z]: V3): P2 => [x, z * Math.cos(el) + y * Math.sin(el)];
  const point = (u: number, v: number): V3 => [(R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r * Math.sin(v)];
  const inside = ([x, y, z]: V3) => (Math.hypot(x, y) - R) ** 2 + z * z - r * r;
  const occluded = (p: V3) => {
    // On part un peu au large de la surface : le point lui-même ne se cache pas
    for (let s = 0.08; s < 4; s += 0.04) {
      if (inside([p[0] + eye[0] * s, p[1] + eye[1] * s, p[2] + eye[2] * s]) < -0.01) return true;
    }
    return false;
  };
  const angles = Array.from({ length: SAMPLES }, (_, i) => (i / SAMPLES) * Math.PI * 2);
  // Contours apparents : là où la normale est perpendiculaire à la visée (deux branches, extérieure et intérieure)
  const silhouette = (branch: number) => angles.map((u) => point(u, Math.atan(Math.sin(u) / Math.tan(el)) + branch * Math.PI));
  const ring = (radius: number) => angles.map((u): V3 => [radius * Math.cos(u), radius * Math.sin(u), 0]);
  const curves: Curve[] = [];
  const extent: P2[] = [];
  for (const points of [silhouette(0), silhouette(1), ring(R + r), ring(R - r)]) {
    const flat = points.map(project);
    curves.push(...splitRuns(flat, points.map(occluded)));
    extent.push(...flat);
  }
  torusCache = normalize(curves, extent);
  return torusCache;
}

/**
 * L'ellipsoïde : contour, équateur et un méridien, vus sous une élévation de 26°. Sur une surface convexe,
 * un point est caché quand sa normale tourne le dos à l'observateur : les demi-courbes arrière passent en
 * tirets.
 */
let ellipsoidCache: Curve[] | null = null;
function ellipsoidCurves(): Curve[] {
  if (ellipsoidCache) return ellipsoidCache;
  const a = 1;
  const b = 0.72;
  const c = 0.62;
  const el = (26 * Math.PI) / 180;
  const eye: V3 = [0, -Math.cos(el), Math.sin(el)];
  const project = ([x, y, z]: V3): P2 => [x, z * Math.cos(el) + y * Math.sin(el)];
  const back = ([x, y, z]: V3) => dot([x / (a * a), y / (b * b), z / (c * c)], eye) <= 0;
  const angles = Array.from({ length: SAMPLES }, (_, i) => (i / SAMPLES) * Math.PI * 2);
  const psi = Math.PI / 3;
  const equator = angles.map((t): V3 => [a * Math.cos(t), b * Math.sin(t), 0]);
  const meridian = angles.map((t): V3 => [a * Math.cos(t) * Math.cos(psi), b * Math.cos(t) * Math.sin(psi), c * Math.sin(t)]);
  // Contour apparent : une ellipse de demi-axes a et sqrt((b sin)² + (c cos)²)
  const ry = Math.hypot(b * Math.sin(el), c * Math.cos(el));
  const outline = angles.map((t): P2 => [a * Math.cos(t), ry * Math.sin(t)]);
  const curves: Curve[] = [{ pts: [...outline, outline[0]], hidden: false }];
  for (const points of [equator, meridian]) curves.push(...splitRuns(points.map(project), points.map(back)));
  ellipsoidCache = normalize(curves, outline);
  return ellipsoidCache;
}

// ------------------------------------------------------------------ les volumes

const VOLUMES: ShapeKind[] = ['cylinder', 'cone', 'sphere', 'hemisphere', 'pyramid', 'cuboid', 'torus', 'prism', 'tetrahedron', 'ellipsoid'];
export const isVolume = (shape: ShapeKind) => VOLUMES.includes(shape);

/**
 * Les tracés d'un volume dans le rectangle (x0, y0, w, h) : arêtes visibles en continu, cachées en tirets.
 */
export function volumeParts(shape: ShapeKind, x0: number, y0: number, w: number, h: number): ShapePart[] {
  const x1 = x0 + w;
  const y1 = y0 + h;
  const cx = x0 + w / 2;
  const rx = w / 2;
  switch (shape) {
    case 'cylinder': {
      const ry = Math.max(0.6, Math.min(h * 0.17, w * 0.2));
      const top = y0 + ry;
      const bottom = y1 - ry;
      return [
        { d: ellipseD(cx, top, rx, ry) },
        { d: lineD(x0, top, x0, bottom) },
        { d: lineD(x1, top, x1, bottom) },
        { d: halfEllipseD(cx, bottom, rx, ry, true) },
        { d: halfEllipseD(cx, bottom, rx, ry, false), hidden: true },
      ];
    }
    case 'cone': {
      const ry = Math.max(0.6, Math.min(h * 0.17, w * 0.2));
      const bottom = y1 - ry;
      return [
        { d: lineD(cx, y0, x0, bottom) },
        { d: lineD(cx, y0, x1, bottom) },
        { d: halfEllipseD(cx, bottom, rx, ry, true) },
        { d: halfEllipseD(cx, bottom, rx, ry, false), hidden: true },
      ];
    }
    case 'sphere': {
      const ry = h / 2;
      const cy = y0 + ry;
      const e = Math.max(0.6, ry * 0.3);
      return [
        { d: ellipseD(cx, cy, rx, ry) },
        { d: halfEllipseD(cx, cy, rx, e, true) },
        { d: halfEllipseD(cx, cy, rx, e, false), hidden: true },
      ];
    }
    case 'hemisphere': {
      const e = Math.max(0.6, Math.min(h * 0.22, w * 0.18));
      const base = y1 - e;
      return [
        { d: `M${f3(x0)},${f3(base)} A${f3(rx)},${f3(Math.max(0.6, base - y0))} 0 0 1 ${f3(x1)},${f3(base)}` },
        { d: halfEllipseD(cx, base, rx, e, true) },
        { d: halfEllipseD(cx, base, rx, e, false), hidden: true },
      ];
    }
    case 'pyramid': {
      // Base carrée vue en oblique : l'arête arrière gauche est la seule cachée
      const dx = w * 0.24;
      const dy = h * 0.17;
      const fl = [x0, y1];
      const fr = [x1 - dx, y1];
      const br = [x1, y1 - dy];
      const bl = [x0 + dx, y1 - dy];
      const apex = [cx, y0];
      return [
        { d: lineD(fl[0], fl[1], fr[0], fr[1]) },
        { d: lineD(fr[0], fr[1], br[0], br[1]) },
        { d: lineD(apex[0], apex[1], fl[0], fl[1]) },
        { d: lineD(apex[0], apex[1], fr[0], fr[1]) },
        { d: lineD(apex[0], apex[1], br[0], br[1]) },
        { d: lineD(fl[0], fl[1], bl[0], bl[1]), hidden: true },
        { d: lineD(bl[0], bl[1], br[0], br[1]), hidden: true },
        { d: lineD(apex[0], apex[1], bl[0], bl[1]), hidden: true },
      ];
    }
    case 'prism':
      return polyhedronParts(PRISM_VERTICES, PRISM_FACES, 0.42, 0.36, x0, y0, w, h);
    case 'tetrahedron':
      return polyhedronParts(TETRA_VERTICES, TETRA_FACES, 0.6, 0.4, x0, y0, w, h);
    case 'torus':
      return curveParts(torusCurves(), x0, y0, w, h);
    case 'ellipsoid':
      return curveParts(ellipsoidCurves(), x0, y0, w, h);
    default: {
      // 'cuboid' : parallélépipède rectangle, profondeur vers le haut et la droite
      const dx = w * 0.26;
      const dy = h * 0.24;
      const ftl = [x0, y0 + dy];
      const ftr = [x1 - dx, y0 + dy];
      const fbr = [x1 - dx, y1];
      const fbl = [x0, y1];
      const btl = [x0 + dx, y0];
      const btr = [x1, y0];
      const bbr = [x1, y1 - dy];
      const bbl = [x0 + dx, y1 - dy];
      const edge = (a: number[], b: number[], hidden = false): ShapePart => ({ d: lineD(a[0], a[1], b[0], b[1]), hidden });
      return [
        edge(ftl, ftr),
        edge(ftr, fbr),
        edge(fbr, fbl),
        edge(fbl, ftl),
        edge(ftl, btl),
        edge(ftr, btr),
        edge(btl, btr),
        edge(fbr, bbr),
        edge(btr, bbr),
        edge(fbl, bbl, true),
        edge(bbl, bbr, true),
        edge(bbl, btl, true),
      ];
    }
  }
}

// ------------------------------------------------------------------ contours échantillonnés

/**
 * Les tracés d'un volume convertis en polylignes (mm), pour savoir où il y a VRAIMENT de l'encre : la gomme
 * ne doit effacer un volume que si elle touche une arête ou une courbe, pas en survolant son intérieur vide.
 * Les chemins produits ici n'utilisent que M, L et A (arcs d'ellipse à axes droits).
 */
export function volumePolylines(shape: ShapeKind, x0: number, y0: number, w: number, h: number): P2[][] {
  return volumeParts(shape, x0, y0, w, h).flatMap((part) => flattenPathD(part.d));
}

/** Échantillonne un chemin SVG (M/L/A seulement) en polylignes. */
export function flattenPathD(d: string): P2[][] {
  const lines: P2[][] = [];
  let current: P2[] = [];
  let cx = 0;
  let cy = 0;
  // « M12.5,3 A4,2 0 0 1 8,9 L1,2 » → [['M','12.5,3'], ['A','4,2 0 0 1 8,9'], …]
  const steps = d.match(/[MLA][^MLA]*/g) ?? [];
  for (const step of steps) {
    const cmd = step[0];
    const n = (step.slice(1).match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    if (cmd === 'M') {
      if (current.length >= 2) lines.push(current);
      cx = n[0];
      cy = n[1];
      current = [[cx, cy]];
    } else if (cmd === 'L') {
      cx = n[0];
      cy = n[1];
      current.push([cx, cy]);
    } else if (cmd === 'A') {
      const [rx, ry, , large, sweep, ex, ey] = n;
      for (const p of arcPoints(cx, cy, rx, ry, large === 1, sweep === 1, ex, ey)) current.push(p);
      cx = ex;
      cy = ey;
    }
  }
  if (current.length >= 2) lines.push(current);
  return lines;
}

/** Points d'un arc d'ellipse à axes droits, du point courant jusqu'à (ex, ey) (conversion SVG F.6.5). */
function arcPoints(sx: number, sy: number, rxIn: number, ryIn: number, large: boolean, sweep: boolean, ex: number, ey: number): P2[] {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (!rx || !ry || (sx === ex && sy === ey)) return [[ex, ey]];
  const dx2 = (sx - ex) / 2;
  const dy2 = (sy - ey) / 2;
  const lambda = (dx2 * dx2) / (rx * rx) + (dy2 * dy2) / (ry * ry);
  if (lambda > 1) {
    const k = Math.sqrt(lambda);
    rx *= k;
    ry *= k;
  }
  const denom = rx * rx * dy2 * dy2 + ry * ry * dx2 * dx2;
  const num = rx * rx * ry * ry - denom;
  const coef = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / denom));
  const cxp = (coef * rx * dy2) / ry;
  const cyp = (-coef * ry * dx2) / rx;
  const cx = cxp + (sx + ex) / 2;
  const cy = cyp + (sy + ey) / 2;
  const a0 = Math.atan2((dy2 - cyp) / ry, (dx2 - cxp) / rx);
  const a1 = Math.atan2((-dy2 - cyp) / ry, (-dx2 - cxp) / rx);
  let sweepAngle = a1 - a0;
  if (!sweep && sweepAngle > 0) sweepAngle -= Math.PI * 2;
  if (sweep && sweepAngle < 0) sweepAngle += Math.PI * 2;
  // Un point tous les ~0,5 mm de contour, entre 8 et 180 points
  const steps = Math.min(180, Math.max(8, Math.ceil((Math.abs(sweepAngle) * (rx + ry)) / 1)));
  const out: P2[] = [];
  for (let i = 1; i <= steps; i++) {
    const a = a0 + (sweepAngle * i) / steps;
    out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return out;
}
