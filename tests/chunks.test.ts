import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { FILE_CHUNK_BYTES, PAGE_PART_CHARS, chunkCount, joinBytes, splitBytes, splitText, toHex } from '../src/sync/chunks.ts';

const cases: [string, () => void][] = [
  [
    'texte : découpé puis recollé à l’identique, chaque morceau sous la limite',
    () => {
      const text = 'x'.repeat(PAGE_PART_CHARS * 2 + 12345) + 'é🙂fin';
      const parts = splitText(text, PAGE_PART_CHARS);
      assert.equal(parts.length, 3);
      assert.ok(parts.every((p) => p.length <= PAGE_PART_CHARS));
      assert.equal(parts.join(''), text);
      assert.equal(chunkCount(text.length, PAGE_PART_CHARS), 3);
    },
  ],
  [
    'texte vide ou court : un seul morceau',
    () => {
      assert.deepEqual(splitText('', 10), ['']);
      assert.deepEqual(splitText('abc', 10), ['abc']);
    },
  ],
  [
    'octets : un « PDF » de 2,5 Mo recomposé octet pour octet, empreinte identique',
    () => {
      const size = Math.floor(FILE_CHUNK_BYTES * 2.5);
      const bytes = new Uint8Array(size);
      for (let i = 0; i < size; i++) bytes[i] = (i * 7919 + (i >> 8)) & 255;
      const parts = splitBytes(bytes, FILE_CHUNK_BYTES);
      assert.equal(parts.length, 3);
      assert.ok(parts.every((p) => p.length <= FILE_CHUNK_BYTES));
      // Chaque morceau est copié, comme Firestore le fait à l'envoi et au retour
      const back = joinBytes(parts.map((p) => Uint8Array.from(p)));
      assert.equal(back.length, size);
      assert.equal(toHex(createHash('sha256').update(back).digest()), toHex(createHash('sha256').update(bytes).digest()));
    },
  ],
  [
    'octets : un morceau manquant ou en double change l’empreinte (fichier corrompu refusé)',
    () => {
      const bytes = Uint8Array.from({ length: 3000 }, (_, i) => i & 255);
      const parts = splitBytes(bytes, 1000);
      const sha = (u: Uint8Array) => toHex(createHash('sha256').update(u).digest());
      assert.notEqual(sha(joinBytes([parts[0], parts[2]])), sha(bytes));
      assert.notEqual(sha(joinBytes([parts[0], parts[0], parts[2]])), sha(bytes));
      assert.equal(sha(joinBytes(parts)), sha(bytes));
    },
  ],
  [
    'hexadécimal : zéros de tête conservés',
    () => {
      assert.equal(toHex(Uint8Array.from([0, 15, 16, 255])), '000f10ff');
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
console.log(failed ? `\n${failed} échec(s)` : '\nDécoupage des gros contenus : tout passe');
if (failed) process.exit(1);
