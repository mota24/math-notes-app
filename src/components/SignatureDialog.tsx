import { useEffect, useRef, useState } from 'react';
import { db } from '../db/db';
import { newId } from '../ink/types';
import type { InkPoint } from '../ink/types';
import { MAX_SIGNATURES, SIGNATURES_KEY, normalizeSignature } from '../ink/signature';
import type { Signature } from '../ink/signature';
import { SIGNATURE_PEN, drawSignature } from '../ink/signatureRender';
import { buildPath } from '../ink/draw';
import { Modal } from './Modal';

/** Cadre de saisie : 110 × 40 mm de papier virtuel (une signature y tient à l'aise) */
const PAD_W = 110;
const PAD_H = 40;

/** Aperçu d'une signature enregistrée */
function Thumb({ sig }: { sig: Signature }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const scale = Math.min(150 / sig.width, 56 / sig.height);
    c.width = Math.round(sig.width * scale * dpr);
    c.height = Math.round(sig.height * scale * dpr);
    c.style.width = `${Math.round(sig.width * scale)}px`;
    c.style.height = `${Math.round(sig.height * scale)}px`;
    drawSignature(c.getContext('2d')!, sig, scale * dpr, '#1d2433');
  }, [sig]);
  return <canvas ref={ref} className="sig-thumb" />;
}

/**
 * « Mes signatures » : tracer une signature une fois (stylet, doigt ou souris), la garder, en supprimer une.
 * Elles restent sur cet appareil uniquement : ni synchronisées, ni dans les sauvegardes.
 */
export function SignatureDialog({ signatures, onClose }: { signatures: Signature[]; onClose(): void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<InkPoint[][]>([]);
  const live = useRef<{ id: number; points: InkPoint[] } | null>(null);
  /** Un stylet actif a été vu : le doigt (la paume) ne trace plus */
  const penSeen = useRef(false);
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const full = signatures.length >= MAX_SIGNATURES;

  const redraw = () => {
    const c = canvas.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(r.width * dpr)) {
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
    }
    const ctx = c.getContext('2d')!;
    const k = (r.width * dpr) / PAD_W; // pixels (écran) par mm
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    // Ligne de signature
    ctx.strokeStyle = 'rgba(100, 116, 139, 0.45)';
    ctx.lineWidth = dpr;
    ctx.setLineDash([6 * dpr, 5 * dpr]);
    ctx.beginPath();
    ctx.moveTo(8 * k, 30 * k);
    ctx.lineTo((PAD_W - 8) * k, 30 * k);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.scale(k, k);
    ctx.fillStyle = '#1d2433';
    for (const s of [...strokes.current, ...(live.current ? [live.current.points] : [])]) if (s.length) ctx.fill(buildPath(s, 'pen', SIGNATURE_PEN, true));
  };
  useEffect(redraw);

  const toMm = (e: React.PointerEvent<HTMLCanvasElement>): InkPoint => {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * PAD_W, ((e.clientY - r.top) / r.height) * PAD_H, e.pointerType === 'pen' ? Math.max(0.1, e.pressure || 0.5) : 0.5];
  };

  const save = async () => {
    const sig = normalizeSignature(strokes.current, 1);
    if (!sig) return setError('Trace ta signature dans le cadre avant de l’enregistrer.');
    const next: Signature[] = [...signatures, { ...sig, id: newId(), createdAt: Date.now() }].slice(0, MAX_SIGNATURES);
    await db.setMeta(SIGNATURES_KEY, next);
    strokes.current = [];
    setCount(0);
    setError(null);
  };

  const remove = (id: string) => void db.setMeta(SIGNATURES_KEY, signatures.filter((s) => s.id !== id));

  return (
    <Modal title="Mes signatures" onClose={onClose}>
      <div className="flex flex-col gap-3">
        {signatures.length > 0 && (
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {signatures.map((s) => (
              <li key={s.id} className="sig-item">
                <Thumb sig={s} />
                <button type="button" className="sig-remove" onClick={() => remove(s.id)} aria-label="Supprimer cette signature" title="Supprimer cette signature">
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        {full ? (
          <p className="m-0 text-[13px] text-[color:var(--muted)]">Trois signatures au plus : supprimes-en une pour en tracer une autre.</p>
        ) : (
          <>
            <p className="m-0 text-[13px] text-[color:var(--muted)]">Signe au-dessus de la ligne, comme sur papier (signature complète ou paraphe).</p>
            <canvas
              ref={canvas}
              className="sig-pad"
              style={{ aspectRatio: `${PAD_W} / ${PAD_H}` }}
              onPointerDown={(e) => {
                if (e.pointerType === 'pen') penSeen.current = true;
                else if (e.pointerType === 'touch' && penSeen.current) return; // la paume posée pendant qu'on signe
                if (live.current) return;
                try {
                  e.currentTarget.setPointerCapture(e.pointerId);
                } catch {
                  /* pointeur déjà relâché : le trait commence quand même */
                }
                live.current = { id: e.pointerId, points: [toMm(e)] };
                redraw();
              }}
              onPointerMove={(e) => {
                if (live.current?.id !== e.pointerId) return;
                const list = e.nativeEvent.getCoalescedEvents?.() ?? [];
                for (const ev of list.length ? list : [e.nativeEvent]) {
                  const r = e.currentTarget.getBoundingClientRect();
                  live.current.points.push([((ev.clientX - r.left) / r.width) * PAD_W, ((ev.clientY - r.top) / r.height) * PAD_H, ev.pointerType === 'pen' ? Math.max(0.1, ev.pressure || 0.5) : 0.5]);
                }
                redraw();
              }}
              onPointerUp={(e) => {
                if (live.current?.id !== e.pointerId) return;
                strokes.current.push(live.current.points);
                live.current = null;
                setCount(strokes.current.length);
              }}
              onPointerCancel={() => {
                live.current = null;
                redraw();
              }}
            />
            {error && <p className="m-0 text-[13px] text-red-600 dark:text-red-400">{error}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={!count}
                onClick={() => {
                  strokes.current = [];
                  setCount(0);
                }}
              >
                Effacer
              </button>
              <button type="button" className="primary" disabled={!count} onClick={() => void save()}>
                Enregistrer
              </button>
            </div>
          </>
        )}
        <p className="m-0 text-[12px] leading-snug text-[color:var(--muted)]">
          Gardées uniquement sur cet appareil : jamais envoyées en ligne ni mises dans les sauvegardes. Pour signer une page : Formes &amp; tampons →
          Signatures.
        </p>
      </div>
    </Modal>
  );
}
