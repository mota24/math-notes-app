import {
  EmailAuthProvider,
  GoogleAuthProvider,
  linkWithCredential,
  linkWithPopup,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  signInWithPopup,
  signOut,
  unlink,
} from 'firebase/auth';
import type { AuthCredential, User } from 'firebase/auth';
import { auth } from '../firebase';
import { GOOGLE, methodsOf, sameEmail } from './accountModel';

/**
 * Plusieurs façons d'entrer sur le MÊME compte : Google et e-mail + mot de passe. Firebase garde un seul compte
 * par adresse ; on relie donc la méthode manquante au compte existant (linkWithCredential / linkWithPopup)
 * au lieu d'échouer.
 */

/** Erreur à code, comme celles de Firebase, pour les cas que l'appli refuse elle-même */
const fail = (code: string, message: string) => Object.assign(new Error(message), { code });
const codeOf = (e: unknown) => (e as { code?: string })?.code ?? '';

export function googleProvider(email?: string | null): GoogleAuthProvider {
  const p = new GoogleAuthProvider();
  p.setCustomParameters(email ? { prompt: 'select_account', login_hint: email } : { prompt: 'select_account' });
  return p;
}

export const methodsOfUser = (user: User) => methodsOf(user.providerData.map((p) => p.providerId));

/** Relie un mot de passe au compte connecté ; « déjà relié » n'est pas une erreur */
async function linkPassword(user: User, email: string, password: string) {
  try {
    await linkWithCredential(user, EmailAuthProvider.credential(email, password));
  } catch (e) {
    if (!/provider-already-linked/.test(codeOf(e))) throw e;
  }
}

/**
 * Écran de connexion, compte créé avec Google : on passe par Google (même adresse), puis le mot de passe tapé
 * est ajouté au compte. Ensuite, les deux méthodes marchent.
 */
export async function signInWithGoogleAddingPassword(email: string, password: string): Promise<void> {
  const { user } = await signInWithPopup(auth, googleProvider(email));
  if (!sameEmail(user.email, email)) {
    await signOut(auth);
    throw fail('auth/user-mismatch', `Le compte Google choisi (${user.email ?? 'sans adresse'}) n’est pas ${email}. Recommence en choisissant ce compte-là.`);
  }
  await linkPassword(user, email, password);
}

/**
 * Connexion Google refusée parce que l'adresse a déjà un compte e-mail + mot de passe : l'accès Google en
 * attente est relié dès que le mot de passe a ouvert le compte. Sans effet (et sans erreur) s'il l'est déjà.
 */
export async function linkPendingCredential(user: User, credential: AuthCredential): Promise<void> {
  try {
    await linkWithCredential(user, credential);
  } catch (e) {
    if (!/provider-already-linked|credential-already-in-use/.test(codeOf(e))) throw e;
  }
}

/** L'accès Google en attente, tiré d'une erreur « account-exists-with-different-credential » */
export function pendingGoogle(e: unknown): { credential: AuthCredential; email: string | null } | null {
  if (!/account-exists-with-different-credential/.test(codeOf(e))) return null;
  const credential = GoogleAuthProvider.credentialFromError(e as Parameters<typeof GoogleAuthProvider.credentialFromError>[0]);
  const email = (e as { customData?: { email?: string } }).customData?.email ?? null;
  return credential ? { credential, email } : null;
}

/**
 * Preuve d'identité récente, exigée par Firebase pour les opérations sensibles (ajouter un mot de passe,
 * supprimer le compte) : par Google si le compte y est relié, sinon par le mot de passe.
 */
export async function reauthenticate(user: User, how: { google: true } | { password: string }): Promise<void> {
  if ('google' in how) {
    await reauthenticateWithPopup(user, googleProvider(user.email));
    return;
  }
  if (!user.email) throw fail('auth/missing-email', 'Ce compte n’a pas d’adresse e-mail.');
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, how.password));
}

/** Réglages : ajoute un mot de passe à un compte Google (reconnexion Google si Firebase l'exige). */
export async function addPassword(password: string): Promise<void> {
  const user = auth.currentUser;
  if (!user?.email) throw fail('auth/no-current-user', 'Connecte-toi d’abord.');
  try {
    await linkPassword(user, user.email, password);
  } catch (e) {
    if (!/requires-recent-login/.test(codeOf(e)) || !methodsOfUser(user).google) throw e;
    await reauthenticate(user, { google: true });
    await linkPassword(user, user.email, password);
  }
  await user.reload();
}

/** Réglages : relie le compte Google DE LA MÊME ADRESSE à un compte e-mail + mot de passe. */
export async function linkGoogle(): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw fail('auth/no-current-user', 'Connecte-toi d’abord.');
  const { user: linked } = await linkWithPopup(user, googleProvider(user.email));
  const google = linked.providerData.find((p) => p.providerId === GOOGLE);
  if (google && !sameEmail(google.email, user.email)) {
    // Un autre compte Google (autre adresse) : on défait, pour ne pas mélanger deux identités
    await unlink(linked, GOOGLE);
    throw fail('auth/user-mismatch', `Choisis le compte Google de ${user.email} (pas ${google.email}).`);
  }
  await user.reload();
}
