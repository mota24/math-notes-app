import assert from 'node:assert/strict';
import { validateBackup } from '../src/db/backupFormat.ts';

const folder = { id: 'f1', name: 'Terminale', parentId: null, color: '#2456c9', createdAt: 1, updatedAt: 2, deletedAt: null };
const notebook = { id: 'n1', folderId: 'f1', title: 'Suites', color: '#2456c9', paper: 'grid', pageIds: ['p1'], favorite: false, subject: '', openedAt: 1, createdAt: 1, updatedAt: 2, deletedAt: null };
const page = { id: 'p1', notebookId: 'n1', width: 210, height: 297, paper: 'grid', pdf: null, strokes: [], createdAt: 1, updatedAt: 2, deletedAt: null };
const transcript = { pageId: 'p1', notebookId: 'n1', blocks: [], model: 'x', strokeCount: 0, edited: false, createdAt: 1, updatedAt: 2, deletedAt: null };
const fileEntry = { id: 'file1', name: 'td.pdf', type: 'application/pdf', size: 3, data: 'AAA=', createdAt: 1, updatedAt: 2, deletedAt: null };

const full = {
  app: 'notes-maths',
  version: 1,
  createdAt: 123,
  folders: [folder],
  notebooks: [notebook],
  pages: [page],
  transcripts: [transcript],
  files: [fileEntry],
  tombstones: { old: { kind: 'page', deletedAt: 5 } },
};

const cases: [string, () => void][] = [
  [
    'une sauvegarde complète passe telle quelle',
    () => {
      const out = validateBackup(full);
      assert.equal(out.folders.length, 1);
      assert.equal(out.notebooks.length, 1);
      assert.equal(out.pages.length, 1);
      assert.equal(out.transcripts.length, 1);
      assert.equal(out.files.length, 1);
      assert.deepEqual(out.tombstones, { old: { kind: 'page', deletedAt: 5 } });
      assert.equal(out.createdAt, 123);
    },
  ],
  [
    'un fichier d’une autre appli est refusé',
    () => {
      assert.throws(() => validateBackup({ app: 'autre', version: 1 }), /pas une sauvegarde/);
      assert.throws(() => validateBackup('texte'), /pas une sauvegarde/);
      assert.throws(() => validateBackup(null), /pas une sauvegarde/);
    },
  ],
  [
    'une version inconnue est refusée',
    () => {
      assert.throws(() => validateBackup({ app: 'notes-maths', version: 2 }), /Version de sauvegarde inconnue/);
    },
  ],
  [
    'les tableaux absents deviennent vides (fichier tronqué)',
    () => {
      const out = validateBackup({ app: 'notes-maths', version: 1 });
      assert.deepEqual(out.folders, []);
      assert.deepEqual(out.pages, []);
      assert.deepEqual(out.files, []);
      assert.deepEqual(out.tombstones, {});
    },
  ],
  [
    'les éléments mal formés sont écartés, les bons gardés',
    () => {
      const out = validateBackup({
        ...full,
        folders: [folder, { id: 'x' }, null, 'texte', { ...folder, id: '' }, { ...folder, updatedAt: 'hier' }],
        pages: [page, { ...page, strokes: 'pas un tableau' }, { ...page, notebookId: 42 }],
        transcripts: [transcript, { ...transcript, pageId: undefined }],
        files: [fileEntry, { ...fileEntry, data: 12 }],
        tombstones: { ok: { kind: 'folder', deletedAt: 1 }, bad1: { kind: 'martien', deletedAt: 1 }, bad2: { kind: 'page' }, bad3: 'x' },
      });
      assert.equal(out.folders.length, 1);
      assert.equal(out.pages.length, 1);
      assert.equal(out.transcripts.length, 1);
      assert.equal(out.files.length, 1);
      assert.deepEqual(Object.keys(out.tombstones), ['ok']);
    },
  ],
  [
    'un champ inconnu (fichier d’une ancienne version) est ignoré, le reste restauré',
    () => {
      const out = validateBackup({ ...full, ancien: [{ id: 'x' }] });
      assert.equal('ancien' in out, false);
      assert.equal(out.pages.length, 1);
    },
  ],
  [
    'un tableau à la place d’un objet ne passe pas',
    () => {
      assert.throws(() => validateBackup([]), /pas une sauvegarde/);
      const out = validateBackup({ ...full, tombstones: [] });
      assert.deepEqual(out.tombstones, {});
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
console.log('\nFormat de sauvegarde : tout passe');
