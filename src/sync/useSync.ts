import { useSyncExternalStore } from 'react';
import { db, onDbChange } from '../db/db';
import type { StoreName } from '../db/db';
import { createBackup } from '../db/backup';
import { DriveAuthError, canUseDrive, currentToken, ensureFolder, listFiles, deleteFile, signIn, signOut, uploadBackupFile } from './drive';
import { DEVICE_BACKUP_FOLDER, autoBackupDue, backupName, backupsToPrune, uploadProgress } from './driveUpload';

/**
 * Copie de sauvegarde sur Google Drive, depuis l'appareil : l'export COMPLET de la base (le même fichier que
 * « Télécharger une sauvegarde ») envoyé en UN fichier JSON, d'un bloc. Avant, une synchronisation envoyait un
 * fichier par page (« Envoi des pages (49/196) ») : longue, fragile, et devenue inutile depuis que la
 * synchronisation entre appareils passe par Firestore. Copie automatique au plus une fois par jour.
 */
export interface SyncReport {
  pulled: number;
  pushed: number;
  purged: number;
  at: number;
}

export type SyncStatus = 'disabled' | 'needs-login' | 'idle' | 'pending' | 'syncing' | 'offline' | 'error';

export interface SyncState {
  status: SyncStatus;
  progress: string;
  /** Avancement de l'envoi du fichier (0 → 1) ; null hors envoi */
  percent: number | null;
  error: string;
  lastSyncAt: number | null;
  lastReport: SyncReport | null;
}

const SYNCED: StoreName[] = ['folders', 'notebooks', 'pages', 'files', 'transcripts', 'glyphs', 'todos'];

let state: SyncState = { status: 'disabled', progress: '', percent: null, error: '', lastSyncAt: null, lastReport: null };
const listeners = new Set<() => void>();
let config = { clientId: '', auto: true };
let dirty = false;
let running: Promise<void> | null = null;
let debounce = 0;
let started = false;

function set(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function refreshStatus() {
  if (state.status === 'syncing') return;
  if (!config.clientId || !canUseDrive().ok) return set({ status: 'disabled' });
  if (!currentToken()) return set({ status: 'needs-login' });
  if (!navigator.onLine) return set({ status: 'offline' });
  if (state.status === 'error') return;
  set({ status: dirty ? 'pending' : 'idle' });
}

export const syncController = {
  configure(clientId: string, auto: boolean) {
    config = { clientId: clientId.trim(), auto };
    refreshStatus();
  },

  /** À appeler depuis un clic : ouvre la connexion Google puis synchronise. */
  async connect() {
    set({ error: '', status: 'idle' });
    try {
      await signIn(config.clientId);
      await syncController.syncNow();
    } catch (e) {
      set({ status: 'error', error: (e as Error).message });
    }
  },

  disconnect() {
    signOut();
    set({ error: '', status: 'idle' });
    refreshStatus();
  },

  syncNow(): Promise<void> {
    if (running) return running;
    // Sans ID client, Drive est coupé (réglage vidé, ou personne n'est connecté à l'appli) : un jeton resté dans
    // l'onglet ne doit pas suffire à relancer une synchronisation.
    if (!config.clientId) {
      refreshStatus();
      return Promise.resolve();
    }
    const token = currentToken();
    if (!token || !navigator.onLine) {
      refreshStatus();
      return Promise.resolve();
    }
    running = (async () => {
      set({ status: 'syncing', progress: 'Préparation de la sauvegarde…', error: '' });
      dirty = false;
      try {
        // 1. Toute la base en un seul fichier JSON
        const blob = await createBackup();
        const at = Date.now();
        const name = backupName(at);
        // 2. Un seul envoi (la copie du jour remplace celle du matin, s'il y en a une)
        const folder = await ensureFolder(token, DEVICE_BACKUP_FOLDER);
        const existing = await listFiles(token, folder);
        const today = existing.find((f) => f.name === name);
        const id = await uploadBackupFile(token, folder, name, blob, today?.id ?? null, (sent, total) =>
          set({ progress: uploadProgress(sent, total), percent: total ? sent / total : 0 }),
        );
        // 3. Les copies les plus anciennes partent (8 gardées, celle-ci comprise)
        const old = backupsToPrune([...existing.filter((f) => f.name !== name), { id, name, modifiedTime: '' }]);
        for (const oldId of old) await deleteFile(token, oldId).catch(() => undefined);
        await db.setMeta('lastSyncAt', at);
        const report: SyncReport = { pulled: 0, pushed: 1, purged: old.length, at };
        set({ status: 'idle', lastReport: report, lastSyncAt: at, progress: '', percent: null });
      } catch (e) {
        dirty = true;
        set({
          status: e instanceof DriveAuthError ? 'needs-login' : 'error',
          error: (e as Error).message,
          progress: '',
          percent: null,
        });
      } finally {
        running = null;
        refreshStatus();
      }
    })();
    return running;
  },
};

/** La copie automatique, si elle est due (du nouveau, et plus d'un jour depuis la précédente) */
function autoBackup() {
  if (config.auto && autoBackupDue(state.lastSyncAt, dirty, Date.now())) void syncController.syncNow();
}

/** Déclencheurs de la copie automatique : modifications (après 20 s de calme), retour du réseau, toutes les 5 min, démarrage. */
export function startSyncTriggers() {
  if (started) return;
  started = true;
  // Au démarrage, on ne sait pas ce qui a changé depuis la dernière copie : on la considère due (au plus une par jour)
  dirty = true;
  void db.getMeta<number>('lastSyncAt').then((t) => t && set({ lastSyncAt: t }));
  onDbChange((stores) => {
    if (running || !stores.some((s) => SYNCED.includes(s))) return;
    dirty = true;
    refreshStatus();
    window.clearTimeout(debounce);
    debounce = window.setTimeout(autoBackup, 20_000);
  });
  window.addEventListener('online', () => {
    refreshStatus();
    autoBackup();
  });
  window.addEventListener('offline', refreshStatus);
  window.setInterval(autoBackup, 5 * 60_000);
  window.setTimeout(autoBackup, 3000);
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}
