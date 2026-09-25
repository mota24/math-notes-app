import { useState } from 'react';

const KEY = 'notes-maths.ios-install-hint';

/** iPhone / iPad (un iPad récent se présente comme un Mac, mais tactile) */
function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** Ouverte depuis l'écran d'accueil (installée) plutôt que dans un onglet de Safari */
function isInstalled(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function dismissedBefore(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Sur iPhone et iPad, Safari efface les données d'un site qu'on n'a pas ouvert depuis 7 jours, sauf s'il est
 * installé sur l'écran d'accueil. Les cahiers synchronisés reviendraient du cloud, mais autant ne pas perdre
 * le travail pas encore envoyé : on le dit une fois, clairement.
 */
export function IosInstallHint() {
  const [visible, setVisible] = useState(() => isIos() && !isInstalled() && !dismissedBefore());
  if (!visible) return null;
  const close = () => {
    setVisible(false);
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      // navigation privée : le conseil reviendra, sans conséquence
    }
  };
  return (
    <div
      role="note"
      className="pointer-events-auto flex items-start gap-3 rounded-2xl border border-sky-500/40 bg-sky-950/95 px-4 py-3 text-[13.5px] leading-snug text-sky-100 shadow-2xl"
    >
      <p className="m-0 flex-1">
        <strong>Installe l’appli sur ton écran d’accueil</strong> (bouton Partager de Safari → « Sur l’écran d’accueil »). Sans cela,
        Safari efface les notes d’un site ouvert il y a plus de 7 jours.
      </p>
      <button
        type="button"
        onClick={close}
        aria-label="Fermer le conseil"
        className="grid size-7 min-h-0 shrink-0 place-items-center rounded-lg border-0 bg-white/10 p-0 text-current hover:bg-white/20"
      >
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
