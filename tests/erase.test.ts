import assert from 'node:assert/strict';
import { eraseFromPolyline, shapePolylines } from '../src/ink/geometry.ts';
import type { InkPoint, Stroke } from '../src/ink/types.ts';

const pt = (x: number, y: number): InkPoint => [x, y, 0.5];
const results: [string, () => void][] = [];
const test = (name: string, fn: () => void) => results.push([name, fn]);

const length = (run: InkPoint[]) => {
  let d = 0;
  for (let i = 1; i < run.length; i++) d += Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]);
  return d;
};

test('gomme au milieu d’un long segment : deux morceaux, un trou de la taille de la gomme', () => {
  const line = [pt(0, 0), pt(100, 0)]; // un seul segment de 100 mm : doit être rééchantillonné
  const runs = eraseFromPolyline(line, [pt(50, 0)], 5);
  assert.ok(runs);
  assert.equal(runs.length, 2);
  const [a, b] = runs;
  assert.ok(Math.abs(a[a.length - 1][0] - 45) < 0.6, `fin du 1er morceau ${a[a.length - 1][0]}`);
  assert.ok(Math.abs(b[0][0] - 55) < 0.6, `début du 2e morceau ${b[0][0]}`);
  assert.ok(length(a) > 44 && length(b) > 44);
});

test('gomme qui ne touche pas : null (le trait reste tel quel)', () => {
  assert.equal(eraseFromPolyline([pt(0, 0), pt(100, 0)], [pt(50, 20)], 5), null);
  assert.equal(eraseFromPolyline([pt(0, 0), pt(10, 0)], [pt(500, 500)], 5), null);
});

test('gomme qui balaie tout le trait : plus rien', () => {
  const runs = eraseFromPolyline([pt(0, 0), pt(20, 0)], [pt(-5, 0), pt(25, 0)], 3);
  assert.deepEqual(runs, []);
});

test('trajectoire rapide (deux positions très éloignées) : la capsule coupe tout le passage', () => {
  const vertical = [pt(50, -30), pt(50, 30)];
  const runs = eraseFromPolyline(vertical, [pt(0, 0), pt(100, 0)], 2);
  assert.ok(runs);
  assert.equal(runs.length, 2, 'un morceau au-dessus, un en dessous');
});

test('gomme au bout d’un trait : un seul morceau, raccourci', () => {
  const runs = eraseFromPolyline([pt(0, 0), pt(50, 0)], [pt(50, 0)], 6);
  assert.ok(runs);
  assert.equal(runs.length, 1);
  const end = runs[0][runs[0].length - 1][0];
  assert.ok(end < 45 && end > 43, `fin à ${end}`);
});

test('la pression est conservée sur les points rééchantillonnés', () => {
  const runs = eraseFromPolyline([[0, 0, 0.2], [100, 0, 0.8]], [pt(90, 0)], 3);
  assert.ok(runs);
  const [start] = runs[0];
  assert.ok(start[2] < 0.25);
});

test('cercle : converti en contour fermé, découpable', () => {
  const s: Stroke = { id: 'c', tool: 'shape', shape: 'circle', points: [pt(0, 0), pt(40, 40)], color: '#000', size: 0.6, input: 'mouse' };
  const polys = shapePolylines(s);
  assert.ok(polys && polys.length === 1);
  const ring = polys[0];
  assert.ok(Math.hypot(ring[0][0] - ring[ring.length - 1][0], ring[0][1] - ring[ring.length - 1][1]) < 0.01, 'fermé');
  // un coup de gomme sur le point le plus à droite (40, 20) : le cercle devient un arc ouvert
  const runs = eraseFromPolyline(ring, [pt(40, 20)], 3);
  assert.ok(runs && runs.length >= 1);
  // et la gomme au centre ne touche pas le contour
  assert.equal(eraseFromPolyline(ring, [pt(20, 20)], 3), null);
});

test('rectangle, triangle, ligne : un contour ; flèche : hampe + deux ailes', () => {
  const make = (shape: Stroke['shape']): Stroke => ({ id: shape ?? '', tool: 'shape', shape, points: [pt(10, 10), pt(50, 40)], color: '#000', size: 0.6, input: 'mouse' });
  assert.equal(shapePolylines(make('rect'))?.length, 1);
  assert.equal(shapePolylines(make('triangle'))?.length, 1);
  assert.equal(shapePolylines(make('line'))?.length, 1);
  assert.equal(shapePolylines(make('arrow'))?.length, 3);
});

test('images, repères, torseur, matrice, volumes : pas découpables (effacés en entier)', () => {
  const img: Stroke = { id: 'i', tool: 'image', points: [pt(0, 0), pt(10, 10)], color: '#000', size: 0, input: 'mouse' };
  assert.equal(shapePolylines(img), null);
  for (const shape of ['axes2d', 'axes3d', 'torseur', 'matrix', 'cylinder', 'cone', 'sphere', 'hemisphere', 'pyramid', 'cuboid'] as const) {
    const s: Stroke = { id: shape, tool: 'shape', shape, points: [pt(0, 0), pt(30, 30)], color: '#000', size: 0.6, input: 'mouse' };
    assert.equal(shapePolylines(s), null, shape);
  }
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
