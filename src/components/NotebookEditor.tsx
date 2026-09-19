import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Block } from '../ai/blocks';
import { DEMO_BLOCKS } from '../ai/demo';
import { ConversionError, FREE_MODELS, convertWithGemini } from '../ai/gemini';
import { db, onDbChange, useQuery } from '../db/db';
import { addPage, appendPdf, insertPhotoPage, movePage, removePage, removePages, touchNotebook, updateNotebook } from '../db/library';
import type { ConversionResult, Page, ResultSource } from '../db/schema';
import { hasBackground, pageBackground } from '../ink/background';
import { strokeBBox, unionBBox } from '../ink/geometry';
import { InkCanvas } from '../ink/InkCanvas';
import { liveStats } from '../ink/liveStats';
import { imageFileToEncoded, rasterizeForAi, rasterizeRegion } from '../ink/rasterize';
import type { EncodedImage } from '../ink/rasterize';
import { newId } from '../ink/types';
import type { BBox, InkPoint, PaperColor, PaperStyle, ShapeKind, Stroke, Tool } from '../ink/types';
import { renderBlocksImage } from '../export/insertImage';
import { go, replaceRoute } from '../router';
import type { Settings } from '../settings';
import { NotebookMenu } from './NotebookMenu';
import { ExportDialog } from './ExportDialog';
import { ConfirmDialog, PromptDialog } from './Modal';
import { PageStrip } from './PageStrip';
import { ResultsPanel } from './ResultsPanel';
import { SyncChip } from './SyncChip';
import { ICONS, Toolbar } from './Toolbar';
import { pushRecentColor } from '../colors';
import { fitHeight, isExtendable } from '../ink/pageExtent';

type Action =
  | { type: 'add'; strokes: Stroke[] }
  | { type: 'remove'; items: { stroke: Stroke; index: number }[] }
  /** Déplacement, changement de couleur : état complet avant / après */
  | { type: 'replace'; before: Stroke[]; after: Stroke[] };
type Job = { progress: string } | { error: { message: string; kind: string } };

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

/** Presse-papiers partagé entre les pages et les cahiers : des traits copiés, ou une capture rectangulaire. */
type Clipboard = { type: 'strokes'; strokes: Stroke[] } | { type: 'capture'; dataUrl: string; widthMm: number; heightMm: number };
let clipboard: Clipboard | null = null;

function splitStrokes(list: Stroke[], ids: Set<string>) {
  const items: { stroke: Stroke; index: number }[] = [];
  const kept: Stroke[] = [];
  list.forEach((stroke, index) => (ids.has(stroke.id) ? items.push({ stroke, index }) : kept.push(stroke)));
  return { items, kept };
}

function applyAction(list: Stroke[], a: Action): Stroke[] {
  if (a.type === 'add') return [...list, ...a.strokes];
  if (a.type === 'replace') return a.after;
  return splitStrokes(list, new Set(a.items.map((i) => i.stroke.id))).kept;
}

function invertAction(list: Stroke[], a: Action): Stroke[] {
  if (a.type === 'add') return splitStrokes(list, new Set(a.strokes.map((s) => s.id))).kept;
  if (a.type === 'replace') return a.before;
  const out = list.slice();
  for (const it of [...a.items].sort((x, y) => x.index - y.index)) out.splice(Math.min(it.index, out.length), 0, it.stroke);
  return out;
}

function shifted(strokes: Stroke[], dx: number, dy: number, freshIds: boolean): Stroke[] {
  return strokes.map((s) => ({
    ...s,
    id: freshIds ? newId() : s.id,
    points: s.points.map(([x, y, p]): [number, number, number] => [x + dx, y + dy, p]),
  }));
}

/**
 * Où poser une image sous la dernière encre : sur une page d'écriture le canevas s'allonge au besoin ;
 * sur un PDF ou une photo, elle reste dans le fond.
 */
function imageTop(p: Page, below: number, h: number): number {
  const y = Math.max(12, below + 10);
  return isExtendable(p) ? y : Math.min(y, Math.max(0, p.height - h - 10));
}

function imageFromDataUrl(dataUrl: string): EncodedImage {
  const mimeType = dataUrl.slice(5, dataUrl.indexOf(';'));
  return { dataUrl, base64: dataUrl.slice(dataUrl.indexOf(',') + 1), mimeType, width: 0, height: 0 };
}

interface Props {
  notebookId: string;
  pageIndex: number;
  settings: Settings;
  update(patch: Partial<Settings>): void;
  onOpenSettings(): void;
}

export function NotebookEditor({ notebookId, pageIndex, settings, update, onOpenSettings }: Props) {
  const demo = useMemo(() => new URLSearchParams(window.location.search).has('demo'), []);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const notebook = useQuery(() => db.getNotebook(notebookId), [notebookId], ['notebooks']);
  const notebookRef = useRef(notebook);
  notebookRef.current = notebook;
  const pageCount = notebook?.pageIds.length ?? 0;
  const index = Math.min(pageIndex, Math.max(0, pageCount - 1));
  const pageId = notebook?.pageIds[index];

  // ------------------------------------------------------------ page courante
  const [page, setPage] = useState<Page | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const pageRef = useRef<Page | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const history = useRef({ undo: [] as Action[], redo: [] as Action[] });
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const [version, setVersion] = useState(0);
  const saveTimer = useRef(0);

  const loadPage = useCallback((p: Page) => {
    pageRef.current = p;
    strokesRef.current = p.strokes;
    history.current = { undo: [], redo: [] };
    setPage(p);
    setStrokes(p.strokes);
  }, []);

  const flushSave = useCallback(() => {
    if (!saveTimer.current) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = 0;
    if (pageRef.current) void db.putPage(pageRef.current).then(() => setVersion((v) => v + 1));
  }, []);

  useEffect(() => {
    if (!pageId) return;
    let alive = true;
    setPage(null);
    void db.getPage(pageId).then((p) => alive && p && loadPage(p));
    // Une version plus récente arrive par la synchronisation : on recharge si rien n'est en attente
    const off = onDbChange((stores) => {
      if (!stores.includes('pages') || saveTimer.current) return;
      void db.getPage(pageId).then((p) => {
        if (alive && p && p.updatedAt > (pageRef.current?.updatedAt ?? 0)) loadPage(p);
      });
    });
    return () => {
      alive = false;
      off();
      flushSave();
    };
  }, [pageId, loadPage, flushSave]);

  useEffect(() => {
    // La tablette peut fermer l'onglet en arrière-plan : on enregistre tout de suite
    const onHide = () => document.visibilityState === 'hidden' && flushSave();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flushSave);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flushSave);
    };
  }, [flushSave]);

  const persist = useCallback(
    (patch: Partial<Page>) => {
      const current = pageRef.current;
      if (!current) return;
      pageRef.current = { ...current, ...patch, updatedAt: Date.now() };
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = 0;
        if (!pageRef.current) return;
        void db.putPage(pageRef.current).then(() => setVersion((v) => v + 1));
        void touchNotebook(notebookId);
      }, 600);
    },
    [notebookId],
  );

  const setPageStrokes = (next: Stroke[]) => {
    strokesRef.current = next;
    setStrokes(next);
    // Canevas infini : la page enregistrée fait juste les feuilles A4 qu'il faut pour son encre
    const current = pageRef.current;
    const height = current && isExtendable(current) ? fitHeight(next) : null;
    if (height !== null && current && height !== current.height) {
      setPage((prev) => (prev ? { ...prev, height } : prev));
      persist({ strokes: next, height });
    } else {
      persist({ strokes: next });
    }
  };

  // ------------------------------------------------------------ historique et sélection
  const [tool, setTool] = useState<Tool>('pen');
  const [shapeKind, setShapeKind] = useState<ShapeKind>('circle');
  const [selection, setSelection] = useState<string[]>([]);
  /** Zone du lasso, gardée seulement sur une page avec PDF ou photo (convertir le texte imprimé) */
  const [selectionRegion, setSelectionRegion] = useState<BBox | null>(null);
  const select = (ids: string[], region: BBox | null = null) => {
    setSelection(ids);
    setSelectionRegion(region);
  };
  /** Zone du Lasso de capture, encore ajustable par ses poignées tant qu'elle n'est pas copiée */
  const [captureRegion, setCaptureRegion] = useState<BBox | null>(null);
  const [canPaste, setCanPaste] = useState(clipboard !== null);
  const record = (a: Action) => {
    const h = history.current;
    h.undo.push(a);
    if (h.undo.length > 300) h.undo.shift();
    h.redo = [];
    rerender();
  };
  const addStrokes = (added: Stroke[]) => {
    setPageStrokes([...strokesRef.current, ...added]);
    record({ type: 'add', strokes: added });
  };
  /** Glisse un résultat converti sur la page, sous forme d'image nette (voir export/insertImage.ts). */
  const insertBlocksAsImage = async (blocks: Block[]) => {
    const p = pageRef.current;
    if (!p) return;
    const rendered = await renderBlocksImage(blocks, settingsRef.current.color);
    if (!rendered) {
      flash('Rien à poser sur la page : cette conversion est vide.');
      return;
    }
    // Une taille raisonnable à l'écran (~28 px/mm de « poids visuel » d'origine), sous la dernière encre
    const maxW = Math.min(rendered.widthMm, p.width - 30);
    const scale = maxW / rendered.widthMm;
    const w = rendered.widthMm * scale;
    const h = rendered.heightMm * scale;
    const below = unionBBox(strokesRef.current.map(strokeBBox))?.maxY ?? 12;
    const x = 15;
    const y = imageTop(p, below, h);
    addStrokes([
      {
        id: newId(),
        tool: 'image',
        image: rendered.dataUrl,
        points: [
          [x, y, 1],
          [x + w, y + h, 1],
        ],
        color: settingsRef.current.color,
        size: 0,
        input: 'mouse',
      },
    ]);
    flash('Posée sur la page : glisse-la (lasso) pour la placer où tu veux.');
  };
  /** Lasso de capture : rasterise exactement la zone encadrée (fond + traits) et la garde en mémoire. */
  const copyCapture = async () => {
    const p = pageRef.current;
    if (!p || !captureRegion) return;
    const withBg = hasBackground(p);
    const bg = withBg ? await pageBackground(p, 8) : null;
    const img = rasterizeRegion({ strokes: strokesRef.current, page: p, background: bg, region: captureRegion });
    clipboard = {
      type: 'capture',
      dataUrl: img.dataUrl,
      widthMm: captureRegion.maxX - captureRegion.minX,
      heightMm: captureRegion.maxY - captureRegion.minY,
    };
    setCanPaste(true);
    setCaptureRegion(null);
    flash('Zone copiée : « Coller » dans la barre d’outils pour la poser sur une page.');
  };
  const removeStrokes = (ids: string[]) => {
    const { items, kept } = splitStrokes(strokesRef.current, new Set(ids));
    if (items.length === 0) return;
    setPageStrokes(kept);
    record({ type: 'remove', items });
    select([]);
  };
  /** Gomme de précision : chaque trait touché est remplacé par ses morceaux (à sa place dans l'ordre d'empilement). */
  const replaceStrokes = (replacements: Map<string, Stroke[]>) => {
    if (replacements.size === 0) return;
    const before = strokesRef.current;
    const after = before.flatMap((s) => replacements.get(s.id) ?? [s]);
    setPageStrokes(after);
    record({ type: 'replace', before, after });
    select([]);
  };
  /** Poignées d'une forme ou d'une image : ses nouveaux points (annulable comme un déplacement). */
  const resizeStroke = (id: string, points: InkPoint[]) => {
    const before = strokesRef.current;
    const after = before.map((s) => (s.id === id ? { ...s, points } : s));
    setPageStrokes(after);
    record({ type: 'replace', before, after });
  };
  /** Recolore la sélection : le surligneur et les images gardent leur couleur. */
  const recolorSelection = (color: string) =>
    replaceSelected((chosen) => chosen.map((s) => (s.tool === 'highlighter' || s.tool === 'image' ? s : { ...s, color })));
  const replaceSelected = (change: (selected: Stroke[]) => Stroke[]) => {
    const chosen = new Set(selection);
    const before = strokesRef.current;
    const changed = new Map(change(before.filter((s) => chosen.has(s.id))).map((s) => [s.id, s]));
    const after = before.map((s) => changed.get(s.id) ?? s);
    setPageStrokes(after);
    record({ type: 'replace', before, after });
  };
  const undo = () => {
    const a = history.current.undo.pop();
    if (!a) return;
    history.current.redo.push(a);
    setPageStrokes(invertAction(strokesRef.current, a));
    select([]);
    rerender();
  };
  const redo = () => {
    const a = history.current.redo.pop();
    if (!a) return;
    history.current.undo.push(a);
    setPageStrokes(applyAction(strokesRef.current, a));
    select([]);
    rerender();
  };
  const undoRef = useRef(undo);
  undoRef.current = undo;
  const redoRef = useRef(redo);
  redoRef.current = redo;

  const selectedStrokes = () => {
    const chosen = new Set(selection);
    return strokesRef.current.filter((s) => chosen.has(s.id));
  };
  const paste = () => {
    if (!clipboard) return;
    if (clipboard.type === 'strokes') {
      const copies = shifted(clipboard.strokes, 6, 6, true);
      addStrokes(copies);
      setTool('lasso');
      select(copies.map((s) => s.id));
      return;
    }
    const p = pageRef.current;
    if (!p) return;
    // Même logique de taille/placement que « Poser sur la page » (glisser-déposer LaTeX)
    const maxW = Math.min(clipboard.widthMm, p.width - 30);
    const scale = maxW / clipboard.widthMm;
    const w = clipboard.widthMm * scale;
    const h = clipboard.heightMm * scale;
    const below = unionBBox(strokesRef.current.map(strokeBBox))?.maxY ?? 12;
    const x = 15;
    const y = imageTop(p, below, h);
    const stroke: Stroke = {
      id: newId(),
      tool: 'image',
      image: clipboard.dataUrl,
      points: [
        [x, y, 1],
        [x + w, y + h, 1],
      ],
      color: settingsRef.current.color,
      size: 0,
      input: 'mouse',
    };
    addStrokes([stroke]);
    setTool('lasso');
    select([stroke.id]);
    flash('Capture posée sur la page : glisse-la (lasso) pour la placer où tu veux.');
  };

  // ------------------------------------------------------------ navigation
  const goToPage = useCallback(
    (i: number) => {
      flushSave();
      select([]);
      replaceRoute({ name: 'notebook', notebookId, pageIndex: i });
    },
    [flushSave, notebookId],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoRef.current();
      } else if ((e.ctrlKey || e.metaKey) && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redoRef.current();
      } else if (e.key === 'PageDown' && index < pageCount - 1) goToPage(index + 1);
      else if (e.key === 'PageUp' && index > 0) goToPage(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goToPage, index, pageCount]);

  // ------------------------------------------------------------ fond (PDF ou photo)
  const [notice, setNotice] = useState<string | null>(null);
  const flash = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice((m) => (m === message ? null : m)), 3500);
  }, []);
  const [background, setBackground] = useState<HTMLCanvasElement | null>(null);
  const [bgScale, setBgScale] = useState(0);
  const bgKey = page?.pdf ? `pdf:${page.pdf.fileId}:${page.pdf.pageIndex}` : page?.image ? `photo:${page.image.fileId}` : null;
  useEffect(() => {
    setBackground(null);
    setBgScale(0);
  }, [pageId]);
  const onScaleChange = useCallback((scale: number) => {
    if (!pageRef.current?.pdf) return;
    const wanted = Math.min(10, scale * (window.devicePixelRatio || 1));
    setBgScale((prev) => (prev && Math.abs(wanted - prev) / prev < 0.3 ? prev : wanted));
  }, []);
  useEffect(() => {
    const current = pageRef.current;
    if (!bgKey || !current) return;
    if (current.pdf && !bgScale) return; // le PDF attend de connaître le zoom
    let alive = true;
    pageBackground(current, bgScale || 4)
      .then((canvas) => alive && setBackground(canvas))
      .catch((e: Error) => alive && flash(e.message));
    return () => {
      alive = false;
    };
  }, [bgKey, bgScale, flash]);

  // ------------------------------------------------------------ Gemini
  const callGemini = async (image: EncodedImage, onStatus: (s: string) => void) => {
    if (demo) {
      await sleep(900);
      return { blocks: DEMO_BLOCKS, model: 'démo' };
    }
    const s = settingsRef.current;
    if (!s.apiKey) throw new ConversionError('key', 'Ajoute ta clé API Gemini gratuite dans les réglages.');
    return convertWithGemini({
      apiKey: s.apiKey,
      model: s.model || FREE_MODELS[0],
      autoFallback: s.autoFallback,
      base64: image.base64,
      mimeType: image.mimeType,
      subject: notebookRef.current?.subject || s.subject,
      onStatus,
    });
  };

  /** Image d'une page (ou d'une zone) pour Gemini, avec le PDF ou la photo de fond si activé. */
  const imageOfPage = async (p: Page, pageStrokes: Stroke[], region: ReturnType<typeof unionBBox> = null) => {
    const withBackground = settingsRef.current.convertBackground && hasBackground(p);
    const bg = withBackground ? await pageBackground(p, region ? 12 : 6) : null;
    return rasterizeForAi({ strokes: pageStrokes, page: p, background: bg, region });
  };

  // Transcriptions de pages
  const transcript = useQuery(() => (pageId ? db.getTranscript(pageId) : Promise.resolve(undefined)), [pageId], ['transcripts']);
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const setJob = (id: string, job: Job | null) =>
    setJobs((all) => {
      const next = { ...all };
      if (job) next[id] = job;
      else delete next[id];
      return next;
    });

  const convertPageById = async (id: string) => {
    const p = id === pageRef.current?.id ? { ...pageRef.current, strokes: strokesRef.current } : await db.getPage(id);
    if (!p) return;
    setJob(id, { progress: 'Préparation de la page…' });
    let image: EncodedImage | null;
    try {
      image = await imageOfPage(p, p.strokes);
    } catch (e) {
      setJob(id, { error: { message: (e as Error).message, kind: 'background' } });
      return;
    }
    if (!image) {
      setJob(id, { error: { message: 'Page vide : écris d’abord quelque chose.', kind: 'empty' } });
      return;
    }
    setJob(id, { progress: 'Gemini lit la page…' });
    try {
      const { blocks, model } = await callGemini(image, (progress) => setJob(id, { progress }));
      const t = Date.now();
      await db.putTranscript({ pageId: id, notebookId, blocks, model, strokeCount: p.strokes.length, edited: false, createdAt: t, updatedAt: t, deletedAt: null });
      setJob(id, null);
    } catch (e) {
      setJob(id, { error: { message: (e as Error).message, kind: e instanceof ConversionError ? e.kind : 'server' } });
      throw e;
    }
  };

  const [queue, setQueue] = useState<{ done: number; total: number } | null>(null);
  const cancelQueue = useRef(false);
  const convertNotebook = async () => {
    const nb = notebookRef.current;
    if (!nb) return;
    flushSave();
    const todo: string[] = [];
    for (const id of nb.pageIds) {
      const p = id === pageRef.current?.id ? { ...pageRef.current, strokes: strokesRef.current } : await db.getPage(id);
      if (!p) continue;
      const withBackground = settingsRef.current.convertBackground && hasBackground(p);
      if (p.strokes.length === 0 && !withBackground) continue;
      const t = await db.getTranscript(id);
      if (t && (t.edited || t.strokeCount === p.strokes.length)) continue;
      todo.push(id);
    }
    if (todo.length === 0) return flash('Toutes les pages sont déjà converties.');
    cancelQueue.current = false;
    setPanelOpen(true);
    for (const [i, id] of todo.entries()) {
      if (cancelQueue.current) break;
      setQueue({ done: i, total: todo.length });
      try {
        await convertPageById(id);
      } catch (e) {
        if (e instanceof ConversionError && ['key', 'quota', 'overloaded', 'network'].includes(e.kind)) {
          flash(`Conversion du cahier arrêtée : ${e.message}`);
          break;
        }
      }
      // Le niveau gratuit limite le nombre de requêtes par minute
      if (i < todo.length - 1 && !cancelQueue.current) await sleep(demo ? 300 : 4000);
    }
    setQueue(null);
  };

  /** Correction d'une transcription, ou transcription écrite / collée à la main. */
  const saveTranscript = (blocks: Block[]) => {
    if (!pageId) return;
    const t = Date.now();
    if (transcript) void db.putTranscript({ ...transcript, blocks, edited: true, updatedAt: t });
    else
      void db.putTranscript({
        pageId, notebookId, blocks, model: 'manuel', strokeCount: strokesRef.current.length, edited: true, createdAt: t, updatedAt: t, deletedAt: null,
      });
  };

  // Conversions ponctuelles (lasso, photo)
  const storedResults = useQuery(() => (pageId ? db.resultsOf(pageId) : Promise.resolve([])), [pageId], ['results']) ?? [];
  const [liveResults, setLiveResults] = useState<Record<string, ConversionResult>>({});
  const results = useMemo(() => {
    const live = Object.values(liveResults).filter((r) => r.pageId === pageId);
    return [...live, ...storedResults.filter((r) => !liveResults[r.id])].sort((a, b) => b.createdAt - a.createdAt);
  }, [liveResults, storedResults, pageId]);

  const runResult = async (result: ConversionResult, image: EncodedImage) => {
    const started = performance.now();
    const patch = (p: Partial<ConversionResult>) => setLiveResults((all) => ({ ...all, [result.id]: { ...(all[result.id] ?? result), ...p } }));
    patch({ status: 'loading', error: undefined, errorKind: undefined });
    let final: ConversionResult;
    try {
      const { blocks, model } = await callGemini(image, (progress) => patch({ progress }));
      final = { ...result, status: 'done', blocks, model, durationMs: performance.now() - started };
    } catch (e) {
      final = { ...result, status: 'error', error: (e as Error).message, errorKind: e instanceof ConversionError ? e.kind : 'server' };
    }
    await db.putResult(final);
    setLiveResults((all) => {
      const next = { ...all };
      delete next[result.id];
      return next;
    });
  };

  const startResult = (source: ResultSource, image: EncodedImage | null) => {
    if (!image || !pageId) return flash('Rien à convertir : écris d’abord quelque chose.');
    const model = demo ? 'démo' : settingsRef.current.model || FREE_MODELS[0];
    const result: ConversionResult = { id: newId(), notebookId, pageId, source, createdAt: Date.now(), model, imageDataUrl: image.dataUrl, status: 'loading' };
    setPanelOpen(true);
    void runResult(result, image);
  };

  const convertSelection = async () => {
    const p = pageRef.current;
    const chosen = selectedStrokes();
    const boxes = chosen.map(strokeBBox);
    if (selectionRegion) boxes.push(selectionRegion);
    select([]);
    if (!p) return;
    try {
      startResult('selection', await imageOfPage(p, chosen, unionBBox(boxes)));
    } catch (e) {
      flash((e as Error).message);
    }
  };

  // ------------------------------------------------------------ interface
  const [panelOpen, setPanelOpen] = useState(false);
  const [stripOpen, setStripOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const pdfInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const photoConvertInput = useRef<HTMLInputElement>(null);
  const classifierConfig = useMemo(
    () => ({
      mode: settings.stylusMode,
      sizeMode: settings.sizeMode,
      palmSize: settings.palmSize,
      handedness: settings.handedness,
      lockBigStill: settings.lockBigStill,
      staticAfter: settings.staticAfter,
      penSize: settings.penSizePx,
      holdEraseMs: settings.holdEraser ? settings.holdMs : null,
      shapeHoldMs: settings.shapeHold ? settings.shapeHoldMs : null,
    }),
    [
      settings.stylusMode, settings.sizeMode, settings.palmSize, settings.handedness,
      settings.lockBigStill, settings.staticAfter, settings.penSizePx, settings.holdEraser, settings.holdMs,
      settings.shapeHold, settings.shapeHoldMs,
    ],
  );

  if (notebook === undefined) return <p className="center-message">Chargement…</p>;
  if (!notebook || notebook.deletedAt) {
    return (
      <p className="center-message">
        Ce cahier n’existe plus. <button onClick={() => go({ name: 'library', folderId: null })}>Retour à la bibliothèque</button>
      </p>
    );
  }

  const job = pageId ? jobs[pageId] : undefined;
  const pageBusy = job && 'progress' in job ? job.progress : null;
  const pageError = job && 'error' in job ? job.error : null;

  return (
    <div className="app">
      <header className="editor-header">
        <button
          className="tb-btn"
          onClick={() => {
            flushSave();
            go({ name: 'library', folderId: notebook.folderId });
          }}
          aria-label="Retour à la bibliothèque"
        >
          {ICONS.back}
        </button>
        <div className="nb-id">
          <button className="nb-title" onClick={() => setRenaming(true)} title="Renommer le cahier">
            <span className="dot" style={{ background: notebook.color }} />
            {notebook.title}
          </button>
          <span className="nb-sub">
            {notebook.subject ? `${notebook.subject} · ` : ''}
            Page {index + 1} sur {pageCount}
          </span>
        </div>
        <span className="header-gap" />
        <SyncChip />
        <button className="tb-primary" onClick={() => pageId && void convertPageById(pageId).catch(() => undefined)} disabled={!!pageBusy}>
          {pageBusy ? <span className="spinner" /> : ICONS.sigma}
          Convertir la page
        </button>
        <button
          className={`tb-btn ${panelOpen ? 'active' : ''}`}
          onClick={() => setPanelOpen((v) => !v)}
          aria-label="Transcription"
          aria-pressed={panelOpen}
        >
          {ICONS.panel}
        </button>
        <button
          className={`tb-btn ${menuOpen ? 'active' : ''}`}
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Menu du cahier"
          aria-expanded={menuOpen}
        >
          {ICONS.dots}
        </button>
        {menuOpen && (
          <NotebookMenu
            paper={page?.paper ?? notebook.paper}
            paperColor={page?.paperColor ?? notebook.paperColor ?? 'light'}
            paperDisabled={!page || hasBackground(page)}
            pageCount={pageCount}
            queue={queue}
            onPaper={(paper: PaperStyle) => {
              if (!page) return;
              setPage({ ...page, paper });
              persist({ paper });
              void updateNotebook(notebookId, { paper });
            }}
            onPaperColor={(paperColor: PaperColor) => {
              if (!page) return;
              setPage({ ...page, paperColor });
              persist({ paperColor });
              void updateNotebook(notebookId, { paperColor });
            }}
            onExport={() => (flushSave(), setExportOpen(true))}
            onConvertNotebook={() => {
              if (queue) cancelQueue.current = true;
              else void convertNotebook();
            }}
            onPages={() => setStripOpen(true)}
            onConvertPhoto={() => photoConvertInput.current?.click()}
            onInsertPdf={() => pdfInput.current?.click()}
            onRename={() => setRenaming(true)}
            onSettings={onOpenSettings}
            onDeletePage={() => setDeleting(true)}
            onClose={() => setMenuOpen(false)}
          />
        )}
      </header>

      <main className="workspace">
        {stripOpen && (
          <PageStrip
            pageIds={notebook.pageIds}
            current={index}
            version={version}
            defaultPaperColor={notebook.paperColor ?? 'light'}
            onOpen={goToPage}
            onAdd={(after) => void addPage(notebookId, after).then((i) => goToPage(i))}
            onMove={(from, to) => void movePage(notebookId, from, to).then(() => goToPage(to))}
            onDelete={() => setDeleting(true)}
            onDeleteMany={(ids) => {
              saveTimer.current = 0;
              void removePages(notebookId, ids).then(() => goToPage(0));
            }}
            onInsertPdf={() => pdfInput.current?.click()}
            onInsertPhoto={() => photoInput.current?.click()}
            onClose={() => setStripOpen(false)}
          />
        )}
        <section className="canvas-wrap">
          <nav className={`page-rail ${settings.handedness === 'right' ? 'rail-left' : 'rail-right'}`} aria-label="Pages">
            <div className="page-rail-pill">
              <button className="tb-btn sm rail-prev" disabled={index === 0} onClick={() => goToPage(index - 1)} aria-label="Page précédente">
                {ICONS.back}
              </button>
              <span className="rail-count" aria-label={`Page ${index + 1} sur ${pageCount}`}>
                <b>{index + 1}</b>
                <i />
                <span>{pageCount}</span>
              </span>
              <button className="tb-btn sm rail-next" disabled={index >= pageCount - 1} onClick={() => goToPage(index + 1)} aria-label="Page suivante">
                {ICONS.next}
              </button>
              <span className="rail-sep" />
              <button
                className={`tb-btn sm ${stripOpen ? 'active' : ''}`}
                onClick={() => setStripOpen((v) => !v)}
                aria-label="Toutes les pages"
                aria-pressed={stripOpen}
              >
                {ICONS.pages}
              </button>
              <button className="tb-btn sm" onClick={() => void addPage(notebookId, index).then((i) => goToPage(i))} aria-label="Ajouter une page après celle-ci">
                {ICONS.plus}
              </button>
            </div>
          </nav>
          <div className="canvas-stage">
          <Toolbar
            tool={tool}
            color={settings.color}
            size={settings.size}
            highlightColor={settings.highlightColor}
            highlightSize={settings.highlightSize}
            shapeKind={shapeKind}
            dashed={settings.dashed}
            eraserMode={settings.eraserMode}
            eraserSize={settings.eraserSize}
            canUndo={history.current.undo.length > 0}
            canRedo={history.current.redo.length > 0}
            canPaste={canPaste}
            onTool={(t) => {
              setTool(t);
              if (t !== 'lasso') select([]);
              if (t !== 'capture') setCaptureRegion(null);
            }}
            // Couleur et épaisseur du stylo servent aussi aux formes et à la ligne ; depuis la gomme, le lasso, la
            // capture ou la main, choisir une couleur reprend le stylo
            onColor={(color) => {
              update({ color });
              if (tool !== 'pen' && tool !== 'line' && tool !== 'shapes') setTool('pen');
            }}
            onSize={(size) => {
              update({ size });
              if (tool !== 'pen' && tool !== 'line' && tool !== 'shapes') setTool('pen');
            }}
            onHighlight={(patch) => update(patch)}
            onShapeKind={setShapeKind}
            onDashed={(dashed) => update({ dashed })}
            onEraser={(patch) => update(patch)}
            onUndo={undo}
            onRedo={redo}
            onPaste={paste}
          />
          {page ? (
            <InkCanvas
              key={`${page.id}-${settings.lowLatency ? 'rapide' : 'standard'}`}
              strokes={strokes}
              tool={tool}
              color={settings.color}
              size={settings.size}
              highlightColor={settings.highlightColor}
              highlightSize={settings.highlightSize}
              shapeKind={shapeKind}
              dashed={settings.dashed}
              eraserMode={settings.eraserMode}
              eraserSize={settings.eraserSize}
              paper={page.paper}
              paperColor={page.paperColor ?? notebook.paperColor ?? 'light'}
              pageWidth={page.width}
              pageHeight={page.height}
              extendable={isExtendable(page)}
              background={background}
              onScaleChange={onScaleChange}
              config={classifierConfig}
              restZone={settings.restZone}
              showContacts={settings.showContacts}
              lowLatency={settings.lowLatency}
              penSeen={settings.penSeen}
              selection={selection}
              selectionRegion={selectionRegion}
              stats={liveStats}
              onAddStroke={(s) => addStrokes([s])}
              onErase={removeStrokes}
              onReplaceStrokes={replaceStrokes}
              onResizeStroke={resizeStroke}
              onSelect={(ids, region) => {
                const current = pageRef.current;
                select(ids, region && current && hasBackground(current) ? region : null);
              }}
              onUndo={undo}
              onPenDetected={() => update({ penSeen: true })}
              onPenSize={(px) => update({ penSizePx: px })}
              onConvertSelection={() => void convertSelection()}
              onDeleteSelection={() => removeStrokes(selection)}
              onMoveSelection={(dx, dy) => replaceSelected((chosen) => shifted(chosen, dx, dy, false))}
              onRecolorSelection={recolorSelection}
              selectionColors={settings.selectionColors}
              onPickSelectionColor={(color) => {
                recolorSelection(color);
                // Pastille multicolore : la teinte choisie passe en premier, les autres se décalent
                update({ selectionColors: pushRecentColor(settings.selectionColors, color) });
              }}
              onDuplicateSelection={() => {
                const copies = shifted(selectedStrokes(), 6, 6, true);
                addStrokes(copies);
                select(copies.map((s) => s.id));
              }}
              onCopySelection={() => {
                const chosen = selectedStrokes();
                if (chosen.length === 0) return;
                clipboard = { type: 'strokes', strokes: chosen };
                setCanPaste(true);
                flash('Sélection copiée : « Coller » dans la barre d’outils, sur n’importe quelle page.');
              }}
              captureRegion={captureRegion}
              onCaptureRegion={setCaptureRegion}
              onCopyCapture={() => void copyCapture()}
            />
          ) : (
            <p className="center-message">Chargement de la page…</p>
          )}
          {notice && <div className="notice">{notice}</div>}
          {demo && <div className="demo-badge">Mode démo : réponses fictives</div>}
          </div>
        </section>
        {panelOpen && (
          <aside className="panel">
            <ResultsPanel
              transcript={transcript}
              strokeCount={strokes.length}
              hasBackground={!!page && hasBackground(page)}
              transcriptBusy={pageBusy}
              transcriptError={pageError}
              onConvertPage={() => pageId && void convertPageById(pageId).catch(() => undefined)}
              onSaveTranscript={saveTranscript}
              results={results}
              onRetry={(id) => {
                const r = results.find((x) => x.id === id);
                if (r) void runResult(r, imageFromDataUrl(r.imageDataUrl));
              }}
              onDelete={(id) => void db.deleteResult(id)}
              onOpenSettings={onOpenSettings}
              onInsert={insertBlocksAsImage}
            />
          </aside>
        )}
      </main>

      <input
        ref={pdfInput}
        type="file"
        accept="application/pdf"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file)
            void appendPdf(notebookId, file)
              .then(() => flash('PDF ajouté à la fin du cahier.'))
              .catch((err: Error) => flash(err.message));
        }}
      />
      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file)
            void insertPhotoPage(notebookId, index, file)
              .then((i) => goToPage(i))
              .catch((err: Error) => flash(err.message));
        }}
      />
      <input
        ref={photoConvertInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file)
            void imageFileToEncoded(file)
              .then((img) => startResult('image', img))
              .catch(() => flash('Impossible de lire cette image.'));
        }}
      />
      {renaming && (
        <PromptDialog
          title="Renommer le cahier"
          label="Titre"
          initial={notebook.title}
          onClose={() => setRenaming(false)}
          onConfirm={(title) => {
            setRenaming(false);
            if (title.trim()) void updateNotebook(notebookId, { title: title.trim() });
          }}
        />
      )}
      {deleting && pageId && (
        <ConfirmDialog
          title={`Supprimer la page ${index + 1} ?`}
          message="Ses traits et sa transcription seront supprimés."
          confirmLabel="Supprimer la page"
          danger
          onClose={() => setDeleting(false)}
          onConfirm={() => {
            setDeleting(false);
            saveTimer.current = 0;
            void removePage(notebookId, pageId).then(() => goToPage(Math.max(0, index - 1)));
          }}
        />
      )}
      {exportOpen && <ExportDialog notebook={notebook} pageIndex={index} settings={settings} update={update} onClose={() => setExportOpen(false)} />}
    </div>
  );
}
