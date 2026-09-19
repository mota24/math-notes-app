import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Block } from '../ai/blocks';
import { db, useQuery } from '../db/db';
import type { Notebook, Page } from '../db/schema';
import { downloadBlob } from '../export/download';
import { HAND_FONTS, canvasesToPdf, handLayout, renderHandwriting } from '../export/handwriting';
import type { HandSize, HandStyle } from '../export/handwriting';
import { exportInkPdf } from '../export/pdfOriginal';
import type { PaperStyle } from '../ink/types';
import { BlocksView } from '../render/BlocksView';
import { notebookLatex } from '../render/math';
import { isNativeApp } from '../platform';
import { go } from '../router';
import type { Settings } from '../settings';
import { Modal } from './Modal';

const INKS = [
  { value: '#1f3a8a', name: 'Bleu' },
  { value: '#1d2433', name: 'Noir' },
  { value: '#5b2a86', name: 'Violet' },
];

export function ExportDialog({
  notebook,
  pageIndex,
  settings,
  update,
  onClose,
}: {
  notebook: Notebook;
  pageIndex: number;
  settings: Settings;
  update(patch: Partial<Settings>): void;
  onClose(): void;
}) {
  const [scope, setScope] = useState<'page' | 'all'>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [handJob, setHandJob] = useState<{ number: number; blocks: Block[] }[] | null>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const transcripts = useQuery(() => db.transcriptsOf(notebook.id), [notebook.id], ['transcripts']) ?? [];
  const glyphs = useQuery(() => db.glyphs(), [], ['glyphs']) ?? [];

  const pageIds = scope === 'page' ? [notebook.pageIds[pageIndex]] : notebook.pageIds;
  const converted = useMemo(() => {
    const byPage = new Map(transcripts.filter((t) => !t.deletedAt).map((t) => [t.pageId, t]));
    return pageIds.flatMap((id, i) => {
      const t = byPage.get(id);
      return t ? [{ number: (scope === 'page' ? pageIndex : i) + 1, blocks: t.blocks }] : [];
    });
  }, [transcripts, pageIds, scope, pageIndex]);
  const baseName = scope === 'page' ? `${notebook.title} - page ${pageIndex + 1}` : notebook.title;

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

  const exportInk = () =>
    run('Création du PDF…', async () => {
      const pages: Page[] = [];
      for (const id of pageIds) {
        const page = await db.getPage(id);
        if (page) pages.push(page);
      }
      const blob = await exportInkPdf(pages, (done, total) => setBusy(`Création du PDF… ${done}/${total}`), {
        defaultPaperColor: notebook.paperColor ?? 'light',
        print: settings.printMode,
      });
      await downloadBlob(blob, `${baseName}.pdf`);
    });

  const exportTex = () =>
    run('Préparation du fichier…', async () => {
      const tex = notebookLatex(notebook.title, converted);
      await downloadBlob(new Blob([tex], { type: 'application/x-tex' }), `${baseName}.tex`);
    });

  useEffect(() => {
    if (!handJob || !layoutRef.current) return;
    let alive = true;
    const layout = layoutRef.current;
    void (async () => {
      try {
        const canvases = await renderHandwriting(
          layout,
          {
            style: settings.handStyle,
            ink: settings.handInk,
            paper: settings.handPaper,
            glyphs: new Map(glyphs.map((g) => [g.char, g])),
            variation: settings.handVariation,
          },
          (done, total) => alive && setBusy(`Écriture des pages… ${done}/${total}`),
        );
        if (!alive) return;
        setBusy('Assemblage du PDF…');
        await downloadBlob(await canvasesToPdf(canvases), `${baseName} (manuscrit).pdf`);
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) {
          setBusy(null);
          setHandJob(null);
        }
      }
    })();
    return () => {
      alive = false;
    };
    // Lancé une fois par demande d'export
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handJob]);

  const noTranscript = converted.length === 0;

  return (
    <Modal title="Exporter" onClose={onClose} wide>
      <div className="segmented" role="radiogroup" aria-label="Pages à exporter">
        <button className={scope === 'page' ? 'active' : ''} onClick={() => setScope('page')} aria-pressed={scope === 'page'}>
          Cette page ({pageIndex + 1})
        </button>
        <button className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')} aria-pressed={scope === 'all'}>
          Tout le cahier ({notebook.pageIds.length} page{notebook.pageIds.length > 1 ? 's' : ''})
        </button>
      </div>

      <div className="export-grid">
        <article className="export-card">
          <h3>PDF de mes notes</h3>
          <p>Ton écriture telle quelle, sur le papier ou le PDF d’origine, en vectoriel (nette à tous les zooms).</p>
          <label className="check">
            <input type="checkbox" checked={settings.printMode} onChange={(e) => update({ printMode: e.target.checked })} />
            Mode impression
          </label>
          <p className="export-hint">
            {settings.printMode
              ? 'Fond blanc à réglures pâles ; le blanc et les couleurs claires passent en noir ou en teinte foncée. Les surligneurs gardent leur couleur.'
              : notebook.paperColor === 'dark'
                ? 'Sans ce mode, le PDF garde le fond sombre de ton cahier : lisible, mais gourmand en encre si tu l’imprimes.'
                : 'Pour imprimer : fond blanc, encre claire convertie en foncé.'}
          </p>
          <button className="primary" onClick={() => void exportInk()} disabled={!!busy}>
            Télécharger le PDF
          </button>
        </article>

        <article className="export-card">
          <h3>PDF propre (LaTeX)</h3>
          <p>
            Les transcriptions mises en forme : {converted.length} page{converted.length > 1 ? 's' : ''} convertie
            {converted.length > 1 ? 's' : ''} sur {pageIds.length}.
          </p>
          <button
            className="primary"
            disabled={noTranscript || !!busy || isNativeApp()}
            onClick={() => {
              onClose();
              go({ name: 'print', notebookId: notebook.id, pageIndex: scope === 'page' ? pageIndex : null });
            }}
          >
            Ouvrir et enregistrer en PDF
          </button>
          {isNativeApp() && (
            <p className="export-hint">
              Indisponible dans l’application Android (pas de fenêtre d’impression) : prends le fichier .tex, ou le PDF de tes notes en Mode
              impression.
            </p>
          )}
          <button disabled={noTranscript} onClick={exportTex}>
            Fichier .tex (Overleaf)
          </button>
        </article>

        <article className="export-card">
          <h3>PDF manuscrit lisible</h3>
          <p>Tes transcriptions réécrites à la main, alignées sur les lignes.</p>
          <label className="field">
            <span>Écriture</span>
            <select value={settings.handStyle} onChange={(e) => update({ handStyle: e.target.value as HandStyle })}>
              <option value="mine">Mon écriture ({glyphs.length} caractères enregistrés)</option>
              <option value="caveat">Caveat (cursive)</option>
              <option value="kalam">Kalam (script)</option>
              <option value="patrick">Patrick Hand (soignée)</option>
            </select>
          </label>
          <div className="row">
            <label className="field grow">
              <span>Taille</span>
              <select value={settings.handSize} onChange={(e) => update({ handSize: e.target.value as HandSize })}>
                <option value="small">Petite</option>
                <option value="medium">Moyenne</option>
                <option value="large">Grande</option>
              </select>
            </label>
            <label className="field grow">
              <span>Variations</span>
              <select value={settings.handVariation} onChange={(e) => update({ handVariation: Number(e.target.value) })}>
                <option value={0.5}>Légères (très soigné)</option>
                <option value={1}>Naturelles</option>
                <option value={1.6}>Marquées</option>
              </select>
            </label>
          </div>
          <label className="field">
            <span>Papier</span>
            <select value={settings.handPaper} onChange={(e) => update({ handPaper: e.target.value as PaperStyle })}>
              <option value="seyes">Seyès</option>
              <option value="grid">Petits carreaux</option>
              <option value="lined">Lignes</option>
              <option value="blank">Blanc</option>
            </select>
          </label>
          <div className="field">
            <span>Encre</span>
            <div className="row">
              {INKS.map((ink) => (
                <button
                  key={ink.value}
                  className={`swatch ${settings.handInk === ink.value ? 'active' : ''}`}
                  style={{ background: ink.value }}
                  aria-label={`Encre ${ink.name}`}
                  onClick={() => update({ handInk: ink.value })}
                />
              ))}
            </div>
          </div>
          {settings.handStyle === 'mine' && glyphs.length < 26 && (
            <p className="hint">
              Les caractères que tu n’as pas encore écrits utilisent Caveat.{' '}
              <button
                onClick={() => {
                  onClose();
                  go({ name: 'handwriting' });
                }}
              >
                Enregistrer mon écriture
              </button>
            </p>
          )}
          <button
            className="primary"
            disabled={noTranscript || !!busy}
            onClick={() => {
              setError(null);
              setBusy('Mise en page…');
              setHandJob(converted);
            }}
          >
            Créer le PDF manuscrit
          </button>
        </article>
      </div>

      {noTranscript && (
        <p className="hint">Les exports LaTeX et manuscrit utilisent les transcriptions : convertis d’abord la page ou le cahier.</p>
      )}
      {busy && (
        <p className="loading">
          <span className="spinner" /> {busy}
        </p>
      )}
      {error && <p className="lib-error">{error}</p>}

      {handJob &&
        createPortal(
          <div
            ref={layoutRef}
            className="hw-layout"
            aria-hidden="true"
            style={{
              width: handLayout(settings.handSize).width,
              fontSize: handLayout(settings.handSize).fontSize,
              lineHeight: `${handLayout(settings.handSize).lineHeight}px`,
              fontFamily: `"${HAND_FONTS[settings.handStyle]}", cursive`,
            }}
          >
            {handJob.map((p) => (
              <BlocksView key={p.number} blocks={p.blocks} />
            ))}
          </div>,
          document.body,
        )}
    </Modal>
  );
}
