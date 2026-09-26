/**
 * Correction d'un texte scanné : quels mots sont pris par le lasso, la zone à effacer, la taille et la place du
 * texte de remplacement. Sans import de valeur : testé sous Node (tests/correction.test.ts).
 */
import type { TextWord } from './textModel';
import type { TextFamily } from '../ink/textLayout';

/** Proportions des polices assorties (voir FAMILY_METRICS dans textLayout.ts, recopiées : ce module est testé seul) */
export const MATCH_METRICS: Record<TextFamily, { cap: number; x: number }> = {
  serif: { cap: 0.662, x: 0.448 },
  sans: { cap: 0.716, x: 0.519 },
  mono: { cap: 0.571, x: 0.423 },
};

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

// ------------------------------------------------------------------ police assortie (taille, famille, graisse, style)

/** Hauteurs mesurées sur le scan (mm) : capitales, minuscules, et ligne de base de la première ligne */
export interface LetterMetrics {
  cap?: number;
  x?: number;
  base?: number;
}

/**
 * Hauteur des capitales et des minuscules, du haut des lettres à la ligne de base lue. Les mots à capitales
 * accentuées (l'accent dépasse) sont écartés de la mesure des capitales ; seuls les mots faits de minuscules
 * sans montante ni point (a, c, e, m, n, o, r, s, u, v, w, x, z) servent à la hauteur des minuscules.
 */
export function measureLetters(words: readonly TextWord[], page: { width: number; height: number }): LetterMetrics {
  const withBase = words.filter((w) => w.base !== undefined);
  if (!withBase.length) return {};
  const above = (w: TextWord) => ((w.base as number) - w.y) * page.height;
  // Mesure caractère par caractère quand Tesseract l'a donnée (exacte) ; sinon, le cadre des mots qui s'y prêtent
  const symbolCaps = withBase.filter((w) => w.cap !== undefined).map((w) => (w.cap as number) * page.height);
  const symbolXs = withBase.filter((w) => w.xh !== undefined).map((w) => (w.xh as number) * page.height);
  const caps = symbolCaps.length ? symbolCaps : withBase.filter((w) => /[A-Z0-9bdfhklt]/.test(w.text) && !/[À-ÖØ-Þ]/.test(w.text)).map(above);
  const xs = symbolXs.length ? symbolXs : withBase.filter((w) => /^[acemnorsuvwxz]+$/.test(w.text)).map(above);
  const firstLine = Math.min(...withBase.map((w) => w.line));
  const bases = withBase.filter((w) => w.line === firstLine).map((w) => (w.base as number) * page.height);
  return { cap: caps.length ? median(caps) : undefined, x: xs.length ? median(xs) : undefined, base: bases.length ? median(bases) : undefined };
}

/** Corps (mm) qui donne à cette famille exactement la hauteur mesurée ; undefined sans mesure */
export function matchedSize(letters: LetterMetrics, family: TextFamily): number | undefined {
  const m = MATCH_METRICS[family];
  if (letters.cap) return letters.cap / m.cap;
  if (letters.x) return letters.x / m.x;
  return undefined;
}

/** Mesures de l'encre, converties en mm (voir InkStyle dans inpaint.ts) */
export interface InkStyleMm {
  stem: number;
  thin: number;
  foot: number;
  slant: number;
}

export interface FontCandidate {
  family: TextFamily;
  bold: boolean;
  /** Écart relatif médian entre la largeur des mots dans cette police et leur largeur sur le scan (0 = parfait) */
  widthError: number;
}

export interface FontChoice {
  family: TextFamily;
  bold: boolean;
  italic: boolean;
}

/** À partir de cette inclinaison (décalage par unité de hauteur, ~7°), le texte est en italique */
export const ITALIC_SLANT = 0.12;

/**
 * Le choix de la police : la LARGEUR des mots décide d'abord (les polices ont les dimensions exactes de Times,
 * Arial et Courier : à hauteur égale, chacune donne une largeur bien à elle), et les indices de l'encre départagent
 * — épaisseur des fûts (graisse), empattements et contraste plein / délié (serif ou sans), inclinaison (italique).
 */
export function chooseFont(ink: InkStyleMm | null, cap: number | undefined, candidates: readonly FontCandidate[]): FontChoice {
  const italic = !!ink && ink.slant >= ITALIC_SLANT;
  const stemRatio = ink && cap ? ink.stem / cap : undefined;
  // > 0 : plutôt à empattements ; < 0 : plutôt sans. Le contraste plein / délié est l'indice fiable : les pleins et
  // les déliés de Times diffèrent nettement (~0,45), ceux d'Arial presque pas (~0,8) ; les « pieds » mesurés, eux,
  // se sont révélés trompeurs (bas arrondis des e, s, a) et ne servent plus que d'appoint
  const contrast = ink && ink.stem ? ink.thin / ink.stem : 0.62;
  const serifEvidence = ink ? Math.max(-0.1, Math.min(0.1, (0.62 - contrast) * 0.6 + (ink.foot - 1.5) * 0.02)) : 0;
  let best: FontChoice = { family: 'sans', bold: false, italic };
  let bestScore = Infinity;
  for (const c of candidates) {
    let score = Math.abs(c.widthError);
    if (stemRatio !== undefined) {
      if (c.bold && stemRatio < 0.15) score += 0.12;
      if (!c.bold && stemRatio > 0.2) score += 0.12;
    }
    if (c.family === 'serif') score -= serifEvidence;
    if (c.family === 'sans') score += serifEvidence;
    if (score < bestScore) {
      bestScore = score;
      best = { family: c.family, bold: c.bold, italic };
    }
  }
  return best;
}
