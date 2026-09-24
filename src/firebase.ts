import { useEffect, useState } from 'react';
import { initializeApp } from 'firebase/app';
import type { FirebaseApp } from 'firebase/app';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
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

/**
 * Une variable d'environnement n'est retenue que si elle contient vraiment quelque chose. `??` ne suffisait
 * pas : une variable définie mais VIDE dans Vercel passait le filtre et Firebase répondait alors
 * « auth/api-key-not-valid », bloquant tout le site puisque l'accès est verrouillé.
 */
const texte = (valeur: unknown, repli: string): string => (typeof valeur === 'string' && valeur.trim() ? valeur.trim() : repli);

/**
 * La clé, en plus, doit ressembler à une vraie clé Google (« AIza… »). Une valeur de remplacement laissée
 * dans la console Vercel, une clé tronquée ou collée avec ses guillemets est ainsi ignorée au profit de la
 * configuration du projet, qui, elle, fonctionne.
 */
const CLE_PROJET = 'AIzaSyCSnqte3h5U224vLL_9jWX1tolKvTphBH0';
const cleEnv = texte(env.VITE_FIREBASE_API_KEY, '');
const cleValide = /^AIza[\w-]{30,}$/.test(cleEnv);

const firebaseConfig = {
  apiKey: cleValide ? cleEnv : CLE_PROJET,
  authDomain: texte(env.VITE_FIREBASE_AUTH_DOMAIN, 'math-notes-pwa.firebaseapp.com'),
  projectId: texte(env.VITE_FIREBASE_PROJECT_ID, 'math-notes-pwa'),
  storageBucket: texte(env.VITE_FIREBASE_STORAGE_BUCKET, 'math-notes-pwa.firebasestorage.app'),
  messagingSenderId: texte(env.VITE_FIREBASE_MESSAGING_SENDER_ID, '519312910632'),
  appId: texte(env.VITE_FIREBASE_APP_ID, '1:519312910632:web:a5f4f416820b75d552c81d'),
};

// Diagnostic : l'état des variables, jamais leur contenu.
console.log(
  'Config Firebase :',
  !cleEnv
    ? 'VITE_FIREBASE_API_KEY absente → clé du projet'
    : cleValide
      ? 'VITE_FIREBASE_API_KEY utilisée'
      : `VITE_FIREBASE_API_KEY ignorée (ne ressemble pas à une clé Google, ${cleEnv.length} caractères) → clé du projet`,
  '· projet', firebaseConfig.projectId,
  '· domaine d’auth', firebaseConfig.authDomain,
);

const app: FirebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(app);


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
