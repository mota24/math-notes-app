import assert from 'node:assert/strict';
import { browseNotebooks, buildFolderTree, countChildren, countLabel, coverGradient, coverKey, coverSource, folderParents, folderPath, notebookFolder, paperPreview, viewTitle, visibleNodes } from '../src/components/libraryModel.ts';
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

test('données abîmées : un cycle ou un dossier qui est son propre parent ne boucle pas ET ne disparaît pas', () => {
  const a = folder('A');
  const b = folder('B', a.id);
  const loopA = { ...a, parentId: b.id };
  const self = folder('Soi');
  const tree = buildFolderTree([loopA, b, { ...self, parentId: self.id }, folder('Racine')]);
  // Le cycle A ↔ B est cassé au plus petit identifiant (A) : A revient à la racine, B reste dedans
  assert.deepEqual(names(tree), ['A', 'Racine', 'Soi']);
  assert.deepEqual(names(tree[0].children), ['B']);
  const byId = new Map([loopA, b].map((f) => [f.id, f]));
  assert.deepEqual(folderPath(byId, b).map((f) => f.name), ['A', 'B'], 'le fil d’Ariane s’arrête au lieu de tourner en rond');
});

test('sous-dossier orphelin (parent supprimé ailleurs) : rattaché à la racine avec son contenu, jamais perdu', () => {
  const orphan = folder('Chapitre 3', 'parent-disparu');
  const inside = folder('Exercices', orphan.id);
  const tree = buildFolderTree([orphan, inside, folder('Semestre 1')]);
  assert.deepEqual(names(tree), ['Chapitre 3', 'Semestre 1']);
  assert.deepEqual(names(tree[0].children), ['Exercices']);
  const parents = folderParents([orphan, inside]);
  assert.equal(notebookFolder({ folderId: 'dossier-disparu' }, parents), null, 'un cahier au dossier disparu revient à la racine');
  assert.equal(notebookFolder({ folderId: inside.id }, parents), inside.id);
});

test('arborescence profonde : 300 niveaux, dans l’ordre, sans limite', () => {
  const chain: Folder[] = [];
  for (let i = 0; i < 300; i++) chain.push(folder(`Niveau ${i}`, i ? chain[i - 1].id : null));
  let node = buildFolderTree(chain)[0];
  for (let i = 1; i < 300; i++) node = node.children[0];
  assert.equal(node.folder.name, 'Niveau 299');
  assert.equal(node.depth, 299);
  const byId = new Map(chain.map((f) => [f.id, f]));
  assert.equal(folderPath(byId, chain[299]).length, 300);
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

test('couverture : la page du PDF, sinon la photo, sinon rien (visuel dégradé)', () => {
  const pdf = coverSource({ pdf: { fileId: 'f1', pageIndex: 0 }, image: null });
  assert.deepEqual(pdf, { kind: 'pdf', fileId: 'f1', pageIndex: 0 });
  assert.deepEqual(coverSource({ pdf: null, image: { fileId: 'p1' } }), { kind: 'image', fileId: 'p1' });
  assert.equal(coverSource({ pdf: null }), null, 'page de papier');
  assert.equal(coverSource(undefined), null, 'première page pas encore arrivée');
  assert.equal(coverKey(pdf!), 'pdf-f1-0');
  assert.notEqual(coverKey({ kind: 'pdf', fileId: 'f1', pageIndex: 3 }), coverKey(pdf!), 'une autre page, une autre miniature');
  assert.equal(coverKey({ kind: 'image', fileId: 'p1' }), 'image-p1');
});

test('couverture sans rien à montrer : dégradé tiré de la couleur du cahier', () => {
  const g = coverGradient('#c0392b');
  assert.ok(g.includes('#c0392b'));
  assert.ok(g.startsWith('radial-gradient('));
});

test('écran partagé : parcourir un dossier (sous-dossiers, cahiers), sans corbeille ni le cahier ouvert', () => {
  const s1 = folder('Semestre 1');
  const ana = folder('Analyse', s1.id);
  const old = folder('Ancien', s1.id, { deletedAt: 5 });
  const cours = notebook(ana.id, { title: 'Cours intégrales' });
  const td = notebook(ana.id, { title: 'TD 2' });
  const td10 = notebook(ana.id, { title: 'TD 10' });
  const ouvert = notebook(ana.id, { title: 'Mes notes' });
  const jete = notebook(ana.id, { title: 'Jeté', deletedAt: 3 });
  const perdu = notebook(old.id, { title: 'Dans la corbeille' });
  const racine = notebook(null, { title: 'Brouillon' });
  const all = [cours, td, td10, ouvert, jete, perdu, racine];
  const root = browseNotebooks([s1, ana, old], all, null, '', ouvert.id);
  assert.deepEqual(root.folders.map((f) => f.name), ['Semestre 1']);
  assert.deepEqual(root.notebooks.map((x) => x.title), ['Brouillon']);
  assert.deepEqual(browseNotebooks([s1, ana, old], all, s1.id, '', ouvert.id).folders.map((f) => f.name), ['Analyse'], 'dossier à la corbeille caché');
  assert.deepEqual(browseNotebooks([s1, ana, old], all, ana.id, '', ouvert.id).notebooks.map((x) => x.title), ['Cours intégrales', 'TD 2', 'TD 10'], 'tri naturel, sans le cahier ouvert ni la corbeille');
});

test('écran partagé : recherche dans toute la bibliothèque, sans accents ni majuscules, par mots', () => {
  const ana = folder('Analyse réelle');
  const cours = notebook(ana.id, { title: 'Cours Intégrales', subject: 'Maths' });
  const phys = notebook(null, { title: 'Ondes', subject: 'Physique' });
  const r = browseNotebooks([ana], [cours, phys], null, 'integrales', null);
  assert.deepEqual(r.notebooks.map((x) => x.title), ['Cours Intégrales'], 'trouvé dans un sous-dossier');
  assert.deepEqual(browseNotebooks([ana], [cours, phys], null, 'physique', null).notebooks.map((x) => x.title), ['Ondes'], 'par la matière');
  assert.deepEqual(browseNotebooks([ana], [cours, phys], null, 'REELLE', null).folders.map((f) => f.name), ['Analyse réelle']);
  assert.equal(browseNotebooks([ana], [cours, phys], null, 'cours ondes', null).notebooks.length, 0, 'tous les mots doivent y être');
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
