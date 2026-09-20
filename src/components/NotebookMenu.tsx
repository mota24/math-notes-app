import type { ReactNode } from 'react';
import type { PaperColor, PaperStyle } from '../ink/types';
import { ICONS } from './icons';

const PAPERS: { value: PaperStyle; label: string }[] = [
  { value: 'grid', label: 'Carreaux' },
  { value: 'seyes', label: 'Seyès' },
  { value: 'lined', label: 'Lignes' },
  { value: 'blank', label: 'Blanc' },
];
const PAPER_COLORS: { value: PaperColor; label: string }[] = [
  { value: 'light', label: 'Clair' },
  { value: 'dark', label: 'Sombre' },
];

interface Props {
  paper: PaperStyle;
  paperColor: PaperColor;
  paperDisabled: boolean;
  pageCount: number;
  queue: { done: number; total: number } | null;
  onPaper(p: PaperStyle): void;
  onPaperColor(c: PaperColor): void;
  onExport(): void;
  onConvertNotebook(): void;
  onPages(): void;
  onConvertPhoto(): void;
  onInsertPdf(): void;
  onRename(): void;
  onSettings(): void;
  onDeletePage(): void;
  onClose(): void;
}

/** Menu « ⋯ » du cahier : tout ce qui ne sert pas à chaque trait. */
export function NotebookMenu(p: Props) {
  const item = (label: string, node: ReactNode, action: () => void, hint?: string, danger?: boolean) => (
    <button
      className={`menu-row ${danger ? 'danger' : ''}`}
      onClick={() => {
        action();
        p.onClose();
      }}
    >
      {node}
      <span>{label}</span>
      {hint && <span className="menu-hint">{hint}</span>}
    </button>
  );

  return (
    <>
      <button className="menu-backdrop" onClick={p.onClose} aria-label="Fermer le menu" />
      <div className="menu-card" role="menu">
        {item('Exporter…', ICONS.export, p.onExport, 'PDF · LaTeX')}
        {item(
          p.queue ? `Arrêter (${p.queue.done}/${p.queue.total})` : 'Convertir tout le cahier',
          ICONS.sigma,
          p.onConvertNotebook,
          p.queue ? undefined : `${p.pageCount} page${p.pageCount > 1 ? 's' : ''}`,
        )}
        {item('Toutes les pages', ICONS.pages, p.onPages)}
        <div className="menu-sep" />
        <div className="menu-section">
          <span className="field-label">Papier</span>
          <div className="segmented">
            {PAPERS.map((s) => (
              <button
                key={s.value}
                onClick={() => p.onPaper(s.value)}
                aria-pressed={p.paper === s.value}
                disabled={p.paperDisabled}
                title={p.paperDisabled ? 'La page a un fond PDF ou photo' : undefined}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="segmented">
            {PAPER_COLORS.map((c) => (
              <button
                key={c.value}
                onClick={() => p.onPaperColor(c.value)}
                aria-pressed={p.paperColor === c.value}
                disabled={p.paperDisabled}
                title={p.paperDisabled ? 'La page a un fond PDF ou photo' : 'Papier sombre : pense à choisir une encre claire'}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
        <div className="menu-sep" />
        {item('Convertir une photo', ICONS.image, p.onConvertPhoto)}
        {item('Insérer un PDF', ICONS.file, p.onInsertPdf)}
        {item('Renommer le cahier', ICONS.pen, p.onRename)}
        {item('Réglages', ICONS.settings, p.onSettings)}
        <div className="menu-sep" />
        {item('Supprimer la page', ICONS.trash, p.onDeletePage, undefined, true)}
      </div>
    </>
  );
}
