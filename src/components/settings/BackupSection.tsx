import { useRef, useState } from 'react';
import { createBackup, restoreBackup } from '../../db/backup';
import { downloadBlob } from '../../export/download';
import type { Settings } from '../../settings';
import { canUseDrive, currentToken, ensureFolder, signIn, uploadFile } from '../../sync/drive';

export function BackupSection({ settings }: { settings: Settings }) {
  const [status, setStatus] = useState<{ message: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const driveAvailable = canUseDrive();
  const run = async (task: () => Promise<string>) => {
    setBusy(true);
    setStatus(null);
    try {
      setStatus({ message: await task(), error: false });
    } catch (e) {
      setStatus({ message: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section>
      <h3>Sauvegarde sur fichier</h3>
      <p className="hint">
        Sans compte Google : un fichier avec tous tes dossiers, cahiers, PDF, transcriptions et ton écriture. Restaurer fusionne
        (la version la plus récente de chaque élément gagne).
      </p>
      <div className="row">
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const blob = await createBackup();
              await downloadBlob(blob, `notes-maths-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`);
              return `Sauvegarde créée (${(blob.size / 1024 / 1024).toFixed(1)} Mo).`;
            })
          }
        >
          Télécharger une sauvegarde
        </button>
        <button disabled={busy} onClick={() => input.current?.click()}>
          Restaurer une sauvegarde…
        </button>
        <button
          disabled={busy || !driveAvailable.ok || !settings.driveClientId.trim()}
          title={!driveAvailable.ok ? driveAvailable.reason : !settings.driveClientId.trim() ? 'Renseigne d’abord l’ID client OAuth Google ci-dessus.' : undefined}
          onClick={() =>
            void run(async () => {
              // Envoi seul (upload) : ce bouton ne supprime ni ne remplace jamais rien, ni en local ni sur Drive.
              const token = currentToken() ?? (await signIn(settings.driveClientId));
              const folderId = await ensureFolder(token);
              const blob = await createBackup();
              const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
              await uploadFile(token, folderId, `sauvegarde-${stamp}.json`, blob);
              return `Sauvegarde envoyée sur Drive (${(blob.size / 1024 / 1024).toFixed(1)} Mo).`;
            })
          }
        >
          Sauvegarder sur Drive
        </button>
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void run(async () => `Restauration terminée : ${(await restoreBackup(file)).imported} élément(s) importé(s).`);
          }}
        />
      </div>
      {busy && (
        <p className="loading">
          <span className="spinner" /> En cours…
        </p>
      )}
      {status && <p className={status.error ? 'lib-error' : 'hint'}>{status.message}</p>}
    </section>
  );
}
