import { useState } from 'react';
import type { PaperStyle } from '../ink/types';
import { Modal } from './Modal';

const PAPERS: { value: PaperStyle; label: string }[] = [
  { value: 'grid', label: 'Petits carreaux' },
  { value: 'seyes', label: 'Seyès (grands carreaux)' },
  { value: 'lined', label: 'Lignes' },
  { value: 'blank', label: 'Blanc' },
];

/**
 * Création d'un cahier. Partagée par la bibliothèque et par le « + » de la barre d'onglets : depuis un cahier
 * ouvert, on en crée un autre sans repasser par l'accueil.
 */
export function NewNotebookDialog({ onCreate, onClose }: { onCreate(title: string, paper: PaperStyle, subject: string): void; onClose(): void }) {
  const [title, setTitle] = useState('');
  const [paper, setPaper] = useState<PaperStyle>('grid');
  const [subject, setSubject] = useState('');
  const submit = () => onCreate(title, paper, subject);
  return (
    <Modal
      title="Nouveau cahier"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Annuler</button>
          <button className="primary" onClick={submit}>
            Créer
          </button>
        </>
      }
    >
      <form onSubmit={(e) => (e.preventDefault(), submit())}>
        <label className="field">
          <span>Titre</span>
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="ex. Analyse 2 — Cours" />
        </label>
        <label className="field">
          <span>Papier</span>
          <select value={paper} onChange={(e) => setPaper(e.target.value as PaperStyle)}>
            {PAPERS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Matière / contexte (aide Gemini)</span>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="ex. Analyse 2 : séries entières" />
        </label>
      </form>
    </Modal>
  );
}
