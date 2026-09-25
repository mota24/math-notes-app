import { createHash } from 'node:crypto';

/**
 * Google Drive côté serveur, en appels HTTP directs (pas de bibliothèque Google de plusieurs Mo). `fetch` est
 * passé en paramètre : les tests simulent Drive, coupures comprises (tests/driveBackup.test.ts).
 *
 * Portée demandée : drive.file — l'appli ne voit que les fichiers et dossiers qu'elle a créés elle-même,
 * jamais le reste du Drive.
 */

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const BACKUP_FOLDER = 'Sauvegardes Math-Notes';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

/** Morceau d'envoi : multiple de 256 Kio, comme l'exige l'envoi reprenable de Drive */
export const CHUNK_BYTES = 8 * 1024 * 1024;

export class DriveError extends Error {
  readonly status: number;
  /** L'autorisation n'est plus valable (révoquée, expirée) : il faut reconnecter Google Drive */
  readonly reauthorize: boolean;
  constructor(message: string, status = 0, reauthorize = false) {
    super(message);
    this.name = 'DriveError';
    this.status = status;
    this.reauthorize = reauthorize;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Réponse passagère de Google : on réessaie (trop de requêtes, serveur surchargé) */
const transient = (status: number) => status === 408 || status === 429 || status >= 500;

/** Échappe une valeur pour une requête de recherche Drive (entre apostrophes) */
const quote = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } | string; error_description?: string };
    if (typeof body.error === 'string') return body.error_description ? `${body.error} : ${body.error_description}` : body.error;
    return body.error?.message ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/** Jeton d'accès (1 h) à partir du jeton de rafraîchissement enregistré lors de la connexion à Drive */
export async function driveAccessToken(
  fetchFn: Fetch,
  creds: { clientId: string; clientSecret: string; refreshToken: string },
): Promise<string> {
  const res = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
    }).toString(),
  });
  if (!res.ok) {
    const detail = await readError(res);
    if (/invalid_grant/.test(detail)) {
      throw new DriveError(
        'L’autorisation Google Drive a expiré ou a été retirée : reconnecte Google Drive dans Réglages → Sauvegarde hebdomadaire.',
        res.status,
        true,
      );
    }
    throw new DriveError(`Google refuse le jeton d’accès (${detail}).`, res.status);
  }
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new DriveError('Réponse de Google sans jeton d’accès.');
  return body.access_token;
}

/** Appel à l'API Drive, réessayé quelques fois sur une erreur passagère */
async function call(fetchFn: Fetch, token: string, url: string, init: RequestInit = {}, attempts = 4): Promise<Response> {
  for (let i = 0; ; i++) {
    let res: Response | null = null;
    try {
      res = await fetchFn(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } });
    } catch (e) {
      if (i + 1 >= attempts) throw new DriveError(`Drive injoignable (${(e as Error).message}).`);
    }
    if (res && !transient(res.status)) {
      if (res.status === 401) throw new DriveError('Drive refuse l’accès (jeton invalide).', 401, true);
      return res;
    }
    if (i + 1 >= attempts) throw new DriveError(`Drive indisponible (${res ? await readError(res) : 'réseau'}).`, res?.status ?? 0);
    await sleep(500 * 2 ** i);
  }
}

/** Le dossier de sauvegarde (créé par l'appli), créé s'il n'existe pas encore */
export async function ensureFolder(fetchFn: Fetch, token: string, name = BACKUP_FOLDER): Promise<string> {
  const q = `name = ${quote(name)} and mimeType = ${quote(FOLDER_MIME)} and trashed = false`;
  const found = await call(fetchFn, token, `${API}/files?${new URLSearchParams({ q, fields: 'files(id)', spaces: 'drive', pageSize: '1' })}`);
  if (!found.ok) throw new DriveError(`Recherche du dossier impossible (${await readError(found)}).`, found.status);
  const list = (await found.json()) as { files?: { id: string }[] };
  if (list.files?.[0]?.id) return list.files[0].id;
  const created = await call(fetchFn, token, `${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME }),
  });
  if (!created.ok) throw new DriveError(`Création du dossier « ${name} » impossible (${await readError(created)}).`, created.status);
  const body = (await created.json()) as { id?: string };
  if (!body.id) throw new DriveError('Drive n’a pas renvoyé l’identifiant du dossier.');
  return body.id;
}

/** Un fichier du même nom déjà dans le dossier (sauvegarde relancée le même jour) : il est remplacé */
export async function findFile(fetchFn: Fetch, token: string, folderId: string, name: string): Promise<string | null> {
  const q = `name = ${quote(name)} and ${quote(folderId)} in parents and trashed = false`;
  const res = await call(fetchFn, token, `${API}/files?${new URLSearchParams({ q, fields: 'files(id)', spaces: 'drive', pageSize: '1' })}`);
  if (!res.ok) throw new DriveError(`Recherche du fichier impossible (${await readError(res)}).`, res.status);
  const list = (await res.json()) as { files?: { id: string }[] };
  return list.files?.[0]?.id ?? null;
}

/** Octets déjà reçus par Drive, d'après l'en-tête Range d'une réponse 308 (« bytes=0-1234 ») */
function received(res: Response): number {
  const range = res.headers.get('Range') ?? res.headers.get('range');
  const m = range ? /bytes=0-(\d+)/.exec(range) : null;
  return m ? Number(m[1]) + 1 : 0;
}

/** Ce que Drive renvoie d'un fichier envoyé */
type DriveFile = { id?: string; size?: string; md5Checksum?: string };

export interface UploadResult {
  id: string;
  size: number;
  md5: string;
}

/**
 * Envoi reprenable : Drive ouvre une session, les octets partent par morceaux de 8 Mo, et après une coupure
 * on demande à Drive où il en est pour repartir de là (jamais d'octet perdu ni envoyé deux fois). À la fin,
 * la taille ET l'empreinte MD5 calculées par Drive sont comparées à celles du fichier : s'il manque un seul
 * octet, la sauvegarde est déclarée en échec.
 */
export async function uploadJson(
  fetchFn: Fetch,
  token: string,
  file: { folderId: string; name: string; bytes: Uint8Array; replaceId?: string | null },
  options: { chunkBytes?: number; attempts?: number; wait?: (ms: number) => Promise<void> } = {},
): Promise<UploadResult> {
  const chunkBytes = options.chunkBytes ?? CHUNK_BYTES;
  const attempts = options.attempts ?? 6;
  const wait = options.wait ?? sleep;
  const total = file.bytes.length;
  const md5 = createHash('md5').update(file.bytes).digest('hex');
  const fields = 'id,size,md5Checksum';

  const open = async () => {
    const url = file.replaceId
      ? `${UPLOAD}/files/${encodeURIComponent(file.replaceId)}?uploadType=resumable&fields=${fields}`
      : `${UPLOAD}/files?uploadType=resumable&fields=${fields}`;
    const res = await call(fetchFn, token, url, {
      method: file.replaceId ? 'PATCH' : 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'application/json',
        'X-Upload-Content-Length': String(total),
      },
      body: JSON.stringify(file.replaceId ? {} : { name: file.name, parents: [file.folderId], mimeType: 'application/json' }),
    });
    const session = res.headers.get('Location') ?? res.headers.get('location');
    if (!res.ok || !session) throw new DriveError(`Drive refuse l’envoi (${await readError(res)}).`, res.status);
    return session;
  };

  let session = await open();
  let offset = 0;
  let failures = 0;
  let restarted = false;
  let done: DriveFile | null = null;

  while (!done) {
    const end = Math.min(total, offset + chunkBytes);
    let res: Response | null = null;
    try {
      res = await fetchFn(session, {
        method: 'PUT',
        redirect: 'manual',
        headers: { 'Content-Range': total === 0 ? 'bytes */0' : `bytes ${offset}-${end - 1}/${total}` },
        // Copie du morceau (8 Mo au plus) : un corps de requête doit posséder son propre tampon
        body: new Uint8Array(file.bytes.subarray(offset, end)),
      });
    } catch {
      res = null; // coupure réseau : on demandera où Drive en est
    }
    if (res && (res.status === 200 || res.status === 201)) {
      done = (await res.json()) as DriveFile;
      break;
    }
    if (res && res.status === 308) {
      offset = received(res);
      failures = 0;
      continue;
    }
    if (res && res.status === 404 && !restarted) {
      // Session expirée (une semaine) ou perdue : on recommence une seule fois depuis le début
      restarted = true;
      session = await open();
      offset = 0;
      continue;
    }
    if (res && !transient(res.status)) throw new DriveError(`Envoi refusé par Drive (${await readError(res)}).`, res.status);
    if (++failures >= attempts) throw new DriveError('Envoi interrompu trop de fois : Drive ou le réseau ne répondent plus.');
    await wait(1000 * 2 ** (failures - 1));
    // Où en est Drive ? (requête d'état : corps vide, taille totale seulement)
    try {
      const status = await fetchFn(session, { method: 'PUT', redirect: 'manual', headers: { 'Content-Range': `bytes */${total}` } });
      if (status.status === 200 || status.status === 201) done = (await status.json()) as DriveFile;
      else if (status.status === 308) offset = received(status);
    } catch {
      // toujours injoignable : le prochain tour réessaiera
    }
  }

  const id = done?.id;
  if (!done || !id) throw new DriveError('Drive n’a pas renvoyé l’identifiant du fichier.');
  let size = Number(done.size ?? NaN);
  let remoteMd5 = done.md5Checksum;
  if (!remoteMd5 || !Number.isFinite(size)) {
    const meta = await call(fetchFn, token, `${API}/files/${encodeURIComponent(id)}?fields=${fields}`);
    const body = (await meta.json()) as { size?: string; md5Checksum?: string };
    size = Number(body.size ?? NaN);
    remoteMd5 = body.md5Checksum;
  }
  if (size !== total || remoteMd5 !== md5) {
    throw new DriveError(`Vérification échouée : Drive a reçu ${size} octets (empreinte ${remoteMd5 ?? '?'}) au lieu de ${total} (${md5}).`);
  }
  return { id, size, md5 };
}

/**
 * Conservation : ne garde que les `keep` sauvegardes les plus récentes du dossier (les autres vont à la
 * corbeille de Drive, d'où on peut encore les récupérer 30 jours). `keep` ≤ 0 : on garde tout.
 */
export async function pruneBackups(fetchFn: Fetch, token: string, folderId: string, keep: number): Promise<number> {
  if (keep <= 0) return 0;
  const q = `${quote(folderId)} in parents and trashed = false and name contains 'notes-maths-sauvegarde-'`;
  const res = await call(fetchFn, token, `${API}/files?${new URLSearchParams({ q, fields: 'files(id,name)', orderBy: 'name desc', pageSize: '1000', spaces: 'drive' })}`);
  if (!res.ok) return 0;
  const list = ((await res.json()) as { files?: { id: string; name: string }[] }).files ?? [];
  let trashed = 0;
  for (const f of list.slice(keep)) {
    const t = await call(fetchFn, token, `${API}/files/${encodeURIComponent(f.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ trashed: true }),
    });
    if (t.ok) trashed++;
  }
  return trashed;
}
