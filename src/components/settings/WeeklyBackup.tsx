import { useState } from 'react';
import { backupHealth, formatBytes } from '../../sync/backupHealth';
import { connectGoogleDrive, runBackupNow, useBackupStatus } from '../../sync/driveBackup';
import { Etat, Ligne, bouton, boutonPrincipal, discret } from './ui';

const quand = (t: number) =>
  new Date(t).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * La sauvegarde hebdomadaire sur Google Drive, dans la carte « Cloud & Sauvegarde » : son état (dernière
 * sauvegarde, échec), la connexion à Drive (une fois), et « Sauvegarder maintenant ».
 */
export function WeeklyBackup({ syncOn }: { syncOn: boolean }) {
  const { doc, error } = useBackupStatus();
  const health = backupHealth(doc, Date.now());
  const [busy, setBusy] = useState<'backup' | 'connect' | null>(null);
  const [etat, setEtat] = useState<{ message: string; erreur: boolean } | null>(null);
  const connected = health.kind !== 'not-connected' && !(health.kind === 'failed' && health.reconnect);

  const lancer = async (which: 'backup' | 'connect') => {
    setBusy(which);
    setEtat(null);
    try {
      if (which === 'connect') await connectGoogleDrive();
      else {
        const done = await runBackupNow();
        setEtat({ message: `Sauvegarde envoyée : ${done.fileName ?? 'fichier sur Drive'}${done.bytes ? ` (${formatBytes(done.bytes)})` : ''}.`, erreur: false });
      }
    } catch (e) {
      setEtat({ message: (e as Error).message, erreur: true });
    } finally {
      setBusy(null);
    }
  };

  const precision =
    health.kind === 'ok' && doc
      ? `Dernière : ${quand(health.at)}${doc.fileName ? ` · ${doc.fileName}` : ''}${doc.bytes ? ` · ${formatBytes(doc.bytes)}` : ''}`
      : health.kind === 'failed'
        ? null
        : health.kind === 'stale'
          ? null
          : health.kind === 'waiting'
            ? 'Connectée : la première sauvegarde partira dimanche vers 3 h (ou tout de suite avec « Sauvegarder maintenant »).'
            : 'Chaque dimanche vers 3 h, une copie complète (cahiers, pages, PDF, réglages) dans le dossier « Sauvegardes Math-Notes » de ton Drive.';

  return (
    <>
      <Ligne
        libelle="Sauvegarde hebdomadaire sur Google Drive"
        precision={
          precision ?? (
            <span className="text-red-600 dark:text-red-400">
              {health.kind === 'failed' ? `Échec le ${quand(health.at)} : ${health.error}` : health.kind === 'stale' ? `Aucune sauvegarde réussie depuis ${health.days} jours.` : ''}
            </span>
          )
        }
      >
        {connected ? (
          <button type="button" className={boutonPrincipal} disabled={busy !== null} onClick={() => void lancer('backup')}>
            {busy === 'backup' ? 'Sauvegarde…' : 'Sauvegarder maintenant'}
          </button>
        ) : (
          <button type="button" className={boutonPrincipal} disabled={busy !== null} onClick={() => void lancer('connect')}>
            {busy === 'connect' ? 'Ouverture…' : health.kind === 'failed' ? 'Reconnecter Google Drive' : 'Connecter Google Drive'}
          </button>
        )}
      </Ligne>
      {!syncOn && (
        <Etat message="La sauvegarde copie ce qui est dans le cloud : active la synchronisation en temps réel ci-dessus sur l’appareil où sont tes cahiers." erreur />
      )}
      {error && <Etat message={error} erreur />}
      {busy === 'backup' && <Etat message="Sauvegarde en cours : avec de gros PDF, compte une à deux minutes." />}
      {etat && <Etat message={etat.message} erreur={etat.erreur} />}
      {doc?.warnings && doc.warnings.length > 0 && health.kind === 'ok' && (
        <Etat message={`Dernière sauvegarde incomplète : ${doc.warnings.join(' ')}`} erreur />
      )}
      {connected && (
        <p className={`m-0 -mt-1 pb-1 text-[12.5px] ${discret}`}>
          Autorisation Drive perdue ou autre compte Google ?{' '}
          <button type="button" className={`${bouton} h-auto min-h-0 border-0 bg-transparent p-0 text-[12.5px] text-accent underline-offset-2 hover:underline`} onClick={() => void lancer('connect')}>
            Reconnecter Google Drive
          </button>
        </p>
      )}
    </>
  );
}
