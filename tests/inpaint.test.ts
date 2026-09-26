import assert from 'node:assert/strict';
import { dilate, eraseText, otsu, pullPush } from '../src/ocr/inpaint.ts';

const results: [string, () => void][] = [];
const test = (name: string, fn: () => void) => results.push([name, fn]);

/** Papier en dégradé (jaunissement de gauche à droite), 200 × 60 px */
function paper(w: number, h: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = 250 - (x / w) * 40; // 250 → 210
      d[i] = v;
      d[i + 1] = v - 4;
      d[i + 2] = v - 20;
      d[i + 3] = 255;
    }
  return d;
}
function ink(d: Uint8ClampedArray, w: number, x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]) {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      [d[i], d[i + 1], d[i + 2]] = rgb;
    }
}

test('Otsu sépare l’encre du papier', () => {
  const d = new Uint8ClampedArray(4 * 100);
  for (let i = 0; i < 100; i++) d.fill(i < 20 ? 30 : 230, i * 4, i * 4 + 3);
  const t = otsu(d, Array.from({ length: 100 }, (_, i) => i));
  assert.ok(t > 100 && t < 160, `seuil au milieu : ${t}`);
});

test('dilatation : un pixel devient un carré de côté 2r + 1', () => {
  const m = new Uint8Array(25);
  m[12] = 1;
  const out = dilate(m, 5, 5, 1);
  assert.equal(out.reduce((a, b) => a + b, 0), 9);
  assert.equal(dilate(m, 5, 5, 0).reduce((a, b) => a + b, 0), 1);
});

test('pull-push : un trou dans un dégradé est comblé par le dégradé, les pixels connus ne bougent pas', () => {
  const w = 64;
  const h = 16;
  const rgb = new Float32Array(w * h * 3);
  const known = new Uint8Array(w * h).fill(1);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) rgb.fill(100 + x * 2, (y * w + x) * 3, (y * w + x) * 3 + 3);
  for (let y = 4; y < 12; y++)
    for (let x = 20; x < 40; x++) {
      known[y * w + x] = 0;
      rgb.fill(0, (y * w + x) * 3, (y * w + x) * 3 + 3);
    }
  pullPush(rgb, known, w, h);
  for (let y = 4; y < 12; y++)
    for (let x = 20; x < 40; x++) assert.ok(Math.abs(rgb[(y * w + x) * 3] - (100 + x * 2)) < 12, `pixel ${x},${y} : ${rgb[(y * w + x) * 3]}`);
  assert.equal(rgb[0], 100);
  assert.equal(rgb[(w - 1) * 3], 100 + (w - 1) * 2);
});

test('effacement : l’encre des mots disparaît dans le papier, sans tache ni emprunt à la ligne voisine', () => {
  const w = 200;
  const h = 60;
  const d = paper(w, h);
  const original = d.slice();
  // Deux « lettres » bleu foncé dans le mot, et une ligne voisine (hors du mot) tout près
  ink(d, w, 40, 25, 48, 40, [20, 30, 110]);
  ink(d, w, 55, 25, 60, 40, [20, 30, 110]);
  ink(d, w, 30, 45, 170, 50, [10, 10, 10]);
  const scanned = d.slice();
  const word = { x: 36, y: 22, w: 30, h: 21 };
  const res = eraseText(d, w, h, [word], word, 1);
  assert.ok(res.inkPixels > 150, 'l’encre du mot est trouvée');
  assert.deepEqual(res.ink, [20, 30, 110], 'couleur de l’encre retrouvée');
  let worst = 0;
  for (let y = 0; y < word.h; y++)
    for (let x = 0; x < word.w; x++) {
      const o = (y * word.w + x) * 4;
      const i = ((word.y + y) * w + word.x + x) * 4;
      worst = Math.max(worst, Math.abs(res.pixels[o] - original[i]), Math.abs(res.pixels[o + 2] - original[i + 2]));
      assert.equal(res.pixels[o + 3], 255);
    }
  assert.ok(worst < 10, `écart maximal au papier d’origine : ${worst}`);
  assert.deepEqual(d, scanned, 'le scan lui-même n’est jamais modifié');
});

test('rien à effacer (zone blanche) : la rustine est le scan tel quel', () => {
  const w = 40;
  const h = 20;
  const d = paper(w, h);
  const res = eraseText(d, w, h, [{ x: 5, y: 5, w: 10, h: 10 }], { x: 5, y: 5, w: 10, h: 10 }, 1);
  assert.equal(res.inkPixels, 0, 'le grain ou le dégradé du papier n’est jamais pris pour de l’encre');
  const i = (5 * w + 5) * 4;
  assert.ok(Math.abs(res.pixels[0] - d[i]) < 12);
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
console.log(failed ? `\n${failed} échec(s)` : '\nEffacement : tout passe');
process.exitCode = failed ? 1 : 0;
