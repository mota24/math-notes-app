/** Lecture d'un sous-ensemble de tkz-tab : \tkzTabInit, \tkzTabLine, \tkzTabVar. */

export interface VarNode {
  code: string;
  values: string[];
}

export type TabRow =
  | { kind: 'line'; label: string; height: number; entries: string[] }
  | { kind: 'var'; label: string; height: number; nodes: VarNode[] }
  | { kind: 'empty'; label: string; height: number };

export interface TkzTab {
  xLabel: string;
  xHeight: number;
  xValues: string[];
  rows: TabRow[];
}

export type VPos = 'top' | 'bottom' | 'mid';

export interface VarInfo {
  skip: boolean;
  double: boolean;
  hatchAfter: boolean;
  single?: { pos: VPos; value: string };
  left?: { pos: VPos; value: string };
  right?: { pos: VPos; value: string };
}

function readGroup(src: string, start: number, open = '{', close = '}') {
  let i = start;
  while (i < src.length && /\s/.test(src[i])) i++;
  if (src[i] !== open) return null;
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (ch === '\\') {
      j++;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close && --depth === 0) return { content: src.slice(i + 1, j), end: j + 1 };
  }
  return null;
}

/** Découpe au niveau supérieur (hors accolades et hors $...$). */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let math = false;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\') {
      cur += ch + (s[i + 1] ?? '');
      i++;
      continue;
    }
    if (ch === '$') math = !math;
    else if (!math && ch === '{') depth++;
    else if (!math && ch === '}') depth--;
    if (ch === sep && depth === 0 && !math) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const ARG_COUNT: Record<string, number> = {
  tkzTabInit: 2,
  tkzTabLine: 1,
  tkzTabVar: 1,
  tkzTabVal: 5,
  tkzTabIma: 4,
  tkzTabSlope: 1,
  tkzTabTan: 5,
};

export function parseTkzTab(src: string): TkzTab {
  const clean = src.replace(/(^|[^\\])%.*$/gm, '$1');
  const cmdRe = /\\(tkzTabInit|tkzTabLine|tkzTabVar|tkzTabVal|tkzTabIma|tkzTabSlope|tkzTabTan)(?![a-zA-Z])/g;
  let init: string[] | null = null;
  const rowSources: { kind: 'line' | 'var'; content: string }[] = [];

  for (let m = cmdRe.exec(clean); m; m = cmdRe.exec(clean)) {
    let i = m.index + m[0].length;
    const opt = readGroup(clean, i, '[', ']');
    if (opt) i = opt.end;
    const args: string[] = [];
    for (let k = 0; k < ARG_COUNT[m[1]]; k++) {
      const g = readGroup(clean, i);
      if (!g) break;
      args.push(g.content);
      i = g.end;
    }
    cmdRe.lastIndex = i;
    if (m[1] === 'tkzTabInit' && args.length === 2) init = args;
    else if (m[1] === 'tkzTabLine' && args.length === 1) rowSources.push({ kind: 'line', content: args[0] });
    else if (m[1] === 'tkzTabVar' && args.length === 1) rowSources.push({ kind: 'var', content: args[0] });
  }
  if (!init) throw new Error('\\tkzTabInit manquant');

  const labels = splitTop(init[0], ',')
    .filter(Boolean)
    .map((part) => {
      const [label, h] = splitTop(part, '/');
      const height = Number.parseFloat(h ?? '');
      return { label, height: Number.isFinite(height) && height > 0 ? height : 1 };
    });
  const xValues = splitTop(init[1], ',');
  if (xValues[xValues.length - 1] === '') xValues.pop();
  if (labels.length === 0 || xValues.length < 2) throw new Error('tableau incomplet');
  const n = xValues.length;

  const rows: TabRow[] = labels.slice(1).map((lab, idx): TabRow => {
    const r = rowSources[idx];
    if (!r) return { kind: 'empty', ...lab };
    if (r.kind === 'line') {
      const entries = splitTop(r.content, ',');
      while (entries.length < 2 * n - 1) entries.push('');
      return { kind: 'line', ...lab, entries: entries.slice(0, 2 * n - 1) };
    }
    const parts = splitTop(r.content, ',');
    if (parts.length > n && parts[parts.length - 1] === '') parts.pop();
    const nodes = parts.slice(0, n).map((p) => {
      const [code, ...values] = splitTop(p, '/');
      return { code, values };
    });
    while (nodes.length < n) nodes.push({ code: 'R', values: [] });
    return { kind: 'var', ...lab, nodes };
  });

  return { xLabel: labels[0].label, xHeight: labels[0].height, xValues, rows };
}

export function interpretVar(node: VarNode): VarInfo {
  let code = node.code.replace(/\s+/g, '').replace(/C/g, '');
  const hatchAfter = code.endsWith('H');
  if (hatchAfter) code = code.slice(0, -1);
  const pos = (c: string): VPos => (c === '+' ? 'top' : c === '-' ? 'bottom' : 'mid');
  if (code === 'R' || code === '') return { skip: true, double: false, hatchAfter };
  const d = code.indexOf('D');
  if (d >= 0) {
    const l = code.slice(0, d);
    const r = code.slice(d + 1);
    let k = 0;
    const left = l ? { pos: pos(l), value: node.values[k++] ?? '' } : undefined;
    const right = r ? { pos: pos(r), value: node.values[k++] ?? '' } : undefined;
    return { skip: false, double: true, hatchAfter, left, right };
  }
  return { skip: false, double: false, hatchAfter, single: { pos: pos(code), value: node.values[0] ?? '' } };
}
