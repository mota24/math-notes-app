/**
 * État de la sauvegarde hebdomadaire sur Google Drive, lu dans users/<uid>/state/backup (écrit par le serveur,
 * api/_lib/server.ts). Sans import de valeur : testé sous Node (tests/backupHealth.test.ts).
 *
 * Deux façons d'échouer, toutes deux signalées dans l'appli :
 *  - la sauvegarde a tourné et a échoué : le serveur l'écrit (ok: false + message) ;
 *  - elle n'a pas tourné du tout (planification arrêtée, variable manquante dans Vercel…) : personne ne
 *    l'écrit — d'où la règle des 8 jours, qui voit le silence.
 */

export interface BackupStatusDoc {
  ok?: boolean;
  trigger?: 'cron' | 'manual';
  lastRunAt?: number;
  lastSuccessAt?: number;
  fileName?: string;
  bytes?: number;
  counts?: Record<string, number>;
  warnings?: string[];
  error?: string | null;
  connected?: boolean;
  connectedAt?: number;
}

/** Une semaine et un jour : au-delà, le dimanche est passé sans sauvegarde réussie */
export const STALE_DAYS = 8;
const DAY = 24 * 60 * 60 * 1000;

export type BackupHealth =
  | { kind: 'not-connected' }
  | { kind: 'waiting' }
  | { kind: 'ok'; at: number }
  | { kind: 'failed'; error: string; at: number; reconnect: boolean }
  | { kind: 'stale'; days: number };

export function backupHealth(doc: BackupStatusDoc | null | undefined, now: number): BackupHealth {
  if (!doc || (!doc.connected && !doc.lastSuccessAt && !doc.lastRunAt)) return { kind: 'not-connected' };
  if (doc.ok === false && doc.lastRunAt) {
    return { kind: 'failed', error: doc.error || 'Échec sans message.', at: doc.lastRunAt, reconnect: doc.connected === false };
  }
  const since = doc.lastSuccessAt ?? doc.connectedAt;
  if (since && now - since > STALE_DAYS * DAY) return { kind: 'stale', days: Math.floor((now - since) / DAY) };
  if (doc.lastSuccessAt) return { kind: 'ok', at: doc.lastSuccessAt };
  return { kind: 'waiting' };
}

/** « 12,4 Mo » */
export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
}

/**
 * Le message d'un appel au serveur de sauvegarde qui a échoué, selon son code HTTP : un jeton expiré (401) n'est
 * pas une panne du serveur (5xx). Avant, une configuration manquante côté Vercel s'affichait « Session expirée ».
 * `detail` : le message du serveur (même origine que l'appli, donc fiable), s'il en a donné un.
 */
export function driveErrorMessage(status: number, detail?: string | null): string {
  const d = detail?.trim();
  if (status === 401) return 'Session expirée : reconnecte-toi puis réessaie.';
  if (status === 403) return d || 'Ce compte n’est pas autorisé à gérer la sauvegarde.';
  if (status === 404 || status === 405) return 'Service de sauvegarde indisponible sur ce serveur.';
  if (status === 503) return `Erreur serveur : configuration manquante. ${d || 'Les variables de la sauvegarde ne sont pas encore définies dans Vercel (voir le README).'}`;
  if (status >= 500) return d?.startsWith('Erreur serveur') ? d : `Erreur serveur (HTTP ${status}) : ${d || 'réessaie dans un moment.'}`;
  return d || `Échec (HTTP ${status}).`;
}
