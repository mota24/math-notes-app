import { useSyncExternalStore } from 'react';
import type { User } from 'firebase/auth';
import { canSignInForSync, onSyncUser, signInForSync, signOutSync } from '../firebase';
import { onDbChange } from '../db/db';
import { firestoreController, getFirestoreState, subscribeFirestoreState } from './firestore';
import type { FirestoreState } from './firestore';

/**
 * Colle React ↔ moteur Firestore. Tant que le réglage n'est pas activé, `want` reste faux et le contrôleur
 * ne fait rien (aucune connexion, aucune écriture). L'appli marche exactement comme avant.
 */

let want = false;
let user: User | null = null;
let started = false;

function reconcile() {
  if (!want) {
    firestoreController.configure(false, null);
    return;
  }
  if (user) {
    firestoreController.configure(true, user.email);
    void firestoreController.start(user.uid, user.email);
  } else {
    firestoreController.stop();
    firestoreController.configure(true, null); // état « à connecter »
  }
}

/** Branché une seule fois par App : changements de base, mise en pause, et changement d'utilisateur. */
export function startFirestoreTriggers() {
  if (started) return;
  started = true;
  onDbChange((stores) => firestoreController.onLocalChange(stores));
  onSyncUser((u) => {
    user = u;
    reconcile();
  });
  const flushIfHidden = () => {
    if (document.visibilityState === 'hidden') firestoreController.flush();
  };
  document.addEventListener('visibilitychange', flushIfHidden);
  window.addEventListener('pagehide', () => firestoreController.flush());
}

/** Reflète le réglage (case à cocher) dans le moteur. */
export function configureFirestore(on: boolean) {
  want = on;
  reconcile();
}

export function canConnectFirestore() {
  return canSignInForSync();
}

/** Bouton « Se connecter » : ouvre la connexion Google (fenêtre sur le web, plugin natif dans l'APK). */
export async function connectFirestore() {
  await signInForSync();
  // onSyncUser fera démarrer la session
}

export async function disconnectFirestore() {
  await signOutSync();
}

export function useFirestoreState(): FirestoreState {
  return useSyncExternalStore(subscribeFirestoreState, getFirestoreState);
}
