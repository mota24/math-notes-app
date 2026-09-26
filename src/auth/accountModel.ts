/**
 * Compte : méthodes de connexion et suppression totale. Sans import de valeur : testé sous Node
 * (tests/account.test.ts). Les appels à Firebase sont dans linking.ts et deleteAccount.ts.
 */

// ------------------------------------------------------------------ méthodes de connexion

export const GOOGLE = 'google.com';
export const PASSWORD = 'password';

/** Quelles méthodes permettent d'entrer sur ce compte (d'après `user.providerData`) */
export function methodsOf(providerIds: readonly string[]): { google: boolean; password: boolean } {
  return { google: providerIds.includes(GOOGLE), password: providerIds.includes(PASSWORD) };
}

/** Deux adresses sont-elles la même (Google renvoie parfois des majuscules) ? */
export const sameEmail = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** Message clair pour une erreur de liaison (ajouter un mot de passe, relier Google, se reconnecter) */
export function linkErrorMessage(code: string, fallback: string): string {
  if (/provider-already-linked/.test(code)) return 'Cette méthode de connexion est déjà reliée à ton compte.';
  if (/credential-already-in-use|email-already-in-use|account-exists-with-different-credential/.test(code))
    return 'Ce compte Google est déjà utilisé par un autre compte de l’appli : il ne peut pas être relié à celui-ci.';
  if (/weak-password/.test(code)) return 'Mot de passe trop court : 6 caractères minimum.';
  if (/password-does-not-meet-requirements/.test(code)) return 'Ce mot de passe ne respecte pas les règles du projet (longueur, majuscules, chiffres…).';
  if (/invalid-credential|wrong-password|invalid-login-credentials/.test(code)) return 'Mot de passe incorrect.';
  if (/user-mismatch/.test(code)) return 'Ce n’est pas le compte connecté : choisis le compte Google de cette adresse.';
  if (/popup-closed-by-user|cancelled-popup-request|user-cancelled/.test(code)) return 'La fenêtre Google s’est fermée avant la fin. Réessaie.';
  if (/popup-blocked/.test(code)) return 'Le navigateur a bloqué la fenêtre Google : autorise les pop-up pour ce site, puis réessaie.';
  if (/too-many-requests/.test(code)) return 'Trop d’essais. Attends une minute avant de réessayer.';
  if (/network-request-failed/.test(code)) return 'Pas de réseau : réessaie une fois en ligne.';
  if (/requires-recent-login/.test(code)) return 'Par sécurité, reconnecte-toi puis recommence.';
  return fallback;
}

// ------------------------------------------------------------------ suppression du compte

/** Mot à recopier pour confirmer la suppression : on ne supprime pas tout d'un tap malheureux */
export const CONFIRM_WORD = 'SUPPRIMER';
export const confirmTyped = (typed: string) => typed.trim().toUpperCase() === CONFIRM_WORD;

export interface WipeDoc {
  id: string;
  data: Record<string, unknown>;
}

/**
 * Ce dont la suppression a besoin dans Firestore (chemins en segments). Les suppressions sont groupées par
 * l'adaptateur ; `flush` les envoie. Les sous-documents partent AVANT leur parent : pour les partages, les
 * règles vérifient l'auteur sur le document principal, qui doit donc encore exister.
 */
export interface WipeStore {
  list(collection: string[]): Promise<WipeDoc[]>;
  /** Les partages dont ce compte est l'auteur */
  ownedShares(uid: string): Promise<WipeDoc[]>;
  exists(doc: string[]): Promise<boolean>;
  remove(doc: string[]): Promise<void>;
  flush(): Promise<void>;
}

export interface WipeReport {
  shares: number;
  pages: number;
  files: number;
  transcripts: number;
}

const count = (v: unknown, max: number) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? Math.min(v, max) : 0);
const keys = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v) : []);

/** Les pages et fonds d'un partage : ceux qu'il annonce (liste, versions, fonds), sans doublon */
export function shareChildren(data: Record<string, unknown>): string[] {
  const pageIds = Array.isArray(data.pageIds) ? data.pageIds.filter((x): x is string => typeof x === 'string') : [];
  return [...new Set([...pageIds, ...keys(data.versions), ...keys(data.bgKeys)])];
}

/**
 * Efface TOUT ce que ce compte a dans Firestore : ses partages (pages et fonds compris), ses pages (et leurs
 * morceaux), ses fichiers (et leurs morceaux d'octets), ses transcriptions, puis son index, ses réglages et
 * l'état de sa sauvegarde. Relancée après un échec, elle reprend sans rien casser (supprimer ce qui n'existe
 * plus ne fait rien).
 */
export async function wipeUserData(store: WipeStore, uid: string, progress: (message: string) => void = () => undefined): Promise<WipeReport> {
  const user = ['users', uid];

  const shares = await store.ownedShares(uid);
  progress(`Suppression des liens de partage (${shares.length})…`);
  for (const s of shares) {
    for (const child of shareChildren(s.data)) {
      await store.remove(['shares', s.id, 'pages', child]);
      await store.remove(['shares', s.id, 'bgs', child]);
    }
  }
  await store.flush();
  for (const s of shares) await store.remove(['shares', s.id]);
  await store.flush();

  const pages = await store.list([...user, 'pages']);
  progress(`Suppression des pages (${pages.length})…`);
  for (const p of pages) {
    for (let n = 0; n < count(p.data.parts, 40); n++) await store.remove([...user, 'pages', p.id, 'parts', String(n)]);
    await store.remove([...user, 'pages', p.id]);
  }
  await store.flush();

  const files = await store.list([...user, 'files']);
  progress(`Suppression des fichiers PDF et photos (${files.length})…`);
  for (const f of files) {
    for (let n = 0; n < count(f.data.chunks, 60); n++) await store.remove([...user, 'files', f.id, 'chunks', String(n)]);
    await store.remove([...user, 'files', f.id]);
  }
  await store.flush();

  const transcripts = await store.list([...user, 'transcripts']);
  progress(`Suppression des transcriptions (${transcripts.length})…`);
  for (const t of transcripts) await store.remove([...user, 'transcripts', t.id]);
  await store.flush();

  progress('Suppression des dossiers, cahiers et réglages…');
  await store.remove([...user, 'state', 'index']);
  await store.remove([...user, 'state', 'prefs']);
  // Écrit par le serveur seul ; le plus souvent déjà effacé par la déconnexion de Drive
  if (await store.exists([...user, 'state', 'backup'])) await store.remove([...user, 'state', 'backup']);
  await store.flush();

  return { shares: shares.length, pages: pages.length, files: files.length, transcripts: transcripts.length };
}
