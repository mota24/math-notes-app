/**
 * Inscription par e-mail, sans fausse erreur. Firebase connecte le compte qu'il vient de créer ; l'adresse n'étant
 * pas encore vérifiée, la porte d'entrée (useAccess) le refusait aussitôt et l'écran de connexion s'affichait
 * avec « Adresse e-mail pas encore validée » — comme si l'inscription avait échoué.
 *
 * Désormais, pendant une inscription (`start` → `finish` / `fail`), la porte laisse faire : c'est l'inscription
 * elle-même qui envoie le lien de vérification puis déconnecte, sans bruit. Le résultat vit ici, hors de l'écran
 * de connexion : il survit à ce bref passage connecté, et l'écran affiche le message de réussite.
 * Sans import de valeur : testé sous Node (tests/signupFlow.test.ts).
 */

export interface SignupDone {
  email: string;
  /** Le lien de vérification n'a pas pu partir (il repartira à la première tentative de connexion) */
  mailFailed: boolean;
}

let active = false;
let done: SignupDone | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

export const signupFlow = {
  /** Une inscription commence : la porte d'entrée ne refuse pas le compte qui va apparaître */
  start() {
    active = true;
    done = null;
    emit();
  },
  /** Compte créé, lien envoyé (ou non), compte déconnecté : place au message de réussite */
  finish(result: SignupDone) {
    active = false;
    done = result;
    emit();
  },
  /** Échec de la création (adresse déjà prise, mot de passe refusé…) : l'erreur s'affiche comme avant */
  fail() {
    active = false;
    emit();
  },
  /** « Aller à la page de connexion » */
  clear() {
    done = null;
    emit();
  },
  isActive: () => active,
  result: (): SignupDone | null => done,
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
