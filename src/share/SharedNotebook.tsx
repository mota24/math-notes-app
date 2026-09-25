import { useEffect, useRef, useState } from 'react';
import type { Firestore } from 'firebase/firestore';
import { getFirestoreDb } from '../firebase';
import { LazyPage } from '../ink/LazyPage';
import type { LoadedPage } from '../ink/LazyPage';
import type { ShareDoc, SharedPage } from './plan';

/**
 * Lecteur public d'un cahier partagé : /share/<id>. Aucun compte, aucune base locale, aucune écriture :
 * il ne fait que LIRE shares/<id> dans Firestore (voir firestore.rules). Les pages se chargent au fil du
 * défilement ; une page qui sort de l'écran rend sa mémoire (un fond de PDF décodé pèse ~10 Mo).
 */

/** Une page du partage (et son fond), lue une seule fois même si elle sort puis revient à l'écran */
const cache = new Map<string, Promise<{ page: SharedPage; bg: string | null }>>();

function fetchPage(firestore: Firestore, shareId: string, pageId: string) {
  let p = cache.get(pageId);
  if (!p) {
    p = (async () => {
      const { doc, getDoc } = await import('firebase/firestore');
      const snap = await getDoc(doc(firestore, 'shares', shareId, 'pages', pageId));
      if (!snap.exists()) throw new Error('Page introuvable');
      const page = JSON.parse((snap.data() as { json: string }).json) as SharedPage;
      let bg: string | null = null;
      if (page.bg) {
        const bgSnap = await getDoc(doc(firestore, 'shares', shareId, 'bgs', pageId));
        bg = bgSnap.exists() ? (bgSnap.data() as { data: string }).data : null;
      }
      return { page, bg };
    })();
    cache.set(pageId, p);
    p.catch(() => cache.delete(pageId));
  }
  return p;
}

/** La page pour LazyPage : le fond (un JPEG) n'est décodé que lorsqu'elle approche de l'écran */
async function loadShared(firestore: Firestore, shareId: string, pageId: string): Promise<LoadedPage> {
  const { page, bg } = await fetchPage(firestore, shareId, pageId);
  return {
    page,
    background: bg
      ? async () => {
          const img = new Image();
          img.src = bg;
          await img.decode();
          return img;
        }
      : null,
  };
}

const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, 3];

export default function SharedNotebook({ shareId }: { shareId: string }) {
  const [firestore, setFirestore] = useState<Firestore | null>(null);
  const [share, setShare] = useState<ShareDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(() => window.innerWidth);

  useEffect(() => {
    document.title = 'Cahier partagé · Notes Maths';
    let alive = true;
    (async () => {
      const fs = await getFirestoreDb();
      const { doc, getDoc } = await import('firebase/firestore');
      const snap = await getDoc(doc(fs, 'shares', shareId));
      if (!alive) return;
      if (!snap.exists()) {
        setError('Ce lien n’existe pas, ou son auteur l’a désactivé.');
        return;
      }
      const data = snap.data() as ShareDoc;
      setFirestore(fs);
      setShare(data);
      document.title = `${data.title} · Notes Maths`;
    })().catch((e: { code?: string }) => {
      if (!alive) return;
      setError(
        /permission-denied/.test(e?.code ?? '')
          ? 'Ce lien n’est pas (ou plus) accessible.'
          : /unavailable/.test(e?.code ?? '')
            ? 'Pas de connexion : impossible de charger le cahier.'
            : 'Impossible de charger ce cahier.',
      );
    });
    return () => {
      alive = false;
    };
  }, [shareId]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [share]);

  // Pincer pour zoomer (la page entière ne zoome pas : l'appli bloque le zoom du navigateur)
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let start: { dist: number; zoom: number } | null = null;
    const dist = (e: TouchEvent) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) start = { dist: dist(e), zoom };
    };
    const onMove = (e: TouchEvent) => {
      if (!start || e.touches.length !== 2) return;
      e.preventDefault();
      setZoom(Math.min(3, Math.max(0.5, start.zoom * (dist(e) / start.dist))));
    };
    const onEnd = () => (start = null);
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
    };
  }, [zoom, share]);

  const step = (dir: 1 | -1) => {
    const i = ZOOMS.findIndex((z) => z >= zoom - 0.001);
    const next = ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (i < 0 ? ZOOMS.length - 1 : i) + dir))];
    setZoom(next);
  };

  const baseWidth = Math.min(860, Math.max(280, width - 32));
  const cssWidth = Math.round(baseWidth * zoom);
  const btn =
    'inline-flex size-8 min-h-0 items-center justify-center rounded-md border-0 bg-transparent p-0 text-zinc-400 transition-colors hover:bg-white/[0.07] hover:text-white disabled:opacity-30';

  return (
    <div className="fixed inset-0 flex flex-col bg-[#0e0f11] text-zinc-100">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-white/[0.06] bg-[#141518] px-3 sm:px-4">
        <img src="/icon.svg" alt="" width={20} height={20} className="size-5 shrink-0 rounded" />
        <div className="min-w-0 flex-1">
          <h1 className="m-0 truncate text-[14px] font-semibold leading-tight">{share?.title ?? 'Cahier partagé'}</h1>
          <p className="m-0 truncate text-[11px] leading-tight text-zinc-500">
            {share ? `${share.pageIds.length} page${share.pageIds.length > 1 ? 's' : ''} · ` : ''}lecture seule
          </p>
        </div>
        {share && (
          <div className="flex items-center gap-0.5 rounded-lg border border-white/[0.06] bg-white/[0.03] p-0.5">
            <button type="button" className={btn} onClick={() => step(-1)} disabled={zoom <= ZOOMS[0]} aria-label="Dézoomer">
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M5 12h14" />
              </svg>
            </button>
            <button type="button" className={`${btn} w-12 text-[12px] tabular-nums`} onClick={() => setZoom(1)} title="Taille normale">
              {Math.round(zoom * 100)}%
            </button>
            <button type="button" className={btn} onClick={() => step(1)} disabled={zoom >= ZOOMS[ZOOMS.length - 1]} aria-label="Zoomer">
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>
        )}
      </header>

      <div ref={scroller} className="min-h-0 flex-1 overflow-auto overscroll-contain">
        {error ? (
          <div className="grid h-full place-items-center px-6 text-center">
            <div>
              <p className="m-0 text-[15px] font-semibold text-zinc-200">{error}</p>
              <p className="m-0 mt-2 text-[13px] text-zinc-500">Demande un nouveau lien à la personne qui te l’a envoyé.</p>
            </div>
          </div>
        ) : !share || !firestore ? (
          <div className="grid h-full place-items-center text-[13px] text-zinc-500">Chargement du cahier…</div>
        ) : (
          <div className="flex w-max min-w-full flex-col items-center gap-5 px-4 py-6">
            {share.pageIds.map((id, i) => (
              <LazyPage
                key={id}
                load={() => loadShared(firestore, shareId, id)}
                size={share.sizes[id] ?? [210, 297]}
                cssWidth={cssWidth}
                number={i + 1}
              />
            ))}
            <p className="m-0 pb-4 pt-2 text-[11px] text-zinc-600">Partagé avec Notes Maths · lecture seule</p>
          </div>
        )}
      </div>
    </div>
  );
}
