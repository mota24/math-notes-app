import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { db, onDbChange, useQuery } from '../db/db';
import { addPage, appendPdf, insertPhotoPage, movePage, removePage, removePages, touchNotebook, updateNotebook } from '../db/library';
import type { Page } from '../db/schema';
import { hasBackground, pageBackground } from '../ink/background';
import { strokeBBox, unionBBox } from '../ink/geometry';
import { InkCanvas } from '../ink/InkCanvas';
import type { CanvasPage, TextEdit, TextTarget } from '../ink/InkCanvas';
import { fitTextBox, setHandGlyphs } from '../ink/draw';
import { prepareCorrection } from '../ocr/correct';
import { TEXT_LINE_HEIGHT, textPadding } from '../ink/textLayout';
import { rasterizeRegion } from '../ink/rasterize';
import { newId } from '../ink/types';
import type { BBox, PaperColor, PaperStyle, ShapeKind, Stroke, Tool } from '../ink/types';
import { go, replaceRoute } from '../router';
import type { Settings } from '../settings';
import { NotebookMenu } from './NotebookMenu';
import { ExportDialog } from './ExportDialog';
import { ShareDialog } from './ShareDialog';
import { SplitViewer } from './SplitViewer';
import { TextPanel } from './TextPanel';
import type { Highlight } from '../ocr/TextLayer';
import type { TextWord } from '../ocr/textModel';
import { readSplits, writeSplits } from './splitStore';
import { flushShareUpdate, scheduleShareUpdate } from '../share/share';
import { ConfirmDialog, PromptDialog } from './Modal';
import { PageStrip } from './PageStrip';
import { EditorTabs } from './TabBar';
import { reportStorageError } from '../db/storageAlert';
import { CloudIndicator } from './CloudIndicator';
import type { Tab } from '../tabs';
import { ICONS } from './icons';
import { Toolbar } from './Toolbar';
import { autoShapeColor, pushRecentColor } from '../colors';
import { fitHeight, imageTop, isExtendable } from '../ink/pageExtent';
import { applyAction, invertAction, splitStrokes } from '../ink/history';
import type { Action } from '../ink/history';

/** Écran partagé : le cahier affiché à côté de chaque cahier, et la largeur du volet (préférences locales) */
const RATIO_KEY = 'notes-maths:split-ratio';
function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeStored(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Navigation privée, stockage plein : la préférence ne sera simplement pas retenue
  }
}
/** Pages voisines (avant et après la page affichée) dont le fond reste prêt en mémoire. */
const BG_WINDOW = 2;

/** Presse-papiers partagé entre les pages et les cahiers : des traits copiés, ou une capture rectangulaire. */
type Clipboard = { type: 'strokes'; strokes: Stroke[] } | { type: 'capture'; dataUrl: string; widthMm: number; heightMm: number };
let clipboard: Clipboard | null = null;

/** Copie de traits décalés de (dx, dy) mm ; `freshIds` pour un collage (les originaux restent en place). */
function shifted(strokes: Stroke[], dx: number, dy: number, freshIds: boolean): Stroke[] {
  return strokes.map((s) => ({
    ...s,
    id: freshIds ? newId() : s.id,
    points: s.points.map(([x, y, p]): [number, number, number] => [x + dx, y + dy, p]),
  }));
}

interface Props {
  notebookId: string;
  pageIndex: number;
  settings: Settings;
  update(patch: Partial<Settings>): void;
  onOpenSettings(): void;
  tabs?: Tab[];
  onCloseTab?(id: string): void;
  onNewNotebook?(): void;
}

export function NotebookEditor({
  notebookId,
  pageIndex,
  settings,
  update,
  onOpenSettings,
  tabs = [],
  onCloseTab,
  onNewNotebook,
}: Props) {
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const notebook = useQuery(() => db.getNotebook(notebookId), [notebookId], ['notebooks']);
  const notebookRef = useRef(notebook);
  notebookRef.current = notebook;
  const pageCount = notebook?.pageIds.length ?? 0;
  const index = Math.min(pageIndex, Math.max(0, pageCount - 1));
  const pageId = notebook?.pageIds[index];

  const allNotebookPages = useQuery(() => db.pagesOf(notebookId), [notebookId], ['pages']);
  const pagesMap = useMemo(() => new Map((allNotebookPages ?? []).map((p) => [p.id, p])), [allNotebookPages]);
  // Lu par le chargement de page sans le relancer à chaque modification d'une page du cahier
  const pagesMapRef = useRef(pagesMap);
  pagesMapRef.current = pagesMap;
  const orderedPages = useMemo(() => {
    if (!notebook) return [];
    return notebook.pageIds.map((id) => pagesMap.get(id)).filter((p): p is Page => !!p);
  }, [notebook, pagesMap]);

  // ------------------------------------------------------------ page courante
  const [page, setPage] = useState<Page | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const pageRef = useRef<Page | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const history = useRef({ undo: [] as Action[], redo: [] as Action[] });
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const [version, setVersion] = useState(0);
  const saveTimer = useRef(0);

  /**
   * L'historique de CHAQUE page, gardé pour toute la session du cahier. Avant, il était remis à zéro à chaque
   * rechargement de la page — y compris quand la même page revenait de la base (écho de la sauvegarde
   * automatique, version reçue par la synchronisation) ou qu'on défilait jusqu'à la page suivante et revenait :
   * « Annuler » ne pouvait plus rien. Les actions désignent les traits par leur identifiant : elles restent
   * valables sur une version plus récente de la même page.
   */
  const histories = useRef(new Map<string, { undo: Action[]; redo: Action[] }>());
  const loadPage = useCallback((p: Page) => {
    if (pageRef.current?.id !== p.id) {
      let h = histories.current.get(p.id);
      if (!h) {
        h = { undo: [], redo: [] };
        histories.current.set(p.id, h);
      }
      history.current = h;
    }
    pageRef.current = p;
    strokesRef.current = p.strokes;
    setPage(p);
    setStrokes(p.strokes);
  }, []);

  /**
   * Écrit la page en base. En cas d'échec (stockage plein, erreur d'IndexedDB), l'alerte s'affiche et on
   * réessaie dans 5 s : le travail reste dans pageRef, rien n'est perdu tant que l'onglet est ouvert. Avant,
   * l'échec passait inaperçu et les derniers traits disparaissaient au rechargement.
   */
  // Fonction nommée : le nouvel essai s'appelle lui-même sans dépendre de la variable en cours d'initialisation
  const savePage = useCallback(function save() {
    const current = pageRef.current;
    if (!current) return;
    db.putPage(current)
      .then(() => setVersion((v) => v + 1))
      .catch((e: unknown) => {
        reportStorageError(e);
        if (!saveTimer.current) {
          saveTimer.current = window.setTimeout(() => {
            saveTimer.current = 0;
            save();
          }, 5000);
        }
      });
  }, []);
  const flushSave = useCallback(() => {
    if (!saveTimer.current) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = 0;
    savePage();
  }, [savePage]);

  useEffect(() => {
    if (!pageId) return;
    let alive = true;
    const fromMap = pagesMapRef.current.get(pageId);
    if (fromMap && !pageRef.current) loadPage(fromMap);
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
        savePage();
        void touchNotebook(notebookId);
      }, 600);
    },
    [notebookId, savePage],
  );

  const setPageStrokes = (next: Stroke[]) => {
    strokesRef.current = next;
    setStrokes(next);
    // Canevas infini : la page enregistrée fait juste les feuilles A4 qu'il faut pour son encre
    const current = pageRef.current;
    const height = current && isExtendable(current) ? fitHeight(next, (s) => strokeBBox(s).maxY) : null;
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
  /**
   * Mode « Texte » (lecture des PDF et scans) : l'outil Main est pris le temps du panneau — la page défile,
   * les mots se sélectionnent d'un appui long —, puis l'outil d'avant revient à la fermeture.
   */
  const [textOpen, setTextOpen] = useState<{ focus: boolean } | null>(null);
  const toolBeforeText = useRef<Tool | null>(null);
  const [textLayer, setTextLayer] = useState<ReadonlyMap<string, readonly TextWord[]> | null>(null);
  const [highlights, setHighlights] = useState<readonly Highlight[] | null>(null);
  const [reveal, setReveal] = useState<{ pageId: string; y: number; nonce: number } | null>(null);

  /**
   * Zone de texte sélectionnée d'un tap : le lasso est pris le temps de la sélection (glisser la zone, ses
   * poignées, sa barre d'actions), puis l'outil d'avant revient dès qu'elle se referme. Vérifié après le rendu :
   * un changement de page du défilement continu vide la sélection juste avant que le tap la remplisse.
   */
  const toolBeforeTap = useRef<Tool | null>(null);
  const onTapText = (id: string) => {
    if (tool !== 'lasso') toolBeforeTap.current = tool;
    setTool('lasso');
    select([id]);
  };
  useEffect(() => {
    const before = toolBeforeTap.current;
    if (selection.length > 0 || !before) return;
    toolBeforeTap.current = null;
    if (tool === 'lasso') setTool(before);
  }, [selection, tool]);
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
  /**
   * Une image de la galerie posée sur la page comme objet libre : elle se déplace, se redimensionne et se
   * tourne au lasso comme n'importe quel objet, ne remplace pas le fond et ne crée pas de page.
   */
  const insertImageFile = async (file: File) => {
    const p = pageRef.current;
    if (!p) return;
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      flash('Impossible de lire cette image.');
      return;
    }
    // Réduite avant d'être stockée : une photo de 12 Mpx dans la page pèserait des mégaoctets pour rien
    const ratio = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      flash('Impossible de préparer cette image.');
      return;
    }
    // Le PNG garde sa transparence (formule découpée, logo) ; le reste passe en JPEG sur fond blanc
    const png = file.type === 'image/png';
    if (!png) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const dataUrl = png ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.85);

    // Posée sous la dernière encre, à une largeur confortable sans déborder de la page
    const w = Math.min(120, p.width - 30);
    const h = (w * canvas.height) / canvas.width;
    const below = unionBBox(strokesRef.current.map(strokeBBox))?.maxY ?? 12;
    const x = 15;
    const y = imageTop(p, below, h);
    const stroke: Stroke = {
      id: newId(),
      tool: 'image',
      image: dataUrl,
      points: [
        [x, y, 1],
        [x + w, y + h, 1],
      ],
      color: settingsRef.current.color,
      size: 0,
      input: 'mouse',
    };
    addStrokes([stroke]);
    // Sélectionnée d'office : les poignées sont là tout de suite pour la placer, l'agrandir ou la tourner.
    // L'encre écrite ensuite passe par-dessus (on annote l'image) et la gomme ne l'efface jamais.
    setTool('lasso');
    select([stroke.id]);
    flash('Image posée : glisse-la, tire un coin pour l’agrandir. Reprends le stylo pour écrire dessus.');
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
  /** Raccourcis clavier qui dépendent de la sélection du moment (lus par un écouteur installé une fois) */
  const keysRef = useRef<{ remove(): void; clear(): void; copy(): boolean; paste(): boolean; find(): void }>({
    remove: () => {},
    clear: () => {},
    copy: () => false,
    paste: () => false,
    find: () => {},
  });

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
    // Posée sous la dernière encre, à la largeur de la page au plus
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

  keysRef.current = {
    find: () => openText(true),
    remove: () => {
      if (selection.length) removeStrokes(selection);
    },
    clear: () => {
      select([]);
      setCaptureRegion(null);
    },
    copy: () => {
      const chosen = selectedStrokes();
      if (!chosen.length) return false;
      clipboard = { type: 'strokes', strokes: chosen };
      setCanPaste(true);
      flash('Sélection copiée : Ctrl+V pour la coller, sur n’importe quelle page.');
      return true;
    },
    paste: () => {
      if (!clipboard) return false;
      paste();
      return true;
    },
  };

  // ------------------------------------------------------------ zones de texte
  const [textEdit, setTextEditState] = useState<TextEdit | null>(null);
  /** Copie synchrone : valider deux fois de suite (tap puis perte du focus) n'enregistre qu'une fois */
  const textEditRef = useRef<TextEdit | null>(null);
  const setTextEdit = (next: TextEdit | null | ((prev: TextEdit | null) => TextEdit | null)) => {
    const value = typeof next === 'function' ? next(textEditRef.current) : next;
    textEditRef.current = value;
    setTextEditState(value);
  };
  const onTextTarget = (target: TextTarget) => {
    if ('stroke' in target) {
      // Le cadre et la barre de la sélection laissent la place au champ de saisie
      select([]);
      const st = target.stroke;
      const [a, b] = st.points;
      setTextEdit({
        pageId: target.pageId,
        id: st.id,
        x: Math.min(a[0], b[0]),
        y: Math.min(a[1], b[1]),
        width: Math.abs(b[0] - a[0]),
        text: st.text ?? '',
        size: st.size,
        color: st.color,
      });
      return;
    }
    const size = settingsRef.current.textSize;
    // Un simple tap : la première ligne se centre sur le point touché
    const y = target.tap ? Math.max(0, target.y - textPadding(size) - (size * TEXT_LINE_HEIGHT) / 2) : target.y;
    setTextEdit({ pageId: target.pageId, id: null, x: target.x, y, width: target.width, text: '', size, color: settingsRef.current.color });
  };
  /**
   * Fin de la frappe : la zone est créée, modifiée ou (vidée) supprimée, en UN pas d'annulation sur la page
   * courante. Sur une autre page du défilement continu, l'écriture passe par une transaction (db.mutatePage).
   */
  const commitText = () => {
    const e = textEditRef.current;
    if (!e) return;
    setTextEdit(null);
    const text = e.text.replace(/\s+$/, '');
    const onCurrent = e.pageId === pageRef.current?.id;
    const pageStrokes = onCurrent ? strokesRef.current : (orderedPages.find((pg) => pg.id === e.pageId)?.strokes ?? []);
    const old = e.id ? pageStrokes.find((st) => st.id === e.id) : undefined;
    let next: Stroke | null = null;
    if (text.trim()) {
      next = fitTextBox({
        id: old?.id ?? newId(),
        tool: 'text',
        text,
        points: [
          [e.x, e.y, 0.5],
          [e.x + e.width, e.y, 0.5],
        ],
        color: e.color,
        size: e.size,
        input: 'mouse',
        ...(old?.angle ? { angle: old.angle } : {}),
      });
      if (old && old.text === next.text && old.color === next.color && old.size === next.size) return; // rien n'a changé
    } else if (!old) {
      return; // zone laissée vide : rien à garder
    }
    if (onCurrent) {
      if (!old && next) addStrokes([next]);
      else if (old && !next) removeStrokes([old.id]);
      else if (old && next) {
        const before = strokesRef.current;
        const after = before.map((st) => (st.id === old.id ? next : st));
        setPageStrokes(after);
        record({ type: 'replace', before, after });
      }
      return;
    }
    void db
      .mutatePage(e.pageId, (pg) => ({
        ...pg,
        strokes: !old ? [...pg.strokes, next!] : next ? pg.strokes.map((st) => (st.id === old.id ? next : st)) : pg.strokes.filter((st) => st.id !== old.id),
        updatedAt: Date.now(),
      }))
      .then(() => touchNotebook(notebookId))
      .catch(reportStorageError);
  };
  const commitTextRef = useRef(commitText);
  commitTextRef.current = commitText;

  // ------------------------------------------------------------ « Mon écriture » et correction des scans
  const glyphs = useQuery(() => db.glyphs(), [], ['glyphs']);
  useEffect(() => {
    if (glyphs) setHandGlyphs(glyphs);
  }, [glyphs]);
  const toggleHandFont = () => {
    if (!glyphs?.length) return flash('Enregistre d’abord ton écriture : Bibliothèque → Mon écriture.');
    replaceSelected((chosen) => chosen.map((st) => (st.tool === 'text' ? fitTextBox({ ...st, font: st.font === 'mine' ? undefined : 'mine' }) : st)));
  };

  /** Page de la dernière zone tracée au lasso */
  const regionPageRef = useRef<string | null>(null);
  const [correcting, setCorrecting] = useState(false);
  /**
   * « Corriger le texte » : la zone du lasso est lue, son texte effacé dans une rustine (le scan reste intact
   * dessous), puis une zone de texte pré-remplie est posée par-dessus et ouverte à la frappe. Rustine et texte
   * arrivent en un seul pas d'annulation.
   */
  const correctRegion = async () => {
    const region = selectionRegion;
    const target = pageRef.current;
    if (!region || !target || correcting) return;
    if (regionPageRef.current && regionPageRef.current !== target.id) return flash('Un instant : la page est encore en train de s’ouvrir. Réessaie.');
    setCorrecting(true);
    try {
      const correction = await prepareCorrection(target, region, setNotice);
      if (!correction) {
        flash('Aucun texte lu dans cette zone : entoure des mots imprimés du scan.');
        return;
      }
      if (pageRef.current?.id !== target.id) return; // page quittée entre-temps
      addStrokes(correction.patch ? [correction.patch, correction.text] : [correction.text]);
      select([]);
      onTextTarget({ pageId: target.id, stroke: correction.text });
      flash(
        correction.patch
          ? 'Corrige le texte, puis touche à côté pour valider. Le scan d’origine reste dessous : supprimer la rustine le fait réapparaître.'
          : 'Aucune encre à effacer trouvée ; le texte lu est posé par-dessus, prêt à corriger.',
      );
    } catch (e) {
      flash(`Correction impossible : ${(e as Error)?.message ?? 'erreur inconnue'}`);
    } finally {
      setCorrecting(false);
    }
  };

  const openText = (focus: boolean) => {
    if (!textOpen) {
      commitTextRef.current();
      select([]);
      if (tool !== 'hand') toolBeforeText.current = tool;
      setTool('hand');
    }
    setTextOpen({ focus });
  };
  const closeText = () => {
    setTextOpen(null);
    const before = toolBeforeText.current;
    toolBeforeText.current = null;
    if (before) setTool(before);
  };

  // ------------------------------------------------------------ navigation
  const goToPage = useCallback(
    (i: number) => {
      commitTextRef.current(); // un texte en cours de frappe est enregistré avant de changer de page
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
      } else if ((e.ctrlKey || e.metaKey) && key === 'f') {
        // Chercher dans le texte des PDF du cahier (et non la recherche du navigateur, qui ne voit pas les scans)
        e.preventDefault();
        keysRef.current.find();
      } else if ((e.ctrlKey || e.metaKey) && key === 'c') {
        if (keysRef.current.copy()) e.preventDefault();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        keysRef.current.remove();
      } else if (e.key === 'Escape') keysRef.current.clear();
      else if (e.key === 'PageDown' && index < pageCount - 1) goToPage(index + 1);
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
  // Un fichier de fond vient d'arriver (synchronisation) : les fonds qui manquaient sont redemandés
  const [filesTick, setFilesTick] = useState(0);
  useEffect(() => onDbChange((stores) => stores.includes('files') && setFilesTick((t) => t + 1)), []);
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
  }, [bgKey, bgScale, flash, filesTick]);

  /**
   * Fonds (PDF, photo) des pages voisines, pour le défilement continu. Seule une fenêtre autour de la page
   * affichée reste en mémoire : un canevas de fond pèse 4 à 25 Mo, et garder toutes les pages d'un PDF de
   * 100 pages montait à des centaines de Mo, jusqu'à faire tomber la tablette.
   *
   * L'ancienne version dépendait aussi de `backgrounds` : chaque fond reçu relançait l'effet, qui jetait les
   * rendus en cours et les redemandait tous — O(n²) rendus à l'ouverture d'un gros PDF. Les demandes en vol
   * et les fonds présents sont donc suivis par des refs, hors des dépendances.
   */
  const [backgrounds, setBackgrounds] = useState<Record<string, HTMLCanvasElement>>({});
  const bgHave = useRef(new Set<string>());
  const bgPending = useRef(new Set<string>());
  const bgWanted = useRef(new Set<string>());
  useEffect(() => {
    if (!orderedPages.length) return;
    const lo = Math.max(0, index - BG_WINDOW);
    const near = orderedPages.slice(lo, index + BG_WINDOW + 1).filter(hasBackground);
    bgWanted.current = new Set(near.map((p) => p.id));
    // Ce qui est sorti de la fenêtre est libéré
    setBackgrounds((prev) => {
      const kept: Record<string, HTMLCanvasElement> = {};
      for (const [id, canvas] of Object.entries(prev)) if (bgWanted.current.has(id)) kept[id] = canvas;
      if (Object.keys(kept).length === Object.keys(prev).length) return prev;
      bgHave.current = new Set(Object.keys(kept));
      return kept;
    });
    for (const p of near) {
      if (bgHave.current.has(p.id) || bgPending.current.has(p.id)) continue;
      bgPending.current.add(p.id);
      pageBackground(p, bgScale || 4)
        .then((canvas) => {
          // Arrivé trop tard (on a déjà tourné plusieurs pages) : on ne le garde pas
          if (!canvas || !bgWanted.current.has(p.id)) return;
          bgHave.current.add(p.id);
          setBackgrounds((prev) => (prev[p.id] ? prev : { ...prev, [p.id]: canvas }));
        })
        .catch(() => {})
        .finally(() => bgPending.current.delete(p.id));
    }
  }, [orderedPages, index, bgScale, filesTick]);

  // ------------------------------------------------------------ interface
  const [stripOpen, setStripOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const pdfInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);

  // ---- Écran partagé : un autre cahier (le PDF du cours) à gauche, retenu pour chaque cahier
  const [splitMap, setSplitMap] = useState<Record<string, string>>(readSplits);
  const [splitRatio, setSplitRatio] = useState<number>(() => readStored(RATIO_KEY, 0.45));
  const splitId = splitMap[notebookId] ?? null;
  const setSplitFor = (id: string, other: string | null) =>
    setSplitMap((prev) => {
      const next = { ...prev };
      if (other) next[id] = other;
      else delete next[id];
      writeSplits(next);
      return next;
    });
  const workspaceRef = useRef<HTMLElement>(null);
  /** Écran partagé qu'on vient d'ouvrir : le volet montre d'abord le mini-explorateur, pour choisir le cahier */
  const [splitPicking, setSplitPicking] = useState(false);
  const toggleSplit = async () => {
    if (splitId || splitPicking) {
      setSplitPicking(false);
      return setSplitFor(notebookId, null);
    }
    const others = (await db.notebooks()).filter((n) => !n.deletedAt && n.id !== notebookId);
    if (!others.length) return flash('Crée ou importe un autre cahier (le PDF du cours) pour l’afficher à côté.');
    setSplitPicking(true);
  };
  const dragSplit = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = workspaceRef.current?.getBoundingClientRect();
    if (!box) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    let ratio = splitRatio;
    // L'éditeur garde toujours au moins 480 px : sa barre d'outils doit tenir entière
    const maxRatio = Math.max(0.2, Math.min(0.75, 1 - 480 / box.width));
    const move = (ev: PointerEvent) => {
      ratio = Math.min(maxRatio, Math.max(0.2, (ev.clientX - box.left) / box.width));
      setSplitRatio(ratio);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      writeStored(RATIO_KEY, ratio);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  /** Export PDF direct : papier réglé, fonds PDF d'origine et encre en vectoriel, dans un seul fichier. */
  const exportPdf = async () => {
    const nb = notebookRef.current;
    if (!nb || pdfBusy !== null) return;
    flushSave();
    setPdfBusy('0');
    try {
      const pages: Page[] = [];
      for (const id of nb.pageIds) {
        const p = id === pageRef.current?.id ? { ...pageRef.current, strokes: strokesRef.current } : await db.getPage(id);
        if (p) pages.push(p);
      }
      const [{ exportInkPdf }, { downloadBlob }] = await Promise.all([import('../export/pdfOriginal'), import('../export/download')]);
      const blob = await exportInkPdf(pages, (done, total) => setPdfBusy(`${Math.round((done / total) * 100)}`), {
        defaultPaperColor: nb.paperColor ?? 'light',
        print: settingsRef.current.printMode,
      });
      await downloadBlob(blob, `${nb.title}.pdf`);
      flash(`PDF exporté : ${pages.length} page${pages.length > 1 ? 's' : ''}.`);
    } catch (e) {
      flash(`Export impossible : ${(e as Error).message}`);
    } finally {
      setPdfBusy(null);
    }
  };

  /** Glisser-déposer : une image se pose sur la page, un PDF s'ajoute à la fin du cahier. */
  const dropFiles = (files: File[]) => {
    for (const file of files) {
      if (file.type.startsWith('image/')) void insertImageFile(file);
      else if (file.type === 'application/pdf')
        void appendPdf(notebookId, file)
          .then(() => flash('PDF ajouté à la fin du cahier.'))
          .catch((err: Error) => flash(err.message));
    }
  };
  const dropRef = useRef(dropFiles);
  dropRef.current = dropFiles;
  // Coller une image (capture d'écran, image copiée depuis le navigateur) : elle se pose sur la page
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, [contenteditable]')) return;
      const images = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      if (!images.length) {
        // Ctrl+V sans image dans le presse-papiers du système : les traits (ou la capture) copiés dans l'appli
        if (keysRef.current.paste()) e.preventDefault();
        return;
      }
      e.preventDefault();
      dropRef.current(images);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);
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

  // ---- Lien partagé : suit le cahier (15 s après la dernière modification, jamais à chaque trait)
  const shareId = notebook?.shareId ?? null;
  const shareSig = useRef<string | null>(null);
  useEffect(() => {
    if (!shareId || !notebook) return;
    const sig = `${version}:${notebook.updatedAt}:${notebook.pageIds.length}`;
    if (shareSig.current !== null && shareSig.current !== sig) scheduleShareUpdate(notebookId, shareId);
    shareSig.current = sig;
  }, [shareId, version, notebook, notebookId]);
  useEffect(() => () => flushShareUpdate(notebookId), [notebookId]);

  // ---- Hooks multi-pages : déclarés ici, avant tout return conditionnel (Rules of Hooks) ----
  const notebookPaperColor = notebook?.paperColor ?? 'light';
  const pagePaperColor = page?.paperColor ?? notebookPaperColor;

  const canvasPages: CanvasPage[] = useMemo(() => {
    if (!orderedPages.length && page) {
      return [
        {
          id: page.id,
          width: page.width,
          height: page.height,
          paper: page.paper,
          paperColor: pagePaperColor,
          background: background,
          strokes: strokes,
        },
      ];
    }
    return orderedPages.map((p) => {
      const isCurrent = p.id === pageId;
      return {
        id: p.id,
        width: p.width,
        height: isCurrent ? (page ? page.height : p.height) : p.height,
        paper: isCurrent ? (page ? page.paper : p.paper) : p.paper,
        paperColor: isCurrent ? pagePaperColor : (p.paperColor ?? notebookPaperColor),
        background: isCurrent ? (background ?? backgrounds[p.id] ?? null) : (backgrounds[p.id] ?? null),
        strokes: isCurrent ? strokes : p.strokes,
      };
    });
  }, [orderedPages, page, pagePaperColor, notebookPaperColor, background, backgrounds, strokes, pageId]);

  // Pas de useCallback : InkCanvas lit ses rappels dans une ref, leur identité n'a pas d'importance
  const onAddStrokeMulti = (s: Stroke, targetPageId?: string) => {
    if (!targetPageId || targetPageId === pageRef.current?.id) {
      addStrokes([s]);
    } else {
      // Lecture et écriture dans UNE transaction (voir db.mutatePage) : deux traits rapides sur la page d'à
      // côté, ou son ouverture au même moment, ne peuvent plus s'écraser l'un l'autre
      void db
        .mutatePage(targetPageId, (target) => ({ ...target, strokes: [...target.strokes, s], updatedAt: Date.now() }))
        .then(() => touchNotebook(notebookId))
        .catch(reportStorageError);
    }
  };

  const handleAddPageAtEnd = useCallback(() => {
    void addPage(notebookId, pageCount - 1).then((i) => {
      goToPage(i);
      flash('Nouvelle page ajoutée.');
    });
  }, [notebookId, pageCount, goToPage, flash]);

  const handlePageIndexChange = useCallback(
    (newIdx: number) => {
      if (newIdx !== index && newIdx >= 0 && newIdx < pageCount) {
        goToPage(newIdx);
      }
    },
    [index, pageCount, goToPage],
  );
  // ---- Fin des hooks déplacés ----

  if (notebook === undefined) return <p className="center-message">Chargement…</p>;
  if (!notebook || notebook.deletedAt) {
    return (
      <p className="center-message">
        Ce cahier n'existe plus. <button onClick={() => go({ name: 'library', folderId: null })}>Retour à la bibliothèque</button>
      </p>
    );
  }

  const paperColor = pagePaperColor;
  // Formes et lignes : la couleur choisie, sinon celle qui tranche sur le papier (noir sur clair, blanc sur sombre)
  const shapeColor = settings.shapeColor ?? autoShapeColor(paperColor);

  return (
    <div className="app">
      <header className="editor-header">
        {/* ── ZONE GAUCHE : bouton retour ── */}
        <div className="editor-zone-left">
          <button
            className="tb-btn tb-back"
            onClick={() => {
              flushSave();
              go({ name: 'library', folderId: notebook.folderId });
            }}
            aria-label="Retour à la bibliothèque"
            title="Bibliothèque"
          >
            {ICONS.back}
          </button>
        </div>

        {/* ── ZONE CENTRE : onglets (fluide, prend tout l'espace disponible) ── */}
        <EditorTabs
          tabs={tabs}
          activeId={notebookId}
          currentNotebook={notebook}
          onClose={onCloseTab}
          onRename={() => setRenaming(true)}
          onNewNotebook={onNewNotebook}
        />

        {/* ── ZONE DROITE : actions compactes (icônes), fixe, ne rétrécit jamais ── */}
        <div className="editor-zone-right">
          <CloudIndicator />
          {orderedPages.some(hasBackground) && (
            <button
              className={`tb-icon ${textOpen ? 'active' : ''}`}
              onClick={() => (textOpen ? closeText() : openText(true))}
              title={textOpen ? 'Fermer le panneau Texte' : 'Texte des PDF et scans : rechercher, sélectionner, copier (Ctrl+F)'}
              aria-label="Texte du document"
              aria-pressed={!!textOpen}
            >
              {ICONS.scanText}
            </button>
          )}
          <button
            className={`tb-icon ${splitId || splitPicking ? 'active' : ''}`}
            onClick={() => void toggleSplit()}
            title={splitId ? 'Fermer l’écran partagé' : 'Écran partagé : un autre cahier (cours PDF) à côté'}
            aria-label="Écran partagé"
            aria-pressed={!!splitId || splitPicking}
          >
            {ICONS.split}
          </button>
          <button className="tb-icon" onClick={() => pdfInput.current?.click()} title="Importer un PDF à la fin du cahier" aria-label="Importer un PDF">
            {ICONS.file}
          </button>
          <button
            className={`tb-icon ${shareId ? 'active' : ''}`}
            onClick={() => setShareOpen(true)}
            title={shareId ? 'Cahier partagé (lien en lecture seule)' : 'Partager en lecture seule'}
            aria-label="Partager"
          >
            {ICONS.share}
          </button>
          <button className="tb-icon" onClick={() => void exportPdf()} disabled={pdfBusy !== null} title="Exporter en PDF (papier, fonds et encre)" aria-label="Exporter en PDF">
            {pdfBusy !== null ? <span className="tb-progress">{pdfBusy}%</span> : ICONS.download}
          </button>
          <button
            className={`tb-btn ${menuOpen ? 'active' : ''}`}
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Menu du cahier"
            aria-expanded={menuOpen}
          >
            {ICONS.dots}
          </button>
        </div>
        {menuOpen && (
          <NotebookMenu
            paper={page?.paper ?? notebook.paper}
            paperColor={paperColor}
            paperDisabled={!page || hasBackground(page)}
            pageCount={pageCount}
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
            onShare={() => setShareOpen(true)}
            shared={!!shareId}
            onPages={() => setStripOpen(true)}
            onInsertPdf={() => pdfInput.current?.click()}
            onRename={() => setRenaming(true)}
            onSettings={onOpenSettings}
            onDeletePage={() => setDeleting(true)}
            onClose={() => setMenuOpen(false)}
          />
        )}
      </header>

      <main className="workspace" ref={workspaceRef}>
        {(splitId || splitPicking) && (
          <>
            <div className="split-pane" style={{ width: `${splitRatio * 100}%` }}>
              <SplitViewer
                key={splitId ?? 'choix'}
                notebookId={splitId}
                currentId={notebookId}
                onPick={(id) => {
                  setSplitPicking(false);
                  setSplitFor(notebookId, id);
                }}
                onClose={() => {
                  setSplitPicking(false);
                  setSplitFor(notebookId, null);
                }}
                onSwap={() => {
                  // Le cours passe dans l'éditeur (pour l'annoter), ce cahier passe à côté
                  if (!splitId) return;
                  flushSave();
                  setSplitFor(splitId, notebookId);
                  go({ name: 'notebook', notebookId: splitId, pageIndex: 0 });
                }}
              />
            </div>
            <div
              className="split-handle"
              role="separator"
              aria-orientation="vertical"
              aria-label="Redimensionner l’écran partagé"
              onPointerDown={dragSplit}
              onDoubleClick={() => (setSplitRatio(0.45), writeStored(RATIO_KEY, 0.45))}
            >
              <span />
            </div>
          </>
        )}
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
          <div
            className={`canvas-stage${paperColor === 'dark' ? ' paper-dark' : ''}${dropping ? ' dropping' : ''}`}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes('Files')) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
              if (!dropping) setDropping(true);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDropping(false);
              dropFiles([...e.dataTransfer.files]);
            }}
          >
          <Toolbar
            tool={tool}
            color={settings.color}
            size={settings.size}
            highlightColor={settings.highlightColor}
            highlightSize={settings.highlightSize}
            shapeKind={shapeKind}
            shapeColor={shapeColor}
            shapeColorAuto={settings.shapeColor === null}
            dashed={settings.dashed}
            eraserMode={settings.eraserMode}
            eraserSize={settings.eraserSize}
            lassoShape={settings.lassoShape}
            canUndo={history.current.undo.length > 0}
            canRedo={history.current.redo.length > 0}
            canPaste={canPaste}
            onLassoShape={(lassoShape) => update({ lassoShape })}
            onImage={() => imageInput.current?.click()}
            onTool={(t) => {
              toolBeforeTap.current = null;
              if (textOpen && t !== 'hand') {
                toolBeforeText.current = null;
                setTextOpen(null);
              }
              setTool(t);
              if (t !== 'lasso') select([]);
              if (t !== 'capture') setCaptureRegion(null);
            }}
            // L'épaisseur du stylo sert aussi aux formes ; depuis la gomme, le lasso, la capture ou la main,
            // choisir une couleur ou une épaisseur reprend le stylo
            onColor={(color) => {
              update({ color });
              // Avec l'outil Texte, la couleur s'applique au texte (et à la zone en cours de frappe)
              if (tool === 'text') setTextEdit((prev) => (prev ? { ...prev, color } : prev));
              else if (tool !== 'pen') setTool('pen');
            }}
            onSize={(size) => {
              update({ size });
              if (tool !== 'pen' && tool !== 'shapes') setTool('pen');
            }}
            onShapeColor={(color) => update({ shapeColor: color })}
            onHighlight={(patch) => update(patch)}
            onShapeKind={setShapeKind}
            onDashed={(dashed) => update({ dashed })}
            onEraser={(patch) => update(patch)}
            onUndo={undo}
            onRedo={redo}
            onPaste={paste}
            textSize={settings.textSize}
            onTextSize={(textSize) => {
              update({ textSize });
              setTextEdit((prev) => (prev ? { ...prev, size: textSize } : prev));
            }}
          />
          {page ? (
            <InkCanvas
              key={`${notebookId}-${settings.lowLatency ? 'rapide' : 'standard'}`}
              pages={canvasPages}
              currentPageIndex={index}
              onPageIndexChange={handlePageIndexChange}
              onAddPage={handleAddPageAtEnd}
              strokes={strokes}
              tool={tool}
              color={settings.color}
              size={settings.size}
              highlightColor={settings.highlightColor}
              highlightSize={settings.highlightSize}
              shapeKind={shapeKind}
              shapeColor={shapeColor}
              dashed={settings.dashed}
              eraserMode={settings.eraserMode}
              eraserSize={settings.eraserSize}
              lassoShape={settings.lassoShape}
              paper={page.paper}
              paperColor={paperColor}
              pageWidth={page.width}
              pageHeight={page.height}
              extendable={isExtendable(page)}
              background={background}
              onScaleChange={onScaleChange}
              config={classifierConfig}
              restZone={settings.restZone}
              lowLatency={settings.lowLatency}
              penSeen={settings.penSeen}
              selection={selection}
              selectionRegion={selectionRegion}
              onAddStroke={onAddStrokeMulti}
              onErase={removeStrokes}
              onReplaceStrokes={replaceStrokes}
              onTransformStrokes={(changed) => {
                // Une zone de texte élargie, rétrécie ou agrandie : sa hauteur suit ses nouvelles lignes
                replaceSelected(() => changed.map(fitTextBox));
                // La zone du lasso (sur un PDF ou une photo) ne correspond plus à rien une fois la sélection transformée
                setSelectionRegion(null);
              }}
              onSwitchTool={setTool}
              onTapText={onTapText}
              onSelect={(ids, region, targetPageId) => {
                // La zone du lasso compte sur la page où il a été tracé (en défilement continu, pas forcément la courante)
                const target = orderedPages.find((pg) => pg.id === targetPageId) ?? pageRef.current;
                regionPageRef.current = target?.id ?? null;
                select(ids, region && target && hasBackground(target) ? region : null);
              }}
              onCorrectRegion={() => void correctRegion()}
              onToggleHandFont={toggleHandFont}
              onUndo={undo}
              onPenDetected={() => update({ penSeen: true })}
              onPenSize={(px) => update({ penSizePx: px })}
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
              textSize={settings.textSize}
              textEdit={textEdit}
              onTextTarget={onTextTarget}
              onTextChange={(text) => setTextEdit((prev) => (prev ? { ...prev, text } : prev))}
              onTextDone={() => commitTextRef.current()}
              textLayer={textOpen ? textLayer : null}
              highlights={textOpen ? highlights : null}
              reveal={reveal}
            />
          ) : (
            <p className="center-message">Chargement de la page…</p>
          )}
          {textOpen && (
            <TextPanel
              pages={orderedPages}
              currentIndex={index}
              autoFocus={textOpen.focus}
              onTextLayer={setTextLayer}
              onHighlights={setHighlights}
              onReveal={(i, y) => {
                const target = orderedPages[i];
                if (target) setReveal((r) => ({ pageId: target.id, y, nonce: (r?.nonce ?? 0) + 1 }));
              }}
              onClose={closeText}
            />
          )}
          {notice && <div className="notice">{notice}</div>}
          </div>
        </section>
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
        ref={imageInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void insertImageFile(file);
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
          message="Ses traits seront supprimés."
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
      {shareOpen && <ShareDialog notebook={notebook} onClose={() => setShareOpen(false)} />}
      {exportOpen && <ExportDialog notebook={notebook} pageIndex={index} settings={settings} update={update} onClose={() => setExportOpen(false)} />}
    </div>
  );
}
