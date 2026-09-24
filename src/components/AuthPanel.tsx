import { useState } from 'react';
import type { FormEvent } from 'react';
import { GoogleAuthProvider, signInWithEmailAndPassword, signInWithPopup } from 'firebase/auth';
import { auth } from '../firebase';

/**
 * Écran de déverrouillage (Firebase Auth, SDK Web). Il s'affiche à la place de l'appli quand le verrouillage
 * est activé dans les Réglages et que personne n'est connecté.
 *
 * À savoir : les notes vivent dans le navigateur (IndexedDB). Ce panneau met l'appli à l'abri d'un regard ou
 * d'une main qui traîne sur la tablette — ce n'est pas un coffre-fort : qui a l'appareil et sait s'y prendre
 * peut toujours atteindre les données. Pour un vrai cloisonnement, il faut chiffrer les données elles-mêmes.
 */

const champ =
  'h-12 w-full rounded-xl border border-white/10 bg-white/5 px-4 text-[15px] text-white outline-none transition-colors placeholder:text-zinc-600 focus:border-white/40 focus:bg-white/10';
const etiquette = 'mb-1.5 block text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-500';

function messageClair(code: string, brut: string): string {
  if (/invalid-credential|wrong-password|user-not-found|invalid-email/.test(code)) return 'Identifiant ou mot de passe incorrect.';
  if (/too-many-requests/.test(code)) return 'Trop d’essais. Attends une minute avant de réessayer.';
  if (/network-request-failed/.test(code)) return 'Pas de réseau : impossible de vérifier la connexion.';
  if (/operation-not-allowed/.test(code))
    return 'La connexion par mot de passe n’est pas activée pour ce projet Firebase (Console → Authentication → Sign-in method).';
  if (/popup-closed-by-user|cancelled-popup-request/.test(code)) return 'Fenêtre de connexion fermée.';
  return brut;
}

export function AuthPanel() {
  const [identifiant, setIdentifiant] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lancer = async (task: () => Promise<unknown>) => {
    setBusy(true);
    setErreur(null);
    try {
      await task();
    } catch (e) {
      const err = e as { code?: string; message?: string };
      setErreur(messageClair(err.code ?? '', err.message ?? 'Connexion impossible.'));
    } finally {
      setBusy(false);
    }
  };

  const parMotDePasse = (e: FormEvent) => {
    e.preventDefault();
    if (!identifiant.trim() || !motDePasse) return;
    void lancer(() => signInWithEmailAndPassword(auth, identifiant.trim(), motDePasse));
  };

  const parGoogle = () => void lancer(() => signInWithPopup(auth, new GoogleAuthProvider()));

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center overflow-auto bg-zinc-950 px-5 py-10">
      <div className="w-full max-w-[380px]">
        {/* Cadenas */}
        <div className="mx-auto mb-6 grid size-16 place-items-center rounded-2xl border border-white/10 bg-white/[0.06]">
          <svg viewBox="0 0 24 24" className="size-7 text-white" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="4" y="10.5" width="16" height="10.5" rx="2.5" />
            <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
            <path d="M12 15v2.5" />
          </svg>
        </div>

        <h1 className="m-0 text-center text-[28px] font-bold tracking-tight text-white">Accès Réservé</h1>
        <p className="m-0 mb-8 mt-1.5 text-center text-sm text-zinc-500">Saisis tes identifiants</p>

        <form onSubmit={parMotDePasse} className="flex flex-col gap-4">
          <div>
            <label className={etiquette} htmlFor="auth-id">
              Identifiant
            </label>
            <input
              id="auth-id"
              className={champ}
              value={identifiant}
              onChange={(e) => setIdentifiant(e.target.value)}
              type="email"
              autoComplete="username"
              placeholder="toi@exemple.com"
              autoFocus
            />
          </div>
          <div>
            <label className={etiquette} htmlFor="auth-pw">
              Mot de passe
            </label>
            <input
              id="auth-pw"
              className={champ}
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
            />
          </div>

          {erreur && (
            <p role="alert" className="m-0 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-[13px] text-red-300">
              {erreur}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !identifiant.trim() || !motDePasse}
            className="mt-2 h-14 w-full rounded-xl border-0 bg-white p-0 text-[15px] font-bold uppercase tracking-[0.12em] text-zinc-900 transition-all duration-200 hover:bg-zinc-200 active:scale-[0.98] disabled:opacity-40"
          >
            {busy ? 'Vérification…' : 'Déverrouiller'}
          </button>
        </form>

        <div className="my-6 flex items-center gap-3 text-[11px] uppercase tracking-widest text-zinc-600">
          <span className="h-px flex-1 bg-white/10" />
          ou
          <span className="h-px flex-1 bg-white/10" />
        </div>

        <button
          type="button"
          onClick={parGoogle}
          disabled={busy}
          className="flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-white/15 bg-transparent p-0 text-sm font-semibold text-white transition-colors duration-200 hover:bg-white/10 disabled:opacity-40"
        >
          <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
            <path fill="#4285F4" d="M23 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.2a5.3 5.3 0 0 1-2.3 3.5v2.9h3.7c2.2-2 3.4-5 3.4-8.5z" />
            <path fill="#34A853" d="M12 23.5c3.1 0 5.7-1 7.6-2.8l-3.7-2.9c-1 .7-2.3 1.1-3.9 1.1-3 0-5.5-2-6.4-4.7H1.8v3A11.5 11.5 0 0 0 12 23.5z" />
            <path fill="#FBBC05" d="M5.6 14.2a6.9 6.9 0 0 1 0-4.4v-3H1.8a11.5 11.5 0 0 0 0 10.4l3.8-3z" />
            <path fill="#EA4335" d="M12 5.1c1.7 0 3.2.6 4.4 1.7l3.3-3.3A11.5 11.5 0 0 0 1.8 6.8l3.8 3c.9-2.7 3.4-4.7 6.4-4.7z" />
          </svg>
          Continuer avec Google
        </button>

        <p className="mt-8 text-center text-[11px] leading-relaxed text-zinc-600">
          Le compte se crée dans la console Firebase du projet. Ce verrou protège l’écran, pas le disque : tes
          notes restent dans ce navigateur.
        </p>
      </div>
    </div>
  );
}
