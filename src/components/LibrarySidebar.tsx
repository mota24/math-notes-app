import { useEffect, useState, useSyncExternalStore } from 'react';
import { Icon } from './LibraryIcons';
import type { IconName } from './LibraryIcons';
import { visibleNodes } from './libraryModel';
import type { FolderNode } from './libraryModel';
import { focusRing } from './libraryStyles';
import { SyncChip } from './SyncChip';

/** À partir de cette largeur (px), la barre latérale reste affichée ; en dessous, elle glisse par-dessus la page. */
const SIDEBAR_BREAKPOINT = 1024;

const wideQuery = `(min-width: ${SIDEBAR_BREAKPOINT}px)`;

/** L'écran est-il assez large pour garder la barre latérale à l'écran ? (suit la rotation de la tablette) */
function useWideScreen(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const media = window.matchMedia(wideQuery);
      media.addEventListener('change', notify);
      return () => media.removeEventListener('change', notify);
    },
    () => window.matchMedia(wideQuery).matches,
  );
}

const navItem = `flex min-h-11 w-full items-center gap-3 rounded-xl border-0 px-3 py-0 text-left text-[15px] font-medium transition-all duration-200 ${focusRing}`;
const navIdle = 'bg-transparent text-zinc-600 hover:bg-black/5 dark:text-zinc-300 dark:hover:bg-white/5';
const navActive = 'relative bg-black/[0.07] text-zinc-900 before:absolute before:left-0 before:top-2.5 before:h-6 before:w-[3px] before:rounded-full before:bg-accent dark:bg-white/10 dark:text-white';

function NavButton({ icon, label, active = false, badge, onClick }: { icon: IconName; label: string; active?: boolean; badge?: number; onClick(): void }) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined} className={`${navItem} ${active ? navActive : navIdle}`}>
      <Icon name={icon} className="size-5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge ? <span className="rounded-full bg-black/10 px-2 py-0.5 text-xs font-semibold tabular-nums dark:bg-white/10">{badge}</span> : null}
    </button>
  );
}

/** Une ligne de l'arbre des dossiers : un chevron pour déplier, puis le dossier (un tap l'ouvre). */
function TreeRow({ node, open, active, onToggle, onOpen }: { node: FolderNode; open: boolean; active: boolean; onToggle(): void; onOpen(): void }) {
  const expandable = node.children.length > 0;
  return (
    <div className="flex items-center" style={{ paddingLeft: node.depth * 14 }}>
      <button
        type="button"
        onClick={onToggle}
        disabled={!expandable}
        aria-label={open ? 'Replier' : 'Déplier'}
        aria-expanded={expandable ? open : undefined}
        className={`grid size-8 shrink-0 place-items-center rounded-lg border-0 bg-transparent p-0 min-h-0 text-zinc-400 transition-colors duration-200 hover:bg-black/5 disabled:opacity-0 dark:hover:bg-white/5 ${focusRing}`}
      >
        <Icon name="chevron" className={`size-4 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
      </button>
      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? 'page' : undefined}
        className={`flex min-h-10 min-w-0 flex-1 items-center gap-2.5 rounded-xl border-0 px-2.5 py-0 text-left text-sm transition-all duration-200 ${focusRing} ${
          active ? 'bg-black/[0.07] font-semibold text-zinc-900 dark:bg-white/10 dark:text-white' : 'bg-transparent text-zinc-600 hover:bg-black/5 dark:text-zinc-300 dark:hover:bg-white/5'
        }`}
      >
        <span className="size-2.5 shrink-0 rounded-full" style={{ background: node.folder.color }} />
        <span className="truncate">{node.folder.name}</span>
      </button>
    </div>
  );
}

export interface SidebarProps {
  /** Ouverte (sur un petit écran, où elle glisse par-dessus la page) */
  open: boolean;
  onClose(): void;
  query: string;
  onQuery(query: string): void;
  tree: FolderNode[];
  currentFolderId: string | null;
  /** Le chemin du dossier ouvert, lui compris : ces dossiers sont dépliés d'office, on voit où l'on est et où aller */
  openIds: string[];
  /** À la racine de la bibliothèque (ni dossier, ni corbeille, ni recherche) */
  atHome: boolean;
  inTrash: boolean;
  trashCount: number;
  onHome(): void;
  onFolder(id: string): void;
  onTrash(): void;
  onNewFolder(): void;
  onHandwriting(): void;
  onSettings(): void;
}

/**
 * La barre latérale de la bibliothèque : le nom de l'appli, la recherche, la navigation (Bibliothèque, l'arbre de
 * Mes dossiers, Corbeille), puis Mon écriture, les réglages et l'état de la synchronisation. Un peu plus sombre
 * que la page, et fixe à gauche sur un écran large ; sur un petit écran, un tiroir qu'ouvre le bouton du haut.
 */
export function LibrarySidebar(p: SidebarProps) {
  const wide = useWideScreen();
  const [foldersOpen, setFoldersOpen] = useState(true);
  const [unfolded, setUnfolded] = useState<Set<string>>(() => new Set(p.openIds));

  // Ouvrir un dossier déplie le chemin qui y mène : on le voit toujours dans l'arbre
  const openKey = p.openIds.join('|');
  useEffect(() => {
    setUnfolded((prev) => (p.openIds.every((id) => prev.has(id)) ? prev : new Set([...prev, ...p.openIds])));
    // openKey résume openIds
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey]);

  useEffect(() => {
    if (!p.open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && p.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p.open, p.onClose]);

  const toggle = (id: string) =>
    setUnfolded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const rows = visibleNodes(p.tree, unfolded);

  return (
    <aside
      aria-label="Navigation de la bibliothèque"
      inert={!wide && !p.open}
      className={`absolute inset-y-0 left-0 z-40 flex w-[280px] max-w-[85%] flex-col gap-3 border-r border-zinc-200 bg-zinc-100 p-4 shadow-2xl duration-300 ease-out max-lg:transition-transform lg:static lg:z-auto lg:w-[250px] lg:max-w-none lg:shrink-0 lg:translate-x-0 lg:shadow-none dark:border-white/5 dark:bg-zinc-950 ${
        p.open ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={p.onHome}
          className={`flex min-h-11 min-w-0 items-center gap-2.5 rounded-xl border-0 bg-transparent px-2 py-0 text-[17px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 ${focusRing}`}
        >
          <img src="icon.svg" alt="" width={28} height={28} className="block size-7 rounded-lg" />
          <span className="truncate">Notes Maths</span>
        </button>
        <button
          type="button"
          onClick={p.onClose}
          aria-label="Fermer le menu"
          className={`grid size-11 min-h-0 shrink-0 place-items-center rounded-xl border-0 bg-transparent p-0 text-zinc-500 hover:bg-black/5 lg:hidden dark:text-zinc-400 dark:hover:bg-white/5 ${focusRing}`}
        >
          <Icon name="close" />
        </button>
      </div>

      <label className="relative block">
        <span className="sr-only">Rechercher un cahier, une formule, un mot</span>
        <Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 z-10 size-[18px] -translate-y-1/2 text-zinc-400" />
        <input
          type="search"
          value={p.query}
          onChange={(e) => p.onQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !wide && p.onClose()}
          enterKeyHint="search"
          placeholder="Rechercher…"
          title="Rechercher un cahier, une formule, un mot…"
          className="h-11 w-full appearance-none rounded-xl border border-black/10 bg-white/70 pl-10 pr-10 text-sm text-zinc-900 outline-none backdrop-blur-md transition-all duration-200 placeholder:text-zinc-400 focus:border-accent/50 focus:bg-white focus:ring-2 focus:ring-accent/25 dark:border-white/10 dark:bg-white/5 dark:text-zinc-100 dark:focus:bg-white/[0.08] [&::-webkit-search-cancel-button]:hidden"
        />
        {p.query && (
          <button
            type="button"
            onClick={() => p.onQuery('')}
            aria-label="Effacer la recherche"
            className={`absolute right-1 top-1/2 grid size-9 min-h-0 -translate-y-1/2 place-items-center rounded-lg border-0 bg-transparent p-0 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 ${focusRing}`}
          >
            <Icon name="close" className="size-4" />
          </button>
        )}
      </label>

      <nav aria-label="Bibliothèque" className="flex min-h-0 flex-1 flex-col gap-1">
        <NavButton icon="library" label="Bibliothèque" active={p.atHome} onClick={p.onHome} />
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setFoldersOpen((v) => !v)}
            aria-expanded={foldersOpen}
            className={`${navItem} ${navIdle} flex-1`}
          >
            <Icon name="folder" className="size-5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">Mes dossiers</span>
            <Icon name="chevron" className={`size-4 shrink-0 text-zinc-400 transition-transform duration-200 ${foldersOpen ? 'rotate-90' : ''}`} />
          </button>
          <button
            type="button"
            onClick={p.onNewFolder}
            aria-label="Nouveau dossier"
            title="Nouveau dossier"
            className={`grid size-11 min-h-0 shrink-0 place-items-center rounded-xl border-0 bg-transparent p-0 text-zinc-500 transition-colors duration-200 hover:bg-black/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white ${focusRing}`}
          >
            <Icon name="plus" className="size-[18px]" />
          </button>
        </div>
        {foldersOpen && (
          <div className="-mr-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-1">
            {rows.length === 0 ? (
              <p className="m-0 px-3 py-2 text-[13px] leading-snug text-zinc-500 dark:text-zinc-400">Pas encore de dossier. Range tes cahiers par semestre ou par matière.</p>
            ) : (
              rows.map((node) => (
                <TreeRow
                  key={node.folder.id}
                  node={node}
                  open={unfolded.has(node.folder.id)}
                  active={node.folder.id === p.currentFolderId}
                  onToggle={() => toggle(node.folder.id)}
                  onOpen={() => p.onFolder(node.folder.id)}
                />
              ))
            )}
          </div>
        )}
      </nav>

      <div className="flex flex-col gap-1 border-t border-black/5 pt-3 dark:border-white/5">
        <NavButton icon="trash" label="Corbeille" active={p.inTrash} badge={p.trashCount} onClick={p.onTrash} />
        <NavButton icon="pen" label="Mon écriture" onClick={p.onHandwriting} />
        <NavButton icon="settings" label="Réglages" onClick={p.onSettings} />
        <div className="empty:hidden [&>*]:w-full [&>*]:justify-center">
          <SyncChip />
        </div>
      </div>
    </aside>
  );
}
