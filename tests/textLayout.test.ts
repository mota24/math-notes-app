import assert from 'node:assert/strict';
import { TEXT_LINE_HEIGHT, textBoxHeight, textInnerWidth, textPadding, wrapText } from '../src/ink/textLayout.ts';
import { isErasable, strokeBBox, strokeHit, strokesInLasso, transformStroke } from '../src/ink/geometry.ts';
import type { Stroke } from '../src/ink/types.ts';

const box = (extra: Partial<Stroke> = {}): Stroke => ({
  id: 't1',
  tool: 'text',
  text: 'Théorème de Rolle',
  points: [
    [20, 30, 0.5],
    [110, 40, 0.5],
  ],
  color: '#1d2433',
  size: 5,
  input: 'mouse',
  ...extra,
});

/** Mesure factice : un caractère = une unité */
const chars = (s: string) => s.length;

const cases: [string, () => void][] = [
  [
    'retour à la ligne par mots entiers, sans espace en début de ligne',
    () => {
      assert.deepEqual(wrapText('le théorème de Rolle est vrai', 12, chars), ['le théorème', 'de Rolle est', 'vrai']);
    },
  ],
  [
    'les retours à la ligne tapés sont respectés, une ligne vide reste une ligne',
    () => {
      assert.deepEqual(wrapText('Hypothèses :\n\nf continue', 40, chars), ['Hypothèses :', '', 'f continue']);
      assert.deepEqual(wrapText('', 10, chars), ['']);
    },
  ],
  [
    'un mot plus long que la ligne est coupé au lieu de déborder',
    () => {
      const lines = wrapText('anticonstitutionnellement ok', 10, chars);
      assert.ok(lines.every((l) => l.length <= 10), JSON.stringify(lines));
      assert.equal(lines.join('').replace(/\s/g, ''), 'anticonstitutionnellementok');
    },
  ],
  [
    'tout le texte est conservé, dans l’ordre (aucun caractère perdu)',
    () => {
      const text = 'f(x) = x² + 2x + 1 donc f′(x) = 2x + 2 ; f′ s’annule en x = −1.';
      for (const w of [5, 8, 13, 21, 80]) {
        const lines = wrapText(text, w, chars);
        assert.equal(lines.join('').replace(/\s/g, ''), text.replace(/\s/g, ''), `largeur ${w}`);
        assert.ok(lines.every((l) => l.length <= w || !l.includes(' ')), `aucune ligne trop longue à la largeur ${w}`);
      }
    },
  ],
  [
    'hauteur : lignes × interligne + marges ; largeur utile : boîte moins les marges',
    () => {
      assert.equal(textBoxHeight(3, 5), 3 * 5 * TEXT_LINE_HEIGHT + 2 * textPadding(5));
      assert.equal(textBoxHeight(0, 5), textBoxHeight(1, 5), 'une zone vide garde la hauteur d’une ligne');
      assert.equal(textInnerWidth(90, 5), 90 - 2 * textPadding(5));
      assert.equal(textInnerWidth(1, 5), 5, 'jamais plus étroite qu’un caractère');
    },
  ],
  [
    'géométrie : la boîte est exactement la zone (la taille du texte n’ajoute pas de marge), on la touche partout dedans',
    () => {
      assert.deepEqual(strokeBBox(box()), { minX: 20, minY: 30, maxX: 110, maxY: 40 });
      assert.equal(strokeHit(box(), 60, 35, 0.5), true, 'un tap au milieu du texte la reprend');
      assert.equal(strokeHit(box(), 60, 50, 0.5), false);
    },
  ],
  [
    'géométrie : sélectionnée au lasso, jamais effacée à la gomme',
    () => {
      assert.deepEqual(strokesInLasso([box()], [[10, 20], [120, 20], [120, 50], [10, 50]]), ['t1']);
      assert.equal(isErasable(box()), false);
    },
  ],
  [
    'géométrie : agrandie par un coin, la zone grossit ET son texte aussi ; tournée, elle garde sa taille',
    () => {
      const big = transformStroke(box(), { k: 2, theta: 0, px: 20, py: 30 });
      assert.equal(big.size, 10);
      assert.deepEqual(strokeBBox(big), { minX: 20, minY: 30, maxX: 200, maxY: 50 });
      const turned = transformStroke(box(), { k: 1, theta: Math.PI / 2, px: 65, py: 35 });
      assert.equal(turned.size, 5);
      assert.ok(Math.abs((turned.angle ?? 0) - Math.PI / 2) < 1e-9, 'la rotation est portée par l’angle');
    },
  ],
];

let failed = 0;
for (const [name, run] of cases) {
  try {
    run();
    console.log(`OK   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${(e as Error).message}`);
  }
}
console.log(failed ? `\n${failed} échec(s)` : '\nZones de texte : tout passe');
if (failed) process.exit(1);
