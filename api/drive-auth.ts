import { DRIVE_SCOPE } from './_lib/drive.js';
import { HttpError, env, firestore, newState, oauthClient, verifyOwner } from './_lib/server.js';

/**
 * Connexion de Google Drive à la sauvegarde hebdomadaire, une seule fois :
 *  - POST (appli, propriétaire connecté) : prépare une demande d'autorisation Google, portée drive.file
 *    (l'appli ne voit que ce qu'elle crée), et renvoie l'adresse où l'envoyer ;
 *  - GET (retour de Google) : échange le code contre un jeton de rafraîchissement, rangé côté serveur
 *    dans Firestore (backupConfig/drive : les règles l'interdisent à tout client), puis renvoie vers l'appli.
 * Le paramètre `state`, tiré au hasard et valable 15 minutes, empêche qu'un tiers glisse sa propre autorisation.
 */

const STATE_TTL = 15 * 60_000;

const origin = (request: Request) => env('APP_ORIGIN') ?? new URL(request.url).origin;
const redirectUri = (request: Request) => `${origin(request)}/api/drive-auth`;
const back = (request: Request, params: Record<string, string>) =>
  Response.redirect(`${origin(request)}/?${new URLSearchParams(params)}#/`, 302);

export async function POST(request: Request): Promise<Response> {
  try {
    const { uid, email } = await verifyOwner(request);
    const { clientId } = oauthClient();
    const state = newState();
    await firestore().doc('backupConfig/oauthState').set({ state, uid, createdAt: Date.now() });
    const url = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri(request),
      response_type: 'code',
      scope: DRIVE_SCOPE,
      // « offline » + « consent » : Google fournit un jeton de rafraîchissement durable, même à la reconnexion
      access_type: 'offline',
      prompt: 'consent',
      login_hint: email,
      state,
    })}`;
    return Response.json({ url }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    const err = e instanceof HttpError ? e : new HttpError(500, (e as Error)?.message ?? 'Erreur inattendue.');
    return Response.json({ error: err.message }, { status: err.status });
  }
}

export async function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams;
  if (q.get('error')) return back(request, { drive: 'error', message: 'Autorisation refusée ou annulée.' });
  const code = q.get('code');
  const state = q.get('state');
  if (!code || !state) return back(request, { drive: 'error', message: 'Réponse de Google incomplète.' });
  try {
    const db = firestore();
    const pending = await db.doc('backupConfig/oauthState').get();
    const uid = pending.get('uid') as string | undefined;
    if (!pending.exists || pending.get('state') !== state || !uid || Date.now() - Number(pending.get('createdAt') ?? 0) > STATE_TTL) {
      return back(request, { drive: 'error', message: 'Demande expirée ou inconnue : recommence depuis les Réglages.' });
    }
    await db.doc('backupConfig/oauthState').delete();

    const { clientId, clientSecret } = oauthClient();
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(request), client_id: clientId, client_secret: clientSecret }).toString(),
    });
    const body = (await res.json().catch(() => ({}))) as { refresh_token?: string; scope?: string; error?: string };
    if (!res.ok || !body.refresh_token) {
      console.error('[sauvegarde] échange du code Google refusé :', res.status, body.error);
      return back(request, { drive: 'error', message: 'Google n’a pas donné d’autorisation durable : recommence.' });
    }
    if (!(body.scope ?? '').includes(DRIVE_SCOPE)) {
      return back(request, { drive: 'error', message: 'L’accès à Google Drive n’a pas été accordé (case décochée ?).' });
    }
    const now = Date.now();
    await db.doc('backupConfig/drive').set({ refreshToken: body.refresh_token, uid, scope: body.scope, connectedAt: now });
    await db.doc(`users/${uid}/state/backup`).set({ connected: true, connectedAt: now }, { merge: true });
    return back(request, { drive: 'connected' });
  } catch (e) {
    console.error('[sauvegarde] connexion Drive :', e);
    const message = e instanceof HttpError ? e.message : 'Connexion à Google Drive impossible.';
    return back(request, { drive: 'error', message });
  }
}
