import type { ReactNode } from 'react';

/** Pictogrammes de l'interface (SVG en trait, 24 × 24, couleur du texte). */
export const icon = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);

export const ICONS = {
  pen: icon(<path d="M4 20l4-1 11-11-3-3L5 16l-1 4zM14 6l3 3" />),
  highlighter: icon(<path d="M9 15l-3 5h6l1-2M9 15l7-11 4 3-7 11zM4 22h16" />),
  eraser: icon(<path d="M8 20h12M5 15l8-9 6 6-7 8H9l-4-5z" />),
  lasso: icon(<path d="M12 4c5 0 8 2.5 8 5.5S16.5 15 12 15 4 12.5 4 9.5 7 4 12 4zM7 14c-1 2 0 4 2 5" strokeDasharray="3 2.5" />),
  /** Le même lasso, en cadre rectangulaire : l'outil actif montre la forme choisie */
  lassoRect: icon(<path d="M4.5 4.5h15v10h-15zM7 14.5c-1 2 0 4 2 5" strokeDasharray="3 2.5" />),
  hand: icon(<path d="M8 12V6a1.5 1.5 0 013 0v5m0-6.5a1.5 1.5 0 013 0V11m0-4.5a1.5 1.5 0 013 0V12m0-3a1.5 1.5 0 013 0v5c0 4-3 7-7 7-3 0-5-2-7-5l-2-3a1.5 1.5 0 012.5-1.6L8 13" />),
  undo: icon(<path d="M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 010 11H11" />),
  redo: icon(<path d="M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 000 11H13" />),
  image: icon(<path d="M4 6h16v12H4zM4 15l4-4 4 4 3-3 5 5M15.5 9.5h.01" />),
  paste: icon(<path d="M9 4h6v3H9zM7 5H5v15h14V5h-2M9 12h6M9 16h4" />),
  settings: icon(<path d="M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 00-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 00-2-1.2L14 3h-4l-.5 2.6a7 7 0 00-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 000 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 002 1.2L10 21h4l.5-2.6a7 7 0 002-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z" />),
  panel: icon(<path d="M4 5h16v14H4zM14 5v14" />),
  pages: icon(<path d="M4 5h6v14H4zM13 5h7M13 9h7M13 13h7M13 17h5" />),
  back: icon(<path d="M15 5l-7 7 7 7" />),
  next: icon(<path d="M9 5l7 7-7 7" />),
  plus: icon(<path d="M12 5v14M5 12h14" />),
  minus: icon(<path d="M5 12h14" />),
  export: icon(<path d="M12 4v11M7 9l5-5 5 5M5 15v5h14v-5" />),
  /** Anti-paume */
  shield: icon(<path d="M12 3l7 3v5.4c0 4.1-2.9 7.6-7 9.6-4.1-2-7-5.5-7-9.6V6l7-3zM9 12l2 2 4-4" />),
  dots: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
      <path d="M6 12h.01M12 12h.01M18 12h.01" />
    </svg>
  ),
  check: icon(<path d="M5 13l4 4L19 7" />),
  close: icon(<path d="M6 6l12 12M18 6L6 18" />),
  trash: icon(<path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13" />),
  file: icon(<path d="M7 3h7l4 4v14H7zM14 3v5h4" />),
  /** Formes & tampons */
  shapes: icon(
    <>
      <rect x="3.3" y="3.3" width="9.4" height="9.4" rx="1.2" />
      <circle cx="16.5" cy="16.5" r="4.8" />
    </>,
  ),
  /** Lasso de capture rectangulaire */
  /** Lasso de capture : un cadre de visée et l'objectif (il « photographie » une zone), pas un rectangle de sélection */
  capture: icon(<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5M12 9.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6z" />),
  /** Zone de texte (taper au clavier sur la page) */
  text: icon(<path d="M5 7V5h14v2M12 5v14M9 19h6" />),
  /** Lien de partage (lecture seule) */
  share: icon(<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" />),
  /** Écran partagé : deux colonnes */
  split: icon(<path d="M4 5h16v14H4zM12 5v14" />),
  /** Texte d'un scan : cadre de lecture et lettre T */
  scanText: icon(<path d="M4 8V5.5A1.5 1.5 0 015.5 4H8M16 4h2.5A1.5 1.5 0 0120 5.5V8M20 16v2.5a1.5 1.5 0 01-1.5 1.5H16M8 20H5.5A1.5 1.5 0 014 18.5V16M8.5 9h7M12 9v7" />),
  /** Télécharger (export PDF) */
  download: icon(<path d="M12 4v11M7 10l5 5 5-5M5 20h14" />),
  /** Inverser les deux côtés de l'écran partagé */
  swap: icon(<path d="M7 7h12l-3-3M17 17H5l3 3" />),
};
