import assert from 'node:assert/strict';
import { signupFlow } from '../src/auth/signupFlow.ts';

let notified = 0;
const off = signupFlow.subscribe(() => notified++);

assert.equal(signupFlow.isActive(), false);
signupFlow.start();
assert.equal(signupFlow.isActive(), true, 'pendant l’inscription, la porte d’entrée laisse faire');
assert.equal(signupFlow.result(), null);

signupFlow.finish({ email: 'eleve@exemple.com', mailFailed: false });
assert.equal(signupFlow.isActive(), false);
assert.deepEqual(signupFlow.result(), { email: 'eleve@exemple.com', mailFailed: false }, 'le message de réussite survit au passage connecté');

signupFlow.clear();
assert.equal(signupFlow.result(), null, '« Aller à la page de connexion »');

signupFlow.start();
signupFlow.fail();
assert.equal(signupFlow.isActive(), false, 'un échec rend la main à la porte d’entrée');
assert.equal(signupFlow.result(), null, 'et n’affiche pas de réussite');

assert.equal(notified, 5, 'l’écran est prévenu à chaque étape');
off();
signupFlow.start();
assert.equal(notified, 5, 'plus prévenu une fois désabonné');
signupFlow.fail();
console.log('Inscription : tout passe');
