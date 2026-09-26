import { memo, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { TextWord } from './textModel';

/**
 * La couche de texte posée sur le fond d'une page (mode « Texte ») : chaque mot lu est un <span> TRANSPARENT
 * placé exactement sur son image. Le navigateur s'occupe du reste : appui long (ou glisser à la souris) pour
 * sélectionner, poignées pour étendre, « Copier ». Les mots sont dans l'ordre de lecture, séparés par des
 * espaces et des retours à la ligne : le texte copié se lit comme le document.
 *
 * Une feuille est dessinée à UNIT px par mm puis mise à l'échelle de la vue par une transformation CSS : un
 * défilement ou un zoom ne fait que changer cette transformation, sans redessiner les centaines de mots.
 */
export const UNIT = 4;

let measurer: CanvasRenderingContext2D | null = null;
const FONT = 'sans-serif';
/** Largeur du mot à 100 px, pour l'étirer exactement sur sa place dans l'image */
function naturalWidth(text: string): number {
  measurer ??= document.createElement('canvas').getContext('2d');
  if (!measurer) return text.length * 55;
  measurer.font = `100px ${FONT}`;
  return measurer.measureText(text).width || 1;
}

export const SheetText = memo(function SheetText({ words, width, height }: { words: readonly TextWord[]; width: number; height: number }) {
  const W = width * UNIT;
  const H = height * UNIT;
  const out: ReactNode[] = [];
  for (const [i, w] of words.entries()) {
    if (i > 0) out.push(w.line !== words[i - 1].line ? '\n' : ' ');
    const size = w.h * H * 0.88;
    const scaleX = (w.w * W) / ((naturalWidth(w.text) * size) / 100);
    out.push(
      <span
        key={i}
        data-line={w.line}
        style={{
          left: w.x * W,
          top: w.y * H,
          fontSize: size,
          lineHeight: `${w.h * H}px`,
          transform: `scaleX(${Number.isFinite(scaleX) ? scaleX : 1})`,
        }}
      >
        {w.text}
      </span>,
    );
  }
  return (
    <div className="ocr-sheet" style={{ width: W, height: H, fontFamily: FONT }}>
      {out}
    </div>
  );
});

/**
 * Le texte copié, recomposé à partir des mots sélectionnés : le navigateur, lui, voit des mots posés un par un
 * (en position absolue) et les recollait sans espaces. Mots d'une même ligne séparés par une espace, lignes par
 * un retour à la ligne, pages par une ligne vide ; le premier et le dernier mot sont coupés là où s'arrête la
 * sélection. null : la sélection ne touche pas la couche de texte (copie normale).
 */
const LINE_BREAK = String.fromCharCode(10);
const PAGE_BREAK = LINE_BREAK + LINE_BREAK;

export function layerSelectionText(range: Range): string | null {
  const spans = [...document.querySelectorAll<HTMLElement>('.ocr-sheet span')].filter((s) => range.intersectsNode(s));
  if (!spans.length) return null;
  let out = '';
  let prev: HTMLElement | null = null;
  for (const span of spans) {
    let text = span.textContent ?? '';
    const node = span.firstChild;
    if (node && node === range.endContainer) text = text.slice(0, range.endOffset);
    if (node && node === range.startContainer) text = text.slice(range.startOffset);
    if (!text) continue;
    if (prev) out += prev.parentElement !== span.parentElement ? PAGE_BREAK : prev.dataset.line !== span.dataset.line ? LINE_BREAK : ' ';
    out += text;
    prev = span;
  }
  return out || null;
}

/** Tant que la couche de texte est affichée, « Copier » (menu, Ctrl+C) donne le texte bien espacé */
export function useLayerCopy(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const onCopy = (e: ClipboardEvent) => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount || !e.clipboardData) return;
      const text = layerSelectionText(sel.getRangeAt(0));
      if (text === null) return;
      e.clipboardData.setData('text/plain', text);
      e.preventDefault();
    };
    document.addEventListener('copy', onCopy);
    return () => document.removeEventListener('copy', onCopy);
  }, [active]);
}

export interface Highlight {
  pageId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  active: boolean;
}

export const SheetHighlights = memo(function SheetHighlights({ boxes, width, height }: { boxes: readonly Highlight[]; width: number; height: number }) {
  const W = width * UNIT;
  const H = height * UNIT;
  return (
    <div className="ocr-sheet ocr-highlights" style={{ width: W, height: H }}>
      {boxes.map((b, i) => (
        <i key={i} className={b.active ? 'active' : ''} style={{ left: b.x * W - 2, top: b.y * H - 2, width: b.w * W + 4, height: b.h * H + 4 }} />
      ))}
    </div>
  );
});
