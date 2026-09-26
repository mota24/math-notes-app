import assert from 'node:assert/strict';
import { fromPdfItems, fromTesseract, hasRealText, matchBoxes, normalize, pageString, searchPage, snippet } from '../src/ocr/textModel.ts';
import type { TextWord } from '../src/ocr/textModel.ts';

const results: [string, () => void][] = [];
const test = (name: string, fn: () => void) => results.push([name, fn]);

const word = (text: string, line: number, x: number): TextWord => ({ text, x, y: line * 0.05, w: 0.04, h: 0.02, line });

test('Tesseract : mots gardés en fractions de page, lignes numérotées, bruit écarté', () => {
  const bbox = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });
  const words = fromTesseract(
    {
      blocks: [
        {
          paragraphs: [
            {
              lines: [
                { words: [{ text: 'Rivet', confidence: 92, bbox: bbox(100, 200, 300, 250) }, { text: '~', confidence: 12, bbox: bbox(310, 200, 320, 250) }] },
                { words: [{ text: '·', confidence: 10, bbox: bbox(0, 0, 5, 5) }] },
                { words: [{ text: 'A320', confidence: 88, bbox: bbox(100, 300, 260, 350) }] },
              ],
            },
          ],
        },
      ],
    },
    1000,
    2000,
  );
  assert.deepEqual(words.map((w) => [w.text, w.line]), [['Rivet', 0], ['A320', 1]], 'ligne de bruit seule : pas de numéro gaspillé');
  assert.deepEqual([words[0].x, words[0].y, words[0].w, words[0].h], [0.1, 0.1, 0.2, 0.025]);
  assert.deepEqual(fromTesseract({ blocks: null }, 10, 10), []);
});

test('texte natif du PDF : phrases découpées en mots, ordre de lecture, lignes à la ligne de base', () => {
  // Page de 600 × 800 points ; pdf.js compte y depuis le BAS
  const words = fromPdfItems(
    [
      { str: 'Fig. 2', transform: [10, 0, 0, 10, 300, 700], width: 60, height: 10 },
      { str: 'Serrage du', transform: [10, 0, 0, 10, 100, 700], width: 100, height: 10 },
      { str: 'boulon M8', transform: [10, 0, 0, 10, 100, 680], width: 90, height: 10 },
      { str: '   ', transform: [10, 0, 0, 10, 0, 0], width: 3, height: 10 },
    ],
    600,
    800,
  );
  assert.equal(pageString(words), 'Serrage du Fig. 2\nboulon M8');
  const du = words.find((w) => w.text === 'du')!;
  assert.ok(Math.abs(du.x - (100 + 8 * 10) / 600) < 1e-9, 'place du mot dans la phrase');
  assert.ok(du.y < words.find((w) => w.text === 'boulon')!.y, 'le haut de la page en premier');
});

test('scan sans texte : il faut lire l’image', () => {
  assert.ok(!hasRealText([]));
  assert.ok(!hasRealText([word('12', 0, 0)]));
  assert.ok(hasRealText([word('Procédure de contrôle', 0, 0)]));
});

test('recherche : sans accents ni majuscules, en milieu de mot, à cheval sur plusieurs mots et lignes', () => {
  const words = [word('Couple', 0, 0.1), word('de', 0, 0.2), word('serrage', 0, 0.3), word('intégral', 1, 0.1), word('SERRAGE', 1, 0.2)];
  assert.deepEqual(searchPage(words, 'serrage'), [{ from: 2, to: 2 }, { from: 4, to: 4 }]);
  assert.deepEqual(searchPage(words, 'INTEGR'), [{ from: 3, to: 3 }], 'début de mot, accent ignoré');
  assert.deepEqual(searchPage(words, 'de  serr'), [{ from: 1, to: 2 }], 'deux mots, espaces multiples');
  assert.deepEqual(searchPage(words, 'serrage integral'), [{ from: 2, to: 3 }], 'à cheval sur deux lignes');
  assert.deepEqual(searchPage(words, '   '), []);
  assert.deepEqual(searchPage(words, 'absent'), []);
});

test('normalisation : ligatures, apostrophes et tirets typographiques', () => {
  assert.equal(normalize('Coeﬃcient l’axe — Été'), "coefficient l'axe - ete");
  assert.equal(normalize('ÉTÉ'), 'ete');
});

test('extrait et cadres d’une occurrence', () => {
  const words = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((t, i) => word(t, i < 6 ? 0 : 1, i * 0.1));
  assert.equal(snippet(words, { from: 3, to: 3 }, 2), '… b c d e f …');
  assert.equal(snippet(words, { from: 0, to: 0 }, 1), 'a b …');
  const boxes = matchBoxes(words, { from: 4, to: 6 });
  assert.equal(boxes.length, 2, 'une occurrence sur deux lignes : deux cadres');
  assert.ok(Math.abs(boxes[0].x - 0.4) < 1e-9 && Math.abs(boxes[0].w - 0.14) < 1e-9);
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
console.log(failed ? `\n${failed} échec(s)` : '\nTexte des PDF : tout passe');
process.exitCode = failed ? 1 : 0;
