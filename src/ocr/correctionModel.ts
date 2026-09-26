/**
 * Correction d'un texte scanné : quels mots sont pris par le lasso, la zone à effacer, la taille et la place du
 * texte de remplacement. Sans import de valeur : testé sous Node (tests/correction.test.ts).
 */
import type { TextWord } from './textModel';

const NEWLINE = String.fromCharCode(10);

/** Les mots recollés : espace entre deux mots d'une ligne, retour à la ligne entre deux lignes */
const joinWords = (words: readonly TextWord[]) =>
  words.map((w, i) => (i === 0 ? '' : w.line !== words[i - 1].line ? NEWLINE : ' ') + w.text).join('');

export interface MmRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Les mots dont le centre est dans la zone du lasso (mm, repère de la page) */
export function wordsInRegion(words: readonly TextWord[], page: { width: number; height: number }, region: { minX: number; minY: number; maxX: number; maxY: number }): TextWord[] {
  return words.filter((w) => {
    const cx = (w.x + w.w / 2) * page.width;
    const cy = (w.y + w.h / 2) * page.height;
    return cx >= region.minX && cx <= region.maxX && cy >= region.minY && cy <= region.maxY;
  });
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

export interface CorrectionLayout {
  /** Texte lu, ligne par ligne : c'est lui qui pré-remplit la zone de texte */
  text: string;
  /** Cadre des mots (mm) : c'est lui qui est effacé */
  box: MmRect;
  /** Chaque mot (mm), légèrement élargi : l'encre à effacer est cherchée là */
  wordBoxes: MmRect[];
  /** Taille du texte de remplacement (mm, hauteur de corps) */
  size: number;
  /** Haut de la première ligne (mm) */
  firstLineTop: number;
  /** Bord gauche et largeur des mots eux-mêmes, sans marge (mm) */
  left: number;
  width: number;
}

/**
 * Part du corps (taille du texte) qu'occupe le cadre lu d'une ligne, d'après ses lettres : le haut est celui des
 * majuscules, chiffres et lettres montantes (~0,72 corps) ou, s'il n'y en a pas, des minuscules (~0,5) ; le bas
 * descend sous la ligne de base (~0,22) s'il y a des lettres descendantes. « 25 N.m » : 0,72 ; « serrage » : 0,72
 * (g) ; « Couple » : 0,94.
 */
export function lineBodyRatio(text: string): number {
  // Montent jusqu'aux majuscules : majuscules, chiffres, lettres montantes, points du i et du j, accents
  const top = /[A-Z0-9bdfhkltijÀ-ÖØ-ÞàáâãäåèéêëìíîïòóôõöùúûüœŒ!?#%&/'"()[\]{}|]/.test(text) ? 0.72 : 0.5;
  const bottom = /[gjpqyQçµ,;()[\]{}|]/.test(text) ? 0.22 : 0;
  return top + bottom;
}

/**
 * `others` : les autres mots lus sur la page. Les marges du haut et du bas s'arrêtent avant eux : une marge
 * généreuse ne doit jamais atteindre les lettres descendantes de la ligne du dessus (ni les montantes de celle
 * du dessous), qui seraient effacées avec le reste.
 */
export function correctionLayout(words: readonly TextWord[], page: { width: number; height: number }, others: readonly TextWord[] = []): CorrectionLayout | null {
  if (!words.length) return null;
  const toMm = (w: TextWord) => ({ x: w.x * page.width, y: w.y * page.height, w: w.w * page.width, h: w.h * page.height, line: w.line });
  const mm = words.map(toMm);
  const around = others.filter((o) => !words.includes(o)).map(toMm);
  const lines = new Map<number, { top: number; bottom: number; text: string }>();
  for (const [i, w] of mm.entries()) {
    const l = lines.get(w.line);
    if (!l) lines.set(w.line, { top: w.y, bottom: w.y + w.h, text: words[i].text });
    else Object.assign(l, { top: Math.min(l.top, w.y), bottom: Math.max(l.bottom, w.y + w.h), text: `${l.text} ${words[i].text}` });
  }
  const lineHeight = median([...lines.values()].map((l) => l.bottom - l.top));
  const size = Math.min(40, Math.max(1.5, median([...lines.values()].map((l) => (l.bottom - l.top) / lineBodyRatio(l.text)))));
  // Marges autour des lettres : les bords adoucis par la numérisation dépassent un peu du cadre lu, et surtout,
  // en hauteur, les accents (É, è, ô) et le haut des lettres montantes sortent souvent du cadre de Tesseract :
  // on en garde nettement plus au-dessus et au-dessous que sur les côtés, sinon ils restaient à moitié effacés
  const padX = Math.min(1.5, Math.max(0.3, lineHeight * 0.15));
  const padTop = Math.min(3, Math.max(0.6, lineHeight * 0.4));
  const padBottom = Math.min(2, Math.max(0.4, lineHeight * 0.28));
  const wordBoxes = mm.map((w) => {
    const overlapX = (o: { x: number; w: number }) => o.x < w.x + w.w + padX && o.x + o.w > w.x - padX;
    // Le mot voisin le plus bas au-dessus, le plus haut au-dessous : on s'arrête à mi-chemin
    const above = Math.max(-Infinity, ...around.filter((o) => overlapX(o) && o.y + o.h <= w.y + w.h * 0.3).map((o) => o.y + o.h));
    const below = Math.min(Infinity, ...around.filter((o) => overlapX(o) && o.y >= w.y + w.h * 0.7).map((o) => o.y));
    const top = Math.min(padTop, Math.max(0.15, (w.y - above) / 2));
    const bottom = Math.min(padBottom, Math.max(0.15, (below - (w.y + w.h)) / 2));
    return { x: w.x - padX, y: w.y - top, w: w.w + 2 * padX, h: w.h + top + bottom };
  });
  const x0 = Math.min(...wordBoxes.map((b) => b.x));
  const y0 = Math.min(...wordBoxes.map((b) => b.y));
  const x1 = Math.max(...wordBoxes.map((b) => b.x + b.w));
  const y1 = Math.max(...wordBoxes.map((b) => b.y + b.h));
  const box = { x: Math.max(0, x0), y: Math.max(0, y0), w: Math.min(page.width, x1) - Math.max(0, x0), h: Math.min(page.height, y1) - Math.max(0, y0) };
  return {
    text: joinWords(words),
    box,
    wordBoxes,
    size,
    firstLineTop: Math.min(...mm.map((w) => w.y)),
    left: Math.min(...mm.map((w) => w.x)),
    width: Math.max(...mm.map((w) => w.x + w.w)) - Math.min(...mm.map((w) => w.x)),
  };
}

/** « #rrggbb » d'une couleur (r, g, b) */
export const toHex = ([r, g, b]: readonly number[]) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
