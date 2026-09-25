import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { db, useQuery } from '../db/db';
import { createTodo, removeTodo, toggleTodo } from '../db/library';
import type { Todo } from '../db/schema';

const NO_TODOS: Todo[] = [];
const JOURS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
/** Jours affichés dans « Prochains jours », sous le jour choisi */
const HORIZON = 14;

// Tout se joue à minuit LOCAL : `new Date('2026-09-24')` serait minuit UTC, donc la veille à l'ouest.
const startOfDay = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
const addDays = (t: number, n: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
};
const jourCourt = (t: number) => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
const jourLong = (t: number) => new Date(t).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const jourSemaine = (t: number) => new Date(t).toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '');

// La feuille d'origine habille tous les `button` : chaque bouton redonne bordure, fond, marge et hauteur.
const btn = 'inline-flex min-h-0 items-center justify-center border-0 p-0 transition-colors duration-100';
const btnIcone = `${btn} size-7 rounded-md bg-transparent text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-100`;

function Chevron({ vers }: { vers: 'gauche' | 'droite' }) {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={vers === 'gauche' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
    </svg>
  );
}

/** Une tâche en une ligne de 30 px : case à cocher, texte, suppression au survol. */
function Tache({ todo, enRetard }: { todo: Todo; enRetard: boolean }) {
  return (
    <li className="group flex h-[30px] items-center gap-2 rounded-md px-1.5 hover:bg-white/[0.04]">
      <button
        type="button"
        role="checkbox"
        aria-checked={todo.done}
        aria-label={todo.done ? `Rouvrir « ${todo.text} »` : `Terminer « ${todo.text} »`}
        onClick={() => void toggleTodo(todo)}
        className={`${btn} size-4 shrink-0 rounded-[5px] ring-[1.5px] ring-inset ${
          todo.done ? 'bg-accent ring-accent' : enRetard ? 'bg-transparent ring-red-400/70 hover:ring-red-400' : 'bg-transparent ring-zinc-600 hover:ring-accent'
        }`}
      >
        {todo.done && (
          <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 13l4 4L19 7" />
          </svg>
        )}
      </button>
      <span className={`min-w-0 flex-1 truncate text-[13px] ${todo.done ? 'text-zinc-600 line-through' : 'text-zinc-200'}`} title={todo.text}>
        {todo.text}
      </span>
      <button
        type="button"
        onClick={() => void removeTodo(todo.id)}
        aria-label={`Supprimer « ${todo.text} »`}
        title="Supprimer"
        className={`${btnIcone} size-6 shrink-0 opacity-0 hover:text-red-400 focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-60`}
      >
        <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </li>
  );
}

/**
 * Le calendrier : un tiroir étroit (320 px) qui glisse depuis la droite, par-dessus la bibliothèque. En haut
 * un mois compact (cases de 34 px, un point par tâche), en dessous l'agenda du jour choisi et des jours qui
 * suivent, en bas un champ pour ajouter une tâche au jour choisi. Échap ou un tap à côté le referment.
 */
export function CalendarPanel({ onClose }: { onClose(): void }) {
  const todos = useQuery(() => db.todos(), [], ['todos']) ?? NO_TODOS;
  const maintenant = startOfDay(Date.now());
  const [jour, setJour] = useState(maintenant);
  const [mois, setMois] = useState(() => {
    const d = new Date(maintenant);
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  });
  const [texte, setTexte] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const parJour = useMemo(() => {
    const map = new Map<number, Todo[]>();
    for (const t of todos) {
      if (t.deletedAt || t.dueAt == null) continue;
      const k = startOfDay(t.dueAt);
      const liste = map.get(k);
      if (liste) liste.push(t);
      else map.set(k, [t]);
    }
    for (const liste of map.values()) liste.sort((a, b) => Number(a.done) - Number(b.done) || a.createdAt - b.createdAt);
    return map;
  }, [todos]);

  const enRetard = useMemo(
    () => todos.filter((t) => !t.deletedAt && !t.done && t.dueAt != null && startOfDay(t.dueAt) < maintenant),
    [todos, maintenant],
  );

  const debut = new Date(mois);
  const decalage = (debut.getDay() + 6) % 7; // la grille commence un lundi (getDay : dimanche = 0)
  const cases: (number | null)[] = [];
  for (let i = 0; i < decalage; i++) cases.push(null);
  const nbJours = new Date(debut.getFullYear(), debut.getMonth() + 1, 0).getDate();
  for (let j = 1; j <= nbJours; j++) cases.push(new Date(debut.getFullYear(), debut.getMonth(), j).getTime());
  while (cases.length % 7 !== 0) cases.push(null);

  const changerMois = (delta: number) => setMois(new Date(debut.getFullYear(), debut.getMonth() + delta, 1).getTime());
  const allerAujourdhui = () => {
    setJour(maintenant);
    const d = new Date(maintenant);
    setMois(new Date(d.getFullYear(), d.getMonth(), 1).getTime());
  };
  const choisir = (t: number) => {
    setJour(t);
    const d = new Date(t);
    if (d.getMonth() !== debut.getMonth() || d.getFullYear() !== debut.getFullYear()) setMois(new Date(d.getFullYear(), d.getMonth(), 1).getTime());
  };

  const duJour = parJour.get(jour) ?? [];
  const prochains: [number, Todo[]][] = [];
  for (let i = 1; i <= HORIZON; i++) {
    const t = addDays(jour, i);
    const liste = (parJour.get(t) ?? []).filter((x) => !x.done);
    if (liste.length) prochains.push([t, liste]);
  }

  const ajouter = (e: FormEvent) => {
    e.preventDefault();
    if (!texte.trim()) return;
    void createTodo(texte, jour);
    setTexte('');
  };

  return (
    <div className="fixed inset-0 z-[60]">
      <button type="button" aria-label="Fermer le calendrier" onClick={onClose} className="absolute inset-0 min-h-0 animate-fade rounded-none border-0 bg-black/40 p-0" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Calendrier"
        className="absolute inset-y-0 right-0 flex w-[320px] max-w-full animate-slide-in flex-col border-l border-white/[0.06] bg-[#141518] text-zinc-100 shadow-[-24px_0_48px_-24px_rgba(0,0,0,0.7)]"
      >
        {/* En-tête */}
        <header className="flex h-12 shrink-0 items-center gap-1 border-b border-white/[0.05] pl-4 pr-2">
          <h2 className="m-0 flex-1 text-[13px] font-semibold tracking-tight text-zinc-100">Calendrier</h2>
          {jour !== maintenant && (
            <button type="button" onClick={allerAujourdhui} className={`${btn} h-7 rounded-md bg-transparent px-2 text-[12px] font-medium text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100`}>
              Aujourd’hui
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Fermer" className={btnIcone}>
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        {/* Mois */}
        <div className="shrink-0 px-3 pb-3 pt-2.5">
          <div className="mb-1.5 flex items-center justify-between pl-1">
            <strong className="text-[13px] font-semibold capitalize text-zinc-200">
              {MOIS[debut.getMonth()]} <span className="font-normal text-zinc-500">{debut.getFullYear()}</span>
            </strong>
            <div className="flex">
              <button type="button" className={btnIcone} onClick={() => changerMois(-1)} aria-label="Mois précédent">
                <Chevron vers="gauche" />
              </button>
              <button type="button" className={btnIcone} onClick={() => changerMois(1)} aria-label="Mois suivant">
                <Chevron vers="droite" />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-7">
            {JOURS.map((j, i) => (
              <div key={i} className="pb-1 text-center text-[10px] font-semibold text-zinc-600">
                {j}
              </div>
            ))}
            {cases.map((t, i) => {
              if (t === null) return <div key={`v${i}`} className="h-[34px]" />;
              const liste = parJour.get(t) ?? [];
              const ouvertes = liste.filter((x) => !x.done).length;
              const estAujourdhui = t === maintenant;
              const choisi = t === jour;
              const retard = t < maintenant && ouvertes > 0;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => choisir(t)}
                  aria-label={`${jourLong(t)}${ouvertes ? ` — ${ouvertes} tâche${ouvertes > 1 ? 's' : ''}` : ''}`}
                  aria-pressed={choisi}
                  className={`${btn} relative h-[34px] flex-col rounded-md text-[12px] tabular-nums ${
                    choisi
                      ? 'bg-accent font-semibold text-white'
                      : estAujourdhui
                        ? 'bg-transparent font-semibold text-accent hover:bg-white/[0.05]'
                        : t < maintenant
                          ? 'bg-transparent text-zinc-600 hover:bg-white/[0.05]'
                          : 'bg-transparent text-zinc-300 hover:bg-white/[0.05]'
                  }`}
                >
                  {new Date(t).getDate()}
                  {ouvertes > 0 && (
                    <span className={`absolute bottom-[5px] size-1 rounded-full ${choisi ? 'bg-white' : retard ? 'bg-red-400' : 'bg-accent'}`} />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Agenda */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-white/[0.05] px-2.5 py-3 [scrollbar-width:thin]">
          {enRetard.length > 0 && jour === maintenant && (
            <section className="mb-4">
              <h3 className="m-0 mb-1 px-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-red-400">En retard · {enRetard.length}</h3>
              <ul className="m-0 list-none p-0">
                {enRetard.map((t) => (
                  <Tache key={t.id} todo={t} enRetard />
                ))}
              </ul>
            </section>
          )}

          <section>
            <h3 className="m-0 mb-1 px-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
              {jour === maintenant ? 'Aujourd’hui' : <span className="capitalize">{jourLong(jour)}</span>}
            </h3>
            {duJour.length === 0 ? (
              <p className="m-0 px-1.5 py-1 text-[12px] text-zinc-600">Rien de prévu.</p>
            ) : (
              <ul className="m-0 list-none p-0">
                {duJour.map((t) => (
                  <Tache key={t.id} todo={t} enRetard={jour < maintenant && !t.done} />
                ))}
              </ul>
            )}
          </section>

          {prochains.length > 0 && (
            <section className="mt-4">
              <h3 className="m-0 mb-1 px-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">Prochains jours</h3>
              <div className="flex flex-col gap-1.5">
                {prochains.map(([t, liste]) => (
                  <div key={t} className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => choisir(t)}
                      className={`${btn} h-[30px] w-11 shrink-0 flex-col rounded-md bg-transparent leading-none text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-200`}
                      title={jourLong(t)}
                    >
                      <span className="text-[9px] uppercase">{jourSemaine(t)}</span>
                      <span className="text-[12px] font-semibold tabular-nums">{new Date(t).getDate()}</span>
                    </button>
                    <ul className="m-0 min-w-0 flex-1 list-none p-0">
                      {liste.map((x) => (
                        <Tache key={x.id} todo={x} enRetard={false} />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Ajout rapide au jour choisi */}
        <form onSubmit={ajouter} className="flex shrink-0 items-center gap-1.5 border-t border-white/[0.05] p-2.5">
          <input
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
            placeholder={`Ajouter au ${jourCourt(jour)}…`}
            autoComplete="off" data-1p-ignore data-lpignore="true" data-bwignore
            aria-label="Nouvelle tâche"
            className="h-8 min-h-0 min-w-0 flex-1 rounded-md border border-white/[0.06] bg-white/[0.04] px-2.5 py-0 text-[13px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-accent/50"
          />
          <button
            type="submit"
            disabled={!texte.trim()}
            aria-label="Ajouter"
            className={`${btn} size-8 shrink-0 rounded-md bg-accent text-white hover:brightness-110 disabled:opacity-30`}
          >
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </form>
      </aside>
    </div>
  );
}
