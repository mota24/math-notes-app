/**
 * Un fichier passe au code natif d'Android en base64, par morceaux : une sauvegarde ou un PDF peut
 * peser des dizaines de Mo, trop pour un seul appel au pont JavaScript → Java.
 * Sans DOM ni import de valeur : testé sous Node (`npm test`).
 */

/** Taille brute (octets) d'un morceau : multiple de 3, pour que chaque morceau se code sans remplissage `=` */
export const RAW_CHUNK = 3 * 1024 * 1024;

/** Octets → base64, sans dépasser la limite d'arguments de String.fromCharCode */
export function bytesToBase64(bytes: Uint8Array): string {
  const STEP = 0x2000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += STEP) binary += String.fromCharCode(...bytes.subarray(i, i + STEP));
  return btoa(binary);
}

/**
 * Le contenu d'un Blob en morceaux base64 successifs : mis bout à bout, ils redonnent exactement le
 * base64 du fichier entier. Un Blob vide donne un seul morceau vide, pour que le fichier soit quand
 * même créé.
 */
export async function* base64Chunks(blob: Blob, rawChunk = RAW_CHUNK): AsyncGenerator<string> {
  if (blob.size === 0) {
    yield '';
    return;
  }
  for (let offset = 0; offset < blob.size; offset += rawChunk) {
    yield bytesToBase64(new Uint8Array(await blob.slice(offset, offset + rawChunk).arrayBuffer()));
  }
}
