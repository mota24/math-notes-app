import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { NOTEBOOK_COLORS } from '../db/schema';
import type { Folder, Notebook } from '../db/schema';
import { Icon } from './LibraryIcons';
import { paperPreview } from './libraryModel';
import { focusRing, glassPanel, roundButton } from './libraryStyles';

const date = (t: number) => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

export interface MenuItem {
  label: string;
  onClick(): void;
  danger?: boolean;
}

/** Ce qui rend une carte à peine visible au repos et plus nette au survol d'une souris (jamais sur une tablette tactile) */
const revealOnHover = 'pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100';

/** Taille du menu (w-60 et sa hauteur habituelle) : sert à choisir de quel côté l'ouvrir pour qu'il reste entier à l'écran. */
const MENU_W = 240;
const MENU_H = 280;

/**
 * Un contact plus gros qu'un doigt (la paume posée sur la tablette fait ~200 px) ne compte pas comme un
 * « tap ailleurs » : sinon le menu se refermait dans la seconde où il s'ouvrait, stylet dans une main et
 * paume sur l'écran — il semblait alors ne jamais s'ouvrir.
 */
const PALM_CONTACT = 60;

/**
 * Options d'une carte : la couleur du cahier ou du dossier, puis les actions. Le menu s'ouvre du côté où il y a
 * la place (il est rogné par le défilement de la page sinon) ; il se ferme d'un tap ailleurs ou sur Échap.
 */
function CardMenu({ items, color, onColor, className }: { items: MenuItem[]; color: string; onColor(c: string): void; className: string }) {
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState({ up: true, shift: 0 });
  const root = useRef<HTMLDivElement>(null);
  /** Instant d'ouverture : la fin du geste qui ouvre le menu ne doit pas le refermer aussitôt. */
  const openedAt = useRef(0);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      // Les événements de la fin du tap qui vient d'ouvrir le menu (contacts multiples, événements de
      // compatibilité souris émis après un tap tactile) arrivent juste après : on les laisse passer.
      if (Date.now() - openedAt.current < 350) return;
      if (e.pointerType === 'touch' && Math.max(e.width, e.height) >= PALM_CONTACT) return;
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
    const r = root.current?.getBoundingClientRect();
    // La zone visible est celle qui défile (<main>), pas la fenêtre : c'est elle qui rogne le menu.
    const clip = root.current?.closest('main')?.getBoundingClientRect();
    if (!open && r) {
      const clipLeft = clip?.left ?? 0;
      const clipRight = clip?.right ?? window.innerWidth;
      const clipTop = clip?.top ?? 0;
      const clipBottom = clip?.bottom ?? window.innerHeight;
      // Le menu est calé à droite du bouton : on le repousse juste ce qu'il faut pour qu'aucun bord ne sorte.
      const width = Math.min(MENU_W, clipRight - clipLeft - 16);
      let shift = 0;
      if (r.right - width < clipLeft + 8) shift = clipLeft + 8 - (r.right - width);
      else if (r.right > clipRight - 8) shift = clipRight - 8 - r.right;
      setSide({ up: clipBottom - r.bottom < MENU_H && r.top - clipTop > MENU_H, shift });
    }
    openedAt.current = Date.now();
    setOpen((v) => !v);
  };

  return (
    <div ref={root} className={`absolute z-20 ${className}`}>
      <button
        type="button"
        className={`${roundButton} ${open ? '' : revealOnHover}`}
        aria-label="Options"
        aria-expanded={open}
        // Le bouton « ouvrir le cahier » couvre toute la carte juste en dessous : on coupe la propagation
        // pour qu'aucun geste sur le menu ne lui parvienne.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          toggle();
        }}
      >
        <Icon name="ellipsis" />
      </button>
      {open && (
        <div
          role="menu"
          onPointerDown={(e) => e.stopPropagation()}
          style={{ marginRight: -side.shift }}
          className={`absolute right-0 z-40 w-60 max-w-[calc(100vw-1rem)] animate-pop rounded-2xl border border-zinc-200 bg-white/95 p-1.5 shadow-2xl backdrop-blur-xl dark:border-zinc-700 dark:bg-zinc-900/95 ${
            side.up ? 'bottom-full mb-2 origin-bottom-right' : 'top-full mt-2 origin-top-right'
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
  menu,
  onColor,
  badge,
  className,
}: {
  notebook: Notebook;
  onOpen(): void;
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
      // Un cahier favori se reconnaît à une petite étoile dans son pied de carte : plus de bouton flottant
      // qui passait par-dessus le titre de la section (l'action est passée dans le menu « ⋯ »).
    >
      <div className="flex h-full min-h-[210px] flex-col">
        {/* Le papier du cahier, en miniature : il s'efface vers le bas, comme une page qui dépasse de la carte */}
        <div
          aria-hidden="true"
          className="mx-3 mt-3 h-24 shrink-0 rounded-xl border border-white/10 shadow-sm [-webkit-mask-image:linear-gradient(to_bottom,#000_55%,transparent)] [mask-image:linear-gradient(to_bottom,#000_55%,transparent)] brightness-[0.9]"
          style={paperPreview(notebook.paper, notebook.paperColor)}
        />
        <div className="flex flex-1 flex-col gap-1 px-4 pb-4 pt-3">
          <h3 className="m-0 line-clamp-2 flex items-start gap-1.5 text-lg font-semibold leading-snug text-zinc-100">
            {notebook.favorite && (
              <span className="mt-0.5 shrink-0 text-amber-300" title="Favori">
                <Icon name="star" filled className="size-4" />
              </span>
            )}
            {notebook.title}
          </h3>
          {notebook.subject && <p className="m-0 truncate text-[13px] text-zinc-300">{notebook.subject}</p>}
          <p className="m-0 mt-auto truncate pt-2 text-xs text-zinc-400">
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
