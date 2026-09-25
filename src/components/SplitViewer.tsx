import { useEffect, useMemo, useRef, useState } from 'react';
import { db, useQuery } from '../db/db';
import type { Notebook, Page } from '../db/schema';
import { hasBackground, pageBackground } from '../ink/background';
import { LazyPage } from '../ink/LazyPage';
import type { LoadedPage } from '../ink/LazyPage';
import { ICONS } from './icons';
import { Icon } from './LibraryIcons';
import { NotebookPicker } from './NotebookPicker';

const NO_NOTEBOOKS: Notebook[] = [];
const NO_PAGES: Page[] = [];
const ZOOMS = [0.6, 0.8, 1, 1.25, 1.5, 2, 2.5];

/**
 * Le volet gauche de l'écran partagé : un autre cahier (typiquement le PDF du cours) en lecture, à côté
 * du cahier où l'on écrit. Défilement continu, zoom, et « ⇄ » pour échanger les deux côtés quand on veut
 * annoter le cours lui-même. Les pages ne se dessinent qu'à l'approche de l'écran (voir LazyPage).
 * Le titre ouvre le mini-explorateur (récents, dossiers, recherche) pour changer de cahier ; sans cahier
 * choisi (`notebookId` null, écran partagé qu'on vient d'ouvrir), c'est lui qui s'affiche.
 */
export function SplitViewer({
  notebookId,
  currentId,
  onPick,
  onSwap,
  onClose,
}: {
  notebookId: string | null;
  /** Le cahier ouvert dans l'éditeur (exclu de la liste) */
  currentId: string;
  onPick(id: string): void;
  onSwap(): void;
  onClose(): void;
}) {
  const notebooks = useQuery(() => db.notebooks(), [], ['notebooks']) ?? NO_NOTEBOOKS;
  const notebook = notebooks.find((n) => n.id === notebookId);
  const pages = useQuery(() => (notebookId ? db.pagesOf(notebookId) : Promise.resolve(NO_PAGES)), [notebookId], ['pages']) ?? NO_PAGES;
  const [picking, setPicking] = useState(notebookId === null);
  // Un PDF qui arrive par la synchronisation : les pages restées « indisponibles » se rechargent
  const fileCount = useQuery(() => db.fileIds().then((ids) => ids.length), [], ['files']) ?? 0;
  const ordered = useMemo(() => {
    const byId = new Map(pages.map((p) => [p.id, p]));
    return (notebook?.pageIds ?? []).map((id) => byId.get(id)).filter((p): p is Page => !!p);
  }, [pages, notebook]);

  const [zoom, setZoom] = useState(1);
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(400);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Un autre cahier : on repart du haut
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [notebookId]);

  const step = (dir: 1 | -1) => {
    const i = ZOOMS.findIndex((z) => z >= zoom - 0.001);
    setZoom(ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (i < 0 ? ZOOMS.length - 1 : i) + dir))]);
  };

  const cssWidth = Math.max(160, Math.round((width - 24) * zoom));
  const load = (p: Page) => async (): Promise<LoadedPage> => ({
    page: p,
    background: hasBackground(p) ? (pxPerMm: number) => pageBackground(p, pxPerMm) : null,
  });

  const btn =
    'inline-grid size-7 min-h-0 shrink-0 place-items-center rounded-md border-0 bg-transparent p-0 text-zinc-400 transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-30 [&_svg]:size-4';

  return (
    <section className="split-viewer flex h-full min-w-0 flex-col bg-[#18191c] text-zinc-100 [color-scheme:dark]" aria-label="Cahier ouvert à côté">
      <header className="flex h-10 shrink-0 items-center gap-1 border-b border-white/[0.06] px-1.5">
        <button
          type="button"
          onClick={() => setPicking((v) => !v || !notebookId)}
          aria-expanded={picking}
          title="Choisir le cahier affiché à côté"
          className="flex h-7 min-h-0 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-0 text-left text-[12px] font-medium text-zinc-100 transition-colors hover:bg-white/[0.08]"
        >
          {notebook && <span className="size-2 shrink-0 rounded-full" style={{ background: notebook.color }} />}
          <span className="min-w-0 flex-1 truncate">{notebook ? notebook.title : notebookId ? 'Cahier introuvable' : 'Choisir un cahier…'}</span>
          <Icon name="chevron" className={`size-3.5 shrink-0 text-zinc-400 transition-transform ${picking ? '-rotate-90' : 'rotate-90'}`} />
        </button>
        <button type="button" className={btn} onClick={() => step(-1)} disabled={zoom <= ZOOMS[0]} aria-label="Dézoomer">
          {ICONS.minus}
        </button>
        <button type="button" className={`${btn} w-10 text-[11px] tabular-nums`} onClick={() => setZoom(1)} title="Pleine largeur">
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" className={btn} onClick={() => step(1)} disabled={zoom >= ZOOMS[ZOOMS.length - 1]} aria-label="Zoomer">
          {ICONS.plus}
        </button>
        <button type="button" className={btn} onClick={onSwap} title="Échanger les deux côtés (pour annoter ce cahier)" aria-label="Échanger les côtés">
          {ICONS.swap}
        </button>
        <button type="button" className={btn} onClick={onClose} title="Fermer l’écran partagé" aria-label="Fermer l’écran partagé">
          {ICONS.close}
        </button>
      </header>
      {picking && (
        <div className="min-h-0 flex-1">
          <NotebookPicker
            currentId={currentId}
            shownId={notebookId}
            onPick={(id) => {
              setPicking(false);
              onPick(id);
            }}
            onCancel={notebookId ? () => setPicking(false) : onClose}
          />
        </div>
      )}
      <div ref={scroller} className={`min-h-0 flex-1 overflow-auto overscroll-contain ${picking ? 'hidden' : ''}`}>
        {ordered.length === 0 ? (
          <p className="m-0 p-6 text-center text-[13px] text-zinc-500">{notebook ? 'Ce cahier est vide.' : notebookId ? 'Chargement…' : ''}</p>
        ) : (
          <div className="flex w-max min-w-full flex-col items-center gap-3 px-3 py-3">
            {ordered.map((p, i) => (
              <LazyPage
                key={`${p.id}:${p.updatedAt}:${fileCount}`}
                size={[p.width, p.height]}
                cssWidth={cssWidth}
                load={load(p)}
                number={i + 1}
                defaultPaperColor={notebook?.paperColor ?? 'light'}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
