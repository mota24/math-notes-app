import assert from 'node:assert/strict';
import { SHARE_ID_RE, bgKey, newShareId, planShare, toSharedPage } from '../src/share/plan.ts';
import type { Page } from '../src/db/schema.ts';

const page = (id: string, updatedAt: number, extra: Partial<Page> = {}): Page => ({
  id,
  notebookId: 'nb',
  width: 210,
  height: 297,
  paper: 'grid',
  pdf: null,
  strokes: [],
  createdAt: 1,
  updatedAt,
  deletedAt: null,
  ...extra,
});

const cases: [string, () => void][] = [
  [
    'identifiant de lien : 22 caractères alphanumériques, reconnu par SHARE_ID_RE, jamais deux fois le même',
    () => {
      const ids = new Set(Array.from({ length: 200 }, () => newShareId()));
      assert.equal(ids.size, 200);
      for (const id of ids) {
        assert.equal(id.length, 22);
        assert.match(id, SHARE_ID_RE);
      }
      assert.equal(SHARE_ID_RE.test('../etc'), false);
      assert.equal(SHARE_ID_RE.test('court'), false);
    },
  ],
  [
    'identifiant de lien : les octets ≥ 248 sont rejetés (aucun caractère favorisé)',
    () => {
      // 255 et 250 doivent être ignorés ; 0 → « A », 61 → « 9 », 62 → « A »
      const id = newShareId(() => Uint8Array.from([255, 0, 250, 61, 62, ...Array.from({ length: 27 }, () => 1)]));
      assert.equal(id.slice(0, 3), 'A9A');
      assert.equal(id.length, 22);
    },
  ],
  [
    'clé de fond : PDF (fichier + page), photo, ou rien',
    () => {
      assert.equal(bgKey({ pdf: { fileId: 'f', pageIndex: 3 }, image: null }), 'pdf:f:3');
      assert.equal(bgKey({ pdf: null, image: { fileId: 'ph' } }), 'photo:ph');
      assert.equal(bgKey({ pdf: null }), null);
    },
  ],
  [
    'premier partage : toutes les pages et tous les fonds partent',
    () => {
      const pages = [page('a', 5), page('b', 6, { pdf: { fileId: 'f', pageIndex: 0 } })];
      const plan = planShare(pages, null);
      assert.deepEqual(plan.pages.map((p) => p.id), ['a', 'b']);
      assert.deepEqual(plan.bgs.map((p) => p.id), ['b']);
      assert.deepEqual(plan.removed, []);
      assert.deepEqual(plan.bgRemoved, []);
    },
  ],
  [
    'mise à jour : seule la page modifiée repart, un fond déjà envoyé ne repart pas',
    () => {
      const pages = [page('a', 5), page('b', 9, { pdf: { fileId: 'f', pageIndex: 0 } })];
      const plan = planShare(pages, { pageIds: ['a', 'b'], versions: { a: 5, b: 6 }, bgKeys: { b: 'pdf:f:0' } });
      assert.deepEqual(plan.pages.map((p) => p.id), ['b']);
      assert.deepEqual(plan.bgs, []);
    },
  ],
  [
    'mise à jour : page supprimée du cahier, fond remplacé ou retiré',
    () => {
      const pages = [page('a', 5, { image: { fileId: 'ph2' } }), page('c', 7)];
      const plan = planShare(pages, { pageIds: ['a', 'b', 'c'], versions: { a: 5, b: 6, c: 7 }, bgKeys: { a: 'photo:ph1', c: 'pdf:x:1' } });
      assert.deepEqual(plan.pages, []);
      assert.deepEqual(plan.bgs.map((p) => p.id), ['a']);
      assert.deepEqual(plan.removed, ['b']);
      assert.deepEqual(plan.bgRemoved, ['c']);
    },
  ],
  [
    'page partagée : rien de local (fichier, cahier, dates), seulement de quoi la dessiner',
    () => {
      const shared = toSharedPage(page('a', 5, { pdf: { fileId: 'secret-file', pageIndex: 2 }, paperColor: 'dark' }));
      assert.deepEqual(Object.keys(shared).sort(), ['bg', 'height', 'id', 'paper', 'paperColor', 'strokes', 'width']);
      assert.equal(shared.bg, true);
      assert.equal(JSON.stringify(shared).includes('secret-file'), false);
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
console.log(failed ? `\n${failed} échec(s)` : '\nPartage : tout passe');
if (failed) process.exit(1);
