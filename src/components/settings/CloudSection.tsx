import { useRef, useState } from 'react';
import { signOut } from 'firebase/auth';
import { createBackup, restoreBackup } from '../../db/backup';
import { downloadBlob } from '../../export/download';
import { auth, useAuthUser } from '../../firebase';
import type { Settings } from '../../settings';
import { canUseDrive, currentToken, ensureFolder, signIn, uploadFile } from '../../sync/drive';
import { useFirestoreState } from '../../sync/useFirestore';
import { syncController, useSyncState } from '../../sync/useSync';
import { Carte, Etat, Interrupteur, Ligne, bouton, boutonDanger, boutonPrincipal, champ, discret, texte } from './ui';

const heure = (t: number) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

const IconeNuage = (
  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M7 18.5h10.2a4.3 4.3 0 0 0 .6-8.56A6 6 0 0 0 6.2 11.2 3.7 3.7 0 0 0 7 18.5z" />
  </svg>
);

/**
 * Tout ce qui touche au compte et à la conservation des notes, réuni en une seule carte : qui est connecté
 * (et la déconnexion), la synchronisation temps réel, la copie de sauvegarde sur fichier, et Google Drive,
 * replié parce qu'il ne sert plus que de copie de secours facultative.
 */
export function CloudSection({ settings, update }: { settings: Settings; update(patch: Partial<Settings>): void }) {
  const user = useAuthUser();
  const fs = useFirestoreState();
  const drive = useSyncState();
  const driveDispo = canUseDrive();
  const driveConnecte = drive.status !== 'disabled' && drive.status !== 'needs-login';
  const fichier = useRef<HTMLInputElement>(null);
  const [etat, setEtat] = useState<{ message: string; erreur: boolean } | null>(null);
  const [occupe, setOccupe] = useState(false);

  const lancer = async (tache: () => Promise<string>) => {
    setOccupe(true);
    setEtat(null);
    try {
      setEtat({ message: await tache(), erreur: false });
    } catch (e) {
      setEtat({ message: (e as Error).message, erreur: true });
    } finally {
      setOccupe(false);
    }
  };

  const etatTempsReel = !settings.firestoreSync
    ? 'Désactivée : tes notes restent seulement sur cet appareil.'
    : fs.status === 'error'
      ? null
      : fs.syncing || fs.status === 'connecting'
        ? 'Envoi en cours…'
        : fs.pending
          ? 'Modifications en attente d’envoi…'
          : fs.lastPushAt
            ? `À jour sur tous tes appareils · ${heure(fs.lastPushAt)}`
            : 'À jour sur tous tes appareils.';

  const initiale = (user?.email ?? user?.displayName ?? '?').trim().charAt(0).toUpperCase();

  return (
    <Carte icone={IconeNuage} titre="Cloud & Sauvegarde">
      {/* Compte */}
      <div className="flex items-center gap-3 py-2.5">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent text-[17px] font-bold text-white">{initiale}</span>
        <div className="min-w-0 flex-1">
          <div className={`truncate text-[14.5px] font-semibold ${texte}`}>{user?.email ?? user?.displayName ?? 'Compte'}</div>
          <div className={`text-[12.5px] ${discret}`}>Connecté · accès réservé</div>
        </div>
        <button type="button" className={boutonDanger} onClick={() => void signOut(auth)}>
          <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 17l5-5-5-5M20 12H9M11 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5" />
          </svg>
          Se déconnecter
        </button>
      </div>

      {/* Synchronisation temps réel */}
      <Ligne
        libelle="Synchronisation en temps réel"
        precision={
          etatTempsReel ?? <span className="text-red-600 dark:text-red-400">{fs.error}</span>
        }
      >
        <Interrupteur actif={settings.firestoreSync} onChange={(v) => update({ firestoreSync: v })} libelle="Synchronisation en temps réel" />
      </Ligne>
      {settings.firestoreSync && fs.skippedHeavy > 0 && (
        <Etat message={`${fs.skippedHeavy} page(s) trop lourde(s) (images collées) restée(s) sur cet appareil.`} />
      )}

      {/* Copie sur fichier */}
      <Ligne libelle="Copie de sauvegarde" precision="Un fichier avec tous tes cahiers, à garder où tu veux.">
        <button
          type="button"
          className={bouton}
          disabled={occupe}
          onClick={() =>
            void lancer(async () => {
              const blob = await createBackup();
              await downloadBlob(blob, `notes-maths-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`);
              return `Copie téléchargée (${(blob.size / 1024 / 1024).toFixed(1)} Mo).`;
            })
          }
        >
          Télécharger
        </button>
        <button type="button" className={bouton} disabled={occupe} onClick={() => fichier.current?.click()}>
          Restaurer…
        </button>
        <input
          ref={fichier}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void lancer(async () => `Restauration terminée : ${(await restoreBackup(f)).imported} élément(s) ajouté(s) ou mis à jour.`);
          }}
        />
      </Ligne>
      {occupe && <Etat message="En cours…" />}
      {etat && <Etat message={etat.message} erreur={etat.erreur} />}

      {/* Google Drive : copie de secours facultative, repliée */}
      <details className="group mt-1 border-t border-[color:var(--line)] pt-2.5">
        <summary className={`flex cursor-pointer list-none items-center justify-between py-1.5 text-[14.5px] font-medium ${texte} [&::-webkit-details-marker]:hidden`}>
          <span>
            Google Drive <span className={`text-[12.5px] font-normal ${discret}`}>· copie de secours, facultatif</span>
          </span>
          <svg viewBox="0 0 24 24" className={`size-4 transition-transform duration-200 group-open:rotate-90 ${discret}`} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M9 5l7 7-7 7" />
          </svg>
        </summary>

        <div className="flex flex-col gap-3 pb-1 pt-2">
          {!driveDispo.ok && <Etat message={driveDispo.reason ?? 'Indisponible ici.'} erreur />}
          <label className="flex flex-col gap-1.5">
            <span className={`text-[12.5px] font-medium ${discret}`}>ID client OAuth Google</span>
            <input
              className={champ}
              value={settings.driveClientId}
              onChange={(e) => update({ driveClientId: e.target.value.trim() })}
              placeholder="123456789-xxxx.apps.googleusercontent.com"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <details className={`text-[12.5px] ${discret}`}>
            <summary className="cursor-pointer text-accent">Comment l’obtenir (5 min, gratuit)</summary>
            <ol className="m-0 mt-1.5 flex flex-col gap-1 pl-5">
              <li>console.cloud.google.com → créer un projet, activer « Google Drive API ».</li>
              <li>Écran de consentement OAuth : type Externe, ajoute ton adresse en utilisateur test.</li>
              <li>
                Identifiants → ID client OAuth → Application Web, origine autorisée : <code>{window.location.origin}</code>
              </li>
              <li>Colle l’ID ici puis « Connecter ».</li>
            </ol>
          </details>
          <div className="flex flex-wrap gap-2">
            {driveConnecte ? (
              <>
                <button type="button" className={boutonPrincipal} disabled={drive.status === 'syncing'} onClick={() => void syncController.syncNow()}>
                  Synchroniser
                </button>
                <button type="button" className={bouton} onClick={() => syncController.disconnect()}>
                  Déconnecter
                </button>
              </>
            ) : (
              <button type="button" className={boutonPrincipal} disabled={!settings.driveClientId || !driveDispo.ok} onClick={() => void syncController.connect()}>
                Connecter
              </button>
            )}
            <button
              type="button"
              className={bouton}
              disabled={occupe || !driveDispo.ok || !settings.driveClientId}
              onClick={() =>
                void lancer(async () => {
                  // Envoi seul : ce bouton ne supprime ni ne remplace jamais rien, ni ici ni sur Drive
                  const token = currentToken() ?? (await signIn(settings.driveClientId));
                  const dossier = await ensureFolder(token);
                  const blob = await createBackup();
                  const tampon = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
                  await uploadFile(token, dossier, `sauvegarde-${tampon}.json`, blob);
                  return `Copie envoyée sur Drive (${(blob.size / 1024 / 1024).toFixed(1)} Mo).`;
                })
              }
            >
              Envoyer une copie
            </button>
          </div>
          <Ligne libelle="Synchroniser Drive automatiquement">
            <Interrupteur actif={settings.driveAutoSync} onChange={(v) => update({ driveAutoSync: v })} libelle="Synchroniser Drive automatiquement" />
          </Ligne>
          {drive.status === 'syncing' && <Etat message={drive.progress || 'Synchronisation…'} />}
          {drive.lastSyncAt && drive.status !== 'syncing' && <Etat message={`Dernière synchronisation Drive : ${new Date(drive.lastSyncAt).toLocaleString('fr-FR')}`} />}
          {drive.error && <Etat message={drive.error} erreur />}
        </div>
      </details>
    </Carte>
  );
}
