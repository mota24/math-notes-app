import { multipartFrame, uploadMode } from './driveUpload';

/**
 * Accès à Google Drive depuis le navigateur, sans serveur :
 * - connexion avec Google Identity Services (jeton valable 1 h) ;
 * - portée drive.file : l'appli ne voit QUE les fichiers qu'elle a créés.
 * Nécessite un « ID client OAuth » (gratuit) et une adresse https:// ou http://localhost.
 */

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}
interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}
interface GoogleOAuth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
    error_callback?: (error: { type: string; message?: string }) => void;
  }): TokenClient;
  revoke(token: string, done?: () => void): void;
}
declare global {
  interface Window {
    google?: { accounts: { oauth2: GoogleOAuth2 } };
  }
}

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const TOKEN_KEY = 'notes-maths.drive-token';
const LEGACY_TOKEN_KEY = 'notes-maths.drive-token';

interface SavedToken {
  value: string;
  expiresAt: number;
}

/**
 * Le jeton d'accès (valable 1 h) reste en mémoire, avec une copie dans sessionStorage pour survivre à un
 * rechargement de la page. Il n'est plus écrit dans localStorage : il disparaît quand on ferme l'appli,
 * et un script malveillant qui lirait le stockage persistant n'y trouverait rien.
 */
let memoryToken: SavedToken | null = null;

function readSavedToken(): SavedToken | null {
  if (memoryToken) return memoryToken;
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<SavedToken>;
      if (typeof saved.value === 'string' && typeof saved.expiresAt === 'number') {
        memoryToken = { value: saved.value, expiresAt: saved.expiresAt };
        return memoryToken;
      }
    }
  } catch {
    /* stockage indisponible ou jeton illisible */
  }
  return null;
}

function saveToken(token: SavedToken | null) {
  memoryToken = token;
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, JSON.stringify(token));
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* navigation privée : le jeton reste seulement en mémoire */
  }
}

/** Anciennes versions : le jeton était dans localStorage. On l'efface (et on le révoque si possible). */
function purgeLegacyToken() {
  try {
    const raw = localStorage.getItem(LEGACY_TOKEN_KEY);
    if (!raw) return;
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    const saved = JSON.parse(raw) as Partial<SavedToken>;
    if (typeof saved.value === 'string' && window.google) window.google.accounts.oauth2.revoke(saved.value);
  } catch {
    /* rien à nettoyer */
  }
}

export class DriveAuthError extends Error {}

let gis: Promise<void> | null = null;

function loadGis(): Promise<void> {
  gis ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      gis = null;
      reject(new Error('Impossible de charger la connexion Google (hors-ligne ?).'));
    };
    document.head.appendChild(script);
  });
  return gis;
}

export function canUseDrive(): { ok: boolean; reason?: string } {
  const { protocol, hostname } = window.location;
  if (protocol === 'https:' || hostname === 'localhost' || hostname === '127.0.0.1') return { ok: true };
  return {
    ok: false,
    reason: 'Google n’autorise la connexion que sur une adresse https:// (appli en ligne) ou http://localhost (sur le PC).',
  };
}

export function currentToken(): string | null {
  purgeLegacyToken();
  const saved = readSavedToken();
  if (saved && saved.expiresAt - 60_000 > Date.now()) return saved.value;
  if (saved) saveToken(null); // expiré
  return null;
}

/** Ouvre la fenêtre de connexion Google (à appeler depuis un clic). */
export async function signIn(clientId: string): Promise<string> {
  if (!clientId.trim()) throw new Error('Renseigne d’abord l’ID client OAuth dans les réglages.');
  await loadGis();
  return new Promise<string>((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId.trim(),
      scope: SCOPE,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error_description || response.error || 'Connexion refusée.'));
          return;
        }
        const expiresAt = Date.now() + (response.expires_in ?? 3600) * 1000;
        saveToken({ value: response.access_token, expiresAt });
        resolve(response.access_token);
      },
      error_callback: (error) =>
        reject(new Error(error.type === 'popup_closed' ? 'Fenêtre de connexion fermée.' : error.message || error.type)),
    });
    client.requestAccessToken({ prompt: '' });
  });
}

export function signOut() {
  const token = currentToken();
  saveToken(null);
  if (token && window.google) window.google.accounts.oauth2.revoke(token);
}

// ------------------------------------------------------------------ API Drive

async function call(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } });
  if (res.status === 401) {
    saveToken(null);
    throw new DriveAuthError('Session Google expirée : reconnecte-toi.');
  }
  if (!res.ok) throw new Error(`Google Drive a répondu ${res.status} : ${(await res.text()).slice(0, 200)}`);
  return res;
}

export interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
}

/** Valeur littérale dans une requête `q=` de l'API Drive : `\` et `'` doivent être échappés. */
function driveQuoted(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export async function ensureFolder(token: string, name = 'Notes Maths (synchronisation)'): Promise<string> {
  const q = encodeURIComponent(`name=${driveQuoted(name)} and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const found = (await (await call(token, `${API}/files?q=${q}&fields=files(id)&spaces=drive`)).json()) as { files: { id: string }[] };
  if (found.files.length) return found.files[0].id;
  const created = await call(token, `${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' }),
  });
  return ((await created.json()) as { id: string }).id;
}

export async function listFiles(token: string, folderId: string): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken = '';
  do {
    const q = encodeURIComponent(`${driveQuoted(folderId)} in parents and trashed=false`);
    const url = `${API}/files?q=${q}&fields=nextPageToken,files(id,name,modifiedTime)&pageSize=1000${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const data = (await (await call(token, url)).json()) as { files: DriveFile[]; nextPageToken?: string };
    files.push(...data.files);
    pageToken = data.nextPageToken ?? '';
  } while (pageToken);
  return files;
}

export async function deleteFile(token: string, id: string) {
  await call(token, `${API}/files/${id}`, { method: 'DELETE' });
}

// ------------------------------------------------------------------ copie de sauvegarde en un seul fichier

/** Une requête XHR (la seule qui donne l'avancement de l'ENVOI) ; 401 → reconnexion, autre échec → erreur claire */
function xhr(method: string, url: string, token: string, headers: Record<string, string>, body: Blob | string, onProgress?: (sent: number, total: number) => void): Promise<XMLHttpRequest> {
  return new Promise((resolve, reject) => {
    const req = new XMLHttpRequest();
    req.open(method, url);
    req.setRequestHeader('Authorization', `Bearer ${token}`);
    for (const [k, v] of Object.entries(headers)) req.setRequestHeader(k, v);
    if (onProgress) req.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded, e.total);
    req.onload = () => {
      if (req.status === 401) {
        saveToken(null);
        reject(new DriveAuthError('Session Google expirée : reconnecte-toi.'));
      } else if (req.status >= 200 && req.status < 300) resolve(req);
      else reject(new Error(`Google Drive a répondu ${req.status} : ${req.responseText.slice(0, 200)}`));
    };
    req.onerror = () => reject(new Error(navigator.onLine ? 'Envoi interrompu (réseau).' : 'Pas de réseau : la copie repartira au retour de la connexion.'));
    req.send(body);
  });
}

/**
 * Envoie la sauvegarde (UN fichier) dans `folderId` sous le nom `name`, en remplaçant le fichier de même nom s'il
 * existe. Jusqu'à 5 Mo : une seule requête multipart (métadonnées + contenu). Au-delà : session reprenable ouverte
 * par une courte requête, puis TOUT le contenu dans une seule requête. `onProgress` suit l'envoi du fichier.
 */
export async function uploadBackupFile(token: string, folderId: string, name: string, blob: Blob, existingId: string | null, onProgress: (sent: number, total: number) => void): Promise<string> {
  const type = blob.type || 'application/json';
  const metadata = existingId ? { name } : { name, parents: [folderId] };
  const target = existingId ? `${UPLOAD}/files/${existingId}` : `${UPLOAD}/files`;
  const method = existingId ? 'PATCH' : 'POST';
  if (uploadMode(blob.size) === 'multipart') {
    const boundary = `notes-maths-${Math.random().toString(36).slice(2)}`;
    const [head, tail] = multipartFrame(metadata, type, boundary);
    const req = await xhr(method, `${target}?uploadType=multipart&fields=id`, token, { 'Content-Type': `multipart/related; boundary=${boundary}` }, new Blob([head, blob, tail]), (sent) =>
      onProgress(Math.min(blob.size, Math.max(0, sent - head.length)), blob.size),
    );
    return (JSON.parse(req.responseText) as { id: string }).id;
  }
  const session = await xhr(method, `${target}?uploadType=resumable&fields=id`, token, {
    'Content-Type': 'application/json; charset=UTF-8',
    'X-Upload-Content-Type': type,
    'X-Upload-Content-Length': String(blob.size),
  }, JSON.stringify(metadata));
  const location = session.getResponseHeader('Location');
  if (!location) throw new Error('Google Drive n’a pas ouvert la session d’envoi.');
  const req = await xhr('PUT', location, token, { 'Content-Type': type }, blob, onProgress);
  return (JSON.parse(req.responseText) as { id: string }).id;
}
