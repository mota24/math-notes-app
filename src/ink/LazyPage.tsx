import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { onImageReady } from './draw';
import { renderPage } from './renderPage';
import type { RenderablePage } from './renderPage';
import type { PaperColor } from './types';

export interface LoadedPage {
  page: RenderablePage;
  /** Le fond (PDF, photo) à la définition demandée, en px par mm ; null = papier réglé */
  background: ((pxPerMm: number) => Promise<CanvasImageSource | null>) | null;
}

/**
 * Une page en lecture seule qui ne se charge et ne se dessine qu'à l'approche de l'écran, et rend sa mémoire
 * en s'éloignant (un fond de PDF décodé pèse ~10 Mo : un cours de 70 pages entier ferait tomber la
 * tablette). Sert au lecteur de lien partagé et à l'écran partagé de l'éditeur.
 */
export function LazyPage({
  size,
  cssWidth,
  load,
  number,
  defaultPaperColor = 'light',
}: {
  /** [largeur, hauteur] en mm, pour réserver la place avant le chargement */
  size: [number, number];
  cssWidth: number;
  load(): Promise<LoadedPage>;
  number?: number;
  defaultPaperColor?: PaperColor;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const [near, setNear] = useState(false);
  const [data, setData] = useState<LoadedPage | null>(null);
  const [failed, setFailed] = useState(false);
  const [bg, setBg] = useState<CanvasImageSource | null>(null);
  const [imagesTick, setImagesTick] = useState(0);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { rootMargin: '1200px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!near || data) return;
    let alive = true;
    loadRef
      .current()
      .then((d) => alive && setData(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [near, data]);

  // Définition du fond : arrondie au demi-pixel par mm, pour ne pas le refaire à chaque cran de zoom
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const pxPerMm = Math.min(8, Math.max(1, Math.ceil(((cssWidth / size[0]) * dpr) * 2) / 2));
  useEffect(() => {
    if (!near || !data?.background) {
      setBg(null);
      return;
    }
    let alive = true;
    data
      .background(pxPerMm)
      .then((b) => alive && setBg(b))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [near, data, pxPerMm]);

  useEffect(() => onImageReady(() => setImagesTick((t) => t + 1)), []);

  const ready = near && !!data && (!data.background || !!bg);
  useLayoutEffect(() => {
    const c = canvas.current;
    if (!c) return;
    if (!ready || !data) {
      c.width = 0; // mémoire rendue
      c.height = 0;
      return;
    }
    renderPage(c, data.page, bg, cssWidth, defaultPaperColor);
  }, [ready, data, bg, cssWidth, defaultPaperColor, imagesTick]);

  const cssHeight = (size[1] * cssWidth) / size[0];
  return (
    <div ref={holder} className="relative mx-auto shrink-0" style={{ width: cssWidth, height: cssHeight }}>
      <canvas ref={canvas} className="block rounded-[3px] shadow-[0_1px_3px_rgba(0,0,0,0.4),0_10px_30px_-12px_rgba(0,0,0,0.6)]" />
      {!ready && (
        <div className="absolute inset-0 grid place-items-center rounded-[3px] bg-white/[0.04] text-[12px] text-zinc-500">
          {failed ? 'Page indisponible' : 'Chargement…'}
        </div>
      )}
      {number !== undefined && (
        <span className="pointer-events-none absolute bottom-1.5 right-2 rounded bg-black/40 px-1.5 text-[10px] tabular-nums text-white/70">{number}</span>
      )}
    </div>
  );
}
