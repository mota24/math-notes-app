import { useEffect, useState } from 'react';
import { auth, getFirestoreDb, useAuthUser } from '../firebase';
import type { BackupStatusDoc } from './backupHealth';

/**
 * Sauvegarde hebdomadaire sur Google Drive, côté appli. Le travail se fait sur le serveur (api/backup.ts,
 * déclenché chaque dimanche par Vercel Cron) ; l'appli, elle :
 *  - suit son compte rendu en direct (users/<uid>/state/backup) pour afficher la dernière sauvegarde ou alerter ;
 *  - peut la lancer tout de suite (« Sauvegarder maintenant », « Relancer ») ;
 *  - connecte Google Drive une fois (autorisation Google, portée drive.file).
 */

export interface BackupStatusView {
  /** undefined : lecture en cours ; null : aucun compte rendu encore */
  doc: BackupStatusDoc | null | undefined;
  /** Le compte rendu est illisible (règles Firestore pas encore publiées…) */
  error: string | null;
}

export function useBackupStatus(): BackupStatusView {
  const user = useAuthUser();
  const uid = user?.uid ?? null;
  const [view, setView] = useState<BackupStatusView>({ doc: undefined, error: null });
  useEffect(() => {
    if (!uid) return;
    let off: (() => void) | null = null;
    let alive = true;
    void (async () => {
      const { doc, onSnapshot } = await import('firebase/firestore');
      const store = await getFirestoreDb();
      if (!alive) return;
      off = onSnapshot(
        doc(store, 'users', uid, 'state', 'backup'),
        (snap) => setView({ doc: snap.exists() ? (snap.data() as BackupStatusDoc) : null, error: null }),
        (e) =>
          setView({
            doc: null,
            error: /permission/i.test(e.message)
              ? 'Compte rendu illisible : publie les règles Firestore à jour (fichier firestore.rules).'
              : 'Compte rendu de sauvegarde indisponible pour l’instant.',
          }),
      );
    })().catch(() => undefined);
    return () => {
      alive = false;
      off?.();
    };
  }, [uid]);
  return view;
}

async function authorizedPost(path: string): Promise<Response> {
  const user = auth.currentUser;
  if (!user) throw new Error('Connecte-toi d’abord.');
  // Jeton rafraîchi à chaque appel : un jeton en cache presque expiré était refusé (« Session expirée »)
  const token = await user.getIdToken(true);
  return fetch(path, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
}

/** « Sauvegarder maintenant » : peut prendre une à deux minutes avec de gros PDF */
export async function runBackupNow(): Promise<BackupStatusDoc> {
  let res: Response;
  try {
    res = await authorizedPost('/api/backup');
  } catch (e) {
    throw new Error(navigator.onLine ? `Serveur injoignable (${(e as Error).message}).` : 'Pas de réseau : réessaie une fois en ligne.', { cause: e });
  }
  const body = (await res.json().catch(() => ({}))) as BackupStatusDoc & { error?: string | null };
  if (!res.ok || body.ok === false) throw new Error(body.error || `La sauvegarde a échoué (HTTP ${res.status}).`);
  return body;
}

/** Envoie vers l'autorisation Google ; le retour se fait sur l'appli avec ?drive=connected (ou error) */
export async function connectGoogleDrive(): Promise<void> {
  const res = await authorizedPost('/api/drive-auth');
  const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !body.url) throw new Error(body.error || `Connexion impossible (HTTP ${res.status}).`);
  window.location.assign(body.url);
}

/**
 * Suppression du compte : déconnecte la sauvegarde hebdomadaire (autorisation révoquée et effacée côté
 * serveur). « Pas configurée » (variables Vercel absentes, ou serveur local de développement) et « autre
 * compte que le propriétaire de la sauvegarde » ne sont pas des échecs : il n'y a alors rien à déconnecter.
 */
export async function disconnectDriveBackup(): Promise<'disconnected' | 'nothing'> {
  const user = auth.currentUser;
  if (!user) throw new Error('Connecte-toi d’abord.');
  const token = await user.getIdToken(true);
  let res: Response;
  try {
    res = await fetch('/api/drive-auth', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  } catch (e) {
    throw new Error('Serveur injoignable : la sauvegarde Google Drive n’a pas pu être déconnectée. Réessaie une fois en ligne.', { cause: e });
  }
  if (res.status === 503 || res.status === 403 || res.status === 404 || res.status === 405) return 'nothing';
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; disconnected?: boolean; error?: string };
  if (!res.ok || !body.ok) throw new Error(body.error || `Déconnexion de Google Drive impossible (HTTP ${res.status}).`);
  return body.disconnected ? 'disconnected' : 'nothing';
}
