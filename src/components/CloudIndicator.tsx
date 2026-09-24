import { syncFirestoreNow, useFirestoreState } from '../sync/useFirestore';

const heure = (t: number) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/**
 * Petit nuage d'état de la synchronisation temps réel : gris quand tout est à jour, bleu et animé quand un
 * envoi est en cours ou attend, rouge en cas d'erreur. Un tap envoie tout de suite. Absent quand la synchro
 * n'est pas activée (rien à signaler).
 */
export function CloudIndicator({ className = '' }: { className?: string }) {
  const s = useFirestoreState();
  if (s.status === 'off' || s.status === 'signed-out') return null;

  // Hors ligne passe avant tout : un envoi « en cours » attend en fait le retour du réseau
  const horsLigne = s.offline;
  const enErreur = !horsLigne && s.status === 'error';
  const enCours = !horsLigne && !enErreur && (s.syncing || s.status === 'connecting');
  const enAttente = !horsLigne && !enErreur && !enCours && s.pending;

  const titre = horsLigne
    ? 'Hors ligne : tes modifications partiront au retour du réseau'
    : enErreur
    ? `Synchronisation en échec (nouvel essai automatique) : ${s.error}`
    : enCours
      ? 'Envoi en cours…'
      : enAttente
        ? 'Modifications en attente d’envoi (tap pour envoyer maintenant)'
        : s.lastPushAt
          ? `Tout est synchronisé (dernier envoi à ${heure(s.lastPushAt)})`
          : 'Tout est synchronisé';

  const teinte = enErreur ? 'text-red-500' : enCours || enAttente ? 'text-accent' : 'text-zinc-400 dark:text-zinc-500';

  return (
    <button
      type="button"
      onClick={syncFirestoreNow}
      title={titre}
      aria-label={titre}
      className={`relative inline-grid size-9 min-h-0 shrink-0 place-items-center rounded-full border-0 bg-transparent p-0 transition-colors duration-200 hover:bg-black/5 dark:hover:bg-white/10 ${teinte} ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        className={`size-[21px] ${enCours ? 'animate-pulse' : ''}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M7 18.5h10.2a4.3 4.3 0 0 0 .6-8.56A6 6 0 0 0 6.2 11.2 3.7 3.7 0 0 0 7 18.5z" />
        {horsLigne ? (
          <path d="M4 4l16 16" />
        ) : enErreur ? (
          <path d="M12 10.5v3.2M12 16.1h.01" />
        ) : enCours || enAttente ? (
          <path d="M12 16.2v-5.4M9.8 13l2.2-2.2 2.2 2.2" />
        ) : (
          <path d="m9.6 14 1.8 1.8 3.2-3.4" />
        )}
      </svg>
      {(enCours || enAttente) && <span className="absolute right-1.5 top-1.5 size-2 animate-ping rounded-full bg-accent/70" aria-hidden="true" />}
    </button>
  );
}
