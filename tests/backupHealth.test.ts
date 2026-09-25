import assert from 'node:assert/strict';
import { STALE_DAYS, backupHealth, formatBytes } from '../src/sync/backupHealth.ts';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 8, 28, 9);

const cases: [string, () => void][] = [
  [
    'pas encore connectée : rien à signaler',
    () => {
      assert.deepEqual(backupHealth(null, now), { kind: 'not-connected' });
      assert.deepEqual(backupHealth({}, now), { kind: 'not-connected' });
    },
  ],
  [
    'connectée, premier dimanche pas encore passé : en attente, sans alerte',
    () => {
      assert.deepEqual(backupHealth({ connected: true, connectedAt: now - 2 * DAY }, now), { kind: 'waiting' });
    },
  ],
  [
    'dernière sauvegarde réussie cette semaine : tout va bien',
    () => {
      assert.deepEqual(backupHealth({ ok: true, connected: true, lastRunAt: now - DAY, lastSuccessAt: now - DAY }, now), { kind: 'ok', at: now - DAY });
    },
  ],
  [
    'dernière sauvegarde en échec : alerte avec le message du serveur',
    () => {
      const h = backupHealth({ ok: false, connected: true, lastRunAt: now - DAY, lastSuccessAt: now - 8 * DAY, error: 'Drive indisponible' }, now);
      assert.deepEqual(h, { kind: 'failed', error: 'Drive indisponible', at: now - DAY, reconnect: false });
    },
  ],
  [
    'autorisation Drive révoquée : l’alerte propose de reconnecter',
    () => {
      const h = backupHealth({ ok: false, connected: false, lastRunAt: now - DAY, error: 'reconnecte' }, now);
      assert.equal(h.kind === 'failed' && h.reconnect, true);
    },
  ],
  [
    `silence de plus de ${STALE_DAYS} jours (planification arrêtée) : alerte, même sans échec écrit`,
    () => {
      assert.deepEqual(backupHealth({ ok: true, connected: true, lastRunAt: now - 10 * DAY, lastSuccessAt: now - 10 * DAY }, now), { kind: 'stale', days: 10 });
      assert.deepEqual(backupHealth({ connected: true, connectedAt: now - 9 * DAY }, now), { kind: 'stale', days: 9 }, 'jamais lancée depuis la connexion');
    },
  ],
  [
    'tailles lisibles',
    () => {
      assert.equal(formatBytes(900), '1 Ko');
      assert.equal(formatBytes(512 * 1024), '512 Ko');
      assert.equal(formatBytes(13_002_342), '12,4 Mo');
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
console.log(failed ? `\n${failed} échec(s)` : '\nÉtat de la sauvegarde : tout passe');
if (failed) process.exit(1);
