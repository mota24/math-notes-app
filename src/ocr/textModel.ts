/**
 * Le texte d'une page de PDF ou d'une photo : ses mots et leur place, pour le sélectionner, le copier et le
 * chercher. Sans import de valeur : testé sous Node (tests/ocr.test.ts).
 *
 * Les positions sont en FRACTIONS de la page (0 → 1) : le fond est étiré sur toute la page (voir renderPage),
 * elles ne dépendent donc ni de la résolution de lecture ni de la taille de la page, et se gardent en cache.
 */

export interface TextWord {
  text: string;
  /** Coin haut-gauche, largeur, hauteur : fractions de la page */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Numéro de ligne dans la page (ordre de lecture) : sert à recoller le texte et à la sélection */
  line: number;
}

export interface PageText {
  /** `pdf` : texte déjà présent dans le PDF (exact) ; `ocr` : lu dans l'image par Tesseract */
  source: 'pdf' | 'ocr';
  words: TextWord[];
}

// ------------------------------------------------------------------ Tesseract

interface Bbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
/** Le strict nécessaire de la sortie « blocks » de Tesseract.js */
export interface OcrBlocks {
  blocks?: { paragraphs: { lines: { words: { text: string; confidence: number; bbox: Bbox }[] }[] }[] }[] | null;
}

/** Un mot lu avec moins de confiance que ça est presque toujours une tache, un trait, un bout de tampon */
export const MIN_CONFIDENCE = 35;

export function fromTesseract(out: OcrBlocks, width: number, height: number): TextWord[] {
  const words: TextWord[] = [];
  let line = 0;
  for (const block of out.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const l of paragraph.lines) {
        let kept = false;
        for (const w of l.words) {
          const text = w.text.trim();
          if (!text || w.confidence < MIN_CONFIDENCE) continue;
          words.push({ text, x: w.bbox.x0 / width, y: w.bbox.y0 / height, w: (w.bbox.x1 - w.bbox.x0) / width, h: (w.bbox.y1 - w.bbox.y0) / height, line });
          kept = true;
        }
        if (kept) line++;
      }
    }
  }
  return words;
}

// ------------------------------------------------------------------ texte natif du PDF (pdf.js)

/** Un morceau de texte de pdf.js : `transform` = [a, b, c, d, e, f] en points, origine en BAS à gauche */
export interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

/**
 * Le texte déjà présent dans le PDF, découpé en mots (un morceau de pdf.js contient souvent toute une phrase :
 * sa largeur est partagée entre les caractères). Les lignes sont reconnues à leur ligne de base.
 */
export function fromPdfItems(items: readonly PdfTextItem[], pageWidth: number, pageHeight: number): TextWord[] {
  const pieces: Omit<TextWord, 'line'>[] = [];
  for (const it of items) {
    if (!it.str.trim()) continue;
    const [, , , d, e, f] = it.transform;
    const size = Math.abs(it.height || d) || 10;
    const top = pageHeight - f - size * 0.85;
    const perChar = it.width / Math.max(1, it.str.length);
    const re = /\S+/g;
    for (let m = re.exec(it.str); m; m = re.exec(it.str)) {
      pieces.push({
        text: m[0],
        x: (e + m.index * perChar) / pageWidth,
        y: top / pageHeight,
        w: (m[0].length * perChar) / pageWidth,
        h: (size * 1.1) / pageHeight,
      });
    }
  }
  // Ordre de lecture : de haut en bas, puis de gauche à droite ; même ligne si les hauteurs se recouvrent
  pieces.sort((a, b) => a.y - b.y || a.x - b.x);
  const words: TextWord[] = [];
  let line = -1;
  let lineTop = -Infinity;
  let lineHeight = 0;
  for (const p of pieces) {
    if (p.y > lineTop + lineHeight * 0.6) {
      line++;
      lineTop = p.y;
      lineHeight = p.h;
    }
    words.push({ ...p, line });
  }
  return words.sort((a, b) => a.line - b.line || a.x - b.x);
}

/** Assez de texte natif pour s'en servir ? Sinon (scan), il faut lire l'image. */
export const hasRealText = (words: readonly TextWord[]) => words.reduce((n, w) => n + w.text.length, 0) >= 20;

// ------------------------------------------------------------------ texte, recherche

/** Le texte de la page, une ligne par ligne lue */
export function pageString(words: readonly TextWord[]): string {
  let out = '';
  let line = words[0]?.line ?? 0;
  for (const [i, w] of words.entries()) {
    if (i > 0) out += w.line !== line ? '\n' : ' ';
    out += w.text;
    line = w.line;
  }
  return out;
}

/** Pour comparer : minuscules, sans accents, ligatures et apostrophes unifiées */
export function normalize(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’‘`´]/g, "'")
    .replace(/[‐‑‒–—]/g, '-')
    .toLowerCase();
}

export interface Match {
  /** Premier et dernier mot touchés (inclus) */
  from: number;
  to: number;
}

/**
 * Toutes les occurrences de `query` dans la page, même à cheval sur plusieurs mots ou en milieu de mot
 * (« intégr » trouve « intégrale ») ; espaces multiples et retours à la ligne comptent comme un espace.
 */
export function searchPage(words: readonly TextWord[], query: string): Match[] {
  const q = normalize(query).replace(/\s+/g, ' ').trim();
  if (!q) return [];
  let text = '';
  const owner: number[] = [];
  for (const [i, w] of words.entries()) {
    if (i > 0) {
      text += ' ';
      owner.push(i - 1);
    }
    const n = normalize(w.text);
    text += n;
    for (let k = 0; k < n.length; k++) owner.push(i);
  }
  const matches: Match[] = [];
  for (let at = text.indexOf(q); at >= 0; at = text.indexOf(q, at + q.length)) {
    matches.push({ from: owner[at], to: owner[at + q.length - 1] });
  }
  return matches;
}

/** Un extrait autour d'une occurrence, pour la liste des résultats */
export function snippet(words: readonly TextWord[], m: Match, around = 5): string {
  const start = Math.max(0, m.from - around);
  const end = Math.min(words.length - 1, m.to + around);
  const parts = words.slice(start, end + 1).map((w) => w.text);
  return `${start > 0 ? '… ' : ''}${parts.join(' ')}${end < words.length - 1 ? ' …' : ''}`;
}

/** Le cadre d'une occurrence, ligne par ligne (une occurrence sur deux lignes donne deux cadres) */
export function matchBoxes(words: readonly TextWord[], m: Match): { x: number; y: number; w: number; h: number }[] {
  const byLine = new Map<number, { x0: number; y0: number; x1: number; y1: number }>();
  for (let i = m.from; i <= m.to; i++) {
    const w = words[i];
    const b = byLine.get(w.line);
    if (!b) byLine.set(w.line, { x0: w.x, y0: w.y, x1: w.x + w.w, y1: w.y + w.h });
    else Object.assign(b, { x0: Math.min(b.x0, w.x), y0: Math.min(b.y0, w.y), x1: Math.max(b.x1, w.x + w.w), y1: Math.max(b.y1, w.y + w.h) });
  }
  return [...byLine.values()].map((b) => ({ x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 }));
}
