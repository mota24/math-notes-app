import assert from 'node:assert/strict';
import { MAX_PAGE_HEIGHT, SHEET_H, fitHeight, growHeight, isExtendable, sheetCount, sheetRanges } from '../src/ink/pageExtent.ts';
import type { InkPoint, Stroke } from '../src/ink/types.ts';

let n = 0;
const stroke = (pts: [number, number][], extra: Partial<Stroke> = {}): Stroke => ({
  id: `s${n++}`,
  points: pts.map(([x, y]): InkPoint => [x, y, 0.5]),
  color: '#fff',
  size: 0.6,
  input: 'mouse',
  ...extra,
});

const results: [string, () => void][] = [];
const test = (name: string, fn: () => void) => results.push([name, fn]);

test('une feuille A4 fait 297 mm', () => assert.equal(SHEET_H, 297));

test('page d’écriture : extensible ; page de PDF ou de photo : taille du fond', () => {
  assert.ok(isExtendable({ pdf: null }));
  assert.ok(isExtendable({ pdf: null, image: null }));
  assert.ok(isExtendable({}));
  assert.ok(!isExtendable({ pdf: { fileId: 'x', pageIndex: 0 } }));
  assert.ok(!isExtendable({ pdf: null, image: { fileId: 'y' } }));
});

test('page vide, ou encre dans la première feuille : une feuille (rien ne change pour les anciennes notes)', () => {
  assert.equal(fitHeight([]), 297);
  assert.equal(fitHeight([stroke([[10, 10], [100, 250]])]), 297);
  // un trait collé au bas de l'ancienne page (bord retenu à 297) n'ouvre pas de feuille vide
  assert.equal(fitHeight([stroke([[10, 200], [100, 297]], { size: 0.6 })]), 297);
  assert.equal(fitHeight([stroke([[10, 200], [100, 298.5]], { size: 1 })]), 297);
});

test('de l’encre au-delà de la première feuille : la page s’allonge d’une feuille entière', () => {
  assert.equal(fitHeight([stroke([[10, 10], [100, 320]])]), 594);
  assert.equal(fitHeight([stroke([[10, 10], [100, 590]])]), 594);
  assert.equal(fitHeight([stroke([[10, 10], [100, 640]])]), 891);
});

test('images et formes comptent pour leur rectangle', () => {
  const img = stroke([[20, 300], [90, 420]], { tool: 'image', size: 0 });
  assert.equal(fitHeight([img]), 594);
  const shape = stroke([[20, 500], [90, 620]], { tool: 'shape', shape: 'rect' });
  assert.equal(fitHeight([shape]), 891);
});

test('effacer l’encre du bas raccourcit la page enregistrée (elle suit le contenu)', () => {
  const top = stroke([[10, 10], [100, 100]]);
  const bottom = stroke([[10, 400], [100, 500]]);
  assert.equal(fitHeight([top, bottom]), 594);
  assert.equal(fitHeight([top]), 297);
});

test('longueur plafonnée à 30 feuilles', () => {
  assert.equal(fitHeight([stroke([[10, 10], [100, 20000]])]), MAX_PAGE_HEIGHT);
  assert.equal(MAX_PAGE_HEIGHT, 30 * 297);
});

test('défiler vers le bas : le papier se déroule par feuilles entières, avec de l’avance', () => {
  // le bas de l'écran est à 100 mm sur une page de 297 : rien à faire
  assert.equal(growHeight(297, 100, 100), 297);
  // à 250 mm il resterait 47 mm (< 100) : une feuille de plus
  assert.equal(growHeight(297, 250, 100), 594);
  // écrire en bas d'une page déjà allongée
  assert.equal(growHeight(594, 560, 45), 891);
  assert.equal(growHeight(594, 400, 45), 594);
});

test('le papier ne raccourcit jamais, et ne dépasse jamais le plafond', () => {
  assert.equal(growHeight(891, 10, 100), 891);
  assert.equal(growHeight(297, 1e9, 100), MAX_PAGE_HEIGHT);
  assert.equal(growHeight(MAX_PAGE_HEIGHT, MAX_PAGE_HEIGHT, 100), MAX_PAGE_HEIGHT);
});

test('nombre de feuilles', () => {
  assert.equal(sheetCount(297), 1);
  assert.equal(sheetCount(298.5), 1);
  assert.equal(sheetCount(594), 2);
  assert.equal(sheetCount(891), 3);
  assert.equal(sheetCount(0), 1);
});

test('découpage d’une page longue en feuilles A4 pour l’impression', () => {
  assert.deepEqual(sheetRanges(297), [{ top: 0, bottom: 297 }]);
  assert.deepEqual(sheetRanges(891), [
    { top: 0, bottom: 297 },
    { top: 297, bottom: 594 },
    { top: 594, bottom: 891 },
  ]);
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
console.log(failed ? `\n${failed} échec(s)` : '\nTous les scénarios passent');
process.exitCode = failed ? 1 : 0;
