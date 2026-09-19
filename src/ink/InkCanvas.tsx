import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { InputClassifier } from './palm';
import type { ClassifierConfig, ClassifierListener, Sample, TrackInfo } from './palm';
import { HIGHLIGHT_ALPHA, PAPER_BACKGROUND, buildPath, drawPaper, drawShapeOn, drawStroke, linePoints, setImageReadyCallback } from './draw';
import { eraseFromPolyline, resizedPoints, shapePolylines, strokeBBox, strokeHit, strokesInLasso, unionBBox } from './geometry';
import type { ResizeHandle } from './geometry';
import { SHEET_H, growHeight } from './pageExtent';
import { MultiColorSwatch } from './MultiColorSwatch';
import { farthestPoint, recognizeShape } from './shapeRecognize';
import { newId } from './types';
import type { BBox, InkPoint, InputKind, PaperColor, PaperStyle, ShapeKind, Stroke, Tool, View } from './types';

export interface InkStats {
  type: string;
  pressure: number;
  size: number;
  buttons: number;
  eventsPerSec: number;
  coalesced: number;
  predicted: boolean;
  /** pointercancel reçus (Android annule parfois les contacts qu'il prend pour une paume) */
  cancels: number;
  lowLatency: boolean;
  inspect: () => {
    mode: string;
    tracks: TrackInfo[];
    /** Journal des dernières décisions de l'anti-paume */
    decisions: string[];
    learnedPenSize: number | null;
    /** Taille de référence du stylet (apprise, retenue, ou le plus fin des contacts vus) */
    penReference: number | null;
    palmThreshold: number | null;
  };
}

interface Props {
  strokes: Stroke[];
  tool: Tool;
  color: string;
  size: number;
  paper: PaperStyle;
  paperColor: PaperColor;
  /** Dimensions de la page en mm */
  pageWidth: number;
  pageHeight: number;
  /** Page d'écriture : le canevas s'allonge vers le bas, par feuilles A4, quand on défile ou qu'on écrit près du bas */
  extendable: boolean;
  /** Page de PDF déjà rendue en image (sinon : papier réglé) */
  background: HTMLCanvasElement | null;
  /** Zoom courant (px CSS par mm), pour rendre le PDF à la bonne netteté */
  onScaleChange?(scale: number): void;
  config: Omit<ClassifierConfig, 'handTool' | 'restTop'>;
  /** Part basse de la zone (0 à 1) où la main peut se poser sans écrire */
  restZone: number;
  /** Dessiner chaque contact et son état sur la page (panneau anti-paume) */
  showContacts: boolean;
  /** Rendu « desynchronized » : moins de latence, mais pas supporté partout */
  lowLatency: boolean;
  penSeen: boolean;
  selection: string[];
  /** Zone entourée au lasso (mm), utile sur un PDF ou une photo même sans trait */
  selectionRegion: BBox | null;
  stats: { current: InkStats | null };
  /** Couleur et épaisseur du surligneur */
  highlightColor: string;
  highlightSize: number;
  /** Tampon choisi dans le sous-menu « Formes & tampons » : posé sur la page quand tool === 'shapes' */
  shapeKind: ShapeKind;
  /** Trait en pointillés (stylo et formes) */
  dashed: boolean;
  /** Gomme par trait (tout le trait touché) ou de précision (seulement la zone touchée) */
  eraserMode: 'stroke' | 'precision';
  /** Rayon de la gomme (px d'écran) */
  eraserSize: number;
  /** Zone du Lasso de capture (mm), encore ajustable par ses poignées tant qu'elle n'est pas copiée */
  captureRegion: BBox | null;
  onAddStroke(s: Stroke): void;
  onErase(ids: string[]): void;
  /** Gomme de précision : chaque trait touché est remplacé par ses morceaux restants (liste vide = effacé) */
  onReplaceStrokes(replacements: Map<string, Stroke[]>): void;
  /** Poignées d'un objet sélectionné (forme, image) : nouveaux points, à enregistrer (annulable) */
  onResizeStroke(id: string, points: InkPoint[]): void;
  onSelect(ids: string[], region?: BBox | null): void;
  onUndo(): void;
  onPenDetected(): void;
  /** Taille du stylet apprise (px) : retenue pour les prochaines sessions */
  onPenSize?(size: number): void;
  onConvertSelection(): void;
  onDeleteSelection(): void;
  onMoveSelection(dx: number, dy: number): void;
  onRecolorSelection(color: string): void;
  /** Palette de la barre de sélection : les 3 dernières couleurs choisies, la plus récente en premier */
  selectionColors: string[];
  /** Une teinte choisie avec la pastille multicolore : recolorer la sélection et l'ajouter en tête de la palette */
  onPickSelectionColor(color: string): void;
  onDuplicateSelection(): void;
  onCopySelection(): void;
  onCaptureRegion(region: BBox | null): void;
  onCopyCapture(): void;
}

/** 'move' : glisser la sélection du lasso. 'shape' : forme auto-reconnue, encore ajustable (stylo + appui long). */
type LiveTool = Tool | 'move' | 'shape' | 'resize';

interface Live {
  kind: InputKind;
  tool: LiveTool;
  color: string;
  size: number;
  points: InkPoint[];
  predicted: InkPoint[];
  erased: Set<string>;
  cursor: InkPoint | null;
  /** Déplacement en cours (mm) et traits déplacés */
  dx: number;
  dy: number;
  moving: Stroke[];
  /** tool === 'shape' (auto-reconnue) ou 'shapes' (tampon posé) */
  shapeKind?: ShapeKind;
  /** performance.now() du dernier « snap » (dessiner → maintenir) : sert au flash de confirmation */
  snapAt?: number;
  /** Trait en pointillés (stylo, formes) */
  dashed?: boolean;
  /** Gomme de précision : traits touchés pendant ce geste → morceaux restants (originaux masqués) */
  edits?: Map<string, Stroke[]>;
  /** tool === 'resize' : l'objet tel qu'il sera une fois la poignée relâchée */
  resized?: Stroke;
  /** tool === 'shape' : où était le stylet au « snap » et le coin qu'il tire, pour ajuster en glissant */
  follow?: { from: InkPoint; far: InkPoint };
}

/** Identifiant de l'aperçu d'un redimensionnement à la poignée (aucun vrai contact n'a cet id). */
const RESIZE_LIVE_ID = -1;

/** Durée (ms) du flash qui confirme visuellement le passage trait brouillon → forme parfaite. */
const SNAP_FLASH_MS = 260;

/** Canevas infini : papier gardé sous le bas de l'écran quand on défile (mm) et sous la plume quand on écrit (mm) */
const GROW_AHEAD_SCROLL = 100;
const GROW_AHEAD_INK = 45;

/** Taille (mm) d'un tampon posé d'un simple tap, sans glisser. */
const DEFAULT_SHAPE_SIZE: Record<ShapeKind, [number, number]> = {
  circle: [30, 30],
  rect: [40, 28],
  triangle: [36, 30],
  arrow: [40, 20],
  // 'line' n'est jamais un tampon (pas dans le sous-menu Formes) : seule l'Auto-shape le produit.
  line: [40, 20],
  axes2d: [45, 45],
  axes3d: [50, 45],
  torseur: [30, 60],
  matrix: [42, 60],
  cylinder: [28, 38],
  cone: [30, 38],
  sphere: [34, 34],
  hemisphere: [36, 26],
  pyramid: [36, 36],
  cuboid: [40, 32],
  torus: [44, 30],
  prism: [44, 32],
  tetrahedron: [38, 36],
  ellipsoid: [46, 30],
};

function shapeBBoxFromPoints(pts: InkPoint[]): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

const MIN_SCALE = 1;
const MAX_SCALE = 25;
const OUTSIDE = '#e6e2da';
/** Place laissée en haut pour la pilule d'outils flottante */
const TOP_GAP = 76;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const kindOf = (e: PointerEvent): InputKind =>
  e.pointerType === 'pen' ? 'pen' : e.pointerType === 'mouse' ? 'mouse' : 'touch';
const sampleOf = (e: PointerEvent): Sample => ({
  x: e.clientX,
  y: e.clientY,
  p: e.pressure,
  t: e.timeStamp,
  size: Math.max(e.width || 0, e.height || 0),
});

/** Poignées du Lasso de capture : 4 coins + 4 milieux de bord, comme un crop d'image. */
type Corner = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const CAPTURE_HANDLES: Corner[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const HANDLE_SIZE = 26;

export function InkCanvas(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const displayRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  const viewRef = useRef<View>({ scale: 3, tx: 16, ty: 16 });
  const hiddenRef = useRef(new Set<string>());
  const redrawRef = useRef<() => void>(() => {});
  const applyConfigRef = useRef<() => void>(() => {});
  /** Passerelle vers le canevas pour les poignées de redimensionnement (aperçu en direct, validation) */
  const resizeApiRef = useRef<{ begin(id: string): void; preview(s: Stroke): void; end(s: Stroke | null): void }>({
    begin: () => {},
    preview: () => {},
    end: () => {},
  });
  const [viewTick, setViewTick] = useState(0);

  useLayoutEffect(() => {
    propsRef.current = props;
  });
  /**
   * Hauteur du papier affiché (mm). Le canevas s'allonge à la demande, avant d'atteindre le bord : la
   * hauteur enregistrée de la page (`pageHeight`) ne suit que l'encre, celle-ci garde en plus le papier
   * déroulé en défilant, le temps de la session.
   */
  const minHeightRef = useRef(0);
  const pageH = () => {
    const p = propsRef.current;
    return p.extendable ? Math.max(p.pageHeight, minHeightRef.current) : p.pageHeight;
  };

  useEffect(() => {
    const container = containerRef.current!;
    const displayCanvas = displayRef.current!;
    // Une seule toile visible, opaque : une toile transparente « desynchronized » sous d'autres
    // éléments s'affiche en noir sur Android. La page est préparée hors écran puis recopiée.
    const display = displayCanvas.getContext('2d', { alpha: false, desynchronized: props.lowLatency })!;
    const baseCanvas = document.createElement('canvas');
    const base = baseCanvas.getContext('2d', { alpha: false })!;
    const size = { w: 1, h: 1, dpr: 1 };
    let rect = displayCanvas.getBoundingClientRect();
    let fitted = false;
    let baseRaf = 0;
    let presentRaf = 0;
    let tickRaf = 0;
    const lives = new Map<number, Live>();
    const eraserPointers = new Set<number>();
    const counter = { n: 0, coalesced: 0, since: performance.now() };

    let scaleTimer = 0;
    const reportScale = () => {
      window.clearTimeout(scaleTimer);
      scaleTimer = window.setTimeout(() => propsRef.current.onScaleChange?.(viewRef.current.scale), 250);
    };
    const clampView = (v: View): View => {
      const pw = propsRef.current.pageWidth * v.scale;
      const ph = pageH() * v.scale;
      const m = 48;
      const tx = pw + 2 * m <= size.w ? (size.w - pw) / 2 : clamp(v.tx, size.w - pw - m, m);
      const ty = ph + TOP_GAP + m <= size.h ? clamp(v.ty, TOP_GAP, size.h - ph - m) : clamp(v.ty, size.h - ph - m, TOP_GAP);
      return { scale: v.scale, tx, ty };
    };
    const setTransform = (ctx: CanvasRenderingContext2D) => {
      const v = viewRef.current;
      ctx.setTransform(size.dpr * v.scale, 0, 0, size.dpr * v.scale, size.dpr * v.tx, size.dpr * v.ty);
    };
    const toPage = (s: Sample, kind: InputKind): InkPoint => {
      const v = viewRef.current;
      const p = kind === 'pen' ? clamp(s.p || 0.5, 0.05, 1) : 0.5;
      return [(s.x - rect.left - v.tx) / v.scale, (s.y - rect.top - v.ty) / v.scale, p];
    };
    const eraserRadius = () => Math.max(0.4, propsRef.current.eraserSize / viewRef.current.scale);

    /** Recopie la page et dessine par-dessus ce qui est en cours (trait, lasso, gomme). */
    const present = () => {
      display.setTransform(1, 0, 0, 1, 0, 0);
      display.drawImage(baseCanvas, 0, 0);
      setTransform(display);
      const scale = viewRef.current.scale;
      for (const l of lives.values()) {
        if (l.tool === 'pen' || l.tool === 'highlighter') {
          const pts = l.predicted.length ? l.points.concat(l.predicted) : l.points;
          if (pts.length === 0) continue;
          const path = buildPath(pts, l.kind, l.size, false, l.tool, l.dashed);
          display.save();
          if (l.tool === 'highlighter') {
            display.globalAlpha = HIGHLIGHT_ALPHA;
            display.globalCompositeOperation = 'multiply';
          }
          display.fillStyle = l.color;
          display.fill(path);
          display.restore();
        } else if (l.tool === 'line' && l.points.length) {
          display.fillStyle = l.color;
          display.fill(buildPath(linePoints(l.points[0], l.points[l.points.length - 1]), 'mouse', l.size, true));
        } else if ((l.tool === 'shape' || l.tool === 'shapes') && l.shapeKind && l.points.length) {
          const a = l.points[0];
          const b = l.points[l.points.length - 1];
          // Flash net au moment du « snap » (dessiner → maintenir) : sans lui, un simple changement
          // de géométrie peut passer inaperçu en jetant un œil rapide à la tablette.
          if (l.snapAt !== undefined) {
            const elapsed = performance.now() - l.snapAt;
            if (elapsed < SNAP_FLASH_MS) {
              const pad = 4 / scale;
              const minX = Math.min(a[0], b[0]) - pad;
              const minY = Math.min(a[1], b[1]) - pad;
              const maxX = Math.max(a[0], b[0]) + pad;
              const maxY = Math.max(a[1], b[1]) + pad;
              display.save();
              display.globalAlpha = 0.4 * (1 - elapsed / SNAP_FLASH_MS);
              display.fillStyle = '#2563eb';
              if (display.roundRect) {
                display.beginPath();
                display.roundRect(minX, minY, maxX - minX, maxY - minY, 4 / scale);
                display.fill();
              } else {
                display.fillRect(minX, minY, maxX - minX, maxY - minY);
              }
              display.restore();
            } else {
              l.snapAt = undefined;
            }
          }
          drawShapeOn(display, l.shapeKind, a[0], a[1], b[0], b[1], l.color, Math.max(0.35, l.size), l.dashed);
        } else if (l.tool === 'resize' && l.resized) {
          drawStroke(display, l.resized);
        } else if (l.tool === 'move') {
          display.save();
          display.translate(l.dx, l.dy);
          for (const s of l.moving) drawStroke(display, s);
          display.restore();
        } else if (l.tool === 'lasso' && l.points.length > 1) {
          display.beginPath();
          l.points.forEach(([x, y], i) => (i ? display.lineTo(x, y) : display.moveTo(x, y)));
          display.fillStyle = 'rgba(37, 99, 235, 0.08)';
          display.fill();
          display.setLineDash([6 / scale, 4 / scale]);
          display.lineWidth = 1.5 / scale;
          display.strokeStyle = '#2563eb';
          display.stroke();
          display.setLineDash([]);
        } else if (l.tool === 'capture' && l.points.length) {
          const a = l.points[0];
          const b = l.points[l.points.length - 1];
          const rx = Math.min(a[0], b[0]);
          const ry = Math.min(a[1], b[1]);
          const rw = Math.abs(b[0] - a[0]);
          const rh = Math.abs(b[1] - a[1]);
          display.fillStyle = 'rgba(37, 99, 235, 0.08)';
          display.fillRect(rx, ry, rw, rh);
          display.setLineDash([6 / scale, 4 / scale]);
          display.lineWidth = 1.5 / scale;
          display.strokeStyle = '#2563eb';
          display.strokeRect(rx, ry, rw, rh);
          display.setLineDash([]);
        } else if (l.tool === 'eraser' && l.cursor) {
          // Gomme de précision : les morceaux restants des traits touchés (leurs originaux sont masqués)
          if (l.edits) for (const pieces of l.edits.values()) for (const piece of pieces) drawStroke(display, piece);
          const r = eraserRadius();
          display.beginPath();
          display.arc(l.cursor[0], l.cursor[1], r, 0, Math.PI * 2);
          display.fillStyle = 'rgba(107, 114, 128, 0.16)';
          display.fill();
          display.lineWidth = 1.4 / scale;
          display.strokeStyle = '#6b7280';
          display.stroke();
          // Petit point au centre : repère net, y compris quand la gomme vient de se déclencher toute
          // seule (appui long) et que le contact la recouvre encore.
          display.beginPath();
          display.arc(l.cursor[0], l.cursor[1], Math.max(0.6, r * 0.12), 0, Math.PI * 2);
          display.fillStyle = '#6b7280';
          display.fill();
        }
      }
      if (propsRef.current.showContacts) drawContacts();
    };

    /** Diagnostic : chaque contact posé sur l'écran, avec la couleur de sa décision. */
    const CONTACT_COLORS: Record<string, string> = {
      draw: '#2b59c3',
      palm: '#a8431a',
      pending: '#8a6100',
      gesture: '#6a4bc4',
    };
    const CONTACT_LABELS: Record<string, string> = { draw: 'écrit', palm: 'ignoré', pending: 'attente', gesture: 'geste' };
    const drawContacts = () => {
      const tracks = classifier.snapshot();
      if (tracks.length === 0) return;
      display.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
      display.save();
      display.font = '600 12px system-ui, sans-serif';
      display.textAlign = 'center';
      display.textBaseline = 'middle';
      for (const t of tracks) {
        const color = CONTACT_COLORS[t.state] ?? '#6b7280';
        const x = t.x - rect.left;
        const y = t.y - rect.top;
        const r = clamp(t.size / 2, 16, 120);
        display.globalAlpha = 0.1;
        display.fillStyle = color;
        display.beginPath();
        display.arc(x, y, r, 0, Math.PI * 2);
        display.fill();
        display.globalAlpha = 0.85;
        display.strokeStyle = color;
        display.lineWidth = 2;
        display.setLineDash(t.state === 'pending' ? [6, 5] : []);
        display.beginPath();
        display.arc(x, y, r, 0, Math.PI * 2);
        display.stroke();
        display.setLineDash([]);
        display.globalAlpha = 1;
        display.fillStyle = color;
        display.beginPath();
        display.arc(x, y, 4, 0, Math.PI * 2);
        display.fill();
        const label = `#${t.id % 1000} ${CONTACT_LABELS[t.state] ?? t.state}`;
        const w = display.measureText(label).width + 16;
        const top = y - r - 18;
        display.beginPath();
        if (display.roundRect) display.roundRect(x - w / 2, top - 11, w, 22, 11);
        else display.rect(x - w / 2, top - 11, w, 22);
        display.fill();
        display.fillStyle = '#ffffff';
        display.fillText(label, x, top);
      }
      display.restore();
      setTransform(display);
    };
    const redrawBase = () => {
      const p = propsRef.current;
      const v = viewRef.current;
      const ph = pageH();
      // Partie de la page réellement à l'écran (mm) : le reste d'une longue page n'a pas à être dessiné
      const top = -v.ty / v.scale - 2;
      const bottom = (size.h - v.ty) / v.scale + 2;
      base.setTransform(1, 0, 0, 1, 0, 0);
      base.fillStyle = OUTSIDE;
      base.fillRect(0, 0, baseCanvas.width, baseCanvas.height);
      setTransform(base);
      base.save();
      base.shadowColor = 'rgba(0,0,0,0.18)';
      base.shadowBlur = 10 * size.dpr;
      base.shadowOffsetY = 2 * size.dpr;
      base.fillStyle = p.background ? '#fff' : PAPER_BACKGROUND[p.paperColor];
      base.fillRect(0, 0, p.pageWidth, ph);
      base.restore();
      if (p.background) base.drawImage(p.background, 0, 0, p.pageWidth, ph);
      else drawPaper(base, p.paper, v.scale, p.pageWidth, ph, p.paperColor, [top, bottom]);
      // Où la page se coupe à l'impression et à l'export PDF : un trait fin, discret
      if (p.extendable && ph > SHEET_H + 0.5) {
        const dark = p.paperColor === 'dark';
        base.save();
        base.setLineDash([6 / v.scale, 4 / v.scale]);
        base.lineWidth = 1 / v.scale;
        base.strokeStyle = dark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.25)';
        base.fillStyle = dark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.42)';
        base.font = `600 ${10 / v.scale}px system-ui, sans-serif`;
        for (let k = 1; k * SHEET_H < ph - 0.5; k++) {
          const y = k * SHEET_H;
          if (y < top - 2 || y > bottom + 2) continue;
          base.beginPath();
          base.moveTo(0, y);
          base.lineTo(p.pageWidth, y);
          base.stroke();
          base.fillText(`Feuille ${k + 1}`, 3 / v.scale, y + 12 / v.scale);
        }
        base.restore();
      }
      for (const s of p.strokes) {
        if (hiddenRef.current.has(s.id)) continue;
        const bb = strokeBBox(s);
        if (bb.maxY < top || bb.minY > bottom) continue;
        drawStroke(base, s);
      }
      present();
    };
    const scheduleBase = () => {
      if (!baseRaf) baseRaf = requestAnimationFrame(() => ((baseRaf = 0), redrawBase()));
    };
    const schedulePresent = () => {
      if (!presentRaf) presentRaf = requestAnimationFrame(() => ((presentRaf = 0), present()));
    };
    const bumpTick = () => {
      if (!tickRaf) tickRaf = requestAnimationFrame(() => ((tickRaf = 0), setViewTick((t) => t + 1)));
    };
    redrawRef.current = scheduleBase;
    let resizingId: string | null = null;
    resizeApiRef.current = {
      begin(id) {
        resizingId = id;
        hiddenRef.current.add(id);
        scheduleBase();
      },
      preview(stroke) {
        lives.set(RESIZE_LIVE_ID, {
          kind: 'mouse', tool: 'resize', color: stroke.color, size: stroke.size, points: [], predicted: [], erased: new Set(),
          cursor: null, dx: 0, dy: 0, moving: [], resized: stroke,
        });
        present();
      },
      end(stroke) {
        lives.delete(RESIZE_LIVE_ID);
        if (stroke) {
          hiddenRef.current.delete(stroke.id);
          setTransform(base);
          drawStroke(base, stroke); // évite un clignotement avant le rendu React
        } else if (resizingId) {
          hiddenRef.current.delete(resizingId);
          scheduleBase();
        }
        resizingId = null;
        present();
      },
    };
    // Une image de trait (formule glissée sur la page) finit de se décoder de façon asynchrone :
    // dès que c'est fait, on redemande un rendu pour qu'elle apparaisse sans action de l'utilisateur.
    setImageReadyCallback(scheduleBase);

    /** Un trait touché par la gomme de précision : ses morceaux restants, ou null s'il n'est pas touché. */
    const precisionPieces = (s: Stroke, trail: InkPoint[], r: number): Stroke[] | null => {
      const polylines = s.tool === 'shape' ? shapePolylines(s) : s.tool === 'image' ? null : [s.points];
      if (!polylines) {
        // Image, repère, torseur, matrice, volume : pas découpable, effacé en entier dès qu'on le touche
        return trail.some(([x, y]) => strokeHit(s, x, y, r)) ? [] : null;
      }
      const style: Omit<Stroke, 'id' | 'points'> = {
        color: s.color,
        size: Math.max(0.35, s.size),
        input: s.tool === 'shape' ? 'mouse' : s.input,
        ...(s.tool === 'highlighter' ? { tool: 'highlighter' as const } : {}),
        ...(s.dashed ? { dashed: true } : {}),
      };
      let touched = false;
      const pieces: Stroke[] = [];
      for (const polyline of polylines) {
        const runs = eraseFromPolyline(polyline, trail, r + s.size / 2);
        if (!runs) {
          pieces.push({ ...style, id: newId(), points: polyline });
          continue;
        }
        touched = true;
        for (const run of runs) pieces.push({ ...style, id: newId(), points: run });
      }
      return touched ? pieces : null;
    };
    const eraseAt = (l: Live, pts: InkPoint[]) => {
      const r = eraserRadius();
      let changed = false;
      if (propsRef.current.eraserMode === 'precision') {
        // La trajectoire, depuis la dernière position : un coup de gomme rapide ne laisse pas de trou
        const trail: InkPoint[] = l.cursor ? [l.cursor, ...pts] : pts;
        const edits = (l.edits ??= new Map());
        // Les morceaux déjà découpés pendant ce geste peuvent l'être encore
        for (const [id, pieces] of edits) {
          const next: Stroke[] = [];
          let touched = false;
          for (const piece of pieces) {
            const runs = eraseFromPolyline(piece.points, trail, r + piece.size / 2);
            if (!runs) {
              next.push(piece);
              continue;
            }
            touched = true;
            for (const run of runs) next.push({ ...piece, id: newId(), points: run });
          }
          if (touched) {
            edits.set(id, next);
            changed = true;
          }
        }
        if (trail.length) {
          for (const s of propsRef.current.strokes) {
            if (hiddenRef.current.has(s.id)) continue;
            const pieces = precisionPieces(s, trail, r);
            if (!pieces) continue;
            hiddenRef.current.add(s.id);
            edits.set(s.id, pieces);
            changed = true;
          }
        }
      } else {
        for (const [x, y] of pts) {
          for (const s of propsRef.current.strokes) {
            if (hiddenRef.current.has(s.id) || !strokeHit(s, x, y, r)) continue;
            hiddenRef.current.add(s.id);
            l.erased.add(s.id);
            changed = true;
          }
        }
      }
      if (pts.length) l.cursor = pts[pts.length - 1];
      if (changed) scheduleBase();
    };
    /** L'encre ne doit jamais sortir de la page : un trait qui glisse dans la marge s'arrête net au bord. */
    const clampToPage = (pt: InkPoint): InkPoint => {
      const p = propsRef.current;
      return [clamp(pt[0], 0, p.pageWidth), clamp(pt[1], 0, pageH()), pt[2]];
    };
    /** Canevas infini : déroule assez de feuilles pour qu'il reste `ahead` mm de papier sous `y`. */
    const growFor = (y: number, ahead: number) => {
      if (!propsRef.current.extendable) return;
      const current = pageH();
      const grown = growHeight(current, y, ahead);
      if (grown === current) return;
      minHeightRef.current = grown;
      scheduleBase();
    };
    const addPoints = (l: Live, samples: Sample[]) => {
      const inking =
        l.tool === 'pen' || l.tool === 'highlighter' || l.tool === 'line' || l.tool === 'shape' || l.tool === 'shapes' || l.tool === 'capture';
      const added: InkPoint[] = [];
      for (const s of samples) {
        const raw = toPage(s, l.kind);
        // Écrire vers le bas : la feuille suivante est déjà là avant d'atteindre le bord
        if (inking) growFor(raw[1], GROW_AHEAD_INK);
        const pt = inking ? clampToPage(raw) : raw;
        const last = l.points[l.points.length - 1];
        if (last && Math.hypot(pt[0] - last[0], pt[1] - last[1]) < 0.03) continue;
        l.points.push(pt);
        added.push(pt);
      }
      return added;
    };

    const panZoom = (dx: number, dy: number, cx: number, cy: number, factor: number) => {
      const v = viewRef.current;
      const px = (cx - dx - rect.left - v.tx) / v.scale;
      const py = (cy - dy - rect.top - v.ty) / v.scale;
      const scale = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE);
      const next = { scale, tx: cx - rect.left - px * scale, ty: cy - rect.top - py * scale };
      // Défiler vers le bas (pas zoomer) : le papier se déroule avant que le bas de l'écran atteigne son bord
      if (dy < 0 && Math.abs(factor - 1) < 0.02) growFor((size.h - next.ty) / next.scale, GROW_AHEAD_SCROLL);
      viewRef.current = clampView(next);
      scheduleBase();
      bumpTick();
      if (factor !== 1) reportScale();
    };

    const listener: ClassifierListener = {
      drawStart(id, kind, samples) {
        const p = propsRef.current;
        const tool: LiveTool = eraserPointers.has(id) ? 'eraser' : p.tool;
        const highlighter = tool === 'highlighter';
        const l: Live = {
          kind, tool, color: highlighter ? p.highlightColor : p.color, size: highlighter ? p.highlightSize : p.size,
          points: [], predicted: [], erased: new Set(), cursor: null, dx: 0, dy: 0, moving: [],
        };
        if (tool === 'lasso' && p.selection.length && samples.length) {
          // Appui dans la sélection : on la déplace au lieu de tracer un nouveau lasso
          const first = toPage(samples[0], kind);
          const chosen = new Set(p.selection);
          const moving = p.strokes.filter((s) => chosen.has(s.id));
          const bb = unionBBox(moving.map(strokeBBox));
          const pad = 3;
          if (bb && first[0] >= bb.minX - pad && first[0] <= bb.maxX + pad && first[1] >= bb.minY - pad && first[1] <= bb.maxY + pad) {
            Object.assign(l, { tool: 'move', moving, points: [first] });
            for (const s of moving) hiddenRef.current.add(s.id);
            lives.set(id, l);
            scheduleBase();
            return;
          }
        }
        if (tool === 'shapes') l.shapeKind = p.shapeKind;
        if (p.dashed && (tool === 'pen' || tool === 'shapes')) l.dashed = true;
        lives.set(id, l);
        const added = addPoints(l, samples);
        if (tool === 'eraser') eraseAt(l, added);
        if (
          (tool === 'pen' || highlighter || tool === 'line' || tool === 'shapes' || tool === 'capture') &&
          (p.selection.length || p.selectionRegion)
        )
          p.onSelect([]);
        present();
      },
      drawMove(id, samples, predicted) {
        const l = lives.get(id);
        if (!l) return;
        if (l.tool === 'move') {
          const current = toPage(samples[samples.length - 1], l.kind);
          l.dx = current[0] - l.points[0][0];
          l.dy = current[1] - l.points[0][1];
          present();
          return;
        }
        if (l.tool === 'shape' && l.follow) {
          // Ajustement en direct : le coin suit le déplacement du stylet depuis le « snap »
          const now = toPage(samples[samples.length - 1], l.kind);
          const { from, far } = l.follow;
          const p = propsRef.current;
          l.points = [l.points[0], [clamp(far[0] + now[0] - from[0], 0, p.pageWidth), clamp(far[1] + now[1] - from[1], 0, pageH()), 0.5]];
          present();
          return;
        }
        const added = addPoints(l, samples);
        if (l.tool === 'eraser') eraseAt(l, added);
        l.predicted = l.tool === 'pen' || l.tool === 'highlighter' ? predicted.map((s) => toPage(s, l.kind)) : [];
        // Dessin immédiat dans le gestionnaire d'événement : latence minimale
        present();
      },
      drawEnd(id) {
        const l = lives.get(id);
        lives.delete(id);
        if (!l) return;
        const p = propsRef.current;
        if ((l.tool === 'pen' || l.tool === 'highlighter') && l.points.length) {
          const stroke: Stroke = { id: newId(), points: l.points, color: l.color, size: l.size, input: l.kind };
          if (l.tool === 'highlighter') stroke.tool = 'highlighter';
          else if (l.dashed) stroke.dashed = true;
          setTransform(base);
          drawStroke(base, stroke); // évite un clignotement avant le rendu React
          p.onAddStroke(stroke);
        } else if (l.tool === 'line' && l.points.length) {
          const a = l.points[0];
          const b = l.points[l.points.length - 1];
          const points = Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.3 ? [a] : linePoints(a, b);
          const stroke: Stroke = { id: newId(), points, color: l.color, size: l.size, input: 'mouse' };
          setTransform(base);
          drawStroke(base, stroke);
          p.onAddStroke(stroke);
        } else if ((l.tool === 'shape' || l.tool === 'shapes') && l.shapeKind && l.points.length) {
          let a = l.points[0];
          let b = l.points[l.points.length - 1];
          // Tampon simplement tapoté (pas glissé) : on le pose à une taille par défaut, centré sur le point touché
          if (l.tool === 'shapes' && Math.hypot(b[0] - a[0], b[1] - a[1]) < 3) {
            const [dw, dh] = DEFAULT_SHAPE_SIZE[l.shapeKind];
            const [cx, cy] = b;
            a = [clamp(cx - dw / 2, 0, p.pageWidth), clamp(cy - dh / 2, 0, pageH()), 0.5];
            b = [clamp(cx + dw / 2, 0, p.pageWidth), clamp(cy + dh / 2, 0, pageH()), 0.5];
          }
          const stroke: Stroke = { id: newId(), tool: 'shape', shape: l.shapeKind, points: [a, b], color: l.color, size: l.size, input: l.kind };
          if (l.dashed) stroke.dashed = true;
          setTransform(base);
          drawStroke(base, stroke);
          p.onAddStroke(stroke);
          // La forme reste sélectionnée, avec ses poignées : on peut ajuster ses dimensions exactes
          p.onSelect([stroke.id]);
        } else if (l.tool === 'capture' && l.points.length) {
          const a = l.points[0];
          const b = l.points[l.points.length - 1];
          const minX = Math.min(a[0], b[0]);
          const minY = Math.min(a[1], b[1]);
          const maxX = Math.max(a[0], b[0]);
          const maxY = Math.max(a[1], b[1]);
          // Zone trop petite (un simple tap) : pas de quoi proposer un recadrage
          if (maxX - minX >= 4 && maxY - minY >= 4) p.onCaptureRegion({ minX, minY, maxX, maxY });
        } else if (l.tool === 'move') {
          for (const s of l.moving) hiddenRef.current.delete(s.id);
          if (Math.abs(l.dx) + Math.abs(l.dy) > 0.2) {
            setTransform(base);
            base.save();
            base.translate(l.dx, l.dy);
            for (const s of l.moving) drawStroke(base, s);
            base.restore();
            p.onMoveSelection(l.dx, l.dy);
          } else {
            scheduleBase();
          }
        } else if (l.tool === 'eraser' && l.edits?.size) {
          setTransform(base);
          for (const pieces of l.edits.values()) for (const piece of pieces) drawStroke(base, piece); // évite un clignotement
          p.onReplaceStrokes(new Map(l.edits));
        } else if (l.tool === 'eraser' && l.erased.size) {
          p.onErase([...l.erased]);
        } else if (l.tool === 'lasso') {
          // La zone du lasso compte aussi : sur un PDF ou une photo, on peut convertir sans avoir écrit
          const region =
            l.points.length > 2
              ? {
                  minX: Math.min(...l.points.map((pt) => pt[0])),
                  minY: Math.min(...l.points.map((pt) => pt[1])),
                  maxX: Math.max(...l.points.map((pt) => pt[0])),
                  maxY: Math.max(...l.points.map((pt) => pt[1])),
                }
              : null;
          p.onSelect(strokesInLasso(p.strokes, l.points.map(([x, y]) => [x, y])), region);
        }
        present();
      },
      drawCancel(id) {
        const l = lives.get(id);
        lives.delete(id);
        if (l?.tool === 'eraser' && (l.erased.size || l.edits?.size)) {
          for (const sid of l.erased) hiddenRef.current.delete(sid);
          for (const sid of l.edits?.keys() ?? []) hiddenRef.current.delete(sid);
          scheduleBase();
        }
        if (l?.tool === 'move') {
          for (const s of l.moving) hiddenRef.current.delete(s.id);
          scheduleBase();
        }
        schedulePresent();
      },
      panZoom,
      twoFingerTap: () => propsRef.current.onUndo(),
      penDetected: () => propsRef.current.onPenDetected(),
      /**
       * Appui long immobile : ce contact devient une gomme jusqu'à ce qu'il se lève (comme JNotes).
       * Marche quel que soit l'outil d'encre/forme actif (y compris Formes & tampons), pas seulement
       * le stylo : un appui statique n'a de toute façon aucun autre sens utile pour ces outils-là.
       */
      holdErase(id) {
        const l = lives.get(id);
        if (!l || (l.tool !== 'pen' && l.tool !== 'highlighter' && l.tool !== 'line' && l.tool !== 'shapes')) return;
        const at = l.points[l.points.length - 1] ?? l.cursor;
        l.tool = 'eraser';
        l.predicted = [];
        l.points = at ? [at] : [];
        if (at) eraseAt(l, [at]);
        navigator.vibrate?.(18);
        present();
      },
      /**
       * Appui long en fin de tracé (dessiner → maintenir → ajuster) : si ce qui vient d'être dessiné
       * ressemble à un cercle, un rectangle, un triangle ou une flèche, ce trait devient cette forme
       * parfaite, encore ajustable (glisser la pointe redimensionne) jusqu'à ce que le stylet se lève.
       * Rien de reconnu : le trait continue normalement, comme si rien ne s'était passé.
       */
      shapeHold(id) {
        const l = lives.get(id);
        if (!l || l.tool !== 'pen' || l.points.length < 4) return;
        const kind = recognizeShape(l.points);
        if (!kind) return;
        const at = l.points[l.points.length - 1];
        let anchor: InkPoint;
        let far: InkPoint;
        if (kind === 'arrow' || kind === 'line') {
          anchor = l.points[0];
          // La vraie pointe (ignore un éventuel repli en dessinant l'amorce de la tête), pas le
          // dernier point brut du tracé.
          far = farthestPoint(l.points, anchor);
        } else {
          // La forme reprend exactement l'étendue dessinée. Le coin le plus proche du stylet est celui
          // qu'on tire en glissant ; le coin opposé reste fixe.
          const [minX, minY, maxX, maxY] = shapeBBoxFromPoints(l.points);
          const corners: InkPoint[] = [
            [minX, minY, 0.5],
            [maxX, minY, 0.5],
            [maxX, maxY, 0.5],
            [minX, maxY, 0.5],
          ];
          const nearest = corners.reduce((best, c) => (Math.hypot(c[0] - at[0], c[1] - at[1]) < Math.hypot(best[0] - at[0], best[1] - at[1]) ? c : best));
          far = nearest;
          anchor = [minX + maxX - nearest[0], minY + maxY - nearest[1], 0.5];
        }
        l.tool = 'shape';
        l.shapeKind = kind;
        l.points = [anchor, far];
        l.follow = { from: at, far };
        l.predicted = [];
        l.snapAt = performance.now();
        navigator.vibrate?.(15);
        present();
        // Le flash doit s'éteindre même si le stylet reste parfaitement immobile ensuite (pas de
        // nouvel événement pour redessiner) : un redessin est reprogrammé juste après sa durée.
        window.setTimeout(schedulePresent, SNAP_FLASH_MS + 20);
      },
      penSizeLearned: (size) => propsRef.current.onPenSize?.(size),
    };

    const classifier = new InputClassifier(
      { ...props.config, handTool: props.tool === 'hand', restTop: null },
      listener,
    );
    classifier.penSeen = props.penSeen;
    const applyConfig = () => {
      const p = propsRef.current;
      const restTop = p.restZone > 0 ? rect.top + rect.height * (1 - p.restZone) : null;
      classifier.config = { ...p.config, handTool: p.tool === 'hand', restTop };
      if (p.penSeen) classifier.penSeen = true;
    };
    applyConfigRef.current = applyConfig;

    const stats: InkStats = {
      type: '—', pressure: 0, size: 0, buttons: 0, eventsPerSec: 0, coalesced: 0, predicted: false, cancels: 0,
      lowLatency: props.lowLatency,
      inspect: () => ({
        mode: classifier.effectiveMode,
        tracks: classifier.snapshot(),
        decisions: classifier.decisions(),
        learnedPenSize: classifier.learnedPenSize(),
        penReference: classifier.penReference(),
        palmThreshold: classifier.palmThreshold(),
      }),
    };
    props.stats.current = stats;

    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      try {
        displayCanvas.setPointerCapture(e.pointerId);
      } catch {
        /* pointeur déjà relâché */
      }
      rect = displayCanvas.getBoundingClientRect();
      applyConfig();
      const kind = kindOf(e);
      const sample = sampleOf(e);
      Object.assign(stats, { type: kind, pressure: e.pressure, size: sample.size, buttons: e.buttons });
      // Bouton latéral (2) ou gomme (32) d'un stylet actif : gomme temporaire
      if (kind === 'pen' && (e.buttons & 2 || e.buttons & 32)) eraserPointers.add(e.pointerId);
      // Posé dans la marge (hors de la feuille) : ça déplace la vue, comme sur GoodNotes, jamais un trait
      const pt = toPage(sample, kind);
      const p = propsRef.current;
      const inMargin = pt[0] < 0 || pt[0] > p.pageWidth || pt[1] < 0 || pt[1] > pageH();
      classifier.down(kind, e.pointerId, sample, (kind === 'mouse' && e.button !== 0) || inMargin);
    };
    const onMove = (e: PointerEvent) => {
      const kind = kindOf(e);
      if (e.buttons === 0) {
        if (kind === 'pen') classifier.hover('pen');
        return;
      }
      const coalesced = e.getCoalescedEvents?.() ?? [];
      const list = coalesced.length ? coalesced : [e];
      const predicted = e.getPredictedEvents?.() ?? [];
      counter.n++;
      counter.coalesced += list.length;
      const now = performance.now();
      if (now - counter.since >= 1000) {
        stats.eventsPerSec = Math.round((counter.n * 1000) / (now - counter.since));
        stats.coalesced = counter.n ? Math.round((counter.coalesced / counter.n) * 10) / 10 : 0;
        counter.n = counter.coalesced = 0;
        counter.since = now;
      }
      Object.assign(stats, { type: kind, pressure: e.pressure, size: sampleOf(e).size, buttons: e.buttons });
      stats.predicted = stats.predicted || predicted.length > 0;
      classifier.move(e.pointerId, list.map(sampleOf), predicted.map(sampleOf));
      // Les contacts ignorés ne déclenchent aucun trait : c'est ici qu'on rafraîchit leur pastille
      if (propsRef.current.showContacts) schedulePresent();
    };
    const onUp = (e: PointerEvent) => {
      classifier.up(e.pointerId, sampleOf(e));
      eraserPointers.delete(e.pointerId);
      // Le contact levé doit disparaître du diagnostic même s'il n'a rien dessiné
      if (propsRef.current.showContacts) schedulePresent();
    };
    const onCancel = (e: PointerEvent) => {
      stats.cancels++;
      classifier.cancel(e.pointerId);
      eraserPointers.delete(e.pointerId);
      if (propsRef.current.showContacts) schedulePresent();
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      rect = displayCanvas.getBoundingClientRect();
      if (e.ctrlKey) panZoom(0, 0, e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
      else panZoom(-e.deltaX, -e.deltaY, e.clientX, e.clientY, 1);
    };
    const onContextMenu = (e: Event) => e.preventDefault();

    const ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      size.w = w;
      size.h = h;
      size.dpr = window.devicePixelRatio || 1;
      for (const c of [displayCanvas, baseCanvas]) {
        c.width = Math.round(w * size.dpr);
        c.height = Math.round(h * size.dpr);
      }
      displayCanvas.style.width = `${w}px`;
      displayCanvas.style.height = `${h}px`;
      rect = displayCanvas.getBoundingClientRect();
      applyConfig();
      if (!fitted) {
        fitted = true;
        const pw = propsRef.current.pageWidth;
        const scale = clamp((w - 32) / pw, MIN_SCALE, pw > propsRef.current.pageHeight ? 6 : 4.2);
        viewRef.current = { scale, tx: (w - pw * scale) / 2, ty: TOP_GAP };
        // Tout de suite (sans attendre) : le PDF de la page s'affiche dès l'ouverture
        propsRef.current.onScaleChange?.(scale);
      }
      viewRef.current = clampView(viewRef.current);
      redrawBase();
      bumpTick();
    });
    ro.observe(container);

    displayCanvas.addEventListener('pointerdown', onDown);
    displayCanvas.addEventListener('pointermove', onMove);
    displayCanvas.addEventListener('pointerup', onUp);
    displayCanvas.addEventListener('pointercancel', onCancel);
    displayCanvas.addEventListener('wheel', onWheel, { passive: false });
    displayCanvas.addEventListener('contextmenu', onContextMenu);
    return () => {
      ro.disconnect();
      displayCanvas.removeEventListener('pointerdown', onDown);
      displayCanvas.removeEventListener('pointermove', onMove);
      displayCanvas.removeEventListener('pointerup', onUp);
      displayCanvas.removeEventListener('pointercancel', onCancel);
      displayCanvas.removeEventListener('wheel', onWheel);
      displayCanvas.removeEventListener('contextmenu', onContextMenu);
      cancelAnimationFrame(baseRaf);
      cancelAnimationFrame(presentRaf);
      cancelAnimationFrame(tickRaf);
      window.clearTimeout(scaleTimer);
      classifier.reset();
      setImageReadyCallback(null);
    };
    // Installation unique ; les props courantes sont lues via propsRef.
    // Changer lowLatency exige une nouvelle toile : le parent remonte le composant (key).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { config, tool, penSeen, restZone, strokes, paper, paperColor, selection, background, showContacts } = props;
  useEffect(() => {
    applyConfigRef.current();
  }, [config, tool, penSeen, restZone]);

  useEffect(() => {
    // Les traits effacés restent masqués jusqu'à leur retrait effectif de la page
    const ids = new Set(strokes.map((s) => s.id));
    for (const id of hiddenRef.current) if (!ids.has(id)) hiddenRef.current.delete(id);
    redrawRef.current();
  }, [strokes, paper, paperColor, background, showContacts]);

  const { selectionRegion } = props;
  const selBox = useMemo(() => {
    if (selection.length === 0 && !selectionRegion) return null;
    const chosen = new Set(selection);
    const boxes = strokes.filter((s) => chosen.has(s.id)).map(strokeBBox);
    if (selectionRegion) boxes.push(selectionRegion);
    const bb = unionBBox(boxes);
    if (!bb) return null;
    const v = viewRef.current;
    const pad = 6;
    return {
      left: bb.minX * v.scale + v.tx - pad,
      top: bb.minY * v.scale + v.ty - pad,
      width: (bb.maxX - bb.minX) * v.scale + 2 * pad,
      height: (bb.maxY - bb.minY) * v.scale + 2 * pad,
    };
    // viewTick : recalcul quand la vue bouge
  }, [selection, selectionRegion, strokes, viewTick]);
  const regionOnly = selection.length === 0;

  /** Objet sélectionné qu'on peut redimensionner à la poignée : une forme ou une image, seule. */
  const resizable = useMemo(() => {
    if (selection.length !== 1) return null;
    const s = strokes.find((st) => st.id === selection[0]);
    return s && (s.tool === 'shape' || s.tool === 'image') && s.points.length >= 2 ? s : null;
  }, [selection, strokes]);
  const resizeHandles = useMemo(() => {
    if (!resizable) return [];
    const v = viewRef.current;
    const sx = (x: number) => x * v.scale + v.tx;
    const sy = (y: number) => y * v.scale + v.ty;
    // Ligne et flèche : deux poignées aux bouts (l'angle est libre) ; les autres : 8 autour du rectangle
    if (resizable.tool === 'shape' && (resizable.shape === 'line' || resizable.shape === 'arrow')) {
      const [a, b] = resizable.points;
      return [
        { handle: 'start' as ResizeHandle, left: sx(a[0]), top: sy(a[1]) },
        { handle: 'end' as ResizeHandle, left: sx(b[0]), top: sy(b[1]) },
      ];
    }
    const [a, b] = resizable.points;
    const x0 = sx(Math.min(a[0], b[0]));
    const x1 = sx(Math.max(a[0], b[0]));
    const y0 = sy(Math.min(a[1], b[1]));
    const y1 = sy(Math.max(a[1], b[1]));
    const pos = (h: Corner) => ({
      handle: h as ResizeHandle,
      left: h.includes('w') ? x0 : h.includes('e') ? x1 : (x0 + x1) / 2,
      top: h.includes('n') ? y0 : h.includes('s') ? y1 : (y0 + y1) / 2,
    });
    // Une image garde ses proportions : seulement les 4 coins
    return (resizable.tool === 'image' ? (['nw', 'ne', 'se', 'sw'] as Corner[]) : CAPTURE_HANDLES).map(pos);
    // viewTick : recalcul quand la vue bouge
  }, [resizable, viewTick]);

  const dragResizeHandle = (e: ReactPointerEvent<HTMLDivElement>, handle: ResizeHandle) => {
    e.preventDefault();
    e.stopPropagation();
    const target = resizable;
    if (!target) return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startY = e.clientY;
    const api = resizeApiRef.current;
    api.begin(target.id);
    let latest: Stroke | null = null;
    const onMove = (ev: PointerEvent) => {
      const v = viewRef.current;
      const p = propsRef.current;
      const points = resizedPoints(
        target.points,
        handle,
        (ev.clientX - startX) / v.scale,
        (ev.clientY - startY) / v.scale,
        { width: p.pageWidth, height: pageH() },
        target.tool === 'image',
      );
      latest = { ...target, points };
      api.preview(latest);
    };
    const onUp = (ev: PointerEvent) => {
      el.releasePointerCapture(ev.pointerId);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      api.end(latest);
      if (latest) propsRef.current.onResizeStroke(target.id, latest.points);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  };

  const { captureRegion } = props;
  const capBox = useMemo(() => {
    if (!captureRegion) return null;
    const v = viewRef.current;
    return {
      left: captureRegion.minX * v.scale + v.tx,
      top: captureRegion.minY * v.scale + v.ty,
      width: (captureRegion.maxX - captureRegion.minX) * v.scale,
      height: (captureRegion.maxY - captureRegion.minY) * v.scale,
    };
    // viewTick : recalcul quand la vue bouge
  }, [captureRegion, viewTick]);

  /** Poignées de recadrage (comme un crop d'image) : glissé natif, en dehors du classifieur anti-paume. */
  const dragCaptureHandle = (e: ReactPointerEvent<HTMLDivElement>, corner: Corner) => {
    e.preventDefault();
    e.stopPropagation();
    const region = propsRef.current.captureRegion;
    if (!region) return;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startY = e.clientY;
    const orig = { ...region };
    const onMove = (ev: PointerEvent) => {
      const v = viewRef.current;
      const p = propsRef.current;
      const dxMm = (ev.clientX - startX) / v.scale;
      const dyMm = (ev.clientY - startY) / v.scale;
      let { minX, minY, maxX, maxY } = orig;
      if (corner.includes('w')) minX = clamp(orig.minX + dxMm, 0, orig.maxX - 4);
      if (corner.includes('e')) maxX = clamp(orig.maxX + dxMm, orig.minX + 4, p.pageWidth);
      if (corner.includes('n')) minY = clamp(orig.minY + dyMm, 0, orig.maxY - 4);
      if (corner.includes('s')) maxY = clamp(orig.maxY + dyMm, orig.minY + 4, pageH());
      p.onCaptureRegion({ minX, minY, maxX, maxY });
    };
    const onUp = (ev: PointerEvent) => {
      target.releasePointerCapture(ev.pointerId);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
  };
  const handlePos = (box: { left: number; top: number; width: number; height: number }, corner: Corner) => ({
    left: (corner.includes('w') ? box.left : corner.includes('e') ? box.left + box.width : box.left + box.width / 2) - HANDLE_SIZE / 2,
    top: (corner.includes('n') ? box.top : corner.includes('s') ? box.top + box.height : box.top + box.height / 2) - HANDLE_SIZE / 2,
  });

  return (
    <div className="ink-area" ref={containerRef}>
      <canvas ref={displayRef} className="ink-layer" />
      {restZone > 0 && (
        <div className="rest-zone" style={{ height: `${restZone * 100}%` }}>
          <span>Zone de repos pour la main</span>
        </div>
      )}
      {selBox && (
        <>
          <div className="selection-box" style={selBox} />
          <div className="selection-actions" style={{ left: Math.max(8, selBox.left), top: Math.max(8, selBox.top - 52) }}>
            <button className="primary" onClick={props.onConvertSelection}>
              Convertir en LaTeX
            </button>
            {!regionOnly && (
              <>
                {props.selectionColors.map((c) => (
                  <button key={c} className="swatch small" style={{ background: c }} aria-label="Changer la couleur" onClick={() => props.onRecolorSelection(c)} />
                ))}
                <MultiColorSwatch initial={props.selectionColors[0]} onCommit={props.onPickSelectionColor} />
                <button onClick={props.onDuplicateSelection}>Dupliquer</button>
                <button onClick={props.onCopySelection}>Copier</button>
                <button onClick={props.onDeleteSelection}>Supprimer</button>
              </>
            )}
            <button aria-label="Désélectionner" onClick={() => props.onSelect([])}>
              ✕
            </button>
          </div>
        </>
      )}
      {resizeHandles.map(({ handle, left, top }) => (
        <div
          key={handle}
          className={`capture-handle handle-${handle}`}
          style={{ left: left - HANDLE_SIZE / 2, top: top - HANDLE_SIZE / 2, width: HANDLE_SIZE, height: HANDLE_SIZE }}
          onPointerDown={(e) => dragResizeHandle(e, handle)}
          aria-label="Redimensionner"
        />
      ))}
      {capBox && (
        <>
          <div className="capture-box" style={capBox} />
          {CAPTURE_HANDLES.map((corner) => (
            <div
              key={corner}
              className={`capture-handle handle-${corner}`}
              style={{ ...handlePos(capBox, corner), width: HANDLE_SIZE, height: HANDLE_SIZE }}
              onPointerDown={(e) => dragCaptureHandle(e, corner)}
            />
          ))}
          <div className="selection-actions" style={{ left: Math.max(8, capBox.left), top: Math.max(8, capBox.top - 52) }}>
            <button className="primary" onClick={props.onCopyCapture}>
              Copier
            </button>
            <button aria-label="Annuler la capture" onClick={() => props.onCaptureRegion(null)}>
              ✕
            </button>
          </div>
        </>
      )}
    </div>
  );
}
