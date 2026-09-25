import { useEffect, useMemo, useRef, useState } from 'react';
import { db, useQuery } from '../db/db';
import { removeGlyph, saveGlyph } from '../db/library';
import type { Glyph } from '../db/schema';
import { buildPath } from '../ink/draw';
import { InputClassifier } from '../ink/palm';
import type { Sample } from '../ink/palm';
import type { InkPoint } from '../ink/types';
import { go } from '../router';
import type { Settings } from '../settings';

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

function GlyphPad({ char, strokes, onChange, settings }: { char: string; strokes: InkPoint[][]; onChange(s: InkPoint[][]): void; settings: Settings }) {
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
    ctx.fillStyle = '#fff';
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
    guide(BASELINE - 0.72 * EM, '#e5e7eb', [6, 6]);
    guide(BASELINE - 0.5 * EM, '#d1d5db', [6, 6]);
    guide(BASELINE, '#94a3b8', []);
    guide(BASELINE + 0.28 * EM, '#e5e7eb', [6, 6]);
    ctx.setLineDash([]);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = `${EM * 1.05}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(char, PAD / 2, BASELINE);
    ctx.fillStyle = '#1d2433';
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

  return (
    <div className="pad-area">
      <canvas ref={canvasRef} className="glyph-pad" />
    </div>
  );
}

function Preview({ text, glyphs }: { text: string; glyphs: Map<string, Glyph> }) {
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
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, size * 2.2);
    ctx.fillStyle = '#1f3a8a';
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
  }, [text, glyphs]);
  return <canvas ref={ref} className="hand-preview-canvas" />;
}

export function HandwritingSetup({ settings }: { settings: Settings }) {
  const stored = useQuery(() => db.glyphs(), [], ['glyphs']);
  const glyphs = useMemo(() => new Map((stored ?? []).map((g) => [g.char, g])), [stored]);
  const [current, setCurrent] = useState('a');
  const [strokes, setStrokes] = useState<InkPoint[][]>([]);
  const [sample, setSample] = useState('f(x) = ax² + bx + c');

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

  return (
    <div className="hand-setup">
      <header className="lib-header">
        <button className="lib-brand" onClick={() => go({ name: 'library', folderId: null })}>
          ← Bibliothèque
        </button>
        <h1 className="hand-title">Mon écriture</h1>
        <span className="hand-progress">
          {glyphs.size} / {ALL.length} caractères
        </span>
      </header>
      <div className="hand-main">
        <aside className="hand-chars">
          {GROUPS.map((g) => (
            <section key={g.name}>
              <h3>{g.name}</h3>
              <div className="char-grid">
                {g.chars.map((c) => (
                  <button key={c} className={`char-cell ${c === current ? 'current' : ''} ${glyphs.has(c) ? 'done' : ''}`} onClick={() => select(c)}>
                    {c}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </aside>
        <section className="hand-work">
          <p className="hint">
            Écris <strong className="big-char">{current}</strong> une fois, posé sur la ligne pleine (les pointillés montrent la hauteur des
            minuscules et des majuscules). Ta main peut reposer sous le cadre. Tap à deux doigts = annuler le dernier trait.
          </p>
          <div className="row hand-actions">
            <button onClick={() => step(-1)}>← Précédent</button>
            <button onClick={() => setStrokes([])}>Effacer</button>
            {glyphs.has(current) && (
              <button className="danger" onClick={() => void removeGlyph(current).then(() => setStrokes([]))}>
                Supprimer
              </button>
            )}
            <button onClick={() => step(1)}>Passer</button>
            <button className="primary" onClick={() => void save()} disabled={strokes.length === 0}>
              Enregistrer et suivant →
            </button>
          </div>
          <GlyphPad char={current} strokes={strokes} onChange={setStrokes} settings={settings} />
          <div className="hand-preview">
            <label className="field">
              <span>Aperçu avec ton écriture (les caractères manquants sont en police Caveat)</span>
              <input value={sample} onChange={(e) => setSample(e.target.value)} />
            </label>
            <Preview text={sample} glyphs={glyphs} />
          </div>
        </section>
      </div>
    </div>
  );
}
