import { syncController, useSyncState } from '../sync/useSync';

const time = (t: number | null) => (t ? new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '');

/** État de la sauvegarde Google Drive (masqué si elle n'est pas configurée). */
export function SyncChip() {
  const s = useSyncState();
  switch (s.status) {
    case 'disabled':
      return null;
    case 'needs-login':
      return (
        <button className="sync-chip warn" onClick={() => void syncController.connect()} title={s.error || undefined}>
          ☁ Se connecter à Drive
        </button>
      );
    case 'syncing':
      return (
        <span className="sync-chip">
          <span className="spinner" /> {s.progress || 'Synchronisation…'}
        </span>
      );
    case 'offline':
      return <span className="sync-chip muted-chip">☁ Hors-ligne : enregistré sur l’appareil</span>;
    case 'error':
      return (
        <button className="sync-chip error" onClick={() => void syncController.syncNow()} title={s.error}>
          ⚠ Synchro échouée : réessayer
        </button>
      );
    case 'pending':
      return (
        <button className="sync-chip" onClick={() => void syncController.syncNow()}>
          ☁ Modifications en attente
        </button>
      );
    case 'idle':
      return (
        <button className="sync-chip ok" onClick={() => void syncController.syncNow()} title="Synchroniser maintenant">
          ☁ Synchronisé {time(s.lastSyncAt)}
        </button>
      );
  }
}
