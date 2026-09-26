import assert from 'node:assert/strict';
import { MULTIPART_MAX, autoBackupDue, backupName, backupsToPrune, multipartFrame, uploadMode, uploadProgress } from '../src/sync/driveUpload.ts';

const results: [string, () => void][] = [];
const test = (name: string, fn: () => void) => results.push([name, fn]);
const DAY = 24 * 60 * 60 * 1000;

test('un seul envoi : multipart jusqu’à 5 Mo (limite de Google), reprenable au-delà', () => {
  assert.equal(uploadMode(1000), 'multipart');
  assert.equal(uploadMode(MULTIPART_MAX), 'multipart');
  assert.equal(uploadMode(MULTIPART_MAX + 1), 'resumable');
  assert.equal(uploadMode(180 * 1024 * 1024), 'resumable');
});

test('corps multipart : métadonnées puis contenu, bornes correctes', () => {
  const [head, tail] = multipartFrame({ name: 'a.json', parents: ['F'] }, 'application/json', 'B');
  const body = head + '{"x":1}' + tail;
  assert.equal(
    body,
    '--B\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{"name":"a.json","parents":["F"]}\r\n--B\r\nContent-Type: application/json\r\n\r\n{"x":1}\r\n--B--',
  );
});

test('une copie par jour, nommée par sa date ; les plus anciennes au-delà de 8 partent', () => {
  assert.equal(backupName(new Date(2026, 8, 7, 3, 0).getTime()), 'notes-maths-sauvegarde-2026-09-07.json');
  const files = Array.from({ length: 10 }, (_, i) => ({ id: `f${i}`, name: `notes-maths-sauvegarde-2026-09-${String(i + 1).padStart(2, '0')}.json` }));
  assert.deepEqual(backupsToPrune([...files, { id: 'autre', name: 'index.json' }]), ['f1', 'f0'], 'les deux plus anciennes ; les fichiers étrangers ne sont jamais touchés');
  assert.deepEqual(backupsToPrune(files.slice(0, 3)), []);
});

test('copie automatique : seulement s’il y a du nouveau, et au plus une fois par jour', () => {
  const now = 10 * DAY;
  assert.equal(autoBackupDue(null, true, now), true, 'jamais faite');
  assert.equal(autoBackupDue(now - 2 * 60 * 60 * 1000, true, now), false, 'faite il y a 2 h');
  assert.equal(autoBackupDue(now - DAY, true, now), true, 'faite hier');
  assert.equal(autoBackupDue(now - 3 * DAY, false, now), false, 'rien de changé');
});

test('barre de progression : l’envoi du fichier seul', () => {
  assert.equal(uploadProgress(5 * 1024 * 1024, 20 * 1024 * 1024), 'Envoi de la sauvegarde : 25 % (5,0 / 20,0 Mo)');
  assert.equal(uploadProgress(0, 0), 'Envoi de la sauvegarde : 0 % (0,0 / 0,0 Mo)');
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
console.log(failed ? `\n${failed} échec(s)` : '\nEnvoi sur Drive : tout passe');
process.exitCode = failed ? 1 : 0;
