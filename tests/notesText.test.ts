import assert from 'node:assert/strict';
import { blocksToText, plainText, textToBlocks } from '../src/ai/notesText.ts';
import type { Block } from '../src/ai/blocks.ts';

const blocks: Block[] = [
  { type: 'heading', content: 'Étude de f' },
  { type: 'text', content: 'Soit $f(x) = \\dfrac{1}{x}$ sur $]0,+\\infty[$.' },
  { type: 'math', content: '\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}' },
  { type: 'list', items: ['$f$ est impaire', 'limite en $0^+$ : [?+\\infty?]'] },
  { type: 'sign_table', content: '\\tkzTabInit{$x$ / 1}{$0$, $1$}\n\\tkzTabLine{, +, }' },
  { type: 'figure', content: 'Courbe de f' },
  { type: 'text', content: 'Conclusion.' },
];

const cases: [string, () => void][] = [
  [
    'aller-retour blocs → texte → blocs',
    () => assert.deepEqual(textToBlocks(blocksToText(blocks)), blocks),
  ],
  [
    'formule sur une ligne',
    () => assert.deepEqual(textToBlocks('$$ x^2 $$'), [{ type: 'math', content: 'x^2' }]),
  ],
  [
    'paragraphe sur plusieurs lignes et liste qui suit',
    () =>
      assert.deepEqual(textToBlocks('ligne un\nligne deux\n- a\n- b\nfin'), [
        { type: 'text', content: 'ligne un ligne deux' },
        { type: 'list', items: ['a', 'b'] },
        { type: 'text', content: 'fin' },
      ]),
  ],
  [
    'réponse collée depuis ChatGPT',
    () =>
      assert.deepEqual(
        textToBlocks("### Dérivée\nOn a \\(f'(x) = 2x\\) donc\n\\[\n\\int_0^1 x\\,dx = \\frac{1}{2}\n\\]\n1. premier point\n2. second point\n---\nFin."),
        [
          { type: 'heading', content: 'Dérivée' },
          { type: 'text', content: "On a $f'(x) = 2x$ donc" },
          { type: 'math', content: '\\int_0^1 x\\,dx = \\frac{1}{2}' },
          { type: 'list', items: ['premier point', 'second point'] },
          { type: 'text', content: 'Fin.' },
        ],
      ),
  ],
  [
    'texte brut pour la recherche',
    () => assert.ok(plainText(blocks).includes('limite en 0^+ : +infty')),
  ],
];

let failed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    console.log('OK  ', name);
  } catch (e) {
    failed++;
    console.log('FAIL', name, '\n     ', (e as Error).message);
  }
}
console.log(failed ? `\n${failed} échec(s)` : '\nFormat texte : tout passe');
process.exitCode = failed ? 1 : 0;
