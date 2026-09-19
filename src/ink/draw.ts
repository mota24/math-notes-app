import { getStroke } from 'perfect-freehand';
import type { StrokeOptions } from 'perfect-freehand';
import { PAGE_H, PAGE_W } from './types';
import { volumeParts } from './volumes';
import type { ShapePart } from './volumes';
import type { InkPoint, InputKind, PaperColor, PaperStyle, ShapeKind, Stroke, StrokeTool } from './types';

/**
 * perfect-freehand raisonne en « pixels » (un point isolé est décalé d'une unité) :
 * on lui passe des dixièmes de mm pour que les points et les petits traits restent nets.
 */
const PF_SCALE = 10;

export const HIGHLIGHT_ALPHA = 0.35;

function options(input: InputKind, size: number, last: boolean, tool: StrokeTool = 'pen'): StrokeOptions {
  if (tool === 'highlighter') {
    // Largeur constante, trait très lissé
    return { size: size * PF_SCALE, thinning: 0, smoothing: 0.5, streamline: 0.65, simulatePressure: false, last };
  }
  const real = input === 'pen';
  return {
    size: size * PF_SCALE,
    // Sans pression réelle (stylet capacitif), un trait régulier est plus lisible
    thinning: real ? 0.55 : 0.12,
    smoothing: 0.55,
    // Lisse le tremblement typique des stylets capacitifs
    streamline: real ? 0.4 : 0.5,
    simulatePressure: !real,
    last,
  };
}

function average(a: number, b: number) {
  return (a + b) / 2;
}

const f3 = (v: number) => v.toFixed(3);

/**
 * Courbe lissée passant par les milieux des points du contour, les points servant de contrôle.
 * Commandes Q explicites (et non T) : certains lecteurs PDF interprètent mal les T enchaînés.
 */
function outlineToPathData(outline: number[][]): string {
  const f = (v: number) => f3(v / PF_SCALE);
  const n = outline.length;
  let d = `M${f(outline[0][0])},${f(outline[0][1])}`;
  for (let i = 1; i < n - 1; i++) {
    const p = outline[i];
    const q = outline[i + 1];
    d += ` Q${f(p[0])},${f(p[1])} ${f(average(p[0], q[0]))},${f(average(p[1], q[1]))}`;
  }
  return d + ' Z';
}

/** Cercle en courbes de Bézier (compatible Canvas et PDF). */
function circlePathData(cx: number, cy: number, r: number): string {
  const k = 0.5523 * r;
  return (
    `M${f3(cx - r)},${f3(cy)} C${f3(cx - r)},${f3(cy - k)} ${f3(cx - k)},${f3(cy - r)} ${f3(cx)},${f3(cy - r)} ` +
    `C${f3(cx + k)},${f3(cy - r)} ${f3(cx + r)},${f3(cy - k)} ${f3(cx + r)},${f3(cy)} ` +
    `C${f3(cx + r)},${f3(cy + k)} ${f3(cx + k)},${f3(cy + r)} ${f3(cx)},${f3(cy + r)} ` +
    `C${f3(cx - k)},${f3(cy + r)} ${f3(cx - r)},${f3(cy + k)} ${f3(cx - r)},${f3(cy)} Z`
  );
}

/**
 * Tirets d'un trait en pointillés (mm) : proportionnels à l'épaisseur, avec un minimum pour rester
 * lisibles sur un trait fin. Même motif pour les formes, le trait au stylo et l'export PDF.
 */
export function dashPattern(weight: number): [number, number] {
  return [Math.max(2.5, weight * 6), Math.max(1.4, weight * 3)];
}

/** Découpe un tracé en tirets réguliers (longueur d'un tiret, longueur d'un espace, en mm). */
export function dashRuns(points: InkPoint[], dash: number, gap: number): InkPoint[][] {
  if (points.length < 2) return [points];
  const runs: InkPoint[][] = [];
  let run: InkPoint[] = [points[0]];
  let on = true;
  let left = dash;
  let [px, py, pp] = points[0];
  for (let i = 1; i < points.length; i++) {
    const [qx, qy, qp] = points[i];
    let segLen = Math.hypot(qx - px, qy - py);
    let sx = px;
    let sy = py;
    let sp = pp;
    while (segLen > left) {
      const t = left / segLen;
      const mx = sx + (qx - sx) * t;
      const my = sy + (qy - sy) * t;
      const mp = sp + (qp - sp) * t;
      if (on) {
        run.push([mx, my, mp]);
        runs.push(run);
        run = [];
      } else {
        run = [[mx, my, mp]];
      }
      on = !on;
      segLen -= left;
      sx = mx;
      sy = my;
      sp = mp;
      left = on ? dash : gap;
    }
    left -= segLen;
    if (on) run.push([qx, qy, qp]);
    px = qx;
    py = qy;
    pp = qp;
  }
  if (on && run.length) runs.push(run);
  return runs;
}

/** Contour du trait, chemin SVG en mm. En pointillés : un contour par tiret, dans un même chemin. */
export function outlinePathData(
  points: InkPoint[],
  input: InputKind,
  size: number,
  last: boolean,
  tool: StrokeTool = 'pen',
  dashed = false,
): string {
  if (dashed && tool !== 'highlighter' && points.length > 1) {
    const [dash, gap] = dashPattern(size);
    const runs = dashRuns(points, dash, gap);
    return runs.map((run, i) => outlinePathData(run, input, size, i === runs.length - 1 ? last : true, tool)).join(' ');
  }
  const scaled = points.map(([x, y, p]) => [x * PF_SCALE, y * PF_SCALE, p]);
  const outline = getStroke(scaled, options(input, size, last, tool));
  // Un simple point (virgule décimale, point du i…)
  if (outline.length < 4) return circlePathData(points[0][0], points[0][1], size / 2);
  return outlineToPathData(outline);
}

export function buildPath(
  points: InkPoint[],
  input: InputKind,
  size: number,
  last: boolean,
  tool: StrokeTool = 'pen',
  dashed = false,
): Path2D {
  return new Path2D(outlinePathData(points, input, size, last, tool, dashed));
}

/** Points régulièrement espacés d'un segment (outil règle). */
export function linePoints(a: InkPoint, b: InkPoint): InkPoint[] {
  const steps = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
  return Array.from({ length: steps + 1 }, (_, i): InkPoint => [a[0] + ((b[0] - a[0]) * i) / steps, a[1] + ((b[1] - a[1]) * i) / steps, 0.5]);
}

const dataCache = new WeakMap<Stroke, string>();
const pathCache = new WeakMap<Stroke, Path2D>();

export function strokeSvgPath(s: Stroke): string {
  let d = dataCache.get(s);
  if (d === undefined) {
    d = outlinePathData(s.points, s.input, s.size, true, s.tool, s.dashed);
    dataCache.set(s, d);
  }
  return d;
}

export function strokePath(s: Stroke): Path2D {
  let p = pathCache.get(s);
  if (!p) {
    p = new Path2D(strokeSvgPath(s));
    pathCache.set(s, p);
  }
  return p;
}

// ------------------------------------------------------------------ traits « image »
// Une formule glissée sur la page (voir src/export/insertImage.ts) : un PNG posé sur un rectangle.
// Le décodage est asynchrone ; on redemande un rendu (le seul auditeur courant : la page ouverte)
// dès qu'une image vient de finir de charger.

const imageCache = new WeakMap<Stroke, HTMLImageElement>();
let onImageReady: (() => void) | null = null;

/** À appeler une fois par page ouverte : redessine dès qu'une image de trait finit de charger. */
export function setImageReadyCallback(cb: (() => void) | null) {
  onImageReady = cb;
}

function strokeImage(s: Stroke): HTMLImageElement | null {
  let img = imageCache.get(s);
  if (!img) {
    if (!s.image) return null;
    img = new Image();
    img.onload = () => onImageReady?.();
    img.src = s.image;
    imageCache.set(s, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

// ------------------------------------------------------------------ traits « forme »
// Cercle/rectangle/triangle/flèche à main levée devenus parfaits (« dessiner → maintenir → ajuster »),
// ou tampons d'ingénierie posés depuis l'outil Formes. Rendu procédural (vectoriel) : net à tout zoom.

function arrowHead(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, size: number) {
  const angle = Math.atan2(y1 - y0, x1 - x0);
  const len = Math.max(size * 3.4, 3);
  const spread = 0.46;
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - len * Math.cos(angle - spread), y1 - len * Math.sin(angle - spread));
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - len * Math.cos(angle + spread), y1 - len * Math.sin(angle + spread));
}

/** Une flèche pleine (repères…) : hampe + tête triangulaire remplie, dans le style du trait, sans texte. */
function drawVector(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, w: number) {
  const angle = Math.atan2(y1 - y0, x1 - x0);
  const head = Math.max(w * 3.2, 3.5);
  const backX = x1 - head * Math.cos(angle);
  const backY = y1 - head * Math.sin(angle);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(backX, backY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(backX + (head * 0.55) * Math.sin(angle), backY - (head * 0.55) * Math.cos(angle));
  ctx.lineTo(backX - (head * 0.55) * Math.sin(angle), backY + (head * 0.55) * Math.cos(angle));
  ctx.closePath();
  ctx.fill();
}

/**
 * Chemin SVG d'une grande accolade « { » dessinée à la main (pas un glyphe de police) : une attache
 * verticale, presque droite, avec un petit crochet en haut et en bas, et une pointe nette qui se
 * referme au centre — comme au tableau, avec toute la hauteur libre à droite pour écrire à côté.
 */
export function bracePathD(x0: number, y0: number, y1: number, depth: number): string {
  const midY = (y0 + y1) / 2;
  const q = Math.min((y1 - y0) * 0.08, depth * 0.5);
  const hookIn = depth * 0.15;
  return (
    `M${f3(x0 + hookIn)},${f3(y0)} ` +
    `Q${f3(x0)},${f3(y0)} ${f3(x0)},${f3(y0 + q)} ` +
    `L${f3(x0)},${f3(midY - q)} ` +
    `Q${f3(x0)},${f3(midY)} ${f3(x0 + depth)},${f3(midY)} ` +
    `Q${f3(x0)},${f3(midY)} ${f3(x0)},${f3(midY + q)} ` +
    `L${f3(x0)},${f3(y1 - q)} ` +
    `Q${f3(x0)},${f3(y1)} ${f3(x0 + hookIn)},${f3(y1)}`
  );
}

/** Chemin SVG d'une grande parenthèse dessinée à la main : un seul arc, tenu par un bulbe horizontal. */
export function parenPathD(x: number, y0: number, y1: number, bulge: number, open: boolean): string {
  const midY = (y0 + y1) / 2;
  const dx = open ? -bulge : bulge;
  return (
    `M${f3(x)},${f3(y0)} ` +
    `C${f3(x + dx)},${f3(y0 + (midY - y0) * 0.55)} ${f3(x + dx)},${f3(midY + (y1 - midY) * 0.55)} ${f3(x)},${f3(y1)}`
  );
}

function drawParts(ctx: CanvasRenderingContext2D, parts: ShapePart[], weight: number, dashed: boolean) {
  const pattern = dashPattern(weight);
  for (const part of parts) {
    const broken = dashed || !!part.hidden;
    ctx.setLineDash(broken ? pattern : []);
    ctx.lineCap = broken ? 'butt' : 'round';
    ctx.stroke(new Path2D(part.d));
  }
}

/**
 * Dessine une forme (cercle/rectangle/triangle/ligne/flèche/repères/torseur/matrice/volumes) dans son
 * rectangle. `dashed` : contour en pointillés (les arêtes cachées des volumes le sont toujours).
 */
export function drawShapeOn(
  ctx: CanvasRenderingContext2D,
  shape: ShapeKind,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  color: string,
  weight: number,
  dashed = false,
) {
  const x0 = Math.min(ax, bx);
  const y0 = Math.min(ay, by);
  const x1 = Math.max(ax, bx);
  const y1 = Math.max(ay, by);
  const w = Math.max(1e-3, x1 - x0);
  const h = Math.max(1e-3, y1 - y0);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = weight;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const applyDash = () => {
    if (!dashed) return;
    ctx.setLineDash(dashPattern(weight));
    ctx.lineCap = 'butt';
  };
  switch (shape) {
    case 'circle':
      ctx.beginPath();
      ctx.ellipse(x0 + w / 2, y0 + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      applyDash();
      ctx.stroke();
      break;
    case 'rect':
      applyDash();
      ctx.strokeRect(x0, y0, w, h);
      break;
    case 'triangle':
      ctx.beginPath();
      ctx.moveTo(x0 + w / 2, y0);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x0, y1);
      ctx.closePath();
      applyDash();
      ctx.stroke();
      break;
    case 'arrow':
      // La pointe reste pleine même sur une hampe en pointillés
      ctx.beginPath();
      arrowHead(ctx, ax, ay, bx, by, weight);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      applyDash();
      ctx.stroke();
      break;
    case 'line':
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      applyDash();
      ctx.stroke();
      break;
    case 'cylinder':
    case 'cone':
    case 'sphere':
    case 'hemisphere':
    case 'pyramid':
    case 'cuboid':
    case 'torus':
    case 'prism':
    case 'tetrahedron':
    case 'ellipsoid':
      drawParts(ctx, volumeParts(shape, x0, y0, w, h), weight, dashed);
      break;
    case 'axes2d': {
      const ox = x0;
      const oy = y1;
      drawVector(ctx, ox, oy, x1, oy, weight);
      drawVector(ctx, ox, oy, ox, y0, weight);
      break;
    }
    case 'axes3d': {
      // Perspective cavalière (dessin technique) : z strictement vertical, y strictement horizontal,
      // x en diagonale à 45° vers le bas-gauche (profondeur). Origine placée pour laisser de la place
      // aux trois branches.
      const ox = x0 + w * 0.4;
      const oy = y0 + h * 0.62;
      const lenZ = (oy - y0) * 0.9;
      const lenY = (x1 - ox) * 0.9;
      const lenX = Math.min(ox - x0, y1 - oy) * 1.15;
      const diag = lenX * Math.SQRT1_2;
      drawVector(ctx, ox, oy, ox, oy - lenZ, weight);
      drawVector(ctx, ox, oy, ox + lenY, oy, weight);
      drawVector(ctx, ox, oy, ox - diag, oy + diag, weight);
      break;
    }
    case 'torseur': {
      // Grande accolade dessinée (pas un glyphe de police) : attache verticale à gauche, pointe nette
      // au centre, toute la hauteur du tampon reste libre à droite pour écrire la résultante et le moment.
      const spineX = x0 + w * 0.1;
      const topY = y0 + h * 0.04;
      const botY = y1 - h * 0.04;
      const depth = w * 0.42;
      ctx.stroke(new Path2D(bracePathD(spineX, topY, botY, depth)));
      const px = spineX + depth + Math.max(2.2, weight * 2.6);
      const py = (topY + botY) / 2;
      const r = Math.max(1.4, weight * 1.4);
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `italic ${Math.max(9, h * 0.2)}px Georgia, serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('A', px + r * 2.2, py);
      break;
    }
    case 'matrix': {
      // Deux grandes parenthèses dessinées, largement écartées : la place entre elles est pour les composantes.
      const topY = y0 + h * 0.04;
      const botY = y1 - h * 0.04;
      const bulge = w * 0.16;
      ctx.stroke(new Path2D(parenPathD(x0 + w * 0.12, topY, botY, bulge, true)));
      ctx.stroke(new Path2D(parenPathD(x1 - w * 0.12, topY, botY, bulge, false)));
      break;
    }
  }
  ctx.restore();
}

export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
  if (s.tool === 'shape' && s.shape && s.points.length >= 2) {
    const [ax, ay] = s.points[0];
    const [bx, by] = s.points[1];
    drawShapeOn(ctx, s.shape, ax, ay, bx, by, s.color, Math.max(0.35, s.size), s.dashed);
    return;
  }
  if (s.tool === 'image') {
    const img = strokeImage(s);
    if (!img || s.points.length < 2) return;
    const [x0, y0] = s.points[0];
    const [x1, y1] = s.points[1];
    ctx.drawImage(img, Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    return;
  }
  if (s.tool === 'highlighter') {
    ctx.save();
    ctx.globalAlpha = HIGHLIGHT_ALPHA;
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = s.color;
    ctx.fill(strokePath(s));
    ctx.restore();
    return;
  }
  ctx.fillStyle = s.color;
  ctx.fill(strokePath(s));
}

function lines(ctx: CanvasRenderingContext2D, color: string, draw: () => void) {
  ctx.beginPath();
  draw();
  ctx.strokeStyle = color;
  ctx.stroke();
}

/** Fond de page et couleur des réglures (light : papier blanc classique ; dark : papier noir, écriture claire). */
export const PAPER_BACKGROUND: Record<PaperColor, string> = { light: '#ffffff', dark: '#111214' };

/** Réglures : lignes [x1, y1, x2, y2] en mm et leur couleur, pour l'écran comme pour le PDF. */
export function paperLines(style: PaperStyle, width: number, height: number, color: PaperColor = 'light'): { color: string; lines: number[][] }[] {
  const h = (from: number, step: number) => {
    const out: number[][] = [];
    for (let y = from; y < height; y += step) out.push([0, y, width, y]);
    return out;
  };
  const v = (from: number, step: number) => {
    const out: number[][] = [];
    for (let x = from; x < width; x += step) out.push([x, 0, x, height]);
    return out;
  };
  if (color === 'dark') {
    switch (style) {
      case 'grid':
        return [{ color: '#31353d', lines: [...h(5, 5), ...v(5, 5)] }];
      case 'seyes':
        return [
          { color: '#292b33', lines: h(2, 2) },
          { color: '#454a58', lines: [...h(8, 8), ...v(8, 8)] },
          { color: '#7a3d3d', lines: [[32, 0, 32, height]] },
        ];
      case 'lined':
        return [
          { color: '#31353d', lines: h(24, 8) },
          { color: '#7a3d3d', lines: [[25, 0, 25, height]] },
        ];
      case 'blank':
        return [];
    }
  }
  switch (style) {
    case 'grid':
      return [{ color: '#cddcea', lines: [...h(5, 5), ...v(5, 5)] }];
    case 'seyes':
      return [
        { color: '#e3ddf3', lines: h(2, 2) },
        { color: '#b3a8dc', lines: [...h(8, 8), ...v(8, 8)] },
        { color: '#e8a3a3', lines: [[32, 0, 32, height]] },
      ];
    case 'lined':
      return [
        { color: '#cddcea', lines: h(24, 8) },
        { color: '#e8a3a3', lines: [[25, 0, 25, height]] },
      ];
    case 'blank':
      return [];
  }
}

/** Dessine la page (fond + réglures) dans le repère page (mm). */
export function drawPaper(
  ctx: CanvasRenderingContext2D,
  style: PaperStyle,
  cssPxPerMm: number,
  width = PAGE_W,
  height = PAGE_H,
  color: PaperColor = 'light',
  /** Zone de la page (mm, de haut en bas) réellement visible : sur une page très longue, on ne trace que ces réglures */
  yRange?: [number, number],
) {
  ctx.fillStyle = PAPER_BACKGROUND[color];
  ctx.fillRect(0, 0, width, height);
  ctx.lineWidth = 1 / cssPxPerMm; // 1 px CSS quel que soit le zoom
  const [from, to] = yRange ?? [0, height];
  for (const group of paperLines(style, width, height, color)) {
    lines(ctx, group.color, () => {
      for (const [x1, y1, x2, y2] of group.lines) {
        if (y2 < from || y1 > to) continue;
        ctx.moveTo(x1, Math.max(y1, from));
        ctx.lineTo(x2, Math.min(y2, to));
      }
    });
  }
}
