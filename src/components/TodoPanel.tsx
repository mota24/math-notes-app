import { useState } from 'react';
import type { FormEvent } from 'react';
import { db, useQuery } from '../db/db';
import { createTodo, removeTodo, toggleTodo } from '../db/library';
import type { Todo } from '../db/schema';
import { Modal } from './Modal';

const DAY = 24 * 60 * 60 * 1000;
const NO_TODOS: Todo[] = [];

type DueStatus = 'none' | 'today' | 'overdue' | 'upcoming';

function dueStatus(dueAt: number | null, done: boolean): DueStatus {
  if (done || dueAt == null) return 'none';
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (dueAt < startOfToday) return 'overdue';
  if (dueAt < startOfToday + DAY) return 'today';
  return 'upcoming';
}

const formatDue = (dueAt: number) => new Date(dueAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

/** « Cosas que hacer » : liste de tâches avec échéance optionnelle, synchronisée comme le reste (voir db/library.ts). */
export function TodoPanel({ onClose }: { onClose(): void }) {
  const todos = useQuery(() => db.todos(), [], ['todos']) ?? NO_TODOS;
  const [text, setText] = useState('');
  const [due, setDue] = useState('');

  const sorted = [...todos]
    .filter((t) => !t.deletedAt)
    .sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      const ad = a.dueAt ?? Infinity;
      const bd = b.dueAt ?? Infinity;
      if (ad !== bd) return ad - bd;
      return b.createdAt - a.createdAt;
    });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    void createTodo(text, due ? new Date(due).getTime() : null);
    setText('');
    setDue('');
  };

  return (
    <Modal title="À faire" onClose={onClose}>
      <form className="row todo-add" onSubmit={submit}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Nouvelle tâche…" autoFocus />
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Échéance (optionnelle)" />
        <button type="submit" className="primary" disabled={!text.trim()}>
          Ajouter
        </button>
      </form>

      {sorted.length === 0 ? (
        <p className="hint">Rien pour l’instant.</p>
      ) : (
        <ul className="todo-list">
          {sorted.map((t) => {
            const status = dueStatus(t.dueAt, t.done);
            return (
              <li key={t.id} className={`todo-item${t.done ? ' done' : ''}`}>
                <label className="check todo-check">
                  <input type="checkbox" checked={t.done} onChange={() => void toggleTodo(t)} />
                  <span className="todo-text">{t.text}</span>
                </label>
                {t.dueAt != null && (
                  <span className={`todo-due ${status}`}>
                    {status === 'overdue' ? 'En retard · ' : status === 'today' ? 'Aujourd’hui · ' : ''}
                    {formatDue(t.dueAt)}
                  </span>
                )}
                <button type="button" className="icon-btn todo-remove" aria-label={`Supprimer « ${t.text} »`} onClick={() => void removeTodo(t.id)}>
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
