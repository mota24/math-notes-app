import assert from 'node:assert/strict';
import { recognizeShape, regularizeShape } from '../src/ink/shapeRecognize.ts';
import type { InkPoint } from '../src/ink/types.ts';

function rng(seed: number) {
  let x = seed % 2147483647 || 1;
  return () => {
    x = (x * 16807) % 2147483647;
    return x / 2147483647;
  };
}

/** Cercle à main levée : n points autour du centre, rayon et angle légèrement bruités, refermé. */
function drawCircle(cx: number, cy: number, r: number, seed: number, noise = 0.06): InkPoint[] {
  const rnd = rng(seed);
  const n = 40;
  const pts: InkPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (1 + (rnd() - 0.5) * noise);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 0.5]);
  }
  return pts;
}

/** Rectangle à main levée : les 4 côtés, densément échantillonnés, légèrement bruités. */
function drawRect(x0: number, y0: number, w: number, h: number, seed: number, noise = 0.4): InkPoint[] {
  const rnd = rng(seed);
  const corners: [number, number][] = [
    [x0, y0],
    [x0 + w, y0],
    [x0 + w, y0 + h],
    [x0, y0 + h],
    [x0, y0],
  ];
  const pts: InkPoint[] = [];
  for (let i = 0; i < corners.length - 1; i++) {
    const [ax, ay] = corners[i];
    const [bx, by] = corners[i + 1];
    const steps = 12;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      pts.push([ax + (bx - ax) * t + (rnd() - 0.5) * noise, ay + (by - ay) * t + (rnd() - 0.5) * noise, 0.5]);
    }
  }
  return pts;
}

/** Triangle à main levée : 3 côtés, légèrement bruités. */
function drawTriangle(x0: number, y0: number, w: number, h: number, seed: number, noise = 0.4): InkPoint[] {
  const rnd = rng(seed);
  const corners: [number, number][] = [
    [x0 + w / 2, y0],
    [x0 + w, y0 + h],
    [x0, y0 + h],
    [x0 + w / 2, y0],
  ];
  const pts: InkPoint[] = [];
  for (let i = 0; i < corners.length - 1; i++) {
    const [ax, ay] = corners[i];
    const [bx, by] = corners[i + 1];
    const steps = 14;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      pts.push([ax + (bx - ax) * t + (rnd() - 0.5) * noise, ay + (by - ay) * t + (rnd() - 0.5) * noise, 0.5]);
    }
  }
  return pts;
}

/** Ligne à main levée entre deux points, légèrement tremblée. */
function drawLine(x0: number, y0: number, x1: number, y1: number, seed: number, noise = 0.3): InkPoint[] {
  const rnd = rng(seed);
  const steps = 30;
  const pts: InkPoint[] = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    pts.push([x0 + (x1 - x0) * t + (rnd() - 0.5) * noise, y0 + (y1 - y0) * t + (rnd() - 0.5) * noise, 0.5]);
  }
  return pts;
}

/**
 * Flèche à main levée, en un seul geste continu : la hampe droite jusqu'à la pointe, puis un repli
 * net qui dessine une aile de la tête (le geste naturel pour esquisser une flèche sans lever le stylet).
 */
function drawArrow(x0: number, y0: number, x1: number, y1: number, seed: number, noise = 0.3): InkPoint[] {
  const rnd = rng(seed);
  const pts: InkPoint[] = [];
  const steps = 24;
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    pts.push([x0 + (x1 - x0) * t + (rnd() - 0.5) * noise, y0 + (y1 - y0) * t + (rnd() - 0.5) * noise, 0.5]);
  }
  const angle = Math.atan2(y1 - y0, x1 - x0);
  const headLen = Math.hypot(x1 - x0, y1 - y0) * 0.28;
  const wingAngle = angle + Math.PI - 0.5;
  const wx = x1 + Math.cos(wingAngle) * headLen;
  const wy = y1 + Math.sin(wingAngle) * headLen;
  const backSteps = 10;
  for (let k = 1; k <= backSteps; k++) {
    const t = k / backSteps;
    pts.push([x1 + (wx - x1) * t + (rnd() - 0.5) * noise, y1 + (wy - y1) * t + (rnd() - 0.5) * noise, 0.5]);
  }
  return pts;
}

/** Gribouillis aléatoire (ne doit rien reconnaître). */
function drawScribble(seed: number): InkPoint[] {
  const rnd = rng(seed);
  const pts: InkPoint[] = [[100, 100, 0.5]];
  let x = 100;
  let y = 100;
  for (let i = 0; i < 25; i++) {
    x += (rnd() - 0.5) * 12;
    y += (rnd() - 0.5) * 12;
    pts.push([x, y, 0.5]);
  }
  return pts;
}

const results: [string, () => void][] = [];
const test = (name: string, fn: () => void) => results.push([name, fn]);

test('cercle net reconnu, sur plusieurs tailles et bruits', () => {
  for (let i = 0; i < 15; i++) {
    const seed = 100 + i;
    const r = 8 + (seed % 20);
    assert.equal(recognizeShape(drawCircle(50, 50, r, seed)), 'circle', `essai ${i}, rayon ${r}`);
  }
});

test('rectangle net reconnu, sur plusieurs formats', () => {
  for (let i = 0; i < 15; i++) {
    const seed = 200 + i;
    const w = 20 + (seed % 25);
    const h = 15 + ((seed * 3) % 20);
    assert.equal(recognizeShape(drawRect(10, 10, w, h, seed)), 'rect', `essai ${i}, ${w}x${h}`);
  }
});

test('triangle net reconnu, sur plusieurs formats', () => {
  for (let i = 0; i < 15; i++) {
    const seed = 300 + i;
    const w = 20 + (seed % 25);
    const h = 18 + ((seed * 3) % 22);
    assert.equal(recognizeShape(drawTriangle(10, 10, w, h, seed)), 'triangle', `essai ${i}, ${w}x${h}`);
  }
});

test('trait droit reconnu comme ligne, dans toutes les directions (jamais une flèche sans pointe)', () => {
  const cases: [number, number][] = [
    [60, 0],
    [0, 60],
    [42, 42],
    [-50, 20],
    [30, -45],
    [-40, -40],
  ];
  for (const [dx, dy] of cases) {
    const shape = recognizeShape(drawLine(100, 100, 100 + dx, 100 + dy, dx * 7 + dy * 13));
    assert.equal(shape, 'line', `dx=${dx} dy=${dy}`);
  }
});

test('flèche reconnue seulement si une pointe est dessinée (repli net en fin de trait)', () => {
  const cases: [number, number][] = [
    [70, 0],
    [0, 70],
    [50, 50],
    [-60, 25],
    [35, -55],
  ];
  for (const [dx, dy] of cases) {
    const shape = recognizeShape(drawArrow(100, 100, 100 + dx, 100 + dy, dx * 11 + dy * 17 + 3));
    assert.equal(shape, 'arrow', `dx=${dx} dy=${dy}`);
  }
});

test('un point ou un tout petit trait : rien reconnu', () => {
  assert.equal(recognizeShape([[10, 10, 0.5]]), null);
  assert.equal(recognizeShape(drawLine(10, 10, 12, 11, 1)), null, 'trop court pour être une ligne');
  assert.equal(recognizeShape(drawCircle(10, 10, 2, 1)), null, 'trop petit pour être un cercle');
});

test('gribouillis aléatoire : rien reconnu', () => {
  for (let i = 0; i < 10; i++) {
    assert.equal(recognizeShape(drawScribble(500 + i)), null, `essai ${i}`);
  }
});

test('un rectangle très fin (presque un trait) reste une ligne, pas un rectangle', () => {
  // Rectangle aplati : la logique « presque droit » doit l'emporter avant le test de bouclage
  const shape = recognizeShape(drawLine(20, 50, 120, 52, 42));
  assert.equal(shape, 'line');
});

test('un carré presque parfait reste un rectangle, pas un cercle', () => {
  for (let i = 0; i < 8; i++) {
    const seed = 700 + i;
    const s = 18 + (seed % 10);
    assert.equal(recognizeShape(drawRect(10, 10, s, s, seed)), 'rect', `essai ${i}, côté ${s}`);
  }
});

test('régularisation : une ellipse presque ronde devient un cercle, un rectangle presque carré un carré', () => {
  const far = regularizeShape('circle', [10, 10, 0.5], [50, 46, 0.5]);
  assert.equal(far[0] - 10, far[1] - 10, 'largeur = hauteur');
  assert.equal(far[0] - 10, 38);
  // Tiré vers le haut à gauche : le coin fixe reste fixe, le sens est gardé
  const up = regularizeShape('rect', [100, 100, 0.5], [62, 64, 0.5]);
  assert.deepEqual([up[0], up[1]], [63, 63]);
});

test('régularisation : une forme franchement allongée reste telle quelle', () => {
  assert.deepEqual(regularizeShape('rect', [0, 0, 0.5], [60, 30, 0.5]), [60, 30, 0.5]);
  assert.deepEqual(regularizeShape('circle', [0, 0, 0.5], [40, 25, 0.5]), [40, 25, 0.5]);
  assert.deepEqual(regularizeShape('triangle', [0, 0, 0.5], [40, 38, 0.5]), [40, 38, 0.5]);
});

test('régularisation : ligne presque horizontale, verticale ou à 45° alignée, longueur gardée', () => {
  const h = regularizeShape('line', [0, 0, 0.5], [80, 5, 0.5]); // ~3,6°
  assert.ok(Math.abs(h[1]) < 1e-9, 'horizontale');
  assert.ok(Math.abs(h[0] - Math.hypot(80, 5)) < 1e-9, 'même longueur');
  const v = regularizeShape('arrow', [0, 0, 0.5], [-4, -60, 0.5]);
  assert.ok(Math.abs(v[0]) < 1e-9 && v[1] < 0, 'verticale vers le haut');
  const d = regularizeShape('line', [0, 0, 0.5], [50, 54, 0.5]);
  assert.ok(Math.abs(d[0] - d[1]) < 1e-9, 'diagonale à 45°');
  assert.deepEqual(regularizeShape('line', [0, 0, 0.5], [50, 20, 0.5]), [50, 20, 0.5], 'une pente de 22° reste une pente');
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
