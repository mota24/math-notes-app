import { useEffect, useMemo, useRef } from 'react';
import { db, useQuery } from '../db/db';
import { BlocksView } from '../render/BlocksView';
import { go } from '../router';

/** Version imprimable des transcriptions : « Enregistrer en PDF » dans la fenêtre d'impression. */
export function PrintView({ notebookId, pageIndex }: { notebookId: string; pageIndex: number | null }) {
  const notebook = useQuery(() => db.getNotebook(notebookId), [notebookId], ['notebooks']);
  const transcripts = useQuery(() => db.transcriptsOf(notebookId), [notebookId], ['transcripts']);
  const printed = useRef(false);

  const pages = useMemo(() => {
    if (!notebook || !transcripts) return null;
    const byPage = new Map(transcripts.filter((t) => !t.deletedAt).map((t) => [t.pageId, t]));
    const ids = pageIndex === null ? notebook.pageIds : [notebook.pageIds[pageIndex]];
    return ids.flatMap((id, i) => {
      const t = byPage.get(id);
      return t ? [{ id, number: (pageIndex ?? i) + 1, blocks: t.blocks }] : [];
    });
  }, [notebook, transcripts, pageIndex]);

  useEffect(() => {
    if (!pages?.length || printed.current) return;
    printed.current = true;
    void document.fonts.ready.then(() => window.setTimeout(() => window.print(), 700));
  }, [pages]);

  const back = () => go({ name: 'notebook', notebookId, pageIndex: pageIndex ?? 0 });

  return (
    <div className="print-view">
      <header className="print-bar">
        <button onClick={back}>← Retour au cahier</button>
        <strong>{notebook?.title}</strong>
        <button className="primary" onClick={() => window.print()}>
          Imprimer / Enregistrer en PDF
        </button>
      </header>
      <article className="print-doc">
        <h1>{notebook?.title}</h1>
        {pages?.map((p) => (
          <section key={p.id} className="print-page">
            <h2 className="print-page-title">Page {p.number}</h2>
            <BlocksView blocks={p.blocks} />
          </section>
        ))}
        {pages?.length === 0 && <p>Aucune page convertie.</p>}
      </article>
    </div>
  );
}
