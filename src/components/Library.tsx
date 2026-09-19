import { useMemo, useRef, useState } from 'react';
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
import type { Folder, Notebook } from '../db/schema';
import type { PaperStyle } from '../ink/types';
import { go } from '../router';
import type { Route } from '../router';
import { FolderCard, NotebookCard } from './LibraryCards';
import type { MenuItem } from './LibraryCards';
import { ConfirmDialog, FolderPicker, Modal, PromptDialog } from './Modal';
import { SyncChip } from './SyncChip';

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

export function Library({ route, onOpenSettings }: { route: Extract<Route, { name: 'library' | 'trash' }>; onOpenSettings(): void }) {
  const folders = useQuery(() => db.folders(), [], ['folders']) ?? [];
  const notebooks = useQuery(() => db.notebooks(), [], ['notebooks']) ?? [];
  const [query, setQuery] = useState('');
  const results = useQuery(() => search(query), [query], ['folders', 'notebooks', 'transcripts']);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const inTrash = route.name === 'trash';
  const folderId = route.name === 'library' ? route.folderId : null;
  const aliveFolders = folders.filter((f) => !f.deletedAt);
  const aliveNotebooks = notebooks.filter((n) => !n.deletedAt);
  const byId = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  const current = folderId ? byId.get(folderId) : undefined;

  const path: Folder[] = [];
  for (let f = current; f && path.length < 50; f = f.parentId ? byId.get(f.parentId) : undefined) path.unshift(f);

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

  const notebookCard = (n: Notebook, pageIndex?: number, badge?: string) => (
    <NotebookCard
      key={`${n.id}-${pageIndex ?? ''}`}
      notebook={n}
      onOpen={() => openNotebook(n, pageIndex)}
      onFavorite={() => void updateNotebook(n.id, { favorite: !n.favorite })}
      menu={notebookMenu(n)}
      onColor={(color) => void updateNotebook(n.id, { color })}
      badge={badge ? <span className="snippet"> · {badge}</span> : undefined}
    />
  );
  const folderCard = (f: Folder) => {
    const subFolders = aliveFolders.filter((x) => x.parentId === f.id).length;
    const subNotebooks = aliveNotebooks.filter((x) => x.folderId === f.id).length;
    const count = [subFolders && `${subFolders} dossier${subFolders > 1 ? 's' : ''}`, `${subNotebooks} cahier${subNotebooks > 1 ? 's' : ''}`]
      .filter(Boolean)
      .join(' · ');
    return (
      <FolderCard
        key={f.id}
        folder={f}
        count={count}
        onOpen={() => (setQuery(''), go({ name: 'library', folderId: f.id }))}
        menu={folderMenu(f)}
        onColor={(color) => void updateFolder(f.id, { color })}
      />
    );
  };

  // ------------------------------------------------------------------ contenu
  let content;
  if (query.trim()) {
    content = !results ? (
      <p className="empty">Recherche…</p>
    ) : results.folders.length + results.notebooks.length + results.pages.length === 0 ? (
      <p className="empty">Aucun résultat pour « {query} ».</p>
    ) : (
      <>
        {results.folders.length > 0 && (
          <section>
            <h2>Dossiers</h2>
            <div className="lib-grid">{results.folders.map(folderCard)}</div>
          </section>
        )}
        {results.notebooks.length > 0 && (
          <section>
            <h2>Cahiers</h2>
            <div className="lib-grid">{results.notebooks.map((n) => notebookCard(n))}</div>
          </section>
        )}
        {results.pages.length > 0 && (
          <section>
            <h2>Dans les transcriptions</h2>
            <ul className="search-pages">
              {results.pages.map((r) => (
                <li key={`${r.notebook.id}-${r.pageIndex}`}>
                  <button onClick={() => openNotebook(r.notebook, r.pageIndex)}>
                    <strong>
                      {r.notebook.title} · page {r.pageIndex + 1}
                    </strong>
                    <span>{r.snippet}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </>
    );
  } else if (inTrash) {
    const deletedFolders = folders.filter((f) => f.deletedAt && !(f.parentId && byId.get(f.parentId)?.deletedAt === f.deletedAt));
    const deletedNotebooks = notebooks.filter((n) => n.deletedAt && !(n.folderId && byId.get(n.folderId)?.deletedAt === n.deletedAt));
    content =
      deletedFolders.length + deletedNotebooks.length === 0 ? (
        <p className="empty">La corbeille est vide.</p>
      ) : (
        <ul className="trash-list">
          {deletedFolders.map((f) => (
            <li key={f.id}>
              <span className="dot" style={{ background: f.color }} /> 📁 {f.name}
              <span className="spacer" />
              <button onClick={() => void restoreFolder(f.id)}>Restaurer</button>
              <button className="danger" onClick={() => setDialog({ kind: 'purge', label: `le dossier « ${f.name} » et son contenu`, run: () => purgeFolder(f.id) })}>
                Supprimer définitivement
              </button>
            </li>
          ))}
          {deletedNotebooks.map((n) => (
            <li key={n.id}>
              <span className="dot" style={{ background: n.color }} /> 📓 {n.title}
              <span className="spacer" />
              <button onClick={() => void restoreNotebook(n.id)}>Restaurer</button>
              <button className="danger" onClick={() => setDialog({ kind: 'purge', label: `le cahier « ${n.title} »`, run: () => purgeNotebook(n.id) })}>
                Supprimer définitivement
              </button>
            </li>
          ))}
        </ul>
      );
  } else if (folderId && (!current || current.deletedAt)) {
    content = (
      <p className="empty">
        Ce dossier n’existe plus. <button onClick={() => go({ name: 'library', folderId: null })}>Retour à la bibliothèque</button>
      </p>
    );
  } else {
    const childFolders = aliveFolders.filter((f) => f.parentId === folderId).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    const childNotebooks = aliveNotebooks.filter((n) => n.folderId === folderId).sort((a, b) => b.updatedAt - a.updatedAt);
    const recents = folderId ? [] : [...aliveNotebooks].sort((a, b) => b.openedAt - a.openedAt).slice(0, 4);
    const favorites = folderId ? [] : aliveNotebooks.filter((n) => n.favorite);
    content = (
      <>
        {recents.length > 0 && (
          <section>
            <h2>Récents</h2>
            <div className="lib-grid">{recents.map((n) => notebookCard(n))}</div>
          </section>
        )}
        {favorites.length > 0 && (
          <section>
            <h2>Favoris</h2>
            <div className="lib-grid">{favorites.map((n) => notebookCard(n))}</div>
          </section>
        )}
        <section>
          <h2>{current ? current.name : 'Mes dossiers et cahiers'}</h2>
          {childFolders.length + childNotebooks.length === 0 ? (
            <p className="empty">
              {current ? 'Ce dossier est vide.' : 'Commence par créer un dossier (ex. « Semestre 1 ») ou un cahier.'}
            </p>
          ) : (
            <div className="lib-grid">
              {childFolders.map(folderCard)}
              {childNotebooks.map((n) => notebookCard(n))}
            </div>
          )}
        </section>
      </>
    );
  }

  const trashCount =
    folders.filter((f) => f.deletedAt).length + notebooks.filter((n) => n.deletedAt).length;

  return (
    <div className="library">
      <header className="lib-header">
        <button className="lib-brand" onClick={() => (setQuery(''), go({ name: 'library', folderId: null }))}>
          <img src="icon.svg" alt="" width={30} height={30} /> Notes Maths
        </button>
        <input
          className="lib-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher un cahier, une formule, un mot…"
        />
        <SyncChip />
        <button onClick={() => go({ name: 'handwriting' })}>✍ Mon écriture</button>
        <button className="icon-btn light" onClick={onOpenSettings} aria-label="Réglages">
          ⚙
        </button>
      </header>

      <nav className="lib-bar">
        <div className="breadcrumb">
          <button onClick={() => (setQuery(''), go({ name: 'library', folderId: null }))}>Bibliothèque</button>
          {inTrash && <span>› Corbeille</span>}
          {path.map((f) => (
            <span key={f.id}>
              ›{' '}
              <button onClick={() => (setQuery(''), go({ name: 'library', folderId: f.id }))}>{f.name}</button>
            </span>
          ))}
        </div>
        {!inTrash && (
          <div className="lib-actions">
            <button onClick={() => setDialog({ kind: 'new-folder' })}>+ Dossier</button>
            <button className="primary" onClick={() => setDialog({ kind: 'new-notebook' })}>
              + Cahier
            </button>
            <button onClick={() => fileRef.current?.click()}>Importer un PDF</button>
            <button onClick={() => go({ name: 'trash' })}>🗑 Corbeille{trashCount ? ` (${trashCount})` : ''}</button>
          </div>
        )}
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
      </nav>

      {busy && (
        <p className="lib-busy">
          <span className="spinner" /> {busy}
        </p>
      )}
      {error && <p className="lib-error">{error}</p>}
      <main className="lib-content">{content}</main>

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
