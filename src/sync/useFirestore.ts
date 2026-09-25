import { useSyncExternalStore } from 'react';
import type { User } from 'firebase/auth';
import { onSyncUser } from '../firebase';
import { onDbChange } from '../db/db';
import { PREFS_EVENT } from '../settings';
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
  // Une couleur ou une épaisseur changée : elle part avec le prochain envoi groupé (pour la sauvegarde Drive)
  window.addEventListener(PREFS_EVENT, () => firestoreController.onLocalChange(['prefs']));
  onSyncUser((u) => {
    user = u;
    reconcile();
  });
  // Appli en arrière-plan (onglet caché, tablette mise en veille) : tout part tout de suite
  const flushIfHidden = () => {
    if (document.visibilityState === 'hidden') firestoreController.flush();
  };
  document.addEventListener('visibilitychange', flushIfHidden);
  window.addEventListener('pagehide', () => firestoreController.flush());

  // Coupure réseau : l'indicateur passe « hors ligne », et au retour tout ce qui attend repart
  window.addEventListener('online', () => firestoreController.setOnline(true));
  window.addEventListener('offline', () => firestoreController.setOnline(false));

  // Sortie d'un cahier (retour à la bibliothèque, autre onglet) : `visibilitychange` ne se déclenche pas
  // pour une navigation interne, on surveille donc l'adresse. Tourner les pages d'un même cahier ne compte pas.
  const cahierDe = (hash: string) => /^#\/cahier\/([^/]+)/.exec(hash)?.[1] ?? null;
  let cahierCourant = cahierDe(window.location.hash);
  window.addEventListener('hashchange', () => {
    const suivant = cahierDe(window.location.hash);
    if (cahierCourant && suivant !== cahierCourant) firestoreController.flushSoon();
    cahierCourant = suivant;
  });
}

/** Bouton de l'indicateur : envoyer maintenant. */
export function syncFirestoreNow() {
  firestoreController.flush();
}

/** Reflète le réglage (case à cocher) dans le moteur. */
export function configureFirestore(on: boolean) {
  want = on;
  reconcile();
}

export function useFirestoreState(): FirestoreState {
  return useSyncExternalStore(subscribeFirestoreState, getFirestoreState);
}
