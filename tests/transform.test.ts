import assert from 'node:assert/strict';
import {
  cornerScale,
  fitShift,
  isErasable,
  normalizeAngle,
  orientation,
  rotates,
  rotationDelta,
  shapePolylines,
  strokeBBox,
  strokeCorners,
  strokeHit,
  strokesInLasso,
  transformStroke,
} from '../src/ink/geometry.ts';
import type { Similarity } from '../src/ink/geometry.ts';
import { fitHeight } from '../src/ink/pageExtent.ts';
import type { InkPoint, ShapeKind, Stroke } from '../src/ink/types.ts';

let n = 0;
const P = (x: number, y: number): InkPoint => [x, y, 0.5];
const shape = (kind: ShapeKind, x0: number, y0: number, x1: number, y1: number, extra: Partial<Stroke> = {}): Stroke => ({
  id: `s${n++}`,
  tool: 'shape',
  shape: kind,
  points: [P(x0, y0), P(x1, y1)],
  color: '#000',
  size: 0.6,
  input: 'mouse',
  ...extra,
});
const pen = (pts: [number, number][], extra: Partial<Stroke> = {}): Stroke => ({
  id: `s${n++}`,
  points: pts.map(([x, y]) => P(x, y)),
  color: '#000',
  size: 0.6,
  input: 'pen',
  ...extra,
});
const image = (x0: number, y0: number, x1: number, y1: number, extra: Partial<Stroke> = {}): Stroke => ({
  id: `s${n++}`,
  tool: 'image',
  image: 'data:image/png;base64,AAAA',
  points: [P(x0, y0), P(x1, y1)],
  color: '#000',
  size: 0,
  input: 'mouse',
  ...extra,
});

const results: [string, () => void][] = [];
const test = (name: string, fn: () => void) => results.push([name, fn]);
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);
const deg = (d: number) => (d * Math.PI) / 180;
const page = { width: 210, height: 297 };

// ------------------------------------------------------------------ rotation : boîte, coins, contact
test('quelles formes tournent par leur angle : deux coins et images ; pas lignes, flèches ni encre', () => {
  assert.equal(rotates(image(0, 0, 10, 10)), true);
  for (const kind of ['circle', 'rect', 'triangle', 'axes2d', 'torseur', 'cylinder', 'torus', 'ellipsoid'] as const) {
    assert.equal(rotates(shape(kind, 0, 0, 10, 10)), true, kind);
  }
  assert.equal(rotates(shape('line', 0, 0, 10, 10)), false);
  assert.equal(rotates(shape('arrow', 0, 0, 10, 10)), false);
  assert.equal(rotates(pen([[0, 0], [5, 5]])), false);
  assert.equal(rotates(pen([[0, 0], [5, 5]], { tool: 'highlighter' })), false);
});

test('sans angle : les coins sont ceux du rectangle (épaisseur comprise), la boîte est inchangée', () => {
  const s = shape('rect', 10, 10, 50, 30, { size: 1 });
  assert.deepEqual(strokeCorners(s), [[9.5, 9.5], [50.5, 9.5], [50.5, 30.5], [9.5, 30.5]]);
  assert.deepEqual(strokeBBox(s), { minX: 9.5, minY: 9.5, maxX: 50.5, maxY: 30.5 });
});

test('un quart de tour : le rectangle 40 × 20 devient 20 × 40 autour du même centre', () => {
  const s = shape('rect', 10, 10, 50, 30, { size: 0, angle: Math.PI / 2 });
  const b = strokeBBox(s);
  close(b.minX, 20);
  close(b.maxX, 40);
  close(b.minY, 0);
  close(b.maxY, 40);
});

test('à 45° la boîte englobante grandit (la diagonale), et reste centrée', () => {
  const s = shape('rect', 0, 0, 20, 20, { size: 0, angle: Math.PI / 4 });
  const b = strokeBBox(s);
  close(b.maxX - b.minX, 20 * Math.SQRT2);
  close((b.minX + b.maxX) / 2, 10);
  close((b.minY + b.maxY) / 2, 10);
});

test('une image tourne comme une forme', () => {
  const img = image(10, 10, 50, 30, { angle: Math.PI / 2 });
  const b = strokeBBox(img);
  close(b.maxX - b.minX, 20);
  close(b.maxY - b.minY, 40);
});

test('toucher une forme tournée : dans son rectangle tourné, pas dans l’ancien', () => {
  const s = shape('cylinder', 0, 0, 40, 10, { size: 0, angle: Math.PI / 2 }); // devient 10 de large, 40 de haut, centré en (20, 5)
  assert.equal(strokeHit(s, 20, 22, 0.5), true, 'en dessous de l’ancien rectangle, dans le nouveau');
  assert.equal(strokeHit(s, 5, 5, 0.5), false, 'dans l’ancien rectangle, hors du nouveau');
  assert.equal(strokeHit(s, 20, -12, 0.5), true);
});

test('ligne et flèche : la gomme les touche sur leur trait, pas dans toute leur boîte', () => {
  const diag = shape('line', 0, 0, 100, 100);
  assert.equal(strokeHit(diag, 50, 50, 2), true);
  assert.equal(strokeHit(diag, 90, 10, 2), false, 'coin de la boîte, loin du trait');
  const arrow = shape('arrow', 0, 0, 100, 0);
  assert.equal(strokeHit(arrow, 50, 1, 2), true);
  assert.equal(strokeHit(arrow, 50, 30, 2), false);
});

test('lasso : une forme tournée se sélectionne là où elle est, plus là où elle était', () => {
  const s = shape('cylinder', 0, 0, 40, 10, { size: 0, angle: Math.PI / 2 });
  const square = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0 + 0.1]];
  assert.deepEqual(strokesInLasso([s], square(16, 24, 24, 34)), [s.id], 'sur la partie qui a tourné vers le bas');
  assert.deepEqual(strokesInLasso([s], square(0, 3, 8, 8)), [], 'sur l’ancienne extrémité gauche');
});

test('contours d’un rectangle tourné d’un quart de tour', () => {
  const s = shape('rect', 0, 0, 40, 10, { size: 0, angle: Math.PI / 2 });
  const [ring] = shapePolylines(s)!;
  const expected = [[25, -15], [25, 25], [15, 25], [15, -15], [25, -15]];
  ring.forEach(([x, y], i) => {
    close(x, expected[i][0]);
    close(y, expected[i][1]);
  });
});

test('la gomme et le lasso voient le même rectangle que le dessin : les coins d’une forme tournée et son contour coïncident', () => {
  const s = shape('rect', 10, 10, 50, 30, { size: 0, angle: deg(30) });
  const [ring] = shapePolylines(s)!;
  const corners = strokeCorners(s);
  corners.forEach(([x, y], i) => {
    close(x, ring[i][0]);
    close(y, ring[i][1]);
  });
});

// ------------------------------------------------------------------ transformStroke
const R90: Similarity = { px: 10, py: 10, k: 1, theta: Math.PI / 2 };

test('trait à main levée : la rotation et l’échelle réécrivent ses points', () => {
  const s = pen([[20, 10], [30, 10]]);
  const t = transformStroke(s, R90);
  close(t.points[0][0], 10);
  close(t.points[0][1], 20);
  close(t.points[1][0], 10);
  close(t.points[1][1], 30);
  assert.equal(t.angle, undefined, 'l’encre ne porte jamais d’angle');
  const big = transformStroke(s, { px: 0, py: 0, k: 2, theta: 0 });
  assert.deepEqual(big.points.map((p) => [p[0], p[1]]), [[40, 20], [60, 20]]);
  assert.equal(big.size, 1.2, 'l’épaisseur suit l’échelle');
});

test('la pression est conservée, l’original n’est pas modifié', () => {
  const s = pen([[1, 2], [3, 4]]);
  s.points[0][2] = 0.9;
  const before = JSON.stringify(s);
  const t = transformStroke(s, R90);
  assert.equal(t.points[0][2], 0.9);
  assert.equal(JSON.stringify(s), before);
  assert.notEqual(t, s);
});

test('épaisseur d’un trait agrandi ou réduit : bornée', () => {
  const s = pen([[0, 0], [1, 1]], { size: 5 });
  assert.equal(transformStroke(s, { px: 0, py: 0, k: 100, theta: 0 }).size, 40);
  assert.equal(transformStroke(s, { px: 0, py: 0, k: 0.001, theta: 0 }).size, 0.1);
});

test('forme à deux coins : l’échelle réécrit ses coins, son épaisseur ne change pas, pas d’angle', () => {
  const s = shape('rect', 10, 10, 30, 20);
  const t = transformStroke(s, { px: 10, py: 10, k: 2, theta: 0 });
  assert.deepEqual(t.points.map((p) => [p[0], p[1]]), [[10, 10], [50, 30]]);
  assert.equal(t.size, s.size);
  assert.equal(t.angle, undefined);
});

test('forme à deux coins : tourner autour de son propre centre ne bouge que l’angle', () => {
  const s = shape('rect', 10, 10, 30, 20);
  const t = transformStroke(s, { px: 20, py: 15, k: 1, theta: deg(30) });
  close(t.angle!, deg(30));
  t.points.forEach((p, i) => {
    close(p[0], s.points[i][0]);
    close(p[1], s.points[i][1]);
  });
});

test('forme à deux coins : tourner autour d’un autre pivot déplace aussi son centre', () => {
  const s = shape('rect', 10, 10, 30, 20); // centre (20, 15)
  const t = transformStroke(s, { px: 0, py: 0, k: 1, theta: Math.PI / 2 });
  // (20, 15) → (−15, 20) ; le rectangle 20 × 10 garde ses côtés d’origine, l’angle porte le quart de tour
  close((t.points[0][0] + t.points[1][0]) / 2, -15);
  close((t.points[0][1] + t.points[1][1]) / 2, 20);
  close(Math.abs(t.points[1][0] - t.points[0][0]), 20);
  close(Math.abs(t.points[1][1] - t.points[0][1]), 10);
  close(t.angle!, Math.PI / 2);
});

test('les coins d’une forme transformée sont les coins d’origine passés par la même similitude', () => {
  const m: Similarity = { px: 5, py: 40, k: 1.7, theta: deg(-25), dx: 3, dy: -2 };
  for (const start of [shape('cylinder', 10, 10, 50, 30, { size: 0 }), shape('rect', 10, 10, 50, 30, { size: 0, angle: deg(20) }), image(10, 10, 50, 30, { angle: deg(-70) })]) {
    const cos = Math.cos(m.theta);
    const sin = Math.sin(m.theta);
    const expected = strokeCorners(start).map(([x, y]) => [
      m.px + m.k * ((x - m.px) * cos - (y - m.py) * sin) + (m.dx ?? 0),
      m.py + m.k * ((x - m.px) * sin + (y - m.py) * cos) + (m.dy ?? 0),
    ]);
    const got = strokeCorners(transformStroke(start, m));
    got.forEach(([x, y], i) => {
      close(x, expected[i][0], 1e-6);
      close(y, expected[i][1], 1e-6);
    });
  }
});

test('deux rotations s’additionnent ; revenir en arrière supprime l’angle', () => {
  const s = shape('rect', 10, 10, 30, 20);
  const a = transformStroke(s, { px: 20, py: 15, k: 1, theta: deg(50) });
  const b = transformStroke(a, { px: 20, py: 15, k: 1, theta: deg(40) });
  close(b.angle!, deg(90));
  const back = transformStroke(b, { px: 20, py: 15, k: 1, theta: deg(-90) });
  assert.equal(back.angle, undefined);
  assert.equal('angle' in back, false, 'plus de champ inutile dans les données enregistrées');
});

test('ligne et flèche : elles tournent en réécrivant leurs bouts, sans angle', () => {
  for (const kind of ['line', 'arrow'] as const) {
    const s = shape(kind, 0, 10, 20, 10);
    const t = transformStroke(s, { px: 10, py: 10, k: 1, theta: Math.PI / 2 });
    close(t.points[0][0], 10);
    close(t.points[0][1], 0);
    close(t.points[1][0], 10);
    close(t.points[1][1], 20);
    assert.equal(t.angle, undefined);
    close(orientation(t), Math.PI / 2);
  }
});

test('image : même règle que les formes, l’image et son épaisseur (0) restent telles quelles', () => {
  const img = image(10, 10, 50, 30);
  const t = transformStroke(img, { px: 30, py: 20, k: 0.5, theta: deg(15) });
  assert.equal(t.image, img.image);
  assert.equal(t.size, 0);
  close(t.angle!, deg(15));
  close(Math.abs(t.points[1][0] - t.points[0][0]), 20);
  close(Math.abs(t.points[1][1] - t.points[0][1]), 10);
});

test('l’identité ne change rien, et le résultat s’enregistre tel quel (JSON) : pas de NaN', () => {
  const list = [pen([[1, 2], [3, 9]]), shape('circle', 4, 4, 20, 12), image(0, 0, 10, 5), shape('line', 1, 1, 9, 5)];
  for (const s of list) {
    const same = transformStroke(s, { px: 7, py: 7, k: 1, theta: 0 });
    assert.deepEqual(same.points, s.points);
    assert.equal(same.angle, undefined);
    const moved = transformStroke(s, { px: 7, py: 7, k: 1.3, theta: deg(33), dx: 1, dy: 2 });
    assert.deepEqual(JSON.parse(JSON.stringify(moved)), moved);
    assert.ok(!JSON.stringify(moved).includes('null'), 'aucune valeur invalide');
  }
});

test('couleur, pointillés, forme et identifiant sont conservés', () => {
  const s = shape('cuboid', 10, 10, 50, 30, { color: '#c0392b', dashed: true });
  const t = transformStroke(s, R90);
  assert.equal(t.color, '#c0392b');
  assert.equal(t.dashed, true);
  assert.equal(t.shape, 'cuboid');
  assert.equal(t.id, s.id);
});

// ------------------------------------------------------------------ poignées d'angle : échelle proportionnelle
const box = { minX: 10, minY: 10, maxX: 50, maxY: 30 };

test('coin sud-est : le coin opposé reste fixe et le facteur suit la diagonale', () => {
  const same = cornerScale(box, 'se', [50, 30], page);
  assert.deepEqual(same.anchor, [10, 10]);
  close(same.k, 1);
  close(cornerScale(box, 'se', [90, 50], page).k, 2);
  close(cornerScale(box, 'se', [30, 20], page).k, 0.5);
});

test('coin nord-ouest : l’ancre est le coin sud-est', () => {
  const r = cornerScale(box, 'nw', [2, 6], page); // le coin (10, 10) est tiré en (2, 6) : × 1,2 depuis (50, 30)
  assert.deepEqual(r.anchor, [50, 30]);
  close(r.k, 1.2);
});

test('les quatre coins ont chacun pour ancre le coin opposé', () => {
  assert.deepEqual(cornerScale(box, 'ne', [50, 10], page).anchor, [10, 30]);
  assert.deepEqual(cornerScale(box, 'sw', [10, 30], page).anchor, [50, 10]);
});

test('tirer perpendiculairement à la diagonale ne change pas l’échelle (aucune déformation)', () => {
  // la diagonale est (40, 20) ; (−20, 40) lui est perpendiculaire
  close(cornerScale(box, 'se', [50 - 20, 30 + 40], page).k, 1);
});

test('la sélection ne sort pas de la page en grandissant', () => {
  const r = cornerScale(box, 'se', [9999, 9999], page);
  close(10 + 40 * r.k, 210); // atteint le bord droit d'abord
  const up = cornerScale(box, 'nw', [-9999, -9999], page);
  assert.ok(50 - 40 * up.k >= -1e-9 && 30 - 20 * up.k >= -1e-9);
});

test('sur une page qui s’allonge (hauteur libre), seule la largeur limite', () => {
  const r = cornerScale({ minX: 10, minY: 250, maxX: 50, maxY: 290 }, 'se', [9999, 9999], { width: 210, height: 297 * 30 });
  close(10 + 40 * r.k, 210);
});

test('ne s’écrase jamais : facteur minimal, même en tirant au-delà de l’ancre', () => {
  const r = cornerScale(box, 'se', [-500, -500], page);
  assert.ok(r.k >= 0.05 && r.k * 40 >= 2.99 - 1e-9, `k = ${r.k}`);
});

test('cadre sans surface : rien à mettre à l’échelle', () => {
  assert.equal(cornerScale({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, 'se', [50, 50], page).k, 1);
});

// ------------------------------------------------------------------ rotation à la poignée
test('quart de tour horaire à l’écran : de l’est vers le sud', () => {
  close(rotationDelta([0, 0], [10, 0], [0, 10], 0, Math.PI / 12, 0), Math.PI / 2);
  close(rotationDelta([0, 0], [10, 0], [0, -10], 0, Math.PI / 12, 0), -Math.PI / 2);
});

test('la rotation s’aimante à 3° près d’un multiple de 15° (angle final)', () => {
  const at = (d: number): [number, number] => [10 * Math.cos(deg(d)), 10 * Math.sin(deg(d))];
  close(rotationDelta([0, 0], [10, 0], at(88)), deg(90));
  close(rotationDelta([0, 0], [10, 0], at(1.5)), 0);
  close(rotationDelta([0, 0], [10, 0], at(83)), deg(83), 1e-9); // trop loin : libre
});

test('l’aimantation compte l’orientation de départ : une ligne à 10° se cale sur 15° (+5°) ou 0° (−10°)', () => {
  const at = (d: number): [number, number] => [10 * Math.cos(deg(d)), 10 * Math.sin(deg(d))];
  close(rotationDelta([0, 0], at(0), at(4.5), deg(10)), deg(5));
  close(rotationDelta([0, 0], at(0), at(-9), deg(10)), deg(-10));
});

test('normalizeAngle : ramené à ]−π, π], quasi nul = 0', () => {
  close(normalizeAngle(1.5 * Math.PI), -Math.PI / 2);
  close(normalizeAngle(-1.5 * Math.PI), Math.PI / 2);
  close(normalizeAngle(2 * Math.PI + 0.5), 0.5);
  close(normalizeAngle(-2 * Math.PI - 0.5), -0.5);
  assert.equal(normalizeAngle(2 * Math.PI), 0);
  assert.equal(normalizeAngle(1e-12), 0);
});

test('orientation : angle d’une ligne, angle d’une forme, 0 pour l’encre', () => {
  close(orientation(shape('line', 0, 0, 10, 10)), Math.PI / 4);
  close(orientation(shape('arrow', 10, 10, 0, 10)), Math.PI);
  close(orientation(shape('rect', 0, 0, 10, 10, { angle: 1.2 })), 1.2);
  assert.equal(orientation(shape('rect', 0, 0, 10, 10)), 0);
  assert.equal(orientation(pen([[0, 0], [1, 1]])), 0);
});

// ------------------------------------------------------------------ rester dans la page
test('décalage qui ramène la sélection dans la page', () => {
  assert.deepEqual(fitShift([pen([[10, 10], [50, 50]], { size: 0 })], page), [0, 0]);
  assert.deepEqual(fitShift([pen([[-5, 10], [50, 50]], { size: 0 })], page), [5, 0]);
  assert.deepEqual(fitShift([pen([[10, 10], [215, 50]], { size: 0 })], page), [-5, 0]);
  assert.deepEqual(fitShift([pen([[10, -3], [50, 50]], { size: 0 })], page), [0, 3]);
  assert.deepEqual(fitShift([pen([[10, 10], [50, 300]], { size: 0 })], page), [0, -3]);
  assert.deepEqual(fitShift([pen([[10, 10], [50, 9000]], { size: 0 })], { width: 210, height: Infinity }), [0, 0]);
  assert.deepEqual(fitShift([], page), [0, 0]);
});

// ------------------------------------------------------------------ gomme et hauteur de page
test('la gomme n’efface jamais les images ; traits, surligneur et formes oui', () => {
  assert.equal(isErasable(image(0, 0, 10, 10)), false);
  assert.equal(isErasable(pen([[0, 0], [1, 1]])), true);
  assert.equal(isErasable(pen([[0, 0], [1, 1]], { tool: 'highlighter' })), true);
  assert.equal(isErasable(shape('rect', 0, 0, 10, 10)), true);
});

test('la hauteur enregistrée tient compte d’une forme tournée qui dépasse le bas de la feuille', () => {
  // 40 de large sur 10 de haut, centré en (120, 290) : à plat, elle tient sur la première feuille ; d'un quart de
  // tour elle mesure 40 de haut et son bas passe à 310, sur la deuxième feuille
  const upright = shape('rect', 100, 285, 140, 295, { size: 0, angle: Math.PI / 2 });
  assert.equal(fitHeight([upright]), 297, 'sans la boîte tournée, la hauteur est sous-estimée');
  assert.equal(fitHeight([upright], (s) => strokeBBox(s).maxY), 594);
  const flat = shape('rect', 100, 285, 140, 295, { size: 0 });
  assert.equal(fitHeight([flat], (s) => strokeBBox(s).maxY), 297);
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
