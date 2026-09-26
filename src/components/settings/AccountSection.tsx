import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { FormEvent } from 'react';
import { CONFIRM_WORD, confirmTyped, linkErrorMessage } from '../../auth/accountModel';
import { deleteAccount } from '../../auth/deleteAccount';
import { addPassword, linkGoogle, methodsOfUser, reauthenticate } from '../../auth/linking';
import { auth, useAuthUser } from '../../firebase';
import { Carte, Etat, Ligne, bouton, boutonDanger, boutonPrincipal, champ, discret, texte } from './ui';

const IconeCle = (
  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="8" cy="15" r="4" />
    <path d="M10.8 12.2 20 3M16 7l3 3M14 9l2 2" />
  </svg>
);

const Coche = ({ libelle }: { libelle: string }) => (
  <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-emerald-600 dark:text-emerald-400">
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12 5 5L20 7" />
    </svg>
    {libelle}
  </span>
);

const message = (e: unknown, repli: string) => linkErrorMessage((e as { code?: string }).code ?? '', (e as Error)?.message || repli);

/**
 * Le compte : les façons d'y entrer (Google, e-mail + mot de passe — la méthode manquante s'ajoute d'un tap,
 * sur le MÊME compte), puis, tout en bas et à part, la suppression définitive du compte.
 */
export function AccountSection() {
  const user = useAuthUser();
  // providerData change sans que Firebase le signale (liaison) : un compteur force la relecture
  const [, relire] = useState(0);
  const [etat, setEtat] = useState<{ message: string; erreur: boolean } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [ajoutMdp, setAjoutMdp] = useState(false);
  const [mdp, setMdp] = useState('');
  const [mdp2, setMdp2] = useState('');
  const [suppression, setSuppression] = useState(false);

  if (!user) return null;
  const methodes = methodsOfUser(auth.currentUser ?? user);

  const lancer = async (tache: () => Promise<string>) => {
    setOccupe(true);
    setEtat(null);
    try {
      setEtat({ message: await tache(), erreur: false });
    } catch (e) {
      setEtat({ message: message(e, 'Opération impossible.'), erreur: true });
    } finally {
      setOccupe(false);
      relire((n) => n + 1);
    }
  };

  const enregistrerMdp = (e: FormEvent) => {
    e.preventDefault();
    if (mdp.length < 6) return setEtat({ message: 'Mot de passe trop court : 6 caractères minimum.', erreur: true });
    if (mdp !== mdp2) return setEtat({ message: 'Les deux mots de passe ne sont pas identiques.', erreur: true });
    void lancer(async () => {
      await addPassword(mdp);
      setAjoutMdp(false);
      setMdp('');
      setMdp2('');
      return `Mot de passe ajouté : tu peux maintenant entrer avec Google ou avec ${user.email} et ce mot de passe.`;
    });
  };

  return (
    <Carte icone={IconeCle} titre="Compte et connexion" sousTitre="Google et e-mail ouvrent le même compte">
      <Ligne libelle="Google" precision={methodes.google ? 'Connexion en un tap avec ton compte Google.' : 'Relie ton compte Google de la même adresse.'}>
        {methodes.google ? (
          <Coche libelle="Relié" />
        ) : (
          <button type="button" className={bouton} disabled={occupe} onClick={() => void lancer(async () => (await linkGoogle(), 'Google est relié : tu peux maintenant entrer avec Google ou avec ton mot de passe.'))}>
            Relier Google
          </button>
        )}
      </Ligne>
      <Ligne libelle="E-mail et mot de passe" precision={methodes.password ? `Avec ${user.email}.` : 'Pour entrer sans Google, sur n’importe quel appareil.'}>
        {methodes.password ? (
          <Coche libelle="Actif" />
        ) : (
          !ajoutMdp && (
            <button type="button" className={bouton} disabled={occupe} onClick={() => (setAjoutMdp(true), setEtat(null))}>
              Ajouter un mot de passe
            </button>
          )
        )}
      </Ligne>
      {ajoutMdp && !methodes.password && (
        <form onSubmit={enregistrerMdp} className="flex flex-col gap-2 pb-2">
          <input className={champ} type="password" autoComplete="new-password" placeholder="Nouveau mot de passe (6 caractères minimum)" value={mdp} onChange={(e) => setMdp(e.target.value)} />
          <input className={champ} type="password" autoComplete="new-password" placeholder="Confirme le mot de passe" value={mdp2} onChange={(e) => setMdp2(e.target.value)} />
          <div className="flex justify-end gap-2">
            <button type="button" className={bouton} onClick={() => (setAjoutMdp(false), setMdp(''), setMdp2(''))}>
              Annuler
            </button>
            <button type="submit" className={boutonPrincipal} disabled={occupe || !mdp || !mdp2}>
              {occupe ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </form>
      )}
      {etat && <Etat message={etat.message} erreur={etat.erreur} />}

      <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/[0.06] p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[14.5px] font-semibold text-red-600 dark:text-red-400">Supprimer mon compte</div>
            <div className={`mt-0.5 text-[12.5px] leading-snug ${discret}`}>Efface définitivement le compte et toutes ses données en ligne.</div>
          </div>
          <button type="button" className={boutonDanger} onClick={() => setSuppression(true)}>
            Supprimer mon compte
          </button>
        </div>
      </div>
      {suppression && createPortal(<DeleteAccountDialog onClose={() => setSuppression(false)} />, document.body)}
    </Carte>
  );
}

/**
 * Suppression du compte, en deux temps : recopier « SUPPRIMER », puis prouver son identité (Google ou mot de
 * passe) — c'est ce second geste qui lance la suppression. Pendant qu'elle tourne, la boîte ne se ferme pas.
 */
function DeleteAccountDialog({ onClose }: { onClose(): void }) {
  const user = auth.currentUser;
  const [mot, setMot] = useState('');
  const [mdp, setMdp] = useState('');
  const [etape, setEtape] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  if (!user) return null;
  const methodes = methodsOfUser(user);
  const confirme = confirmTyped(mot);
  const enCours = etape !== null;

  const supprimer = async (preuve: { google: true } | { password: string }) => {
    setErreur(null);
    setEtape('Vérification de ton identité…');
    try {
      await reauthenticate(user, preuve);
    } catch (e) {
      setEtape(null);
      setErreur(message(e, 'Vérification impossible.'));
      return;
    }
    try {
      await deleteAccount(setEtape);
      // Le compte n'existe plus : Firebase déconnecte, l'écran « Accès Réservé » remplace l'appli
    } catch (e) {
      setEtape(null);
      setErreur((e as Error)?.message ?? 'Suppression interrompue.');
    }
  };

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !enCours && onClose()}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="suppr-titre">
        <header className="dialog-head">
          <h2 id="suppr-titre">Supprimer mon compte</h2>
          <button className="icon-btn" onClick={onClose} disabled={enCours} aria-label="Fermer">
            ✕
          </button>
        </header>
        <div className="dialog-body flex flex-col gap-3">
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-[13.5px] leading-relaxed text-red-700 dark:text-red-300">
            <strong className="block text-[14.5px]">Action définitive : rien ne pourra être récupéré.</strong>
            Seront supprimés :
            <ul className="m-0 mt-1 pl-5">
              <li>tes cahiers, dossiers, pages, PDF, photos et transcriptions enregistrés en ligne ;</li>
              <li>tes liens de partage (ils cesseront de fonctionner) ;</li>
              <li>la sauvegarde automatique Google Drive (déconnectée ; les fichiers déjà sur ton Drive restent à toi) ;</li>
              <li>
                ton compte <strong>{user.email}</strong>.
              </li>
            </ul>
          </div>
          <p className={`m-0 text-[13px] leading-relaxed ${discret}`}>
            Les cahiers enregistrés sur <strong className={texte}>cet appareil</strong> ne sont pas effacés : ils restent dans ce navigateur. Le prochain compte
            connecté ici en deviendra le propriétaire.
          </p>

          <label className="flex flex-col gap-1.5">
            <span className={`text-[13px] font-medium ${texte}`}>
              Pour confirmer, écris <strong className="font-mono text-red-600 dark:text-red-400">{CONFIRM_WORD}</strong>
            </span>
            <input
              className={champ}
              value={mot}
              onChange={(e) => setMot(e.target.value)}
              disabled={enCours}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
              data-bwignore
              placeholder={CONFIRM_WORD}
            />
          </label>

          {confirme && (
            <div className="flex flex-col gap-2 border-t border-[color:var(--line)] pt-3">
              <span className={`text-[13px] ${discret}`}>Par sécurité, confirme ton identité : la suppression démarre aussitôt après.</span>
              {methodes.google && (
                <button type="button" className={boutonDanger} disabled={enCours} onClick={() => void supprimer({ google: true })}>
                  Confirmer avec Google et supprimer
                </button>
              )}
              {methodes.password && (
                <form
                  className="flex flex-wrap gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (mdp) void supprimer({ password: mdp });
                  }}
                >
                  <input
                    className={`${champ} min-w-[160px] flex-1`}
                    type="password"
                    autoComplete="current-password"
                    placeholder="Ton mot de passe"
                    value={mdp}
                    onChange={(e) => setMdp(e.target.value)}
                    disabled={enCours}
                  />
                  <button type="submit" className={boutonDanger} disabled={enCours || !mdp}>
                    Confirmer et supprimer
                  </button>
                </form>
              )}
            </div>
          )}

          {etape && <Etat message={etape} />}
          {erreur && <Etat message={erreur} erreur />}
        </div>
      </div>
    </div>
  );
}
