import assert from 'node:assert/strict';
import { interpretVar, parseTkzTab } from '../src/render/tkztab.ts';

const DEMO =
  "\\tkzTabInit{$x$ / 1, $f'(x)$ / 1, $f(x)$ / 2}{$-\\infty$, $-1$, $0$, $1$, $+\\infty$}\n" +
  '\\tkzTabLine{, +, z, -, d, -, z, +, }\n' +
  '\\tkzTabVar{-/ $-\\infty$, +/ $-2$, -D+/ $-\\infty$ / $+\\infty$, -/ $2$, +/ $+\\infty$}';

const cases: [string, () => void][] = [
  [
    'tableau de signes et de variations complet',
    () => {
      const tab = parseTkzTab(DEMO);
      assert.equal(tab.xLabel, '$x$');
      assert.equal(tab.xHeight, 1);
      assert.deepEqual(tab.xValues, ['$-\\infty$', '$-1$', '$0$', '$1$', '$+\\infty$']);
      assert.equal(tab.rows.length, 2);
      const [signs, vars] = tab.rows;
      assert.equal(signs.kind, 'line');
      if (signs.kind === 'line') {
        assert.equal(signs.label, "$f'(x)$");
        assert.equal(signs.entries.length, 9); // 2n - 1
        assert.deepEqual(signs.entries, ['', '+', 'z', '-', 'd', '-', 'z', '+', '']);
      }
      assert.equal(vars.kind, 'var');
      if (vars.kind === 'var') {
        assert.equal(vars.height, 2);
        assert.equal(vars.nodes.length, 5);
        assert.deepEqual(vars.nodes[2], { code: '-D+', values: ['$-\\infty$', '$+\\infty$'] });
      }
    },
  ],
  [
    'les virgules et les slashs dans $…$ ou {…} ne coupent pas',
    () => {
      const tab = parseTkzTab('\\tkzTabInit{$x$/1, $g(x)$/1.5}{$0$, $\\frac{1}{2}$, $1$}\\tkzTabLine{, {a, b}, z, $c/d$, }');
      assert.deepEqual(tab.xValues, ['$0$', '$\\frac{1}{2}$', '$1$']);
      const row = tab.rows[0];
      assert.equal(row.kind, 'line');
      if (row.kind === 'line') {
        assert.equal(row.height, 1.5);
        assert.deepEqual(row.entries, ['', '{a, b}', 'z', '$c/d$', '']);
      }
    },
  ],
  [
    'ligne manquante → rangée vide ; commentaires % ignorés ; option [] tolérée',
    () => {
      const tab = parseTkzTab('% commentaire\n\\tkzTabInit[lgt=3]{$x$/1, $f$/1, $g$/2}{$0$, $1$}\n\\tkzTabLine{, +, }');
      assert.equal(tab.rows.length, 2);
      assert.equal(tab.rows[0].kind, 'line');
      assert.equal(tab.rows[1].kind, 'empty');
      assert.equal(tab.rows[1].label, '$g$');
    },
  ],
  [
    'erreurs : sans \\tkzTabInit, ou tableau incomplet',
    () => {
      assert.throws(() => parseTkzTab('\\tkzTabLine{, +, }'), /tkzTabInit manquant/);
      assert.throws(() => parseTkzTab('\\tkzTabInit{$x$/1}{$0$}'), /incomplet/);
    },
  ],
  [
    'interpretVar : codes simples, doubles barres, hachures',
    () => {
      assert.deepEqual(interpretVar({ code: '+', values: ['$1$'] }), { skip: false, double: false, hatchAfter: false, single: { pos: 'top', value: '$1$' } });
      assert.deepEqual(interpretVar({ code: '-', values: [] }), { skip: false, double: false, hatchAfter: false, single: { pos: 'bottom', value: '' } });
      assert.deepEqual(interpretVar({ code: 'R', values: [] }), { skip: true, double: false, hatchAfter: false });
      assert.deepEqual(interpretVar({ code: '-D+', values: ['a', 'b'] }), {
        skip: false,
        double: true,
        hatchAfter: false,
        left: { pos: 'bottom', value: 'a' },
        right: { pos: 'top', value: 'b' },
      });
      assert.deepEqual(interpretVar({ code: 'D+', values: ['b'] }), { skip: false, double: true, hatchAfter: false, left: undefined, right: { pos: 'top', value: 'b' } });
      assert.equal(interpretVar({ code: '+H', values: ['x'] }).hatchAfter, true);
      assert.equal(interpretVar({ code: '+CH', values: ['x'] }).single?.pos, 'top');
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
console.log('\nTableaux tkz-tab : tout passe');
