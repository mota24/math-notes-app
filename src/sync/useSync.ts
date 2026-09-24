import { useSyncExternalStore } from 'react';
import { db, onDbChange } from '../db/db';
import type { StoreName } from '../db/db';
import { DriveAuthError, canUseDrive, currentToken, signIn, signOut } from './drive';
import { syncWithDrive } from './sync';
import type { SyncReport } from './sync';

export type SyncStatus = 'disabled' | 'needs-login' | 'idle' | 'pending' | 'syncing' | 'offline' | 'error';

export interface SyncState {
  status: SyncStatus;
  progress: string;
  error: string;
  lastSyncAt: number | null;
  lastReport: SyncReport | null;
}

const SYNCED: StoreName[] = ['folders', 'notebooks', 'pages', 'files', 'transcripts', 'glyphs', 'todos'];

let state: SyncState = { status: 'disabled', progress: '', error: '', lastSyncAt: null, lastReport: null };
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
      set({ status: 'syncing', progress: 'Synchronisation…', error: '' });
      dirty = false;
      try {
        const report = await syncWithDrive(token, (progress) => set({ progress }));
        set({ status: 'idle', lastReport: report, lastSyncAt: report.at, progress: '' });
      } catch (e) {
        dirty = true;
        set({
          status: e instanceof DriveAuthError ? 'needs-login' : 'error',
          error: (e as Error).message,
          progress: '',
        });
      } finally {
        running = null;
        refreshStatus();
      }
    })();
    return running;
  },
};

/** Déclencheurs : modifications (après 20 s de calme), retour du réseau, toutes les 5 min, démarrage. */
export function startSyncTriggers() {
  if (started) return;
  started = true;
  void db.getMeta<number>('lastSyncAt').then((t) => t && set({ lastSyncAt: t }));
  onDbChange((stores) => {
    if (running || !stores.some((s) => SYNCED.includes(s))) return;
    dirty = true;
    refreshStatus();
    if (!config.auto) return;
    window.clearTimeout(debounce);
    debounce = window.setTimeout(() => void syncController.syncNow(), 20_000);
  });
  window.addEventListener('online', () => {
    refreshStatus();
    if (config.auto) void syncController.syncNow();
  });
  window.addEventListener('offline', refreshStatus);
  window.setInterval(() => {
    if (config.auto) void syncController.syncNow();
  }, 5 * 60_000);
  window.setTimeout(() => {
    if (config.auto) void syncController.syncNow();
  }, 3000);
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
