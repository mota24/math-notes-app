import { HttpError, isCron, runBackup, verifyOwner } from './_lib/server.js';

/**
 * Sauvegarde intégrale sur Google Drive.
 *  - GET  : déclenchement planifié par Vercel Cron (tous les dimanches, voir vercel.json) ; refusé sans le
 *           secret CRON_SECRET que Vercel joint à ses appels.
 *  - POST : « Sauvegarder maintenant » depuis l'appli, par le propriétaire connecté (jeton Firebase).
 * Réponse : le compte rendu (aussi écrit dans Firestore, users/<uid>/state/backup).
 */

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

export async function GET(request: Request): Promise<Response> {
  if (!isCron(request)) return json(401, { ok: false, error: 'Réservé au déclenchement planifié.' });
  const status = await runBackup('cron');
  return json(status.ok ? 200 : 500, status);
}

export async function POST(request: Request): Promise<Response> {
  try {
    await verifyOwner(request);
  } catch (e) {
    const err = e instanceof HttpError ? e : new HttpError(500, 'Vérification impossible.');
    return json(err.status, { ok: false, error: err.message });
  }
  const status = await runBackup('manual');
  return json(status.ok ? 200 : 500, status);
}
