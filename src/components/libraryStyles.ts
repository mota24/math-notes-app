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

/** Panneau de verre : surface des cartes de cahiers et des panneaux (fond gris très foncé, backdrop-blur, ombre douce) */
export const glassPanel =
  'rounded-2xl border border-gray-700/50 bg-gray-800/50 shadow-xl shadow-black/25 backdrop-blur-xl text-zinc-100 dark:border-gray-700/60 dark:bg-gray-800/50';

/**
 * Les petits boutons ronds posés sur une carte gardent leur taille dessinée (36 px) mais reçoivent le doigt sur
 * 48 px grâce au `before:` : juste en dessous se trouve le bouton « ouvrir », et un tap à 20 px du centre
 * ouvrait le cahier au lieu du menu.
 */
const roundBase = `relative grid size-9 min-h-0 place-items-center rounded-full border p-0 backdrop-blur-md transition-all duration-200 before:absolute before:-inset-1.5 before:rounded-full before:content-[''] active:scale-90 ${focusRing}`;

/** Petit bouton rond posé sur une carte (options, favori) */
export const roundButton = `${roundBase} border-white/10 bg-gray-900/60 text-zinc-300 hover:bg-gray-900 hover:text-white`;

/** Le même, allumé : l'étoile d'un favori */
export const roundButtonOn = `${roundBase} border-amber-500/40 bg-amber-100/80 text-amber-600 hover:bg-amber-100 dark:border-amber-300/40 dark:bg-amber-300/20 dark:text-amber-300 dark:hover:bg-amber-300/30`;
