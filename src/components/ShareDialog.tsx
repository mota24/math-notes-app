import { useState } from 'react';
import type { Notebook } from '../db/schema';
import { createShare, deleteShare, publishShare, shareErrorMessage, shareUrl } from '../share/share';
import { Modal } from './Modal';

/**
 * Partager un cahier en lecture seule : un lien secret que n'importe qui peut ouvrir, sans compte, pour
 * LIRE le cahier (pages, fonds PDF, images). Le lien suit le cahier : il se met à jour tout seul quelques
 * secondes après chaque modification (voir scheduleShareUpdate), et se désactive d'un bouton.
 */
export function ShareDialog({ notebook, onClose }: { notebook: Notebook; onClose(): void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const shareId = notebook.shareId ?? null;
  const url = shareId ? shareUrl(shareId) : '';

  const run = async (task: () => Promise<string | null>) => {
    setError(null);
    setInfo(null);
    setBusy('Préparation…');
    try {
      setInfo(await task());
    } catch (e) {
      setError(shareErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const skippedNote = (skipped: number) =>
    skipped ? `${skipped} page${skipped > 1 ? 's' : ''} trop lourde${skipped > 1 ? 's' : ''} (grandes images) n’a pas pu être partagée.` : null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Copie impossible ici : sélectionne le lien et copie-le à la main.');
    }
  };

  return (
    <Modal title="Partager le cahier" onClose={onClose}>
      <div className="flex flex-col gap-4 text-[14px]">
        {!shareId ? (
          <>
            <p className="m-0 leading-relaxed text-zinc-400">
              Crée un <strong className="text-zinc-200">lien secret en lecture seule</strong> : toute personne qui l’a peut voir ce cahier
              (pages, fonds PDF, images) sans compte, mais ne peut rien modifier. Le lien se met à jour tout seul quand tu écris.
            </p>
            <button type="button" className="primary" disabled={!!busy} onClick={() => void run(async () => skippedNote((await createShare(notebook.id, setBusy)).skipped))}>
              {busy ?? 'Créer le lien'}
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                aria-label="Lien de partage"
                className="h-10 min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 font-mono text-[12px] text-zinc-200 outline-none [user-select:text]"
              />
              <button type="button" className="primary" onClick={() => void copy()}>
                {copied ? 'Copié ✓' : 'Copier'}
              </button>
            </div>
            <p className="m-0 text-[13px] leading-relaxed text-zinc-500">
              Lecture seule, sans compte. Mis à jour automatiquement ~15 s après tes modifications.{' '}
              <a href={url} target="_blank" rel="noreferrer" className="text-accent underline-offset-2 hover:underline">
                Ouvrir le lien
              </a>
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={!!busy} onClick={() => void run(async () => skippedNote((await publishShare(notebook.id, shareId, setBusy)).skipped) ?? 'Lien à jour.')}>
                {busy ?? 'Mettre à jour maintenant'}
              </button>
              {!confirmOff ? (
                <button type="button" className="danger" disabled={!!busy} onClick={() => setConfirmOff(true)}>
                  Désactiver le lien
                </button>
              ) : (
                <button
                  type="button"
                  className="danger"
                  disabled={!!busy}
                  onClick={() =>
                    void run(async () => {
                      await deleteShare(notebook.id, shareId);
                      setConfirmOff(false);
                      return 'Lien désactivé : il ne mène plus nulle part.';
                    })
                  }
                >
                  Confirmer : supprimer le partage
                </button>
              )}
            </div>
          </>
        )}
        {error && <p className="m-0 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-300">{error}</p>}
        {info && <p className="m-0 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-300">{info}</p>}
      </div>
    </Modal>
  );
}
