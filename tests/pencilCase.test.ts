import assert from 'node:assert/strict';
import {
  DEFAULT_PENCIL_CASE,
  SLOT_COUNT,
  describeSlot,
  mmToPx,
  normalizePencilCase,
  sameSlot,
  settingsPatchFor,
  slotFromCurrent,
} from '../src/pencilCase.ts';
import type { InkSettings } from '../src/pencilCase.ts';

const settings: InkSettings = {
  color: '#c0392b',
  size: 0.4,
  dashed: false,
  highlightColor: '#facc15',
  highlightSize: 5.3,
  tapeColor: '#fb923c',
  tapeSize: 7,
};

const results: [string, () => void][] = [];
const test = (name: string, fn: () => void) => results.push([name, fn]);

test('le stylo mémorise couleur, épaisseur et pointillés', () => {
  assert.deepEqual(slotFromCurrent('pen', settings), { tool: 'pen', color: '#c0392b', size: 0.4 });
  assert.deepEqual(slotFromCurrent('pen', { ...settings, dashed: true }), { tool: 'pen', color: '#c0392b', size: 0.4, dashed: true });
});

test('le surligneur et le ruban mémorisent leurs propres réglages, pas ceux du stylo', () => {
  assert.deepEqual(slotFromCurrent('highlighter', settings), { tool: 'highlighter', color: '#facc15', size: 5.3 });
  assert.deepEqual(slotFromCurrent('tape', settings), { tool: 'tape', color: '#fb923c', size: 7 });
  // les pointillés ne se mémorisent que pour le stylo
  assert.equal(slotFromCurrent('highlighter', { ...settings, dashed: true })?.dashed, undefined);
});

test('gomme, lasso, formes, capture, main : rien à mémoriser', () => {
  for (const t of ['eraser', 'lasso', 'shapes', 'capture', 'hand', 'line'] as const) assert.equal(slotFromCurrent(t, settings), null, t);
});

test('rappeler un favori règle la bonne couleur et la bonne épaisseur', () => {
  assert.deepEqual(settingsPatchFor({ tool: 'pen', color: '#1f4fbf', size: 0.66 }), { color: '#1f4fbf', size: 0.66, dashed: false });
  assert.deepEqual(settingsPatchFor({ tool: 'pen', color: '#1f4fbf', size: 0.66, dashed: true }), { color: '#1f4fbf', size: 0.66, dashed: true });
  assert.deepEqual(settingsPatchFor({ tool: 'highlighter', color: '#4ade80', size: 8 }), { highlightColor: '#4ade80', highlightSize: 8 });
  assert.deepEqual(settingsPatchFor({ tool: 'tape', color: '#a78bfa', size: 6 }), { tapeColor: '#a78bfa', tapeSize: 6 });
});

test('mémoriser puis rappeler redonne exactement le réglage de départ', () => {
  for (const tool of ['pen', 'highlighter', 'tape'] as const) {
    const slot = slotFromCurrent(tool, { ...settings, dashed: tool === 'pen' })!;
    const patch = settingsPatchFor(slot);
    const back = slotFromCurrent(tool, { ...settings, color: '#000000', size: 9, highlightColor: '#000000', highlightSize: 9, tapeColor: '#000000', tapeSize: 9, dashed: false, ...patch });
    assert.ok(sameSlot(slot, back), tool);
  }
});

test('sameSlot : casse de la couleur ignorée, épaisseur à 0,02 mm près, outil et pointillés comptent', () => {
  const a = { tool: 'pen', color: '#C0392B', size: 0.4 } as const;
  assert.ok(sameSlot(a, { tool: 'pen', color: '#c0392b', size: 0.41 }));
  assert.ok(!sameSlot(a, { tool: 'pen', color: '#c0392b', size: 0.5 }));
  assert.ok(!sameSlot(a, { tool: 'highlighter', color: '#c0392b', size: 0.4 }));
  assert.ok(!sameSlot(a, { tool: 'pen', color: '#c0392b', size: 0.4, dashed: true }));
  assert.ok(!sameSlot(null, a) && !sameSlot(a, null) && !sameSlot(null, null));
});

test('libellé : outil, couleur, épaisseur en px', () => {
  assert.equal(describeSlot({ tool: 'pen', color: '#c0392b', size: 0.4 }), 'Stylo rouge, 1.5 px'.replace('.', ','));
  assert.equal(describeSlot({ tool: 'highlighter', color: '#facc15', size: 5.3 }), 'Surligneur jaune, 20 px');
  assert.equal(describeSlot({ tool: 'pen', color: '#1f4fbf', size: 0.66, dashed: true }), 'Stylo bleu pointillé, 2,5 px');
  assert.equal(describeSlot({ tool: 'tape', color: '#123456', size: 7 }), 'Ruban #123456, 26,5 px');
  assert.equal(mmToPx(0.6), 2.5);
});

test('les favoris d’origine sont ceux de l’exemple : stylo rouge fin, surligneur jaune épais', () => {
  assert.equal(DEFAULT_PENCIL_CASE.length, SLOT_COUNT);
  assert.equal(describeSlot(DEFAULT_PENCIL_CASE[0]!), 'Stylo rouge, 1,5 px');
  assert.equal(DEFAULT_PENCIL_CASE[1]?.tool, 'highlighter');
});

test('rien d’enregistré : les favoris d’origine, en copie (les modifier ne touche pas les défauts)', () => {
  const fresh = normalizePencilCase(undefined);
  assert.deepEqual(fresh, DEFAULT_PENCIL_CASE);
  fresh[0]!.color = '#000000';
  assert.equal(DEFAULT_PENCIL_CASE[0]!.color, '#c0392b');
});

test('trousse enregistrée : gardée telle quelle, complétée à 3 emplacements', () => {
  const saved = [{ tool: 'tape', color: '#fb923c', size: 7 }, null];
  const out = normalizePencilCase(saved);
  assert.equal(out.length, SLOT_COUNT);
  assert.deepEqual(out[0], { tool: 'tape', color: '#fb923c', size: 7 });
  assert.equal(out[1], null);
  assert.equal(out[2], null);
});

test('données abîmées : écartées sans planter, épaisseur bornée', () => {
  const out = normalizePencilCase([
    { tool: 'gomme', color: '#ffffff', size: 1 },
    { tool: 'pen', color: 'rouge', size: 1 },
    { tool: 'pen', color: '#ff0000', size: 'gros' },
  ]);
  assert.deepEqual(out, [null, null, null]);
  const bounded = normalizePencilCase([{ tool: 'pen', color: '#ff0000', size: 500 }, { tool: 'pen', color: '#ff0000', size: -3 }, 42]);
  assert.equal(bounded[0]?.size, 12);
  assert.equal(bounded[1]?.size, 0.1);
  assert.equal(bounded[2], null);
  assert.equal(normalizePencilCase('n’importe quoi').length, SLOT_COUNT);
});

test('les pointillés ne survivent que sur un stylo', () => {
  const out = normalizePencilCase([{ tool: 'highlighter', color: '#facc15', size: 5, dashed: true }, { tool: 'pen', color: '#facc15', size: 1, dashed: true }]);
  assert.equal(out[0]?.dashed, undefined);
  assert.equal(out[1]?.dashed, true);
});

let failed = 0;
for (const [name, fn] of results) {
  try {
    fn();
    console.log('OK  ', name);
  } catch (e) {
    failed++;
    console.log('FAIL', name, '\n     ', (e as Error).message);
  }
}
console.log(failed ? `\n${failed} échec(s)` : '\nTous les scénarios passent');
process.exitCode = failed ? 1 : 0;
