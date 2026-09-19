import type { Block } from './blocks';

/**
 * Format texte modifiable d'une transcription :
 *
 *   # Titre
 *   Paragraphe avec $x^2$ et [?passage douteux?].
 *
 *   $$
 *   f'(x) = 2x
 *   $$
 *
 *   - élément de liste
 *
 *   ```tableau
 *   \tkzTabInit{...}{...}
 *   ```
 *
 *   [figure] description du dessin
 */

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim();

export function blocksToText(blocks: Block[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case 'heading':
          return `# ${oneLine(b.content)}`;
        case 'text':
          return b.content.trim();
        case 'math':
          return `$$\n${b.content.trim()}\n$$`;
        case 'list':
          return b.items.map((item) => `- ${oneLine(item)}`).join('\n');
        case 'sign_table':
          return '```tableau\n' + b.content.trim() + '\n```';
        case 'figure':
          return `[figure] ${oneLine(b.content)}`;
      }
    })
    .join('\n\n');
}

/**
 * Texte collé depuis ChatGPT, Claude, un site… : \( \) et \[ \] deviennent $ et $$,
 * les titres ## deviennent #, les listes numérotées deviennent des listes.
 */
export function normalizePasted(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\\\[([\s\S]*?)\\\]/g, (_m, math: string) => `\n$$\n${math.trim()}\n$$\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_m, math: string) => `$${math.trim()}$`)
    .replace(/^#{2,6}\s+/gm, '# ')
    .replace(/^\s*\d+[.)]\s+/gm, '- ')
    .replace(/^\s*(?:---+|\*\*\*+)\s*$/gm, '');
}

export function textToBlocks(text: string): Block[] {
  const lines = normalizePasted(text).split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: 'text', content: paragraph.join(' ') });
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ type: 'list', items: list });
    list = [];
  };
  const flush = () => {
    flushParagraph();
    flushList();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      flush();
      continue;
    }
    if (line.startsWith('```')) {
      flush();
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith('```'); i++) body.push(lines[i]);
      blocks.push({ type: 'sign_table', content: body.join('\n').trim() });
      continue;
    }
    if (line.startsWith('$$')) {
      flush();
      const rest = line.slice(2).trim();
      if (rest.length >= 2 && rest.endsWith('$$')) {
        blocks.push({ type: 'math', content: rest.slice(0, -2).trim() });
        continue;
      }
      const body: string[] = rest ? [rest] : [];
      for (i++; i < lines.length && !lines[i].trim().endsWith('$$'); i++) body.push(lines[i]);
      if (i < lines.length) {
        const last = lines[i].trim().slice(0, -2).trim();
        if (last) body.push(last);
      }
      blocks.push({ type: 'math', content: body.join('\n').trim() });
      continue;
    }
    if (line.startsWith('# ')) {
      flush();
      blocks.push({ type: 'heading', content: line.slice(2).trim() });
      continue;
    }
    if (line.startsWith('[figure]')) {
      flush();
      blocks.push({ type: 'figure', content: line.slice(8).trim() });
      continue;
    }
    if (/^[-*•] /.test(line)) {
      flushParagraph();
      list.push(line.slice(2).trim());
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flush();
  return blocks.filter((b) => (b.type === 'list' ? b.items.length > 0 : b.content.length > 0));
}

/** Texte brut pour la recherche. */
export function plainText(blocks: Block[]): string {
  return blocks
    .map((b) => (b.type === 'list' ? b.items.join(' ') : b.content))
    .join(' ')
    .replace(/\\unsure\{([^}]*)\}/g, '$1')
    .replace(/\[\?|\?\]/g, '')
    .replace(/[\\$]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
