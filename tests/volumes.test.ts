import assert from 'node:assert/strict';
import { polyhedronParts, volumeParts } from '../src/ink/volumes.ts';
import type { ShapeKind } from '../src/ink/types.ts';

/** Les nombres d'un chemin « M x,y L x,y … » (sans arcs) : des paires x, y */
const points = (d: string): [number, number][] => {
  const n = (d.match(/-?\d+\.?\d*/g) ?? []).map(Number);
  return Array.from({ length: n.length / 2 }, (_, i) => [n[2 * i], n[2 * i + 1]]);
};

const X0 = 10;
const Y0 = 20;
const W = 44;
const H = 30;
const bounds = (parts: { d: string }[]) => {
  const all = parts.flatMap((p) => points(p.d));
  return {
    minX: Math.min(...all.map((p) => p[0])),
    maxX: Math.max(...all.map((p) => p[0])),
    minY: Math.min(...all.map((p) => p[1])),
    maxY: Math.max(...all.map((p) => p[1])),
  };
};
const near = (a: number, b: number, eps = 0.01) => Math.abs(a - b) <= eps;
const lengthOf = (d: string) => {
  const p = points(d);
  return p.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0);
};

const results: [string, () => void][] = [];
const test = (name: string, fn: () => void) => results.push([name, fn]);

const NEW: ShapeKind[] = ['prism', 'tetrahedron', 'torus', 'ellipsoid'];

test('les 4 nouveaux volumes remplissent exactement leur rectangle, sans en sortir', () => {
  for (const kind of NEW) {
    const b = bounds(volumeParts(kind, X0, Y0, W, H));
    assert.ok(near(b.minX, X0) && near(b.maxX, X0 + W), `${kind} : x ${b.minX}..${b.maxX}`);
    assert.ok(near(b.minY, Y0) && near(b.maxY, Y0 + H), `${kind} : y ${b.minY}..${b.maxY}`);
  }
});

test('prisme triangulaire : 9 arêtes, dont 3 cachées qui se rejoignent au coin arrière-gauche-bas', () => {
  const parts = volumeParts('prism', X0, Y0, W, H);
  assert.equal(parts.length, 9);
  const hidden = parts.filter((p) => p.hidden);
  assert.equal(hidden.length, 3);
  const ends = hidden.flatMap((p) => points(p.d)).map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`);
  const counts = new Map<string, number>();
  for (const e of ends) counts.set(e, (counts.get(e) ?? 0) + 1);
  const corner = [...counts.entries()].filter(([, n]) => n === 3);
  assert.equal(corner.length, 1, 'un seul sommet porte les trois arêtes cachées');
  const [cx, cy] = corner[0][0].split(',').map(Number);
  // Ce sommet est derrière le triangle de face : à droite du bord gauche, au-dessus du bas
  assert.ok(cx > X0 + 1 && cy < Y0 + H - 1, `sommet caché en (${cx}, ${cy})`);
});

test('prisme : les arêtes de la face avant sont visibles, y compris la base', () => {
  const parts = volumeParts('prism', X0, Y0, W, H);
  const visible = parts.filter((p) => !p.hidden).map((p) => points(p.d));
  // la base avant part du coin bas-gauche du rectangle
  assert.ok(visible.some((e) => near(e[0][0], X0) && near(e[0][1], Y0 + H) || near(e[1][0], X0) && near(e[1][1], Y0 + H)));
  assert.equal(visible.length, 6);
});

test('tétraèdre : 6 arêtes, une seule cachée : la base gauche-arrière, du coin avant-gauche au sommet le plus à droite', () => {
  const parts = volumeParts('tetrahedron', X0, Y0, W, H);
  assert.equal(parts.length, 6);
  const hidden = parts.filter((p) => p.hidden);
  assert.equal(hidden.length, 1);
  const [a, b] = points(hidden[0].d);
  assert.ok(near(a[0], X0) && near(a[1], Y0 + H), `départ (${a})`);
  assert.ok(near(b[0], X0 + W), `arrivée (${b})`);
  assert.ok(b[1] < Y0 + H - 1, 'le sommet arrière est au-dessus de la base avant');
});

test('polyèdre générique : un cube en cavalière cache 3 arêtes sur 12, comme le pavé droit', () => {
  const cube: [number, number, number][] = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
    [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
  ];
  const faces = [
    [0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [3, 2, 6, 7], [0, 3, 7, 4], [1, 2, 6, 5],
  ];
  const parts = polyhedronParts(cube, faces, 0.35, 0.32, X0, Y0, W, H);
  assert.equal(parts.length, 12);
  assert.equal(parts.filter((p) => p.hidden).length, 3);
});

test('tore : contours et équateur, avec une partie cachée derrière le tube (en tirets) et le reste visible', () => {
  const parts = volumeParts('torus', X0, Y0, W, H);
  const hidden = parts.filter((p) => p.hidden);
  const visible = parts.filter((p) => !p.hidden);
  assert.ok(hidden.length >= 1 && visible.length >= 2, `${visible.length} visibles, ${hidden.length} cachés`);
  const total = parts.reduce((s, p) => s + lengthOf(p.d), 0);
  const hiddenLength = hidden.reduce((s, p) => s + lengthOf(p.d), 0);
  const share = hiddenLength / total;
  assert.ok(share > 0.1 && share < 0.45, `part cachée ${(share * 100).toFixed(0)} %`);
  // un tracé visible fait tout le tour extérieur : il touche les quatre côtés du rectangle
  const outer = visible.map((p) => bounds([p])).find((b) => near(b.minX, X0) && near(b.maxX, X0 + W) && near(b.minY, Y0) && near(b.maxY, Y0 + H));
  assert.ok(outer, 'le contour extérieur est visible et pleine largeur');
});

test('tore : dessin symétrique gauche/droite (la vue est de face)', () => {
  const parts = volumeParts('torus', 0, 0, 100, 60);
  const all = parts.flatMap((p) => points(p.d));
  const left = all.filter(([x]) => x < 50).length;
  const right = all.filter(([x]) => x > 50).length;
  assert.ok(Math.abs(left - right) <= 8, `${left} points à gauche, ${right} à droite`);
});

test('ellipsoïde : contour visible, équateur et méridien avec leur moitié arrière cachée', () => {
  const parts = volumeParts('ellipsoid', X0, Y0, W, H);
  const hidden = parts.filter((p) => p.hidden);
  assert.ok(hidden.length >= 2, `${hidden.length} parties cachées`);
  assert.ok(parts.filter((p) => !p.hidden).length >= 3);
  const share = hidden.reduce((s, p) => s + lengthOf(p.d), 0) / parts.reduce((s, p) => s + lengthOf(p.d), 0);
  assert.ok(share > 0.15 && share < 0.45, `part cachée ${(share * 100).toFixed(0)} %`);
});

test('mise à l’échelle : doubler le rectangle double toutes les coordonnées (tore, ellipsoïde)', () => {
  for (const kind of ['torus', 'ellipsoid'] as const) {
    const small = volumeParts(kind, 0, 0, 20, 10).map((p) => p.d);
    const big = volumeParts(kind, 0, 0, 40, 20).map((p) => p.d);
    assert.equal(small.length, big.length);
    small.forEach((d, i) => {
      const a = points(d);
      const b = points(big[i]);
      assert.equal(a.length, b.length);
      a.forEach(([x, y], j) => assert.ok(near(b[j][0], x * 2, 0.01) && near(b[j][1], y * 2, 0.01), `${kind} ${i}/${j}`));
    });
  }
});

test('résultat stable d’un appel à l’autre (calcul mis en cache)', () => {
  for (const kind of NEW) {
    assert.deepEqual(volumeParts(kind, 1, 2, 30, 20), volumeParts(kind, 1, 2, 30, 20));
  }
});

test('rectangle très plat ou très étroit : pas de valeur invalide', () => {
  for (const kind of NEW) {
    for (const [w, h] of [[60, 2], [2, 60], [0.5, 0.5]]) {
      for (const p of volumeParts(kind, 0, 0, w, h)) assert.ok(!/NaN|Infinity/.test(p.d), `${kind} ${w}x${h}`);
    }
  }
});

test('les six volumes d’origine n’ont pas bougé : nombre de tracés et de tracés cachés', () => {
  const expected: [ShapeKind, number, number][] = [
    ['cylinder', 5, 1],
    ['cone', 4, 1],
    ['sphere', 3, 1],
    ['hemisphere', 3, 1],
    ['pyramid', 8, 3],
    ['cuboid', 12, 3],
  ];
  for (const [kind, total, hidden] of expected) {
    const parts = volumeParts(kind, 0, 0, 40, 30);
    assert.equal(parts.length, total, `${kind} : tracés`);
    assert.equal(parts.filter((p) => p.hidden).length, hidden, `${kind} : cachés`);
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
