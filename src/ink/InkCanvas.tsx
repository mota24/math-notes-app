import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { InputClassifier } from './palm';
import type { ClassifierConfig, ClassifierListener, Sample } from './palm';
import { HIGHLIGHT_ALPHA, PAPER_BACKGROUND, buildPath, drawPaper, drawShapeOn, drawStroke, onImageReady } from './draw';
import {
  cornerScale, eraseFromPolyline, fitShift, isErasable, normalizeAngle, orientation, resizedPoints, rotationDelta,
  shapePolylines, strokeBBox, strokeHit, strokesInLasso, transformStroke, unionBBox,
} from './geometry';
import type { ResizeHandle, ScaleCorner, Similarity } from './geometry';
import { MAX_PAGE_HEIGHT, SHEET_H, growHeight } from './pageExtent';
import { MultiColorSwatch } from './MultiColorSwatch';
import { farthestPoint, recognizeShape, regularizeShape } from './shapeRecognize';
import { DEFAULT_TEXT_WIDTH, MIN_TEXT_WIDTH, TEXT_FONT, TEXT_LINE_HEIGHT, textBoxHeight, textPadding } from './textLayout';
import { newId } from './types';
import type { BBox, InkPoint, InputKind, PaperColor, PaperStyle, ShapeKind, Stroke, Tool, View } from './types';
import { BAR_WIDTH, BAR_WIDTH_REGION, CAPTURE_HANDLES, HANDLE_SIZE, ROTATE_GAP, ROTATE_SIZE, clamp, isCorner, layoutHandles, rotatePosition, trackDrag } from './handles';
import type { Corner, TransformDrag } from './handles';
import { PAGE_GAP, docH, docW, findSheet, getSheets } from './sheets';
import type { CanvasPage, Sheet } from './sheets';
import { SheetHighlights, SheetText, UNIT, useLayerCopy } from '../ocr/TextLayer';
import type { Highlight } from '../ocr/TextLayer';
import type { TextWord } from '../ocr/textModel';

export type { CanvasPage, Sheet } from './sheets';

/** Zone de texte en cours de frappe : où elle est (page, mm), ce qu'elle contient, et le trait qu'elle modifie */
export interface TextEdit {
  pageId: string;
  /** Trait `text` modifié ; null = nouvelle zone */
  id: string | null;
  x: number;
  y: number;
  width: number;
  text: string;
  /** Taille du texte (mm) */
  size: number;
  color: string;
}

/** Outil Texte : où l'on a touché la page — une nouvelle zone, ou une zone existante à modifier */
export type TextTarget = { pageId: string; x: number; y: number; width: number; tap: boolean } | { pageId: string; stroke: Stroke };


interface Props {
  pages?: CanvasPage[];
  currentPageIndex?: number;
  onPageIndexChange?(index: number): void;
  onAddPage?(): void;
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
  /** Rendu « desynchronized » : moins de latence, mais pas supporté partout */
  lowLatency: boolean;
  penSeen: boolean;
  selection: string[];
  /** Zone entourée au lasso (mm), utile sur un PDF ou une photo même sans trait */
  selectionRegion: BBox | null;
  /** Couleur et épaisseur du surligneur */
  highlightColor: string;
  highlightSize: number;
  /** Tampon choisi dans le sous-menu « Formes & tampons » : posé sur la page quand tool === 'shapes' */
  shapeKind: ShapeKind;
  /** Trait en pointillés (stylo et formes) */
  dashed: boolean;
  /** Couleur des formes et des lignes, déjà résolue : celle qu'on a choisie, sinon celle qui tranche sur le papier */
  shapeColor: string;
  /** Gomme par trait (tout le trait touché) ou de précision (seulement la zone touchée) */
  eraserMode: 'stroke' | 'precision';
  /** Rayon de la gomme (px d'écran) */
  eraserSize: number;
  /** Lasso : tracé à main levée, ou cadre rectangulaire tiré d'un coin à l'autre */
  lassoShape: 'free' | 'rect';
  /** Zone du Lasso de capture (mm), encore ajustable par ses poignées tant qu'elle n'est pas copiée */
  captureRegion: BBox | null;
  onAddStroke(s: Stroke, pageId?: string): void;
  onErase(ids: string[]): void;
  /** Gomme de précision : chaque trait touché est remplacé par ses morceaux restants (liste vide = effacé) */
  onReplaceStrokes(replacements: Map<string, Stroke[]>): void;
  /** Poignées de la sélection (échelle, rotation, étirement) : les traits transformés, à enregistrer d'un coup (annulable) */
  onTransformStrokes(strokes: Stroke[]): void;
  /** Un tampon posé rend la main au stylo : le parent change d'outil, sans toucher à la sélection */
  onSwitchTool(tool: Tool): void;
  onSelect(ids: string[], region?: BBox | null): void;
  /**
   * Un tap sur une zone de texte (stylo, surligneur, outil Texte, lasso, souris, ou le doigt quand il ne dessine
   * pas) : la sélectionner tout de suite, poignées et barre d'actions comprises, sans passer par le lasso.
   */
  onTapText(id: string): void;
  onUndo(): void;
  onPenDetected(): void;
  /** Taille du stylet apprise (px) : retenue pour les prochaines sessions */
  onPenSize?(size: number): void;
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
  /** Taille du texte des nouvelles zones (mm), pour l'aperçu quand on tire leur largeur */
  textSize: number;
  /** Zone de texte en cours de frappe (champ posé sur la page), null sinon */
  textEdit: TextEdit | null;
  onTextTarget(target: TextTarget): void;
  onTextChange(text: string): void;
  /** Fin de la frappe (tap ailleurs, Échap, champ quitté) : le parent enregistre la zone */
  onTextDone(): void;
  /**
   * Mode « Texte » : les mots lus sur le fond de chaque page (identifiant de page → mots), posés en couche
   * sélectionnable par-dessus. Absent : pas de couche.
   */
  textLayer?: ReadonlyMap<string, readonly TextWord[]> | null;
  /** Occurrences de la recherche à surligner (fractions de page) */
  highlights?: readonly Highlight[] | null;
  /** Amène à l'écran un point d'une page (résultat de recherche) : `y` en fraction de la page, `nonce` relance */
  reveal?: { pageId: string; y: number; nonce: number } | null;
}

/**
 * 'move' : glisser la sélection du lasso. 'shape' : forme auto-reconnue, encore ajustable (stylo + appui
 * long). 'edit' : aperçu d'une poignée de la sélection (échelle, rotation, étirement).
 */
type LiveTool = Tool | 'move' | 'shape' | 'edit';

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
  /**
   * tool === 'edit' : les traits d'origine (`from`), tels qu'ils seront une fois la poignée relâchée (`to`), et
   * la similitude appliquée (`null` : simple étirement, où seuls les traits de `to` se dessinent)
   */
  edited?: { from: Stroke[]; to: Stroke[]; m: Similarity | null };
  /** tool === 'shape' : où était le stylet au « snap » et le coin qu'il tire, pour ajuster en glissant */
  follow?: { from: InkPoint; far: InkPoint };
  pageId?: string;
  pageTop?: number;
  /** performance.now() au début du geste : distingue un tap d'un appui prolongé */
  startedAt?: number;
}

/** Un tap : le geste reste dans un carré de TAP_MM de côté (mm) et dure moins de TAP_MS (ms) */
const TAP_MM = 2;
const TAP_MS = 450;

/** Identifiant de l'aperçu d'une poignée (aucun vrai contact n'a cet id). */
const EDIT_LIVE_ID = -1;

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
  // Un simple tap pose une ligne horizontale
  line: [40, 0],
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
/** Seuil de défilement (px) pour déclencher l'ajout d'une feuille par overscroll */
const OVERSCROLL_PULL_PX = 65;
const OVERSCROLL_MAX_PX = 130;
/** Place laissée en haut pour la pilule d'outils flottante */
const TOP_GAP = 76;
const kindOf = (e: PointerEvent): InputKind =>
  e.pointerType === 'pen' ? 'pen' : e.pointerType === 'mouse' ? 'mouse' : 'touch';
const sampleOf = (e: PointerEvent): Sample => ({
  x: e.clientX,
  y: e.clientY,
  p: e.pressure,
  t: e.timeStamp,
  size: Math.max(e.width || 0, e.height || 0),
});

export function InkCanvas(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const displayRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  const viewRef = useRef<View>({ scale: 3, tx: 16, ty: 16 });
  const hiddenRef = useRef(new Set<string>());
  const redrawRef = useRef<() => void>(() => {});
  const applyConfigRef = useRef<() => void>(() => {});
  const activePageIndexRef = useRef(props.currentPageIndex ?? 0);
  const clampViewRef = useRef<(v: View, allowOverscroll?: boolean) => View>((v) => v);
  /**
   * Le champ de saisie des zones de texte. Toujours présent (invisible au repos) : iOS n'ouvre le clavier
   * virtuel que si le focus est donné PENDANT le geste de l'utilisateur, donc dans la levée du doigt, avant
   * que React n'ait affiché quoi que ce soit.
   */
  const textArea = useRef<HTMLTextAreaElement>(null);
  /** Fait défiler la vue de (dx, dy) px, depuis l'extérieur de l'effet principal (champ de texte à garder visible) */
  const panByRef = useRef<(dx: number, dy: number) => void>(() => {});
  /** Passerelle vers le canevas pour les poignées de la sélection : aperçu en direct, validation, papier qui s'allonge */
  const editApiRef = useRef<{
    begin(strokes: Stroke[]): void;
    preview(from: Stroke[], to: Stroke[], m: Similarity | null): void;
    end(strokes: Stroke[] | null): void;
    grow(y: number): void;
  }>({
    begin: () => {},
    preview: () => {},
    end: () => {},
    grow: () => {},
  });
  const [, setViewTick] = useState(0); // seul effet : redessiner cadres et poignées quand la vue bouge

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
    if (props.currentPageIndex !== undefined && props.currentPageIndex !== activePageIndexRef.current) {
      activePageIndexRef.current = props.currentPageIndex;
      const sheets = getSheets(propsRef.current, minHeightRef.current);
      const targetSheet = sheets[props.currentPageIndex];
      if (targetSheet) {
        const targetTy = TOP_GAP - targetSheet.top * viewRef.current.scale;
        viewRef.current = clampViewRef.current({ ...viewRef.current, ty: targetTy }, false);
        redrawRef.current();
        setViewTick((t) => t + 1); // cadres, poignées et couche de texte suivent la nouvelle vue
      }
    }
  }, [props.currentPageIndex]);

  // Un résultat de recherche : le point visé arrive au tiers haut de l'écran, et sa page devient la courante
  const revealNonce = props.reveal?.nonce;
  useEffect(() => {
    const r = propsRef.current.reveal;
    if (!r) return;
    const sheet = getSheets(propsRef.current, minHeightRef.current).find((sh) => sh.id === r.pageId);
    if (!sheet) return;
    const v = viewRef.current;
    const h = containerRef.current?.clientHeight ?? 0;
    viewRef.current = clampViewRef.current({ ...v, ty: h / 3 - (sheet.top + r.y * sheet.height) * v.scale }, false);
    if (sheet.index !== activePageIndexRef.current) {
      activePageIndexRef.current = sheet.index;
      propsRef.current.onPageIndexChange?.(sheet.index);
    }
    redrawRef.current();
    setViewTick((t) => t + 1);
  }, [revealNonce]);

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

    let scaleTimer = 0;
    const reportScale = () => {
      window.clearTimeout(scaleTimer);
      scaleTimer = window.setTimeout(() => propsRef.current.onScaleChange?.(viewRef.current.scale), 250);
    };
    let currentOverscroll = 0;
    const clampView = (v: View, allowOverscroll = false): View => {
      const sheets = getSheets(propsRef.current, minHeightRef.current);
      const pw = docW(sheets, propsRef.current.pageWidth) * v.scale;
      const ph = docH(sheets) * v.scale;
      const m = 48;
      const tx = pw + 2 * m <= size.w ? (size.w - pw) / 2 : clamp(v.tx, size.w - pw - m, m);
      const minTy = ph + TOP_GAP + m <= size.h ? TOP_GAP : size.h - ph - m;
      const maxOverscroll = allowOverscroll && propsRef.current.onAddPage ? OVERSCROLL_MAX_PX : 0;
      const ty = clamp(v.ty, minTy - maxOverscroll, TOP_GAP);
      currentOverscroll = Math.max(0, minTy - ty);
      return { scale: v.scale, tx, ty };
    };
    clampViewRef.current = clampView;

    const setTransform = (ctx: CanvasRenderingContext2D) => {
      const v = viewRef.current;
      ctx.setTransform(size.dpr * v.scale, 0, 0, size.dpr * v.scale, size.dpr * v.tx, size.dpr * v.ty);
    };
    const toDoc = (s: Sample): [number, number] => {
      const v = viewRef.current;
      return [(s.x - rect.left - v.tx) / v.scale, (s.y - rect.top - v.ty) / v.scale];
    };
    const toPage = (s: Sample, kind: InputKind, targetSheet?: Sheet): InkPoint => {
      const p = kind === 'pen' ? clamp(s.p || 0.5, 0.05, 1) : 0.5;
      const [docX, docY] = toDoc(s);
      const sheets = getSheets(propsRef.current, minHeightRef.current);
      const sheet = targetSheet ?? findSheet(sheets, docY);
      return [docX, docY - sheet.top, p];
    };
    const clampToSheet = (pt: InkPoint, sheet: Sheet): InkPoint => {
      return [clamp(pt[0], 0, sheet.width), clamp(pt[1], 0, sheet.height), pt[2]];
    };
    const eraserRadius = () => Math.max(0.4, propsRef.current.eraserSize / viewRef.current.scale);

    /** Recopie la page et dessine par-dessus ce qui est en cours (trait, lasso, gomme). */
    const present = () => {
      display.setTransform(1, 0, 0, 1, 0, 0);
      display.drawImage(baseCanvas, 0, 0);
      setTransform(display);
      const scale = viewRef.current.scale;
      for (const l of lives.values()) {
        display.save();
        display.translate(0, l.pageTop ?? 0);
        if (l.tool === 'pen' || l.tool === 'highlighter') {
          const pts = l.predicted.length ? l.points.concat(l.predicted) : l.points;
          if (pts.length === 0) {
            display.restore();
            continue;
          }
          const path = buildPath(pts, l.kind, l.size, false, l.tool, l.dashed);
          display.save();
          if (l.tool === 'highlighter') {
            const darkPaper = (propsRef.current.paperColor ?? 'light') === 'dark';
            display.globalAlpha = darkPaper ? 0.55 : HIGHLIGHT_ALPHA;
            display.globalCompositeOperation = darkPaper ? 'screen' : 'multiply';
          }
          display.fillStyle = l.color;
          display.fill(path);
          display.restore();
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
        } else if (l.tool === 'edit' && l.edited) {
          const { from, to, m } = l.edited;
          from.forEach((s, i) => {
            if (m && s.tool !== 'shape' && s.tool !== 'image') {
              // Un trait à main levée suit la similitude sur le canevas : aucun contour à recalculer à chaque image
              display.save();
              display.translate(m.px + (m.dx ?? 0), m.py + (m.dy ?? 0));
              display.rotate(m.theta);
              display.scale(m.k, m.k);
              display.translate(-m.px, -m.py);
              drawStroke(display, s);
              display.restore();
            } else drawStroke(display, to[i]);
          });
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
        } else if (l.tool === 'text' && l.points.length) {
          // Zone de texte tirée au doigt : sa largeur suit, sa hauteur est celle d'une ligne
          const a = l.points[0];
          const b = l.points[l.points.length - 1];
          const size = propsRef.current.textSize;
          const rx = Math.min(a[0], b[0]);
          const rw = Math.max(MIN_TEXT_WIDTH, Math.abs(b[0] - a[0]));
          display.fillStyle = 'rgba(37, 99, 235, 0.06)';
          display.fillRect(rx, Math.min(a[1], b[1]), rw, textBoxHeight(1, size));
          display.setLineDash([6 / scale, 4 / scale]);
          display.lineWidth = 1.5 / scale;
          display.strokeStyle = '#2563eb';
          display.strokeRect(rx, Math.min(a[1], b[1]), rw, textBoxHeight(1, size));
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
        display.restore();
      }

      // Badge overscroll pull-to-add façon JNotes
      if (currentOverscroll > 5 && propsRef.current.onAddPage) {
        display.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
        display.save();
        const ready = currentOverscroll >= OVERSCROLL_PULL_PX;
        const text = ready ? '✓ Relâcher pour ajouter une page' : '↓ Tirer pour ajouter une page';
        display.font = '600 13px system-ui, -apple-system, sans-serif';
        const tw = display.measureText(text).width;
        const pw = tw + 32;
        const ph = 34;
        const px = (size.w - pw) / 2;
        const py = size.h - ph - 24;

        display.beginPath();
        if (display.roundRect) {
          display.roundRect(px, py, pw, ph, ph / 2);
        } else {
          display.rect(px, py, pw, ph);
        }
        display.fillStyle = ready ? 'rgba(37, 99, 235, 0.92)' : 'rgba(24, 24, 27, 0.88)';
        display.fill();
        display.lineWidth = 1;
        display.strokeStyle = ready ? 'rgba(147, 197, 253, 0.5)' : 'rgba(255, 255, 255, 0.18)';
        display.stroke();

        display.fillStyle = '#ffffff';
        display.textAlign = 'center';
        display.textBaseline = 'middle';
        display.fillText(text, size.w / 2, py + ph / 2);
        display.restore();
        setTransform(display);
      }
    };

    const redrawBase = () => {
      const p = propsRef.current;
      const v = viewRef.current;
      const sheets = getSheets(p, minHeightRef.current);
      const viewTop = -v.ty / v.scale - 2;
      const viewBottom = (size.h - v.ty) / v.scale + 2;

      // ── 1. LE BUREAU : fond gris clair pour faire ressortir la feuille ──
      base.setTransform(1, 0, 0, 1, 0, 0);
      base.fillStyle = '#6b7280';
      base.fillRect(0, 0, baseCanvas.width, baseCanvas.height);
      setTransform(base);

      for (const sh of sheets) {
        if (sh.bottom < viewTop || sh.top > viewBottom) continue;

        base.save();
        base.translate(0, sh.top);

        // ── 2. LA FEUILLE : ombre portée pour l'effet "posée sur le bureau" ──
        base.shadowColor = 'rgba(0, 0, 0, 0.5)';
        base.shadowBlur = 20 * size.dpr;
        base.shadowOffsetX = 0;
        base.shadowOffsetY = 4 * size.dpr;
        const paperCol = sh.page.paperColor ?? p.paperColor ?? 'light';
        base.fillStyle = sh.page.background ? '#ffffff' : PAPER_BACKGROUND[paperCol];
        base.fillRect(0, 0, sh.width, sh.height);

        // ── 3. Réinitialiser l'ombre AVANT de dessiner le contenu ──
        base.shadowColor = 'transparent';
        base.shadowBlur = 0;
        base.shadowOffsetX = 0;
        base.shadowOffsetY = 0;

        if (sh.page.background) {
          // Fond PDF ou photo : lissage haute qualité (l'état du contexte est remis à zéro à chaque redimensionnement)
          base.imageSmoothingEnabled = true;
          base.imageSmoothingQuality = 'high';
          base.drawImage(sh.page.background, 0, 0, sh.width, sh.height);
        } else {
          const sheetViewTop = Math.max(0, viewTop - sh.top);
          const sheetViewBottom = Math.min(sh.height, viewBottom - sh.top);
          drawPaper(base, sh.page.paper, v.scale, sh.width, sh.height, paperCol, [sheetViewTop, sheetViewBottom]);
        }

        // Bordure fine de la feuille
        base.strokeStyle = '#9ca3af';
        base.lineWidth = 1 / (v?.scale || 1);
        base.strokeRect(0, 0, sh.width, sh.height);

        if (sheets.length === 1 && p.extendable && sh.height > SHEET_H + 0.5) {
          const dark = paperCol === 'dark';
          base.save();
          base.setLineDash([6 / v.scale, 4 / v.scale]);
          base.lineWidth = 1 / v.scale;
          base.strokeStyle = dark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.25)';
          base.fillStyle = dark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.42)';
          base.font = `600 ${10 / v.scale}px system-ui, sans-serif`;
          for (let k = 1; k * SHEET_H < sh.height - 0.5; k++) {
            const y = k * SHEET_H;
            if (y < viewTop - sh.top - 2 || y > viewBottom - sh.top + 2) continue;
            base.beginPath();
            base.moveTo(0, y);
            base.lineTo(sh.width, y);
            base.stroke();
            base.fillText(`Feuille ${k + 1}`, 3 / v.scale, y + 12 / v.scale);
          }
          base.restore();
        }

        for (const s of sh.page.strokes) {
          if (hiddenRef.current.has(s.id)) continue;
          const bb = strokeBBox(s);
          if (sh.top + bb.maxY < viewTop || sh.top + bb.minY > viewBottom) continue;
          drawStroke(base, s, paperCol);
        }

        base.restore();
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
    let editingIds: string[] = [];
    editApiRef.current = {
      begin(strokes) {
        editingIds = strokes.map((s) => s.id);
        for (const id of editingIds) hiddenRef.current.add(id);
        // Aperçu tout de suite (sans transformation) : les traits masqués ne disparaissent pas le temps d'un rendu
        lives.set(EDIT_LIVE_ID, {
          kind: 'mouse', tool: 'edit', color: '', size: 0, points: [], predicted: [], erased: new Set(),
          cursor: null, dx: 0, dy: 0, moving: [], edited: { from: strokes, to: strokes, m: null },
        });
        scheduleBase();
      },
      preview(from, to, m) {
        const live = lives.get(EDIT_LIVE_ID);
        if (live) live.edited = { from, to, m };
        present();
      },
      end(strokes) {
        lives.delete(EDIT_LIVE_ID);
        if (strokes) {
          for (const s of strokes) hiddenRef.current.delete(s.id);
          setTransform(base);
          for (const s of strokes) drawStroke(base, s); // évite un clignotement avant le rendu React
        } else {
          for (const id of editingIds) hiddenRef.current.delete(id);
          scheduleBase();
        }
        editingIds = [];
        present();
      },
      grow: (y) => growFor(y, GROW_AHEAD_INK),
    };
    // Une image de trait (formule glissée sur la page) finit de se décoder de façon asynchrone :
    // dès que c'est fait, on redemande un rendu pour qu'elle apparaisse sans action de l'utilisateur.
    const offImageReady = onImageReady(scheduleBase);

    /** Un trait touché par la gomme de précision : ses morceaux restants, ou null s'il n'est pas touché. */
    const precisionPieces = (s: Stroke, trail: InkPoint[], r: number): Stroke[] | null => {
      const polylines = s.tool === 'shape' ? shapePolylines(s) : [s.points];
      if (!polylines) {
        // Repère, torseur, matrice, volume : pas découpable, effacé en entier dès qu'on le touche
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
      const sheets = getSheets(propsRef.current, minHeightRef.current);
      const pageTop = l.pageTop ?? 0;
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
          for (const sh of sheets) {
            const shTrail = trail.map(([x, y, p]) => [x, y + pageTop - sh.top, p] as InkPoint);
            for (const s of sh.page.strokes.filter(isErasable)) {
              if (hiddenRef.current.has(s.id)) continue;
              const pieces = precisionPieces(s, shTrail, r);
              if (!pieces) continue;
              hiddenRef.current.add(s.id);
              edits.set(s.id, pieces);
              changed = true;
            }
          }
        }
      } else {
        for (const pt of pts) {
          const docX = pt[0];
          const docY = pt[1] + pageTop;
          for (const sh of sheets) {
            const localX = docX;
            const localY = docY - sh.top;
            for (const s of sh.page.strokes.filter(isErasable)) {
              if (hiddenRef.current.has(s.id) || !strokeHit(s, localX, localY, r)) continue;
              hiddenRef.current.add(s.id);
              l.erased.add(s.id);
              changed = true;
            }
          }
        }
      }
      if (pts.length) l.cursor = pts[pts.length - 1];
      if (changed) scheduleBase();
    };
    /** Canevas infini : déroule assez de feuilles pour qu'il reste `ahead` mm de papier sous `y`. */
    const growFor = (y: number, ahead: number) => {
      if (!propsRef.current.extendable || (propsRef.current.pages && propsRef.current.pages.length > 1)) return;
      const current = pageH();
      const grown = growHeight(current, y, ahead);
      if (grown === current) return;
      minHeightRef.current = grown;
      scheduleBase();
    };
    const addPoints = (l: Live, samples: Sample[]) => {
      const inking = l.tool === 'pen' || l.tool === 'highlighter' || l.tool === 'shape' || l.tool === 'shapes' || l.tool === 'capture' || l.tool === 'text';
      const added: InkPoint[] = [];
      const sheets = getSheets(propsRef.current, minHeightRef.current);
      const sheet = sheets.find((s) => s.id === l.pageId) ?? sheets[0];
      const pageTop = l.pageTop ?? sheet.top;
      for (const s of samples) {
        const [docX, docY] = toDoc(s);
        const raw: InkPoint = [docX, docY - pageTop, l.kind === 'pen' ? clamp(s.p || 0.5, 0.05, 1) : 0.5];
        if (inking && propsRef.current.extendable && (!propsRef.current.pages || propsRef.current.pages.length <= 1)) {
          growFor(raw[1], GROW_AHEAD_INK);
        }
        const pt = inking ? clampToSheet(raw, sheet) : raw;
        // Lasso rectangulaire : on ne suit pas la main, on redessine le cadre entre le coin de départ
        // (toujours points[0]) et le doigt. Le reste du code reçoit un polygone fermé, comme à main levée.
        if (l.tool === 'lasso' && propsRef.current.lassoShape === 'rect') {
          const a = l.points[0] ?? pt;
          l.points.length = 0;
          l.points.push(a, [pt[0], a[1], 0.5], pt, [a[0], pt[1], 0.5], a);
          added.push(pt);
          continue;
        }
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
      if (dy < 0 && Math.abs(factor - 1) < 0.02) {
        if (propsRef.current.extendable && (!propsRef.current.pages || propsRef.current.pages.length <= 1)) {
          growFor((size.h - next.ty) / next.scale, GROW_AHEAD_SCROLL);
        }
      }
      viewRef.current = clampView(next, true);
      scheduleBase();
      bumpTick();
      if (factor !== 1) reportScale();

      const sheets = getSheets(propsRef.current, minHeightRef.current);
      if (sheets.length > 1) {
        const centerDocY = (size.h / 2 - viewRef.current.ty) / viewRef.current.scale;
        const currentSheet = findSheet(sheets, centerDocY);
        if (currentSheet.index !== activePageIndexRef.current) {
          activePageIndexRef.current = currentSheet.index;
          propsRef.current.onPageIndexChange?.(currentSheet.index);
        }
      }
    };

    panByRef.current = (dx, dy) => panZoom(dx, dy, rect.left + size.w / 2, rect.top + size.h / 2, 1);

    /** Le geste n'a été qu'un tap : à peine glissé, à peine appuyé */
    const wasTap = (l: Live) => {
      if (!l.points.length || performance.now() - (l.startedAt ?? 0) > TAP_MS) return false;
      const xs = l.points.map((pt) => pt[0]);
      const ys = l.points.map((pt) => pt[1]);
      return Math.max(...xs) - Math.min(...xs) < TAP_MM && Math.max(...ys) - Math.min(...ys) < TAP_MM;
    };
    /** La zone de texte sous (x, y) sur cette feuille (la plus haute de l'empilement), s'il y en a une */
    const textAt = (sheet: Sheet, x: number, y: number) =>
      [...sheet.page.strokes].reverse().find((st) => st.tool === 'text' && !hiddenRef.current.has(st.id) && strokeHit(st, x, y, 1));
    /**
     * Défilement continu : la page d'une sélection devient la page courante (c'est sur elle que le parent applique
     * couleurs, déplacement et suppression). Le repère est posé avant de prévenir le parent : la vue ne saute pas.
     */
    const activateSheet = (sheet: Sheet) => {
      const p = propsRef.current;
      if (getSheets(p, minHeightRef.current).length > 1 && sheet.index !== activePageIndexRef.current) {
        activePageIndexRef.current = sheet.index;
        p.onPageIndexChange?.(sheet.index);
      }
    };
    const selectText = (sheet: Sheet, stroke: Stroke) => {
      activateSheet(sheet);
      propsRef.current.onTapText(stroke.id);
    };

    const listener: ClassifierListener = {
      drawStart(id, kind, samples) {
        const p = propsRef.current;
        const tool: LiveTool = eraserPointers.has(id) ? 'eraser' : p.tool;
        const highlighter = tool === 'highlighter';
        const sheets = getSheets(p, minHeightRef.current);
        const [, docY] = samples.length ? toDoc(samples[0]) : [0, 0];
        const targetSheet = findSheet(sheets, docY);
        const l: Live = {
          kind, tool, color: highlighter ? p.highlightColor : tool === 'shapes' ? p.shapeColor : p.color, size: highlighter ? p.highlightSize : p.size,
          points: [], predicted: [], erased: new Set(), cursor: null, dx: 0, dy: 0, moving: [],
          pageId: targetSheet.id,
          pageTop: targetSheet.top,
          startedAt: performance.now(),
        };
        if (tool === 'lasso' && p.selection.length && samples.length) {
          // Appui dans la sélection : on la déplace au lieu de tracer un nouveau lasso
          const first = toPage(samples[0], kind, targetSheet);
          const chosen = new Set(p.selection);
          const allStrokes = p.pages ? p.pages.flatMap((pg) => pg.strokes) : p.strokes;
          const moving = allStrokes.filter((s) => chosen.has(s.id));
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
        if ((tool === 'pen' || highlighter || tool === 'shapes' || tool === 'capture') && (p.selection.length || p.selectionRegion)) p.onSelect([]);
        present();
      },
      drawMove(id, samples, predicted) {
        const l = lives.get(id);
        if (!l) return;
        const sheets = getSheets(propsRef.current, minHeightRef.current);
        const sheet = sheets.find((s) => s.id === l.pageId) ?? sheets[0];
        const pageTop = l.pageTop ?? sheet.top;
        if (l.tool === 'move') {
          const [docX, docY] = toDoc(samples[samples.length - 1]);
          const current = [docX, docY - pageTop];
          l.dx = current[0] - l.points[0][0];
          l.dy = current[1] - l.points[0][1];
          present();
          return;
        }
        if (l.tool === 'shape' && l.follow) {
          // Ajustement en direct : le coin suit le déplacement du stylet depuis le « snap »
          const [docX, docY] = toDoc(samples[samples.length - 1]);
          const now = [docX, docY - pageTop];
          const { from, far } = l.follow;
          l.points = [l.points[0], [clamp(far[0] + now[0] - from[0], 0, sheet.width), clamp(far[1] + now[1] - from[1], 0, sheet.height), 0.5]];
          present();
          return;
        }
        const added = addPoints(l, samples);
        if (l.tool === 'eraser') eraseAt(l, added);
        l.predicted = l.tool === 'pen' || l.tool === 'highlighter' ? predicted.map((s) => {
          const [docX, docY] = toDoc(s);
          return [docX, docY - pageTop, l.kind === 'pen' ? clamp(s.p || 0.5, 0.05, 1) : 0.5] as InkPoint;
        }) : [];
        // Dessin immédiat dans le gestionnaire d'événement : latence minimale
        present();
      },
      drawEnd(id) {
        const l = lives.get(id);
        lives.delete(id);
        if (!l) return;
        const p = propsRef.current;
        const sheets = getSheets(p, minHeightRef.current);
        const sheet = sheets.find((s) => s.id === l.pageId) ?? sheets[0];
        const pageTop = l.pageTop ?? sheet.top;
        // Un tap du stylo ou du surligneur sur une zone de texte la sélectionne, au lieu d'y laisser un point
        const end = l.points[l.points.length - 1];
        const tappedText = (l.tool === 'pen' || l.tool === 'highlighter') && wasTap(l) ? textAt(sheet, end[0], end[1]) : undefined;
        if (tappedText) {
          selectText(sheet, tappedText);
        } else if ((l.tool === 'pen' || l.tool === 'highlighter') && l.points.length) {
          const stroke: Stroke = { id: newId(), points: l.points, color: l.color, size: l.size, input: l.kind };
          if (l.tool === 'highlighter') stroke.tool = 'highlighter';
          else if (l.dashed) stroke.dashed = true;
          setTransform(base);
          base.save();
          base.translate(0, pageTop);
          drawStroke(base, stroke);
          base.restore();
          p.onAddStroke(stroke, l.pageId);
        } else if ((l.tool === 'shape' || l.tool === 'shapes') && l.shapeKind && l.points.length) {
          let a = l.points[0];
          let b = l.points[l.points.length - 1];
          // Tampon simplement tapoté (pas glissé) : on le pose à une taille par défaut, centré sur le point touché
          if (l.tool === 'shapes' && Math.hypot(b[0] - a[0], b[1] - a[1]) < 3) {
            const [dw, dh] = DEFAULT_SHAPE_SIZE[l.shapeKind];
            const [cx, cy] = b;
            a = [clamp(cx - dw / 2, 0, sheet.width), clamp(cy - dh / 2, 0, sheet.height), 0.5];
            b = [clamp(cx + dw / 2, 0, sheet.width), clamp(cy + dh / 2, 0, sheet.height), 0.5];
          }
          const stroke: Stroke = { id: newId(), tool: 'shape', shape: l.shapeKind, points: [a, b], color: l.color, size: l.size, input: l.kind };
          if (l.dashed) stroke.dashed = true;
          setTransform(base);
          base.save();
          base.translate(0, pageTop);
          drawStroke(base, stroke);
          base.restore();
          p.onAddStroke(stroke, l.pageId);
          // La forme reste sélectionnée, avec ses poignées : on peut ajuster ses dimensions exactes
          p.onSelect([stroke.id]);
          // Un tampon posé rend la main au stylo : la prochaine écriture ne dessine pas une forme par mégarde
          if (l.tool === 'shapes') p.onSwitchTool('pen');
        } else if (l.tool === 'text' && l.points.length && l.pageId) {
          const a = l.points[0];
          const b = l.points[l.points.length - 1];
          const tap = Math.hypot(b[0] - a[0], b[1] - a[1]) < 3;
          // Un tap sur une zone de texte : on la sélectionne (un second tap, ou « Modifier », pour y écrire)
          const hit = tap ? textAt(sheet, b[0], b[1]) : undefined;
          // Sinon, focus tout de suite, dans le geste : le clavier virtuel s'ouvre (voir textArea)
          if (!hit) textArea.current?.focus({ preventScroll: true });
          if (hit) selectText(sheet, hit);
          else if (tap) {
            // Un tap ailleurs : une nouvelle zone, là où l'on a touché
            const x = clamp(b[0], 0, Math.max(0, sheet.width - MIN_TEXT_WIDTH));
            p.onTextTarget({ pageId: l.pageId, x, y: b[1], width: Math.max(MIN_TEXT_WIDTH, Math.min(DEFAULT_TEXT_WIDTH, sheet.width - x - 5)), tap: true });
          } else {
            const x = Math.min(a[0], b[0]);
            p.onTextTarget({ pageId: l.pageId, x, y: Math.min(a[1], b[1]), width: Math.max(MIN_TEXT_WIDTH, Math.abs(b[0] - a[0])), tap: false });
          }
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
            base.translate(0, pageTop);
            base.translate(l.dx, l.dy);
            for (const s of l.moving) drawStroke(base, s);
            base.restore();
            p.onMoveSelection(l.dx, l.dy);
          } else {
            scheduleBase();
            // Un tap sur la zone de texte déjà sélectionnée : on écrit dedans (focus dans le geste : le clavier s'ouvre)
            const only = l.moving.length === 1 && l.moving[0].tool === 'text' ? l.moving[0] : null;
            const home = only && sheets.find((sh) => sh.page.strokes.some((st) => st.id === only.id));
            if (only && home && performance.now() - (l.startedAt ?? 0) < TAP_MS) {
              textArea.current?.focus({ preventScroll: true });
              p.onTextTarget({ pageId: home.id, stroke: only });
            }
          }
        } else if (l.tool === 'eraser' && l.edits?.size) {
          setTransform(base);
          base.save();
          base.translate(0, pageTop);
          for (const pieces of l.edits.values()) for (const piece of pieces) drawStroke(base, piece); // évite un clignotement
          base.restore();
          p.onReplaceStrokes(new Map(l.edits));
        } else if (l.tool === 'eraser' && l.erased.size) {
          p.onErase([...l.erased]);
        } else if (l.tool === 'lasso' && wasTap(l) && textAt(sheet, l.points[0][0], l.points[0][1])) {
          // Un tap du lasso sur une zone de texte : elle seule est sélectionnée
          selectText(sheet, textAt(sheet, l.points[0][0], l.points[0][1])!);
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
          const ids = strokesInLasso(sheet.page.strokes, l.points.map(([x, y]) => [x, y]));
          if (ids.length) activateSheet(sheet);
          p.onSelect(ids, region);
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
      // Le doigt qui ne dessine pas (mode stylet, outil Main) : un tap sélectionne la zone de texte touchée, un
      // tap ailleurs referme la sélection
      tap: (x, y) => {
        const p = propsRef.current;
        const [docX, docY] = toDoc({ x, y, p: 0.5, t: 0, size: 0 });
        const sheet = findSheet(getSheets(p, minHeightRef.current), docY);
        const hit = docX >= 0 && docX <= sheet.width ? textAt(sheet, docX, docY - sheet.top) : undefined;
        if (hit) selectText(sheet, hit);
        else if (p.selection.length) p.onSelect([]);
      },
      penDetected: () => propsRef.current.onPenDetected(),
      /**
       * Appui long immobile : ce contact devient une gomme jusqu'à ce qu'il se lève (comme JNotes).
       * Marche quel que soit l'outil d'encre/forme actif (y compris Formes & tampons), pas seulement
       * le stylo : un appui statique n'a de toute façon aucun autre sens utile pour ces outils-là.
       */
      holdErase(id) {
        const l = lives.get(id);
        if (!l || (l.tool !== 'pen' && l.tool !== 'highlighter' && l.tool !== 'shapes')) return;
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
        // Cercle et carré parfaits, ligne alignée : la main tremble, la forme non
        far = regularizeShape(kind, anchor, far);
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


    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      // Une zone de texte est ouverte : ce tap la valide (preventDefault empêche le champ de perdre le
      // focus tout seul), et rien d'autre : ni nouvelle zone avec l'outil Texte, ni point de stylo sur la page.
      if (propsRef.current.textEdit) {
        propsRef.current.onTextDone();
        textArea.current?.blur(); // referme aussi le clavier virtuel
        return;
      }
      try {
        displayCanvas.setPointerCapture(e.pointerId);
      } catch {
        /* pointeur déjà relâché */
      }
      rect = displayCanvas.getBoundingClientRect();
      applyConfig();
      const kind = kindOf(e);
      const sample = sampleOf(e);
      // Bouton latéral (2) ou gomme (32) d'un stylet actif : gomme temporaire
      if (kind === 'pen' && (e.buttons & 2 || e.buttons & 32)) eraserPointers.add(e.pointerId);
      // Posé dans la marge (hors de la feuille) : ça déplace la vue, comme sur GoodNotes, jamais un trait
      const [docX, docY] = toDoc(sample);
      const sheets = getSheets(propsRef.current, minHeightRef.current);
      const sheet = findSheet(sheets, docY);
      const inMargin = docX < 0 || docX > sheet.width || docY < sheet.top || docY > sheet.bottom;
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
      classifier.move(e.pointerId, list.map(sampleOf), predicted.map(sampleOf));
    };
    const onUp = (e: PointerEvent) => {
      classifier.up(e.pointerId, sampleOf(e));
      eraserPointers.delete(e.pointerId);

      // Déclenchement de l'ajout d'une page par overscroll
      if (currentOverscroll > 0) {
        if (currentOverscroll >= OVERSCROLL_PULL_PX && propsRef.current.onAddPage) {
          propsRef.current.onAddPage();
        }
        viewRef.current = clampView(viewRef.current, false);
        scheduleBase();
        bumpTick();
      }
    };
    const onCancel = (e: PointerEvent) => {
      classifier.cancel(e.pointerId);
      eraserPointers.delete(e.pointerId);
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
        const sheets = getSheets(propsRef.current, minHeightRef.current);
        const pw = docW(sheets, propsRef.current.pageWidth);
        const scale = clamp((w - 32) / pw, MIN_SCALE, pw > propsRef.current.pageHeight ? 6 : 4.2);
        const targetSheet = sheets[propsRef.current.currentPageIndex ?? 0] ?? sheets[0];
        const targetTy = targetSheet ? TOP_GAP - targetSheet.top * scale : TOP_GAP;
        viewRef.current = { scale, tx: (w - pw * scale) / 2, ty: targetTy };
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
      offImageReady();
    };
    // Installation unique ; les props courantes sont lues via propsRef.
    // Changer lowLatency exige une nouvelle toile : le parent remonte le composant (key).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { config, tool, penSeen, restZone, strokes, pages, paper, paperColor, selection, background } = props;
  useEffect(() => {
    applyConfigRef.current();
  }, [config, tool, penSeen, restZone]);

  useEffect(() => {
    // Les traits effacés restent masqués jusqu'à leur retrait effectif de la page
    const all = pages ? pages.flatMap((p) => p.strokes) : strokes;
    const ids = new Set(all.map((s) => s.id));
    for (const id of hiddenRef.current) if (!ids.has(id)) hiddenRef.current.delete(id);
    redrawRef.current();
  }, [pages, strokes, paper, paperColor, background]);

  const { selectionRegion } = props;
  const allStrokes = useMemo(() => {
    return props.pages ? props.pages.flatMap((p) => p.strokes) : props.strokes;
  }, [props.pages, props.strokes]);

  /** Les traits choisis, dans l'ordre d'empilement de la page */
  const chosen = useMemo(() => {
    const ids = new Set(selection);
    return allStrokes.filter((s) => ids.has(s.id));
  }, [selection, allStrokes]);
  /** Poignée en cours de glissé : cadre et poignées suivent l'aperçu au lieu de rester sur la sélection d'origine */
  const [xf, setXf] = useState<TransformDrag | null>(null);
  const dragging = xf !== null;
  const shown = xf?.strokes ?? chosen;

  /** Décalage vertical (mm) de la feuille de chaque trait dans le défilement continu ; une page seule : 0 partout */
  const { pages: canvasPages } = props;
  const strokeSheetOffset = useMemo(() => {
    const map = new Map<string, number>();
    let top = 0;
    for (const page of canvasPages ?? []) {
      for (const s of page.strokes) map.set(s.id, top);
      top += page.height + PAGE_GAP; // même empilement que getSheets
    }
    return map;
  }, [canvasPages]);

  /** Le cadre de la sélection (mm) : ses traits, plus la zone du lasso tant qu'on ne les transforme pas */
  const selMm = useMemo(() => {
    const boxes = shown.map((s) => {
      const bb = strokeBBox(s);
      const topOffset = strokeSheetOffset.get(s.id) ?? 0;
      return { minX: bb.minX, maxX: bb.maxX, minY: bb.minY + topOffset, maxY: bb.maxY + topOffset };
    });
    if (selectionRegion && !dragging) boxes.push(selectionRegion);
    return unionBBox(boxes);
  }, [shown, strokeSheetOffset, selectionRegion, dragging]);
  // Recalculé à chaque rendu (quelques multiplications) : la vue change sans que React le sache, c'est
  // viewTick qui provoque le rendu quand elle bouge
  const selBox = (() => {
    if (!selMm) return null;
    const v = viewRef.current;
    const pad = 6;
    return {
      left: selMm.minX * v.scale + v.tx - pad,
      top: selMm.minY * v.scale + v.ty - pad,
      width: (selMm.maxX - selMm.minX) * v.scale + 2 * pad,
      height: (selMm.maxY - selMm.minY) * v.scale + 2 * pad,
    };
  })();
  const regionOnly = selection.length === 0;

  // Poignées : 4 angles (échelle proportionnelle) et une poignée de rotation, pour toute sélection de traits ; s'y
  // ajoutent les bords d'une forme droite seule (étirement) ou, pour une ligne ou une flèche seule, ses deux bouts.
  const editable = !!selBox && !regionOnly && shown.length > 0;
  const only = shown.length === 1 ? shown[0] : null;
  const handles = editable && xf?.kind !== 'rotate' ? layoutHandles(selBox, only, viewRef.current) : [];
  const stage = { w: containerRef.current?.clientWidth ?? 0, h: containerRef.current?.clientHeight ?? 0 };
  const rotate = editable && (!xf || xf.kind === 'rotate') ? (xf?.rot ?? rotatePosition(selBox, stage)) : null;
  // Le bandeau d'actions se tient au-dessus du cadre, hors de portée des poignées d'angle (et de celle de rotation, si elle passe au-dessus).
  // Il s'aligne à gauche du cadre, mais recule pour tenir dans la zone : il ne passe pas sur deux lignes, par-dessus la sélection.
  const barRaise = rotate?.above ? ROTATE_GAP + ROTATE_SIZE : editable ? 24 : 0;
  const barLeft = selBox ? Math.max(8, Math.min(selBox.left, stage.w - (regionOnly ? BAR_WIDTH_REGION : BAR_WIDTH) - 8)) : 8;

  /** « Modifier » : écrire dans la zone de texte sélectionnée (focus dans le geste : le clavier virtuel s'ouvre) */
  const editText = (stroke: Stroke) => {
    const home = getSheets(props, minHeightRef.current).find((sh) => sh.page.strokes.some((st) => st.id === stroke.id));
    if (!home) return;
    textArea.current?.focus({ preventScroll: true });
    props.onTextTarget({ pageId: home.id, stroke });
  };

  /** Échelle (poignées d'angle) ou rotation (poignée du dessous) de toute la sélection : aperçu en direct, puis une seule entrée d'historique. */
  const dragTransform = (e: ReactPointerEvent<HTMLElement>, kind: ScaleCorner | 'rotate') => {
    const container = containerRef.current;
    if (xf || !selMm || !container || chosen.length === 0) return;
    const box = selMm;
    const targets = chosen;
    const toPage = (ev: { clientX: number; clientY: number }): [number, number] => {
      const r = container.getBoundingClientRect();
      const v = viewRef.current;
      return [(ev.clientX - r.left - v.tx) / v.scale, (ev.clientY - r.top - v.ty) / v.scale];
    };
    const from = toPage(e.nativeEvent);
    const pivot: [number, number] = [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2];
    const corner: [number, number] = [kind.includes('w') ? box.minX : box.maxX, kind.includes('n') ? box.minY : box.maxY];
    // Aimantation de la rotation sur des multiples de 15° : une ligne seule se remet droite sans viser
    const base = targets.length === 1 ? orientation(targets[0]) : 0;
    const rot = kind === 'rotate' && rotate ? rotate : undefined;
    const api = editApiRef.current;
    api.begin(targets);
    let latest: Stroke[] | null = null;
    let changed = false;
    trackDrag(
      e,
      (ev) => {
        const p = propsRef.current;
        const sheets = getSheets(p, minHeightRef.current);
        // La sélection ne sort pas de la page ; sur une page d'écriture, le papier s'allonge vers le bas
        const room = { width: docW(sheets, p.pageWidth), height: p.extendable ? MAX_PAGE_HEIGHT : docH(sheets) };
        const now = toPage(ev);
        let m: Similarity;
        if (kind === 'rotate') m = { px: pivot[0], py: pivot[1], k: 1, theta: rotationDelta(pivot, from, now, base) };
        else {
          const { k, anchor } = cornerScale(box, kind, [corner[0] + now[0] - from[0], corner[1] + now[1] - from[1]], room);
          m = { px: anchor[0], py: anchor[1], k, theta: 0 };
        }
        let next = targets.map((s) => transformStroke(s, m));
        const [dx, dy] = fitShift(next, room);
        if (dx || dy) {
          m = { ...m, dx, dy };
          next = targets.map((s) => transformStroke(s, m));
        }
        latest = next;
        changed = Math.abs(m.k - 1) > 1e-4 || Math.abs(m.theta) > 1e-4 || !!dx || !!dy;
        api.grow(unionBBox(next.map(strokeBBox))?.maxY ?? 0);
        api.preview(targets, next, m);
        const r = container.getBoundingClientRect();
        setXf({
          kind: kind === 'rotate' ? 'rotate' : 'scale',
          strokes: next,
          rot,
          angle: Math.round((normalizeAngle(base + m.theta) * 180) / Math.PI),
          at: [ev.clientX - r.left, ev.clientY - r.top],
        });
      },
      (cancelled) => {
        const done = !cancelled && latest && changed ? latest : null;
        api.end(done);
        setXf(null);
        if (done) propsRef.current.onTransformStrokes(done);
      },
    );
  };

  /** Étirer une forme droite par un bord, ou déplacer un bout de ligne ou de flèche. */
  const dragStretch = (e: ReactPointerEvent<HTMLElement>, handle: ResizeHandle) => {
    const target = chosen.length === 1 ? chosen[0] : null;
    if (xf || !target) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const api = editApiRef.current;
    api.begin([target]);
    let latest: Stroke | null = null;
    trackDrag(
      e,
      (ev) => {
        const v = viewRef.current;
        const p = propsRef.current;
        const sheets = getSheets(p, minHeightRef.current);
        const points = resizedPoints(target.points, handle, (ev.clientX - startX) / v.scale, (ev.clientY - startY) / v.scale, {
          width: docW(sheets, p.pageWidth),
          height: p.extendable ? MAX_PAGE_HEIGHT : docH(sheets),
        });
        latest = { ...target, points };
        api.grow(Math.max(points[0][1], points[1][1]));
        api.preview([target], [latest], null);
        setXf({ kind: 'stretch', strokes: [latest] });
      },
      (cancelled) => {
        const done = !cancelled && latest ? [latest] : null;
        api.end(done);
        setXf(null);
        if (done) propsRef.current.onTransformStrokes(done);
      },
    );
  };

  const { captureRegion } = props;
  const capBox = (() => {
    if (!captureRegion) return null;
    const v = viewRef.current;
    return {
      left: captureRegion.minX * v.scale + v.tx,
      top: captureRegion.minY * v.scale + v.ty,
      width: (captureRegion.maxX - captureRegion.minX) * v.scale,
      height: (captureRegion.maxY - captureRegion.minY) * v.scale,
    };
  })();

  /** Poignées de recadrage (comme un crop d'image) : glissé natif, en dehors du classifieur anti-paume. */
  const dragCaptureHandle = (e: ReactPointerEvent<HTMLDivElement>, corner: Corner) => {
    const region = propsRef.current.captureRegion;
    if (!region) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const orig = { ...region };
    trackDrag(e, (ev) => {
      const v = viewRef.current;
      const p = propsRef.current;
      const sheets = getSheets(p, minHeightRef.current);
      const dxMm = (ev.clientX - startX) / v.scale;
      const dyMm = (ev.clientY - startY) / v.scale;
      let { minX, minY, maxX, maxY } = orig;
      if (corner.includes('w')) minX = clamp(orig.minX + dxMm, 0, orig.maxX - 4);
      if (corner.includes('e')) maxX = clamp(orig.maxX + dxMm, orig.minX + 4, docW(sheets, p.pageWidth));
      if (corner.includes('n')) minY = clamp(orig.minY + dyMm, 0, orig.maxY - 4);
      if (corner.includes('s')) maxY = clamp(orig.maxY + dyMm, orig.minY + 4, docH(sheets));
      p.onCaptureRegion({ minX, minY, maxX, maxY });
    });
  };
  const handlePos = (box: { left: number; top: number; width: number; height: number }, corner: Corner) => ({
    left: (corner.includes('w') ? box.left : corner.includes('e') ? box.left + box.width : box.left + box.width / 2) - HANDLE_SIZE / 2,
    top: (corner.includes('n') ? box.top : corner.includes('s') ? box.top + box.height : box.top + box.height / 2) - HANDLE_SIZE / 2,
  });

  // ---- Zone de texte en cours de frappe : un vrai champ, posé exactement sur la boîte de la page
  const { textEdit, onTextChange, onTextDone } = props;
  const editedTextId = textEdit?.id ?? null;
  useEffect(() => {
    // Le texte d'origine est masqué pendant qu'on le modifie : le champ le remplace
    if (!editedTextId) return;
    // L'ensemble des traits masqués garde la même identité toute la vie du canevas ; le redessin, lui, est
    // relu au moment de l'appel (il est installé par l'effet principal)
    const hidden = hiddenRef.current;
    const redraw = () => redrawRef.current();
    hidden.add(editedTextId);
    redraw();
    return () => {
      hidden.delete(editedTextId);
      redraw();
    };
  }, [editedTextId]);
  const editKey = textEdit ? `${textEdit.pageId}:${textEdit.id ?? ''}:${textEdit.x}:${textEdit.y}` : null;
  useEffect(() => {
    if (!editKey) return;
    const el = textArea.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
    // Le champ doit rester au-dessus du clavier virtuel : s'il est bas dans la zone, on fait défiler
    const host = containerRef.current?.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    if (host && box.top > host.top + host.height * 0.45) panByRef.current(0, -(box.top - (host.top + host.height * 0.25)));
  }, [editKey]);
  // À chaque rendu (zoom, défilement, frappe) : la hauteur du champ suit son contenu à l'échelle courante
  useLayoutEffect(() => {
    const el = textArea.current;
    if (!el || !textEdit) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  });
  const textBox = (() => {
    if (!textEdit) return null;
    const v = viewRef.current;
    const sheet = getSheets(props, minHeightRef.current).find((sh) => sh.id === textEdit.pageId);
    if (!sheet) return null;
    const lines = Math.max(1, textEdit.text.split('\n').length);
    return {
      left: textEdit.x * v.scale + v.tx,
      top: (sheet.top + textEdit.y) * v.scale + v.ty,
      width: textEdit.width * v.scale,
      minHeight: textBoxHeight(lines, textEdit.size) * v.scale,
      fontSize: textEdit.size * v.scale,
      padding: textPadding(textEdit.size) * v.scale,
    };
  })();

  // ---- Couche de texte (mode « Texte ») : seulement les feuilles à l'écran
  const { textLayer, highlights } = props;
  const ocrSheets = (() => {
    if (!textLayer && !highlights?.length) return [];
    const v = viewRef.current;
    const h = containerRef.current?.clientHeight ?? 0;
    return getSheets(props, minHeightRef.current).filter((sh) => sh.bottom * v.scale + v.ty > -50 && sh.top * v.scale + v.ty < h + 50);
  })();
  useLayerCopy(!!textLayer);
  /** Un doigt qui glisse vite depuis un mot fait défiler la page ; un appui long, lui, sélectionne */
  const swipe = useRef<{ id: number; x: number; y: number; t: number; panning: boolean } | null>(null);
  const ocrDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    swipe.current = e.pointerType === 'touch' ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, panning: false } : null;
  };
  const ocrMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = swipe.current;
    if (!s || s.id !== e.pointerId) return;
    if (!s.panning) {
      if (e.timeStamp - s.t > 350) {
        swipe.current = null; // appui long en cours : c'est une sélection, on ne touche à rien
        return;
      }
      if (Math.hypot(e.clientX - s.x, e.clientY - s.y) < 10) return;
      s.panning = true;
    }
    panByRef.current(e.clientX - s.x, e.clientY - s.y);
    s.x = e.clientX;
    s.y = e.clientY;
  };
  const ocrUp = () => {
    swipe.current = null;
  };

  return (
    <div className="ink-area" ref={containerRef}>
      <canvas ref={displayRef} className="ink-layer" />
      {ocrSheets.length > 0 && (
        <div className="ocr-layer" onPointerDown={ocrDown} onPointerMove={ocrMove} onPointerUp={ocrUp} onPointerCancel={ocrUp}>
          {ocrSheets.map((sh) => {
            const v = viewRef.current;
            const words = textLayer?.get(sh.id);
            const marks = highlights?.filter((b) => b.pageId === sh.id);
            return (
              <div key={sh.id} className="ocr-place" style={{ transform: `translate(${v.tx}px, ${sh.top * v.scale + v.ty}px) scale(${v.scale / UNIT})` }}>
                {marks && marks.length > 0 && <SheetHighlights boxes={marks} width={sh.width} height={sh.height} />}
                {words && <SheetText words={words} width={sh.width} height={sh.height} />}
              </div>
            );
          })}
        </div>
      )}
      <textarea
        ref={textArea}
        className={`text-edit ${textEdit && textBox ? '' : 'text-edit-idle'}`}
        value={textEdit?.text ?? ''}
        onChange={(e) => {
          if (!textEdit) return;
          onTextChange(e.target.value);
          // Le champ grandit avec son contenu (retours à la ligne automatiques compris)
          e.target.style.height = 'auto';
          e.target.style.height = `${e.target.scrollHeight}px`;
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onTextDone();
            e.currentTarget.blur();
          }
        }}
        onBlur={() => textEdit && onTextDone()}
        tabIndex={textEdit ? 0 : -1}
        aria-hidden={!textEdit}
        spellCheck
        autoComplete="off"
        aria-label="Texte de la zone"
        placeholder="Tape ton texte…"
        style={
          textEdit && textBox
            ? {
                left: textBox.left,
                top: textBox.top,
                width: textBox.width,
                minHeight: textBox.minHeight,
                fontSize: textBox.fontSize,
                lineHeight: TEXT_LINE_HEIGHT,
                padding: textBox.padding,
                color: textEdit.color,
                fontFamily: TEXT_FONT,
              }
            : undefined
        }
      />
      {restZone > 0 && (
        <div className="rest-zone" style={{ height: `${restZone * 100}%` }}>
          <span>Zone de repos pour la main</span>
        </div>
      )}
      {selBox && xf?.kind !== 'rotate' && (
        <>
          <div className="selection-box" style={selBox} />
          {!xf && (
            <div className="selection-actions" style={{ left: barLeft, top: Math.max(8, selBox.top - 52 - barRaise) }}>
              {!regionOnly && (
                <>
                  {props.selectionColors.map((c) => (
                    <button key={c} className="swatch small" style={{ background: c }} aria-label="Changer la couleur" onClick={() => props.onRecolorSelection(c)} />
                  ))}
                  <MultiColorSwatch initial={props.selectionColors[0]} onCommit={props.onPickSelectionColor} />
                  {only?.tool === 'text' && <button onClick={() => editText(only)}>Modifier</button>}
                  <button onClick={props.onDuplicateSelection}>Dupliquer</button>
                  <button onClick={props.onCopySelection}>Copier</button>
                  <button onClick={props.onDeleteSelection}>Supprimer</button>
                </>
              )}
              <button aria-label="Désélectionner" onClick={() => props.onSelect([])}>
                ✕
              </button>
            </div>
          )}
        </>
      )}
      {handles.map((h) => (
        <div
          key={h.id}
          className={`xf-handle ${isCorner(h.id) ? 'xf-corner' : 'xf-edge'} handle-${h.id}`}
          style={{ left: h.left - h.size / 2, top: h.top - h.size / 2, width: h.size, height: h.size }}
          onPointerDown={(e) => (isCorner(h.id) ? dragTransform(e, h.id) : dragStretch(e, h.id))}
          aria-label={isCorner(h.id) ? 'Redimensionner en gardant les proportions' : 'Étirer'}
        />
      ))}
      {rotate && selBox && (
        <>
          {!xf && (
            <div
              className="xf-stem"
              style={{
                left: rotate.left - 1,
                top: rotate.above ? rotate.top + ROTATE_SIZE / 2 : selBox.top + selBox.height,
                height: Math.max(0, rotate.above ? selBox.top - rotate.top - ROTATE_SIZE / 2 : rotate.top - ROTATE_SIZE / 2 - selBox.top - selBox.height),
              }}
            />
          )}
          <div
            className="xf-handle xf-rotate"
            style={{ left: rotate.left - ROTATE_SIZE / 2, top: rotate.top - ROTATE_SIZE / 2, width: ROTATE_SIZE, height: ROTATE_SIZE }}
            onPointerDown={(e) => dragTransform(e, 'rotate')}
            aria-label="Faire pivoter"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
          </div>
        </>
      )}
      {xf?.kind === 'rotate' && xf.at && (
        <div className="xf-badge" style={{ left: xf.at[0] + 18, top: xf.at[1] - 42 }}>
          {xf.angle}°
        </div>
      )}
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
