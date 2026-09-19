import assert from 'node:assert/strict';
import { buildFolderTree, countChildren, countLabel, folderPath, paperPreview, viewTitle, visibleNodes } from '../src/components/libraryModel.ts';
import type { Folder, Notebook } from '../src/db/schema.ts';

let n = 0;
const folder = (name: string, parentId: string | null = null, extra: Partial<Folder> = {}): Folder => ({
  id: `f${n++}`,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
  name,
  parentId,
  color: '#2456c9',
  ...extra,
});
const notebook = (folderId: string | null, extra: Partial<Notebook> = {}): Notebook => ({
  id: `n${n++}`,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
  folderId,
  title: 'Cahier',
  color: '#2456c9',
  paper: 'grid',
  pageIds: [],
  favorite: false,
  subject: '',
  openedAt: 0,
  ...extra,
});

const results: [string, () => void][] = [];
const test = (name: string, fn: () => void) => results.push([name, fn]);
const names = (nodes: { folder: Folder }[]) => nodes.map((x) => x.folder.name);

test('arbre des dossiers : racines, sous-dossiers, profondeur', () => {
  const s1 = folder('Semestre 1');
  const analyse = folder('Analyse', s1.id);
  const algebre = folder('Algèbre', s1.id);
  const s2 = folder('Semestre 2');
  const tree = buildFolderTree([analyse, s2, algebre, s1]);
  assert.deepEqual(names(tree), ['Semestre 1', 'Semestre 2']);
  assert.deepEqual(names(tree[0].children), ['Algèbre', 'Analyse']);
  assert.equal(tree[0].depth, 0);
  assert.equal(tree[0].children[0].depth, 1);
  assert.deepEqual(tree[1].children, []);
});

test('tri par nom à la française : les accents ne rejettent pas un dossier en fin de liste', () => {
  const tree = buildFolderTree([folder('Zoologie'), folder('Électronique'), folder('Algèbre'), folder('electro'), folder('Chimie')]);
  assert.deepEqual(names(tree), ['Algèbre', 'Chimie', 'electro', 'Électronique', 'Zoologie']);
});

test('un dossier à la corbeille disparaît de l’arbre, avec tout ce qu’il contient', () => {
  const gone = folder('Vieux', null, { deletedAt: 5 });
  const inside = folder('Dedans', gone.id);
  const keep = folder('Garde');
  const tree = buildFolderTree([gone, inside, keep]);
  assert.deepEqual(names(tree), ['Garde']);
});

test('données abîmées : un dossier qui est son propre parent, ou un cycle, ne fait pas boucler', () => {
  const a = folder('A');
  const b = folder('B', a.id);
  const loopA = { ...a, parentId: b.id };
  const self = folder('Soi');
  const tree = buildFolderTree([loopA, b, { ...self, parentId: self.id }, folder('Racine')]);
  assert.deepEqual(names(tree), ['Racine']);
});

test('dossiers visibles : un niveau ne s’ouvre que s’il est déplié', () => {
  const s1 = folder('Semestre 1');
  const analyse = folder('Analyse', s1.id);
  const series = folder('Séries', analyse.id);
  const tree = buildFolderTree([s1, analyse, series]);
  assert.deepEqual(names(visibleNodes(tree, new Set())), ['Semestre 1']);
  assert.deepEqual(names(visibleNodes(tree, new Set([s1.id]))), ['Semestre 1', 'Analyse']);
  assert.deepEqual(names(visibleNodes(tree, new Set([s1.id, analyse.id]))), ['Semestre 1', 'Analyse', 'Séries']);
  // un niveau profond déplié dont le parent est replié reste caché
  assert.deepEqual(names(visibleNodes(tree, new Set([analyse.id]))), ['Semestre 1']);
});

test('chemin d’un dossier : de la racine jusqu’à lui', () => {
  const s1 = folder('Semestre 1');
  const analyse = folder('Analyse', s1.id);
  const series = folder('Séries', analyse.id);
  const byId = new Map([s1, analyse, series].map((f) => [f.id, f]));
  assert.deepEqual(folderPath(byId, series).map((f) => f.name), ['Semestre 1', 'Analyse', 'Séries']);
  assert.deepEqual(folderPath(byId, s1).map((f) => f.name), ['Semestre 1']);
  assert.deepEqual(folderPath(byId, undefined), []);
});

test('chemin : un cycle s’arrête au garde-fou', () => {
  const a = folder('A');
  const b = folder('B', a.id);
  const looped = { ...a, parentId: b.id };
  const byId = new Map([looped, b].map((f) => [f.id, f]));
  assert.ok(folderPath(byId, b).length <= 50);
});

test('compteurs : sous-dossiers et cahiers par dossier, corbeille exclue', () => {
  const s1 = folder('Semestre 1');
  const a = folder('Analyse', s1.id);
  const b = folder('Algèbre', s1.id);
  const dead = folder('Mort', s1.id, { deletedAt: 3 });
  const notebooks = [notebook(s1.id), notebook(s1.id), notebook(s1.id, { deletedAt: 9 }), notebook(a.id), notebook(null)];
  const counts = countChildren([s1, a, b, dead], notebooks);
  assert.deepEqual(counts.get(s1.id), { folders: 2, notebooks: 2 });
  assert.deepEqual(counts.get(a.id), { folders: 0, notebooks: 1 });
  assert.equal(counts.get(b.id), undefined);
});

test('texte des compteurs : pluriels, et pas de « 0 dossier »', () => {
  assert.equal(countLabel({ folders: 2, notebooks: 3 }), '2 dossiers · 3 cahiers');
  assert.equal(countLabel({ folders: 1, notebooks: 1 }), '1 dossier · 1 cahier');
  assert.equal(countLabel({ folders: 0, notebooks: 4 }), '4 cahiers');
  assert.equal(countLabel(), '0 cahier');
});

test('grand titre : recherche, corbeille, dossier ouvert, accueil', () => {
  const f = folder('Analyse 2');
  assert.equal(viewTitle({ query: 'série', trash: false, folder: f, hasRecents: true }), 'Résultats');
  assert.equal(viewTitle({ query: '  ', trash: true, hasRecents: true }), 'Corbeille');
  assert.equal(viewTitle({ query: '', trash: false, folder: f, hasRecents: true }), 'Analyse 2');
  assert.equal(viewTitle({ query: '', trash: false, hasRecents: true }), 'Récents');
  assert.equal(viewTitle({ query: '', trash: false, hasRecents: false }), 'Bibliothèque');
});

test('papier en miniature : clair ou sombre, avec les réglures du vrai papier', () => {
  const light = paperPreview('grid');
  const dark = paperPreview('grid', 'dark');
  assert.equal(light.backgroundColor, '#ffffff');
  assert.equal(dark.backgroundColor, '#111214');
  assert.ok(light.backgroundImage?.includes('#cddcea'), 'réglures des carreaux clairs');
  assert.ok(dark.backgroundImage?.includes('#31353d'), 'réglures des carreaux sombres');
  assert.equal(paperPreview('blank').backgroundImage, undefined);
  assert.equal(paperPreview('blank', 'dark').backgroundColor, '#111214');
  assert.ok(paperPreview('seyes').backgroundImage?.includes('#e8a3a3'), 'marge rouge du Seyès');
  assert.ok(paperPreview('lined', 'dark').backgroundImage?.includes('#7a3d3d'), 'marge de lignes sur papier sombre');
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
