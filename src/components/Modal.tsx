import { useState } from 'react';
import type { ReactNode } from 'react';
import type { Folder } from '../db/schema';
import { buildFolderTree } from './libraryModel';
import type { FolderNode } from './libraryModel';

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${wide ? 'dialog-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="dialog-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </header>
        <div className="dialog-body">{children}</div>
        {footer && <footer className="dialog-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function PromptDialog({
  title,
  label,
  initial = '',
  placeholder,
  confirmLabel = 'Valider',
  onConfirm,
  onClose,
}: {
  title: string;
  label: string;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
  onConfirm(value: string): void;
  onClose(): void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Annuler</button>
          <button className="primary" onClick={() => onConfirm(value)}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm(value);
        }}
      >
        <label className="field">
          <span>{label}</span>
          <input autoFocus autoComplete="off" data-1p-ignore data-lpignore="true" data-bwignore value={value} placeholder={placeholder} onChange={(e) => setValue(e.target.value)} />
        </label>
      </form>
    </Modal>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger = false,
  onConfirm,
  onClose,
}: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm(): void;
  onClose(): void;
}) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Annuler</button>
          <button className={danger ? 'danger-solid' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="dialog-message">{message}</p>
    </Modal>
  );
}

/** Choix d'un dossier de destination (arborescence), sans le dossier déplacé ni ses sous-dossiers. */
export function FolderPicker({
  title,
  folders,
  exclude,
  current,
  onPick,
  onClose,
}: {
  title: string;
  folders: Folder[];
  exclude?: string;
  current: string | null;
  onPick(folderId: string | null): void;
  onClose(): void;
}) {
  // Même arbre que la barre latérale (orphelins et cycles rattachés à la racine). Le dossier qu'on déplace et
  // tout son contenu sont retirés : on ne range pas un dossier dans lui-même.
  const rows: FolderNode[] = [];
  const walk = (nodes: readonly FolderNode[]) => {
    for (const node of nodes) {
      if (node.folder.id === exclude) continue;
      rows.push(node);
      walk(node.children);
    }
  };
  walk(buildFolderTree(folders));

  return (
    <Modal title={title} onClose={onClose}>
      <ul className="folder-picker">
        <li>
          <button className={current === null ? 'current' : ''} onClick={() => onPick(null)}>
            📚 Bibliothèque (racine)
          </button>
        </li>
        {rows.map(({ folder, depth }) => (
          <li key={folder.id} style={{ paddingLeft: 16 + Math.min(depth, 10) * 20 }}>
            <button className={current === folder.id ? 'current' : ''} onClick={() => onPick(folder.id)}>
              <span className="dot" style={{ background: folder.color }} /> {folder.name}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
