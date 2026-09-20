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
  /** Convertir en LaTeX */
  sigma: icon(<path d="M16 5H7l6 7-6 7h9" />),
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
  capture: icon(<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />),
};
