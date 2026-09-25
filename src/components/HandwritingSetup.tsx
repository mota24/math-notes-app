import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { db, useQuery } from '../db/db';
import { removeGlyph, saveGlyph } from '../db/library';
import type { Glyph } from '../db/schema';
import { buildPath } from '../ink/draw';
import { InputClassifier } from '../ink/palm';
import type { Sample } from '../ink/palm';
import type { InkPoint } from '../ink/types';
import { go } from '../router';
import type { Settings } from '../settings';
import { Icon } from './LibraryIcons';
import { dangerButton, focusRing, glassButton, glassButtonAccent, glassIconButton } from './libraryStyles';

const GROUPS: { name: string; chars: string[] }[] = [
  { name: 'Minuscules', chars: [...'abcdefghijklmnopqrstuvwxyz'] },
  { name: 'Majuscules', chars: [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'] },
  { name: 'Chiffres', chars: [...'0123456789'] },
  { name: 'Accents', chars: [...'éèêàçùôîâë'] },
  { name: 'Ponctuation', chars: [...'.,;:!?\'()[]{}/|-'] },
  { name: 'Opérateurs', chars: [...'+−×÷=≠≈<>≤≥±∞√∫∑∏∂∇→⇒⇔∈∉⊂∪∩∀∃∅°'] },
  { name: 'Grec', chars: [...'αβγδεθλμπρστφωΔΣΩ'] },
];
const ALL = GROUPS.flatMap((g) => g.chars);

/** Cadre de saisie : 400 unités de côté, ligne de base à 62 %, 1 em = moitié du cadre. */
const PAD = 400;
const BASELINE = PAD * 0.62;
const EM = PAD * 0.5;
const SIDE = 0.06;
const PEN = EM * 0.05;

/**
 * Couleurs dessinées dans les canevas (le CSS ne les atteint pas) : en thème sombre, celles des cartes de la
 * bibliothèque (gris #1a1b1f, traits clairs, repères à peine visibles) ; en clair, le papier blanc d'origine.
 */
const PALETTE = {
  light: { paper: '#ffffff', faint: '#e5e7eb', guide: '#d1d5db', baseline: '#94a3b8', ghost: '#e2e8f0', ink: '#1d2433', preview: '#1f3a8a' },
  dark: {
    paper: '#1a1b1f',
    faint: 'rgba(255, 255, 255, 0.07)',
    guide: 'rgba(255, 255, 255, 0.13)',
    baseline: 'rgba(160, 188, 245, 0.55)',
    ghost: 'rgba(255, 255, 255, 0.07)',
    ink: '#f4f4f5',
    preview: '#a0bcf5',
  },
};
type Palette = (typeof PALETTE)['light'];

const darkQuery = '(prefers-color-scheme: dark)';

/** Le système est-il en thème sombre ? (la bibliothèque suit le même réglage) */
function usePrefersDark(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const media = window.matchMedia(darkQuery);
      media.addEventListener('change', notify);
      return () => media.removeEventListener('change', notify);
    },
    () => window.matchMedia(darkQuery).matches,
  );
}

function toGlyph(char: string, strokes: InkPoint[][]): Glyph | null {
  const points = strokes.flat();
  if (points.length === 0) return null;
  const minX = Math.min(...points.map((p) => p[0]));
  const maxX = Math.max(...points.map((p) => p[0]));
  return {
    char,
    strokes: strokes.map((s) => s.map(([x, y, p]): InkPoint => [(x - minX) / EM + SIDE, (y - BASELINE) / EM, p])),
    advance: (maxX - minX) / EM + 2 * SIDE,
    updatedAt: Date.now(),
  };
}

function fromGlyph(glyph: Glyph): InkPoint[][] {
  const left = (PAD - glyph.advance * EM) / 2;
  return glyph.strokes.map((s) => s.map(([x, y, p]): InkPoint => [left + x * EM, BASELINE + y * EM, p]));
}

function GlyphPad({ char, strokes, onChange, settings, colors }: { char: string; strokes: InkPoint[][]; onChange(s: InkPoint[][]): void; settings: Settings; colors: Palette }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const live = useRef(new Map<number, InkPoint[]>());

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const css = canvas.getBoundingClientRect().width || PAD;
    canvas.width = Math.round(css * dpr);
    canvas.height = Math.round(css * dpr);
    const ctx = canvas.getContext('2d')!;
    const k = (css * dpr) / PAD;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.fillStyle = colors.paper;
    ctx.fillRect(0, 0, PAD, PAD);
    const guide = (y: number, color: string, dash: number[]) => {
      ctx.beginPath();
      ctx.setLineDash(dash);
      ctx.moveTo(0, y);
      ctx.lineTo(PAD, y);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    };
    guide(BASELINE - 0.72 * EM, colors.faint, [6, 6]);
    guide(BASELINE - 0.5 * EM, colors.guide, [6, 6]);
    guide(BASELINE, colors.baseline, []);
    guide(BASELINE + 0.28 * EM, colors.faint, [6, 6]);
    ctx.setLineDash([]);
    ctx.fillStyle = colors.ghost;
    ctx.font = `${EM * 1.05}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(char, PAD / 2, BASELINE);
    ctx.fillStyle = colors.ink;
    for (const s of [...strokesRef.current, ...live.current.values()]) if (s.length) ctx.fill(buildPath(s, 'touch', PEN, true));
  };

  useEffect(draw);
  // Les écouteurs de stylet (installés une fois) redessinent avec la version à jour de draw
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const { penSeen } = settings;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const toPad = (s: Sample): InkPoint => {
      const r = canvas.getBoundingClientRect();
      return [((s.x - r.left) * PAD) / r.width, ((s.y - r.top) * PAD) / r.height, 0.5];
    };
    const classifier = new InputClassifier(
      {
        mode: settings.stylusMode,
        sizeMode: settings.sizeMode,
        palmSize: settings.palmSize,
        handedness: settings.handedness,
        handTool: false,
        restTop: null,
      },
      {
        drawStart: (id, _kind, samples) => {
          live.current.set(id, samples.map(toPad));
          drawRef.current();
        },
        drawMove: (id, samples) => {
          live.current.get(id)?.push(...samples.map(toPad));
          drawRef.current();
        },
        drawEnd: (id) => {
          const s = live.current.get(id);
          live.current.delete(id);
          if (!s?.length) return;
          // Mis à jour tout de suite : deux traits peuvent se terminer avant le prochain rendu
          strokesRef.current = [...strokesRef.current, s];
          onChangeRef.current(strokesRef.current);
        },
        drawCancel: (id) => {
          live.current.delete(id);
          drawRef.current();
        },
        panZoom: () => undefined,
        twoFingerTap: () => {
          strokesRef.current = strokesRef.current.slice(0, -1);
          onChangeRef.current(strokesRef.current);
        },
        penDetected: () => undefined,
      },
    );
    classifier.penSeen = penSeen;
    const sample = (e: PointerEvent): Sample => ({ x: e.clientX, y: e.clientY, p: e.pressure, t: e.timeStamp, size: Math.max(e.width || 0, e.height || 0) });
    const kind = (e: PointerEvent) => (e.pointerType === 'pen' ? 'pen' : e.pointerType === 'mouse' ? 'mouse' : 'touch');
    // La main posée sous le cadre ne dessine pas
    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      classifier.config = { ...classifier.config, restTop: canvas.getBoundingClientRect().bottom + 2 };
      classifier.down(kind(e), e.pointerId, sample(e));
    };
    const onMove = (e: PointerEvent) => {
      if (e.buttons === 0) return;
      const list = e.getCoalescedEvents?.() ?? [];
      classifier.move(e.pointerId, (list.length ? list : [e]).map(sample));
    };
    const onUp = (e: PointerEvent) => classifier.up(e.pointerId, sample(e));
    const onCancel = (e: PointerEvent) => classifier.cancel(e.pointerId);
    // Les contacts commencent souvent sous le cadre (paume) : on écoute toute la zone
    const area = canvas.parentElement!;
    area.addEventListener('pointerdown', onDown);
    area.addEventListener('pointermove', onMove);
    area.addEventListener('pointerup', onUp);
    area.addEventListener('pointercancel', onCancel);
    return () => {
      area.removeEventListener('pointerdown', onDown);
      area.removeEventListener('pointermove', onMove);
      area.removeEventListener('pointerup', onUp);
      area.removeEventListener('pointercancel', onCancel);
      classifier.reset();
    };
  }, [settings.stylusMode, settings.sizeMode, settings.palmSize, settings.handedness, penSeen]);

  // Toute la zone reçoit le stylet (et la paume, en dessous du cadre) : ni défilement, ni sélection de texte
  return (
    <div className="touch-none select-none pb-[180px]">
      <canvas
        ref={canvasRef}
        className="block aspect-square w-[min(420px,100%)] rounded-2xl border border-black/10 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_12px_32px_-20px_rgba(0,0,0,0.25)] dark:border-white/[0.06] dark:shadow-[0_1px_2px_rgba(0,0,0,0.35),0_12px_32px_-20px_rgba(0,0,0,0.7)]"
      />
    </div>
  );
}

function Preview({ text, glyphs, colors }: { text: string; glyphs: Map<string, Glyph>; colors: Palette }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const size = 44;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.getBoundingClientRect().width || 600;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(size * 2.2 * dpr);
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = colors.paper;
    ctx.fillRect(0, 0, width, size * 2.2);
    ctx.fillStyle = colors.preview;
    let x = 12;
    const baseline = size * 1.45;
    for (const ch of text) {
      const glyph = glyphs.get(ch);
      if (ch === ' ') x += size * 0.35;
      else if (glyph) {
        ctx.save();
        ctx.translate(x, baseline);
        for (const s of glyph.strokes) if (s.length) ctx.fill(buildPath(s.map(([gx, gy, p]): InkPoint => [gx * size, gy * size, p]), 'touch', size * 0.075, true));
        ctx.restore();
        x += glyph.advance * size;
      } else {
        ctx.font = `${size}px Caveat`;
        ctx.fillText(ch, x, baseline);
        x += ctx.measureText(ch).width;
      }
    }
  }, [text, glyphs, colors]);
  return <canvas ref={ref} className="block h-[97px] w-full rounded-xl border border-black/10 dark:border-white/[0.06]" />;
}

const charCell = `grid h-10 min-h-0 place-items-center rounded-lg border p-0 text-lg leading-none transition-colors duration-150 active:scale-95 ${focusRing}`;
const charIdle =
  'border-black/10 bg-black/[0.03] text-zinc-700 hover:bg-black/[0.07] dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-zinc-300 dark:hover:bg-white/[0.07]';
const charDone =
  'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-300';
const charCurrent = 'border-accent bg-accent/15 text-accent-ink ring-2 ring-accent/35 dark:text-accent';

const sectionTitle = 'm-0 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400';

/**
 * « Mon écriture » : on écrit chaque caractère une fois, et l'export « écriture manuscrite » s'en sert.
 * Même habillage que la bibliothèque : fond #121316, panneaux gris uni à contour fin, boutons sobres, accent
 * bleu en texte ; le cadre d'écriture lui-même passe en gris foncé à traits clairs.
 */
export function HandwritingSetup({ settings }: { settings: Settings }) {
  const stored = useQuery(() => db.glyphs(), [], ['glyphs']);
  const glyphs = useMemo(() => new Map((stored ?? []).map((g) => [g.char, g])), [stored]);
  const [current, setCurrent] = useState('a');
  const [strokes, setStrokes] = useState<InkPoint[][]>([]);
  const [sample, setSample] = useState('f(x) = ax² + bx + c');
  const colors = usePrefersDark() ? PALETTE.dark : PALETTE.light;

  useEffect(() => {
    const g = glyphs.get(current);
    setStrokes(g ? fromGlyph(g) : []);
    // On ne recharge qu'au changement de caractère, pas à chaque enregistrement
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, stored === undefined]);

  const select = (c: string) => setCurrent(c);
  const step = (delta: number) => setCurrent(ALL[(ALL.indexOf(current) + delta + ALL.length) % ALL.length]);
  const save = async () => {
    const glyph = toGlyph(current, strokes);
    if (glyph) await saveGlyph(glyph);
    step(1);
  };
  const done = ALL.filter((c) => glyphs.has(c)).length;

  return (
    <div className="library flex h-[calc(100dvh_-_var(--tabbar-h,0px))] flex-col overflow-hidden bg-zinc-50 text-zinc-900 dark:bg-[#121316] dark:text-zinc-100">
      <header className="shrink-0 border-b border-black/5 bg-zinc-50/90 px-4 py-3 backdrop-blur-md sm:px-6 dark:border-white/[0.05] dark:bg-[#121316]/90">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <button
            type="button"
            className={glassIconButton}
            onClick={() => go({ name: 'library', folderId: null })}
            aria-label="Retour à la bibliothèque"
            title="Bibliothèque"
          >
            <Icon name="chevron" className="size-[18px] rotate-180" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="m-0 truncate text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Mon écriture</h1>
            <p className="m-0 mt-0.5 truncate text-sm text-zinc-500 dark:text-zinc-400">Chaque caractère enregistré sert à l’export en écriture manuscrite.</p>
          </div>
          <div className="flex min-w-40 flex-col items-end gap-1.5" aria-label={`${done} caractères enregistrés sur ${ALL.length}`}>
            <span className="text-sm tabular-nums text-zinc-500 dark:text-zinc-400">
              <strong className="font-semibold text-zinc-900 dark:text-zinc-50">{done}</strong> / {ALL.length} caractères
            </span>
            <span className="block h-1.5 w-40 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.06]">
              <span className="block h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${(done / ALL.length) * 100}%` }} />
            </span>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 portrait:flex-col">
        <aside className="shrink-0 basis-[300px] overflow-y-auto overscroll-contain border-black/5 px-4 pb-8 pt-2 landscape:border-r portrait:basis-[34%] portrait:border-b dark:border-white/[0.05] dark:bg-[#0c0d0f]/40">
          {GROUPS.map((g) => {
            const count = g.chars.filter((c) => glyphs.has(c)).length;
            return (
              <section key={g.name} className="mt-5 first:mt-3">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <h2 className={sectionTitle}>{g.name}</h2>
                  <span className="text-[11px] font-medium tabular-nums text-zinc-400 dark:text-zinc-500">
                    {count}/{g.chars.length}
                  </span>
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(40px,1fr))] gap-1.5">
                  {g.chars.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={c === current}
                      className={`${charCell} ${c === current ? charCurrent : glyphs.has(c) ? charDone : charIdle}`}
                      onClick={() => select(c)}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </aside>

        <section className="min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-4 sm:px-6">
          <div className="flex max-w-[640px] flex-col gap-4">
            <div className="flex items-start gap-4 rounded-2xl border border-black/10 bg-white px-4 py-3 dark:border-white/[0.06] dark:bg-[#1a1b1f]">
              <span className="grid size-14 shrink-0 place-items-center rounded-xl border border-accent/25 bg-accent/10 font-serif text-3xl text-accent-ink dark:text-accent">
                {current}
              </span>
              <p className="m-0 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                Écris <strong className="font-semibold text-zinc-900 dark:text-zinc-50">{current}</strong> une fois, posé sur la ligne pleine (les pointillés
                montrent la hauteur des minuscules et des majuscules). Ta main peut reposer sous le cadre. Tap à deux doigts = annuler le dernier trait.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={glassButton} onClick={() => step(-1)}>
                <Icon name="chevron" className="size-4 rotate-180" /> Précédent
              </button>
              <button type="button" className={glassButton} onClick={() => setStrokes([])} disabled={strokes.length === 0}>
                Effacer
              </button>
              {glyphs.has(current) && (
                <button type="button" className={`${dangerButton} h-10 min-h-0 px-3.5`} onClick={() => void removeGlyph(current).then(() => setStrokes([]))}>
                  Supprimer
                </button>
              )}
              <button type="button" className={glassButton} onClick={() => step(1)}>
                Passer
              </button>
              <button type="button" className={glassButtonAccent} onClick={() => void save()} disabled={strokes.length === 0}>
                Enregistrer et suivant <Icon name="chevron" className="size-4" />
              </button>
            </div>

            <GlyphPad char={current} strokes={strokes} onChange={setStrokes} settings={settings} colors={colors} />
          </div>

          <div className="flex max-w-[640px] flex-col gap-2 pb-10">
            <label className="flex flex-col gap-2">
              <span className={sectionTitle}>Aperçu</span>
              <span className="text-[13px] text-zinc-500 dark:text-zinc-400">Les caractères pas encore enregistrés s’affichent en police Caveat.</span>
              <input
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                data-bwignore
                value={sample}
                onChange={(e) => setSample(e.target.value)}
                className="h-10 w-full rounded-xl border border-black/10 bg-white px-3 text-sm text-zinc-900 outline-none transition-colors focus:border-accent/60 focus:ring-2 focus:ring-accent/30 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-zinc-100"
              />
            </label>
            <Preview text={sample} glyphs={glyphs} colors={colors} />
          </div>
        </section>
      </div>
    </div>
  );
}
