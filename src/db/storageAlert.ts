import { useSyncExternalStore } from 'react';

/**
 * Alerte « stockage » partagée par toute l'appli. Avant, un enregistrement qui échouait (stockage du
 * navigateur plein, erreur disque d'IndexedDB) ne disait rien : on continuait d'écrire, et tout disparaissait
 * au rechargement. Désormais l'erreur s'affiche, et l'éditeur garde le travail en mémoire et réessaie.
 */

export interface StorageAlert {
  message: string;
  /** Stockage plein : il faut libérer de la place, réessayer ne suffira pas */
  full: boolean;
}

let current: StorageAlert | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

/**
 * Le navigateur refuse d'écrire faute de place. Attention : « quota » tout seul ne suffit pas, les erreurs de
 * Gemini parlent aussi de quota (celui de l'API gratuite) — il faut le nom DOM exact, ou un message qui parle
 * bien du stockage.
 */
export function isStorageFull(e: unknown): boolean {
  const err = e as { name?: string; message?: string } | null;
  return err?.name === 'QuotaExceededError' || /(storage|indexeddb)[^]*quota|quota[^]*(storage|indexeddb)/i.test(err?.message ?? '');
}

/** Erreurs propres à IndexedDB (et pas AbortError, qui sert aussi aux requêtes réseau annulées). */
const IDB_ERRORS = new Set(['QuotaExceededError', 'UnknownError', 'TransactionInactiveError', 'VersionError']);

/** Erreur venant du stockage local (et non d'une autre partie de l'appli). */
export function isStorageError(e: unknown): boolean {
  if (isStorageFull(e)) return true;
  const err = e as { name?: string; message?: string } | null;
  return IDB_ERRORS.has(err?.name ?? '') || /indexeddb/i.test(err?.message ?? '');
}

export function reportStorageError(e: unknown) {
  const full = isStorageFull(e);
  current = {
    full,
    message: full
      ? 'Stockage plein : tes derniers traits n’ont pas pu être enregistrés. Libère de la place (vide la corbeille, supprime de vieux PDF) ; ton travail est gardé en mémoire et sera enregistré dès que possible.'
      : `Enregistrement impossible (${(e as Error)?.message ?? 'erreur du stockage'}). Nouvel essai automatique dans quelques secondes.`,
  };
  emit();
}

/** Avertissement préventif : le stockage approche de sa limite. */
export function reportStorageNearlyFull(usedPct: number) {
  current = {
    full: false,
    message: `Le stockage de l’appli est plein à ${usedPct} % : vide la corbeille ou supprime de vieux PDF pour éviter qu’un enregistrement échoue.`,
  };
  emit();
}

export function dismissStorageAlert() {
  current = null;
  emit();
}

export function useStorageAlert(): StorageAlert | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

/**
 * Filet de sécurité global : toute écriture lancée « sans attendre » (void db.put…) qui échoue sur le stockage
 * finit ici au lieu de disparaître. Vérifie aussi, au démarrage, que la place ne manque pas déjà.
 */
let watching = false;
export function watchStorage() {
  if (watching) return; // une seule fois, même si React rejoue l'effet (mode strict)
  watching = true;
  window.addEventListener('unhandledrejection', (event) => {
    if (!isStorageError(event.reason)) return;
    event.preventDefault();
    reportStorageError(event.reason);
  });
  void navigator.storage
    ?.estimate?.()
    .then(({ usage, quota }) => {
      if (!usage || !quota) return;
      const pct = Math.round((usage / quota) * 100);
      if (pct >= 90) reportStorageNearlyFull(pct);
    })
    .catch(() => undefined);
}
