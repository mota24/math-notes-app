import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { ShapeKind, Tool } from '../ink/types';
import { ICONS } from './icons';
import { ALL_STAMPS, STAMP_GROUPS } from './stamps';

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
  { value: '#1d2433', name: 'Noir' },
];
/** Couleurs à portée de doigt dans la barre : celles du stylo (aussi pour les formes), celles du surligneur. */
const QUICK_PEN = [
  { value: '#1d2433', name: 'Noir' },
  { value: '#ffffff', name: 'Blanc' },
  { value: '#c0392b', name: 'Rouge' },
];
const QUICK_HIGHLIGHT = [
  { value: '#facc15', name: 'Jaune' },
  { value: '#4ade80', name: 'Vert' },
  { value: '#1d2433', name: 'Noir' },
];
/** Les épaisseurs sont en mm (indépendantes du zoom) ; le curseur, lui, parle en px d'écran. */
const PX_PER_MM = 3.7795;
const toPx = (mm: number) => Math.round(mm * PX_PER_MM * 2) / 2;
const toMm = (px: number) => px / PX_PER_MM;
const PEN_RANGE = { min: 1, max: 20, step: 0.5, ticks: [1, 5, 10, 15, 20] };
const HIGHLIGHT_RANGE = { min: 4, max: 40, step: 1, ticks: [4, 13, 22, 31, 40] };

interface Props {
  tool: Tool;
  color: string;
  size: number;
  highlightColor: string;
  highlightSize: number;
  shapeKind: ShapeKind;
  /** Couleur des formes et des lignes (celle qu'on a choisie, sinon celle qui tranche sur le papier) */
  shapeColor: string;
  /** Automatique : la couleur des formes suit le papier (noir sur clair, blanc sur sombre) */
  shapeColorAuto: boolean;
  dashed: boolean;
  eraserMode: 'stroke' | 'precision';
  eraserSize: number;
  canUndo: boolean;
  canRedo: boolean;
  canPaste: boolean;
  onTool(t: Tool): void;
  onColor(c: string): void;
  onSize(s: number): void;
  onHighlight(patch: { highlightColor?: string; highlightSize?: number }): void;
  onShapeKind(k: ShapeKind): void;
  onShapeColor(c: string | null): void;
  onDashed(v: boolean): void;
  onEraser(patch: { eraserMode?: 'stroke' | 'precision'; eraserSize?: number }): void;
  onUndo(): void;
  onRedo(): void;
  onPaste(): void;
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

/** Les outils dont un second tap (quand ils sont déjà choisis) ouvre les réglages : un premier tap se contente de les choisir. */
const SETTINGS_POP: Partial<Record<Tool, Exclude<Pop, null>>> = { pen: 'pen', highlighter: 'pen', eraser: 'eraser' };

/** Pilule d'outils flottante au-dessus de la page, façon tablette. */
export function Toolbar(p: Props) {
  const [pop, setPop] = useState<Pop>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const highlighter = p.tool === 'highlighter';
  const shapes = p.tool === 'shapes';
  const colors = highlighter ? HIGHLIGHT_COLORS : PEN_COLORS;
  const quick = highlighter ? QUICK_HIGHLIGHT : QUICK_PEN;
  const current = highlighter ? p.highlightColor : shapes ? p.shapeColor : p.color;
  const range = highlighter ? HIGHLIGHT_RANGE : PEN_RANGE;
  const sizePx = Math.min(range.max, Math.max(range.min, toPx(highlighter ? p.highlightSize : p.size)));
  const setSizePx = (px: number) => {
    const value = Math.min(range.max, Math.max(range.min, px));
    if (highlighter) p.onHighlight({ highlightSize: toMm(value) });
    else p.onSize(toMm(value));
  };
  const setColor = (value: string) => {
    if (highlighter) p.onHighlight({ highlightColor: value });
    else if (shapes) p.onShapeColor(value);
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

  // La barre garde toujours tout sur une seule ligne, sans défiler : sur une zone étroite (portrait, panneau
  // latéral ouvert), boutons et pastilles se resserrent
  const [density, setDensity] = useState<'full' | 'compact' | 'tight'>('full');
  useEffect(() => {
    const stage = popRef.current?.parentElement;
    if (!stage) return;
    const measure = () => setDensity(stage.clientWidth < 610 ? 'tight' : stage.clientWidth < 690 ? 'compact' : 'full');
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const writer = p.tool === 'pen' || p.tool === 'highlighter' || shapes;
  const toggle = (which: Exclude<Pop, null>) => setPop((v) => (v === which ? null : which));
  const toolButton = (t: Tool, label: string) => (
    <button
      className={`tb-btn ${p.tool === t ? 'active' : ''}`}
      onClick={() => {
        // Retoucher l'outil déjà choisi ouvre ses réglages (comme sur GoodNotes)
        const settings = SETTINGS_POP[t];
        if (p.tool === t && settings) toggle(settings);
        else {
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
  const eraserPx = Math.min(40, Math.max(4, p.eraserSize));

  return (
    <div className={`toolbar density-${density}`} ref={popRef}>
      <div className="tb-pill">
        <div className="tb-group">
          {toolButton('pen', 'Stylo')}
          {toolButton('highlighter', 'Surligneur')}
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
        <div className="tb-group tb-quick" role="group" aria-label="Couleurs rapides">
          {quick.map((c) => (
            <button
              key={c.value}
              className={`tb-qc ${current === c.value ? 'active' : ''}`}
              style={{ '--qc': c.value } as CSSProperties}
              onClick={() => setColor(c.value)}
              title={c.name}
              aria-label={`Couleur ${c.name}`}
              aria-pressed={current === c.value}
            />
          ))}
          <button
            className="tb-wheel"
            style={{ '--cur': current } as CSSProperties}
            onClick={() => {
              if (!writer) p.onTool('pen');
              toggle('pen');
            }}
            aria-expanded={pop === 'pen'}
            aria-label={`Palette et épaisseur du trait : ${sizeLabel} px`}
            title={`Palette et épaisseur (${sizeLabel} px)`}
          />
        </div>
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
            <strong>{highlighter ? 'Surligneur' : shapes ? 'Formes : couleur et trait' : 'Stylo'}</strong>
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
                strokeLinecap={p.dashed && !highlighter ? 'butt' : 'round'}
                strokeDasharray={p.dashed && !highlighter ? `${Math.max(9, sizePx * 3)} ${Math.max(6, sizePx * 1.6)}` : undefined}
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
              aria-label={`Épaisseur du ${highlighter ? 'surligneur' : 'trait'} en pixels`}
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
            <label className={`swatch custom ${colors.some((c) => c.value === current) ? '' : 'active'}`} title="Autre couleur">
              <input type="color" value={current} onChange={(e) => setColor(e.target.value)} aria-label="Autre couleur" />
            </label>
            {shapes && (
              <button
                className={`pop-auto ${p.shapeColorAuto ? 'active' : ''}`}
                onClick={() => p.onShapeColor(null)}
                aria-pressed={p.shapeColorAuto}
                title="Noire sur papier clair, blanche sur papier sombre"
              >
                Auto
              </button>
            )}
          </div>
          {!highlighter && <DashStyle dashed={p.dashed} onDashed={p.onDashed} />}
          <p className="pop-hint">
            {highlighter
              ? 'Largeur constante, encre translucide : le surligneur passe par-dessus sans masquer.'
              : shapes
                ? 'Auto : formes et lignes sont noires sur papier clair, blanches sur papier sombre. Choisir une couleur la fixe pour les formes (le stylo garde la sienne).'
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
              ? 'Certains tampons (repères, torseur, matrice, volumes) sont effacés en entier ; les autres formes sont découpées.'
              : 'Astuce : un appui long immobile avec le stylet active la gomme, quel que soit l’outil.'}{' '}
            Les images ne sont jamais effacées : pour en retirer une, sélectionne-la au lasso puis « Supprimer ».
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
                    className={`stamp-btn ${shapes && p.shapeKind === s.kind ? 'active' : ''}`}
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
