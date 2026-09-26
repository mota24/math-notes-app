import assert from 'node:assert/strict';
import { CONFIRM_WORD, confirmTyped, linkErrorMessage, methodsOf, sameEmail, shareChildren, wipeUserData } from '../src/auth/accountModel.ts';
import type { WipeDoc, WipeStore } from '../src/auth/accountModel.ts';

/** Firestore simulé : des documents rangés par chemin, et le journal des suppressions et des envois */
function fakeStore(docs: Record<string, Record<string, unknown>>, uid: string) {
  const log: string[] = [];
  let queued: string[] = [];
  const store: WipeStore = {
    async list(collection) {
      const prefix = `${collection.join('/')}/`;
      return Object.entries(docs)
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
        .map(([path, data]): WipeDoc => ({ id: path.slice(prefix.length), data }));
    },
    async ownedShares(owner) {
      return (await store.list(['shares'])).filter((s) => s.data.owner === owner);
    },
    async exists(doc) {
      return doc.join('/') in docs;
    },
    async remove(doc) {
      queued.push(doc.join('/'));
    },
    async flush() {
      for (const path of queued) {
        delete docs[path];
        log.push(path);
      }
      if (queued.length) log.push('— envoi');
      queued = [];
    },
  };
  return { store, log, docs, uid };
}

const results: [string, () => Promise<void> | void][] = [];
const test = (name: string, fn: () => Promise<void> | void) => results.push([name, fn]);

test('méthodes de connexion lues dans providerData', () => {
  assert.deepEqual(methodsOf(['google.com']), { google: true, password: false });
  assert.deepEqual(methodsOf(['password', 'google.com']), { google: true, password: true });
  assert.deepEqual(methodsOf([]), { google: false, password: false });
  assert.ok(sameEmail('Moi@Gmail.com ', 'moi@gmail.com'));
  assert.ok(!sameEmail('moi@gmail.com', 'autre@gmail.com'));
  assert.ok(!sameEmail(null, 'moi@gmail.com'));
});

test('messages de liaison clairs, repli sur le message brut', () => {
  assert.match(linkErrorMessage('auth/credential-already-in-use', 'x'), /déjà utilisé par un autre compte/);
  assert.match(linkErrorMessage('auth/requires-recent-login', 'x'), /reconnecte-toi/);
  assert.equal(linkErrorMessage('auth/inconnu', 'brut'), 'brut');
});

test('confirmation : il faut recopier le mot exact (espaces et casse tolérés)', () => {
  assert.ok(confirmTyped(CONFIRM_WORD));
  assert.ok(confirmTyped('  supprimer '));
  assert.ok(!confirmTyped('supprime'));
  assert.ok(!confirmTyped(''));
});

test('pages et fonds d’un partage, sans doublon', () => {
  assert.deepEqual(shareChildren({ pageIds: ['a', 'b'], versions: { a: 1, c: 2 }, bgKeys: { b: 'k' } }).sort(), ['a', 'b', 'c']);
  assert.deepEqual(shareChildren({}), []);
});

test('suppression totale : tout ce qui appartient au compte, rien d’autre', async () => {
  const uid = 'moi';
  const { store, docs, log } = fakeStore(
    {
      'shares/s1': { owner: 'moi', pageIds: ['p1'], versions: { p1: 1 }, bgKeys: { p1: 'pdf' } },
      'shares/s1/pages/p1': {},
      'shares/s1/bgs/p1': {},
      'shares/autre': { owner: 'quelquun', pageIds: ['x'] },
      'shares/autre/pages/x': {},
      'users/moi/pages/p1': { parts: 0 },
      'users/moi/pages/lourde': { parts: 2 },
      'users/moi/pages/lourde/parts/0': {},
      'users/moi/pages/lourde/parts/1': {},
      'users/moi/files/f1': { chunks: 3 },
      'users/moi/files/f1/chunks/0': {},
      'users/moi/files/f1/chunks/1': {},
      'users/moi/files/f1/chunks/2': {},
      'users/moi/transcripts/p1': {},
      'users/moi/state/index': {},
      'users/moi/state/prefs': {},
      'users/moi/state/backup': {},
      'users/voisin/pages/p9': {},
    },
    uid,
  );
  const report = await wipeUserData(store, uid);
  assert.deepEqual(report, { shares: 1, pages: 2, files: 1, transcripts: 1 });
  assert.deepEqual(Object.keys(docs).sort(), ['shares/autre', 'shares/autre/pages/x', 'users/voisin/pages/p9'], 'seul ce qui est à quelqu’un d’autre reste');
  // Les sous-documents d'un partage sont envoyés AVANT le partage lui-même (les règles regardent son auteur)
  const children = log.indexOf('shares/s1/pages/p1');
  const parent = log.indexOf('shares/s1');
  assert.ok(children >= 0 && parent > children && log.slice(children, parent).includes('— envoi'));
  assert.ok(log.indexOf('users/moi/pages/lourde/parts/1') < log.indexOf('users/moi/pages/lourde'));
  assert.ok(log.indexOf('users/moi/files/f1/chunks/2') < log.indexOf('users/moi/files/f1'));
});

test('suppression relancée après un échec : ne casse rien, termine le travail', async () => {
  const { store, docs } = fakeStore({ 'users/moi/state/index': {}, 'users/moi/pages/p1': { parts: 0 } }, 'moi');
  await wipeUserData(store, 'moi');
  await wipeUserData(store, 'moi');
  assert.deepEqual(Object.keys(docs), []);
});

test('état de la sauvegarde absent : pas de suppression tentée (règles de la version précédente)', async () => {
  const { store, log } = fakeStore({ 'users/moi/state/index': {} }, 'moi');
  await wipeUserData(store, 'moi');
  assert.ok(!log.includes('users/moi/state/backup'));
});

let failed = 0;
for (const [name, fn] of results) {
  try {
    await fn();
    console.log('OK  ', name);
  } catch (e) {
    failed++;
    console.log('FAIL', name, '\n     ', (e as Error).message);
  }
}
console.log(failed ? `\n${failed} échec(s)` : '\nCompte : tout passe');
process.exitCode = failed ? 1 : 0;
