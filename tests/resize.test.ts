import assert from 'node:assert/strict';
import { resizedPoints } from '../src/ink/geometry.ts';
import type { InkPoint } from '../src/ink/types.ts';

const P = { width: 210, height: 297 };
const box: InkPoint[] = [
  [50, 60, 0.5],
  [90, 100, 0.5],
];
const results: [string, () => void][] = [];
const test = (name: string, fn: () => void) => results.push([name, fn]);
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test('coin sud-est : le coin opposé (nord-ouest) reste fixe', () => {
  const [a, b] = resizedPoints(box, 'se', 10, 20, P);
  assert.deepEqual([a[0], a[1], b[0], b[1]], [50, 60, 100, 120]);
});

test('coin nord-ouest : le coin sud-est reste fixe', () => {
  const [a, b] = resizedPoints(box, 'nw', -10, -5, P);
  assert.deepEqual([a[0], a[1], b[0], b[1]], [40, 55, 90, 100]);
});

test('bords : un seul côté bouge', () => {
  let [a, b] = resizedPoints(box, 'e', 15, 999, P);
  assert.deepEqual([a[0], a[1], b[0], b[1]], [50, 60, 105, 100]);
  [a, b] = resizedPoints(box, 'n', 999, -12, P);
  assert.deepEqual([a[0], a[1], b[0], b[1]], [50, 48, 90, 100]);
});

test('les points d’origine peuvent être dans n’importe quel ordre : le résultat est normalisé', () => {
  const flipped: InkPoint[] = [box[1], box[0]];
  const [a, b] = resizedPoints(flipped, 'se', 5, 5, P);
  assert.deepEqual([a[0], a[1], b[0], b[1]], [50, 60, 95, 105]);
});

test('reste dans la page', () => {
  const [a, b] = resizedPoints(box, 'se', 999, 999, P);
  assert.deepEqual([b[0], b[1]], [210, 297]);
  const [c] = resizedPoints(box, 'nw', -999, -999, P);
  assert.deepEqual([c[0], c[1]], [0, 0]);
});

test('ne s’écrase jamais sous la taille minimale, même en tirant au-delà du bord opposé', () => {
  const [a, b] = resizedPoints(box, 'e', -500, 0, P);
  close(b[0] - a[0], 3);
  const [c, d] = resizedPoints(box, 'n', 0, 500, P);
  close(d[1] - c[1], 3);
});

test('segment (ligne, flèche) : chaque bout se déplace librement, l’autre ne bouge pas', () => {
  const seg: InkPoint[] = [
    [10, 10, 0.5],
    [80, 30, 0.5],
  ];
  const start = resizedPoints(seg, 'start', 5, 5, P);
  assert.deepEqual([start[0][0], start[0][1], start[1][0], start[1][1]], [15, 15, 80, 30]);
  const end = resizedPoints(seg, 'end', -10, 40, P);
  assert.deepEqual([end[0][0], end[0][1], end[1][0], end[1][1]], [10, 10, 70, 70]);
  // la direction (l'angle) est libre : un bout peut passer de l'autre côté
  const across = resizedPoints(seg, 'end', -200, 0, P);
  assert.equal(across[1][0], 0);
});

test('image (proportions gardées) : coin sud-est, proportions identiques, coin nord-ouest fixe', () => {
  const img: InkPoint[] = [
    [20, 20, 1],
    [60, 50, 1],
  ]; // 40 × 30
  const [a, b] = resizedPoints(img, 'se', 20, 0, P, true);
  assert.deepEqual([a[0], a[1]], [20, 20]);
  close((b[0] - a[0]) / (b[1] - a[1]), 40 / 30);
  close(b[0] - a[0], 60);
});

test('image : tirer en vertical suffit aussi (l’axe qui bouge le plus décide)', () => {
  const img: InkPoint[] = [
    [20, 20, 1],
    [60, 50, 1],
  ];
  const [a, b] = resizedPoints(img, 'se', 0, 30, P, true);
  close(b[1] - a[1], 60);
  close((b[0] - a[0]) / (b[1] - a[1]), 40 / 30);
});

test('image : coin nord-ouest, le coin sud-est reste fixe ; jamais hors de la page', () => {
  const img: InkPoint[] = [
    [20, 20, 1],
    [60, 50, 1],
  ];
  const [a, b] = resizedPoints(img, 'nw', -10, 0, P, true);
  assert.deepEqual([b[0], b[1]], [60, 50]);
  assert.ok(a[0] >= 0 && a[1] >= 0);
  const [c] = resizedPoints(img, 'nw', -999, -999, P, true);
  assert.ok(c[0] >= 0 && c[1] >= 0);
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
