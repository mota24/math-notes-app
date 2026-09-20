import assert from 'node:assert/strict';
import { applyAction, invertAction, splitStrokes } from '../src/ink/history.ts';
import type { Action } from '../src/ink/history.ts';
import type { Stroke } from '../src/ink/types.ts';

const stroke = (id: string, x = 0): Stroke => ({ id, tool: 'pen', color: '#000', size: 1, points: [[x, 0, 0.5], [x + 1, 1, 0.5]] }) as Stroke;
const ids = (list: Stroke[]) => list.map((s) => s.id).join('');

const cases: [string, () => void][] = [
  [
    'splitStrokes garde la position de chaque trait retiré',
    () => {
      const { items, kept } = splitStrokes([stroke('a'), stroke('b'), stroke('c'), stroke('d')], new Set(['b', 'd']));
      assert.equal(ids(kept), 'ac');
      assert.deepEqual(items.map((i) => [i.stroke.id, i.index]), [['b', 1], ['d', 3]]);
    },
  ],
  [
    'ajouter puis annuler redonne exactement la liste de départ',
    () => {
      const start = [stroke('a'), stroke('b')];
      const a: Action = { type: 'add', strokes: [stroke('c'), stroke('d')] };
      const after = applyAction(start, a);
      assert.equal(ids(after), 'abcd');
      assert.equal(ids(invertAction(after, a)), 'ab');
      assert.equal(ids(applyAction(invertAction(after, a), a)), 'abcd', 'rétablir');
    },
  ],
  [
    'effacer au milieu puis annuler remet les traits à leur place, dans l’ordre',
    () => {
      const start = [stroke('a'), stroke('b'), stroke('c'), stroke('d'), stroke('e')];
      const { items } = splitStrokes(start, new Set(['b', 'd']));
      const a: Action = { type: 'remove', items };
      const after = applyAction(start, a);
      assert.equal(ids(after), 'ace');
      assert.equal(ids(invertAction(after, a)), 'abcde');
      // l'ordre des items ne compte pas
      const shuffled: Action = { type: 'remove', items: [...items].reverse() };
      assert.equal(ids(invertAction(after, shuffled)), 'abcde');
    },
  ],
  [
    'annuler un effacement sur une liste devenue plus courte n’explose pas',
    () => {
      const start = [stroke('a'), stroke('b'), stroke('c')];
      const { items } = splitStrokes(start, new Set(['c']));
      const a: Action = { type: 'remove', items };
      assert.equal(ids(invertAction([], a)), 'c');
    },
  ],
  [
    'replace : avant / après',
    () => {
      const before = [stroke('a', 0)];
      const after = [stroke('a', 5)];
      const a: Action = { type: 'replace', before, after };
      assert.equal(applyAction(before, a), after);
      assert.equal(invertAction(after, a), before);
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
if (failed) {
  console.log(`\n${failed} scénario(s) en échec`);
  process.exit(1);
}
console.log('\nAnnuler / rétablir : tout passe');
