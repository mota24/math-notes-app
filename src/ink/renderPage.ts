import { drawPaper, drawStroke } from './draw';
import type { PaperColor, PaperStyle, Stroke } from './types';

/** Ce qu'il faut pour dessiner une page hors de l'éditeur (lecture seule, écran partagé). */
export interface RenderablePage {
  /** Dimensions en mm */
  width: number;
  height: number;
  paper: PaperStyle;
  paperColor?: PaperColor;
  strokes: Stroke[];
}

/** Au-delà, un canevas coûte trop de mémoire à une tablette (une longue page à fort zoom) : on réduit la définition. */
const MAX_PIXELS = 14_000_000;

/**
 * Dessine une page entière — papier réglé (ou fond PDF / photo), puis l'encre — dans `canvas`, affiché à
 * `cssWidth` px CSS de large. Même dessin que l'éditeur (drawPaper, drawStroke) : la page partagée ou ouverte
 * à côté est identique à l'originale, à la définition de l'écran (devicePixelRatio).
 */
export function renderPage(
  canvas: HTMLCanvasElement,
  page: RenderablePage,
  background: CanvasImageSource | null,
  cssWidth: number,
  defaultPaperColor: PaperColor = 'light',
) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const cssHeight = (page.height * cssWidth) / page.width;
  let w = Math.max(1, Math.round(cssWidth * dpr));
  let h = Math.max(1, Math.round(cssHeight * dpr));
  if (w * h > MAX_PIXELS) {
    const k = Math.sqrt(MAX_PIXELS / (w * h));
    w = Math.max(1, Math.floor(w * k));
    h = Math.max(1, Math.floor(h * k));
  }
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;

  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return;
  const pxPerMm = w / page.width; // pixels réels par mm
  ctx.setTransform(pxPerMm, 0, 0, pxPerMm, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const color = page.paperColor ?? defaultPaperColor;
  if (background) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, page.width, page.height);
    ctx.drawImage(background, 0, 0, page.width, page.height);
  } else {
    // Réglures d'un pixel CSS, comme dans l'éditeur
    drawPaper(ctx, page.paper, pxPerMm / dpr, page.width, page.height, color);
  }
  for (const s of page.strokes) drawStroke(ctx, s, background ? 'light' : color);
}
