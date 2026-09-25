import { useState } from 'react';
import type { ReactNode } from 'react';
import { backupHealth } from '../sync/backupHealth';
import { connectGoogleDrive, runBackupNow, useBackupStatus } from '../sync/driveBackup';

const date = (t: number) => new Date(t).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

/** Retour de l'autorisation Google (?drive=connected ou ?drive=error&message=…), lu une fois puis effacé de l'adresse */
function readDriveReturn(): { ok: boolean; message: string } | null {
  const q = new URLSearchParams(window.location.search);
  const drive = q.get('drive');
  if (!drive) return null;
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`);
  return drive === 'connected'
    ? { ok: true, message: 'Google Drive est connecté : ta sauvegarde complète partira chaque dimanche vers 3 h.' }
    : { ok: false, message: `Connexion à Google Drive impossible : ${q.get('message') ?? 'erreur inconnue'}` };
}

/**
 * L'alerte de la sauvegarde hebdomadaire, en haut de l'appli, seulement quand il faut agir : la dernière
 * sauvegarde a échoué, ou aucune n'a réussi depuis plus de 8 jours. « Relancer » la refait tout de suite.
 */
export function BackupAlert() {
  const { doc } = useBackupStatus();
  const [ret, setRet] = useState(readDriveReturn);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const health = backupHealth(doc, Date.now());

  const notice = result ?? ret;
  if (notice) {
    return (
      <Banner tone={notice.ok ? 'ok' : 'error'} onClose={() => (setRet(null), setResult(null))}>
        {notice.message}
      </Banner>
    );
  }
  if (hidden || (health.kind !== 'failed' && health.kind !== 'stale')) return null;

  const relancer = async () => {
    setBusy(true);
    try {
      const done = await runBackupNow();
      setResult({ ok: true, message: `Sauvegarde refaite : ${done.fileName ?? 'fichier envoyé sur Drive'}.` });
    } catch (e) {
      setResult({ ok: false, message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Banner tone="error" onClose={() => setHidden(true)}>
      <strong>
        {health.kind === 'failed'
          ? `La sauvegarde automatique sur Google Drive a échoué (${date(health.at)}).`
          : `Aucune sauvegarde Google Drive réussie depuis ${health.days} jours.`}
      </strong>{' '}
      {health.kind === 'failed' ? health.error : 'La planification ne semble pas tourner : relance-la à la main.'}
      <span className="mt-2 flex flex-wrap gap-2">
        {health.kind === 'failed' && health.reconnect ? (
          <button type="button" className={action} onClick={() => void connectGoogleDrive().catch((e: Error) => setResult({ ok: false, message: e.message }))}>
            Reconnecter Google Drive
          </button>
        ) : (
          <button type="button" className={action} disabled={busy} onClick={() => void relancer()}>
            {busy ? 'Sauvegarde en cours… (1 à 2 min)' : 'Relancer maintenant'}
          </button>
        )}
      </span>
    </Banner>
  );
}

const action = 'inline-flex h-8 min-h-0 items-center rounded-lg border-0 bg-white/15 px-3 py-0 text-[13px] font-semibold text-current hover:bg-white/25 disabled:opacity-60';

function Banner({ tone, onClose, children }: { tone: 'ok' | 'error'; onClose(): void; children: ReactNode }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`pointer-events-auto flex items-start gap-3 rounded-2xl border px-4 py-3 text-[13.5px] leading-snug shadow-2xl ${
        tone === 'error' ? 'border-red-500/40 bg-red-950/95 text-red-100' : 'border-emerald-500/40 bg-emerald-950/95 text-emerald-100'
      }`}
    >
      <p className="m-0 flex-1">{children}</p>
      <button
        type="button"
        onClick={onClose}
        aria-label="Fermer"
        className="grid size-7 min-h-0 shrink-0 place-items-center rounded-lg border-0 bg-white/10 p-0 text-current hover:bg-white/20"
      >
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
