import assert from 'node:assert/strict';
import { ITALIC_SLANT, MATCH_METRICS, chooseFont, matchedSize, measureLetters } from '../src/ocr/correctionModel.ts';
import type { FontCandidate } from '../src/ocr/correctionModel.ts';
import { measureInkStyle } from '../src/ocr/inpaint.ts';
import { FAMILY_METRICS, fontCss } from '../src/ink/textLayout.ts';
import type { TextWord } from '../src/ocr/textModel.ts';

const results: [string, () => void][] = [];
const test = (name: string, fn: () => void) => results.push([name, fn]);

const page = { width: 200, height: 300 };
/** Mot en mm : haut `y`, ligne de base `base` */
const word = (text: string, line: number, x: number, y: number, w: number, base: number): TextWord => ({
  text,
  line,
  x: x / page.width,
  y: y / page.height,
  w: w / page.width,
  h: (base - y + 1) / page.height,
  base: base / page.height,
});

test('les deux tables de proportions des polices sont identiques', () => {
  assert.deepEqual(MATCH_METRICS, FAMILY_METRICS);
});

test('hauteur des capitales et des minuscules mesurée jusqu’à la ligne de base', () => {
  const m = measureLetters([word('Contrôle', 0, 10, 20, 30, 23.6), word('avec', 0, 45, 21.2, 14, 23.6), word('Élément', 1, 10, 28, 30, 31.9), word('A320', 1, 45, 28.4, 16, 32)], page);
  assert.ok(Math.abs(m.cap! - 3.6) < 0.01, `capitales ${m.cap} (É écarté : son accent dépasse)`);
  assert.ok(Math.abs(m.x! - 2.4) < 0.01, `minuscules ${m.x}`);
  assert.ok(Math.abs(m.base! - 23.6) < 0.01);
  assert.deepEqual(measureLetters([{ text: 'x', line: 0, x: 0, y: 0, w: 0.1, h: 0.1 }], page), {}, 'sans ligne de base : rien');
});

test('hauteurs mesurées caractère par caractère quand Tesseract les donne (plus justes que le cadre du mot)', () => {
  const w = word('Procédure', 0, 10, 19.4, 30, 23.6); // le cadre monte avec le d et l'accent
  w.cap = 3.6 / page.height;
  w.xh = 2.4 / page.height;
  const m = measureLetters([w], page);
  assert.ok(Math.abs(m.cap! - 3.6) < 1e-9 && Math.abs(m.x! - 2.4) < 1e-9);
});

test('taille exacte : même hauteur physique des capitales, quelle que soit la police', () => {
  const letters = { cap: 3.6 };
  for (const family of ['serif', 'sans', 'mono'] as const) {
    const size = matchedSize(letters, family)!;
    assert.ok(Math.abs(size * FAMILY_METRICS[family].cap - 3.6) < 1e-9, family);
  }
  assert.ok(Math.abs(matchedSize({ x: 2.4 }, 'sans')! * FAMILY_METRICS.sans.x - 2.4) < 1e-9, 'repli sur les minuscules');
  assert.equal(matchedSize({}, 'sans'), undefined);
});

/** Encre factice : `w` × `h`, avec des rectangles pleins */
function inkOf(w: number, h: number, rects: [number, number, number, number][]) {
  const m = new Uint8Array(w * h);
  for (const [x0, y0, x1, y1] of rects) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = 1;
  return m;
}

test('encre : épaisseur des fûts, inclinaison, empattements', () => {
  const W = 120;
  const H = 50;
  // Trois fûts droits de 4 px, de la hauteur des capitales (30 px), ligne de base à y = 40
  const upright = inkOf(W, H, [[10, 10, 14, 40], [40, 10, 44, 40], [70, 10, 74, 40]]);
  const probe = [{ x: 0, y: 5, w: W, h: 40, base: 40, cap: 30 }];
  const u = measureInkStyle(upright, W, H, probe)!;
  assert.equal(u.stem, 4);
  assert.ok(Math.abs(u.slant) < 0.03, `droit : ${u.slant}`);
  assert.ok(u.foot < 1.1, `sans pieds : ${u.foot}`);
  // Mêmes fûts penchés (italique ~14°)
  const rects: [number, number, number, number][] = [];
  for (const x of [10, 40, 70]) for (let y = 10; y < 40; y++) rects.push([Math.round(x + 0.25 * (40 - y)), y, Math.round(x + 0.25 * (40 - y)) + 4, y + 1]);
  const italic = measureInkStyle(inkOf(W, H, rects), W, H, probe)!;
  assert.ok(italic.slant >= ITALIC_SLANT, `penché : ${italic.slant}`);
  // Fûts avec pieds (empattements) de 12 px sur les 3 derniers pixels
  const serif = measureInkStyle(inkOf(W, H, [[10, 10, 14, 40], [40, 10, 44, 40], [70, 10, 74, 40], [6, 37, 18, 40], [36, 37, 48, 40], [66, 37, 78, 40]]), W, H, probe)!;
  assert.ok(serif.foot > 2, `pieds : ${serif.foot}`);
  assert.equal(measureInkStyle(new Uint8Array(W * H), W, H, probe), null, 'pas d’encre : pas de conclusion');
});

const candidates = (errors: Record<string, number>): FontCandidate[] =>
  Object.entries(errors).map(([k, widthError]) => ({ family: k.split('-')[0] as FontCandidate['family'], bold: k.endsWith('-bold'), widthError }));

test('choix de la police : la largeur des mots décide, l’encre départage', () => {
  // Arial régulier colle à la largeur mesurée
  const arial = chooseFont({ stem: 0.4, thin: 0.36, foot: 1, slant: 0 }, 3.6, candidates({ serif: 0.09, sans: 0.01, mono: 0.3, 'serif-bold': 0.14, 'sans-bold': 0.08, 'mono-bold': 0.3 }));
  assert.deepEqual(arial, { family: 'sans', bold: false, italic: false });
  // Largeurs presque égales, mais pieds et contraste marqués : Times
  const times = chooseFont({ stem: 0.45, thin: 0.15, foot: 1.9, slant: 0 }, 3.6, candidates({ serif: 0.03, sans: 0.02, mono: 0.3 }));
  assert.equal(times.family, 'serif');
  // Mesures réelles d'un scan d'Arial (contraste 0,83) : largeurs voisines, mais Arial l'emporte
  assert.equal(chooseFont({ stem: 0.5, thin: 0.417, foot: 1.48, slant: 0 }, 4.06, candidates({ serif: 0.021, sans: 0.06 })).family, 'sans');
  // Fûts épais (0,85 mm pour 3,6 mm de capitales) : gras, même si la largeur hésite
  const bold = chooseFont({ stem: 0.85, thin: 0.6, foot: 1, slant: 0 }, 3.6, candidates({ sans: 0.05, 'sans-bold': 0.06 }));
  assert.deepEqual(bold, { family: 'sans', bold: true, italic: false });
  // Encre penchée : italique
  assert.equal(chooseFont({ stem: 0.4, thin: 0.3, foot: 1, slant: 0.2 }, 3.6, candidates({ sans: 0 })).italic, true);
  // Courier : largeurs très différentes des deux autres
  assert.equal(chooseFont(null, undefined, candidates({ serif: 0.4, sans: 0.3, mono: 0.02 })).family, 'mono');
});

test('police CSS d’une zone de texte', () => {
  assert.equal(fontCss({ family: 'serif', bold: true, italic: true }, 100), 'italic 700 100px "Tinos", "Times New Roman", "Liberation Serif", "Noto Serif", serif');
  assert.ok(fontCss({}, 50).startsWith('50px "Instrument Sans"'), 'police de l’appli par défaut');
});

let failed = 0;
for (const [name, fn] of results) {
  try {
    fn();
    console.log('OK  ', name);
  } catch (e) {
    failed++;
    console.log('FAIL', name, '\n     ', (e as Error).message);
  }
}
console.log(failed ? `\n${failed} échec(s)` : '\nPolice assortie : tout passe');
process.exitCode = failed ? 1 : 0;
