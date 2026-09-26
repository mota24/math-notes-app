import assert from 'node:assert/strict';
import { decideAccess, parseAllowlist } from '../src/auth/access.ts';
import { isStorageError, isStorageFull } from '../src/db/storageAlert.ts';

const owner = { uid: 'u-proprio', email: 'moi@exemple.fr' };
const etranger = { uid: 'u-autre', email: 'quelquun@gmail.com' };

const cases: [string, () => void][] = [
  [
    'parseAllowlist : virgules, points-virgules, espaces, casse, guillemets, doublons, entrées invalides',
    () => {
      assert.deepEqual(parseAllowlist(' Moi@Exemple.fr, autre@x.com;moi@exemple.fr  "trois@y.org"  pas-une-adresse '), [
        'moi@exemple.fr',
        'autre@x.com',
        'trois@y.org',
      ]);
      assert.deepEqual(parseAllowlist(''), []);
      assert.deepEqual(parseAllowlist(undefined), []);
      assert.deepEqual(parseAllowlist('   '), []);
    },
  ],
  [
    'liste blanche remplie : seul un compte listé entre (insensible à la casse)',
    () => {
      const liste = parseAllowlist('moi@exemple.fr');
      assert.deepEqual(decideAccess({ ...owner, email: 'MOI@exemple.FR' }, liste, null), { ok: true, claim: false });
      const refus = decideAccess(etranger, liste, null);
      assert.equal(refus.ok, false);
    },
  ],
  [
    'sans liste blanche : le premier compte devient propriétaire de l’appareil',
    () => {
      assert.deepEqual(decideAccess(owner, [], null), { ok: true, claim: true });
    },
  ],
  [
    'sans liste blanche : le propriétaire rentre, un autre compte (même Google) est refusé',
    () => {
      assert.deepEqual(decideAccess(owner, [], owner), { ok: true, claim: false });
      const refus = decideAccess(etranger, [], owner);
      assert.equal(refus.ok, false);
      if (!refus.ok) assert.match(refus.reason, /moi@exemple\.fr/);
    },
  ],
  [
    'le propriétaire est reconnu par son identifiant, pas par son adresse',
    () => {
      // même adresse affichée, autre compte : refusé
      assert.equal(decideAccess({ uid: 'u-imposteur', email: owner.email }, [], owner).ok, false);
      assert.equal(decideAccess({ uid: 'u-imposteur', email: owner.email, emailVerified: false }, [], owner).ok, false);
    },
  ],
  [
    'compte recréé (autre identifiant) avec la même adresse VÉRIFIÉE : il reprend l’appareil',
    () => {
      assert.deepEqual(decideAccess({ uid: 'u-nouveau', email: 'Moi@Exemple.fr ', emailVerified: true }, [], owner), { ok: true, claim: true });
      assert.equal(decideAccess({ uid: 'u-nouveau', email: 'autre@exemple.fr', emailVerified: true }, [], owner).ok, false);
      assert.equal(decideAccess({ uid: 'u-nouveau', email: null, emailVerified: true }, [], { uid: 'u-proprio', email: null }).ok, false);
    },
  ],
  [
    'adresse non validée : refusée, même listée ou propriétaire ; validée ou inconnue (Google) : acceptée',
    () => {
      const liste = parseAllowlist('moi@exemple.fr');
      assert.equal(decideAccess({ ...owner, emailVerified: false }, liste, null).ok, false);
      assert.equal(decideAccess({ ...owner, emailVerified: false }, [], owner).ok, false);
      assert.equal(decideAccess({ ...owner, emailVerified: false }, [], null).ok, false, 'ne peut pas devenir propriétaire');
      assert.deepEqual(decideAccess({ ...owner, emailVerified: true }, liste, null), { ok: true, claim: false });
      assert.deepEqual(decideAccess({ ...owner, emailVerified: true }, [], null), { ok: true, claim: true });
    },
  ],
  [
    'stockage : un vrai « stockage plein » est reconnu, un quota Gemini ne l’est pas',
    () => {
      assert.equal(isStorageFull({ name: 'QuotaExceededError', message: 'x' }), true);
      assert.equal(isStorageFull({ name: 'Error', message: 'The IndexedDB quota has been exceeded' }), true);
      assert.equal(isStorageFull({ name: 'Error', message: 'Quota exceeded for Gemini API free tier' }), false);
    },
  ],
  [
    'stockage : erreurs IndexedDB reconnues, requêtes réseau annulées ignorées',
    () => {
      assert.equal(isStorageError({ name: 'UnknownError', message: 'disk' }), true);
      assert.equal(isStorageError({ name: 'TransactionInactiveError', message: 'x' }), true);
      assert.equal(isStorageError({ name: 'AbortError', message: 'The user aborted a request.' }), false);
      assert.equal(isStorageError(new Error('Gemini a répondu 503')), false);
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
console.log(failed ? `\n${failed} échec(s)` : '\nAccès et stockage : tout passe');
if (failed) process.exit(1);
