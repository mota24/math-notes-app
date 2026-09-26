/**
 * Mise en page des zones de texte (outil « Texte ») : retour à la ligne, hauteur de la boîte. Sans import de
 * valeur et sans DOM : testé sous Node (`npm test`) avec une fonction de mesure factice ; draw.ts lui fournit
 * la vraie mesure (canvas.measureText).
 *
 * Une zone de texte est un trait `tool: 'text'` : `points[0]`–`points[1]` est la boîte (mm), `size` la taille
 * du texte (mm, hauteur de corps), `text` son contenu. Elle se déplace, se redimensionne, tourne, se
 * recolore et s'annule comme une image (lasso), et part telle quelle dans la synchro, le partage et le PDF.
 */

/** Police des zones de texte, la même que l'interface (chargée par main.tsx) */
export const TEXT_FONT = '"Instrument Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
/** Interligne, en multiple de la taille du texte */
export const TEXT_LINE_HEIGHT = 1.3;
/** Tailles proposées (mm) : petit, normal, grand — ~10, ~14 et ~20 points */
export const TEXT_SIZES = [3.5, 5, 7] as const;
export const DEFAULT_TEXT_SIZE = 5;
/** Largeur d'une zone posée d'un simple tap (mm) */
export const DEFAULT_TEXT_WIDTH = 90;
/** Une zone ne devient jamais plus étroite (mm) */
export const MIN_TEXT_WIDTH = 12;

/** Marge intérieure (mm) : un peu d'air autour du texte, proportionnel à sa taille */
export const textPadding = (size: number) => size * 0.3;

/**
 * Découpe le texte en lignes qui tiennent dans `maxWidth` (unités de `measure`). Les retours à la ligne tapés
 * sont respectés (une ligne vide reste une ligne), les mots vont à la ligne entiers, et un mot plus long que
 * la ligne est coupé où il le faut plutôt que de déborder.
 */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      out.push('');
      continue;
    }
    let line = '';
    // Les espaces sont gardés avec le mot qui les suit : « a  b » reste « a  b »
    for (const token of paragraph.match(/\s*\S+|\s+$/g) ?? []) {
      const candidate = line + token;
      if (line === '' || measure(candidate) <= maxWidth) {
        line = candidate;
      } else {
        out.push(line);
        line = token.trimStart();
      }
      // Un mot seul plus long que la ligne : coupé caractère par caractère
      while (measure(line) > maxWidth && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && measure(line.slice(0, cut)) > maxWidth) cut--;
        out.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    out.push(line);
  }
  return out;
}

/** Hauteur (mm) d'une zone de `lines` lignes de texte de taille `size` */
export function textBoxHeight(lines: number, size: number): number {
  return Math.max(1, lines) * size * TEXT_LINE_HEIGHT + 2 * textPadding(size);
}

/** Largeur utile pour le texte (mm) dans une boîte de largeur `width` */
export function textInnerWidth(width: number, size: number): number {
  return Math.max(size, width - 2 * textPadding(size));
}

// ------------------------------------------------------------------ polices assorties au document (correction de scans)

/**
 * Familles proposées pour se fondre dans un document : des polices libres AUX MÊMES DIMENSIONS que les polices
 * de bureau (Tinos = Times New Roman, Arimo = Arial, Cousine = Courier New), servies par le site : le rendu est
 * le même sur la tablette (qui n'a ni Times ni Arial), à l'écran comme dans le PDF exporté.
 */
export type TextFamily = 'serif' | 'sans' | 'mono';

export const FAMILY_STACK: Record<TextFamily, string> = {
  serif: '"Tinos", "Times New Roman", "Liberation Serif", "Noto Serif", serif',
  sans: '"Arimo", Arial, Helvetica, "Liberation Sans", Roboto, sans-serif',
  mono: '"Cousine", "Courier New", "Liberation Mono", monospace',
};

export const FAMILY_LABEL: Record<TextFamily, string> = { serif: 'Serif', sans: 'Sans', mono: 'Mono' };

/**
 * Hauteur des majuscules et des minuscules, en fraction du corps (mesures de Times New Roman, Arial et Courier
 * New, reprises par leurs équivalents libres). C'est ce qui permet de donner au texte tapé EXACTEMENT la hauteur
 * physique des lettres du scan : corps = hauteur mesurée ÷ proportion de la police choisie.
 */
export const FAMILY_METRICS: Record<TextFamily, { cap: number; x: number }> = {
  serif: { cap: 0.662, x: 0.448 },
  sans: { cap: 0.716, x: 0.519 },
  mono: { cap: 0.571, x: 0.423 },
};

/** Ligne de base sous le haut de la ligne, en fraction du corps (texte en police assortie) */
export const MATCHED_BASELINE = (TEXT_LINE_HEIGHT - 1) / 2 + 0.8;

export interface TextStyle {
  family?: TextFamily;
  bold?: boolean;
  italic?: boolean;
}

/** La police CSS / canevas d'une zone de texte (police de l'appli si aucune famille n'est choisie) */
export function fontCss(style: TextStyle, px: number): string {
  return `${style.italic ? 'italic ' : ''}${style.bold ? '700 ' : ''}${px}px ${style.family ? FAMILY_STACK[style.family] : TEXT_FONT}`;
}
