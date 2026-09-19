import { isNativeApp } from '../platform';
import { base64Chunks } from './base64';

export function safeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'notes';
}

/**
 * Dans l'appli Android (WebView), un lien vers un Blob ne télécharge rien. Le fichier est donc écrit dans
 * le cache de l'appli, par morceaux (voir base64.ts), puis proposé à la feuille de partage d'Android :
 * enregistrer dans Drive ou les fichiers, envoyer par mail, ouvrir dans un lecteur PDF…
 */
async function shareNative(blob: Blob, filename: string): Promise<void> {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
  // Un seul export gardé dans le cache : le précédent a déjà été partagé
  const folder = 'exports';
  await Filesystem.rmdir({ path: folder, directory: Directory.Cache, recursive: true }).catch(() => undefined);
  const path = `${folder}/${filename}`;
  let first = true;
  for await (const chunk of base64Chunks(blob)) {
    if (first) await Filesystem.writeFile({ path, data: chunk, directory: Directory.Cache, recursive: true });
    else await Filesystem.appendFile({ path, data: chunk, directory: Directory.Cache });
    first = false;
  }
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  try {
    await Share.share({ title: filename, files: [uri], dialogTitle: 'Enregistrer ou envoyer' });
  } catch (e) {
    // Fermer la feuille de partage sans rien choisir n'est pas une erreur
    if (!/cancel/i.test(e instanceof Error ? e.message : String(e))) throw e;
  }
}

/**
 * Récupère un fichier généré : dossier Téléchargements dans un navigateur, feuille de partage
 * d'Android dans l'appli.
 */
export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  const name = safeFilename(filename);
  if (isNativeApp()) return shareNative(blob, name);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
