import { useEffect } from 'react';
import { db, useQuery } from '../db/db';
import { go } from '../router';
import type { Route } from '../router';
import type { Tab } from '../tabs';
import { ICONS, icon } from './icons';

const HOME = icon(<path d="M4 11l8-7 8 7M6 9.5V19h12V9.5" />);

/**
 * Barre d'onglets en haut de l'écran : plusieurs cahiers ouverts en même temps, on passe de l'un à
 * l'autre d'un tap, sans repasser par la bibliothèque (qui a son propre onglet, à gauche).
 */
export function TabBar({
  tabs,
  route,
  onClose,
  onPrune,
  onNewNotebook,
}: {
  tabs: Tab[];
  route: Route;
  onClose(id: string): void;
  onPrune(ids: string[]): void;
  onNewNotebook(): void;
}) {
  const ids = tabs.map((t) => t.notebookId);
  const loaded = useQuery(
    () => Promise.all(ids.map(async (id) => ({ id, notebook: await db.getNotebook(id) }))),
    [ids.join('|')],
    ['notebooks'],
  );
  const titles = new Map((loaded ?? []).map((r) => [r.id, r.notebook]));

  useEffect(() => {
    if (!loaded) return;
    const gone = loaded.filter((r) => !r.notebook || r.notebook.deletedAt).map((r) => r.id);
    if (gone.length) onPrune(gone);
    // onPrune est stable (useCallback) ; on ne réagit qu'à un nouveau résultat de requête
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const activeId = route.name === 'notebook' ? route.notebookId : null;
  const inLibrary = route.name === 'library' || route.name === 'trash';

  return (
    <nav className="tabbar" aria-label="Cahiers ouverts">
      <button
        className={`tab tab-home ${inLibrary ? 'active' : ''}`}
        onClick={() => go({ name: 'library', folderId: null })}
        aria-label="Bibliothèque"
        aria-current={inLibrary ? 'page' : undefined}
        title="Bibliothèque"
      >
        {HOME}
      </button>
      <div className="tab-list" role="tablist">
        {tabs.map((t) => {
          const notebook = titles.get(t.notebookId);
          const active = t.notebookId === activeId;
          return (
            <div key={t.notebookId} className={`tab ${active ? 'active' : ''}`} role="presentation">
              <button
                className="tab-main"
                role="tab"
                aria-selected={active}
                onClick={() => go({ name: 'notebook', notebookId: t.notebookId, pageIndex: t.pageIndex })}
                title={notebook?.title}
              >
                <span className="dot" style={{ background: notebook?.color ?? 'var(--line-strong)' }} />
                <span className="tab-title">{notebook?.title ?? '…'}</span>
              </button>
              <button className="tab-close" onClick={() => onClose(t.notebookId)} aria-label={`Fermer ${notebook?.title ?? 'l’onglet'}`}>
                {ICONS.close}
              </button>
            </div>
          );
        })}
      </div>
      <button className="tab tab-new" onClick={onNewNotebook} aria-label="Nouveau cahier" title="Nouveau cahier">
        {ICONS.plus}
      </button>
    </nav>
  );
}

/**
 * Onglets intégrés directement au centre du header unifié de l'éditeur (max 48px).
 * Affiche la liste des cahiers ouverts avec défilement horizontal et bouton d'ajout (+).
 */
export function EditorTabs({
  tabs = [],
  activeId,
  currentNotebook,
  onClose,
  onRename,
  onNewNotebook,
}: {
  tabs?: Tab[];
  activeId: string;
  currentNotebook?: { id: string; title: string; color: string } | null;
  onClose?(id: string): void;
  onRename?(): void;
  onNewNotebook?(): void;
}) {
  const ids = tabs.map((t) => t.notebookId);
  const loaded = useQuery(
    () => Promise.all(ids.map(async (id) => ({ id, notebook: await db.getNotebook(id) }))),
    [ids.join('|')],
    ['notebooks'],
  );
  const titles = new Map((loaded ?? []).map((r) => [r.id, r.notebook]));

  // S'assurer qu'au moins l'onglet du cahier actuel est affiché
  const effectiveTabs =
    tabs.some((t) => t.notebookId === activeId)
      ? tabs
      : [{ notebookId: activeId, pageIndex: 0 }, ...tabs.filter((t) => t.notebookId !== activeId)];

  return (
    <div className="editor-tabs" role="tablist" aria-label="Cahiers ouverts">
      <div className="tab-list">
        {effectiveTabs.map((t) => {
          const isCurrent = t.notebookId === activeId;
          const nb = isCurrent ? (currentNotebook ?? titles.get(t.notebookId)) : titles.get(t.notebookId);
          return (
            <div key={t.notebookId} className={`tab ${isCurrent ? 'active' : ''}`} role="presentation">
              <button
                className="tab-main"
                role="tab"
                aria-selected={isCurrent}
                onClick={() => {
                  if (!isCurrent) go({ name: 'notebook', notebookId: t.notebookId, pageIndex: t.pageIndex });
                }}
                onDoubleClick={() => {
                  if (isCurrent && onRename) onRename();
                }}
                title={nb?.title ? `${nb.title} (double-clic pour renommer)` : undefined}
              >
                <span className="dot" style={{ background: nb?.color ?? 'var(--line-strong)' }} />
                <span className="tab-title">{nb?.title ?? '…'}</span>
              </button>
              {/* Toujours proposé, même pour le dernier onglet : le fermer ramène simplement à la bibliothèque */}
              {onClose && (
                <button
                  className="tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(t.notebookId);
                  }}
                  aria-label={`Fermer ${nb?.title ?? 'l’onglet'}`}
                  title="Fermer l’onglet"
                >
                  {ICONS.close}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {onNewNotebook && (
        <button className="tab tab-new" onClick={onNewNotebook} aria-label="Nouveau cahier" title="Nouveau cahier">
          {ICONS.plus}
        </button>
      )}
    </div>
  );
}

