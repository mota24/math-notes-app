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
