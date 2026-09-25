import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { App } from 'firebase-admin/app';
import type { Firestore } from 'firebase-admin/firestore';
import { backupFileName, collectBackup, encodeBackup } from './backupCollect.js';
import type { BackupReader, RemoteFileMeta } from './backupCollect.js';
import { DriveError, driveAccessToken, ensureFolder, findFile, pruneBackups, uploadJson } from './drive.js';

/**
 * Le côté serveur de la sauvegarde hebdomadaire (fonctions Vercel api/backup.ts et api/drive-auth.ts).
 *
 * Variables d'environnement (Vercel → Settings → Environment Variables, jamais dans le dépôt) :
 *  - FIREBASE_SERVICE_ACCOUNT  la clé du compte de service Firebase (JSON brut ou en base64) : lecture de Firestore
 *  - BACKUP_OWNER_EMAIL        ton adresse : le seul compte dont les données sont sauvegardées et qui peut
 *                              connecter Drive ou lancer une sauvegarde à la main
 *  - GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET   le client OAuth « Application Web » pour Drive
 *  - CRON_SECRET               chaîne aléatoire ; Vercel l'envoie avec chaque déclenchement planifié
 *  - BACKUP_TIMEZONE           facultatif, fuseau du nom de fichier (défaut Africa/Tunis)
 *  - BACKUP_KEEP               facultatif, nombre de sauvegardes gardées sur Drive (défaut : toutes)
 *  - DRIVE_REFRESH_TOKEN       facultatif, jeton de secours si Drive est connecté hors de l'appli
 */

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function env(name: string): string | null {
  const v = process.env[name]?.trim();
  return v ? v : null;
}

function required(name: string): string {
  const v = env(name);
  if (!v) throw new HttpError(503, `Sauvegarde non configurée : la variable ${name} manque dans Vercel (voir README, « Sauvegarde hebdomadaire »).`);
  return v;
}

/**
 * Le SDK Admin n'est chargé qu'à la première vraie utilisation (import dynamique) : s'il ne se charge pas,
 * l'erreur devient une réponse claire au lieu de faire tomber la fonction entière avant même son premier
 * appel — et une requête qui n'en a pas besoin (déclenchement refusé) répond quand même.
 */
type AdminSdk = {
  app: typeof import('firebase-admin/app');
  auth: typeof import('firebase-admin/auth');
  firestore: typeof import('firebase-admin/firestore');
};
let sdk: Promise<AdminSdk> | null = null;
function loadAdmin(): Promise<AdminSdk> {
  sdk ??= Promise.all([import('firebase-admin/app'), import('firebase-admin/auth'), import('firebase-admin/firestore')]).then(
    ([app, auth, firestore]) => ({ app, auth, firestore }),
  );
  sdk.catch(() => (sdk = null));
  return sdk;
}

export async function adminApp(): Promise<App> {
  const { app } = await loadAdmin();
  const { cert, getApps, initializeApp } = app;
  const existing = getApps()[0];
  if (existing) return existing;
  const raw = required('FIREBASE_SERVICE_ACCOUNT');
  let account: { project_id?: string; client_email?: string; private_key?: string };
  try {
    account = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
  } catch {
    throw new HttpError(503, 'FIREBASE_SERVICE_ACCOUNT est illisible : colle le fichier JSON de la clé tel quel (ou en base64).');
  }
  return initializeApp({ credential: cert(account as Parameters<typeof cert>[0]), projectId: account.project_id });
}

export async function firestore(): Promise<Firestore> {
  const { firestore: fs } = await loadAdmin();
  return fs.getFirestore(await adminApp());
}

const adminAuth = async () => (await loadAdmin()).auth.getAuth(await adminApp());

export function oauthClient(): { clientId: string; clientSecret: string } {
  return { clientId: required('GOOGLE_OAUTH_CLIENT_ID'), clientSecret: required('GOOGLE_OAUTH_CLIENT_SECRET') };
}

/** Comparaison en temps constant (un secret ne se devine pas caractère par caractère au chronomètre) */
function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Déclenchement planifié par Vercel Cron : il porte « Authorization: Bearer <CRON_SECRET> » */
export function isCron(request: Request): boolean {
  const secret = env('CRON_SECRET');
  return !!secret && sameSecret(request.headers.get('authorization') ?? '', `Bearer ${secret}`);
}

/** Le propriétaire, connecté dans l'appli : son jeton Firebase est vérifié (signature, révocation, adresse) */
export async function verifyOwner(request: Request): Promise<{ uid: string; email: string }> {
  const token = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token) throw new HttpError(401, 'Connexion requise.');
  const owner = required('BACKUP_OWNER_EMAIL').toLowerCase();
  let decoded;
  try {
    decoded = await (await adminAuth()).verifyIdToken(token, true);
  } catch {
    throw new HttpError(401, 'Session expirée : reconnecte-toi puis réessaie.');
  }
  if (!decoded.email_verified || (decoded.email ?? '').toLowerCase() !== owner) throw new HttpError(403, 'Ce compte n’est pas autorisé à gérer la sauvegarde.');
  return { uid: decoded.uid, email: decoded.email ?? owner };
}

export async function ownerUid(): Promise<string> {
  const email = required('BACKUP_OWNER_EMAIL');
  try {
    return (await (await adminAuth()).getUserByEmail(email)).uid;
  } catch {
    throw new HttpError(503, `Aucun compte Firebase pour ${email} (BACKUP_OWNER_EMAIL).`);
  }
}

export const newState = () => randomBytes(24).toString('hex');

// ------------------------------------------------------------------ lecture de Firestore

export function firestoreReader(db: Firestore, uid: string): BackupReader {
  const user = db.collection('users').doc(uid);
  /** Lit des documents par paquets de 20 (un PDF de 50 Mo = 59 morceaux : pas tout en une seule requête) */
  const getMany = async (paths: string[]) => {
    const out = [];
    for (let i = 0; i < paths.length; i += 20) out.push(...(await db.getAll(...paths.slice(i, i + 20).map((p) => db.doc(p)))));
    return out;
  };
  return {
    async index() {
      const snap = await user.collection('state').doc('index').get();
      return snap.exists ? (snap.data() ?? null) : null;
    },
    async pages() {
      const q = await user.collection('pages').get();
      return q.docs.map((d) => ({ id: d.id, json: String(d.get('json') ?? ''), parts: Number(d.get('parts') ?? 0) || 0 }));
    },
    async pageParts(id, count) {
      const snaps = await getMany(Array.from({ length: count }, (_, i) => `users/${uid}/pages/${id}/parts/${i}`));
      return snaps.map((s) => (s.exists && typeof s.get('data') === 'string' ? (s.get('data') as string) : null));
    },
    async transcripts() {
      const q = await user.collection('transcripts').get();
      return q.docs.map((d) => ({ id: d.id, json: String(d.get('json') ?? '') }));
    },
    async files() {
      const q = await user.collection('files').get();
      const out: RemoteFileMeta[] = [];
      for (const d of q.docs) {
        const x = d.data();
        if (typeof x.chunks !== 'number' || typeof x.size !== 'number' || typeof x.sha256 !== 'string') continue;
        out.push({ id: d.id, name: String(x.name ?? 'fichier'), type: String(x.type ?? 'application/octet-stream'), size: x.size, chunks: x.chunks, sha256: x.sha256, updatedAt: Number(x.updatedAt ?? 0) });
      }
      return out;
    },
    async fileChunks(id, count) {
      const snaps = await getMany(Array.from({ length: count }, (_, i) => `users/${uid}/files/${id}/chunks/${i}`));
      // Le SDK Admin rend les champs binaires (Bytes) sous forme de Buffer
      return snaps.map((s) => {
        const data = s.exists ? (s.get('data') as unknown) : null;
        return data instanceof Uint8Array ? data : null;
      });
    },
    async prefs() {
      const snap = await user.collection('state').doc('prefs').get();
      return snap.exists ? String(snap.get('json') ?? '') : null;
    },
  };
}

// ------------------------------------------------------------------ la sauvegarde elle-même

export interface BackupStatus {
  ok: boolean;
  trigger: 'cron' | 'manual';
  lastRunAt: number;
  lastSuccessAt?: number;
  fileName?: string;
  fileId?: string;
  bytes?: number;
  counts?: Record<string, number>;
  warnings: string[];
  error: string | null;
  connected: boolean;
  durationMs: number;
}

/** Deux sauvegardes en même temps (planifiée + manuelle) écriraient le même fichier : la seconde attend son tour */
async function takeLock(db: Firestore, ms: number): Promise<boolean> {
  const ref = db.doc('backupConfig/lock');
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const until = Number(snap.get('until') ?? 0);
    if (until > Date.now()) return false;
    tx.set(ref, { until: Date.now() + ms });
    return true;
  });
}

/**
 * Lit tout Firestore pour le propriétaire, fabrique le JSON de l'export manuel, l'envoie sur Drive dans
 * « Sauvegardes Math-Notes » sous notes-maths-sauvegarde-AAAA-MM-JJ.json, vérifie ce que Drive a reçu, puis
 * écrit le compte rendu dans users/<uid>/state/backup — que l'appli affiche, et qui déclenche l'alerte en
 * cas d'échec. Ne lève jamais : un échec devient un compte rendu.
 */
export async function runBackup(trigger: 'cron' | 'manual'): Promise<BackupStatus> {
  const started = Date.now();
  let uid: string | null = null;
  let lockTaken = false;
  let db: Firestore | null = null;
  try {
    db = await firestore();
    uid = await ownerUid();
    if (!(await takeLock(db, 6 * 60_000))) throw new HttpError(409, 'Une sauvegarde est déjà en cours.');
    lockTaken = true;
    const config = await db.doc('backupConfig/drive').get();
    const refreshToken = (config.get('refreshToken') as string | undefined) ?? env('DRIVE_REFRESH_TOKEN');
    if (!refreshToken) throw new HttpError(412, 'Google Drive n’est pas encore connecté : Réglages → Sauvegarde hebdomadaire → « Connecter Google Drive ».');

    const { backup, warnings, counts } = await collectBackup(firestoreReader(db, uid), started);
    const bytes = encodeBackup(backup);
    const token = await driveAccessToken(fetch, { ...oauthClient(), refreshToken });
    const folderId = await ensureFolder(fetch, token);
    const name = backupFileName(new Date(started), env('BACKUP_TIMEZONE') ?? 'Africa/Tunis');
    const replaceId = await findFile(fetch, token, folderId, name);
    const uploaded = await uploadJson(fetch, token, { folderId, name, bytes, replaceId });
    try {
      await pruneBackups(fetch, token, folderId, Number(env('BACKUP_KEEP') ?? 0) || 0);
    } catch {
      warnings.push('Nettoyage des anciennes sauvegardes impossible (elles sont toutes gardées).');
    }
    const status: BackupStatus = {
      ok: true,
      trigger,
      lastRunAt: started,
      lastSuccessAt: Date.now(),
      fileName: name,
      fileId: uploaded.id,
      bytes: uploaded.size,
      counts,
      warnings,
      error: null,
      connected: true,
      durationMs: Date.now() - started,
    };
    await db.doc(`users/${uid}/state/backup`).set(status, { merge: true });
    // Journal de Vercel : la trace d'une sauvegarde réussie (seul journal d'information du serveur)
    // eslint-disable-next-line no-console
    console.log(`[sauvegarde] ${trigger} réussie : ${name}, ${uploaded.size} octets, ${counts.notebooks} cahiers, ${counts.files} fichiers`);
    return status;
  } catch (e) {
    const reauthorize = e instanceof DriveError && e.reauthorize;
    const notConnected = e instanceof HttpError && e.status === 412;
    const message = e instanceof HttpError || e instanceof DriveError ? e.message : `Erreur inattendue : ${(e as Error)?.message ?? String(e)}`;
    // Le journal de Vercel garde le détail ; l'appli, elle, affiche un message clair et « Relancer »
    console.error(`[sauvegarde] ${trigger} en échec :`, e);
    const status: BackupStatus = {
      ok: false,
      trigger,
      lastRunAt: started,
      warnings: [],
      error: message,
      connected: !(reauthorize || notConnected),
      durationMs: Date.now() - started,
    };
    // Déjà en cours : l'autre sauvegarde écrira son propre compte rendu (pas de fausse alerte ici)
    const busy = e instanceof HttpError && e.status === 409;
    if (uid && db && !busy) await db.doc(`users/${uid}/state/backup`).set(status, { merge: true }).catch((err) => console.error('[sauvegarde] compte rendu impossible :', err));
    return status;
  } finally {
    if (lockTaken && db) await db.doc('backupConfig/lock').delete().catch(() => undefined);
  }
}
