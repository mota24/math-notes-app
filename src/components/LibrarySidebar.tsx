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

/**
 * Densité « Notion / VS Code » : des lignes de 30 px (28 px dans l'arbre), du texte en 13 px, des icônes de
 * 16 px. Le stylet vise bien plus fin qu'un doigt ; toute la largeur de la ligne reste cliquable.
 */
const navItem = `flex h-[30px] min-h-0 w-full items-center gap-2.5 rounded-md border-0 px-2 py-0 text-left text-[13px] font-medium transition-colors duration-100 ${focusRing}`;
const navIdle = 'bg-transparent text-zinc-600 hover:bg-black/5 dark:text-zinc-400 dark:hover:bg-white/[0.05] dark:hover:text-zinc-100';
const navActive = 'bg-black/[0.07] text-zinc-900 dark:bg-white/[0.08] dark:text-white';

function NavButton({ icon, label, active = false, badge, onClick }: { icon: IconName; label: string; active?: boolean; badge?: number; onClick(): void }) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined} className={`${navItem} ${active ? navActive : navIdle}`}>
      <Icon name={icon} className="size-4 shrink-0 opacity-80" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge ? <span className="text-[11px] font-semibold tabular-nums text-zinc-500">{badge}</span> : null}
    </button>
  );
}

/** Une ligne de l'arbre des dossiers : un chevron pour déplier, puis le dossier (un tap l'ouvre). */
function TreeRow({ node, open, active, onToggle, onOpen }: { node: FolderNode; open: boolean; active: boolean; onToggle(): void; onOpen(): void }) {
  const expandable = node.children.length > 0;
  return (
    <div
      className={`group/row flex h-7 shrink-0 items-center rounded-md transition-colors duration-100 ${
        active ? 'bg-black/[0.07] dark:bg-white/[0.08]' : 'hover:bg-black/5 dark:hover:bg-white/[0.05]'
      }`}
      style={{ paddingLeft: 2 + node.depth * 12 }}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={!expandable}
        aria-label={open ? 'Replier' : 'Déplier'}
        aria-expanded={expandable ? open : undefined}
        className={`grid size-5 min-h-0 shrink-0 place-items-center rounded border-0 bg-transparent p-0 text-zinc-500 transition-colors duration-100 hover:bg-black/10 hover:text-zinc-900 disabled:opacity-0 dark:hover:bg-white/10 dark:hover:text-white ${focusRing}`}
      >
        <Icon name="chevron" className={`size-3 transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />
      </button>
      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? 'page' : undefined}
        className={`flex h-7 min-h-0 min-w-0 flex-1 items-center gap-2 rounded-md border-0 bg-transparent py-0 pl-1 pr-2 text-left text-[13px] ${focusRing} ${
          active ? 'font-semibold text-zinc-900 dark:text-white' : 'text-zinc-600 dark:text-zinc-400 dark:group-hover/row:text-zinc-100'
        }`}
      >
        <span className="size-2 shrink-0 rounded-full" style={{ background: node.folder.color }} />
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
  onCalendar(): void;
}

/**
 * La barre latérale de la bibliothèque, en trois étages :
 *  - en haut (fixe) : le nom de l'appli et la recherche ;
 *  - au milieu : Bibliothèque puis l'arbre de « Mes dossiers », qui est la SEULE partie à défiler ;
 *  - en bas (fixe, toujours visible) : Calendrier, Corbeille, Mon écriture, Réglages et la synchronisation.
 * Fixe à gauche sur un écran large ; sur un petit écran, un tiroir qu'ouvre le bouton du haut.
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
      className={`absolute inset-y-0 left-0 z-40 flex w-[260px] max-w-[85%] flex-col border-r border-zinc-200 bg-zinc-100 shadow-2xl duration-300 ease-out max-lg:transition-transform lg:static lg:z-auto lg:h-full lg:w-[232px] lg:max-w-none lg:shrink-0 lg:translate-x-0 lg:shadow-none dark:border-white/[0.05] dark:bg-[#0c0d0f] ${
        p.open ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      {/* En haut (fixe) : nom de l'appli et recherche */}
      <div className="flex shrink-0 flex-col gap-2 px-2.5 pb-2 pt-3">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={p.onHome}
            className={`flex h-8 min-h-0 min-w-0 items-center gap-2 rounded-md border-0 bg-transparent px-1.5 py-0 text-[14px] font-semibold tracking-tight text-zinc-900 hover:bg-black/5 dark:text-zinc-100 dark:hover:bg-white/[0.05] ${focusRing}`}
          >
            <img src="icon.svg" alt="" width={20} height={20} className="block size-5 rounded" />
            <span className="truncate">Notes Maths</span>
          </button>
          <button
            type="button"
            onClick={p.onClose}
            aria-label="Fermer le menu"
            className={`grid size-8 min-h-0 shrink-0 place-items-center rounded-md border-0 bg-transparent p-0 text-zinc-500 hover:bg-black/5 lg:hidden dark:text-zinc-400 dark:hover:bg-white/[0.05] ${focusRing}`}
          >
            <Icon name="close" className="size-4" />
          </button>
        </div>

        <label className="relative block">
          <span className="sr-only">Rechercher un cahier, une formule, un mot</span>
          <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 z-10 size-3.5 -translate-y-1/2 text-zinc-500" />
          <input
            type="search"
            value={p.query}
            onChange={(e) => p.onQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !wide && p.onClose()}
            enterKeyHint="search"
            placeholder="Rechercher…"
            title="Rechercher un cahier, une formule, un mot…"
            className="h-8 min-h-0 w-full appearance-none rounded-md border border-black/10 bg-white/70 py-0 pl-8 pr-8 text-[13px] text-zinc-900 outline-none transition-colors duration-150 placeholder:text-zinc-500 focus:border-accent/50 focus:bg-white dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-zinc-100 dark:focus:bg-white/[0.06] [&::-webkit-search-cancel-button]:hidden"
          />
          {p.query && (
            <button
              type="button"
              onClick={() => p.onQuery('')}
              aria-label="Effacer la recherche"
              className={`absolute right-1 top-1/2 grid size-6 min-h-0 -translate-y-1/2 place-items-center rounded border-0 bg-transparent p-0 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 ${focusRing}`}
            >
              <Icon name="close" className="size-3.5" />
            </button>
          )}
        </label>
      </div>

      {/* Au milieu : seule cette partie défile */}
      <nav aria-label="Bibliothèque" className="flex min-h-0 flex-1 flex-col px-2.5">
        <div className="shrink-0">
          <NavButton icon="library" label="Bibliothèque" active={p.atHome} onClick={p.onHome} />
        </div>
        <div className="mt-3 flex h-6 shrink-0 items-center gap-1 pl-2 pr-0.5">
          <button
            type="button"
            onClick={() => setFoldersOpen((v) => !v)}
            aria-expanded={foldersOpen}
            className={`flex h-6 min-h-0 min-w-0 flex-1 items-center gap-1 rounded border-0 bg-transparent p-0 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 ${focusRing}`}
          >
            <span className="truncate">Mes dossiers</span>
            <Icon name="chevron" className={`size-3 shrink-0 transition-transform duration-150 ${foldersOpen ? 'rotate-90' : ''}`} />
          </button>
          <button
            type="button"
            onClick={p.onNewFolder}
            aria-label="Nouveau dossier"
            title="Nouveau dossier"
            className={`grid size-6 min-h-0 shrink-0 place-items-center rounded border-0 bg-transparent p-0 text-zinc-500 transition-colors duration-100 hover:bg-black/5 hover:text-zinc-900 dark:hover:bg-white/[0.08] dark:hover:text-white ${focusRing}`}
          >
            <Icon name="plus" className="size-3.5" />
          </button>
        </div>
        {foldersOpen && (
          <div className="-mr-1.5 mt-0.5 flex min-h-0 flex-1 flex-col gap-px overflow-y-auto overscroll-contain pb-2 pr-1.5 [scrollbar-width:thin]">
            {rows.length === 0 ? (
              <p className="m-0 px-2 py-1.5 text-[12px] leading-snug text-zinc-500">Pas encore de dossier. Range tes cahiers par semestre ou par matière.</p>
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

      {/* En bas (fixe) : toujours visible, quel que soit le nombre de dossiers */}
      <div className="flex shrink-0 flex-col gap-px border-t border-black/5 px-2.5 pb-3 pt-2 dark:border-white/[0.05]">
        <NavButton icon="calendar" label="Calendrier" onClick={p.onCalendar} />
        <NavButton icon="trash" label="Corbeille" active={p.inTrash} badge={p.trashCount} onClick={p.onTrash} />
        <NavButton icon="pen" label="Mon écriture" onClick={p.onHandwriting} />
        <NavButton icon="settings" label="Réglages" onClick={p.onSettings} />
        <div className="mt-1 empty:hidden [&>*]:w-full [&>*]:justify-center">
          <SyncChip />
        </div>
      </div>
    </aside>
  );
}
