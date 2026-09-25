import { useState } from 'react';
import type { FormEvent } from 'react';
import { db, useQuery } from '../db/db';
import { createTodo, removeTodo, toggleTodo } from '../db/library';
import type { Todo } from '../db/schema';
import { Modal } from './Modal';

const NO_TODOS: Todo[] = [];

// ------------------------------------------------------------------ dates
// Tout se joue à midi local : `new Date('2026-09-24')` serait minuit UTC, donc la veille pour qui vit à l'ouest.

const startOfDay = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
const today = () => startOfDay(Date.now());
/** « 2026-09-24 » → minuit local (et non UTC) */
const fromInput = (value: string) => {
  const [y, m, d] = value.split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d).getTime() : null;
};
const jourCourt = (t: number) => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

type Etat = 'retard' | 'aujourdhui' | 'avenir' | 'sansdate';

function etatDe(todo: Todo, maintenant: number): Etat {
  if (todo.dueAt == null) return 'sansdate';
  const jour = startOfDay(todo.dueAt);
  if (jour < maintenant) return 'retard';
  if (jour === maintenant) return 'aujourdhui';
  return 'avenir';
}

// ------------------------------------------------------------------ styles (la feuille d'origine habille tous les
// `button` : chaque bouton ci-dessous redonne donc bordure, fond, arrondi, marge et hauteur)

const btnBase = 'inline-flex min-h-0 items-center justify-center gap-1.5 border-0 p-0 transition-all duration-200';
const btnAjout = `${btnBase} h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-white shadow-sm hover:brightness-110 disabled:opacity-40`;
const btnIcone = `${btnBase} size-8 rounded-lg bg-transparent text-zinc-400 hover:bg-black/5 hover:text-red-600 dark:hover:bg-white/10 dark:hover:text-red-400`;
const champ =
  'min-w-0 rounded-xl border border-black/10 bg-white px-3 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-accent dark:border-white/15 dark:bg-zinc-800 dark:text-zinc-100';

const TEINTES: Record<Etat, { puce: string; texte: string; fond: string }> = {
  retard: { puce: 'bg-red-500', texte: 'text-red-600 dark:text-red-400', fond: 'bg-red-500/10' },
  aujourdhui: { puce: 'bg-accent', texte: 'text-accent', fond: 'bg-accent/10' },
  avenir: { puce: 'bg-zinc-400', texte: 'text-zinc-500 dark:text-zinc-400', fond: 'bg-black/5 dark:bg-white/10' },
  sansdate: { puce: 'bg-zinc-300', texte: 'text-zinc-400', fond: 'bg-black/5 dark:bg-white/10' },
};

// ------------------------------------------------------------------ une ligne

function Ligne({ todo, maintenant }: { todo: Todo; maintenant: number }) {
  const etat = etatDe(todo, maintenant);
  const teinte = TEINTES[etat];
  return (
    <li className="group flex items-center gap-3 rounded-xl border border-black/5 bg-white/70 px-3 py-2.5 transition-colors duration-200 hover:border-black/10 dark:border-white/5 dark:bg-white/[0.04] dark:hover:border-white/10">
      <button
        type="button"
        role="checkbox"
        aria-checked={todo.done}
        aria-label={todo.done ? `Rouvrir « ${todo.text} »` : `Terminer « ${todo.text} »`}
        onClick={() => void toggleTodo(todo)}
        className={`${btnBase} size-6 shrink-0 rounded-full ring-2 ring-inset ${
          todo.done ? 'bg-accent ring-accent' : 'bg-transparent ring-zinc-300 hover:ring-accent dark:ring-zinc-600'
        }`}
      >
        {todo.done && (
          <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 13l4 4L19 7" />
          </svg>
        )}
      </button>

      <span className={`min-w-0 flex-1 break-words text-sm ${todo.done ? 'text-zinc-400 line-through dark:text-zinc-500' : 'text-zinc-800 dark:text-zinc-100'}`}>
        {todo.text}
      </span>

      {todo.dueAt != null && !todo.done && (
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${teinte.fond} ${teinte.texte}`}>
          {etat === 'retard' ? 'En retard · ' : etat === 'aujourdhui' ? "Aujourd'hui · " : ''}
          {jourCourt(todo.dueAt)}
        </span>
      )}

      <button
        type="button"
        onClick={() => void removeTodo(todo.id)}
        aria-label={`Supprimer « ${todo.text} »`}
        title="Supprimer"
        className={`${btnIcone} shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100`}
      >
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </li>
  );
}

function Groupe({ titre, couleur, todos, maintenant }: { titre: string; couleur: string; todos: Todo[]; maintenant: number }) {
  if (todos.length === 0) return null;
  return (
    <section>
      <h3 className={`m-0 mb-1.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider ${couleur}`}>
        {titre}
        <span className="rounded-full bg-black/5 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500 dark:bg-white/10 dark:text-zinc-400">{todos.length}</span>
      </h3>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {todos.map((t) => (
          <Ligne key={t.id} todo={t} maintenant={maintenant} />
        ))}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------------ panneau

/** La liste « À faire » (bouton de la bibliothèque). Le calendrier a son propre tiroir : CalendarPanel.tsx. */
export function TodoPanel({ onClose }: { onClose(): void }) {
  const todos = useQuery(() => db.todos(), [], ['todos']) ?? NO_TODOS;
  const [texte, setTexte] = useState('');
  const [date, setDate] = useState('');
  const maintenant = today();

  // Quelques dizaines de tâches au plus : trier à chaque rendu ne coûte rien
  const vivantes = todos
    .filter((t) => !t.deletedAt)
    .sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      const ad = a.dueAt == null ? Infinity : startOfDay(a.dueAt);
      const bd = b.dueAt == null ? Infinity : startOfDay(b.dueAt);
      if (ad !== bd) return ad - bd;
      return b.createdAt - a.createdAt;
    });

  const actives = vivantes.filter((t) => !t.done);
  const groupes = {
    retard: actives.filter((t) => etatDe(t, maintenant) === 'retard'),
    aujourdhui: actives.filter((t) => etatDe(t, maintenant) === 'aujourdhui'),
    avenir: actives.filter((t) => etatDe(t, maintenant) === 'avenir'),
    sansdate: actives.filter((t) => etatDe(t, maintenant) === 'sansdate'),
  };
  const faites = vivantes.filter((t) => t.done);

  const ajouter = (e: FormEvent) => {
    e.preventDefault();
    if (!texte.trim()) return;
    const quand = date ? fromInput(date) : null;
    void createTodo(texte, quand);
    setTexte('');
    setDate('');
  };

  return (
    <Modal title="À faire" onClose={onClose} wide>
      <div className="flex flex-col gap-4">
        {/* Compteurs */}
        <div className="flex flex-wrap items-center justify-end gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {groupes.retard.length > 0 && (
              <span className="rounded-full bg-red-500/10 px-2.5 py-1 text-[11px] font-semibold text-red-600 dark:text-red-400">
                {groupes.retard.length} en retard
              </span>
            )}
            {groupes.aujourdhui.length > 0 && (
              <span className="rounded-full bg-accent/10 px-2.5 py-1 text-[11px] font-semibold text-accent">{groupes.aujourdhui.length} aujourd’hui</span>
            )}
            <span className="rounded-full bg-black/5 px-2.5 py-1 text-[11px] font-semibold text-zinc-500 dark:bg-white/10 dark:text-zinc-400">
              {actives.length} en cours
            </span>
          </div>
        </div>

        {/* Ajout */}
        <form onSubmit={ajouter} className="flex flex-wrap items-center gap-2 rounded-2xl border border-black/5 bg-black/[0.02] p-2 dark:border-white/5 dark:bg-white/[0.03]">
          <input
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
            placeholder="Ajouter une tâche…"
            autoComplete="off" data-1p-ignore data-lpignore="true" data-bwignore
            autoFocus
            className={`${champ} h-10 flex-1 basis-40`}
            aria-label="Nouvelle tâche"
          />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${champ} h-10`} aria-label="Échéance (optionnelle)" />
          <button type="submit" className={btnAjout} disabled={!texte.trim()}>
            Ajouter
          </button>
        </form>

        {vivantes.length === 0 ? (
          <p className="m-0 rounded-2xl border border-dashed border-black/10 py-10 text-center text-sm text-zinc-400 dark:border-white/10">
            Rien à faire pour l’instant.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <Groupe titre="En retard" couleur="text-red-600 dark:text-red-400" todos={groupes.retard} maintenant={maintenant} />
            <Groupe titre="Aujourd’hui" couleur="text-accent" todos={groupes.aujourdhui} maintenant={maintenant} />
            <Groupe titre="À venir" couleur="text-zinc-500 dark:text-zinc-400" todos={groupes.avenir} maintenant={maintenant} />
            <Groupe titre="Sans date" couleur="text-zinc-500 dark:text-zinc-400" todos={groupes.sansdate} maintenant={maintenant} />
            <Groupe titre="Terminées" couleur="text-zinc-400" todos={faites} maintenant={maintenant} />
          </div>
        )}
      </div>
    </Modal>
  );
}
