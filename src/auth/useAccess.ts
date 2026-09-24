import { useEffect, useState } from 'react';
import { signOut } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { db } from '../db/db';
import { auth } from '../firebase';
import { decideAccess, parseAllowlist } from './access';
import type { Account } from './access';

/** Liste blanche facultative, lue au build par Vite (vide si la variable n'est pas définie dans Vercel). */
const ALLOWLIST = parseAllowlist(import.meta.env.VITE_ALLOWED_EMAILS);
/** Propriétaire de l'appareil, gardé dans la base locale (jamais synchronisé ni exporté). */
const OWNER_KEY = 'deviceOwner';

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
    let alive = true;
    setStatus('checking');
    (async () => {
      const owner = (await db.getMeta<Account>(OWNER_KEY)) ?? null;
      const decision = decideAccess({ uid: user.uid, email: user.email }, ALLOWLIST, owner);
      if (!alive) return;
      if (decision.ok) {
        if (decision.claim) await db.setMeta(OWNER_KEY, { uid: user.uid, email: user.email });
        setRefusal(null);
        setStatus('open');
      } else {
        setRefusal(decision.reason);
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
