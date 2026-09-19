import type { Block } from './blocks';

/** Réponse d'exemple (adresse ?demo) pour voir le rendu sans clé API. */
export const DEMO_BLOCKS: Block[] = [
  { type: 'heading', content: 'Étude de la fonction f' },
  { type: 'text', content: 'Soit $f(x) = \\dfrac{x^2+1}{x}$ définie sur $\\mathbb{R}^*$.' },
  { type: 'math', content: "f'(x) = \\dfrac{x^2-1}{x^2} = \\dfrac{(x-1)(x+1)}{x^2}" },
  {
    type: 'sign_table',
    content:
      "\\tkzTabInit{$x$ / 1, $f'(x)$ / 1, $f(x)$ / 2}{$-\\infty$, $-1$, $0$, $1$, $+\\infty$}\n" +
      '\\tkzTabLine{, +, z, -, d, -, z, +, }\n' +
      '\\tkzTabVar{-/ $-\\infty$, +/ $-2$, -D+/ $-\\infty$ / $+\\infty$, -/ $2$, +/ $+\\infty$}',
  },
  {
    type: 'list',
    items: ['$f$ est impaire : $f(-x) = -f(x)$', 'En $0^+$ : $\\lim\\limits_{x \\to 0^+} f(x) = +\\infty$'],
  },
  { type: 'math', content: '\\begin{cases} x + 2y = 3 \\\\ 2x - y = \\unsure{1} \\end{cases}' },
  {
    type: 'text',
    content: 'On pose $A = \\begin{pmatrix} 1 & 2 \\\\ 0 & 1 \\end{pmatrix}$, donc $\\det A = \\unsure{1}$ : $A$ est [?inversible?].',
  },
  { type: 'figure', content: 'Courbe de f avec les asymptotes y = x et x = 0.' },
];
