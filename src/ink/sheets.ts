import type { PaperColor, PaperStyle, Stroke } from './types';

/**
 * Découpage vertical du canevas en feuilles : soit les pages du cahier les unes sous les autres (mode
 * « toutes les pages »), soit une page unique qui s'allonge (canevas infini). Coordonnées en mm, dans le
 * repère du document. Sans DOM ni import de valeur : testé sous Node (`tests/sheets.test.ts`).
 */

export interface CanvasPage {
  id: string;
  width: number;
  height: number;
  paper: PaperStyle;
  paperColor?: PaperColor;
  background?: HTMLCanvasElement | null;
  strokes: Stroke[];
}

/** Espace sombre visible entre les feuilles physiques façon JNotes (mm) */
export const PAGE_GAP = 16;

/** Ce que le découpage lit dans les props de la zone de dessin */
export interface SheetSource {
  pages?: CanvasPage[];
  strokes: Stroke[];
  paper: PaperStyle;
  paperColor: PaperColor;
  pageWidth: number;
  pageHeight: number;
  extendable: boolean;
  background: HTMLCanvasElement | null;
}

export interface Sheet {
  index: number;
  id: string;
  page: CanvasPage;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export function getSheets(p: SheetSource, minH: number): Sheet[] {
  if (p.pages && p.pages.length > 0) {
    let currentTop = 0;
    return p.pages.map((page, index) => {
      const top = currentTop;
      const bottom = top + page.height;
      currentTop = bottom + PAGE_GAP;
      return {
        index,
        id: page.id,
        page,
        top,
        bottom,
        width: page.width,
        height: page.height,
      };
    });
  }
  const h = p.extendable ? Math.max(p.pageHeight, minH) : p.pageHeight;
  return [
    {
      index: 0,
      id: 'single',
      page: {
        id: 'single',
        width: p.pageWidth,
        height: h,
        paper: p.paper,
        paperColor: p.paperColor,
        background: p.background,
        strokes: p.strokes,
      },
      top: 0,
      bottom: h,
      width: p.pageWidth,
      height: h,
    },
  ];
}

export function docH(sheets: Sheet[]): number {
  return sheets.length > 0 ? sheets[sheets.length - 1].bottom : 0;
}

export function docW(sheets: Sheet[], defaultW: number): number {
  return sheets.length > 0 ? Math.max(...sheets.map((s) => s.width)) : defaultW;
}

export function findSheet(sheets: Sheet[], docY: number): Sheet {
  if (sheets.length <= 1) return sheets[0];
  if (docY <= sheets[0].top) return sheets[0];
  if (docY >= sheets[sheets.length - 1].bottom) return sheets[sheets.length - 1];
  for (let i = 0; i < sheets.length; i++) {
    const s = sheets[i];
    if (docY >= s.top && docY <= s.bottom) return s;
    if (i < sheets.length - 1 && docY > s.bottom && docY < sheets[i + 1].top) {
      const mid = (s.bottom + sheets[i + 1].top) / 2;
      return docY < mid ? s : sheets[i + 1];
    }
  }
  return sheets[sheets.length - 1];
}
