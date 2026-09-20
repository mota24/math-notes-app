import type { Settings } from '../../settings';
import { canUseDrive } from '../../sync/drive';
import { syncController, useSyncState } from '../../sync/useSync';

export function DriveSection({ settings, update }: { settings: Settings; update(patch: Partial<Settings>): void }) {
  const sync = useSyncState();
  const available = canUseDrive();
  const connected = sync.status !== 'disabled' && sync.status !== 'needs-login';
  const origin = window.location.origin;

  return (
    <section>
      <h3>Sauvegarde Google Drive (gratuite)</h3>
      <p className="hint">
        Tout est d’abord enregistré sur l’appareil et marche hors-ligne. Avec Drive, tes dossiers, cahiers, PDF et transcriptions sont
        copiés dans un dossier « Notes Maths (synchronisation) » dès que tu as du réseau, et se retrouvent sur ton PC.
      </p>
      {!available.ok && <p className="lib-error">{available.reason}</p>}
      <label className="field">
        <span>ID client OAuth Google</span>
        <input
          value={settings.driveClientId}
          onChange={(e) => update({ driveClientId: e.target.value.trim() })}
          placeholder="123456789-xxxx.apps.googleusercontent.com"
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      <details className="syntax-help">
        <summary>Comment obtenir l’ID client (5 minutes, gratuit)</summary>
        <ol>
          <li>
            Ouvre{' '}
            <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">
              console.cloud.google.com
            </a>{' '}
            et crée un projet.
          </li>
          <li>« API et services » → « Bibliothèque » → active <strong>Google Drive API</strong>.</li>
          <li>« Écran de consentement OAuth » : type Externe, ajoute ton adresse Gmail comme utilisateur test.</li>
          <li>
            « Identifiants » → « Créer des identifiants » → « ID client OAuth » → <strong>Application Web</strong>, avec comme origine
            JavaScript autorisée : <code>{origin}</code>
          </li>
          <li>Copie l’ID client ici, puis « Se connecter ».</li>
        </ol>
      </details>
      <div className="row">
        {connected ? (
          <>
            <button className="primary" onClick={() => void syncController.syncNow()} disabled={sync.status === 'syncing'}>
              Synchroniser maintenant
            </button>
            <button onClick={() => syncController.disconnect()}>Se déconnecter</button>
          </>
        ) : (
          <button className="primary" disabled={!settings.driveClientId || !available.ok} onClick={() => void syncController.connect()}>
            Se connecter à Google Drive
          </button>
        )}
      </div>
      <p className="hint">
        {sync.status === 'syncing' && sync.progress}
        {sync.lastSyncAt && sync.status !== 'syncing' && `Dernière synchronisation : ${new Date(sync.lastSyncAt).toLocaleString('fr-FR')}`}
        {sync.lastReport && sync.status === 'idle' && ` (${sync.lastReport.pulled} reçus, ${sync.lastReport.pushed} envoyés)`}
      </p>
      {sync.error && <p className="lib-error">{sync.error}</p>}
      <label className="check">
        <input type="checkbox" checked={settings.driveAutoSync} onChange={(e) => update({ driveAutoSync: e.target.checked })} />
        Synchroniser automatiquement (après chaque modification et toutes les 5 minutes)
      </label>
    </section>
  );
}
