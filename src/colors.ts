/**
 * Palette de la barre d'une sélection (lasso) : trois couleurs « récentes » suivies de la pastille
 * multicolore. Choisir une nouvelle teinte la place en premier et décale les autres d'un cran : la
 * dernière sort de la palette. Sans DOM ni import : testé sous Node (`npm test`).
 */

export const SELECTION_SLOTS = 3;

/** Noir, bleu, rouge : la palette au départ */
export const DEFAULT_SELECTION_COLORS: readonly string[] = ['#1d2433', '#1f4fbf', '#c0392b'];

const isHex = (c: unknown): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);

/**
 * La palette après le choix de `color` : elle passe en premier, les autres se décalent, la dernière
 * disparaît. Une couleur déjà dans la palette ne la réorganise pas (les pastilles ne bougent pas sous
 * le doigt à chaque usage).
 */
export function pushRecentColor(colors: readonly string[], color: string, slots = SELECTION_SLOTS): string[] {
  const c = color.toLowerCase();
  if (colors.some((x) => x.toLowerCase() === c)) return colors.slice(0, slots).map((x) => x.toLowerCase());
  return [c, ...colors.map((x) => x.toLowerCase())].slice(0, slots);
}

/**
 * La palette lue dans les réglages enregistrés : toujours SELECTION_SLOTS couleurs valides, sans
 * doublon ; ce qui manque ou est abîmé est complété par les couleurs d'origine.
 */
export function normalizeSelectionColors(raw: unknown): string[] {
  const saved = Array.isArray(raw) ? raw.filter(isHex).map((c) => c.toLowerCase()) : [];
  const out = [...new Set(saved)].slice(0, SELECTION_SLOTS);
  for (const fallback of DEFAULT_SELECTION_COLORS) {
    if (out.length >= SELECTION_SLOTS) break;
    if (!out.includes(fallback)) out.push(fallback);
  }
  return out;
}
