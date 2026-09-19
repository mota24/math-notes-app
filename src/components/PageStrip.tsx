import { useEffect, useRef, useState } from 'react';
import { db } from '../db/db';
import { hasBackground, pageBackground } from '../ink/background';
import { drawPaper, drawStroke } from '../ink/draw';
import { SHEET_H, isExtendable, sheetCount } from '../ink/pageExtent';
import { strokeBBox } from '../ink/geometry';
import type { PaperColor } from '../ink/types';
import { ConfirmDialog } from './Modal';

const THUMB_W = 96;

function Thumbnail({ pageId, version, defaultPaperColor }: { pageId: string; version: number; defaultPaperColor: PaperColor }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [sheets, setSheets] = useState(1);
  useEffect(() => {
    let alive = true;
    const idle = window.requestIdleCallback ?? ((fn: () => void) => window.setTimeout(fn, 50));
    idle(async () => {
      const page = await db.getPage(pageId);
      const canvas = ref.current;
      if (!alive || !page || !canvas) return;
      const scale = THUMB_W / page.width;
      const dpr = window.devicePixelRatio || 1;
      // Une page allongée (canevas infini) : la vignette montre sa première feuille, avec le nombre de feuilles
      const long = isExtendable(page);
      const shownH = long ? Math.min(page.height, SHEET_H) : page.height;
      setSheets(long ? sheetCount(page.height) : 1);
      canvas.width = Math.round(THUMB_W * dpr);
      canvas.height = Math.round(shownH * scale * dpr);
      canvas.style.height = `${shownH * scale}px`;
      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
      if (hasBackground(page)) {
        try {
          const bg = await pageBackground(page, scale * dpr * 1.5);
          if (!alive) return;
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, page.width, page.height);
          if (bg) ctx.drawImage(bg, 0, 0, page.width, page.height);
        } catch {
          drawPaper(ctx, 'blank', scale, page.width, page.height);
        }
      } else {
        drawPaper(ctx, page.paper, scale * 3, page.width, shownH, page.paperColor ?? defaultPaperColor);
      }
      for (const s of page.strokes) if (strokeBBox(s).minY <= shownH) drawStroke(ctx, s);
    });
    return () => {
      alive = false;
    };
  }, [pageId, version, defaultPaperColor]);
  return (
    <span className="thumb-wrap">
      <canvas ref={ref} className="thumb" style={{ width: THUMB_W }} />
      {sheets > 1 && <span className="thumb-sheets">{sheets} feuilles</span>}
    </span>
  );
}

/** Panneau latéral : toutes les pages du cahier. */
export function PageStrip({
  pageIds,
  current,
  version,
  defaultPaperColor,
  onOpen,
  onAdd,
  onMove,
  onDelete,
  onDeleteMany,
  onInsertPdf,
  onInsertPhoto,
  onClose,
}: {
  pageIds: string[];
  current: number;
  /** Change quand la page courante est modifiée : rafraîchit sa vignette */
  version: number;
  /** Couleur de papier du cahier, pour les pages qui n'ont pas encore la leur */
  defaultPaperColor: PaperColor;
  onOpen(index: number): void;
  onAdd(afterIndex: number): void;
  onMove(from: number, to: number): void;
  onDelete(index: number): void;
  onDeleteMany(pageIds: string[]): void;
  onInsertPdf(): void;
  onInsertPhoto(): void;
  onClose(): void;
}) {
  const currentRef = useRef<HTMLLIElement>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    // Accolades obligatoires : scrollIntoView renvoie une promesse dans les Chrome récents
    void currentRef.current?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  return (
    <aside className="page-strip">
      <header>
        <strong>{pageIds.length} pages</strong>
        {pageIds.length > 1 && (
          <button className="link" onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}>
            {selectMode ? 'Annuler' : 'Sélectionner'}
          </button>
        )}
        <button className="icon-btn" onClick={onClose} aria-label="Fermer la liste des pages">
          ✕
        </button>
      </header>
      <ol>
        {pageIds.map((id, i) => (
          <li key={id} ref={i === current ? currentRef : undefined} className={i === current ? 'current' : ''}>
            <button
              className={`thumb-btn ${selected.has(id) ? 'selected' : ''}`}
              onClick={() => (selectMode ? toggle(id) : onOpen(i))}
              aria-label={selectMode ? `Sélectionner la page ${i + 1}` : `Page ${i + 1}`}
            >
              {selectMode && (
                <span className={`thumb-check ${selected.has(id) ? 'checked' : ''}`} aria-hidden="true">
                  {selected.has(id) ? '✓' : ''}
                </span>
              )}
              <Thumbnail pageId={id} version={i === current ? version : 0} defaultPaperColor={defaultPaperColor} />
              <span>{i + 1}</span>
            </button>
            {!selectMode && i === current && (
              <div className="thumb-actions">
                <button onClick={() => onMove(i, i - 1)} disabled={i === 0} aria-label="Monter la page">
                  ↑
                </button>
                <button onClick={() => onMove(i, i + 1)} disabled={i === pageIds.length - 1} aria-label="Descendre la page">
                  ↓
                </button>
                <button className="danger" onClick={() => onDelete(i)} aria-label="Supprimer la page">
                  🗑
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>
      {selectMode ? (
        <div className="select-bar">
          <button
            className="link"
            onClick={() => setSelected(selected.size === pageIds.length ? new Set() : new Set(pageIds))}
          >
            {selected.size === pageIds.length ? 'Aucune' : 'Tout sélectionner'}
          </button>
          <button className="danger-solid" disabled={selected.size === 0} onClick={() => setConfirming(true)}>
            Supprimer {selected.size > 0 ? `(${selected.size})` : ''}
          </button>
        </div>
      ) : (
        <>
          <button className="add-page" onClick={() => onAdd(current)}>
            + Page après la {current + 1}
          </button>
          <button className="add-page" onClick={onInsertPhoto}>
            + Photo (tableau, livre) après la {current + 1}
          </button>
          <button className="add-page" onClick={onInsertPdf}>
            + Ajouter un PDF à la fin
          </button>
        </>
      )}
      {confirming && (
        <ConfirmDialog
          title={`Supprimer ${selected.size} page${selected.size > 1 ? 's' : ''} ?`}
          message="Leurs traits et transcriptions seront supprimés. Impossible à annuler."
          confirmLabel="Supprimer"
          danger
          onClose={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            onDeleteMany([...selected]);
            exitSelect();
          }}
        />
      )}
    </aside>
  );
}
