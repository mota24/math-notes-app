import assert from 'node:assert/strict';
import { blocksToLatex, latexDocument, notebookLatex, renderMath, renderRichText } from '../src/render/math.ts';

const cases: [string, () => void][] = [
  [
    'renderRichText : le texte brut est échappé (aucune injection HTML possible)',
    () => {
      const html = renderRichText('<script>alert(1)</script> & "quotes" <img onerror=x>');
      assert.ok(!html.includes('<script'), 'balise script échappée');
      assert.ok(!html.includes('<img'), 'balise img échappée');
      assert.ok(html.includes('&#60;script&#62;'), 'chevrons codés');
      assert.ok(html.includes('&#38;'), 'esperluette codée');
    },
  ],
  [
    'renderRichText : $…$ et $$…$$ rendus par KaTeX, **gras** et [?douteux?] balisés',
    () => {
      const html = renderRichText('Soit $x^2$ et $$\\int f$$, **important** et [?peut-être?].');
      assert.ok(html.includes('class="katex"'), 'maths inline');
      assert.ok(html.includes('katex-display'), 'maths en bloc');
      assert.ok(html.includes('<strong>important</strong>'));
      assert.ok(html.includes('<mark class="unsure">peut-être</mark>'));
    },
  ],
  [
    'renderRichText : du HTML à l’intérieur de **…** ou [?…?] reste échappé',
    () => {
      const html = renderRichText('**<b>x</b>** [?<i>y</i>?]');
      assert.ok(!html.includes('<b>') && !html.includes('<i>'));
    },
  ],
  [
    'renderMath : une commande dangereuse ne produit pas de lien ni de HTML libre',
    () => {
      const html = renderMath('\\href{javascript:alert(1)}{clic}', false);
      assert.ok(!html.includes('href="javascript'), 'href refusé (trust)');
      // (la source TeX reste visible dans <annotation>, en texte : on vérifie qu'aucun ATTRIBUT n'en est issu)
      const html2 = renderMath('\\htmlData{x=1}{a} \\htmlStyle{color:red}{b} \\includegraphics{x.png} \\htmlClass{evil}{c}', false);
      assert.ok(!/data-x=/.test(html2), 'htmlData refusé');
      assert.ok(!/style="[^"]*color:red/.test(html2), 'htmlStyle refusé');
      assert.ok(!html2.includes('<img'), 'includegraphics refusé');
      assert.ok(!/class="[^"]*\bevil\b/.test(html2), 'htmlClass limité à « unsure »');
    },
  ],
  [
    'renderMath : \\unsure{…} donne la classe unsure, une erreur LaTeX ne lève pas',
    () => {
      assert.ok(renderMath('\\unsure{1}', false).includes('unsure'));
      assert.doesNotThrow(() => renderMath('\\frac{1', true));
      assert.ok(renderMath('\\frac{1', true).includes('katex-error'));
    },
  ],
  [
    'blocksToLatex : chaque type de bloc, caractères spéciaux échappés hors maths',
    () => {
      const tex = blocksToLatex([
        { type: 'heading', content: 'Taux 50% & plus' },
        { type: 'text', content: 'On a $a_1$ et a_2 **fort** [?doute?]' },
        { type: 'math', content: 'x^2' },
        { type: 'list', items: ['un', 'deux'] },
        { type: 'sign_table', content: '\\tkzTabInit{$x$/1}{$0$,$1$}' },
        { type: 'figure', content: 'ligne 1\nligne 2' },
      ]);
      assert.ok(tex.includes('\\subsection*{Taux 50\\% \\& plus}'));
      assert.ok(tex.includes('$a_1$ et a\\_2 \\textbf{fort} \\unsuretext{doute}'));
      assert.ok(tex.includes('\\[\nx^2\n\\]'));
      assert.ok(tex.includes('\\begin{itemize}\n  \\item un\n  \\item deux\n\\end{itemize}'));
      assert.ok(tex.includes('\\begin{tikzpicture}\n\\tkzTabInit{$x$/1}{$0$,$1$}\n\\end{tikzpicture}'));
      assert.ok(tex.includes('% Figure : ligne 1 ligne 2'));
    },
  ],
  [
    'latexDocument et notebookLatex : documents complets, titre échappé',
    () => {
      const doc = latexDocument([{ type: 'text', content: 'x' }]);
      assert.ok(doc.startsWith('\\documentclass[11pt]{article}'));
      assert.ok(doc.includes('\\begin{document}') && doc.trimEnd().endsWith('\\end{document}'));
      const nb = notebookLatex('Analyse & séries_1 100%', [{ number: 1, blocks: [{ type: 'math', content: 'y' }] }]);
      assert.ok(nb.includes('\\title{Analyse \\& séries\\_1 100\\%}'));
      assert.ok(nb.includes('\\section*{Page 1}'));
    },
  ],
  [
    'notebookLatex : un titre piégé ne peut injecter aucune commande TeX',
    () => {
      const nb = notebookLatex('\\input{/etc/passwd} \\write18{rm} ^~', []);
      const title = nb.split('\n').find((l) => l.startsWith('\\title{'))!;
      assert.equal(title, '\\title{\\textbackslash{}input\\{/etc/passwd\\} \\textbackslash{}write18\\{rm\\} \\textasciicircum{}\\textasciitilde{}}');
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
console.log('\nRendu des maths : tout passe');
