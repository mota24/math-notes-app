import assert from 'node:assert/strict';
import { straightenedTape, strokeHit, tapeAt } from '../src/ink/geometry.ts';
import type { InkPoint, Stroke } from '../src/ink/types.ts';

let n = 0;
const stroke = (pts: [number, number][], extra: Partial<Stroke> = {}): Stroke => ({
  id: `s${n++}`,
  points: pts.map(([x, y]): InkPoint => [x, y, 0.5]),
  color: '#fb923c',
  size: 8,
  input: 'mouse',
  ...extra,
});
const tape = (x0: number, y: number, x1: number, extra: Partial<Stroke> = {}) => stroke([[x0, y], [x1, y]], { tool: 'tape', ...extra });
const pts = (list: [number, number][]): InkPoint[] => list.map(([x, y]) => [x, y, 0.5]);

const results: [string, () => void][] = [];
const test = (name: string, fn: () => void) => results.push([name, fn]);

test('tap sur le ruban : trouvé, y compris sur son bord (demi-largeur)', () => {
  const t = tape(20, 50, 120);
  assert.equal(tapeAt([t], 60, 50)?.id, t.id);
  assert.equal(tapeAt([t], 60, 53.5)?.id, t.id); // dans les 4 mm de demi-largeur
});

test('tap à côté du ruban (au-delà de la marge de doigt) : rien', () => {
  const t = tape(20, 50, 120);
  assert.equal(tapeAt([t], 60, 58), null);
  assert.equal(tapeAt([t], 140, 50), null);
});

test('un doigt imprécis, juste hors du bord : le ruban est quand même touché', () => {
  const t = tape(20, 50, 120);
  assert.equal(tapeAt([t], 60, 55)?.id, t.id); // 1 mm au-delà du bord, dans la marge de 1,5 mm
});

test('deux rubans qui se chevauchent : celui du dessus (le dernier dessiné)', () => {
  const below = tape(20, 50, 120);
  const above = tape(40, 52, 100);
  assert.equal(tapeAt([below, above], 60, 51)?.id, above.id);
  assert.equal(tapeAt([above, below], 60, 51)?.id, below.id);
});

test('les traits masqués (en cours de modification) sont ignorés', () => {
  const below = tape(20, 50, 120);
  const above = tape(40, 52, 100);
  assert.equal(tapeAt([below, above], 60, 51, new Set([above.id]))?.id, below.id);
});

test('un ruban rendu transparent reste touchable : on peut le retaper pour le remettre', () => {
  const t = tape(20, 50, 120, { revealed: true });
  assert.equal(tapeAt([t], 60, 50)?.id, t.id);
});

test('seuls les rubans comptent : encre, surligneur, forme et image sont ignorés', () => {
  const ink = stroke([[20, 50], [120, 50]]);
  const highlight = stroke([[20, 50], [120, 50]], { tool: 'highlighter' });
  const shape = stroke([[20, 40], [120, 60]], { tool: 'shape', shape: 'rect' });
  const image = stroke([[20, 40], [120, 60]], { tool: 'image', size: 0 });
  assert.equal(tapeAt([ink, highlight, shape, image], 60, 50), null);
});

test('un ruban d’un seul point (tap) est touchable aussi', () => {
  const dot = stroke([[30, 30]], { tool: 'tape' });
  assert.equal(tapeAt([dot], 32, 30)?.id, dot.id);
  assert.equal(tapeAt([dot], 60, 30), null);
});

test('la gomme voit le ruban comme un trait ordinaire (touché sur sa largeur)', () => {
  const t = tape(20, 50, 120);
  assert.ok(strokeHit(t, 60, 53, 1));
  assert.ok(!strokeHit(t, 60, 60, 1));
});

test('ruban à main levée presque droit : redressé en bande nette entre ses deux bouts', () => {
  const wobbly = pts([[10, 50], [30, 51.2], [50, 49.4], [70, 50.8], [90, 49.7], [110, 50]]);
  const out = straightenedTape(wobbly, 8);
  assert.ok(out.length > wobbly.length);
  assert.deepEqual([out[0][0], out[0][1]], [10, 50]);
  assert.deepEqual([out[out.length - 1][0], out[out.length - 1][1]], [110, 50]);
  for (const [, y] of out) assert.ok(Math.abs(y - 50) < 1e-9, `y=${y}`);
});

test('ruban en diagonale, presque droit : redressé aussi', () => {
  const diag = pts([[10, 10], [30, 31], [50, 49], [70, 71], [90, 90]]);
  const out = straightenedTape(diag, 8);
  const [ax, ay] = out[0];
  const [bx, by] = out[out.length - 1];
  assert.deepEqual([ax, ay, bx, by], [10, 10, 90, 90]);
  for (const [x, y] of out) assert.ok(Math.abs(y - x) < 1e-9);
});

test('ruban courbe ou coudé : gardé tel que dessiné', () => {
  const curve = pts([[10, 50], [40, 30], [70, 30], [100, 50]]);
  assert.equal(straightenedTape(curve, 8), curve);
  const elbow = pts([[10, 10], [60, 10], [60, 60]]);
  assert.equal(straightenedTape(elbow, 8), elbow);
});

test('trait trop court pour être une bande : gardé tel quel', () => {
  const short = pts([[10, 10], [12, 10.3], [14, 10]]);
  assert.equal(straightenedTape(short, 8), short);
  const two = pts([[10, 10], [80, 10]]);
  assert.equal(straightenedTape(two, 8), two);
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
