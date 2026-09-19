import assert from 'node:assert/strict';
import { strokesInLasso } from '../src/ink/geometry.ts';
import type { InkPoint, Stroke } from '../src/ink/types.ts';

let n = 0;
const stroke = (pts: [number, number][], extra: Partial<Stroke> = {}): Stroke => ({
  id: `s${n++}`,
  points: pts.map(([x, y]): InkPoint => [x, y, 0.5]),
  color: '#000',
  size: 0.6,
  input: 'mouse',
  ...extra,
});
const line = (x0: number, y0: number, x1: number, y1: number, extra: Partial<Stroke> = {}) => {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 20; i++) pts.push([x0 + ((x1 - x0) * i) / 20, y0 + ((y1 - y0) * i) / 20]);
  return stroke(pts, extra);
};
const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
  [x0, y0 + 0.2],
];

const results: [string, () => void][] = [];
const test = (name: string, fn: () => void) => results.push([name, fn]);

test('trait entièrement entouré : sélectionné', () => {
  const s = line(20, 20, 40, 30);
  assert.deepEqual(strokesInLasso([s], rect(10, 10, 60, 50)), [s.id]);
});

test('trait qui dépasse du lasso (à moitié dedans) : sélectionné en entier', () => {
  const s = line(30, 30, 90, 30);
  assert.deepEqual(strokesInLasso([s], rect(10, 10, 60, 50)), [s.id]);
});

test('lasso qui ne fait que frôler un petit bout du trait : sélectionné', () => {
  const s = line(0, 100, 200, 100);
  // le lasso est un petit carré dont seul le bas touche le trait
  assert.deepEqual(strokesInLasso([s], rect(50, 90, 70, 100.1)), [s.id]);
});

test('simple trait de lasso qui traverse un trait (rien d’entouré) : sélectionné', () => {
  const s = line(0, 50, 100, 50);
  const scribble: [number, number][] = [
    [50, 40],
    [50, 45],
    [50, 60],
  ];
  assert.deepEqual(strokesInLasso([s], scribble), [s.id]);
});

test('trait loin du lasso : pas sélectionné', () => {
  const s = line(150, 150, 190, 190);
  assert.deepEqual(strokesInLasso([s], rect(10, 10, 60, 50)), []);
});

test('trait proche mais sans contact (écart > demi-épaisseur) : pas sélectionné', () => {
  const s = line(0, 100, 200, 100);
  assert.deepEqual(strokesInLasso([s], rect(50, 80, 70, 98)), []);
});

test('point isolé touché par le lasso', () => {
  const dot = stroke([[30, 30]]);
  assert.deepEqual(strokesInLasso([dot], rect(28, 28, 32, 32)), [dot.id]);
  const far = stroke([[130, 130]]);
  assert.deepEqual(strokesInLasso([far], rect(28, 28, 32, 32)), []);
});

test('image : compte pour tout son rectangle', () => {
  const img = stroke(
    [
      [20, 20],
      [80, 60],
    ],
    { tool: 'image', size: 0 },
  );
  // lasso qui n'effleure que le coin du rectangle, loin de la « diagonale » des deux points
  assert.deepEqual(strokesInLasso([img], rect(70, 15, 90, 25)), [img.id]);
  // lasso tout à l'intérieur du rectangle, sans en toucher les bords
  assert.deepEqual(strokesInLasso([img], rect(40, 30, 50, 40)), [img.id]);
  // lasso hors du rectangle
  assert.deepEqual(strokesInLasso([img], rect(100, 100, 120, 120)), []);
});

const shape = (kind: NonNullable<Stroke['shape']>, x0: number, y0: number, x1: number, y1: number) =>
  stroke(
    [
      [x0, y0],
      [x1, y1],
    ],
    { tool: 'shape', shape: kind, size: 0.6 },
  );

test('cadre (rectangle) : un lasso tracé à l’intérieur, sans toucher le contour, ne le prend pas', () => {
  const frame = shape('rect', 20, 20, 120, 90);
  assert.deepEqual(strokesInLasso([frame], rect(50, 40, 90, 70)), []);
});

test('cadre (rectangle) : sélectionné dès que le lasso croise un côté, ou l’entoure en entier', () => {
  const frame = shape('rect', 20, 20, 120, 90);
  assert.deepEqual(strokesInLasso([frame], rect(100, 40, 140, 70)), [frame.id]);
  assert.deepEqual(strokesInLasso([frame], rect(10, 10, 130, 100)), [frame.id]);
});

test('cercle : un lasso dans un coin de sa boîte, hors du cercle, ne le prend pas ; contre le cercle, si', () => {
  const circle = shape('circle', 20, 20, 120, 120);
  assert.deepEqual(strokesInLasso([circle], rect(21, 21, 28, 28)), []);
  assert.deepEqual(strokesInLasso([circle], rect(15, 65, 30, 75)), [circle.id]);
});

test('flèche et trait droit : un lasso qui les traverse les prend', () => {
  const arrow = shape('arrow', 20, 60, 120, 60);
  const bar = shape('line', 20, 100, 120, 100);
  assert.deepEqual(strokesInLasso([arrow, bar], rect(60, 55, 70, 65)), [arrow.id]);
  assert.deepEqual(strokesInLasso([arrow, bar], rect(60, 95, 70, 105)), [bar.id]);
  assert.deepEqual(strokesInLasso([arrow, bar], rect(60, 75, 70, 85)), []);
});

test('matrice : le lasso autour des coefficients, entre les parenthèses, ne la prend pas', () => {
  const matrix = shape('matrix', 20, 20, 80, 80);
  assert.deepEqual(strokesInLasso([matrix], rect(35, 35, 65, 65)), []);
  assert.deepEqual(strokesInLasso([matrix], rect(15, 40, 30, 60)), [matrix.id]);
  assert.deepEqual(strokesInLasso([matrix], rect(10, 10, 90, 90)), [matrix.id]);
});

test('volume et repère : comptent pour leur rectangle plein', () => {
  const cylinder = shape('cylinder', 20, 20, 60, 80);
  const axes = shape('axes3d', 100, 20, 160, 80);
  assert.deepEqual(strokesInLasso([cylinder, axes], rect(35, 40, 45, 50)), [cylinder.id]);
  assert.deepEqual(strokesInLasso([cylinder, axes], rect(120, 40, 130, 50)), [axes.id]);
});

test('plusieurs traits : seuls les touchés sont pris, dans l’ordre', () => {
  const a = line(10, 10, 30, 10);
  const b = line(10, 200, 30, 200);
  const c = line(20, 5, 20, 40);
  assert.deepEqual(strokesInLasso([a, b, c], rect(15, 8, 25, 12)), [a.id, c.id]);
});

test('lasso trop court : rien', () => {
  assert.deepEqual(strokesInLasso([line(0, 0, 10, 10)], [[5, 5]]), []);
  assert.deepEqual(strokesInLasso([line(0, 0, 10, 10)], []), []);
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
