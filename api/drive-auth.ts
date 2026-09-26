/**
 * Connexion de Google Drive à la sauvegarde hebdomadaire, une seule fois :
 *  - POST (appli, propriétaire connecté) : prépare une demande d'autorisation Google, portée drive.file
 *    (l'appli ne voit que ce qu'elle crée), et renvoie l'adresse où l'envoyer ;
 *  - GET (retour de Google) : échange le code contre un jeton de rafraîchissement, rangé côté serveur
 *    dans Firestore (backupConfig/drive : les règles l'interdisent à tout client), puis renvoie vers l'appli.
 * Le paramètre `state`, tiré au hasard et valable 15 minutes, empêche qu'un tiers glisse sa propre autorisation.
 * Code partagé chargé dans le gestionnaire (voir api/backup.ts).
 */

const STATE_TTL = 15 * 60_000;

async function origin(request: Request): Promise<string> {
  const { env } = await import('./_lib/server.js');
  return env('APP_ORIGIN') ?? new URL(request.url).origin;
}
const redirectUri = async (request: Request) => `${await origin(request)}/api/drive-auth`;
const back = async (request: Request, params: Record<string, string>) => {
  let base: string;
  try {
    base = await origin(request);
  } catch {
    base = new URL(request.url).origin;
  }
  return Response.redirect(`${base}/?${new URLSearchParams(params)}#/`, 302);
};

export async function POST(request: Request): Promise<Response> {
  try {
    const { HttpError, firestore, newState, oauthClient, verifyOwner } = await import('./_lib/server.js');
    const { DRIVE_SCOPE } = await import('./_lib/drive.js');
    try {
      const { uid, email } = await verifyOwner(request);
      const { clientId } = oauthClient();
      const state = newState();
      await (await firestore()).doc('backupConfig/oauthState').set({ state, uid, createdAt: Date.now() });
      const url = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
        client_id: clientId,
        redirect_uri: await redirectUri(request),
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
      if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
      throw e;
    }
  } catch (e) {
    console.error('[sauvegarde] connexion Drive (début) :', e);
    return Response.json({ error: `Erreur serveur : ${(e as Error)?.message ?? String(e)}` }, { status: 500 });
  }
}

/**
 * DELETE (appli, propriétaire connecté) : déconnecte Google Drive — l'autorisation est révoquée chez Google,
 * puis effacée de Firestore avec l'état de la sauvegarde. Utilisé par la suppression du compte, avant que le
 * compte ne disparaisse (le jeton Firebase doit encore être valable).
 */
export async function DELETE(request: Request): Promise<Response> {
  const json = (status: number, body: unknown) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  try {
    const { HttpError, firestore, verifyOwner } = await import('./_lib/server.js');
    try {
      const { uid } = await verifyOwner(request);
      const db = await firestore();
      const link = db.doc('backupConfig/drive');
      const snap = await link.get();
      let disconnected = false;
      if (snap.exists && snap.get('uid') === uid) {
        const token = snap.get('refreshToken') as string | undefined;
        if (token) {
          // Révocation chez Google : même recopié, ce jeton ne donnerait plus accès à Drive
          await fetch('https://oauth2.googleapis.com/revoke', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token }).toString(),
          }).catch(() => undefined);
        }
        await link.delete();
        disconnected = true;
      }
      const pending = await db.doc('backupConfig/oauthState').get();
      if (pending.exists && pending.get('uid') === uid) await pending.ref.delete();
      await db.doc(`users/${uid}/state/backup`).delete();
      return json(200, { ok: true, disconnected });
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { ok: false, error: e.message });
      throw e;
    }
  } catch (e) {
    console.error('[sauvegarde] déconnexion Drive :', e);
    return json(500, { ok: false, error: `Erreur serveur : ${(e as Error)?.message ?? String(e)}` });
  }
}

export async function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams;
  // Le retour vers l'appli ne porte qu'un CODE : l'appli affiche son propre message. Un texte libre dans l'adresse
  // permettait à n'importe qui d'envoyer un lien affichant le message de son choix dans le bandeau de l'appli.
  if (q.get('error')) return back(request, { drive: 'error', reason: 'denied' });
  const code = q.get('code');
  const state = q.get('state');
  if (!code || !state) return back(request, { drive: 'error', reason: 'incomplete' });
  try {
    const { HttpError, firestore, oauthClient } = await import('./_lib/server.js');
    const { DRIVE_SCOPE } = await import('./_lib/drive.js');
    try {
      const db = await firestore();
      const pending = await db.doc('backupConfig/oauthState').get();
      const uid = pending.get('uid') as string | undefined;
      if (!pending.exists || pending.get('state') !== state || !uid || Date.now() - Number(pending.get('createdAt') ?? 0) > STATE_TTL) {
        return back(request, { drive: 'error', reason: 'expired' });
      }
      await db.doc('backupConfig/oauthState').delete();

      const { clientId, clientSecret } = oauthClient();
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: await redirectUri(request), client_id: clientId, client_secret: clientSecret }).toString(),
      });
      const body = (await res.json().catch(() => ({}))) as { refresh_token?: string; scope?: string; error?: string };
      if (!res.ok || !body.refresh_token) {
        console.error('[sauvegarde] échange du code Google refusé :', res.status, body.error);
        return back(request, { drive: 'error', reason: 'no-refresh' });
      }
      if (!(body.scope ?? '').includes(DRIVE_SCOPE)) {
        return back(request, { drive: 'error', reason: 'no-scope' });
      }
      const now = Date.now();
      await db.doc('backupConfig/drive').set({ refreshToken: body.refresh_token, uid, scope: body.scope, connectedAt: now });
      await db.doc(`users/${uid}/state/backup`).set({ connected: true, connectedAt: now }, { merge: true });
      return back(request, { drive: 'connected' });
    } catch (e) {
      if (e instanceof HttpError) return back(request, { drive: 'error', reason: e.status === 503 ? 'not-configured' : e.status === 403 ? 'forbidden' : 'session' });
      throw e;
    }
  } catch (e) {
    console.error('[sauvegarde] connexion Drive (retour) :', e);
    return back(request, { drive: 'error', reason: 'server' });
  }
}
