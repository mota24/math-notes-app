import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { renderRichText } from './math';
import { interpretVar, parseTkzTab } from './tkztab';
import type { TkzTab, VPos } from './tkztab';

const LABEL_W = 96;
const COL_W = 92;
const EDGE = 38;
const UNIT_H = 30;

interface Item {
  key: string;
  x: number;
  y: number;
  align: 'center' | 'left' | 'right';
  tex: string;
}

interface Arrow {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function SignTable({ source }: { source: string }) {
  const parsed = useMemo(() => {
    try {
      return { tab: parseTkzTab(source) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [source]);
  if ('error' in parsed) {
    return (
      <div className="sign-table-error">
        <p>Tableau non lisible ({parsed.error}). Code reçu :</p>
        <pre>{source}</pre>
      </div>
    );
  }
  return <SignTableView tab={parsed.tab} />;
}

function layoutTable(tab: TkzTab, hatchId: string) {
  const n = tab.xValues.length;
  const X = (i: number) => LABEL_W + EDGE + i * COL_W;
  const width = X(n - 1) + EDGE;
  const items: Item[] = [];
  const svg: ReactNode[] = [];
  const arrowPairs: [string, string][] = [];
  const vline = (key: string, x: number, top: number, h: number, dashed = false) =>
    svg.push(<line key={key} x1={x} y1={top} x2={x} y2={top + h} stroke="currentColor" strokeDasharray={dashed ? '3 3' : undefined} />);
  const hatch = (key: string, x1: number, x2: number, top: number, h: number) =>
    svg.push(<rect key={key} x={x1} y={top} width={x2 - x1} height={h} fill={`url(#${hatchId})`} />);

  const xh = tab.xHeight * UNIT_H;
  items.push({ key: 'lx', x: LABEL_W / 2, y: xh / 2, align: 'center', tex: tab.xLabel });
  tab.xValues.forEach((v, i) => items.push({ key: `x${i}`, x: X(i), y: xh / 2, align: 'center', tex: v }));

  let top = xh;
  tab.rows.forEach((row, r) => {
    const h = row.height * UNIT_H;
    svg.push(<line key={`sep${r}`} x1={0} y1={top} x2={width} y2={top} stroke="currentColor" />);
    items.push({ key: `l${r}`, x: LABEL_W / 2, y: top + h / 2, align: 'center', tex: row.label });

    if (row.kind === 'line') {
      row.entries.forEach((raw, k) => {
        const e = raw.trim();
        if (!e) return;
        const mid = top + h / 2;
        if (k % 2 === 0) {
          const x = X(k / 2);
          if (e === 'z' || e === 't') vline(`d${r}-${k}`, x, top, h, true);
          if (e === 'd') {
            vline(`d${r}-${k}a`, x - 1.5, top, h);
            vline(`d${r}-${k}b`, x + 1.5, top, h);
          }
          if (e === 'z') items.push({ key: `z${r}-${k}`, x, y: mid, align: 'center', tex: '$0$' });
          else if (!['t', 'd', 'h'].includes(e)) items.push({ key: `z${r}-${k}`, x, y: mid, align: 'center', tex: e });
        } else {
          const i = (k - 1) / 2;
          if (e === 'h') hatch(`h${r}-${k}`, X(i), X(i + 1), top, h);
          else {
            const tex = e === '+' || e === '-' ? `$${e}$` : e;
            items.push({ key: `s${r}-${k}`, x: (X(i) + X(i + 1)) / 2, y: mid, align: 'center', tex });
          }
        }
      });
    } else if (row.kind === 'var') {
      const rowTop = top;
      const yOf = (pos: VPos) => (pos === 'top' ? rowTop + 14 : pos === 'bottom' ? rowTop + h - 14 : rowTop + h / 2);
      const infos = row.nodes.map(interpretVar);
      infos.forEach((info, i) => {
        const x = X(i);
        if (info.double) {
          vline(`v${r}-${i}a`, x - 1.5, rowTop, h);
          vline(`v${r}-${i}b`, x + 1.5, rowTop, h);
        }
        if (info.hatchAfter && i < n - 1) hatch(`vh${r}-${i}`, x + (info.double ? 2 : 0), X(i + 1), rowTop, h);
        if (info.single) items.push({ key: `v${r}-${i}`, x, y: yOf(info.single.pos), align: 'center', tex: info.single.value });
        if (info.left) items.push({ key: `v${r}-${i}-l`, x: x - 5, y: yOf(info.left.pos), align: 'right', tex: info.left.value });
        if (info.right) items.push({ key: `v${r}-${i}-r`, x: x + 5, y: yOf(info.right.pos), align: 'left', tex: info.right.value });
      });
      let prev: { key: string; i: number } | null = null;
      infos.forEach((info, i) => {
        if (info.skip) return;
        const inKey = info.single ? `v${r}-${i}` : info.left ? `v${r}-${i}-l` : null;
        const outKey = info.single ? `v${r}-${i}` : info.right ? `v${r}-${i}-r` : null;
        if (prev && inKey && !infos.slice(prev.i, i).some((x) => x.hatchAfter)) arrowPairs.push([prev.key, inKey]);
        prev = outKey ? { key: outKey, i } : null;
      });
    }
    top += h;
  });

  return { width, height: top, items, svg, arrowPairs };
}

function SignTableView({ tab }: { tab: TkzTab }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const markerId = `arrow-${uid}`;
  const hatchId = `hatch-${uid}`;
  const layout = useMemo(() => layoutTable(tab, hatchId), [tab, hatchId]);
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLElement>());
  const [arrows, setArrows] = useState<Arrow[]>([]);

  const measure = useCallback(() => {
    const container = containerRef.current;
    const box = container?.getBoundingClientRect();
    if (!container || !box) return;
    // Les mesures incluent un éventuel zoom (export manuscrit) : on revient à l'échelle du SVG
    const k = box.width / (container.offsetWidth || box.width) || 1;
    const next = layout.arrowPairs.flatMap(([a, b]) => {
      const ea = itemRefs.current.get(a);
      const eb = itemRefs.current.get(b);
      if (!ea || !eb) return [];
      const ra = ea.getBoundingClientRect();
      const rb = eb.getBoundingClientRect();
      const x1 = (ra.right - box.left) / k + 3;
      const x2 = (rb.left - box.left) / k - 3;
      if (x2 - x1 < 8) return [];
      return [{ x1, y1: (ra.top + ra.height / 2 - box.top) / k, x2, y2: (rb.top + rb.height / 2 - box.top) / k }];
    });
    setArrows((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [layout]);

  useLayoutEffect(() => {
    measure();
    // Les polices KaTeX arrivent après le premier rendu : on remesure
    document.fonts?.ready.then(measure);
    const timer = window.setTimeout(measure, 400);
    return () => window.clearTimeout(timer);
  }, [measure]);

  return (
    <div className="sign-table-scroll">
      <div className="sign-table" ref={containerRef} style={{ width: layout.width, height: layout.height }}>
        <svg width={layout.width} height={layout.height} aria-hidden="true">
          <defs>
            <marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
            </marker>
            <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" strokeWidth="1" />
            </pattern>
          </defs>
          <rect x="0.5" y="0.5" width={layout.width - 1} height={layout.height - 1} fill="none" stroke="currentColor" />
          <line x1={LABEL_W} y1={0} x2={LABEL_W} y2={layout.height} stroke="currentColor" />
          {layout.svg}
          {arrows.map((a, i) => (
            <line key={i} x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke="currentColor" strokeWidth="1.2" markerEnd={`url(#${markerId})`} />
          ))}
        </svg>
        {layout.items.map((it) => (
          <span
            key={it.key}
            ref={(el) => {
              if (el) itemRefs.current.set(it.key, el);
              else itemRefs.current.delete(it.key);
            }}
            className={`st-item st-${it.align}`}
            style={{ left: it.x, top: it.y }}
            dangerouslySetInnerHTML={{ __html: renderRichText(it.tex) }}
          />
        ))}
      </div>
    </div>
  );
}
