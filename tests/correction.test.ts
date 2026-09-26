import assert from 'node:assert/strict';
import { correctionLayout, lineBodyRatio, toHex, wordsInRegion } from '../src/ocr/correctionModel.ts';
import type { TextWord } from '../src/ocr/textModel.ts';

const results: [string, () => void][] = [];
const test = (name: string, fn: () => void) => results.push([name, fn]);

const page = { width: 200, height: 300 };
/** Un mot en mm, converti en fractions de page */
const word = (text: string, line: number, x: number, y: number, w: number, h: number): TextWord => ({
  text,
  line,
  x: x / page.width,
  y: y / page.height,
  w: w / page.width,
  h: h / page.height,
});

test('lasso : seuls les mots dont le centre est dans la zone', () => {
  const words = [word('Couple', 0, 20, 30, 20, 5), word('de', 0, 42, 30, 6, 5), word('serrage', 0, 50, 30, 22, 5), word('Hors', 1, 20, 60, 15, 5)];
  const picked = wordsInRegion(words, page, { minX: 40, minY: 25, maxX: 80, maxY: 40 });
  assert.deepEqual(picked.map((w) => w.text), ['de', 'serrage']);
  assert.deepEqual(wordsInRegion(words, page, { minX: 0, minY: 100, maxX: 10, maxY: 110 }), []);
});

test('hauteur lue → taille du texte, selon les lettres de la ligne', () => {
  assert.equal(lineBodyRatio('25 N.m'), 0.72, 'chiffres et majuscules, rien sous la ligne');
  assert.equal(lineBodyRatio('Couple'), 0.94, 'majuscule et p descendant');
  assert.equal(lineBodyRatio('une vis'), 0.72, 'le point du i monte comme une majuscule');
  assert.equal(lineBodyRatio('mars'), 0.5, 'minuscules seules');
  assert.equal(lineBodyRatio('agrée'), 0.94, 'accent en haut, g en bas');
  assert.equal(lineBodyRatio('serrage'), 0.72, 'g en bas seulement');
});

test('mise en page : texte lu, cadre à effacer, taille tirée de la hauteur des lignes', () => {
  // Corps de 5 mm : « Couple de » (C, l, d en haut, p en bas) fait 4,7 mm de haut, « 25 N.m » 3,6 mm
  const words = [word('Couple', 0, 20, 30, 20, 4.7), word('de', 0, 42, 30, 6, 3.6), word('25', 1, 20, 38, 6, 3.6), word('N.m', 1, 28, 38, 9, 3.6)];
  const layout = correctionLayout(words, page)!;
  assert.equal(layout.text, 'Couple de\n25 N.m');
  assert.ok(Math.abs(layout.size - 5) < 0.05, `taille ${layout.size}`);
  assert.ok(layout.box.x < 20 && layout.box.x > 18.5, 'un peu de marge autour des lettres');
  assert.ok(layout.box.x + layout.box.w > 48 && layout.box.y + layout.box.h > 41.6);
  assert.equal(layout.wordBoxes.length, 4);
  assert.equal(layout.firstLineTop, 30);
  assert.equal(layout.left, 20);
  assert.equal(layout.width, 28);
  assert.equal(correctionLayout([], page), null);
});

test('taille bornée, cadre gardé dans la page', () => {
  const tiny = correctionLayout([word('x', 0, 0, 0, 1, 0.3)], page)!;
  assert.equal(tiny.size, 1.5);
  assert.ok(tiny.box.x >= 0 && tiny.box.y >= 0);
});

test('couleur en hexadécimal', () => {
  assert.equal(toHex([20, 30, 110]), '#141e6e');
  assert.equal(toHex([300, -4, 15.6]), '#ff0010');
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
console.log(failed ? `\n${failed} échec(s)` : '\nCorrection : tout passe');
process.exitCode = failed ? 1 : 0;
