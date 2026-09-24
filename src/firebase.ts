import { useEffect, useState } from 'react';
import { initializeApp } from 'firebase/app';
import type { FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import type { User } from 'firebase/auth';

/**
 * Configuration Firebase. Vite n'expose au navigateur que les variables préfixées `VITE_` : on les lit en
 * priorité, avec les valeurs du projet en repli.
 *
 * Le repli est volontaire et sans danger : une clé Firebase web n'est pas un secret (elle identifie le
 * projet, elle ne donne aucun droit — ce sont les règles de sécurité et les domaines autorisés qui
 * protègent). Sans lui, une variable mal nommée dans Vercel rendrait le site entier inaccessible, puisque
 * l'appli est désormais verrouillée derrière la connexion.
 */
const env = import.meta.env;
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY ?? 'AIzaSyCSnqte3h5U224vLL_9jWX1tolKvTphBH0',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? 'math-notes-pwa.firebaseapp.com',
  projectId: env.VITE_FIREBASE_PROJECT_ID ?? 'math-notes-pwa',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? 'math-notes-pwa.firebasestorage.app',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '519312910632',
  appId: env.VITE_FIREBASE_APP_ID ?? '1:519312910632:web:a5f4f416820b75d552c81d',
};

// Diagnostic : dit si Vite a bien lu les variables, sans jamais afficher la moindre valeur.
console.log(
  'Config Firebase :',
  env.VITE_FIREBASE_API_KEY ? 'variables VITE_ lues' : 'variables VITE_ MANQUANTES (repli sur la config du projet)',
  '· projet', firebaseConfig.projectId,
  '· domaine d’auth', firebaseConfig.authDomain,
);

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

/** Sur le web, la connexion est toujours possible (l'appli n'est plus empaquetée en APK). */
export function canSignInForSync(): { ok: boolean; reason?: string } {
  return { ok: true };
}

/** Connexion pour la synchro Firestore : fenêtre Google classique (SDK Web). */
export async function signInForSync(): Promise<User> {
  const cred = await signInWithPopup(auth, identityProvider);
  return cred.user;
}

export async function signOutSync(): Promise<void> {
  await signOut(auth);
}

/** Prévient à chaque changement d'utilisateur connecté (null = déconnecté). Renvoie de quoi se désabonner. */
export function onSyncUser(fn: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, fn);
}

/** Utilisateur connecté, pour React. `undefined` = on ne sait pas encore (Firebase n'a pas répondu). */
export function useAuthUser(): User | null | undefined {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => onSyncUser(setUser), []);
  return user;
}
