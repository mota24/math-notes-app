import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { backupFileName, collectBackup, encodeBackup } from '../api/_lib/backupCollect.ts';
import type { BackupReader, RemoteFileMeta } from '../api/_lib/backupCollect.ts';
import { DriveError, driveAccessToken, ensureFolder, findFile, pruneBackups, uploadJson } from '../api/_lib/drive.ts';
import type { Fetch } from '../api/_lib/drive.ts';
import { validateBackup } from '../src/db/backupFormat.ts';

// ------------------------------------------------------------------ un Firestore en mémoire

const page = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  notebookId: 'nb1',
  width: 210,
  height: 297,
  paper: 'grid',
  pdf: null,
  strokes: [{ id: `${id}-s`, points: [[1, 2, 0.5]], color: '#000', size: 0.6, input: 'pen' }],
  createdAt: 1,
  updatedAt: 5,
  deletedAt: null,
  ...extra,
});

function fakeReader(overrides: Partial<Record<string, unknown>> = {}): BackupReader {
  const pdf = Buffer.from('%PDF-1.7 un vrai cours de maths '.repeat(4000));
  const pdfParts = [pdf.subarray(0, 50_000), pdf.subarray(50_000)];
  const heavy = JSON.stringify(page('lourde', { strokes: [{ id: 'img', tool: 'image', image: 'data:image/png;base64,' + 'A'.repeat(3000), points: [[0, 0, 1], [10, 10, 1]], color: '#000', size: 0, input: 'mouse' }] }));
  const files: RemoteFileMeta[] = [
    { id: 'pdf1', name: 'Cours.pdf', type: 'application/pdf', size: pdf.length, chunks: 2, sha256: createHash('sha256').update(pdf).digest('hex'), updatedAt: 7 },
    { id: 'abime', name: 'Abîmé.pdf', type: 'application/pdf', size: 3, chunks: 1, sha256: '0'.repeat(64), updatedAt: 7 },
  ];
  return {
    index: async () =>
      'index' in overrides
        ? (overrides.index as Record<string, unknown> | null)
        : {
            v: 1,
            updatedAt: 9,
            foldersJson: JSON.stringify([{ id: 'f1', name: 'Semestre 1', parentId: null, color: '#123', createdAt: 1, updatedAt: 2, deletedAt: null }]),
            notebooksJson: JSON.stringify([{ id: 'nb1', title: 'Analyse', folderId: 'f1', color: '#456', paper: 'grid', pageIds: ['p1', 'lourde'], favorite: false, subject: '', openedAt: 3, createdAt: 1, updatedAt: 4, deletedAt: null, shareId: null }]),
            todosJson: JSON.stringify([{ id: 't1', text: 'Réviser Rolle', dueAt: null, done: false, createdAt: 1, updatedAt: 1, deletedAt: null }]),
            glyphsJson: JSON.stringify([{ char: 'a', strokes: [[[0, 0, 0.5]]], advance: 0.5, updatedAt: 1 }]),
            tombstonesJson: JSON.stringify({ supprimee: { kind: 'page', deletedAt: 8 } }),
          },
    pages: async () => [
      { id: 'p1', json: JSON.stringify(page('p1')), parts: 0 },
      { id: 'lourde', json: '', parts: 3 },
      { id: 'supprimee', json: JSON.stringify(page('supprimee')), parts: 0 },
      { id: 'cassee', json: '{"id":"cass', parts: 0 },
    ],
    pageParts: async (_id, count) => {
      const size = Math.ceil(heavy.length / count);
      return Array.from({ length: count }, (_, i) => heavy.slice(i * size, (i + 1) * size));
    },
    transcripts: async () => [{ id: 'p1', json: JSON.stringify({ pageId: 'p1', notebookId: 'nb1', blocks: [{ type: 'text', content: 'x' }], model: 'm', strokeCount: 1, edited: false, createdAt: 1, updatedAt: 1, deletedAt: null }) }],
    files: async () => files,
    fileChunks: async (id) => (id === 'pdf1' ? pdfParts : [Buffer.from('xyz')]),
    prefs: async () => JSON.stringify({ color: '#c0392b', selectionColors: ['#1d2433'], textSize: 5 }),
  };
}

// ------------------------------------------------------------------ un Google Drive simulé

interface FakeDrive {
  fetch: Fetch;
  files: Map<string, { name: string; parents: string[]; bytes: Buffer; trashed: boolean }>;
  calls: string[];
}

/** `faults` : pannes à injecter, dans l'ordre, sur les envois de morceaux (503, coupure réseau, 404 de session…) */
function fakeDrive(options: { faults?: ('503' | 'network' | '404')[]; corrupt?: boolean; tokenError?: string } = {}): FakeDrive {
  const faults = [...(options.faults ?? [])];
  const files = new Map<string, { name: string; parents: string[]; bytes: Buffer; trashed: boolean }>();
  const sessions = new Map<string, { total: number; got: Buffer; meta: { name?: string; parents?: string[] }; replace?: string }>();
  const calls: string[] = [];
  let n = 0;
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  const finish = (sid: string) => {
    const s = sessions.get(sid)!;
    const bytes = options.corrupt ? Buffer.concat([s.got.subarray(0, -1), Buffer.from('!')]) : s.got;
    const id = s.replace ?? `file${++n}`;
    const previous = files.get(id);
    files.set(id, { name: s.meta.name ?? previous?.name ?? '?', parents: s.meta.parents ?? previous?.parents ?? [], bytes, trashed: false });
    sessions.delete(sid);
    return json(200, { id, size: String(bytes.length), md5Checksum: createHash('md5').update(bytes).digest('hex') });
  };
  const fetchFn: Fetch = async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    calls.push(`${method} ${url.pathname}`);
    if (url.hostname === 'oauth2.googleapis.com') {
      if (options.tokenError) return json(400, { error: options.tokenError, error_description: 'Token has been expired or revoked.' });
      return json(200, { access_token: 'jeton', expires_in: 3599 });
    }
    if (url.pathname === '/drive/v3/files' && method === 'GET') {
      const q = url.searchParams.get('q') ?? '';
      const list = [...files.entries()].filter(([, f]) => {
        if (f.trashed) return false;
        const name = /name = '([^']+)'/.exec(q)?.[1];
        const parent = /'([^']+)' in parents/.exec(q)?.[1];
        const folder = q.includes('google-apps.folder');
        if (name && f.name !== name) return false;
        if (parent && !f.parents.includes(parent)) return false;
        if (folder !== (f.bytes.length === 0 && f.name === 'Sauvegardes Math-Notes')) return false;
        if (q.includes("name contains 'notes-maths-sauvegarde-'") && !f.name.startsWith('notes-maths-sauvegarde-')) return false;
        return true;
      });
      list.sort((a, b) => b[1].name.localeCompare(a[1].name));
      return json(200, { files: list.map(([id, f]) => ({ id, name: f.name })) });
    }
    if (url.pathname === '/drive/v3/files' && method === 'POST') {
      const body = JSON.parse(String(init.body));
      const id = `dossier${++n}`;
      files.set(id, { name: body.name, parents: [], bytes: Buffer.alloc(0), trashed: false });
      return json(200, { id });
    }
    if (url.pathname.startsWith('/drive/v3/files/') && method === 'PATCH') {
      const id = decodeURIComponent(url.pathname.split('/').pop()!);
      files.get(id)!.trashed = true;
      return json(200, { id });
    }
    if (url.pathname.startsWith('/upload/drive/v3/files')) {
      const sid = `session${++n}`;
      const headers = new Headers(init.headers);
      const replace = method === 'PATCH' ? decodeURIComponent(url.pathname.split('/').pop()!) : undefined;
      sessions.set(sid, { total: Number(headers.get('X-Upload-Content-Length')), got: Buffer.alloc(0), meta: JSON.parse(String(init.body)), replace });
      return new Response(null, { status: 200, headers: { Location: `https://upload.test/${sid}` } });
    }
    if (url.hostname === 'upload.test') {
      const sid = url.pathname.slice(1);
      const s = sessions.get(sid);
      const range = new Headers(init.headers).get('Content-Range') ?? '';
      const statusQuery = range.startsWith('bytes */');
      if (!statusQuery && faults.length) {
        const fault = faults.shift();
        if (fault === 'network') throw new TypeError('fetch failed');
        if (fault === '503') return json(503, { error: { message: 'Backend Error' } });
        if (fault === '404') {
          sessions.delete(sid);
          return json(404, { error: { message: 'Session expired' } });
        }
      }
      if (!s) return json(404, { error: { message: 'No such session' } });
      if (!statusQuery) {
        const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(range)!;
        const start = Number(m[1]);
        if (start !== s.got.length) return json(400, { error: { message: `départ ${start} au lieu de ${s.got.length}` } });
        s.got = Buffer.concat([s.got, Buffer.from(init.body as Uint8Array)]);
      }
      if (s.got.length >= s.total) return finish(sid);
      return new Response(null, { status: 308, headers: s.got.length ? { Range: `bytes=0-${s.got.length - 1}` } : {} });
    }
    return json(404, { error: { message: `inconnu ${method} ${url}` } });
  };
  return { fetch: fetchFn, files, calls };
}

const noWait = async () => {};

// ------------------------------------------------------------------ scénarios

const cases: [string, () => Promise<void>][] = [
  [
    'export depuis Firestore : même format que l’export manuel, accepté tel quel par la restauration',
    async () => {
      const { backup, warnings, counts } = await collectBackup(fakeReader(), 1234);
      const reread = validateBackup(JSON.parse(encodeBackup(backup).toString('utf8')));
      assert.deepEqual(reread, backup, 'la validation de l’appli ne retire rien');
      assert.equal(backup.app, 'notes-maths');
      assert.equal(backup.createdAt, 1234);
      assert.deepEqual(counts, { folders: 1, notebooks: 1, pages: 2, files: 1, todos: 1 });
      assert.deepEqual(Object.keys(backup), ['app', 'version', 'createdAt', 'folders', 'notebooks', 'pages', 'transcripts', 'glyphs', 'files', 'todos', 'tombstones', 'settings']);
      assert.equal(backup.settings?.color, '#c0392b', 'les réglages de couleurs sont dans la sauvegarde');
      assert.equal(warnings.length, 2, JSON.stringify(warnings));
    },
  ],
  [
    'pages lourdes recollées, pages supprimées exclues, page illisible signalée (jamais un plantage)',
    async () => {
      const { backup, warnings } = await collectBackup(fakeReader());
      const ids = backup.pages.map((p) => p.id);
      assert.deepEqual(ids, ['p1', 'lourde']);
      assert.equal(backup.pages[1].strokes[0].tool, 'image');
      assert.ok(warnings.some((w) => w.includes('cassee')));
    },
  ],
  [
    'PDF : recomposé octet pour octet en base64 ; un PDF abîmé (empreinte fausse) est écarté et signalé',
    async () => {
      const { backup, warnings } = await collectBackup(fakeReader());
      assert.deepEqual(backup.files.map((f) => f.id), ['pdf1']);
      const back = Buffer.from(backup.files[0].data, 'base64');
      assert.ok(back.toString('utf8').startsWith('%PDF-1.7'));
      assert.equal(back.length, backup.files[0].size);
      assert.ok(warnings.some((w) => w.includes('Abîmé.pdf')));
    },
  ],
  [
    'Firestore vide : échec explicite (une sauvegarde vide ne passe jamais pour un succès)',
    async () => {
      await assert.rejects(collectBackup(fakeReader({ index: null })), /Aucune donnée dans Firestore/);
    },
  ],
  [
    'nom du fichier : notes-maths-sauvegarde-AAAA-MM-JJ.json, à la date du fuseau choisi',
    async () => {
      const d = new Date('2026-09-26T23:30:00Z'); // dimanche 00 h 30 à Tunis
      assert.equal(backupFileName(d, 'Africa/Tunis'), 'notes-maths-sauvegarde-2026-09-27.json');
      assert.equal(backupFileName(d, 'UTC'), 'notes-maths-sauvegarde-2026-09-26.json');
      assert.equal(backupFileName(d, 'Pas/UnFuseau'), 'notes-maths-sauvegarde-2026-09-26.json', 'fuseau inconnu : UTC');
    },
  ],
  [
    'Drive : dossier « Sauvegardes Math-Notes » créé une seule fois, puis retrouvé',
    async () => {
      const drive = fakeDrive();
      const token = await driveAccessToken(drive.fetch, { clientId: 'c', clientSecret: 's', refreshToken: 'r' });
      const a = await ensureFolder(drive.fetch, token);
      const b = await ensureFolder(drive.fetch, token);
      assert.equal(a, b);
      assert.equal(drive.calls.filter((c) => c === 'POST /drive/v3/files').length, 1);
    },
  ],
  [
    'Drive : envoi par morceaux malgré une erreur 503 et une coupure réseau, contenu et empreinte identiques',
    async () => {
      const drive = fakeDrive({ faults: ['503', 'network'] });
      const folderId = await ensureFolder(drive.fetch, 'jeton');
      const bytes = Buffer.from('x'.repeat(2_000_000) + 'fin');
      const res = await uploadJson(drive.fetch, 'jeton', { folderId, name: 'notes-maths-sauvegarde-2026-09-27.json', bytes }, { chunkBytes: 256 * 1024, wait: noWait });
      const stored = drive.files.get(res.id)!;
      assert.ok(stored.bytes.equals(bytes), 'Drive a reçu exactement le fichier');
      assert.equal(res.md5, createHash('md5').update(bytes).digest('hex'));
      assert.deepEqual(stored.parents, [folderId]);
    },
  ],
  [
    'Drive : session perdue (404) → l’envoi recommence une fois depuis le début et réussit',
    async () => {
      const drive = fakeDrive({ faults: ['404'] });
      const bytes = Buffer.from('y'.repeat(600_000));
      const res = await uploadJson(drive.fetch, 'jeton', { folderId: 'd', name: 'n.json', bytes }, { chunkBytes: 256 * 1024, wait: noWait });
      assert.ok(drive.files.get(res.id)!.bytes.equals(bytes));
    },
  ],
  [
    'Drive : si ce qui est arrivé diffère d’un seul octet, la sauvegarde est déclarée en échec',
    async () => {
      const drive = fakeDrive({ corrupt: true });
      await assert.rejects(
        uploadJson(drive.fetch, 'jeton', { folderId: 'd', name: 'n.json', bytes: Buffer.from('contenu') }, { wait: noWait }),
        /Vérification échouée/,
      );
    },
  ],
  [
    'Drive : relancée le même jour, la sauvegarde remplace le fichier du jour au lieu d’en créer un second',
    async () => {
      const drive = fakeDrive();
      const folderId = await ensureFolder(drive.fetch, 'jeton');
      const name = 'notes-maths-sauvegarde-2026-09-27.json';
      const first = await uploadJson(drive.fetch, 'jeton', { folderId, name, bytes: Buffer.from('v1') }, { wait: noWait });
      const replaceId = await findFile(drive.fetch, 'jeton', folderId, name);
      assert.equal(replaceId, first.id);
      const second = await uploadJson(drive.fetch, 'jeton', { folderId, name, bytes: Buffer.from('version 2'), replaceId }, { wait: noWait });
      assert.equal(second.id, first.id);
      assert.equal(drive.files.get(first.id)!.bytes.toString(), 'version 2');
    },
  ],
  [
    'Drive : autorisation révoquée → erreur claire qui demande de reconnecter Drive',
    async () => {
      const drive = fakeDrive({ tokenError: 'invalid_grant' });
      await assert.rejects(driveAccessToken(drive.fetch, { clientId: 'c', clientSecret: 's', refreshToken: 'r' }), (e: unknown) => {
        assert.ok(e instanceof DriveError && e.reauthorize);
        assert.match((e as Error).message, /reconnecte Google Drive/);
        return true;
      });
    },
  ],
  [
    'Drive : conservation — seules les N sauvegardes les plus récentes restent (les autres à la corbeille)',
    async () => {
      const drive = fakeDrive();
      const folderId = await ensureFolder(drive.fetch, 'jeton');
      for (const day of ['2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27']) {
        await uploadJson(drive.fetch, 'jeton', { folderId, name: `notes-maths-sauvegarde-${day}.json`, bytes: Buffer.from(day) }, { wait: noWait });
      }
      assert.equal(await pruneBackups(drive.fetch, 'jeton', folderId, 2), 2);
      const kept = [...drive.files.values()].filter((f) => !f.trashed && f.name.startsWith('notes-maths')).map((f) => f.name).sort();
      assert.deepEqual(kept, ['notes-maths-sauvegarde-2026-09-20.json', 'notes-maths-sauvegarde-2026-09-27.json']);
      assert.equal(await pruneBackups(drive.fetch, 'jeton', folderId, 0), 0, '0 : tout est gardé');
    },
  ],
];

let failed = 0;
for (const [name, run] of cases) {
  try {
    await run();
    console.log(`OK   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${(e as Error).stack ?? (e as Error).message}`);
  }
}
console.log(failed ? `\n${failed} échec(s)` : '\nSauvegarde Drive : tout passe');
if (failed) process.exit(1);
