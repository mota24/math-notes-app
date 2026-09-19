/**
 * Mode impression du PDF : l'encre pensée pour le papier sombre (blanc, pastels) disparaîtrait sur du
 * papier blanc, et une encre pâle coûte du toner pour rien. On la remplace par sa version foncée :
 * même teinte, luminosité inversée (blanc → noir, bleu pastel → bleu marine), jusqu'à un contraste
 * lisible sur du blanc. Une encre déjà assez foncée reste exactement telle quelle.
 *
 * Sans DOM : testé sous Node (`npm test`).
 */

/** Contraste minimal (WCAG) d'un trait sur du papier blanc ; 3:1 est le seuil des éléments graphiques */
const MIN_CONTRAST = 3;
/** Luminosité (HSL) maximale d'une encre convertie : ni fluo ni fantomatique une fois imprimée */
const MAX_LIGHTNESS = 0.4;
/** En dessous, on ne fonce plus : on est déjà presque noir */
const FLOOR_LIGHTNESS = 0.08;

const channel = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** Luminance relative WCAG (0 noir, 1 blanc) d'une couleur en 0..1 */
function luminance(r: number, g: number, b: number): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contraste d'une couleur sur du papier blanc (1 = invisible, 21 = noir) */
export function contrastOnWhite(r: number, g: number, b: number): number {
  return 1.05 / (luminance(r, g, b) + 0.05);
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)];
}

/** Couleur (canaux 0..255) telle qu'elle doit s'imprimer sur du papier blanc */
export function printRgb(r: number, g: number, b: number): [number, number, number] {
  const [fr, fg, fb] = [r / 255, g / 255, b / 255];
  if (contrastOnWhite(fr, fg, fb) >= MIN_CONTRAST) return [r, g, b];
  const [h, s, l] = rgbToHsl(fr, fg, fb);
  let target = Math.min(1 - l, MAX_LIGHTNESS);
  let out = hslToRgb(h, s, target);
  // Un jaune ou un vert vif restent clairs même à luminosité 0,4 : on fonce jusqu'au contraste voulu
  while (contrastOnWhite(...out) < MIN_CONTRAST && target > FLOOR_LIGHTNESS) {
    target -= 0.03;
    out = hslToRgb(h, s, target);
  }
  return [Math.round(out[0] * 255), Math.round(out[1] * 255), Math.round(out[2] * 255)];
}

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const v = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  const n = Number.parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Couleur d'encre (« #rrggbb ») pour l'impression sur papier blanc ; une valeur illisible est rendue telle quelle */
export function printColor(hex: string): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const [r, g, b] = printRgb(...rgb);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
