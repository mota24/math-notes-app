import { useEffect, useState } from 'react';
import { sendEmailVerification, signOut } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { db } from '../db/db';
import { auth } from '../firebase';
import { UNVERIFIED_REASON, decideAccess, parseAllowlist } from './access';
import type { Account } from './access';
import { signupFlow } from './signupFlow';

/** Liste blanche facultative, lue au build par Vite (vide si la variable n'est pas définie dans Vercel). */
const ALLOWLIST = parseAllowlist(import.meta.env.VITE_ALLOWED_EMAILS);
/** Liste blanche remplie : un nouveau compte serait refusé de toute façon, inutile de proposer d'en créer un */
export const SIGNUP_OPEN = ALLOWLIST.length === 0;
/** Propriétaire de l'appareil, gardé dans la base locale (jamais synchronisé ni exporté). */
const OWNER_KEY = 'deviceOwner';

/**
 * Suppression du compte : l'appareil n'a plus de propriétaire, le prochain compte connecté le devient. Sans
 * cela, la tablette resterait réservée à un compte qui n'existe plus, et tout nouveau compte y serait refusé.
 */
export async function resetDeviceOwner(): Promise<void> {
  await db.setMeta(OWNER_KEY, null);
}

export interface Gate {
  /** checking : Firebase ou la vérification n'ont pas encore répondu ; open : on entre ; locked : écran de connexion */
  status: 'checking' | 'open' | 'locked';
  /** Pourquoi le dernier compte a été refusé, à afficher sur l'écran de connexion */
  refusal: string | null;
}

/**
 * Porte d'entrée de l'appli. Un compte connecté ne suffit plus : il doit être autorisé (voir access.ts). Un
 * compte refusé est aussitôt déconnecté, et le motif s'affiche sur l'écran « Accès Réservé ».
 */
export function useAccess(user: User | null | undefined): Gate {
  const [status, setStatus] = useState<Gate['status']>('checking');
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    if (user === undefined) {
      setStatus('checking');
      return;
    }
    if (user === null) {
      setStatus('locked');
      return;
    }
    // Compte tout juste créé par l'inscription : l'écran de connexion reste affiché (il va montrer « Compte
    // créé ») et c'est l'inscription qui envoie le lien puis déconnecte. Ni refus, ni second e-mail ici.
    if (signupFlow.isActive() && !user.emailVerified) {
      setStatus('locked');
      return;
    }
    let alive = true;
    setStatus('checking');
    (async () => {
      const owner = (await db.getMeta<Account>(OWNER_KEY)) ?? null;
      const decision = decideAccess({ uid: user.uid, email: user.email, emailVerified: user.emailVerified }, ALLOWLIST, owner);
      if (!alive) return;
      if (decision.ok) {
        // Le propriétaire est retenu sans son état de vérification (il l'était forcément pour entrer)
        if (decision.claim) await db.setMeta(OWNER_KEY, { uid: user.uid, email: user.email });
        setRefusal(null);
        setStatus('open');
      } else {
        setRefusal(decision.reason);
        // Adresse pas encore validée : on (re)envoie le lien avant de déconnecter, sinon il faudrait être
        // connecté pour le redemander. Firebase limite lui-même la fréquence des envois.
        if (decision.reason === UNVERIFIED_REASON) await sendEmailVerification(user).catch(() => undefined);
        await signOut(auth); // user devient null : l'écran de connexion s'affiche avec le motif
      }
    })().catch((e: unknown) => {
      // Vérification impossible (stockage local indisponible) : on reste fermé plutôt que d'ouvrir à l'aveugle
      if (!alive) return;
      setRefusal(`Vérification de l’accès impossible : ${(e as Error)?.message ?? 'erreur inconnue'}.`);
      setStatus('locked');
    });
    return () => {
      alive = false;
    };
  }, [user]);

  return { status, refusal };
}
