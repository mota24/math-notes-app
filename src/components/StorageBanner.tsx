import { dismissStorageAlert, useStorageAlert } from '../db/storageAlert';

/** Bandeau d'alerte du stockage local (enregistrement impossible, stockage presque plein). */
export function StorageBanner() {
  const alert = useStorageAlert();
  if (!alert) return null;
  return (
    <div
      role="alert"
      className={`fixed inset-x-3 bottom-3 z-[60] mx-auto flex max-w-xl items-start gap-3 rounded-2xl border px-4 py-3 text-[13.5px] leading-snug shadow-2xl backdrop-blur-xl ${
        alert.full
          ? 'border-red-500/40 bg-red-950/90 text-red-100'
          : 'border-amber-500/40 bg-amber-950/90 text-amber-100'
      }`}
    >
      <svg viewBox="0 0 24 24" className="mt-0.5 size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      </svg>
      <p className="m-0 flex-1">{alert.message}</p>
      <button
        type="button"
        onClick={dismissStorageAlert}
        aria-label="Fermer l’alerte"
        className="grid size-7 min-h-0 shrink-0 place-items-center rounded-lg border-0 bg-white/10 p-0 text-current hover:bg-white/20"
      >
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
