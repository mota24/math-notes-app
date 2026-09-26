import { useEffect, useState, useSyncExternalStore } from 'react';
import type { FormEvent } from 'react';
import {
  createUserWithEmailAndPassword,
  fetchSignInMethodsForEmail,
  getRedirectResult,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
} from 'firebase/auth';
import type { AuthCredential } from 'firebase/auth';
import { sameEmail } from '../auth/accountModel';
import { googleProvider, linkPendingCredential, pendingGoogle, signInWithGoogleAddingPassword } from '../auth/linking';
import { SIGNUP_OPEN } from '../auth/useAccess';
import { signupFlow } from '../auth/signupFlow';
import { auth, authMemeOrigine } from '../firebase';

/**
 * Écran de déverrouillage (Firebase Auth, SDK Web). L'appli est privée : cet écran s'affiche à la place de
 * TOUT le site tant que personne n'est connecté.
 *
 * Trois façons d'entrer, qui aboutissent toutes au même contrôle d'accès (src/auth/access.ts) :
 *  - Google, par fenêtre surgissante ;
 *  - e-mail + mot de passe, pour un compte créé ainsi ;
 *  - « Mot de passe oublié ? », qui sert aussi à AJOUTER un mot de passe à un compte créé avec Google.
 *
 * Google et e-mail mènent au MÊME compte pour une même adresse (voir src/auth/linking.ts) :
 *  - mot de passe refusé (compte créé avec Google) : « Continuer avec Google et ajouter ce mot de passe » ;
 *  - Google refusé parce que l'adresse a déjà un compte e-mail : le mot de passe ouvre le compte, et Google
 *    y est relié au passage.
 *
 * À savoir : les notes vivent dans le navigateur (IndexedDB). Ce panneau met l'appli à l'abri d'un regard ou
 * d'une main qui traîne sur la tablette — ce n'est pas un coffre-fort.
 */

type Mode = 'connexion' | 'inscription' | 'oubli';
type Methode = 'google' | 'email' | 'inscription' | 'oubli' | 'liaison';

/** Anneau de focus au clavier, visible sur le fond sombre */
const anneau = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950';
/**
 * Champ de saisie : texte à 16 px — en dessous, Safari (iPhone, iPad) zoome sur toute la page quand on touche le
 * champ — et contour franc ; le focus prend l'accent de l'appli. Indication (« 6 caractères minimum ») lisible
 * (contraste ≈ 7:1) mais plus terne que le texte saisi, pour ne pas la prendre pour une valeur déjà tapée.
 */
const champ =
  'h-12 w-full rounded-xl border border-white/15 bg-white/[0.06] px-4 text-base text-white outline-none transition-colors placeholder:text-zinc-400 focus:border-accent focus:bg-white/[0.08] focus:ring-2 focus:ring-accent/35';
/** Libellé d'un champ : taille normale et contraste net (fini les petites capitales espacées, illisibles) */
const etiquette = 'mb-2 block text-sm font-medium text-zinc-200';
/** Lien : souligné, donc reconnaissable sans compter sur la couleur seule */
const lien = `min-h-0 rounded border-0 bg-transparent p-0 text-sm font-medium text-zinc-300 underline decoration-zinc-600 underline-offset-4 transition-colors hover:text-white hover:decoration-zinc-300 ${anneau}`;
/**
 * Bouton principal : l'accent de l'appli (celui du thème sombre, voir .auth-panel dans styles.css), texte foncé,
 * en casse normale — plus d'aplat blanc en capitales espacées qui « criait » sur le fond noir. Désactivé : gris
 * franc et texte lisible (couleurs explicites ; l'ancienne feuille mettait TOUT bouton désactivé à 40 % d'opacité).
 */
const boutonPrincipal = `h-12 w-full rounded-xl border-0 bg-accent px-4 py-0 text-base font-semibold text-zinc-950 transition-colors duration-150 hover:bg-accent-ink active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-400 disabled:opacity-100 disabled:hover:bg-zinc-800 disabled:active:scale-100 ${anneau}`;
/** Bouton secondaire : contour et fond à peine teinté ; désactivé, même règle que le principal */
const boutonSecondaire = `flex min-h-12 w-full items-center justify-center gap-3 rounded-xl border border-white/20 bg-white/[0.05] px-4 py-2 text-base font-medium text-zinc-100 transition-colors duration-150 hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-transparent disabled:text-zinc-400 disabled:opacity-100 disabled:hover:bg-transparent ${anneau}`;
/** Messages (erreur, information) : texte à taille normale */
const message = 'm-0 rounded-xl border px-4 py-3 text-sm leading-relaxed';

/** L'œil du mot de passe : ouvert (« afficher ») ou barré (« masquer ») */
function Oeil({ barre }: { barre: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-[22px]" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {barre ? (
        <>
          <path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-2.2 3.2" />
          <path d="M6.6 6.6C3.6 8.5 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6" />
          <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
          <path d="m3 3 18 18" />
        </>
      ) : (
        <>
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

/** Ouverte depuis l'écran d'accueil (appli installée), et non dans un onglet du navigateur */
function appliInstallee(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches === true || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

const COMPTE_GOOGLE =
  'Compte créé avec Google ? Le bouton ci-dessous t’y connecte et lui ajoute ce mot de passe. Sans Google : « Mot de passe oublié ? » t’envoie un lien pour en choisir un.';

/** Erreurs après lesquelles « Continuer avec Google et ajouter ce mot de passe » peut débloquer la situation */
const RELIABLE = /invalid-credential|invalid-login-credentials|wrong-password|user-not-found|email-already-in-use/;

function messageClair(code: string, brut: string, methode: Methode): string {
  if (/user-mismatch/.test(code)) return brut;
  if (/invalid-credential|invalid-login-credentials|wrong-password|user-not-found/.test(code))
    return `E-mail ou mot de passe incorrect. ${COMPTE_GOOGLE}`;
  if (/invalid-email|missing-email/.test(code)) return 'Adresse e-mail invalide.';
  if (/missing-password/.test(code)) return 'Saisis ton mot de passe.';
  if (/email-already-in-use/.test(code))
    return `Un compte existe déjà avec cette adresse (peut-être créé avec Google). ${COMPTE_GOOGLE}`;
  if (/weak-password/.test(code)) return 'Mot de passe trop court : 6 caractères minimum.';
  if (/password-does-not-meet-requirements/.test(code))
    return 'Ce mot de passe ne respecte pas les règles du projet (longueur, majuscules, chiffres…).';
  if (/user-disabled/.test(code)) return 'Ce compte a été désactivé dans Firebase.';
  if (/too-many-requests/.test(code)) return 'Trop d’essais. Attends une minute avant de réessayer.';
  if (/network-request-failed/.test(code)) return 'Pas de réseau : impossible de vérifier la connexion.';
  if (/admin-restricted-operation/.test(code))
    return 'La création de compte est désactivée dans Firebase (Authentication → Settings → User actions → « Enable create (sign-up) »).';
  if (/operation-not-allowed/.test(code))
    return methode === 'google'
      ? 'La connexion Google n’est pas activée pour ce projet Firebase (Authentication → Sign-in method → Google).'
      : 'La connexion par e-mail/mot de passe n’est pas activée pour ce projet Firebase (Authentication → Sign-in method → Email/Password).';
  if (/popup-blocked/.test(code))
    return 'Le navigateur a bloqué la fenêtre Google. Autorise les fenêtres pop-up pour ce site (icône dans la barre d’adresse), puis réessaie — ou connecte-toi par e-mail.';
  if (/popup-closed-by-user|cancelled-popup-request|user-cancelled/.test(code))
    return 'La fenêtre Google s’est fermée avant la fin. Réessaie, et va jusqu’au choix du compte.';
  if (/web-storage-unsupported/.test(code))
    return 'Ton navigateur bloque les cookies tiers dont la connexion Google a besoin. Autorise-les pour ce site (ou désactive la protection anti-pistage), ou connecte-toi par e-mail.';
  if (/unauthorized-domain/.test(code))
    return 'Ce site n’est pas dans les domaines autorisés de Firebase (Authentication → Settings → Authorized domains).';
  if (/account-exists-with-different-credential/.test(code))
    return 'Un compte e-mail existe déjà pour cette adresse : entre son mot de passe ci-dessous, Google y sera relié.';
  if (/internal-error/.test(code))
    return 'Firebase n’a pas pu joindre le service de connexion. Vérifie ta connexion, puis réessaie.';
  return brut;
}

const TITRES: Record<Mode, [string, string]> = {
  connexion: ['Accès Réservé', 'Connecte-toi pour ouvrir tes notes'],
  inscription: ['Créer un compte', 'Un e-mail et un mot de passe suffisent'],
  oubli: ['Mot de passe oublié', 'On t’envoie un lien pour en choisir un'],
};

export function AuthPanel({ refus = null }: { refus?: string | null }) {
  const [mode, setMode] = useState<Mode>('connexion');
  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [voirMotDePasse, setVoirMotDePasse] = useState(false);
  // Un compte refusé (non autorisé, ou autre que le propriétaire de l'appareil) : on dit pourquoi
  const [erreur, setErreur] = useState<string | null>(refus);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState<Methode | null>(null);
  /** Dernière erreur de mot de passe (ou d'inscription) qui peut venir d'un compte créé avec Google */
  const [proposerGoogle, setProposerGoogle] = useState(false);
  /** Accès Google refusé faute de liaison : relié dès que le mot de passe aura ouvert le compte */
  const [googleEnAttente, setGoogleEnAttente] = useState<{ credential: AuthCredential; email: string | null } | null>(null);

  // Compte supprimé depuis les Réglages : on le confirme ici, une seule fois
  useEffect(() => {
    try {
      if (sessionStorage.getItem('notes-maths:compte-supprime')) {
        sessionStorage.removeItem('notes-maths:compte-supprime');
        setInfo('Ton compte et toutes ses données en ligne ont été supprimés. Tes cahiers restent sur cet appareil.');
      }
    } catch {
      /* navigation privée */
    }
  }, []);

  useEffect(() => {
    if (refus) setErreur(refus);
  }, [refus]);

  // Retour d'une éventuelle connexion par redirection : on n'en récupère que l'erreur (la session, elle, est
  // reprise toute seule par onAuthStateChanged). L'appel prépare aussi l'iframe de Firebase, ce qui permet à
  // la fenêtre Google de s'ouvrir aussitôt au clic, sans être prise pour une pop-up indésirable.
  useEffect(() => {
    getRedirectResult(auth).catch((e: { code?: string; message?: string }) => {
      setErreur(messageClair(e.code ?? '', e.message ?? 'Connexion impossible.', 'google'));
    });
  }, []);

  const changerMode = (m: Mode) => {
    setMode(m);
    setErreur(null);
    setInfo(null);
    setProposerGoogle(false);
    setGoogleEnAttente(null);
    setMotDePasse('');
    setConfirmation('');
  };

  const lancer = async (methode: Methode, task: () => Promise<unknown>) => {
    setBusy(methode);
    setErreur(null);
    setInfo(null);
    setProposerGoogle(false);
    try {
      await task();
    } catch (e) {
      const err = e as { code?: string; message?: string };
      const code = err.code ?? '';
      // Google refusé : l'adresse a déjà un compte e-mail ; on garde l'accès Google pour le relier ensuite
      const attente = methode === 'google' ? pendingGoogle(e) : null;
      if (attente) {
        setGoogleEnAttente(attente);
        setMode('connexion');
        if (attente.email) setEmail(attente.email);
        setMotDePasse('');
      }
      let message = messageClair(code, err.message ?? 'Connexion impossible.', methode);
      if ((methode === 'email' || methode === 'inscription') && RELIABLE.test(code)) {
        setProposerGoogle(true);
        // Si Firebase veut bien le dire (protection contre l'énumération désactivée), on précise
        const methodes = await fetchSignInMethodsForEmail(auth, email.trim()).catch(() => [] as string[]);
        if (methodes.includes('google.com') && !methodes.includes('password'))
          message = `Ce compte a été créé avec Google et n’a pas encore de mot de passe. ${COMPTE_GOOGLE}`;
      }
      setErreur(message);
    } finally {
      setBusy(null);
    }
  };

  const adresse = email.trim();

  const soumettre = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (mode === 'connexion') {
      if (!adresse || !motDePasse) return;
      const attente = googleEnAttente;
      void lancer('email', async () => {
        const { user } = await signInWithEmailAndPassword(auth, adresse, motDePasse);
        // Google refusé juste avant : il est relié maintenant, la prochaine fois il suffira. Un échec ici
        // n'empêche pas d'entrer (la liaison reste possible dans les Réglages).
        if (attente && (!attente.email || sameEmail(attente.email, user.email))) await linkPendingCredential(user, attente.credential).catch(() => undefined);
      });
    } else if (mode === 'inscription') {
      if (!adresse || !motDePasse) return;
      if (motDePasse.length < 6) return setErreur('Mot de passe trop court : 6 caractères minimum.');
      if (motDePasse !== confirmation) return setErreur('Les deux mots de passe ne sont pas identiques.');
      void lancer('inscription', async () => {
        // Créer le compte, envoyer le lien de vérification, puis déconnecter sans bruit : l'écran affiche ensuite
        // « Compte créé », au lieu d'un refus (« adresse pas encore validée ») qui faisait croire à une erreur
        signupFlow.start();
        let created = false;
        try {
          const { user } = await createUserWithEmailAndPassword(auth, adresse, motDePasse);
          created = true;
          let mailFailed = false;
          try {
            await sendEmailVerification(user);
          } catch {
            mailFailed = true; // il repartira tout seul à la première tentative de connexion
          }
          await signOut(auth);
          signupFlow.finish({ email: user.email ?? adresse, mailFailed });
        } catch (e) {
          if (created) await signOut(auth).catch(() => undefined);
          signupFlow.fail();
          throw e;
        }
      });
    } else {
      if (!adresse) return;
      void lancer('oubli', async () => {
        await sendPasswordResetEmail(auth, adresse);
        // Firebase ne dit pas si l'adresse existe (protection contre l'énumération des comptes) : on reste neutre
        setInfo(
          `Si un compte existe pour ${adresse}, un e-mail vient de partir (regarde aussi les indésirables). Choisis un mot de passe via le lien, puis reviens te connecter.`,
        );
      });
    }
  };

  /**
   * Google : fenêtre surgissante (signInWithPopup). La redirection n'est tentée en secours que si les pages de
   * connexion sont servies par ce site (voir authMemeOrigine) : autrement elle échoue sans bruit sur les
   * navigateurs actuels, et c'est ce qui donnait l'impression que le bouton « ne faisait rien ».
   */
  const parGoogle = () => {
    if (busy) return;
    void lancer('google', async () => {
      const fournisseur = googleProvider();
      // Appli installée (écran d'accueil) : la fenêtre Google s'y ouvre hors de l'appli et ne sait pas lui rendre
      // la main. On passe par une redirection, qui revient dans l'appli, dès que les pages de connexion sont
      // servies par le site lui-même.
      if (authMemeOrigine && appliInstallee()) {
        await signInWithRedirect(auth, fournisseur);
        return;
      }
      try {
        await signInWithPopup(auth, fournisseur);
      } catch (e) {
        const code = (e as { code?: string }).code ?? '';
        if (authMemeOrigine && /popup-blocked|operation-not-supported|web-storage-unsupported/.test(code)) {
          await signInWithRedirect(auth, fournisseur);
          return;
        }
        throw e;
      }
    });
  };

  /** Compte créé avec Google : on y entre par Google, et le mot de passe tapé lui est ajouté */
  const googleEtMotDePasse = () => {
    if (busy) return;
    if (motDePasse.length < 6) return setErreur('Mot de passe trop court : 6 caractères minimum.');
    if (mode === 'inscription' && motDePasse !== confirmation) return setErreur('Les deux mots de passe ne sont pas identiques.');
    void lancer('liaison', () => signInWithGoogleAddingPassword(adresse, motDePasse));
  };

  const inscrit = useSyncExternalStore(signupFlow.subscribe, signupFlow.result);
  const [titre, sousTitre] = TITRES[mode];

  if (inscrit) {
    return (
      <div className="auth-panel fixed inset-0 z-[100] grid place-items-center overflow-auto bg-zinc-950 px-5 py-10">
        <div className="w-full max-w-[380px] text-center" role="status" aria-live="polite">
          <div className="mx-auto mb-6 grid size-16 place-items-center rounded-2xl border border-emerald-400/30 bg-emerald-400/10">
            <svg viewBox="0 0 24 24" className="size-8 text-emerald-300" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m5 12.5 4.5 4.5L19 7.5" />
            </svg>
          </div>
          <h1 className="m-0 text-[26px] font-bold tracking-tight text-white">Compte créé avec succès !</h1>
          <p className="m-0 mt-4 text-base leading-relaxed text-zinc-200">
            Un lien de vérification a été envoyé à <strong className="text-white">{inscrit.email}</strong>. Ouvre-le pour valider ton adresse, puis
            connecte-toi.
          </p>
          <p className="m-0 mt-3 text-sm leading-relaxed text-zinc-300">
            {inscrit.mailFailed
              ? 'L’e-mail n’a pas pu partir tout de suite : il repartira automatiquement à ta première tentative de connexion.'
              : 'Rien reçu d’ici quelques minutes ? Regarde dans les indésirables. Une tentative de connexion renvoie aussi le lien.'}
          </p>
          <button
            type="button"
            onClick={() => {
              signupFlow.clear();
              changerMode('connexion');
              setEmail(inscrit.email);
            }}
            className={`${boutonPrincipal} mt-8`}
          >
            Aller à la page de connexion
          </button>
        </div>
      </div>
    );
  }
  const formulaireIncomplet =
    !adresse || (mode !== 'oubli' && !motDePasse) || (mode === 'inscription' && !confirmation);
  const libelleEnvoi =
    mode === 'connexion'
      ? busy === 'email'
        ? 'Vérification…'
        : 'Déverrouiller'
      : mode === 'inscription'
        ? busy === 'inscription'
          ? 'Création…'
          : 'Créer mon compte'
        : busy === 'oubli'
          ? 'Envoi…'
          : 'Envoyer le lien';

  return (
    <div className="auth-panel fixed inset-0 z-[100] grid place-items-center overflow-auto bg-zinc-950 px-5 py-10">
      <div className="w-full max-w-[380px]">
        {/* Cadenas */}
        <div className="mx-auto mb-6 grid size-16 place-items-center rounded-2xl border border-white/10 bg-white/[0.06]">
          <svg viewBox="0 0 24 24" className="size-7 text-white" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="4" y="10.5" width="16" height="10.5" rx="2.5" />
            <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
            <path d="M12 15v2.5" />
          </svg>
        </div>

        <h1 className="m-0 text-center text-[28px] font-bold tracking-tight text-white">{titre}</h1>
        <p className="m-0 mb-8 mt-2 text-center text-base text-zinc-300">{sousTitre}</p>

        {mode !== 'oubli' && (
          <>
            <button
              type="button"
              onClick={parGoogle}
              disabled={busy !== null}
              className={boutonSecondaire}
            >
              <svg viewBox="0 0 24 24" className="size-5 shrink-0" aria-hidden="true">
                <path fill="#4285F4" d="M23 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.2a5.3 5.3 0 0 1-2.3 3.5v2.9h3.7c2.2-2 3.4-5 3.4-8.5z" />
                <path fill="#34A853" d="M12 23.5c3.1 0 5.7-1 7.6-2.8l-3.7-2.9c-1 .7-2.3 1.1-3.9 1.1-3 0-5.5-2-6.4-4.7H1.8v3A11.5 11.5 0 0 0 12 23.5z" />
                <path fill="#FBBC05" d="M5.6 14.2a6.9 6.9 0 0 1 0-4.4v-3H1.8a11.5 11.5 0 0 0 0 10.4l3.8-3z" />
                <path fill="#EA4335" d="M12 5.1c1.7 0 3.2.6 4.4 1.7l3.3-3.3A11.5 11.5 0 0 0 1.8 6.8l3.8 3c.9-2.7 3.4-4.7 6.4-4.7z" />
              </svg>
              {busy === 'google' ? 'Fenêtre Google ouverte…' : 'Continuer avec Google'}
            </button>

            <div className="my-6 flex items-center gap-3 text-sm text-zinc-300">
              <span className="h-px flex-1 bg-white/15" />
              ou avec ton e-mail
              <span className="h-px flex-1 bg-white/15" />
            </div>
          </>
        )}

        <form onSubmit={soumettre} className="flex flex-col gap-4" noValidate>
          <div>
            <label className={etiquette} htmlFor="auth-id">
              E-mail
            </label>
            <input
              id="auth-id"
              className={champ}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              inputMode="email"
              autoComplete={mode === 'inscription' ? 'email' : 'username'}
              autoCapitalize="none"
              spellCheck={false}
              placeholder="toi@exemple.com"
            />
          </div>

          {mode !== 'oubli' && (
            <div>
              <div className="flex items-baseline justify-between">
                <label className={etiquette} htmlFor="auth-pw">
                  Mot de passe
                </label>
                {mode === 'connexion' && (
                  <button type="button" className={`${lien} mb-2`} onClick={() => changerMode('oubli')}>
                    Mot de passe oublié ?
                  </button>
                )}
              </div>
              <div className="relative">
                <input
                  id="auth-pw"
                  className={`${champ} pr-14`}
                  value={motDePasse}
                  onChange={(e) => setMotDePasse(e.target.value)}
                  type={voirMotDePasse ? 'text' : 'password'}
                  autoComplete={mode === 'inscription' ? 'new-password' : 'current-password'}
                  placeholder={mode === 'inscription' ? '6 caractères minimum' : '••••••••'}
                />
                {/* L'œil : toute la hauteur du champ sur 48 px de large (plus que les 44 px recommandés au doigt) */}
                <button
                  type="button"
                  onClick={() => setVoirMotDePasse((v) => !v)}
                  className={`absolute inset-y-0 right-0 grid w-12 min-h-0 place-items-center rounded-r-xl border-0 bg-transparent p-0 text-zinc-300 transition-colors hover:text-white ${anneau}`}
                  aria-label={voirMotDePasse ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  aria-pressed={voirMotDePasse}
                  title={voirMotDePasse ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                >
                  <Oeil barre={voirMotDePasse} />
                </button>
              </div>
            </div>
          )}

          {mode === 'inscription' && (
            <div>
              <label className={etiquette} htmlFor="auth-pw2">
                Confirme le mot de passe
              </label>
              <input
                id="auth-pw2"
                className={champ}
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                type={voirMotDePasse ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="••••••••"
              />
            </div>
          )}

          {mode === 'oubli' && (
            <p className="m-0 text-sm leading-relaxed text-zinc-300">
              Compte créé avec Google ? Ce lien lui ajoute un mot de passe : tu pourras ensuite entrer avec l’un ou
              l’autre.
            </p>
          )}

          {erreur && (
            <p role="alert" className={`${message} border-red-500/30 bg-red-500/10 text-red-200`}>
              {erreur}
            </p>
          )}
          {/* Toujours là après l'erreur qui l'annonce (« le bouton ci-dessous ») ; actif dès qu'un mot de passe est tapé */}
          {proposerGoogle && mode !== 'oubli' && adresse && (
            <button
              type="button"
              onClick={googleEtMotDePasse}
              disabled={busy !== null || !motDePasse}
              className={boutonSecondaire}
            >
              {busy === 'liaison' ? 'Fenêtre Google ouverte…' : 'Continuer avec Google et ajouter ce mot de passe'}
            </button>
          )}
          {googleEnAttente && mode === 'connexion' && !erreur && (
            <p role="status" className={`${message} border-sky-500/30 bg-sky-500/10 text-sky-100`}>
              Un compte e-mail existe déjà pour cette adresse. Entre son mot de passe : Google y sera relié, et tu pourras
              ensuite entrer avec l’un ou l’autre.
            </p>
          )}
          {info && (
            <p role="status" className={`${message} border-emerald-500/30 bg-emerald-500/10 text-emerald-200`}>
              {info}
            </p>
          )}

          <button
            type="submit"
            disabled={busy !== null || formulaireIncomplet}
            className={`${boutonPrincipal} mt-2`}
          >
            {libelleEnvoi}
          </button>
        </form>

        <div className="mt-6 flex flex-col items-center gap-3">
          {mode === 'connexion' ? (
            SIGNUP_OPEN && (
              <>
                <span className="text-sm text-zinc-300">Pas encore de compte ?</span>
                <button type="button" onClick={() => changerMode('inscription')} className={boutonSecondaire}>
                  Créer un compte
                </button>
              </>
            )
          ) : (
            <button type="button" className={lien} onClick={() => changerMode('connexion')}>
              ← Retour à la connexion
            </button>
          )}
        </div>

        <p className="m-0 mt-10 border-t border-white/10 pt-6 text-center text-sm leading-relaxed text-zinc-300">
          Ce verrou protège l’écran, pas le disque : tes notes restent dans ce navigateur. Le premier compte connecté
          sur cet appareil en devient le propriétaire.
        </p>
      </div>
    </div>
  );
}
