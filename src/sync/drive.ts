/**
 * Accès à Google Drive depuis le navigateur, sans serveur :
 * - connexion avec Google Identity Services (jeton valable 1 h) ;
 * - portée drive.file : l'appli ne voit QUE les fichiers qu'elle a créés.
 * Nécessite un « ID client OAuth » (gratuit) et une adresse https:// ou http://localhost.
 */

import { isNativeApp } from '../platform';

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
  // Google interdit la connexion OAuth depuis une WebView (erreur « disallowed_useragent »)
  if (isNativeApp()) {
    return {
      ok: false,
      reason:
        'Indisponible dans l’application Android : Google refuse la connexion depuis une WebView. Utilise « Sauvegarde sur fichier » ci-dessous (partage vers Drive, mail…) pour garder tes notes en lieu sûr.',
    };
  }
  const { protocol, hostname } = window.location;
  if (protocol === 'https:' || hostname === 'localhost' || hostname === '127.0.0.1') return { ok: true };
  return {
    ok: false,
    reason: 'Google n’autorise la connexion que sur une adresse https:// (appli en ligne) ou http://localhost (sur le PC).',
  };
}

export function currentToken(): string | null {
  try {
    const saved = JSON.parse(localStorage.getItem(TOKEN_KEY) ?? 'null') as { value: string; expiresAt: number } | null;
    if (saved && saved.expiresAt - 60_000 > Date.now()) return saved.value;
  } catch {
    /* jeton illisible */
  }
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
        localStorage.setItem(TOKEN_KEY, JSON.stringify({ value: response.access_token, expiresAt }));
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
  localStorage.removeItem(TOKEN_KEY);
  if (token && window.google) window.google.accounts.oauth2.revoke(token);
}

// ------------------------------------------------------------------ API Drive

async function call(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
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

export async function ensureFolder(token: string, name = 'Notes Maths (synchronisation)'): Promise<string> {
  const q = encodeURIComponent(`name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
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
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const url = `${API}/files?q=${q}&fields=nextPageToken,files(id,name,modifiedTime)&pageSize=1000${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const data = (await (await call(token, url)).json()) as { files: DriveFile[]; nextPageToken?: string };
    files.push(...data.files);
    pageToken = data.nextPageToken ?? '';
  } while (pageToken);
  return files;
}

export async function uploadFile(token: string, folderId: string, name: string, blob: Blob, existingId?: string): Promise<string> {
  const type = blob.type || 'application/octet-stream';
  if (existingId) {
    const res = await call(token, `${UPLOAD}/files/${existingId}?uploadType=media&fields=id`, {
      method: 'PATCH',
      headers: { 'Content-Type': type },
      body: blob,
    });
    return ((await res.json()) as { id: string }).id;
  }
  const boundary = `notes-maths-${Math.random().toString(36).slice(2)}`;
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [folderId] })}\r\n`,
    `--${boundary}\r\nContent-Type: ${type}\r\n\r\n`,
    blob,
    `\r\n--${boundary}--`,
  ]);
  const res = await call(token, `${UPLOAD}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return ((await res.json()) as { id: string }).id;
}

export async function downloadFile(token: string, id: string): Promise<Blob> {
  return (await call(token, `${API}/files/${id}?alt=media`)).blob();
}

export async function deleteFile(token: string, id: string) {
  await call(token, `${API}/files/${id}`, { method: 'DELETE' });
}
