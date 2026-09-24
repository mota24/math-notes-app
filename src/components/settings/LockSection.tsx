import { signOut } from 'firebase/auth';
import { auth, useAuthUser } from '../../firebase';
import type { Settings } from '../../settings';

/**
 * Verrouillage de l'appli derrière l'écran « Accès Réservé » (Firebase Auth, SDK Web). Décoché par défaut :
 * il faut un compte du projet Firebase pour entrer une fois activé.
 */
export function LockSection({ settings, update }: { settings: Settings; update(patch: Partial<Settings>): void }) {
  const user = useAuthUser();

  return (
    <section>
      <h3>Verrouiller l’application</h3>
      <p className="hint">
        Affiche un écran de connexion au démarrage. Crée d’abord ton compte dans la console Firebase du projet
        (Authentication → Users), sinon tu ne pourras pas entrer. La connexion Google fonctionne aussi.
      </p>
      <label className="check">
        <input type="checkbox" checked={settings.lockEnabled} onChange={(e) => update({ lockEnabled: e.target.checked })} />
        Demander une connexion à l’ouverture
      </label>
      <p className="hint">
        {user ? `Connecté : ${user.email ?? 'compte Google'}` : 'Personne n’est connecté pour l’instant.'}
      </p>
      {user && (
        <div className="row">
          <button onClick={() => void signOut(auth)}>Se déconnecter</button>
        </div>
      )}
      <p className="hint">
        À savoir : tes notes vivent dans ce navigateur. Ce verrou met l’appli à l’abri d’un regard ou d’une main
        qui traîne — ce n’est pas un coffre-fort, et il ne chiffre pas les données.
      </p>
    </section>
  );
}
