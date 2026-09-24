import katex from 'katex';
import type { KatexOptions } from 'katex';
import type { Block } from '../ai/blocks';

const MACROS = {
  '\\unsure': '\\htmlClass{unsure}{#1}',
  '\\R': '\\mathbb{R}',
  '\\N': '\\mathbb{N}',
  '\\Z': '\\mathbb{Z}',
  '\\Q': '\\mathbb{Q}',
  '\\C': '\\mathbb{C}',
};

const OPTIONS: KatexOptions = {
  throwOnError: false,
  strict: 'ignore',
  // Garde-fous contre une formule piégée (fichier de sauvegarde ou réponse de modèle) : taille des éléments
  // plafonnée (une règle de 10 000 em ferait exploser la mise en page) et expansion des macros bornée.
  maxSize: 50,
  maxExpand: 1000,
  // Seule la classe « unsure » (passages douteux surlignés) est autorisée
  trust: (ctx) => ctx.command === '\\htmlClass' && 'class' in ctx && ctx.class === 'unsure',
};

export function renderMath(tex: string, display: boolean): string {
  return katex.renderToString(tex, { ...OPTIONS, macros: { ...MACROS }, displayMode: display });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Texte avec $maths$, $$maths$$, **gras** et [?passage douteux?]. */
export function renderRichText(text: string): string {
  const re = /\$\$([\s\S]+?)\$\$|\$((?:\\\$|[^$])+?)\$|\[\?([\s\S]+?)\?\]|\*\*([\s\S]+?)\*\*/g;
  let html = '';
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    html += escapeHtml(text.slice(last, m.index));
    if (m[1] !== undefined) html += renderMath(m[1], true);
    else if (m[2] !== undefined) html += renderMath(m[2], false);
    else if (m[3] !== undefined) html += `<mark class="unsure">${renderRichText(m[3])}</mark>`;
    else html += `<strong>${renderRichText(m[4])}</strong>`;
    last = re.lastIndex;
  }
  return html + escapeHtml(text.slice(last));
}

// ---------------------------------------------------------------- export LaTeX

function textToLatex(text: string): string {
  const parts = text.split(/(\$\$[\s\S]+?\$\$|\$(?:\\\$|[^$])+?\$)/);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part; // maths : inchangées
      return part
        .replace(/([%&#_])/g, '\\$1')
        .replace(/\[\?([\s\S]+?)\?\]/g, '\\unsuretext{$1}')
        .replace(/\*\*([\s\S]+?)\*\*/g, '\\textbf{$1}');
    })
    .join('');
}

export function blocksToLatex(blocks: Block[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case 'heading':
          return `\\subsection*{${textToLatex(b.content)}}`;
        case 'text':
          return textToLatex(b.content);
        case 'math':
          return `\\[\n${b.content}\n\\]`;
        case 'list':
          return `\\begin{itemize}\n${b.items.map((it) => `  \\item ${textToLatex(it)}`).join('\n')}\n\\end{itemize}`;
        case 'sign_table':
          return `\\begin{center}\n\\begin{tikzpicture}\n${b.content.trim()}\n\\end{tikzpicture}\n\\end{center}`;
        case 'figure':
          return `% Figure : ${b.content.replace(/\n/g, ' ')}`;
      }
    })
    .join('\n\n');
}

const PREAMBLE = `\\documentclass[11pt]{article}
\\usepackage[T1]{fontenc}
\\usepackage[french]{babel}
\\usepackage[margin=2cm]{geometry}
\\usepackage{amsmath,amssymb}
\\usepackage{xcolor}
\\usepackage{tkz-tab}
\\newcommand{\\unsure}[1]{\\colorbox{yellow!40}{$#1$}}
\\newcommand{\\unsuretext}[1]{\\colorbox{yellow!40}{#1}}`;

export function latexDocument(blocks: Block[]): string {
  return `${PREAMBLE}

\\begin{document}

${blocksToLatex(blocks)}

\\end{document}
`;
}

/** Cahier complet : une section par page convertie. */
export function notebookLatex(title: string, pages: { number: number; blocks: Block[] }[]): string {
  const escaped = title.replace(/([%&#_{}$])/g, '\\$1');
  const body = pages.map((p) => `% ---------------- Page ${p.number}\n\\section*{Page ${p.number}}\n\n${blocksToLatex(p.blocks)}`).join('\n\n');
  return `${PREAMBLE}

\\title{${escaped}}
\\date{}

\\begin{document}
\\maketitle

${body}

\\end{document}
`;
}
