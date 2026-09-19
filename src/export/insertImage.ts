import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Block } from '../ai/blocks';
import { BlocksView } from '../render/BlocksView';

/**
 * Glisser le résultat d'une conversion sur la page : la mise en page KaTeX (déjà utilisée pour
 * l'afficher dans le panneau) est redessinée telle quelle sur un canevas — même technique que l'export
 * manuscrit (mesure des caractères par Range, puis `fillText`), mais avec la vraie police KaTeX, sans
 * tremblement : une image nette, comme imprimée.
 */

const PX_PER_MM = 3.7795;
const RASTER_SCALE = 3; // netteté à l'impression et au zoom
const LINE_CLASSES = ['frac-line', 'overline-line', 'underline-line', 'hline', 'hdashline', 'rule'];

interface Frame {
  ctx: CanvasRenderingContext2D;
  origin: DOMRect;
  color: string;
  scale: number;
}

function drawLine(f: Frame, x1: number, y1: number, x2: number, y2: number, width: number) {
  const { ctx } = f;
  ctx.save();
  ctx.strokeStyle = f.color;
  ctx.lineWidth = Math.max(1, width);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

/** Formes dessinées en SVG par KaTeX (grandes parenthèses, racines…) : recopiées telles quelles. */
async function drawSvgEl(f: Frame, svg: SVGSVGElement) {
  const r = svg.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const ownW = Number.parseFloat(svg.getAttribute('width') ?? '');
  const ownH = Number.parseFloat(svg.getAttribute('height') ?? '');
  if (!clone.getAttribute('viewBox') && ownW > 0 && ownH > 0) clone.setAttribute('viewBox', `0 0 ${ownW} ${ownH}`);
  clone.setAttribute('width', String(r.width));
  clone.setAttribute('height', String(r.height));
  if (!clone.getAttribute('fill')) clone.setAttribute('fill', f.color);
  const markup = new XMLSerializer().serializeToString(clone).replace(/currentColor/g, f.color);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  try {
    await img.decode();
    f.ctx.drawImage(img, (r.left - f.origin.left) * f.scale, (r.top - f.origin.top) * f.scale, r.width * f.scale, r.height * f.scale);
  } catch {
    /* forme non dessinable : ignorée, tant pis pour ce détail */
  }
}

/** Zoom CSS cumulé : les rectangles mesurés l'incluent, pas la taille de police calculée. */
function effectiveZoom(el: Element, root: Element): number {
  let zoom = 1;
  for (let e: Element | null = el; e; e = e === root ? null : e.parentElement) {
    const z = Number.parseFloat(getComputedStyle(e).zoom);
    if (z > 0 && z !== 1) zoom *= z;
  }
  return zoom;
}

async function drawBlockClean(f: Frame, root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node instanceof Element && (node.classList.contains('katex-mathml') || node.localName === 'svg')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const range = document.createRange();
  const { ctx, origin, scale } = f;
  ctx.fillStyle = f.color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement;
      const text = node.textContent ?? '';
      if (!parent || !text.trim()) continue;
      const style = getComputedStyle(parent);
      const fontSize = Number.parseFloat(style.fontSize) * effectiveZoom(parent, root);
      ctx.font = `${style.fontStyle === 'italic' ? 'italic ' : ''}${style.fontWeight} ${fontSize * scale}px ${style.fontFamily}`;
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        const wide = code >= 0xd800 && code <= 0xdbff;
        const ch = wide ? text.slice(i, i + 2) : text[i];
        if (!/\s/.test(ch)) {
          range.setStart(node, i);
          range.setEnd(node, i + ch.length);
          const r = range.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            ctx.fillText(ch, (r.left - origin.left + r.width / 2) * scale, (r.top - origin.top + r.height / 2) * scale);
          }
        }
        if (wide) i++;
      }
    } else {
      const el = node as HTMLElement;
      if (LINE_CLASSES.some((c) => el.classList.contains(c))) {
        const r = el.getBoundingClientRect();
        const y = (r.top - origin.top + r.height / 2) * scale;
        const x = (r.left - origin.left) * scale;
        if (r.width > 0) drawLine(f, x, y, x + r.width * scale, y, r.height * scale);
      } else if (el.classList.contains('vertical-separator')) {
        const r = el.getBoundingClientRect();
        const x = (r.left - origin.left + r.width / 2) * scale;
        const y = (r.top - origin.top) * scale;
        if (r.height > 0) drawLine(f, x, y, x, y + r.height * scale, r.width * scale);
      }
    }
  }
  for (const svg of root.querySelectorAll('svg')) await drawSvgEl(f, svg);
}

export interface RenderedImage {
  /** PNG, fond transparent */
  dataUrl: string;
  widthMm: number;
  heightMm: number;
}

/**
 * Rendu net (police KaTeX normale, pas d'écriture manuscrite, fond transparent) d'un ensemble de blocs
 * convertis, prêt à être posé sur la page.
 */
export async function renderBlocksImage(blocks: Block[], color: string): Promise<RenderedImage | null> {
  if (blocks.length === 0) return null;
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-99999px;top:0;display:inline-block;max-width:600px;background:transparent;color:${color};font-size:20px;line-height:1.5;`;
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(createElement(BlocksView, { blocks }));
  // Laisse React committer et les effets de mise en page (ex. le tableau de signes) s'exécuter
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  try {
    await document.fonts.ready;
  } catch {
    /* tant pis, on continue avec ce qui est déjà chargé */
  }

  const origin = host.getBoundingClientRect();
  const width = Math.max(1, Math.ceil(origin.width));
  const height = Math.max(1, Math.ceil(origin.height));
  if (width < 2 || height < 2) {
    root.unmount();
    host.remove();
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width * RASTER_SCALE;
  canvas.height = height * RASTER_SCALE;
  const ctx = canvas.getContext('2d')!;
  await drawBlockClean({ ctx, origin, color, scale: RASTER_SCALE }, host);

  root.unmount();
  host.remove();

  return { dataUrl: canvas.toDataURL('image/png'), widthMm: width / PX_PER_MM, heightMm: height / PX_PER_MM };
}
