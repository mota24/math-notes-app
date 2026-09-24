import { useState } from 'react';
import type { Settings } from '../../settings';
import { canConnectFirestore, connectFirestore, disconnectFirestore, useFirestoreState } from '../../sync/useFirestore';

/**
 * Synchronisation temps réel Firestore — expérimentale, à activer soi-même. Décochée, elle n'ouvre aucune
 * connexion : l'appli reste hors-ligne + Drive comme avant. Les PDF importés ne sont jamais envoyés.
 */
export function FirestoreSection({ settings, update }: { settings: Settings; update(patch: Partial<Settings>): void }) {
  const s = useFirestoreState();
  const can = canConnectFirestore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      await connectFirestore();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const statut = () => {
    switch (s.status) {
      case 'live':
        return `Connecté${s.email ? ` (${s.email})` : ''}${s.lastPushAt ? ` · dernier envoi à ${new Date(s.lastPushAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''}${
          s.pending ? ' · modifications en attente…' : ''
        }`;
      case 'connecting':
        return 'Connexion à Firestore…';
      case 'signed-out':
        return 'Active la synchro puis connecte-toi avec Google.';
      case 'error':
        return null;
      default:
        return null;
    }
  };

  return (
    <section>
      <h3>Synchronisation temps réel (Firestore) · expérimental</h3>
      <p className="hint">
        Tes dossiers, cahiers, pages, transcriptions et tâches se retrouvent en temps réel sur tous tes appareils
        connectés au même compte Google. Les PDF importés restent sur l’appareil (ils ne sont pas envoyés). C’est
        gratuit (plan Spark de Firebase) ; les envois sont regroupés pour rester bien en dessous des quotas.
      </p>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.firestoreSync}
          onChange={(e) => {
            update({ firestoreSync: e.target.checked });
            if (!e.target.checked) setError(null);
          }}
        />
        Activer la synchronisation temps réel
      </label>

      {settings.firestoreSync && (
        <>
          {!can.ok && <p className="lib-error">{can.reason}</p>}
          <div className="row">
            {s.status === 'live' || s.status === 'connecting' ? (
              <button onClick={() => void disconnectFirestore()}>Se déconnecter</button>
            ) : (
              <button className="primary" disabled={busy || !can.ok} onClick={() => void connect()}>
                Se connecter avec Google
              </button>
            )}
          </div>
          {statut() && <p className="hint">{statut()}</p>}
          {s.skippedHeavy > 0 && (
            <p className="hint">
              {s.skippedHeavy} page(s) trop lourde(s) (images collées) non synchronisée(s) : elles restent
              disponibles sur cet appareil. Astuce : convertis une image collée volumineuse ou allège la page.
            </p>
          )}
          {(error || (s.status === 'error' && s.error)) && <p className="lib-error">{error ?? s.error}</p>}
          <p className="hint">
            Sur l’APK Android, la connexion Google native demande une étape de configuration supplémentaire
            (google-services.json et empreinte SHA-1) ; en attendant, utilise la synchro sur le PC ou dans le
            navigateur de la tablette. La sauvegarde Drive et la sauvegarde par fichier restent disponibles dans
            tous les cas.
          </p>
        </>
      )}
    </section>
  );
}
