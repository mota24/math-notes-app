/**
 * Qui a le droit d'ouvrir l'appli. Sans import de valeur : testé directement sous Node (tests/access.test.ts).
 *
 * Le problème corrigé : l'écran « Accès Réservé » laissait entrer N'IMPORTE QUEL compte. Quelqu'un qui prenait
 * la tablette n'avait qu'à toucher « Continuer avec Google » avec SON compte pour voir toutes les notes
 * enregistrées sur l'appareil.
 *
 * Trois règles, dans cet ordre :
 *  0. Adresse vérifiée : un compte e-mail/mot de passe créé avec une adresse qui n'est pas la sienne (ou mal
 *     tapée) n'entre pas tant que le lien de validation n'a pas été cliqué. Google vérifie toujours l'adresse.
 *     Les règles Firestore exigent la même chose : un compte non vérifié ne lit ni n'écrit rien dans le cloud.
 *  1. Liste blanche (VITE_ALLOWED_EMAILS, dans Vercel) : si elle est remplie, seuls ces comptes entrent.
 *  2. Sinon, « propriétaire de l'appareil » : le premier compte connecté sur un appareil en devient le
 *     propriétaire, et tout autre compte y est refusé (sauf la même adresse, vérifiée : compte recréé). Protégé
 *     par défaut, sans rien configurer, et sans risque de s'enfermer dehors à cause d'une variable mal remplie.
 */

export interface Account {
  uid: string;
  email: string | null;
  /** Adresse confirmée (Google : toujours). `false` = refusé ; absent = compte déjà enregistré sur l'appareil */
  emailVerified?: boolean;
}

export const UNVERIFIED_REASON =
  'Adresse e-mail pas encore validée : ouvre le lien reçu par e-mail (regarde aussi les indésirables), puis reconnecte-toi.';

export type Access = { ok: true; claim: boolean } | { ok: false; reason: string };

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** « a@b.fr, c@d.com ; e@f.org » → adresses en minuscules, sans doublons ; ce qui n'est pas une adresse est ignoré. */
export function parseAllowlist(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  const emails = raw
    .split(/[\s,;]+/)
    .map((e) => e.trim().replace(/^["']|["']$/g, '').toLowerCase())
    .filter((e) => EMAIL.test(e));
  return [...new Set(emails)];
}

export function decideAccess(user: Account, allowlist: string[], owner: Account | null): Access {
  if (user.emailVerified === false) return { ok: false, reason: UNVERIFIED_REASON };
  if (allowlist.length) {
    const email = (user.email ?? '').toLowerCase();
    return allowlist.includes(email)
      ? { ok: true, claim: false }
      : { ok: false, reason: `Le compte ${user.email ?? 'utilisé'} n’est pas autorisé à ouvrir cette application.` };
  }
  if (!owner) return { ok: true, claim: true };
  if (owner.uid === user.uid) return { ok: true, claim: false };
  // Même adresse que le propriétaire, VÉRIFIÉE (Google, ou lien reçu par e-mail) : c'est lui, avec un compte
  // recréé (supprimé puis rouvert). Il reprend l'appareil ; sans cela il en restait exclu pour toujours, sauf à
  // effacer les données du site… et ses cahiers avec.
  const email = (user.email ?? '').trim().toLowerCase();
  if (user.emailVerified === true && email && email === (owner.email ?? '').trim().toLowerCase()) return { ok: true, claim: true };
  return {
    ok: false,
    reason: `Cet appareil est réservé au compte ${owner.email ?? 'qui s’y est connecté en premier'}. Connecte-toi avec ce compte.`,
  };
}
