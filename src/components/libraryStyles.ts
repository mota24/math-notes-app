/**
 * Les recettes Tailwind partagées par les écrans de la bibliothèque. Chaque classe est écrite en toutes lettres :
 * c'est en lisant le code que Tailwind repère celles à générer. Les boutons redonnent eux-mêmes leur bordure, leur
 * fond, leur marge intérieure et leur hauteur : la feuille de style d'origine règle tous les `button` de l'appli.
 */

export const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50';

const glassBase = `inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl border text-sm font-medium backdrop-blur-md transition-all duration-200 active:scale-[0.97] ${focusRing}`;

/** Fond translucide, contour très fin, un peu plus clair au survol */
const glassTone = 'border-black/10 bg-black/[0.04] text-zinc-800 hover:bg-black/[0.08] dark:border-white/10 dark:bg-white/5 dark:text-zinc-100 dark:hover:bg-white/10';

/** Le même, teinté de la couleur d'accent : l'action principale, sans aplat de couleur pleine */
const accentTone =
  'border-accent/30 bg-accent/10 text-accent-ink hover:bg-accent/20 dark:border-accent/30 dark:bg-accent/15 dark:text-accent dark:hover:bg-accent/25';

/** Bouton « verre » */
export const glassButton = `${glassBase} h-11 px-4 py-0 ${glassTone}`;

/** Bouton « verre » carré, pour un pictogramme seul */
export const glassIconButton = `${glassBase} size-11 min-h-0 p-0 ${glassTone}`;

/** Bouton « verre » teinté d'accent */
export const glassButtonAccent = `${glassBase} h-11 px-4 py-0 ${accentTone}`;

/** Panneau de verre : la surface des cartes, des listes et des états vides */
export const glassPanel =
  'rounded-2xl border border-zinc-200/80 bg-white/70 shadow-lg shadow-zinc-900/5 backdrop-blur-md dark:border-zinc-700/80 dark:bg-zinc-800/50 dark:shadow-black/30';

const roundBase = `grid size-9 min-h-0 place-items-center rounded-full border p-0 backdrop-blur-md transition-all duration-200 active:scale-90 ${focusRing}`;

/** Petit bouton rond posé sur une carte (options, favori) */
export const roundButton = `${roundBase} border-black/10 bg-white/70 text-zinc-600 hover:bg-white hover:text-zinc-900 dark:border-white/10 dark:bg-black/30 dark:text-zinc-300 dark:hover:bg-black/50 dark:hover:text-white`;

/** Le même, allumé : l'étoile d'un favori */
export const roundButtonOn = `${roundBase} border-amber-500/40 bg-amber-100/80 text-amber-600 hover:bg-amber-100 dark:border-amber-300/40 dark:bg-amber-300/20 dark:text-amber-300 dark:hover:bg-amber-300/30`;
