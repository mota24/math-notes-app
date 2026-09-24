import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { db, useQuery } from '../db/db';
import {
  createFolder,
  createNotebook,
  importPdfNotebook,
  purgeFolder,
  purgeNotebook,
  restoreFolder,
  restoreNotebook,
  search,
  trashFolder,
  trashNotebook,
  updateFolder,
  updateNotebook,
} from '../db/library';
import type { Folder, Notebook, Todo } from '../db/schema';
import type { PaperStyle } from '../ink/types';
import { go } from '../router';
import type { Route } from '../router';
import { FolderCard, NewNotebookCard, NotebookCard } from './LibraryCards';
import type { MenuItem } from './LibraryCards';
import { Icon } from './LibraryIcons';
import type { IconName } from './LibraryIcons';
import { buildFolderTree, countChildren, countLabel, folderPath, viewTitle } from './libraryModel';
import { LibrarySidebar } from './LibrarySidebar';
import { glassButton, glassButtonAccent, glassIconButton, glassPanel } from './libraryStyles';
import { ConfirmDialog, FolderPicker, Modal, PromptDialog } from './Modal';
import { TodoPanel } from './TodoPanel';

type Dialog =
  | { kind: 'new-folder' }
  | { kind: 'new-notebook' }
  | { kind: 'rename-folder'; folder: Folder }
  | { kind: 'rename-notebook'; notebook: Notebook }
  | { kind: 'subject'; notebook: Notebook }
  | { kind: 'move-folder'; folder: Folder }
  | { kind: 'move-notebook'; notebook: Notebook }
  | { kind: 'purge'; label: string; run(): Promise<void> }
  | null;

const PAPERS: { value: PaperStyle; label: string }[] = [
  { value: 'grid', label: 'Petits carreaux' },
  { value: 'seyes', label: 'Seyès (grands carreaux)' },
  { value: 'lined', label: 'Lignes' },
  { value: 'blank', label: 'Blanc' },
];

/** Les grilles suivent la largeur de la zone de contenu (la barre latérale n'en fait pas partie), pas celle de l'écran */
const notebookGrid = 'grid grid-cols-2 gap-4 @2xl:grid-cols-3 @5xl:grid-cols-4 @7xl:grid-cols-5 @8xl:grid-cols-6';
const folderGrid = 'grid grid-cols-1 gap-3 @lg:grid-cols-2 @3xl:grid-cols-3 @6xl:grid-cols-4';

/** Les récents tiennent sur une seule rangée : la Nᵉ carte n'apparaît que quand la grille a au moins N colonnes */
const recentSlot = ['', '', 'hidden @2xl:block', 'hidden @5xl:block', 'hidden @7xl:block', 'hidden @8xl:block'];

function NewNotebookDialog({ onCreate, onClose }: { onCreate(title: string, paper: PaperStyle, subject: string): void; onClose(): void }) {
  const [title, setTitle] = useState('');
  const [paper, setPaper] = useState<PaperStyle>('grid');
  const [subject, setSubject] = useState('');
  const submit = () => onCreate(title, paper, subject);
  return (
    <Modal
      title="Nouveau cahier"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Annuler</button>
          <button className="primary" onClick={submit}>
            Créer
          </button>
        </>
      }
    >
      <form onSubmit={(e) => (e.preventDefault(), submit())}>
        <label className="field">
          <span>Titre</span>
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="ex. Analyse 2 — Cours" />
        </label>
        <label className="field">
          <span>Papier</span>
          <select value={paper} onChange={(e) => setPaper(e.target.value as PaperStyle)}>
            {PAPERS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Matière / contexte (aide Gemini)</span>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="ex. Analyse 2 : séries entières" />
        </label>
      </form>
    </Modal>
  );
}

/** Un bloc de la page : un petit titre en capitales, puis son contenu (il apparaît en douceur) */
function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="mt-8 animate-rise first:mt-0 motion-reduce:animate-none">
      {title && <h2 className="m-0 mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{title}</h2>}
      {children}
    </section>
  );
}

/** Une page vide : un pictogramme, une phrase, et de quoi s'y mettre */
function Empty({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="mx-auto mt-10 flex max-w-md animate-rise flex-col items-center gap-3 rounded-3xl border border-dashed border-zinc-300 px-8 py-12 text-center motion-reduce:animate-none dark:border-zinc-700">
      <span className="grid size-14 place-items-center rounded-2xl border border-black/10 bg-black/[0.03] text-zinc-500 dark:border-white/10 dark:bg-white/5 dark:text-zinc-400">
        <Icon name={icon} className="size-7" />
      </span>
      <p className="m-0 text-base font-medium text-zinc-800 dark:text-zinc-100">{title}</p>
      {children}
    </div>
  );
}

const dangerButton =
  'inline-flex min-h-11 items-center justify-center rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-0 text-sm font-medium text-red-600 transition-all duration-200 hover:bg-red-500/20 active:scale-[0.97] dark:text-red-400';

const crumb =
  'min-h-0 rounded-md border-0 bg-transparent px-1.5 py-0.5 font-medium transition-colors duration-150 hover:bg-black/5 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-white';

// Tableaux vides stables : `?? []` en créerait un nouveau à chaque rendu et les useMemo ci-dessous ne serviraient à rien
const NO_FOLDERS: Folder[] = [];
const NO_NOTEBOOKS: Notebook[] = [];
const NO_TODOS: Todo[] = [];

export function Library({ route, onOpenSettings }: { route: Extract<Route, { name: 'library' | 'trash' }>; onOpenSettings(): void }) {
  const folders = useQuery(() => db.folders(), [], ['folders']) ?? NO_FOLDERS;
  const notebooks = useQuery(() => db.notebooks(), [], ['notebooks']) ?? NO_NOTEBOOKS;
  const [query, setQuery] = useState('');
  const results = useQuery(() => search(query), [query], ['folders', 'notebooks', 'transcripts']);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Le tiroir de navigation (petits écrans) */
  const [menuOpen, setMenuOpen] = useState(false);
  const [todosOpen, setTodosOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLElement>(null);

  const todos = useQuery(() => db.todos(), [], ['todos']) ?? NO_TODOS;
  const todosDue = todos.filter((t) => !t.deletedAt && !t.done && t.dueAt != null && t.dueAt < Date.now() + 24 * 60 * 60 * 1000).length;

  const inTrash = route.name === 'trash';
  const folderId = route.name === 'library' ? route.folderId : null;
  const searching = query.trim() !== '';
  const aliveFolders = folders.filter((f) => !f.deletedAt);
  const aliveNotebooks = notebooks.filter((n) => !n.deletedAt);
  const byId = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  const current = folderId ? byId.get(folderId) : undefined;
  const path = folderPath(byId, current);
  const tree = useMemo(() => buildFolderTree(folders), [folders]);
  const counts = useMemo(() => countChildren(folders, notebooks), [folders, notebooks]);
  const trashCount = folders.filter((f) => f.deletedAt).length + notebooks.filter((n) => n.deletedAt).length;

  // Changer de dossier repart du haut de la page
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [folderId, inTrash]);

  const run = async (label: string, task: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const closeMenu = useCallback(() => setMenuOpen(false), []);
  /** Va quelque part : la recherche se vide et le tiroir se referme */
  const navigate = (target: Route) => {
    setQuery('');
    setMenuOpen(false);
    go(target);
  };

  const openNotebook = (n: Notebook, pageIndex = 0) => {
    void updateNotebook(n.id, { openedAt: Date.now() });
    go({ name: 'notebook', notebookId: n.id, pageIndex });
  };

  const folderMenu = (f: Folder): MenuItem[] => [
    { label: 'Renommer', onClick: () => setDialog({ kind: 'rename-folder', folder: f }) },
    { label: 'Déplacer…', onClick: () => setDialog({ kind: 'move-folder', folder: f }) },
    { label: 'Mettre à la corbeille', danger: true, onClick: () => void trashFolder(f.id) },
  ];
  const notebookMenu = (n: Notebook): MenuItem[] => [
    { label: 'Renommer', onClick: () => setDialog({ kind: 'rename-notebook', notebook: n }) },
    { label: 'Matière / contexte…', onClick: () => setDialog({ kind: 'subject', notebook: n }) },
    { label: 'Déplacer…', onClick: () => setDialog({ kind: 'move-notebook', notebook: n }) },
    { label: 'Mettre à la corbeille', danger: true, onClick: () => void trashNotebook(n.id) },
  ];

  const notebookCard = (n: Notebook, pageIndex?: number, badge?: string, className?: string) => (
    <NotebookCard
      key={`${n.id}-${pageIndex ?? ''}`}
      className={className}
      notebook={n}
      onOpen={() => openNotebook(n, pageIndex)}
      onFavorite={() => void updateNotebook(n.id, { favorite: !n.favorite })}
      menu={notebookMenu(n)}
      onColor={(color) => void updateNotebook(n.id, { color })}
      badge={badge}
    />
  );
  const folderCard = (f: Folder) => (
    <FolderCard
      key={f.id}
      folder={f}
      count={countLabel(counts.get(f.id))}
      onOpen={() => navigate({ name: 'library', folderId: f.id })}
      menu={folderMenu(f)}
      onColor={(color) => void updateFolder(f.id, { color })}
    />
  );

  // ------------------------------------------------------------------ contenu
  const childFolders = aliveFolders.filter((f) => f.parentId === folderId).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const childNotebooks = aliveNotebooks.filter((n) => n.folderId === folderId).sort((a, b) => b.updatedAt - a.updatedAt);
  const recents = folderId ? [] : [...aliveNotebooks].sort((a, b) => b.openedAt - a.openedAt).slice(0, 6);
  const favorites = folderId ? [] : aliveNotebooks.filter((n) => n.favorite);
  const missingFolder = !!folderId && (!current || !!current.deletedAt);

  let content: ReactNode;
  if (searching) {
    content = !results ? (
      <p className="m-0 text-sm text-zinc-500 dark:text-zinc-400">Recherche…</p>
    ) : results.folders.length + results.notebooks.length + results.pages.length === 0 ? (
      <Empty icon="search" title={`Aucun résultat pour « ${query.trim()} ».`}>
        <p className="m-0 text-sm text-zinc-500 dark:text-zinc-400">Essaie un autre mot, ou le nom d’un cahier.</p>
      </Empty>
    ) : (
      <>
        {results.folders.length > 0 && (
          <Section title="Dossiers">
            <div className={folderGrid}>{results.folders.map(folderCard)}</div>
          </Section>
        )}
        {results.notebooks.length > 0 && (
          <Section title="Cahiers">
            <div className={notebookGrid}>{results.notebooks.map((n) => notebookCard(n))}</div>
          </Section>
        )}
        {results.pages.length > 0 && (
          <Section title="Dans les transcriptions">
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {results.pages.map((r) => (
                <li key={`${r.notebook.id}-${r.pageIndex}`}>
                  <button
                    type="button"
                    onClick={() => openNotebook(r.notebook, r.pageIndex)}
                    className={`${glassPanel} flex w-full flex-col items-start gap-1 px-4 py-3 text-left transition-all duration-200 hover:border-zinc-400 dark:hover:border-zinc-500`}
                  >
                    <strong className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                      {r.notebook.title} · page {r.pageIndex + 1}
                    </strong>
                    <span className="line-clamp-2 text-[13px] text-zinc-500 dark:text-zinc-400">{r.snippet}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </>
    );
  } else if (inTrash) {
    const deletedFolders = folders.filter((f) => f.deletedAt && !(f.parentId && byId.get(f.parentId)?.deletedAt === f.deletedAt));
    const deletedNotebooks = notebooks.filter((n) => n.deletedAt && !(n.folderId && byId.get(n.folderId)?.deletedAt === n.deletedAt));
    const row = (key: string, color: string, icon: IconName, name: string, restore: () => void, purge: () => void) => (
      <li key={key} className={`${glassPanel} flex flex-wrap items-center gap-3 px-4 py-3`}>
        <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />
        <Icon name={icon} className="size-5 shrink-0 text-zinc-400" />
        <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-zinc-900 dark:text-zinc-50">{name}</span>
        <button type="button" className={glassButton} onClick={restore}>
          Restaurer
        </button>
        <button type="button" className={dangerButton} onClick={purge}>
          Supprimer définitivement
        </button>
      </li>
    );
    content =
      deletedFolders.length + deletedNotebooks.length === 0 ? (
        <Empty icon="trash" title="La corbeille est vide.">
          <p className="m-0 text-sm text-zinc-500 dark:text-zinc-400">Ce que tu supprimes arrive ici, et peut être restauré.</p>
        </Empty>
      ) : (
        <ul className="m-0 flex list-none animate-rise flex-col gap-2 p-0 motion-reduce:animate-none">
          {deletedFolders.map((f) =>
            row(
              f.id,
              f.color,
              'folder',
              f.name,
              () => void restoreFolder(f.id),
              () => setDialog({ kind: 'purge', label: `le dossier « ${f.name} » et son contenu`, run: () => purgeFolder(f.id) }),
            ),
          )}
          {deletedNotebooks.map((n) =>
            row(
              n.id,
              n.color,
              'book',
              n.title,
              () => void restoreNotebook(n.id),
              () => setDialog({ kind: 'purge', label: `le cahier « ${n.title} »`, run: () => purgeNotebook(n.id) }),
            ),
          )}
        </ul>
      );
  } else if (missingFolder) {
    content = (
      <Empty icon="folder" title="Ce dossier n’existe plus.">
        <button type="button" className={glassButton} onClick={() => navigate({ name: 'library', folderId: null })}>
          Retour à la bibliothèque
        </button>
      </Empty>
    );
  } else if (aliveFolders.length + aliveNotebooks.length === 0) {
    content = (
      <Empty icon="book" title="Ta bibliothèque est vide.">
        <p className="m-0 text-sm text-zinc-500 dark:text-zinc-400">Commence par un dossier (ex. « Semestre 1 ») ou par un cahier.</p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <button type="button" className={glassButton} onClick={() => setDialog({ kind: 'new-folder' })}>
            <Icon name="folderPlus" className="size-[18px]" /> Nouveau dossier
          </button>
          <button type="button" className={glassButtonAccent} onClick={() => setDialog({ kind: 'new-notebook' })}>
            <Icon name="plus" className="size-[18px]" /> Nouveau cahier
          </button>
        </div>
      </Empty>
    );
  } else {
    content = (
      <>
        {recents.length > 0 && (
          <Section>
            <div className={notebookGrid}>{recents.map((n, i) => notebookCard(n, undefined, undefined, recentSlot[i]))}</div>
          </Section>
        )}
        {favorites.length > 0 && (
          <Section title="Favoris">
            <div className={notebookGrid}>{favorites.map((n) => notebookCard(n))}</div>
          </Section>
        )}
        {childFolders.length > 0 && (
          <Section title="Dossiers">
            <div className={folderGrid}>{childFolders.map(folderCard)}</div>
          </Section>
        )}
        <Section title={folderId ? 'Cahiers' : 'Tous les cahiers'}>
          <div className={notebookGrid}>
            {childNotebooks.map((n) => notebookCard(n))}
            <NewNotebookCard onClick={() => setDialog({ kind: 'new-notebook' })} />
          </div>
        </Section>
      </>
    );
  }

  const title = viewTitle({ query, trash: inTrash, folder: missingFolder ? undefined : current, hasRecents: recents.length > 0 });
  const trail = inTrash || searching ? [] : path.slice(0, -1);
  const showTrail = inTrash || searching || path.length > 0;

  return (
    <div className="library relative flex h-[calc(100dvh_-_var(--tabbar-h,0px))] overflow-hidden bg-zinc-50 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
      {menuOpen && (
        <button
          type="button"
          aria-label="Fermer le menu"
          onClick={closeMenu}
          className="absolute inset-0 z-30 min-h-0 animate-fade rounded-none border-0 bg-black/50 p-0 backdrop-blur-sm lg:hidden"
        />
      )}
      <LibrarySidebar
        open={menuOpen}
        onClose={closeMenu}
        query={query}
        onQuery={setQuery}
        tree={tree}
        currentFolderId={inTrash ? null : folderId}
        openIds={path.map((f) => f.id)}
        atHome={!inTrash && !searching && !folderId}
        inTrash={inTrash}
        trashCount={trashCount}
        onHome={() => navigate({ name: 'library', folderId: null })}
        onFolder={(id) => navigate({ name: 'library', folderId: id })}
        onTrash={() => navigate({ name: 'trash' })}
        onNewFolder={() => (setMenuOpen(false), setDialog({ kind: 'new-folder' }))}
        onHandwriting={() => go({ name: 'handwriting' })}
        onSettings={() => (setMenuOpen(false), onOpenSettings())}
      />

      <main
        ref={scrollRef}
        className="@container relative min-w-0 flex-1 overflow-y-auto overscroll-contain bg-[radial-gradient(60rem_26rem_at_12%_-6rem,rgba(99,102,241,0.08),transparent_70%),radial-gradient(38rem_22rem_at_100%_0%,rgba(14,165,233,0.06),transparent_70%)] dark:bg-[radial-gradient(60rem_26rem_at_12%_-6rem,rgba(99,102,241,0.16),transparent_70%),radial-gradient(38rem_22rem_at_100%_0%,rgba(56,189,248,0.09),transparent_70%)]"
      >
        <header className="sticky top-0 z-20 border-b border-black/5 bg-zinc-50/75 px-4 py-4 backdrop-blur-xl @2xl:px-8 dark:border-white/5 dark:bg-zinc-900/70">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <div className="flex min-w-0 items-center gap-3">
              <button type="button" onClick={() => setMenuOpen(true)} aria-label="Ouvrir le menu" className={`${glassIconButton} lg:hidden`}>
                <Icon name="menu" />
              </button>
              <div className="min-w-0">
                {showTrail && (
                  <nav aria-label="Chemin" className="mb-0.5 flex min-w-0 flex-wrap items-center gap-0.5 text-[13px] text-zinc-500 dark:text-zinc-400">
                    <button type="button" onClick={() => navigate({ name: 'library', folderId: null })} className={crumb}>
                      Bibliothèque
                    </button>
                    {trail.map((f) => (
                      <span key={f.id} className="inline-flex items-center gap-0.5">
                        <Icon name="chevron" className="size-3.5 opacity-60" />
                        <button type="button" onClick={() => navigate({ name: 'library', folderId: f.id })} className={crumb}>
                          {f.name}
                        </button>
                      </span>
                    ))}
                  </nav>
                )}
                <h1 className="m-0 truncate text-2xl font-semibold tracking-tight text-zinc-900 @lg:text-3xl dark:text-zinc-50">{title}</h1>
                {searching && <p className="m-0 mt-0.5 truncate text-sm text-zinc-500 dark:text-zinc-400">pour « {query.trim()} »</p>}
                {inTrash && !searching && <p className="m-0 mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">Restaure un élément, ou supprime-le pour de bon.</p>}
              </div>
            </div>
            {!inTrash && (
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  className={`${glassButton} relative`}
                  onClick={() => setTodosOpen(true)}
                  aria-label="À faire"
                  title="À faire"
                >
                  <Icon name="checklist" className="size-[18px]" />
                  <span className="hidden @xl:inline">À faire</span>
                  {todosDue > 0 && <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-red-500" aria-hidden="true" />}
                </button>
                <button type="button" className={glassButtonAccent} onClick={() => setDialog({ kind: 'new-notebook' })} aria-label="Nouveau cahier" title="Nouveau cahier">
                  <Icon name="plus" className="size-[18px]" />
                  <span className="hidden @xl:inline">Cahier</span>
                </button>
                <button type="button" className={glassButton} onClick={() => setDialog({ kind: 'new-folder' })} aria-label="Nouveau dossier" title="Nouveau dossier">
                  <Icon name="folderPlus" className="size-[18px]" />
                  <span className="hidden @xl:inline">Dossier</span>
                </button>
                <button type="button" className={glassButton} onClick={() => fileRef.current?.click()} aria-label="Importer un PDF" title="Importer un PDF">
                  <Icon name="fileUp" className="size-[18px]" />
                  <span className="hidden @xl:inline">Importer un PDF</span>
                </button>
              </div>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file)
                void run('Import du PDF…', async () => {
                  const notebook = await importPdfNotebook(file, folderId);
                  openNotebook(notebook);
                });
            }}
          />
        </header>

        <div className="px-4 pb-20 pt-6 @2xl:px-8">
          {busy && (
            <p role="status" className="m-0 mb-5 flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
              <span className="spinner" /> {busy}
            </p>
          )}
          {error && (
            <p role="alert" className="m-0 mb-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              {error}
            </p>
          )}
          {content}
        </div>
      </main>

      {todosOpen && <TodoPanel onClose={() => setTodosOpen(false)} />}

      {dialog?.kind === 'new-folder' && (
        <PromptDialog
          title={current ? `Nouveau dossier dans « ${current.name} »` : 'Nouveau dossier'}
          label="Nom"
          placeholder="ex. Semestre 1, Analyse, Électronique…"
          confirmLabel="Créer"
          onClose={() => setDialog(null)}
          onConfirm={(name) => {
            setDialog(null);
            void createFolder(name, folderId);
          }}
        />
      )}
      {dialog?.kind === 'new-notebook' && (
        <NewNotebookDialog
          onClose={() => setDialog(null)}
          onCreate={(title, paper, subject) => {
            setDialog(null);
            void run('Création…', async () => openNotebook(await createNotebook({ title, folderId, paper, subject })));
          }}
        />
      )}
      {dialog?.kind === 'rename-folder' && (
        <PromptDialog
          title="Renommer le dossier"
          label="Nom"
          initial={dialog.folder.name}
          onClose={() => setDialog(null)}
          onConfirm={(name) => {
            setDialog(null);
            if (name.trim()) void updateFolder(dialog.folder.id, { name: name.trim() });
          }}
        />
      )}
      {dialog?.kind === 'rename-notebook' && (
        <PromptDialog
          title="Renommer le cahier"
          label="Titre"
          initial={dialog.notebook.title}
          onClose={() => setDialog(null)}
          onConfirm={(title) => {
            setDialog(null);
            if (title.trim()) void updateNotebook(dialog.notebook.id, { title: title.trim() });
          }}
        />
      )}
      {dialog?.kind === 'subject' && (
        <PromptDialog
          title="Matière / contexte"
          label="Transmis à Gemini pour mieux lire ton écriture"
          initial={dialog.notebook.subject}
          placeholder="ex. Électronique : filtres du premier ordre"
          onClose={() => setDialog(null)}
          onConfirm={(subject) => {
            setDialog(null);
            void updateNotebook(dialog.notebook.id, { subject: subject.trim() });
          }}
        />
      )}
      {dialog?.kind === 'move-folder' && (
        <FolderPicker
          title={`Déplacer « ${dialog.folder.name} » vers…`}
          folders={folders}
          exclude={dialog.folder.id}
          current={dialog.folder.parentId}
          onClose={() => setDialog(null)}
          onPick={(parentId) => {
            setDialog(null);
            void run('Déplacement…', () => updateFolder(dialog.folder.id, { parentId }));
          }}
        />
      )}
      {dialog?.kind === 'move-notebook' && (
        <FolderPicker
          title={`Déplacer « ${dialog.notebook.title} » vers…`}
          folders={folders}
          current={dialog.notebook.folderId}
          onClose={() => setDialog(null)}
          onPick={(target) => {
            setDialog(null);
            void updateNotebook(dialog.notebook.id, { folderId: target });
          }}
        />
      )}
      {dialog?.kind === 'purge' && (
        <ConfirmDialog
          title="Supprimer définitivement ?"
          message={`Supprimer ${dialog.label} ? Cette action est irréversible, y compris sur Google Drive.`}
          confirmLabel="Supprimer définitivement"
          danger
          onClose={() => setDialog(null)}
          onConfirm={() => {
            const task = dialog.run;
            setDialog(null);
            void run('Suppression…', task);
          }}
        />
      )}
    </div>
  );
}
