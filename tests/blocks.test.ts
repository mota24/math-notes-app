import assert from 'node:assert/strict';
import { normalizeBlocks, parseModelJson, repairLatexEscapes } from '../src/ai/blocks.ts';

const cases: [string, () => void][] = [
  [
    'repairLatexEscapes : les commandes LaTeX qui ressemblent à un échappement JSON sont doublées',
    () => {
      assert.equal(repairLatexEscapes('"\\frac{1}{2}"'), '"\\\\frac{1}{2}"');
      assert.equal(repairLatexEscapes('"\\begin{cases}"'), '"\\\\begin{cases}"');
      assert.equal(repairLatexEscapes('"\\times \\rightarrow \\neq"'), '"\\\\times \\\\rightarrow \\\\neq"');
      assert.equal(repairLatexEscapes('"\\tkzTabInit{$x$}"'), '"\\\\tkzTabInit{$x$}"');
    },
  ],
  [
    'repairLatexEscapes : les vrais échappements JSON sont conservés',
    () => {
      assert.equal(repairLatexEscapes('"ligne 1\\nligne 2"'), '"ligne 1\\nligne 2"');
      assert.equal(repairLatexEscapes('"tab\\t"'), '"tab\\t"');
      assert.equal(repairLatexEscapes('"guillemet \\" et barre \\\\ et \\/"'), '"guillemet \\" et barre \\\\ et \\/"');
      assert.equal(repairLatexEscapes('"\\u00e9"'), '"\\u00e9"');
    },
  ],
  [
    'repairLatexEscapes : les autres commandes LaTeX (\\alpha, \\{, \\,) sont doublées',
    () => {
      assert.equal(repairLatexEscapes('"\\alpha \\{ \\,"'), '"\\\\alpha \\\\{ \\\\,"');
      // « \nu » est une lettre grecque, pas un saut de ligne
      assert.equal(repairLatexEscapes('"\\nu"'), '"\\\\nu"');
      // mais « \n » seul reste un saut de ligne
      assert.equal(repairLatexEscapes('"a\\nb"'), '"a\\nb"');
    },
  ],
  [
    'parseModelJson : JSON propre',
    () => {
      const blocks = parseModelJson('{"blocks":[{"type":"heading","content":"Titre"},{"type":"math","content":"x^2"}]}');
      assert.deepEqual(blocks, [
        { type: 'heading', content: 'Titre' },
        { type: 'math', content: 'x^2' },
      ]);
    },
  ],
  [
    'parseModelJson : JSON dans une clôture ``` et texte autour',
    () => {
      const text = 'Voici le résultat :\n```json\n{"blocks":[{"type":"text","content":"Bonjour"}]}\n```\nVoilà.';
      assert.deepEqual(parseModelJson(text), [{ type: 'text', content: 'Bonjour' }]);
    },
  ],
  [
    'parseModelJson : antislashs LaTeX mal échappés par le modèle',
    () => {
      const raw = '{"blocks":[{"type":"math","content":"\\frac{x^2-1}{x^2} \\neq 0"}]}';
      assert.deepEqual(parseModelJson(raw), [{ type: 'math', content: '\\frac{x^2-1}{x^2} \\neq 0' }]);
    },
  ],
  [
    'parseModelJson : tableau nu accepté, JSON illisible refusé',
    () => {
      assert.deepEqual(parseModelJson('[{"type":"text","content":"a"}]'), [{ type: 'text', content: 'a' }]);
      assert.throws(() => parseModelJson('pas du json'), /JSON illisible/);
      assert.throws(() => parseModelJson('{"autre":1}'), /JSON illisible/);
    },
  ],
  [
    'normalizeBlocks : types inconnus → texte, éléments vides ignorés, listes',
    () => {
      const out = normalizeBlocks({
        blocks: [
          { type: 'martien', content: 'x' },
          { type: 'text', content: '   ' },
          { type: 'list', items: ['a', 2, 'b'] },
          { type: 'list', items: [], content: 'repli' },
          { type: 'list', items: [] },
          null,
          'texte',
          { content: 'sans type' },
        ],
      });
      assert.deepEqual(out, [
        { type: 'text', content: 'x' },
        { type: 'list', items: ['a', 'b'] },
        { type: 'text', content: 'repli' },
        { type: 'text', content: 'sans type' },
      ]);
    },
  ],
];

let failed = 0;
for (const [name, run] of cases) {
  try {
    run();
    console.log(`OK   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${(e as Error).message}`);
  }
}
if (failed) {
  console.log(`\n${failed} scénario(s) en échec`);
  process.exit(1);
}
console.log('\nRéponses du modèle : tout passe');
