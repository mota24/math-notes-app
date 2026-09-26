/**
 * Copie sur Google Drive depuis l'appareil : UN fichier JSON (l'export complet de la base), envoyé d'un bloc.
 * Sans import de valeur : testé sous Node (tests/driveUpload.test.ts).
 */

/**
 * Au-delà, Google refuse l'envoi « multipart » (métadonnées + contenu dans la même requête, 5 Mo au plus selon la
 * documentation de l'API Drive) : l'envoi « reprenable » ouvre la session par une courte requête, puis tout le
 * contenu part dans une seule requête.
 */
export const MULTIPART_MAX = 5 * 1024 * 1024;

export type UploadMode = 'multipart' | 'resumable';
export const uploadMode = (size: number): UploadMode => (size <= MULTIPART_MAX ? 'multipart' : 'resumable');

/** Dossier des copies faites depuis l'appareil (distinct de celui de la sauvegarde du serveur) */
export const DEVICE_BACKUP_FOLDER = 'Notes Maths (copies de l’appareil)';
/** Copies gardées sur Drive ; les plus anciennes partent */
export const DEVICE_BACKUP_KEEP = 8;
/** La copie automatique part au plus une fois par jour (l'export complet est lourd : PDF compris) */
export const AUTO_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Nom de la copie du jour : une seule par jour, remplacée si l'on en refait une */
export function backupName(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `notes-maths-sauvegarde-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
}

/** Les copies à supprimer : celles au-delà des `keep` plus récentes (le nom porte la date) */
export function backupsToPrune(names: readonly { id: string; name: string }[], keep = DEVICE_BACKUP_KEEP): string[] {
  return names
    .filter((f) => /^notes-maths-sauvegarde-\d{4}-\d{2}-\d{2}\.json$/.test(f.name))
    .sort((a, b) => b.name.localeCompare(a.name))
    .slice(keep)
    .map((f) => f.id);
}

/** La copie automatique est-elle due ? (changements depuis la dernière, et plus d'un jour écoulé) */
export const autoBackupDue = (lastAt: number | null, dirty: boolean, now: number) => dirty && (!lastAt || now - lastAt >= AUTO_INTERVAL_MS);

/** Le début et la fin du corps « multipart/related » : métadonnées JSON, puis le contenu entre les deux */
export function multipartFrame(metadata: Record<string, unknown>, contentType: string, boundary: string): [string, string] {
  return [
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
    `\r\n--${boundary}--`,
  ];
}

const mo = (n: number) => (n / 1024 / 1024).toFixed(1).replace('.', ',');

/** Texte de la barre de progression : seul l'envoi du fichier compte */
export function uploadProgress(sent: number, total: number): string {
  const pct = total ? Math.min(100, Math.floor((sent / total) * 100)) : 0;
  return `Envoi de la sauvegarde : ${pct} % (${mo(sent)} / ${mo(total)} Mo)`;
}
