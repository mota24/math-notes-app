import { useState } from 'react';
import type { ReactNode } from 'react';
import { NOTEBOOK_COLORS } from '../db/schema';
import type { Folder, Notebook } from '../db/schema';

const date = (t: number) => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

export interface MenuItem {
  label: string;
  onClick(): void;
  danger?: boolean;
}

function CardMenu({ items, color, onColor }: { items: MenuItem[]; color: string; onColor(c: string): void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card-menu">
      <button
        className="icon-btn menu-trigger"
        aria-label="Options"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        ⋯
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={(e) => (e.stopPropagation(), setOpen(false))} />
          <div className="menu-popover" onClick={(e) => e.stopPropagation()}>
            <div className="menu-colors">
              {NOTEBOOK_COLORS.map((c) => (
                <button
                  key={c}
                  className={`swatch small ${c === color ? 'active' : ''}`}
                  style={{ background: c }}
                  aria-label="Couleur"
                  onClick={() => {
                    onColor(c);
                    setOpen(false);
                  }}
                />
              ))}
            </div>
            {items.map((item) => (
              <button
                key={item.label}
                className={item.danger ? 'menu-item danger' : 'menu-item'}
                onClick={() => {
                  setOpen(false);
                  item.onClick();
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function FolderCard({
  folder,
  count,
  onOpen,
  menu,
  onColor,
}: {
  folder: Folder;
  count: string;
  onOpen(): void;
  menu: MenuItem[];
  onColor(c: string): void;
}) {
  return (
    <article className="lib-card folder-card" onClick={onOpen}>
      <div className="folder-icon" style={{ background: folder.color }} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#fff" strokeWidth="1.8">
          <path d="M3 7h6l2 2h10v10H3z" />
        </svg>
      </div>
      <div className="lib-card-text">
        <strong>{folder.name}</strong>
        <small>{count}</small>
      </div>
      <CardMenu items={menu} color={folder.color} onColor={onColor} />
    </article>
  );
}

export function NotebookCard({
  notebook,
  onOpen,
  onFavorite,
  menu,
  onColor,
  badge,
}: {
  notebook: Notebook;
  onOpen(): void;
  onFavorite(): void;
  menu: MenuItem[];
  onColor(c: string): void;
  badge?: ReactNode;
}) {
  return (
    <article className="lib-card notebook-card" onClick={onOpen}>
      <div className="notebook-cover" style={{ background: notebook.color }}>
        <span className="cover-title">{notebook.title}</span>
        {notebook.subject && <span className="cover-subject">{notebook.subject}</span>}
        <button
          className={`fav ${notebook.favorite ? 'on' : ''}`}
          aria-label={notebook.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
          onClick={(e) => {
            e.stopPropagation();
            onFavorite();
          }}
        >
          {notebook.favorite ? '★' : '☆'}
        </button>
      </div>
      <div className="lib-card-text">
        <strong>{notebook.title}</strong>
        <small>
          {notebook.pageIds.length} page{notebook.pageIds.length > 1 ? 's' : ''} · {date(notebook.updatedAt)}
          {badge}
        </small>
      </div>
      <CardMenu items={menu} color={notebook.color} onColor={onColor} />
    </article>
  );
}
