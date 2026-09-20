import type { Glyph } from '../db/schema';
import { buildPath, paperLines } from '../ink/draw';
import type { InkPoint, PaperStyle } from '../ink/types';

/**
 * Export « manuscrit lisible » : la transcription est mise en page par le navigateur (KaTeX), puis
 * chaque caractère est redessiné à la main sur une page A4 : avec TON écriture si tu l'as enregistrée,
 * sinon avec une police manuscrite, et de petites variations pour que rien ne soit identique.
 */

export type HandStyle = 'mine' | 'caveat' | 'kalam' | 'patrick';

export const HAND_FONTS: Record<HandStyle, string> = {
  mine: 'Caveat',
  caveat: 'Caveat',
  kalam: 'Kalam',
  patrick: 'Patrick Hand',
};

const PX_PER_MM = 150 / 25.4; // A4 à 150 dpi
const PAGE_W = 1240;
const PAGE_H = 1754;
const MARGIN = { left: 24, right: 14, top: 24, bottom: 18 }; // mm

export type HandSize = 'small' | 'medium' | 'large';

/** Mise en page : taille d'écriture, et interligne multiple de 8 mm pour tomber sur les lignes Seyès. */
export function handLayout(size: HandSize) {
  const fontSize = size === 'small' ? 25 : size === 'large' ? 38 : 30;
  return {
    width: (210 - MARGIN.left - MARGIN.right) * PX_PER_MM,
    fontSize,
    lineHeight: (size === 'large' ? 12 : 8) * PX_PER_MM,
  };
}

export interface HandOptions {
  style: HandStyle;
  ink: string;
  paper: PaperStyle;
  glyphs: Map<string, Glyph>;
  /** Amplitude des variations naturelles (1 = normale) */
  variation: number;
}

function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Frame {
  ctx: CanvasRenderingContext2D;
  origin: DOMRect;
  ox: number;
  oy: number;
  opts: HandOptions;
  font: string;
  rand: () => number;
}

function drawChar(f: Frame, ch: string, r: DOMRect, fontSize: number, isMath: boolean) {
  const { ctx, opts, rand } = f;
  const x = r.left - f.origin.left + f.ox;
  const y = r.top - f.origin.top + f.oy;
  const v = opts.variation;
  const angle = (rand() - 0.5) * 0.09 * v;
  const dx = (rand() - 0.5) * fontSize * 0.04 * v;
  const dy = (rand() - 0.5) * fontSize * 0.06 * v;
  const scale = 1 + (rand() - 0.5) * 0.08 * v;
  const glyph = opts.style === 'mine' ? opts.glyphs.get(ch) : undefined;

  ctx.save();
  ctx.fillStyle = opts.ink;
  if (glyph) {
    const em = fontSize * 1.05 * scale;
    const baseline = y + r.height - fontSize * 0.24 + dy;
    ctx.translate(x + r.width / 2 - (glyph.advance * em) / 2 + dx, baseline);
    ctx.rotate(angle);
    const pen = Math.max(1.6, em * 0.075);
    for (const stroke of glyph.strokes) {
      if (stroke.length) ctx.fill(buildPath(stroke.map(([gx, gy, p]): InkPoint => [gx * em, gy * em, p]), 'touch', pen, true));
    }
  } else {
    ctx.translate(x + r.width / 2 + dx, y + r.height / 2 + dy);
    ctx.rotate(angle);
    ctx.font = `${fontSize * (isMath ? 1.12 : 1) * scale}px "${f.font}", "KaTeX_Main", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, 0, 0);
  }
  ctx.restore();
}

function drawShakyLine(f: Frame, x1: number, y1: number, x2: number, y2: number, width: number) {
  const { ctx, rand } = f;
  const length = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(2, Math.round(length / 22));
  ctx.save();
  ctx.strokeStyle = f.opts.ink;
  ctx.lineWidth = Math.max(1.8, width);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = x1 + (x2 - x1) * t + (rand() - 0.5) * 1.4 * f.opts.variation;
    const py = y1 + (y2 - y1) * t + (rand() - 0.5) * 1.4 * f.opts.variation;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.restore();
}

async function drawSvg(f: Frame, svg: SVGSVGElement) {
  const r = svg.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  // Sans viewBox, le dessin ne suivrait pas l'agrandissement (zoom CSS du tableau)
  const ownW = Number.parseFloat(svg.getAttribute('width') ?? '');
  const ownH = Number.parseFloat(svg.getAttribute('height') ?? '');
  if (!clone.getAttribute('viewBox') && ownW > 0 && ownH > 0) clone.setAttribute('viewBox', `0 0 ${ownW} ${ownH}`);
  clone.setAttribute('width', String(r.width));
  clone.setAttribute('height', String(r.height));
  if (!clone.getAttribute('fill')) clone.setAttribute('fill', f.opts.ink);
  const markup = new XMLSerializer().serializeToString(clone).replace(/currentColor/g, f.opts.ink);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  try {
    await img.decode();
    f.ctx.drawImage(img, r.left - f.origin.left + f.ox, r.top - f.origin.top + f.oy, r.width, r.height);
  } catch {
    /* forme non dessinable : ignorée */
  }
}

const LINE_CLASSES = ['frac-line', 'overline-line', 'underline-line', 'hline', 'hdashline', 'rule'];

/** Zoom CSS cumulé : les rectangles mesurés l'incluent, pas la taille de police calculée. */
function effectiveZoom(el: Element, root: Element): number {
  let zoom = 1;
  for (let e: Element | null = el; e; e = e === root ? null : e.parentElement) {
    const z = Number.parseFloat(getComputedStyle(e).zoom);
    if (z > 0 && z !== 1) zoom *= z;
  }
  return zoom;
}

async function drawBlock(f: Frame, root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node instanceof Element && (node.classList.contains('katex-mathml') || node.localName === 'svg')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement;
      const text = node.textContent ?? '';
      if (!parent || !text.trim()) continue;
      const fontSize = Number.parseFloat(getComputedStyle(parent).fontSize) * effectiveZoom(parent, root);
      const isMath = !!parent.closest('.katex');
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        const wide = code >= 0xd800 && code <= 0xdbff;
        const ch = wide ? text.slice(i, i + 2) : text[i];
        if (!/\s/.test(ch)) {
          range.setStart(node, i);
          range.setEnd(node, i + ch.length);
          const r = range.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) drawChar(f, ch, r, fontSize, isMath);
        }
        if (wide) i++;
      }
    } else {
      const el = node as HTMLElement;
      if (LINE_CLASSES.some((c) => el.classList.contains(c))) {
        const r = el.getBoundingClientRect();
        const y = r.top - f.origin.top + f.oy + r.height / 2;
        const x = r.left - f.origin.left + f.ox;
        if (r.width > 0) drawShakyLine(f, x, y, x + r.width, y, r.height);
      } else if (el.classList.contains('vertical-separator')) {
        const r = el.getBoundingClientRect();
        const x = r.left - f.origin.left + f.ox + r.width / 2;
        const y = r.top - f.origin.top + f.oy;
        if (r.height > 0) drawShakyLine(f, x, y, x, y + r.height, r.width);
      }
    }
  }
  for (const svg of root.querySelectorAll('svg')) await drawSvg(f, svg);
}

/** Dessine la mise en page (élément déjà présent dans le document) sur des pages A4. */
export async function renderHandwriting(
  layout: HTMLElement,
  opts: HandOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<HTMLCanvasElement[]> {
  const font = HAND_FONTS[opts.style];
  await document.fonts.load(`30px "${font}"`);
  await document.fonts.ready;

  const origin = layout.getBoundingClientRect();
  const contentHeight = (297 - MARGIN.top - MARGIN.bottom) * PX_PER_MM;
  const pages: { start: number; blocks: HTMLElement[] }[] = [];
  for (const el of layout.querySelectorAll<HTMLElement>('.blocks > *')) {
    const r = el.getBoundingClientRect();
    const top = r.top - origin.top;
    const current = pages[pages.length - 1];
    if (!current || r.bottom - origin.top - current.start > contentHeight) pages.push({ start: top, blocks: [el] });
    else current.blocks.push(el);
  }

  const rand = random(20260917);
  const canvases: HTMLCanvasElement[] = [];
  for (const [i, page] of pages.entries()) {
    const canvas = document.createElement('canvas');
    canvas.width = PAGE_W;
    canvas.height = PAGE_H;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    ctx.save();
    ctx.scale(PX_PER_MM, PX_PER_MM);
    ctx.lineWidth = 0.16;
    for (const group of paperLines(opts.paper, 210, 297)) {
      ctx.beginPath();
      for (const [x1, y1, x2, y2] of group.lines) {
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
      ctx.strokeStyle = group.color;
      ctx.stroke();
    }
    ctx.restore();

    const frame: Frame = { ctx, origin, ox: MARGIN.left * PX_PER_MM, oy: MARGIN.top * PX_PER_MM - page.start, opts, font, rand };
    for (const block of page.blocks) await drawBlock(frame, block);
    canvases.push(canvas);
    onProgress?.(i + 1, pages.length);
  }
  return canvases;
}
