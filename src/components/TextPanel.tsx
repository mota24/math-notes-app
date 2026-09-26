import { useEffect, useMemo, useRef, useState } from 'react';
import type { Page } from '../db/schema';
import { hasBackground } from '../ink/background';
import { onOcrProgress } from '../ocr/engine';
import type { OcrProgress } from '../ocr/engine';
import { knownText, pageText } from '../ocr/pageText';
import type { Highlight } from '../ocr/TextLayer';
import { matchBoxes, pageString, searchPage, snippet } from '../ocr/textModel';
import type { Match, PageText, TextWord } from '../ocr/textModel';

interface Result {
  pageIndex: number;
  pageId: string;
  match: Match;
  snippet: string;
  boxes: { x: number; y: number; w: number; h: number }[];
}

const btn =
  'inline-grid size-8 min-h-0 shrink-0 place-items-center rounded-lg border-0 bg-transparent p-0 text-zinc-300 transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-30';

/**
 * Le panneau « Texte » de l'éditeur : le texte du fond des pages (PDF, scans, photos), à chercher et copier.
 *  - la page à l'écran et ses voisines sont lues d'office ; leurs mots deviennent sélectionnables sur la page ;
 *  - la recherche parcourt tout le cahier, en lisant au passage les pages pas encore lues (une à la fois, en
 *    arrière-plan), et les résultats arrivent au fil de la lecture ;
 *  - « Copier le texte de la page » met tout le texte de la page dans le presse-papiers.
 * Toujours sombre, comme le volet de l'écran partagé.
 */
export function TextPanel({
  pages,
  currentIndex,
  autoFocus,
  onTextLayer,
  onHighlights,
  onReveal,
  onClose,
}: {
  pages: readonly Page[];
  currentIndex: number;
  autoFocus: boolean;
  /** Rappels stables (setters d'état du parent) : null quand il n'y a rien à poser */
  onTextLayer(layer: ReadonlyMap<string, readonly TextWord[]> | null): void;
  onHighlights(h: readonly Highlight[] | null): void;
  /** Aller à une occurrence : page, et hauteur dans la page (fraction) */
  onReveal(pageIndex: number, y: number): void;
  onClose(): void;
}) {
  const [texts, setTexts] = useState<ReadonlyMap<string, PageText | null>>(() => new Map());
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [scan, setScan] = useState<{ done: number; total: number } | null>(null);
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => onOcrProgress(setProgress), []);
  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);

  const remember = (p: Page, t: PageText | null) => setTexts((m) => (m.get(p.id) === t ? m : new Map(m).set(p.id, t)));
  const fail = (p: Page, e: unknown) => setErrors((m) => new Map(m).set(p.id, (e as Error)?.message ?? 'Lecture impossible.'));

  // La page à l'écran d'abord, puis ses voisines : on les lit sans attendre qu'on le demande
  useEffect(() => {
    let alive = true;
    const around = [currentIndex, currentIndex + 1, currentIndex - 1].map((i) => pages[i]).filter((p): p is Page => !!p && hasBackground(p));
    void (async () => {
      for (const p of around) {
        const known = knownText(p);
        if (known !== undefined) {
          remember(p, known);
          continue;
        }
        try {
          const t = await pageText(p);
          if (alive) remember(p, t);
        } catch (e) {
          if (alive) fail(p, e);
        }
      }
    })();
    return () => {
      alive = false;
    };
    // pages : relu quand le cahier change (import d'un PDF), pas à chaque trait
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, pages.length]);

  // La couche de texte suit ce qui est lu
  useEffect(() => {
    const layer = new Map<string, readonly TextWord[]>();
    for (const [id, t] of texts) if (t?.words.length) layer.set(id, t.words);
    onTextLayer(layer.size ? layer : null);
  }, [texts, onTextLayer]);

  // Recherche dans tout le cahier, les pages pas encore lues le sont au passage
  useEffect(() => {
    const q = query.trim();
    setResults([]);
    setActive(0);
    if (!q) {
      setScan(null);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      const readable = pages.map((p, i) => [p, i] as const).filter(([p]) => hasBackground(p));
      setScan({ done: 0, total: readable.length });
      void (async () => {
        let done = 0;
        for (const [p, i] of readable) {
          let t = knownText(p);
          if (t === undefined) {
            try {
              t = await pageText(p);
            } catch (e) {
              if (alive) fail(p, e);
              t = null;
            }
          }
          if (!alive) return;
          remember(p, t ?? null);
          done++;
          setScan({ done, total: readable.length });
          if (!t) continue;
          const words = t.words;
          const found = searchPage(words, q).map((match) => ({ pageIndex: i, pageId: p.id, match, snippet: snippet(words, match), boxes: matchBoxes(words, match) }));
          if (found.length) setResults((r) => [...r, ...found]);
        }
      })();
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, pages.length]);

  // Surlignage de toutes les occurrences, la courante en orange
  useEffect(() => {
    const marks = results.flatMap((r, i) => r.boxes.map((b) => ({ pageId: r.pageId, ...b, active: i === active })));
    onHighlights(marks.length ? marks : null);
  }, [results, active, onHighlights]);

  // On quitte le panneau : plus de couche ni de surlignage
  useEffect(
    () => () => {
      onTextLayer(null);
      onHighlights(null);
    },
    [onTextLayer, onHighlights],
  );

  const go = (i: number) => {
    const r = results[i];
    if (!r) return;
    setActive(i);
    onReveal(r.pageIndex, r.boxes[0]?.y ?? 0);
  };

  const current = pages[currentIndex];
  const currentText = current ? texts.get(current.id) : undefined;
  const currentError = current ? errors.get(current.id) : undefined;
  const reading = progress && progress.progress < 1;
  const scanning = scan && scan.done < scan.total;
  const status = useMemo(() => {
    if (!current) return '';
    if (!hasBackground(current)) return 'Cette page n’a pas de PDF ni de photo à lire.';
    if (currentError) return currentError;
    if (currentText === undefined) return reading ? `${progress.status} ${Math.round(progress.progress * 100)} %` : 'Lecture de la page…';
    if (!currentText || currentText.words.length === 0) return 'Aucun texte trouvé sur cette page.';
    return currentText.source === 'pdf'
      ? `Texte du PDF · ${currentText.words.length} mots`
      : `Texte lu sur le scan · ${currentText.words.length} mots`;
  }, [current, currentText, currentError, reading, progress]);

  const copyPage = async () => {
    if (!currentText?.words.length) return;
    await navigator.clipboard.writeText(pageString(currentText.words));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <aside className="text-panel [color-scheme:dark]" aria-label="Texte du document">
      <header className="flex items-center gap-2 px-3 pb-2 pt-3">
        <h2 className="m-0 min-w-0 flex-1 truncate text-[14px] font-semibold text-zinc-100">Texte du document</h2>
        <button type="button" className={btn} onClick={onClose} aria-label="Fermer le panneau Texte" title="Fermer (reprendre l’outil d’avant)">
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </header>

      <div className="px-3">
        <label className="flex h-10 items-center gap-2 rounded-xl border border-white/[0.1] bg-white/[0.05] px-3 focus-within:border-accent/60">
          <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-zinc-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') go(e.shiftKey ? (active - 1 + results.length) % Math.max(1, results.length) : (active + 1) % Math.max(1, results.length));
              if (e.key === 'Escape') onClose();
            }}
            placeholder="Rechercher dans le cahier…"
            aria-label="Rechercher dans le texte du cahier"
            autoComplete="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            data-bwignore
            className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-[14px] text-zinc-100 outline-none placeholder:text-zinc-500"
          />
        </label>
        {query.trim() && (
          <div className="mt-2 flex items-center gap-1 text-[12.5px] text-zinc-400">
            <span className="min-w-0 flex-1 truncate">
              {results.length ? `${active + 1} / ${results.length} résultat${results.length > 1 ? 's' : ''}` : scanning ? 'Recherche…' : 'Aucun résultat'}
              {scanning && ` · lecture ${scan.done}/${scan.total} pages`}
            </span>
            <button type="button" className={btn} disabled={!results.length} onClick={() => go((active - 1 + results.length) % results.length)} aria-label="Résultat précédent">
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="m6 15 6-6 6 6" />
              </svg>
            </button>
            <button type="button" className={btn} disabled={!results.length} onClick={() => go((active + 1) % results.length)} aria-label="Résultat suivant">
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {results.length > 0 && (
        <ul className="m-0 mt-2 max-h-[38vh] list-none overflow-y-auto overscroll-contain px-1.5 py-0">
          {results.map((r, i) => (
            <li key={`${r.pageId}-${r.match.from}-${i}`}>
              <button
                type="button"
                onClick={() => go(i)}
                aria-current={i === active}
                className={`flex w-full min-h-0 flex-col items-start gap-0.5 rounded-lg border-0 px-2.5 py-2 text-left transition-colors ${i === active ? 'bg-accent/15' : 'bg-transparent hover:bg-white/[0.05]'}`}
              >
                <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Page {r.pageIndex + 1}</span>
                <span className="line-clamp-2 text-[13px] leading-snug text-zinc-200">{r.snippet}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 border-t border-white/[0.06] px-3 py-3">
        <p className="m-0 text-[12.5px] text-zinc-400">
          <span className="font-semibold text-zinc-300">Page {currentIndex + 1} · </span>
          {status}
        </p>
        {reading && currentText === undefined && (
          <span className="mt-2 block h-1 overflow-hidden rounded-full bg-white/[0.08]">
            <span className="block h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round((progress?.progress ?? 0) * 100)}%` }} />
          </span>
        )}
        <button
          type="button"
          onClick={() => void copyPage()}
          disabled={!currentText?.words.length}
          className="mt-3 flex h-10 w-full min-h-0 items-center justify-center gap-2 rounded-xl border border-white/[0.1] bg-white/[0.05] px-3 py-0 text-[13px] font-medium text-zinc-100 transition-colors hover:bg-white/[0.1] disabled:opacity-40"
        >
          {copied ? 'Texte copié ✓' : 'Copier le texte de la page'}
        </button>
        <p className="m-0 mt-2 text-[12px] leading-snug text-zinc-500">
          Sur la page : appui long sur un mot (ou glisser à la souris) pour sélectionner, puis « Copier ». Un glissé rapide fait défiler.
        </p>
      </div>
    </aside>
  );
}
