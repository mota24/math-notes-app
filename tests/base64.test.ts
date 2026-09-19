import assert from 'node:assert/strict';
import { RAW_CHUNK, base64Chunks, bytesToBase64 } from '../src/export/base64.ts';

const results: [string, () => void | Promise<void>][] = [];
const test = (name: string, fn: () => void | Promise<void>) => results.push([name, fn]);

const collect = async (blob: Blob, rawChunk?: number) => {
  const parts: string[] = [];
  for await (const part of base64Chunks(blob, rawChunk)) parts.push(part);
  return parts;
};
const sample = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 255);

test('base64 de quelques octets : identique à celui de Node', () => {
  const bytes = Uint8Array.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
  assert.equal(bytesToBase64(bytes), Buffer.from(bytes).toString('base64'));
  assert.equal(bytesToBase64(new Uint8Array(0)), '');
});

test('un gros tableau (plus que la limite d’arguments) se code sans erreur, à l’identique', () => {
  const bytes = sample(200_000);
  assert.equal(bytesToBase64(bytes), Buffer.from(bytes).toString('base64'));
});

test('un morceau brut est un multiple de 3 : aucun morceau intermédiaire ne porte de « = »', () => {
  assert.equal(RAW_CHUNK % 3, 0);
});

test('mis bout à bout, les morceaux redonnent le base64 du fichier entier', async () => {
  for (const size of [1, 2, 3, 4, 299, 300, 301, 1000, 1001]) {
    const bytes = sample(size);
    const parts = await collect(new Blob([bytes]), 300);
    assert.equal(parts.join(''), Buffer.from(bytes).toString('base64'), `taille ${size}`);
    for (const part of parts.slice(0, -1)) assert.ok(!part.includes('='), `remplissage dans un morceau intermédiaire (taille ${size})`);
  }
});

test('le découpage suit la taille demandée', async () => {
  const parts = await collect(new Blob([sample(1000)]), 300);
  assert.equal(parts.length, 4); // 300 + 300 + 300 + 100 octets
  assert.equal(parts[0].length, 400); // 300 octets → 400 caractères base64
});

test('un fichier vide donne un seul morceau vide (le fichier est quand même créé)', async () => {
  assert.deepEqual(await collect(new Blob([])), ['']);
});

test('un vrai morceau de 3 Mo : un seul morceau pour un fichier plus petit', async () => {
  const parts = await collect(new Blob([sample(RAW_CHUNK - 5)]));
  assert.equal(parts.length, 1);
  const two = await collect(new Blob([sample(RAW_CHUNK + 5)]));
  assert.equal(two.length, 2);
});

let failed = 0;
for (const [name, fn] of results) {
  try {
    await fn();
    console.log('OK  ', name);
  } catch (e) {
    failed++;
    console.log('FAIL', name, '\n     ', (e as Error).message);
  }
}
console.log(failed ? `\n${failed} échec(s)` : '\nTous les scénarios passent');
process.exitCode = failed ? 1 : 0;
