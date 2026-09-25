import { useEffect, useMemo, useRef, useState } from 'react';
import { db, useQuery } from '../db/db';
import type { Folder, Notebook } from '../db/schema';
import { Icon } from './LibraryIcons';
import { browseNotebooks, folderPath } from './libraryModel';
import { focusRing } from './libraryStyles';

const NO_FOLDERS: Folder[] = [];
const NO_NOTEBOOKS: Notebook[] = [];

const row = `flex h-11 min-h-0 w-full items-center gap-2.5 rounded-lg border-0 bg-transparent px-2.5 py-0 text-left text-[13px] text-zinc-200 transition-colors duration-100 hover:bg-white/[0.06] active:bg-white/[0.09] ${focusRing}`;
const title = 'm-0 px-2.5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500';

/**
 * Le mini-explorateur de l'écran partagé : toujours sombre (il vit dans le volet sombre, même quand le système
 * est en thème clair). Les récents d'abord, puis les dossiers de la bibliothèque à parcourir (fil d'Ariane pour
 * remonter), ou une recherche dans toute la bibliothèque, dossiers compris. Un tap sur un cahier l'affiche à côté.
 */
export function NotebookPicker({ currentId, shownId, onPick, onCancel }: { currentId: string; shownId: string | null; onPick(id: string): void; onCancel: (() => void) | null }) {
  const folders = useQuery(() => db.folders(), [], ['folders']) ?? NO_FOLDERS;
  const notebooks = useQuery(() => db.notebooks(), [], ['notebooks']) ?? NO_NOTEBOOKS;
  const shown = notebooks.find((n) => n.id === shownId);
  const [folderId, setFolderId] = useState<string | null>(shown?.folderId ?? null);
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  // Le clavier ne s'ouvre pas tout seul sur une tablette (focus seulement avec une souris / un clavier)
  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) input.current?.focus();
  }, []);

  const byId = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  const current = folderId ? byId.get(folderId) : undefined;
  // Dossier disparu (corbeille, synchro) : retour à la racine
  const here = current && !current.deletedAt ? folderId : null;
  const view = useMemo(() => browseNotebooks(folders, notebooks, here, query, currentId), [folders, notebooks, here, query, currentId]);
  const searching = query.trim().length > 0;
  const recents = useMemo(
    () => notebooks.filter((n) => !n.deletedAt && n.id !== currentId).sort((a, b) => b.openedAt - a.openedAt).slice(0, 4),
    [notebooks, currentId],
  );
  const trail = here ? folderPath(byId, byId.get(here)) : [];
  const pathOf = (n: Notebook) => (n.folderId ? folderPath(byId, byId.get(n.folderId)).map((f) => f.name).join(' › ') : '');

  const book = (n: Notebook, sub?: string) => (
    <li key={n.id}>
      <button type="button" className={`${row} ${n.id === shownId ? 'bg-accent/15 text-white' : ''}`} onClick={() => onPick(n.id)} aria-current={n.id === shownId}>
        <span className="grid size-7 shrink-0 place-items-center rounded-md" style={{ color: n.color, background: `color-mix(in srgb, ${n.color} 16%, transparent)` }}>
          <Icon name="book" className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{n.title}</span>
          {(sub ?? n.subject) && <span className="block truncate text-[11px] text-zinc-500">{sub || n.subject}</span>}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-zinc-500">{n.pageIds.length} p.</span>
      </button>
    </li>
  );
  const folder = (f: Folder) => (
    <li key={f.id}>
      <button type="button" className={row} onClick={() => (setFolderId(f.id), setQuery(''))}>
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-white/[0.04]" style={{ color: f.color }}>
          <Icon name="folder" className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">{f.name}</span>
        <Icon name="chevron" className="size-3.5 shrink-0 text-zinc-500" />
      </button>
    </li>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#141518] text-zinc-100 [color-scheme:dark]">
      <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] p-2">
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 focus-within:border-accent/60">
          <Icon name="search" className="size-4 shrink-0 text-zinc-500" />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && onCancel?.()}
            placeholder="Chercher un cours, un dossier…"
            aria-label="Chercher un cahier"
            autoComplete="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            data-bwignore
            className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] text-zinc-100 outline-none placeholder:text-zinc-500"
          />
        </label>
        {onCancel && (
          <button type="button" onClick={onCancel} className={`h-9 min-h-0 shrink-0 rounded-lg border-0 bg-transparent px-2.5 py-0 text-[13px] font-medium text-zinc-300 hover:bg-white/[0.06] ${focusRing}`}>
            Annuler
          </button>
        )}
      </div>

      {!searching && (
        <nav aria-label="Dossier parcouru" className="flex shrink-0 items-center gap-0.5 overflow-x-auto whitespace-nowrap px-2 py-1.5 text-[12px] text-zinc-400 [scrollbar-width:none]">
          <button type="button" onClick={() => setFolderId(null)} className={`min-h-0 shrink-0 rounded-md border-0 bg-transparent px-1.5 py-1 hover:bg-white/[0.06] hover:text-white ${here ? '' : 'font-semibold text-zinc-100'}`}>
            Bibliothèque
          </button>
          {trail.map((f, i) => (
            <span key={f.id} className="inline-flex shrink-0 items-center gap-0.5">
              <Icon name="chevron" className="size-3 opacity-60" />
              <button
                type="button"
                onClick={() => setFolderId(f.id)}
                className={`min-h-0 rounded-md border-0 bg-transparent px-1.5 py-1 hover:bg-white/[0.06] hover:text-white ${i === trail.length - 1 ? 'font-semibold text-zinc-100' : ''}`}
              >
                {f.name}
              </button>
            </span>
          ))}
        </nav>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-4">
        {!searching && !here && recents.length > 0 && (
          <>
            <h3 className={title}>Récents</h3>
            <ul className="m-0 list-none p-0">{recents.map((n) => book(n, pathOf(n)))}</ul>
          </>
        )}
        {view.folders.length > 0 && (
          <>
            <h3 className={title}>Dossiers</h3>
            <ul className="m-0 list-none p-0">{view.folders.map(folder)}</ul>
          </>
        )}
        {view.notebooks.length > 0 && (
          <>
            <h3 className={title}>{searching ? 'Cahiers' : here ? 'Cahiers du dossier' : 'Cahiers hors dossier'}</h3>
            <ul className="m-0 list-none p-0">{view.notebooks.map((n) => book(n, searching ? pathOf(n) : undefined))}</ul>
          </>
        )}
        {view.folders.length === 0 && view.notebooks.length === 0 && (
          <p className="m-0 px-3 py-8 text-center text-[13px] text-zinc-500">{searching ? 'Aucun cahier ni dossier ne correspond.' : 'Ce dossier est vide.'}</p>
        )}
      </div>
    </div>
  );
}
