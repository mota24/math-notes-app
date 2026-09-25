/**
 * Les recettes Tailwind partagées par les écrans de la bibliothèque. Chaque classe est écrite en toutes lettres :
 * c'est en lisant le code que Tailwind repère celles à générer. Les boutons redonnent eux-mêmes leur bordure, leur
 * fond, leur marge intérieure et leur hauteur : la feuille de style d'origine règle tous les `button` de l'appli.
 */

export const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50';

const glassBase = `inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl border text-sm font-medium transition-colors duration-150 active:scale-[0.97] ${focusRing}`;

/** Fond uni à peine plus clair que la page, contour très fin */
const glassTone = 'border-black/10 bg-black/[0.04] text-zinc-800 hover:bg-black/[0.08] dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-zinc-100 dark:hover:bg-white/[0.08]';

/** L'action principale : la couleur d'accent en texte, sur un fond à peine teinté (jamais d'aplat ni de lueur) */
const accentTone =
  'border-accent/25 bg-accent/10 text-accent-ink hover:bg-accent/15 dark:border-accent/25 dark:bg-accent/10 dark:text-accent dark:hover:bg-accent/20';

/** Bouton sobre */
export const glassButton = `${glassBase} h-10 px-3.5 py-0 ${glassTone}`;

/** Bouton sobre carré, pour un pictogramme seul */
export const glassIconButton = `${glassBase} size-10 min-h-0 p-0 ${glassTone}`;

/** Bouton sobre teinté d'accent */
export const glassButtonAccent = `${glassBase} h-10 px-3.5 py-0 ${accentTone}`;

/** Action destructrice (supprimer, vider) : rouge en texte, sur un fond à peine teinté */
export const dangerButton =
  'inline-flex min-h-11 items-center justify-center rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-0 text-sm font-medium text-red-600 transition-all duration-200 hover:bg-red-500/20 active:scale-[0.97] dark:text-red-400';

/**
 * Surface des cartes et des panneaux : gris foncé UNI, coins arrondis, contour d'un pixel à peine visible et
 * ombre douce. Aucun verre dépoli, aucune lueur colorée : la couleur d'un cahier n'est plus qu'une pastille.
 */
export const glassPanel =
  'rounded-2xl border border-white/[0.06] bg-[#1a1b1f] text-zinc-100 shadow-[0_1px_2px_rgba(0,0,0,0.35),0_12px_32px_-20px_rgba(0,0,0,0.7)]';

/**
 * Les petits boutons ronds posés sur une carte gardent leur taille dessinée (36 px) mais reçoivent le doigt sur
 * 48 px grâce au `before:` : juste en dessous se trouve le bouton « ouvrir », et un tap à 20 px du centre
 * ouvrait le cahier au lieu du menu.
 */
const roundBase = `relative grid size-9 min-h-0 place-items-center rounded-full border p-0 transition-all duration-200 before:absolute before:-inset-1.5 before:rounded-full before:content-[''] active:scale-90 ${focusRing}`;

/** Petit bouton rond posé sur une carte (menu « ⋯ ») */
export const roundButton = `${roundBase} border-white/[0.08] bg-[#232429] text-zinc-400 hover:bg-[#2a2b31] hover:text-white`;
