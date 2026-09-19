import assert from 'node:assert/strict';
import { contrastOnWhite, printColor, printRgb } from '../src/export/printInk.ts';

const results: [string, () => void][] = [];
const test = (name: string, fn: () => void) => results.push([name, fn]);

const rgbOf = (hex: string): [number, number, number] => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const contrast = (hex: string) => {
  const [r, g, b] = rgbOf(hex);
  return contrastOnWhite(r / 255, g / 255, b / 255);
};

test('blanc → noir', () => {
  assert.equal(printColor('#ffffff'), '#000000');
  assert.equal(printColor('#fff'), '#000000');
});

test('gris clair → gris foncé, jamais du blanc', () => {
  const out = printColor('#d4d4d8');
  assert.ok(contrast(out) >= 3, out);
  assert.ok(rgbOf(out)[0] < 90, out);
});

test('encre déjà foncée : inchangée', () => {
  for (const ink of ['#000000', '#1d2433', '#1f3a8a', '#c0392b', '#1e8449', '#ef4444']) {
    assert.equal(printColor(ink), ink, ink);
  }
});

test('pastels : même teinte, foncés et lisibles sur du blanc', () => {
  const pastel: [string, number][] = [
    ['#93c5fd', 212], // bleu pastel
    ['#fca5a5', 0], // rouge pastel
    ['#86efac', 142], // vert pastel
    ['#d8b4fe', 270], // violet pastel
    ['#facc15', 48], // jaune vif
  ];
  const hueOf = (hex: string) => {
    const [r, g, b] = rgbOf(hex).map((v) => v / 255);
    const max = Math.max(r, g, b);
    const d = max - Math.min(r, g, b);
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
    return h < 0 ? h + 360 : h;
  };
  for (const [hex, hue] of pastel) {
    const out = printColor(hex);
    assert.ok(contrast(out) >= 3, `${hex} → ${out} trop pâle (${contrast(out).toFixed(2)}:1)`);
    const drift = Math.abs(hueOf(out) - hue);
    assert.ok(Math.min(drift, 360 - drift) < 12, `${hex} → ${out} a changé de teinte (${hueOf(out).toFixed(0)}° au lieu de ${hue}°)`);
  }
});

test('toute la palette claire sort avec au moins 3:1 de contraste (balayage de 4 096 couleurs)', () => {
  let worst = Infinity;
  for (let r = 0; r < 256; r += 17) {
    for (let g = 0; g < 256; g += 17) {
      for (let b = 0; b < 256; b += 17) {
        const [pr, pg, pb] = printRgb(r, g, b);
        worst = Math.min(worst, contrastOnWhite(pr / 255, pg / 255, pb / 255));
      }
    }
  }
  assert.ok(worst >= 3 - 0.05, `pire contraste ${worst.toFixed(2)}:1`);
});

test('valeur illisible : rendue telle quelle, sans planter', () => {
  assert.equal(printColor('rgba(255,255,255,0.5)'), 'rgba(255,255,255,0.5)');
  assert.equal(printColor(''), '');
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
