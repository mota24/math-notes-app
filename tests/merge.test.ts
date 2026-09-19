import assert from 'node:assert/strict';
import { mergeRecords, mergeTombstones } from '../src/sync/merge.ts';

const v = (updatedAt: number, deletedAt: number | null = null) => ({ updatedAt, deletedAt });

const cases: [string, () => void][] = [
  [
    'la version la plus récente gagne dans les deux sens',
    () => {
      const plan = mergeRecords({ a: v(20), b: v(10), c: v(5) }, { a: v(10), b: v(30), c: v(5) }, {});
      assert.deepEqual(plan.push, ['a']);
      assert.deepEqual(plan.pull, ['b']);
      assert.equal(plan.merged.a.updatedAt, 20);
      assert.equal(plan.merged.b.updatedAt, 30);
      assert.equal(plan.merged.c.updatedAt, 5);
    },
  ],
  [
    'présent d’un seul côté',
    () => {
      const plan = mergeRecords({ local: v(1) }, { remote: v(1) }, {});
      assert.deepEqual(plan.push, ['local']);
      assert.deepEqual(plan.pull, ['remote']);
    },
  ],
  [
    'mise à la corbeille plus récente propagée',
    () => {
      const plan = mergeRecords({ a: v(10) }, { a: v(50, 50) }, {});
      assert.deepEqual(plan.pull, ['a']);
      assert.equal(plan.merged.a.deletedAt, 50);
    },
  ],
  [
    'suppression définitive : effacée en local et retirée de l’index',
    () => {
      const plan = mergeRecords({ a: v(10), b: v(10) }, { a: v(10) }, { 'page:a': { deletedAt: 99 } }, (id) => `page:${id}`);
      assert.deepEqual(plan.purge, ['a']);
      assert.equal(plan.merged.a, undefined);
      assert.ok(plan.merged.b);
    },
  ],
  [
    'pierres tombales : union, la plus récente, oubli après 90 jours',
    () => {
      const now = 200 * 24 * 3600 * 1000;
      const old = now - 100 * 24 * 3600 * 1000;
      const out = mergeTombstones({ a: { deletedAt: now - 5 }, b: { deletedAt: old } }, { a: { deletedAt: now - 1 }, c: { deletedAt: now } }, now);
      assert.deepEqual(Object.keys(out).sort(), ['a', 'c']);
      assert.equal(out.a.deletedAt, now - 1);
    },
  ],
];

let failed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    console.log('OK  ', name);
  } catch (e) {
    failed++;
    console.log('FAIL', name, '\n     ', (e as Error).message);
  }
}
console.log(failed ? `\n${failed} échec(s)` : '\nFusion de synchronisation : tout passe');
process.exitCode = failed ? 1 : 0;
