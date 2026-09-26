import assert from 'node:assert/strict';
import { MAX_SIGNATURES, PLACED_MAX_HEIGHT, PLACED_WIDTH, normalizeSignature, placedAt, placedSize, readSignatures } from '../src/ink/signature.ts';
import type { InkPoint } from '../src/ink/types.ts';

const results: [string, () => void][] = [];
const test = (name: string, fn: () => void) => results.push([name, fn]);
const stroke = (pts: [number, number][]): InkPoint[] => pts.map(([x, y]) => [x, y, 0.5]);

test('signature tracée : ramenée en mm, collée au coin de l’encre, avec sa marge', () => {
  // Cadre de saisie à 6 px/mm : encre de (120, 60) à (420, 180) px → 50 × 20 mm
  const sig = normalizeSignature([stroke([[120, 100], [300, 60], [420, 180]]), stroke([[200, 150], [250, 150]])], 6, 1)!;
  assert.equal(sig.width, 52);
  assert.equal(sig.height, 22);
  assert.deepEqual(sig.strokes[0][0], [1, (100 - 60) / 6 + 1, 0.5]);
  assert.equal(sig.strokes.length, 2);
});

test('trop peu tracé : pas une signature', () => {
  assert.equal(normalizeSignature([], 6), null);
  assert.equal(normalizeSignature([stroke([[10, 10], [11, 11], [12, 10], [11, 12]])], 6), null, 'un point');
});

test('taille posée : 45 mm de large, pas plus de 22 mm de haut, jamais plus grande que la page', () => {
  const page = { width: 210, height: 297 };
  assert.deepEqual(placedSize({ width: 90, height: 30 }, page), { w: PLACED_WIDTH, h: 15 });
  const tall = placedSize({ width: 40, height: 40 }, page);
  assert.equal(tall.h, PLACED_MAX_HEIGHT);
  const tiny = placedSize({ width: 90, height: 30 }, { width: 30, height: 30 });
  assert.ok(tiny.w <= 27);
});

test('posée en bas à droite de la page', () => {
  assert.deepEqual(placedAt({ w: 45, h: 15 }, { width: 210, height: 297 }), { x: 145, y: 257 });
  assert.deepEqual(placedAt({ w: 45, h: 15 }, { width: 50, height: 30 }), { x: 0, y: 0 }, 'petite page : dans le coin');
});

test('lecture de la base locale : données abîmées écartées, trois au plus', () => {
  const ok = { id: 's1', strokes: [[[1, 2, 0.5]]], width: 10, height: 5, createdAt: 1 };
  assert.deepEqual(readSignatures(null), []);
  assert.deepEqual(readSignatures([ok, { id: 2 }, { ...ok, strokes: [[[1, 'x', 0.5]]] }]), [ok]);
  assert.equal(readSignatures([ok, ok, ok, ok]).length, MAX_SIGNATURES);
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
console.log(failed ? `\n${failed} échec(s)` : '\nSignatures : tout passe');
process.exitCode = failed ? 1 : 0;
