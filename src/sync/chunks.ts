/**
 * Découpage des gros contenus pour Firestore, qui refuse un document de plus de 1 Mio (sans import de valeur :
 * testé sous Node, `npm test`).
 *
 *  - Un PDF ou une photo de fond part en morceaux BINAIRES de 900 Ko (type Bytes de Firestore, sans le
 *    surcoût de 33 % du base64), avec son empreinte SHA-256 : le fichier recomposé sur un autre appareil est
 *    vérifié octet pour octet avant d'être enregistré.
 *  - Une page trop lourde (photos posées dessus) part en morceaux de texte au lieu d'être ignorée : avant,
 *    elle restait seulement sur l'appareil, et ses annotations étaient perdues avec lui.
 */

/** Morceau d'un fichier : sous la limite de 1 Mio d'un document, avec de la marge pour son enveloppe */
export const FILE_CHUNK_BYTES = 900_000;
/** Morceau d'une page en JSON : 700 000 caractères, sous 1 Mio même si quelques-uns prennent plusieurs octets */
export const PAGE_PART_CHARS = 700_000;
/** Au-delà, un fichier reste sur l'appareil (le cloud gratuit fait 1 Go, et le recomposer sature un téléphone) */
export const MAX_SYNC_FILE_BYTES = 50 * 1024 * 1024;
/** Au-delà, une page reste sur l'appareil */
export const MAX_SYNC_PAGE_CHARS = 14_000_000;

/** Découpe un texte en morceaux d'au plus `size` caractères (au moins un morceau, même vide). */
export function splitText(text: string, size: number): string[] {
  if (text.length === 0) return [''];
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size));
  return parts;
}

/** Découpe des octets en vues successives d'au plus `size` octets (sans copie). */
export function splitBytes(bytes: Uint8Array, size: number): Uint8Array[] {
  if (bytes.length === 0) return [bytes];
  const parts: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) parts.push(bytes.subarray(i, i + size));
  return parts;
}

/** Recolle des morceaux d'octets dans l'ordre. */
export function joinBytes(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Empreinte en hexadécimal (pour comparer un SHA-256 recalculé à celui enregistré) */
export function toHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** Nombre de morceaux qu'occupera un contenu */
export const chunkCount = (length: number, size: number) => Math.max(1, Math.ceil(length / size));
