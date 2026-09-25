import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { db, useQuery } from '../db/db';
import type { Notebook } from '../db/schema';
import { coverUrl } from '../pdf/cover';
import { Icon } from './LibraryIcons';
import { coverGradient, coverKey, coverSource, paperPreview } from './libraryModel';

/** Vrai dès que l'élément approche de l'écran, et ensuite pour de bon : les couvertures hors de vue attendent. */
function useSeen(ref: RefObject<Element | null>): boolean {
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (seen || !el) return;
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setSeen(true), { rootMargin: '300px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, seen]);
  return seen;
}

/**
 * Le haut de la carte d'un cahier :
 *  - un PDF (ou une photo) en fond de la première page : sa miniature, le haut de la page visible ;
 *  - un papier à lignes ou à carreaux : ce papier, en miniature ;
 *  - rien à montrer (papier blanc, PDF pas encore rendu ou pas encore arrivé sur l'appareil) : un dégradé
 *    discret tiré de la couleur du cahier, avec son pictogramme — plus jamais un rectangle noir vide.
 * Il s'efface vers le bas, comme une page qui dépasse de la carte.
 */
export function NotebookCover({ notebook }: { notebook: Notebook }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useSeen(ref);
  const first = notebook.pageIds[0];
  // `undefined` tant que la carte n'a pas approché de l'écran. Relu quand un fichier arrive (synchronisation) :
  // un PDF absent au premier affichage prend sa miniature dès qu'il est là.
  const source = useQuery(
    async () => (!seen ? undefined : first ? coverSource(await db.getPage(first)) : null),
    [seen, first, notebook.updatedAt],
    ['files'],
  );
  const [image, setImage] = useState<{ key: string; url: string } | null>(null);

  useEffect(() => {
    if (!source) return;
    let alive = true;
    void coverUrl(source).then((url) => {
      if (alive && url) setImage({ key: coverKey(source), url });
    });
    return () => {
      alive = false;
    };
  }, [source]);

  const url = source && image?.key === coverKey(source) ? image.url : null;
  const paper = !source && notebook.paper !== 'blank';
  const tint = notebook.color;

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="relative mx-2.5 mt-2.5 h-24 shrink-0 overflow-hidden rounded-[10px] border border-white/[0.06] [-webkit-mask-image:linear-gradient(to_bottom,#000_60%,transparent)] [mask-image:linear-gradient(to_bottom,#000_60%,transparent)]"
      style={paper ? undefined : { background: coverGradient(tint) }}
    >
      {paper ? (
        <div className="absolute inset-0 brightness-[0.88]" style={paperPreview(notebook.paper, notebook.paperColor)} />
      ) : url ? (
        <img src={url} alt="" draggable={false} className="absolute inset-0 size-full animate-fade object-cover object-top brightness-[0.92]" />
      ) : (
        source !== undefined && (
          <>
            <span
              className="absolute left-1/2 top-3.5 grid size-11 -translate-x-1/2 place-items-center rounded-xl border"
              style={{
                color: `color-mix(in srgb, ${tint} 55%, #ffffff)`,
                borderColor: `color-mix(in srgb, ${tint} 45%, transparent)`,
                background: `color-mix(in srgb, ${tint} 16%, transparent)`,
              }}
            >
              <Icon name={source ? 'fileText' : 'book'} className="size-5" />
            </span>
            {source?.kind === 'pdf' && <span className="absolute right-3 top-2.5 text-[10px] font-semibold tracking-[0.16em] text-white/40">PDF</span>}
          </>
        )
      )}
    </div>
  );
}
