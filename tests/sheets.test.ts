import assert from 'node:assert/strict';
import { PAGE_GAP, docH, docW, findSheet, getSheets } from '../src/ink/sheets.ts';
import type { CanvasPage, SheetSource } from '../src/ink/sheets.ts';

const page = (id: string, height: number, width = 210): CanvasPage => ({ id, width, height, paper: 'grid', strokes: [] });
const single = (over: Partial<SheetSource> = {}): SheetSource => ({
  strokes: [],
  paper: 'grid',
  paperColor: 'light',
  pageWidth: 210,
  pageHeight: 297,
  extendable: false,
  background: null,
  ...over,
});

const cases: [string, () => void][] = [
  [
    'page unique : une seule feuille, à sa taille',
    () => {
      const sheets = getSheets(single(), 0);
      assert.equal(sheets.length, 1);
      assert.deepEqual([sheets[0].top, sheets[0].bottom, sheets[0].width], [0, 297, 210]);
      assert.equal(sheets[0].page.id, 'single');
      assert.equal(docH(sheets), 297);
      assert.equal(docW(sheets, 999), 210);
    },
  ],
  [
    'page d’écriture : la hauteur minimale (défilement) l’allonge, jamais une page de PDF',
    () => {
      assert.equal(getSheets(single({ extendable: true }), 800)[0].height, 800);
      assert.equal(getSheets(single({ extendable: true }), 100)[0].height, 297, 'jamais plus courte que sa hauteur enregistrée');
      assert.equal(getSheets(single({ extendable: false }), 800)[0].height, 297);
    },
  ],
  [
    'plusieurs pages : empilées avec l’espace entre feuilles, largeur = la plus large',
    () => {
      const sheets = getSheets(single({ pages: [page('a', 297), page('b', 100, 300), page('c', 50)] }), 0);
      assert.deepEqual(
        sheets.map((s) => [s.id, s.top, s.bottom]),
        [
          ['a', 0, 297],
          ['b', 297 + PAGE_GAP, 297 + PAGE_GAP + 100],
          ['c', 297 + PAGE_GAP + 100 + PAGE_GAP, 297 + PAGE_GAP + 100 + PAGE_GAP + 50],
        ],
      );
      assert.equal(docH(sheets), sheets[2].bottom);
      assert.equal(docW(sheets, 999), 300);
      assert.deepEqual(sheets.map((s) => s.index), [0, 1, 2]);
    },
  ],
  [
    'liste de pages vide : on retombe sur la page unique',
    () => {
      assert.equal(getSheets(single({ pages: [] }), 0)[0].id, 'single');
      assert.equal(docH([]), 0);
      assert.equal(docW([], 123), 123);
    },
  ],
  [
    'findSheet : dans une feuille, dans l’espace entre deux (la plus proche), au-delà des bords',
    () => {
      const sheets = getSheets(single({ pages: [page('a', 100), page('b', 100)] }), 0);
      assert.equal(findSheet(sheets, -50).id, 'a');
      assert.equal(findSheet(sheets, 50).id, 'a');
      assert.equal(findSheet(sheets, 100 + PAGE_GAP / 2 - 1).id, 'a');
      assert.equal(findSheet(sheets, 100 + PAGE_GAP / 2 + 1).id, 'b');
      assert.equal(findSheet(sheets, 150).id, 'b');
      assert.equal(findSheet(sheets, 10_000).id, 'b');
      assert.equal(findSheet(getSheets(single(), 0), 10_000).id, 'single');
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
console.log('\nFeuilles du canevas : tout passe');
