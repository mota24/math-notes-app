import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
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
 * La coque commune des cartes : une surface grise unie, un contour d'un pixel, une ombre douce qui se creuse à
 * peine au survol. La couleur de l'élément n'apparaît plus qu'en pastille (voir les cartes) : ni bordure
 * teintée ni lueur. Un bouton couvre toute la carte (clavier et lecteur d'écran y trouvent « ouvrir »), puis
 * les commandes sont posées par-dessus, à côté de la surface pour que le menu ne soit jamais rogné.
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
        className={`${glassPanel} relative h-full overflow-hidden transition-[background-color,border-color,box-shadow,transform] duration-200 group-hover:-translate-y-px group-hover:border-white/[0.1] group-hover:bg-[#1e1f24] group-hover:shadow-[0_2px_4px_rgba(0,0,0,0.35),0_18px_40px_-22px_rgba(0,0,0,0.8)] group-active:translate-y-0`}
      >
        {children}
      </div>
      <button type="button" aria-label={label} onClick={onOpen} className={`absolute inset-0 z-10 min-h-0 rounded-2xl border-0 bg-transparent p-0 ${focusRing}`} />
      {corner}
      <CardMenu items={menu} color={color} onColor={onColor} className={menuClass} />
    </article>
  );
}

/** La couleur d'un cahier ou d'un dossier : une simple pastille */
function Dot({ color }: { color: string }) {
  return <span aria-hidden="true" className="inline-block size-2 shrink-0 rounded-full" style={{ background: color }} />;
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
    <CardShell label={`Ouvrir le dossier « ${folder.name} »`} color={folder.color} onOpen={onOpen} menu={menu} onColor={onColor} menuClass="right-2.5 top-1/2 -translate-y-1/2">
      <div className="flex min-h-[64px] items-center gap-3 p-3.5 pr-14">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/[0.04]" style={{ color: folder.color }}>
          <Icon name="folder" className="size-5" />
        </span>
        <div className="min-w-0">
          <h3 className="m-0 truncate text-[15px] font-semibold text-zinc-100">{folder.name}</h3>
          <p className="m-0 mt-0.5 truncate text-xs text-zinc-500">{count}</p>
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
      menuClass="bottom-2.5 right-2.5"
      className={className}
      // Un cahier favori se reconnaît à une petite étoile devant son titre (l'action est dans le menu « ⋯ »)
    >
      <div className="flex h-full min-h-[196px] flex-col">
        {/* Le papier du cahier, en miniature : il s'efface vers le bas, comme une page qui dépasse de la carte */}
        <div
          aria-hidden="true"
          className="mx-2.5 mt-2.5 h-24 shrink-0 rounded-[10px] border border-white/[0.06] [-webkit-mask-image:linear-gradient(to_bottom,#000_60%,transparent)] [mask-image:linear-gradient(to_bottom,#000_60%,transparent)] brightness-[0.88]"
          style={paperPreview(notebook.paper, notebook.paperColor)}
        />
        <div className="flex flex-1 flex-col gap-1 px-3.5 pb-3.5 pt-2.5">
          <h3 className="m-0 line-clamp-2 flex items-start gap-1.5 text-base font-semibold leading-snug text-zinc-100">
            {notebook.favorite && (
              <span className="mt-0.5 shrink-0 text-amber-300" title="Favori">
                <Icon name="star" filled className="size-4" />
              </span>
            )}
            {notebook.title}
          </h3>
          {notebook.subject && <p className="m-0 truncate text-[13px] text-zinc-400">{notebook.subject}</p>}
          <p className="m-0 mt-auto flex items-center gap-2 truncate pt-2 pr-10 text-xs text-zinc-500">
            <Dot color={notebook.color} />
            <span className="truncate">
              {pages} page{pages > 1 ? 's' : ''} · {date(notebook.updatedAt)}
              {badge && <span className="text-accent"> · {badge}</span>}
            </span>
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
      className={`group flex min-h-[196px] w-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/[0.1] bg-transparent p-4 text-zinc-500 transition-colors duration-200 hover:border-white/20 hover:bg-white/[0.02] hover:text-zinc-200 ${focusRing}`}
    >
      <span className="grid size-10 place-items-center rounded-full border border-current/30">
        <Icon name="plus" className="size-5" />
      </span>
      <span className="text-sm font-medium">Nouveau cahier</span>
    </button>
  );
}
