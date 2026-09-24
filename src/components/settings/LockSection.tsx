import { signOut } from 'firebase/auth';
import { auth, useAuthUser } from '../../firebase';

/**
 * Le compte qui a ouvert l'appli. L'accès est réservé et systématique : il n'y a rien à activer ici, la
 * connexion est demandée à chaque ouverture (voir AuthPanel et la porte d'entrée dans App.tsx).
 */
export function LockSection() {
  const user = useAuthUser();

  return (
    <section>
      <h3>Compte et accès</h3>
      <p className="hint">
        L’application est privée : l’écran « Accès Réservé » s’affiche à chaque ouverture et rien n’est visible
        sans être connecté. Les comptes se gèrent dans la console Firebase du projet (Authentication → Users).
      </p>
      <p className="hint">{user ? `Connecté : ${user.email ?? 'compte Google'}` : 'Personne n’est connecté.'}</p>
      {user && (
        <div className="row">
          <button onClick={() => void signOut(auth)}>Se déconnecter</button>
        </div>
      )}
      <p className="hint">
        À savoir : tes notes vivent dans ce navigateur (IndexedDB). Ce verrou protège l’écran, pas le disque.
      </p>
    </section>
  );
}
