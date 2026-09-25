import assert from 'node:assert/strict';
import { parseHash, routeHash } from '../src/router.ts';
import type { Route } from '../src/router.ts';

const cases: [string, () => void][] = [
  [
    'adresses → routes',
    () => {
      assert.deepEqual(parseHash(''), { name: 'library', folderId: null });
      assert.deepEqual(parseHash('#/'), { name: 'library', folderId: null });
      assert.deepEqual(parseHash('#/dossier/abc'), { name: 'library', folderId: 'abc' });
      assert.deepEqual(parseHash('#/corbeille'), { name: 'trash' });
      assert.deepEqual(parseHash('#/cahier/n1/3'), { name: 'notebook', notebookId: 'n1', pageIndex: 2 });
      assert.deepEqual(parseHash('#/cahier/n1'), { name: 'notebook', notebookId: 'n1', pageIndex: 0 });
      assert.deepEqual(parseHash('#/ecriture'), { name: 'handwriting' });
      assert.deepEqual(parseHash('#/imprimer/n1'), { name: 'print', notebookId: 'n1', pageIndex: null });
      assert.deepEqual(parseHash('#/imprimer/n1/2'), { name: 'print', notebookId: 'n1', pageIndex: 1 });
      assert.deepEqual(parseHash('#/inconnu/x'), { name: 'library', folderId: null });
    },
  ],
  [
    'numéros de page farfelus → jamais négatifs',
    () => {
      assert.equal(parseHash('#/cahier/n1/0').pageIndex, 0);
      assert.equal(parseHash('#/cahier/n1/-5').pageIndex, 0);
      assert.equal(parseHash('#/cahier/n1/abc').pageIndex, 0);
      assert.equal(parseHash('#/imprimer/n1/0').pageIndex, 0);
    },
  ],
  [
    'aller-retour route → adresse → route, identifiants avec caractères spéciaux compris',
    () => {
      const routes: Route[] = [
        { name: 'library', folderId: null },
        { name: 'library', folderId: 'dossier/avec espace #1' },
        { name: 'trash' },
        { name: 'notebook', notebookId: 'id%20?x', pageIndex: 4 },
        { name: 'handwriting' },
        { name: 'print', notebookId: 'n', pageIndex: null },
        { name: 'print', notebookId: 'n', pageIndex: 0 },
      ];
      for (const r of routes) assert.deepEqual(parseHash(routeHash(r)), r);
    },
  ],
  [
    'adresse mal encodée : pas d’exception (écran blanc), le segment est gardé tel quel',
    () => {
      assert.deepEqual(parseHash('#/cahier/%E0%A4%A/2'), { name: 'notebook', notebookId: '%E0%A4%A', pageIndex: 1 });
      assert.deepEqual(parseHash('#/dossier/%'), { name: 'library', folderId: '%' });
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
console.log('\nNavigation : tout passe');
