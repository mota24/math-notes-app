import assert from 'node:assert/strict';
import { DEFAULT_SELECTION_COLORS, SELECTION_SLOTS, normalizeSelectionColors, pushRecentColor } from '../src/colors.ts';

const NOIR = '#1d2433';
const BLEU = '#1f4fbf';
const ROUGE = '#c0392b';
const VIOLET = '#7c3aed';

const results: [string, () => void][] = [];
const test = (name: string, fn: () => void) => results.push([name, fn]);

test('au départ : noir, bleu, rouge (le vert est remplacé par la pastille multicolore)', () => {
  assert.deepEqual([...DEFAULT_SELECTION_COLORS], [NOIR, BLEU, ROUGE]);
  assert.equal(SELECTION_SLOTS, 3);
});

test('l’exemple : violet prend la place du noir, le noir celle du bleu, le bleu celle du rouge', () => {
  assert.deepEqual(pushRecentColor([NOIR, BLEU, ROUGE], VIOLET), [VIOLET, NOIR, BLEU]);
});

test('un second choix décale encore : la plus ancienne sort de la palette', () => {
  const first = pushRecentColor([NOIR, BLEU, ROUGE], VIOLET);
  assert.deepEqual(pushRecentColor(first, '#ff8800'), ['#ff8800', VIOLET, NOIR]);
});

test('une couleur déjà dans la palette ne réorganise rien', () => {
  assert.deepEqual(pushRecentColor([VIOLET, NOIR, BLEU], BLEU), [VIOLET, NOIR, BLEU]);
  assert.deepEqual(pushRecentColor([VIOLET, NOIR, BLEU], VIOLET), [VIOLET, NOIR, BLEU]);
});

test('la casse ne compte pas : #7C3AED est le même violet que #7c3aed', () => {
  assert.deepEqual(pushRecentColor([VIOLET, NOIR, BLEU], '#7C3AED'), [VIOLET, NOIR, BLEU]);
  assert.deepEqual(pushRecentColor([NOIR, BLEU, ROUGE], '#7C3AED'), [VIOLET, NOIR, BLEU]);
});

test('la palette ne grandit jamais : trois pastilles, toujours', () => {
  let colors: string[] = [...DEFAULT_SELECTION_COLORS];
  for (const c of ['#111111', '#222222', '#333333', '#444444', '#555555']) colors = pushRecentColor(colors, c);
  assert.equal(colors.length, SELECTION_SLOTS);
  assert.deepEqual(colors, ['#555555', '#444444', '#333333']);
});

test('la palette d’origine n’est pas modifiée par un choix', () => {
  const base = [NOIR, BLEU, ROUGE];
  pushRecentColor(base, VIOLET);
  assert.deepEqual(base, [NOIR, BLEU, ROUGE]);
});

test('réglages enregistrés valides : gardés (minuscules), dans l’ordre', () => {
  assert.deepEqual(normalizeSelectionColors([VIOLET, NOIR, '#1F4FBF']), [VIOLET, NOIR, BLEU]);
});

test('rien d’enregistré, ou n’importe quoi : la palette d’origine', () => {
  assert.deepEqual(normalizeSelectionColors(undefined), [NOIR, BLEU, ROUGE]);
  assert.deepEqual(normalizeSelectionColors('rouge'), [NOIR, BLEU, ROUGE]);
  assert.deepEqual(normalizeSelectionColors([42, null, 'bleu', '#12']), [NOIR, BLEU, ROUGE]);
});

test('palette abîmée ou trop courte : complétée avec les couleurs d’origine, sans doublon', () => {
  assert.deepEqual(normalizeSelectionColors([VIOLET]), [VIOLET, NOIR, BLEU]);
  assert.deepEqual(normalizeSelectionColors([VIOLET, VIOLET, NOIR]), [VIOLET, NOIR, BLEU]);
  assert.deepEqual(normalizeSelectionColors([VIOLET, 'pas une couleur', BLEU, ROUGE, NOIR]), [VIOLET, BLEU, ROUGE]);
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
