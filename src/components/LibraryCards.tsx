import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { NOTEBOOK_COLORS } from '../db/schema';
import type { Folder, Notebook } from '../db/schema';
import { Icon } from './LibraryIcons';
import { paperPreview } from './libraryModel';
import { focusRing, glassPanel, roundButton, roundButtonOn } from './libraryStyles';

const date = (t: number) => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

export interface MenuItem {
  label: string;
  onClick(): void;
  danger?: boolean;
}

/** Ce qui rend une carte à peine visible au repos et plus nette au survol d'une souris (jamais sur une tablette tactile) */
const revealOnHover = 'pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100';

/**
 * Options d'une carte : la couleur du cahier ou du dossier, puis les actions. Le menu s'ouvre vers le haut, sauf
 * si la carte est tout en haut de l'écran ; il se ferme d'un tap ailleurs ou sur Échap.
 */
function CardMenu({ items, color, onColor, className }: { items: MenuItem[]; color: string; onColor(c: string): void; className: string }) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(true);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    if (!open) setUp((root.current?.getBoundingClientRect().top ?? 0) > 320);
    setOpen((v) => !v);
  };

  return (
    <div ref={root} className={`absolute z-20 ${className}`}>
      <button
        type="button"
        className={`${roundButton} ${open ? '' : revealOnHover}`}
        aria-label="Options"
        aria-expanded={open}
        onClick={toggle}
      >
        <Icon name="ellipsis" />
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute right-0 z-40 w-60 animate-pop rounded-2xl border border-zinc-200 bg-white/95 p-1.5 shadow-2xl backdrop-blur-xl dark:border-zinc-700 dark:bg-zinc-900/95 ${
            up ? 'bottom-full mb-2 origin-bottom-right' : 'top-full mt-2 origin-top-right'
          }`}
        >
          <div className="flex flex-wrap gap-2 p-2 pb-2.5">
            {NOTEBOOK_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label="Couleur"
                aria-pressed={c === color}
                className={`size-7 min-h-0 rounded-full border-2 border-white/40 p-0 transition-all duration-200 hover:scale-110 ${
                  c === color ? 'ring-2 ring-accent ring-offset-2 ring-offset-white dark:ring-offset-zinc-900' : ''
                }`}
                style={{ background: c }}
                onClick={() => {
                  onColor(c);
                  setOpen(false);
                }}
              />
            ))}
          </div>
          <div className="mx-1 mb-1 h-px bg-black/5 dark:bg-white/10" />
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={`flex min-h-11 w-full items-center rounded-xl border-0 bg-transparent px-3 py-0 text-left text-sm transition-colors duration-150 ${
                item.danger
                  ? 'text-red-600 hover:bg-red-500/10 dark:text-red-400'
                  : 'text-zinc-800 hover:bg-black/5 dark:text-zinc-100 dark:hover:bg-white/10'
              }`}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * La coque commune des cartes : une surface de verre, la couleur de l'élément en discret (une fine ligne en
 * haut et une lueur très douce dans un coin), un bouton qui couvre toute la carte (clavier et lecteur d'écran y
 * trouvent « ouvrir »), puis les commandes posées par-dessus. Les commandes sont à côté de la surface, pas
 * dedans : elle grandit au survol, et le menu, lui, ne doit ni suivre ni être rogné.
 */
function CardShell({
  label,
  color,
  onOpen,
  menu,
  onColor,
  menuClass,
  corner,
  className = '',
  children,
}: {
  label: string;
  color: string;
  onOpen(): void;
  menu: MenuItem[];
  onColor(c: string): void;
  menuClass: string;
  corner?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <article className={`group relative has-[[role=menu]]:z-30 ${className}`}>
      <div
        className={`${glassPanel} relative h-full overflow-hidden transition-all duration-300 group-hover:scale-[1.02] group-hover:shadow-2xl group-active:scale-[0.99]`}
        style={{
          borderColor: `color-mix(in srgb, ${color} 35%, rgba(107, 114, 128, 0.35))`,
          boxShadow: `0 12px 28px -6px color-mix(in srgb, ${color} 18%, rgba(0,0,0,0.3)), 0 8px 12px -6px rgba(0,0,0,0.25)`,
        }}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-[3px] opacity-90"
          style={{ background: `linear-gradient(90deg, ${color}, ${color} 55%, transparent)` }}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-6 -top-6 size-48 opacity-25 transition-opacity duration-300 group-hover:opacity-45"
          style={{ background: `radial-gradient(circle at 70% 30%, ${color}, transparent 68%)` }}
        />
        {children}
      </div>
      <button type="button" aria-label={label} onClick={onOpen} className={`absolute inset-0 z-10 min-h-0 rounded-2xl border-0 bg-transparent p-0 ${focusRing}`} />
      {corner}
      <CardMenu items={menu} color={color} onColor={onColor} className={menuClass} />
    </article>
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
    <CardShell label={`Ouvrir le dossier « ${folder.name} »`} color={folder.color} onOpen={onOpen} menu={menu} onColor={onColor} menuClass="right-3 top-1/2 -translate-y-1/2">
      <div className="flex min-h-[76px] items-center gap-3.5 p-4 pr-16" style={{ '--nb': folder.color } as CSSProperties}>
        <span className="grid size-12 shrink-0 place-items-center rounded-xl border border-[color-mix(in_srgb,var(--nb)_45%,transparent)] bg-[color-mix(in_srgb,var(--nb)_20%,transparent)] text-white">
          <Icon name="folder" className="size-6" />
        </span>
        <div className="min-w-0">
          <h3 className="m-0 truncate text-base font-semibold text-zinc-100">{folder.name}</h3>
          <p className="m-0 mt-0.5 truncate text-xs text-zinc-400">{count}</p>
        </div>
      </div>
    </CardShell>
  );
}

export function NotebookCard({
  notebook,
  onOpen,
  onFavorite,
  menu,
  onColor,
  badge,
  className,
}: {
  notebook: Notebook;
  onOpen(): void;
  onFavorite(): void;
  menu: MenuItem[];
  onColor(c: string): void;
  /** Un mot de contexte à la suite de la date (page trouvée par une recherche) */
  badge?: string;
  className?: string;
}) {
  const pages = notebook.pageIds.length;
  return (
    <CardShell
      label={`Ouvrir « ${notebook.title} »`}
      color={notebook.color}
      onOpen={onOpen}
      menu={menu}
      onColor={onColor}
      menuClass="bottom-3 right-3"
      className={className}
      corner={
        <button
          type="button"
          className={`absolute right-5 top-5 z-20 ${notebook.favorite ? roundButtonOn : roundButton}`}
          aria-label={notebook.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
          aria-pressed={notebook.favorite}
          onClick={onFavorite}
        >
          <Icon name="star" filled={notebook.favorite} className="size-[18px]" />
        </button>
      }
    >
      <div className="flex h-full min-h-[210px] flex-col">
        {/* Le papier du cahier, en miniature : il s'efface vers le bas, comme une page qui dépasse de la carte */}
        <div
          aria-hidden="true"
          className="mx-3 mt-3 h-24 shrink-0 rounded-xl border border-white/10 shadow-sm [-webkit-mask-image:linear-gradient(to_bottom,#000_55%,transparent)] [mask-image:linear-gradient(to_bottom,#000_55%,transparent)] brightness-[0.9]"
          style={paperPreview(notebook.paper, notebook.paperColor)}
        />
        <div className="flex flex-1 flex-col gap-1 px-4 pb-4 pt-3">
          <h3 className="m-0 line-clamp-2 text-lg font-semibold leading-snug text-zinc-100">{notebook.title}</h3>
          {notebook.subject && <p className="m-0 truncate text-[13px] text-zinc-300">{notebook.subject}</p>}
          <p className="m-0 mt-auto truncate pr-11 pt-2 text-xs text-zinc-400">
            {pages} page{pages > 1 ? 's' : ''} · {date(notebook.updatedAt)}
            {badge && <span className="text-accent"> · {badge}</span>}
          </p>
        </div>
      </div>
    </CardShell>
  );
}

/** La case vide à la fin de la grille des cahiers : elle comble la rangée et dit où en créer un */
export function NewNotebookCard({ onClick }: { onClick(): void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex min-h-[210px] w-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-gray-700/80 bg-gray-800/30 p-4 text-zinc-400 backdrop-blur-md transition-all duration-300 hover:border-gray-500 hover:bg-gray-800/50 hover:text-zinc-100 ${focusRing}`}
    >
      <span className="grid size-12 place-items-center rounded-full border border-current/40 transition-transform duration-300 group-hover:scale-110">
        <Icon name="plus" className="size-6" />
      </span>
      <span className="text-sm font-medium">Nouveau cahier</span>
    </button>
  );
}
