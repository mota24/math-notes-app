export type Block =
  | { type: 'heading'; content: string }
  | { type: 'text'; content: string }
  | { type: 'math'; content: string }
  | { type: 'list'; items: string[] }
  | { type: 'sign_table'; content: string }
  | { type: 'figure'; content: string };

const CONTENT_TYPES = new Set(['heading', 'text', 'math', 'sign_table', 'figure']);

/** Valide (souplement) la réponse du modèle. */
export function normalizeBlocks(raw: unknown): Block[] {
  const list = Array.isArray(raw) ? raw : (raw as { blocks?: unknown })?.blocks;
  if (!Array.isArray(list)) throw new Error('Réponse sans « blocks »');
  const out: Block[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const b = item as { type?: unknown; content?: unknown; items?: unknown };
    const type = typeof b.type === 'string' ? b.type : 'text';
    if (type === 'list') {
      const items = Array.isArray(b.items) ? b.items.filter((i): i is string => typeof i === 'string') : [];
      if (items.length) out.push({ type: 'list', items });
      else if (typeof b.content === 'string') out.push({ type: 'text', content: b.content });
      continue;
    }
    if (typeof b.content !== 'string' || !b.content.trim()) continue;
    out.push({ type: (CONTENT_TYPES.has(type) ? type : 'text') as 'text', content: b.content });
  }
  return out;
}

/**
 * Commandes LaTeX qui commencent par une lettre d'échappement JSON valide (\b \f \n \r \t) :
 * mal échappées, « \frac » deviendrait un saut de page suivi de « rac ».
 */
const LATEX_ESCAPE_WORDS =
  /^(?:b(?:eta|ar|egin|inom|oxed|ig|igg|igl|igr|ot|ullet|mod|ackslash|f|m|matrix)|f(?:rac|orall|lat|rown)|n(?:abla|eq|e|i|u|eg|otin|ot|ewline|mid|leq|geq|subseteq|exists|rightarrow|parallel|sim|cong|atural)|r(?:ho|ight|ightarrow|angle|ceil|floor|m|ule)|t(?:imes|heta|au|o|ext|extbf|extit|extrm|frac|an|anh|op|riangle|ilde|herefore|kzTab(?:Init|Line|Var|Val|Ima|Slope|Tan)))(?![a-zA-Z])/;

/** Double les antislashs LaTeX non échappés dans un texte JSON brut. */
export function repairLatexEscapes(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = raw[i + 1] ?? '';
    if (next === '\\' || next === '"' || next === '/') {
      out += ch + next;
      i++;
      continue;
    }
    const rest = raw.slice(i + 1, i + 24);
    if (next === 'u' && /^u[0-9a-fA-F]{4}/.test(rest)) {
      out += ch;
      continue;
    }
    if ('bfnrt'.includes(next) && next !== '' && !LATEX_ESCAPE_WORDS.test(rest)) {
      out += ch; // vrai échappement JSON (\n…)
      continue;
    }
    out += '\\\\'; // \{ \, \alpha \frac… : antislash LaTeX à conserver
  }
  return out;
}

/** Extrait et parse le JSON d'une réponse texte du modèle. */
export function parseModelJson(text: string): Block[] {
  const candidates = [text.trim()];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fenced) candidates.push(fenced[1].trim());
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
  let lastError: unknown;
  for (const c of candidates) {
    for (const variant of [repairLatexEscapes(c), c]) {
      try {
        return normalizeBlocks(JSON.parse(variant));
      } catch (e) {
        lastError = e;
      }
    }
  }
  throw new Error(`JSON illisible : ${(lastError as Error)?.message ?? 'inconnu'}`);
}
