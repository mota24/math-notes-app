import { initializeApp } from 'firebase/app';
import type { FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { isNativeApp } from './platform';

const firebaseConfig = {
  apiKey: 'AIzaSyCSnqte3h5U224vLL_9jWX1tolKvTphBH0',
  authDomain: 'math-notes-pwa.firebaseapp.com',
  projectId: 'math-notes-pwa',
  storageBucket: 'math-notes-pwa.firebasestorage.app',
  messagingSenderId: '519312910632',
  appId: '1:519312910632:web:a5f4f416820b75d552c81d',
};

const app: FirebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// --- Connexion Drive (inchangée) : la portée drive.file sert à la sauvegarde des fichiers dans Drive.
const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('https://www.googleapis.com/auth/drive.file');
export const loginWithGoogle = () => signInWithPopup(auth, googleProvider);
export const logout = () => signOut(auth);

// ------------------------------------------------------------------ Firestore (temps réel, opt-in)

/**
 * Firestore n'est chargé qu'à la demande (import dynamique) : tant que la synchronisation temps réel n'est
 * pas activée dans les Réglages, ce code n'est jamais exécuté et n'ouvre aucune connexion. Le module se
 * charge sans que Firestore soit activé côté console ; seules les vraies requêtes réseau échoueraient alors,
 * et elles sont toutes protégées par des try/catch dans src/sync/firestore.ts.
 */
let dbPromise: Promise<Firestore> | null = null;
export function getFirestoreDb(): Promise<Firestore> {
  dbPromise ??= import('firebase/firestore').then(({ getFirestore }) => getFirestore(app));
  return dbPromise;
}

/** Fournisseur identité seule (sans portée Drive) : la synchro Firestore n'a besoin que de savoir qui tu es. */
const identityProvider = new GoogleAuthProvider();

/**
 * Plugin natif Capacitor lu dans le registre global, SANS import statique : le paquet
 * `@capacitor-firebase/authentication` n'a donc pas besoin d'être installé pour que la PWA compile. Il
 * n'existe que dans l'APK une fois le plugin ajouté (voir README, étape « connexion native »).
 */
interface NativeFirebaseAuth {
  signInWithGoogle(): Promise<{ credential?: { idToken?: string; accessToken?: string } }>;
  signOut(): Promise<void>;
}
function nativeFirebaseAuth(): NativeFirebaseAuth | null {
  const cap = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
  const plugin = cap?.Plugins?.FirebaseAuthentication as NativeFirebaseAuth | undefined;
  return plugin ?? null;
}

/** Y a-t-il un moyen de se connecter pour la synchro sur cet appareil ? (popup sur le web, plugin sur l'APK) */
export function canSignInForSync(): { ok: boolean; reason?: string } {
  if (isNativeApp() && !nativeFirebaseAuth()) {
    return {
      ok: false,
      reason:
        'La connexion Google native n’est pas encore disponible dans cette version de l’APK (plugin Firebase à ajouter et google-services.json à fournir). Sur le PC ou le navigateur de la tablette, la synchro fonctionne dès maintenant.',
    };
  }
  return { ok: true };
}

/**
 * Connexion pour la synchro Firestore. Sur le web : fenêtre Google classique. Dans l'APK : plugin natif
 * (Google interdit la fenêtre OAuth dans une WebView), puis on rejoue le jeton dans Firebase Auth JS.
 */
export async function signInForSync(): Promise<User> {
  const native = nativeFirebaseAuth();
  if (isNativeApp() && native) {
    const result = await native.signInWithGoogle();
    const idToken = result.credential?.idToken;
    if (!idToken) throw new Error('Connexion Google native sans jeton : réessaie.');
    const credential = GoogleAuthProvider.credential(idToken, result.credential?.accessToken);
    const cred = await signInWithCredential(auth, credential);
    return cred.user;
  }
  const cred = await signInWithPopup(auth, identityProvider);
  return cred.user;
}

export async function signOutSync(): Promise<void> {
  try {
    await nativeFirebaseAuth()?.signOut();
  } catch {
    /* pas de plugin natif : rien à faire côté natif */
  }
  await signOut(auth);
}

/** Prévient à chaque changement d'utilisateur connecté (null = déconnecté). Renvoie de quoi se désabonner. */
export function onSyncUser(fn: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, fn);
}
