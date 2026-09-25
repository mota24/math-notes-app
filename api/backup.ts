/**
 * Sauvegarde intégrale sur Google Drive.
 *  - GET  : déclenchement planifié par Vercel Cron (tous les dimanches, voir vercel.json) ; refusé sans le
 *           secret CRON_SECRET que Vercel joint à ses appels.
 *  - POST : « Sauvegarder maintenant » depuis l'appli, par le propriétaire connecté (jeton Firebase).
 * Réponse : le compte rendu (aussi écrit dans Firestore, users/<uid>/state/backup).
 *
 * Le code partagé est chargé dans le gestionnaire (import dynamique) : si son chargement échoue, la réponse
 * dit pourquoi (et le journal Vercel aussi), au lieu d'une fonction qui tombe sans explication.
 */

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

const unexpected = (e: unknown) => {
  console.error('[sauvegarde] erreur serveur :', e);
  return json(500, { ok: false, error: `Erreur serveur : ${(e as Error)?.message ?? String(e)}` });
};

export async function GET(request: Request): Promise<Response> {
  try {
    const { isCron, runBackup } = await import('./_lib/server.js');
    if (!isCron(request)) return json(401, { ok: false, error: 'Réservé au déclenchement planifié.' });
    const status = await runBackup('cron');
    return json(status.ok ? 200 : 500, status);
  } catch (e) {
    return unexpected(e);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { HttpError, runBackup, verifyOwner } = await import('./_lib/server.js');
    try {
      await verifyOwner(request);
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { ok: false, error: e.message });
      throw e;
    }
    const status = await runBackup('manual');
    return json(status.ok ? 200 : 500, status);
  } catch (e) {
    return unexpected(e);
  }
}
