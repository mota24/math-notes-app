import type { ReactNode } from 'react';

/**
 * Briques des Réglages. Les cartes reprennent le bloc `.dialog section` de la feuille d'origine (fond, bord,
 * arrondi, clair/sombre) ; tout le reste est en Tailwind avec les variables du thème (--ink, --muted,
 * --line, --card, --sunken), pour suivre le mode clair ou sombre sans rien dupliquer.
 *
 * La feuille d'origine habille TOUS les `button` et `input` : chaque élément ci-dessous redonne donc
 * explicitement bordure, fond, arrondi, marges et hauteur.
 */

export const texte = 'text-[color:var(--ink)]';
export const discret = 'text-[color:var(--muted)]';

const btn = 'inline-flex min-h-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 text-[14px] font-semibold transition-all duration-200 active:scale-[0.98] disabled:opacity-40';

/** Bouton neutre */
export const bouton = `${btn} h-10 border border-[color:var(--line)] bg-[color:var(--sunken)] ${texte} hover:brightness-95`;
/** Bouton principal (couleur d'accent) */
export const boutonPrincipal = `${btn} h-10 border-0 bg-accent text-white hover:brightness-110`;
/** Bouton destructif : rouge franc, bien visible */
export const boutonDanger = `${btn} h-10 border-0 bg-red-600 text-white shadow-sm shadow-red-900/20 hover:bg-red-700`;

export const champ = `h-10 w-full min-w-0 rounded-xl border border-[color:var(--line)] bg-[color:var(--sunken)] px-3 text-[14px] ${texte} outline-none transition-colors placeholder:text-[color:var(--muted)] focus:border-accent`;

/** Une carte : pictogramme teinté, titre, sous-titre facultatif, puis son contenu. */
export function Carte({ icone, titre, sousTitre, children }: { icone: ReactNode; titre: string; sousTitre?: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent">{icone}</span>
        <div className="min-w-0">
          <h3 className={`m-0 text-[16px] font-semibold normal-case tracking-normal ${texte}`}>{titre}</h3>
          {sousTitre && <p className={`m-0 text-[12.5px] ${discret}`}>{sousTitre}</p>}
        </div>
      </div>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

/** Une ligne de réglage : libellé (et une précision courte) à gauche, commande à droite. */
export function Ligne({ libelle, precision, children }: { libelle: ReactNode; precision?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex min-h-[52px] flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-[color:var(--line)] py-2.5 first:border-t-0">
      <div className="min-w-0">
        <div className={`text-[14.5px] font-medium ${texte}`}>{libelle}</div>
        {precision && <div className={`mt-0.5 text-[12.5px] leading-snug ${discret}`}>{precision}</div>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

/** Interrupteur (rôle « switch ») */
export function Interrupteur({ actif, onChange, libelle }: { actif: boolean; onChange(v: boolean): void; libelle: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={actif}
      aria-label={libelle}
      onClick={() => onChange(!actif)}
      className={`relative h-[30px] w-[50px] min-h-0 shrink-0 rounded-full border-0 p-0 transition-colors duration-200 ${actif ? 'bg-accent' : 'bg-zinc-300 dark:bg-zinc-600'}`}
    >
      <span className={`absolute left-[3px] top-[3px] size-6 rounded-full bg-white shadow-sm transition-transform duration-200 ${actif ? 'translate-x-5' : ''}`} />
    </button>
  );
}

/** Choix exclusif compact (deux ou trois options) */
export function Segmente<T extends string>({ valeur, options, onChange, libelle }: { valeur: T; options: { valeur: T; libelle: string }[]; onChange(v: T): void; libelle: string }) {
  return (
    <div className="inline-flex rounded-xl bg-[color:var(--sunken)] p-1" role="group" aria-label={libelle}>
      {options.map((o) => (
        <button
          key={o.valeur}
          type="button"
          onClick={() => onChange(o.valeur)}
          aria-pressed={valeur === o.valeur}
          className={`h-8 min-h-0 rounded-lg border-0 px-3 text-[13px] font-semibold transition-all duration-200 ${
            valeur === o.valeur ? `bg-[color:var(--card)] ${texte} shadow-sm` : `bg-transparent ${discret}`
          }`}
        >
          {o.libelle}
        </button>
      ))}
    </div>
  );
}

/** Message d'état sous une action (succès discret ou erreur en rouge) */
export function Etat({ message, erreur }: { message: string; erreur?: boolean }) {
  return <p className={`m-0 mt-1 text-[12.5px] ${erreur ? 'text-red-600 dark:text-red-400' : discret}`}>{message}</p>;
}
