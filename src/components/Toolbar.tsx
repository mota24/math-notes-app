import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { ShapeKind, Tool } from '../ink/types';
import { PX_PER_MM, SLOT_COUNT, describeSlot, mmToPx, sameSlot, slotFromCurrent } from '../pencilCase';
import type { PencilCase, PencilSlot } from '../pencilCase';

const PEN_COLORS = [
  { value: '#1d2433', name: 'Noir' },
  { value: '#1f4fbf', name: 'Bleu' },
  { value: '#c0392b', name: 'Rouge' },
  { value: '#1e8449', name: 'Vert' },
  { value: '#ffffff', name: 'Blanc (papier sombre)' },
];
const HIGHLIGHT_COLORS = [
  { value: '#facc15', name: 'Jaune' },
  { value: '#4ade80', name: 'Vert' },
  { value: '#f472b6', name: 'Rose' },
  { value: '#60a5fa', name: 'Bleu' },
];
/** Ruban d'étude : opaque, donc des teintes franches qui ressortent sur papier clair comme sombre */
const TAPE_COLORS = [
  { value: '#fb923c', name: 'Orange' },
  { value: '#f472b6', name: 'Rose' },
  { value: '#facc15', name: 'Jaune' },
  { value: '#4ade80', name: 'Vert' },
  { value: '#60a5fa', name: 'Bleu' },
  { value: '#a78bfa', name: 'Violet' },
];
/** Les épaisseurs sont en mm (indépendantes du zoom) ; le curseur, lui, parle en px d'écran. */
const toPx = mmToPx;
const toMm = (px: number) => px / PX_PER_MM;
const PEN_RANGE = { min: 1, max: 20, step: 0.5, ticks: [1, 5, 10, 15, 20] };
const HIGHLIGHT_RANGE = { min: 4, max: 40, step: 1, ticks: [4, 13, 22, 31, 40] };
const TAPE_RANGE = { min: 8, max: 80, step: 1, ticks: [8, 26, 44, 62, 80] };

export const icon = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);

export const ICONS = {
  pen: icon(<path d="M4 20l4-1 11-11-3-3L5 16l-1 4zM14 6l3 3" />),
  highlighter: icon(<path d="M9 15l-3 5h6l1-2M9 15l7-11 4 3-7 11zM4 22h16" />),
  /** Ruban d'étude : une bande qui recouvre des lignes de texte */
  tape: icon(
    <>
      <path d="M4 6h9M4 18h12" />
      <rect x="3" y="9.5" width="18" height="5" rx="1.5" fill="currentColor" fillOpacity="0.28" />
    </>,
  ),
  line: icon(<path d="M4 20L20 4M4 20l2-5M4 20l5-2" />),
  eraser: icon(<path d="M8 20h12M5 15l8-9 6 6-7 8H9l-4-5z" />),
  lasso: icon(<path d="M12 4c5 0 8 2.5 8 5.5S16.5 15 12 15 4 12.5 4 9.5 7 4 12 4zM7 14c-1 2 0 4 2 5" strokeDasharray="3 2.5" />),
  hand: icon(<path d="M8 12V6a1.5 1.5 0 013 0v5m0-6.5a1.5 1.5 0 013 0V11m0-4.5a1.5 1.5 0 013 0V12m0-3a1.5 1.5 0 013 0v5c0 4-3 7-7 7-3 0-5-2-7-5l-2-3a1.5 1.5 0 012.5-1.6L8 13" />),
  undo: icon(<path d="M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 010 11H11" />),
  redo: icon(<path d="M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 000 11H13" />),
  image: icon(<path d="M4 6h16v12H4zM4 15l4-4 4 4 3-3 5 5M15.5 9.5h.01" />),
  paste: icon(<path d="M9 4h6v3H9zM7 5H5v15h14V5h-2M9 12h6M9 16h4" />),
  settings: icon(<path d="M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 00-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 00-2-1.2L14 3h-4l-.5 2.6a7 7 0 00-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 000 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 002 1.2L10 21h4l.5-2.6a7 7 0 002-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z" />),
  panel: icon(<path d="M4 5h16v14H4zM14 5v14" />),
  pages: icon(<path d="M4 5h6v14H4zM13 5h7M13 9h7M13 13h7M13 17h5" />),
  back: icon(<path d="M15 5l-7 7 7 7" />),
  next: icon(<path d="M9 5l7 7-7 7" />),
  plus: icon(<path d="M12 5v14M5 12h14" />),
  minus: icon(<path d="M5 12h14" />),
  export: icon(<path d="M12 4v11M7 9l5-5 5 5M5 15v5h14v-5" />),
  /** Anti-paume */
  shield: icon(<path d="M12 3l7 3v5.4c0 4.1-2.9 7.6-7 9.6-4.1-2-7-5.5-7-9.6V6l7-3zM9 12l2 2 4-4" />),
  /** Convertir en LaTeX */
  sigma: icon(<path d="M16 5H7l6 7-6 7h9" />),
  dots: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
      <path d="M6 12h.01M12 12h.01M18 12h.01" />
    </svg>
  ),
  check: icon(<path d="M5 13l4 4L19 7" />),
  close: icon(<path d="M6 6l12 12M18 6L6 18" />),
  trash: icon(<path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13" />),
  file: icon(<path d="M7 3h7l4 4v14H7zM14 3v5h4" />),
  /** Formes & tampons */
  shapes: icon(
    <>
      <rect x="3.3" y="3.3" width="9.4" height="9.4" rx="1.2" />
      <circle cx="16.5" cy="16.5" r="4.8" />
    </>,
  ),
  /** Lasso de capture rectangulaire */
  capture: icon(<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />),
};

type StampGroup = { title: string; items: { kind: ShapeKind; label: string; hint?: string; icon: ReactNode }[] };

const DASHED = { strokeDasharray: '2 2' };

/** Les tampons du sous-menu « Formes & tampons » : gabarits d'ingénierie posés d'un tap ou d'un glissé. */
const STAMP_GROUPS: StampGroup[] = [
  {
    title: 'Formes',
    items: [
      { kind: 'circle', label: 'Cercle', icon: icon(<circle cx="12" cy="12" r="8" />) },
      { kind: 'rect', label: 'Rectangle', icon: icon(<rect x="4" y="6" width="16" height="12" rx="1" />) },
      { kind: 'triangle', label: 'Triangle', icon: icon(<path d="M12 4L20 20H4Z" />) },
      { kind: 'arrow', label: 'Flèche', icon: icon(<path d="M4 18L18 6M11 6h7v7" />) },
    ],
  },
  {
    title: 'Mécanique',
    items: [
      {
        kind: 'axes2d',
        label: 'Repère 2D',
        icon: icon(<path d="M5 20.5V4M5 20.5H21M3.3 8L5 4l1.7 4M17 18.8L21 20.5l-1.7-3.7" />),
      },
      {
        kind: 'axes3d',
        label: 'Repère 3D',
        icon: icon(<path d="M12 21V6M12 21H22M12 21L4 15M10.3 8L12 4l1.7 4M18 17.5L22 21l-4.5-1M4.3 12L4 15l3.5 1" />),
      },
      {
        kind: 'torseur',
        label: 'Torseur',
        icon: icon(
          <text x="11" y="18" textAnchor="middle" fontSize="19" fontFamily="Georgia, 'Times New Roman', serif" stroke="none" fill="currentColor">
            {'{'}
          </text>,
        ),
      },
      {
        kind: 'matrix',
        label: 'Matrice',
        icon: icon(
          <text x="12" y="18" textAnchor="middle" fontSize="16" fontFamily="Georgia, 'Times New Roman', serif" stroke="none" fill="currentColor">
            {'( )'}
          </text>,
        ),
      },
    ],
  },
  {
    title: 'Volumes 3D (arêtes cachées en tirets)',
    items: [
      {
        kind: 'cylinder',
        label: 'Cylindre',
        icon: icon(
          <>
            <ellipse cx="12" cy="6" rx="7" ry="2.2" />
            <path d="M5 6v12M19 6v12M5 18c0 1.2 3.1 2.2 7 2.2s7-1 7-2.2" />
            <path d="M5 18c0-1.2 3.1-2.2 7-2.2s7 1 7 2.2" {...DASHED} />
          </>,
        ),
      },
      {
        kind: 'cone',
        label: 'Cône',
        icon: icon(
          <>
            <path d="M12 3L5 17M12 3l7 14M5 17c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6" />
            <path d="M5 17c0-1.4 3.1-2.6 7-2.6s7 1.2 7 2.6" {...DASHED} />
          </>,
        ),
      },
      {
        kind: 'sphere',
        label: 'Sphère',
        icon: icon(
          <>
            <circle cx="12" cy="12" r="8" />
            <path d="M4 12c0 2 3.6 3.6 8 3.6s8-1.6 8-3.6" />
            <path d="M4 12c0-2 3.6-3.6 8-3.6s8 1.6 8 3.6" {...DASHED} />
          </>,
        ),
      },
      {
        kind: 'hemisphere',
        label: 'Demi-sphère',
        icon: icon(
          <>
            <path d="M4 15a8 8 0 0116 0M4 15c0 2 3.6 3.6 8 3.6s8-1.6 8-3.6" />
            <path d="M4 15c0-2 3.6-3.6 8-3.6s8 1.6 8 3.6" {...DASHED} />
          </>,
        ),
      },
      {
        kind: 'pyramid',
        label: 'Pyramide',
        icon: icon(
          <>
            <path d="M4 19h11l5-4M12 4L4 19M12 4l3 15M12 4l8 11" />
            <path d="M4 19l5-4h11M12 4L9 15" {...DASHED} />
          </>,
        ),
      },
      {
        kind: 'cuboid',
        label: 'Pavé droit',
        hint: 'Parallélépipède rectangle',
        icon: icon(
          <>
            <path d="M3 9h12v11H3zM3 9l5-5h12M15 9l5-5M15 20l5-5V4" />
            <path d="M3 20l5-5h12M8 15V4" {...DASHED} />
          </>,
        ),
      },
    ],
  },
];
const ALL_STAMPS = STAMP_GROUPS.flatMap((g) => g.items);

interface Props {
  tool: Tool;
  color: string;
  size: number;
  highlightColor: string;
  highlightSize: number;
  tapeColor: string;
  tapeSize: number;
  shapeKind: ShapeKind;
  dashed: boolean;
  eraserMode: 'stroke' | 'precision';
  eraserSize: number;
  pencilCase: PencilCase;
  canUndo: boolean;
  canRedo: boolean;
  canPaste: boolean;
  onTool(t: Tool): void;
  onColor(c: string): void;
  onSize(s: number): void;
  onHighlight(patch: { highlightColor?: string; highlightSize?: number }): void;
  onTape(patch: { tapeColor?: string; tapeSize?: number }): void;
  onShapeKind(k: ShapeKind): void;
  onDashed(v: boolean): void;
  onEraser(patch: { eraserMode?: 'stroke' | 'precision'; eraserSize?: number }): void;
  /** Trousse : rappeler le favori i, y mémoriser l'outil actif, ou vider les trois */
  onRecallSlot(i: number): void;
  onSaveSlot(i: number): void;
  onClearCase(): void;
  onUndo(): void;
  onRedo(): void;
  onPaste(): void;
}

/** Appui long (ms) sur un favori pour y mémoriser le réglage courant */
const LONG_PRESS_MS = 550;

/** Aperçu d'un favori : un échantillon de trait à la couleur, à l'épaisseur et au style mémorisés. */
function SlotGlyph({ slot }: { slot: PencilSlot | null }) {
  if (!slot) {
    return (
      <svg viewBox="0 0 26 26" width="26" height="26" fill="none" aria-hidden="true">
        <circle cx="13" cy="13" r="9" stroke="currentColor" strokeWidth="1.4" strokeDasharray="3 3" opacity="0.55" />
        <path d="M13 9v8M9 13h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.7" />
      </svg>
    );
  }
  const px = toPx(slot.size);
  if (slot.tool === 'tape') {
    const h = Math.min(12, Math.max(5, px * 0.3));
    return (
      <svg viewBox="0 0 26 26" width="26" height="26" aria-hidden="true">
        <rect x="2.5" y={13 - h / 2} width="21" height={h} rx="1.5" fill={slot.color} />
      </svg>
    );
  }
  const w = slot.tool === 'highlighter' ? Math.min(11, Math.max(4, px * 0.5)) : Math.min(7, Math.max(1.6, px * 0.6));
  return (
    <svg viewBox="0 0 26 26" width="26" height="26" fill="none" aria-hidden="true">
      <path
        d="M4 19C8 6 13 23 22 7"
        stroke={slot.color}
        strokeWidth={w}
        strokeLinecap={slot.dashed ? 'butt' : 'round'}
        strokeOpacity={slot.tool === 'highlighter' ? 0.55 : 1}
        strokeDasharray={slot.dashed ? `${w * 2.2} ${w * 1.4}` : undefined}
      />
    </svg>
  );
}

/** Un emplacement de la trousse : tap = rappeler (ou mémoriser si vide), appui long = mémoriser le réglage courant. */
function SlotButton({
  index,
  slot,
  active,
  onRecall,
  onSave,
}: {
  index: number;
  slot: PencilSlot | null;
  active: boolean;
  onRecall(): void;
  onSave(): void;
}) {
  const timer = useRef(0);
  const fired = useRef(false);
  const [charging, setCharging] = useState(false);
  const stop = () => {
    window.clearTimeout(timer.current);
    setCharging(false);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const label = slot
    ? `Favori ${index + 1} : ${describeSlot(slot)}. Appui long : le remplacer par le réglage actuel.`
    : `Favori ${index + 1} vide : touche pour y mémoriser le réglage actuel.`;
  return (
    <button
      className={`tb-slot ${slot ? '' : 'empty'} ${active ? 'active' : ''} ${charging ? 'charging' : ''}`}
      onPointerDown={() => {
        fired.current = false;
        setCharging(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          fired.current = true;
          setCharging(false);
          navigator.vibrate?.(18);
          onSave();
        }, LONG_PRESS_MS);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onClick={() => {
        // Le clic qui suit un appui long ne doit pas rappeler ce qu'on vient de mémoriser
        if (fired.current) {
          fired.current = false;
          return;
        }
        if (slot) onRecall();
        else onSave();
      }}
      onContextMenu={(e) => e.preventDefault()}
      title={label}
      aria-label={label}
      aria-pressed={active}
    >
      <SlotGlyph slot={slot} />
      <span className="slot-n" aria-hidden="true">
        {index + 1}
      </span>
    </button>
  );
}

/** Continu ou pointillés : réglage commun au stylo et aux formes (arêtes cachées, lignes de projection). */
function DashStyle({ dashed, onDashed }: { dashed: boolean; onDashed(v: boolean): void }) {
  return (
    <>
      <div className="pop-label pop-colors-title">Style du trait</div>
      <div className="segmented" role="group" aria-label="Style du trait">
        <button onClick={() => onDashed(false)} aria-pressed={!dashed}>
          <svg viewBox="0 0 40 8" width="40" height="8" aria-hidden="true">
            <path d="M2 4h36" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
          Continu
        </button>
        <button onClick={() => onDashed(true)} aria-pressed={dashed}>
          <svg viewBox="0 0 40 8" width="40" height="8" aria-hidden="true">
            <path d="M2 4h36" stroke="currentColor" strokeWidth="2.4" strokeDasharray="7 4" />
          </svg>
          Pointillés
        </button>
      </div>
    </>
  );
}

type Pop = 'pen' | 'eraser' | 'shapes' | null;

/** Pilule d'outils flottante au-dessus de la page, façon tablette. */
export function Toolbar(p: Props) {
  const [pop, setPop] = useState<Pop>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const highlighter = p.tool === 'highlighter';
  const tape = p.tool === 'tape';
  const colors = highlighter ? HIGHLIGHT_COLORS : tape ? TAPE_COLORS : PEN_COLORS;
  const current = highlighter ? p.highlightColor : tape ? p.tapeColor : p.color;
  const range = highlighter ? HIGHLIGHT_RANGE : tape ? TAPE_RANGE : PEN_RANGE;
  const sizePx = Math.min(range.max, Math.max(range.min, toPx(highlighter ? p.highlightSize : tape ? p.tapeSize : p.size)));
  const setSizePx = (px: number) => {
    const value = Math.min(range.max, Math.max(range.min, px));
    if (highlighter) p.onHighlight({ highlightSize: toMm(value) });
    else if (tape) p.onTape({ tapeSize: toMm(value) });
    else p.onSize(toMm(value));
  };
  const setColor = (value: string) => {
    if (highlighter) p.onHighlight({ highlightColor: value });
    else if (tape) p.onTape({ tapeColor: value });
    else p.onColor(value);
  };
  const sizeLabel = sizePx % 1 ? sizePx.toFixed(1).replace('.', ',') : String(sizePx);

  // Le popover se referme dès qu'on touche ailleurs (la page, un autre outil)
  useEffect(() => {
    if (!pop) return;
    const onDown = (e: PointerEvent) => {
      if (!popRef.current?.contains(e.target as Node)) setPop(null);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [pop]);

  const writer = p.tool === 'pen' || p.tool === 'highlighter' || p.tool === 'tape' || p.tool === 'line';
  const toggle = (which: Exclude<Pop, null>) => setPop((v) => (v === which ? null : which));
  const toolButton = (t: Tool, label: string) => (
    <button
      className={`tb-btn ${p.tool === t ? 'active' : ''}`}
      onClick={() => {
        // Retoucher l'outil déjà choisi ouvre ses réglages (comme sur GoodNotes)
        if (p.tool === t && (t === 'pen' || t === 'highlighter' || t === 'tape' || t === 'line')) toggle('pen');
        else if (t === 'eraser') {
          if (p.tool === 'eraser') toggle('eraser');
          else {
            p.onTool('eraser');
            setPop('eraser');
          }
        } else {
          p.onTool(t);
          setPop(null);
        }
      }}
      title={label}
      aria-label={label}
      aria-pressed={p.tool === t}
    >
      {ICONS[t]}
    </button>
  );
  const currentStamp = ALL_STAMPS.find((s) => s.kind === p.shapeKind);
  const currentSlot = slotFromCurrent(p.tool, p);
  const slots = Array.from({ length: SLOT_COUNT }, (_, i) => p.pencilCase[i] ?? null);
  const eraserPx = Math.min(40, Math.max(4, p.eraserSize));

  return (
    <div className="toolbar" ref={popRef}>
      <div className="tb-pill">
        <div className="tb-group">
          {toolButton('pen', 'Stylo')}
          {toolButton('highlighter', 'Surligneur')}
          {toolButton('tape', 'Ruban d’étude : cache ce qui est dessous, un tap le rend transparent')}
          {toolButton('eraser', 'Gomme : par trait ou de précision')}
          {toolButton('lasso', 'Lasso : sélectionner, déplacer, convertir')}
          {toolButton('capture', 'Lasso de capture : encadrer une zone, la copier comme une image')}
          <button
            className={`tb-btn ${p.tool === 'shapes' ? 'active' : ''}`}
            onClick={() => {
              if (p.tool === 'shapes') toggle('shapes');
              else {
                p.onTool('shapes');
                setPop('shapes');
              }
            }}
            title="Formes & tampons"
            aria-label="Formes & tampons"
            aria-pressed={p.tool === 'shapes'}
          >
            {ICONS.shapes}
          </button>
          {toolButton('hand', 'Déplacer la page')}
        </div>
        <span className="tb-sep" />
        <div className="tb-group tb-slots" role="group" aria-label="Trousse : favoris">
          {slots.map((slot, i) => (
            <SlotButton
              key={i}
              index={i}
              slot={slot}
              active={sameSlot(slot, currentSlot)}
              onRecall={() => {
                p.onRecallSlot(i);
                setPop(null);
              }}
              onSave={() => p.onSaveSlot(i)}
            />
          ))}
        </div>
        <span className="tb-sep" />
        <button
          className="tb-chip"
          onClick={() => {
            if (!writer) p.onTool('pen');
            toggle('pen');
          }}
          aria-expanded={pop === 'pen'}
          aria-label={`Épaisseur et couleur : ${sizeLabel} px`}
          title="Épaisseur et couleur"
        >
          <span className="tb-chip-dot">
            <span style={{ width: Math.min(24, sizePx), height: Math.min(24, sizePx), background: current }} />
          </span>
          <span className="tb-chip-value">{sizeLabel} px</span>
        </button>
        <span className="tb-sep" />
        <button className="tb-btn" onClick={p.onUndo} disabled={!p.canUndo} title="Annuler (ou tap à deux doigts)" aria-label="Annuler">
          {ICONS.undo}
        </button>
        <button className="tb-btn" onClick={p.onRedo} disabled={!p.canRedo} title="Rétablir" aria-label="Rétablir">
          {ICONS.redo}
        </button>
        {p.canPaste && (
          <button className="tb-btn" onClick={p.onPaste} title="Coller la sélection copiée" aria-label="Coller">
            {ICONS.paste}
          </button>
        )}
      </div>

      {pop === 'pen' && (
        <div className="tb-pop">
          <div className="pop-head">
            <strong>{highlighter ? 'Surligneur' : tape ? 'Ruban d’étude' : p.tool === 'line' ? 'Règle : trait droit' : 'Stylo'}</strong>
            <button className="icon-btn" onClick={() => setPop(null)} aria-label="Fermer">
              {ICONS.close}
            </button>
          </div>
          <div className="pop-preview">
            <svg viewBox="0 0 320 72" width="320" height="72" fill="none" aria-hidden="true">
              <path
                d="M14 48C46 10 74 62 108 40S168 4 200 30s44 30 106 6"
                stroke={current}
                strokeWidth={Math.min(sizePx, 56)}
                strokeOpacity={highlighter ? 0.35 : 1}
                strokeLinecap={p.dashed && !highlighter && !tape ? 'butt' : 'round'}
                strokeDasharray={p.dashed && !highlighter && !tape ? `${Math.max(9, sizePx * 3)} ${Math.max(6, sizePx * 1.6)}` : undefined}
              />
            </svg>
          </div>
          <div className="pop-row">
            <span className="pop-label">Épaisseur</span>
            <span className="pop-value">
              {sizeLabel} px · {toMm(sizePx).toFixed(2).replace('.', ',')} mm
            </span>
          </div>
          <div className="size-row">
            <button className="icon-btn" onClick={() => setSizePx(sizePx - range.step)} disabled={sizePx <= range.min} aria-label="Plus fin">
              {ICONS.minus}
            </button>
            <input
              type="range"
              className="slider"
              min={range.min}
              max={range.max}
              step={range.step}
              value={sizePx}
              onChange={(e) => setSizePx(Number(e.target.value))}
              style={{ '--fill': `${((sizePx - range.min) / (range.max - range.min)) * 100}%` } as CSSProperties}
              aria-label={`Épaisseur du ${highlighter ? 'surligneur' : tape ? 'ruban' : 'trait'} en pixels`}
            />
            <button className="icon-btn" onClick={() => setSizePx(sizePx + range.step)} disabled={sizePx >= range.max} aria-label="Plus épais">
              {ICONS.plus}
            </button>
          </div>
          <div className="size-ticks">
            {range.ticks.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
          <div className="pop-label pop-colors-title">Couleur</div>
          <div className="pop-colors">
            {colors.map((c) => (
              <button
                key={c.value}
                className={`swatch ${current === c.value ? 'active' : ''}`}
                style={{ background: c.value }}
                onClick={() => setColor(c.value)}
                title={c.name}
                aria-label={`Couleur ${c.name}`}
                aria-pressed={current === c.value}
              />
            ))}
            {!highlighter && (
              <label className={`swatch custom ${colors.some((c) => c.value === current) ? '' : 'active'}`} title="Autre couleur">
                <input type="color" value={current} onChange={(e) => setColor(e.target.value)} aria-label="Autre couleur" />
              </label>
            )}
          </div>
          {!highlighter && !tape && <DashStyle dashed={p.dashed} onDashed={p.onDashed} />}
          <div className="pop-label pop-colors-title">Trousse</div>
          <div className="slot-save-row">
            {slots.map((slot, i) => (
              <button
                key={i}
                className={`slot-save ${sameSlot(slot, currentSlot) ? 'active' : ''}`}
                onClick={() => p.onSaveSlot(i)}
                aria-label={`Mémoriser ce réglage dans le favori ${i + 1}`}
                title={slot ? `Remplacer le favori ${i + 1} (${describeSlot(slot)})` : `Mémoriser dans le favori ${i + 1}`}
              >
                <SlotGlyph slot={slot} />
                <span>Favori {i + 1}</span>
              </button>
            ))}
          </div>
          <p className="pop-hint pop-hint-tight">
            Touche un favori pour y mémoriser ce réglage. Dans la barre, un tap le rappelle, un appui long le remplace.
            {slots.some(Boolean) && (
              <>
                {' '}
                <button className="pop-clear" onClick={p.onClearCase}>
                  Vider la trousse
                </button>
              </>
            )}
          </p>
          <p className="pop-hint">
            {highlighter
              ? 'Largeur constante, encre translucide : le surligneur passe par-dessus sans masquer.'
              : tape
                ? 'Ruban opaque : il cache ce qui est dessous. Tape dessus, au doigt ou au stylet, pour le rendre transparent ; retape pour le remettre. Un trait presque droit se redresse.'
                : 'L’épaisseur est enregistrée en millimètres : le trait garde sa taille au zoom comme à l’export PDF.'}
          </p>
        </div>
      )}

      {pop === 'eraser' && (
        <div className="tb-pop tb-pop-eraser">
          <div className="pop-head">
            <strong>Gomme</strong>
            <button className="icon-btn" onClick={() => setPop(null)} aria-label="Fermer">
              {ICONS.close}
            </button>
          </div>
          <div className="eraser-modes" role="group" aria-label="Mode de la gomme">
            <button
              className={`eraser-mode ${p.eraserMode === 'stroke' ? 'active' : ''}`}
              onClick={() => p.onEraser({ eraserMode: 'stroke' })}
              aria-pressed={p.eraserMode === 'stroke'}
            >
              <svg viewBox="0 0 48 28" width="48" height="28" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <path d="M4 20C12 4 20 26 28 12s10-6 16-2" opacity="0.3" />
                <path d="M17 5l8 18M25 5l-8 18" strokeWidth="2.6" />
              </svg>
              <strong>Gomme par trait</strong>
              <small>Efface tout le trait ou toute la forme d’un coup dès que la gomme le touche. Très rapide.</small>
            </button>
            <button
              className={`eraser-mode ${p.eraserMode === 'precision' ? 'active' : ''}`}
              onClick={() => p.onEraser({ eraserMode: 'precision' })}
              aria-pressed={p.eraserMode === 'precision'}
            >
              <svg viewBox="0 0 48 28" width="48" height="28" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <path d="M4 20C10 8 14 12 18 14" />
                <path d="M30 14c4-1 8-5 14-4" />
                <circle cx="24" cy="14" r="4.2" strokeWidth="1.8" strokeDasharray="2.2 2.2" />
              </svg>
              <strong>Gomme de précision</strong>
              <small>Efface uniquement la zone exacte par où passe la gomme.</small>
            </button>
          </div>
          <div className="pop-row">
            <span className="pop-label">Taille de la gomme</span>
            <span className="pop-value">{eraserPx} px</span>
          </div>
          <input
            type="range"
            className="slider"
            min={4}
            max={40}
            step={1}
            value={eraserPx}
            onChange={(e) => p.onEraser({ eraserSize: Number(e.target.value) })}
            style={{ '--fill': `${((eraserPx - 4) / 36) * 100}%` } as CSSProperties}
            aria-label="Taille de la gomme en pixels"
          />
          <p className="pop-hint">
            {p.eraserMode === 'precision'
              ? 'Les images et certains tampons (repères, torseur, matrice, volumes) sont effacés en entier ; les autres formes sont découpées.'
              : 'Astuce : un appui long immobile avec le stylet active la gomme, quel que soit l’outil.'}
          </p>
        </div>
      )}

      {pop === 'shapes' && (
        <div className="tb-pop tb-pop-shapes">
          <div className="pop-head">
            <strong>Formes & tampons</strong>
            <button className="icon-btn" onClick={() => setPop(null)} aria-label="Fermer">
              {ICONS.close}
            </button>
          </div>
          <p className="pop-hint">
            Dessine au stylo normal, puis reste appuyé sans lever la pointe en fin de trait : la forme se reconnaît toute
            seule et tu peux encore l’ajuster. Ou choisis un tampon ci-dessous, puis tapote ou glisse sur la page pour le poser.
          </p>
          {STAMP_GROUPS.map((group) => (
            <div key={group.title}>
              <div className="pop-label stamp-group-title">{group.title}</div>
              <div className="stamp-grid">
                {group.items.map((s) => (
                  <button
                    key={s.kind}
                    className={`stamp-btn ${p.tool === 'shapes' && p.shapeKind === s.kind ? 'active' : ''}`}
                    onClick={() => {
                      p.onShapeKind(s.kind);
                      if (p.tool !== 'shapes') p.onTool('shapes');
                      setPop(null);
                    }}
                    title={s.hint ?? s.label}
                    aria-label={s.hint ?? s.label}
                  >
                    {s.icon}
                    <span>{s.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <DashStyle dashed={p.dashed} onDashed={p.onDashed} />
          {currentStamp && (
            <p className="pop-hint">
              Tampon posé au prochain tap : <strong>{currentStamp.hint ?? currentStamp.label}</strong>.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
