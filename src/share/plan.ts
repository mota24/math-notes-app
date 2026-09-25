import type { Page } from '../db/schema';

/**
 * Logique pure du partage en lecture seule (sans Firebase ni DOM) : testée sous Node (`npm test`).
 *
 * Un cahier partagé vit dans Firestore sous shares/<id secret> :
 *  - le document lui-même : titre, ordre des pages, taille de chaque page, et la version (updatedAt) de chaque
 *    page et de chaque fond déjà envoyés — c'est ce qui rend les mises à jour incrémentales ;
 *  - shares/<id>/pages/<pageId> : la page (dimensions, papier, traits) en JSON ;
 *  - shares/<id>/bgs/<pageId> : son fond PDF ou photo, en image JPEG, envoyé une seule fois.
 */

export const SHARE_VERSION = 1;

/** Ce que contient le document shares/<id> */
export interface ShareDoc {
  v: number;
  owner: string;
  notebookId: string;
  title: string;
  pageIds: string[];
  /** [largeur, hauteur] en mm : le lecteur réserve la place de chaque page avant de la charger */
  sizes: Record<string, [number, number]>;
  /** updatedAt de chaque page envoyée */
  versions: Record<string, number>;
  /** Fond envoyé pour chaque page (voir bgKey) */
  bgKeys: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

/** Une page telle que le lecteur la reçoit */
export interface SharedPage {
  id: string;
  width: number;
  height: number;
  paper: Page['paper'];
  paperColor?: Page['paperColor'];
  strokes: Page['strokes'];
  /** La page a un fond (PDF, photo) à chercher dans bgs/<id> */
  bg: boolean;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Identifiant secret d'un lien : 22 caractères tirés au hasard par le générateur cryptographique du
 * navigateur (≈ 130 bits). Impossible à deviner ; la liste des partages, elle, n'est lisible par personne.
 */
export function newShareId(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const out: string[] = [];
  // Rejet des octets ≥ 248 (= 4 × 62) : chaque caractère est équiprobable
  while (out.length < 22) {
    for (const b of random(32)) {
      if (b < 248 && out.length < 22) out.push(ALPHABET[b % 62]);
    }
  }
  return out.join('');
}

/** Forme attendue d'un identifiant de lien (sert aussi à reconnaître l'adresse /share/<id>) */
export const SHARE_ID_RE = /^[A-Za-z0-9]{16,64}$/;

/** Clé du fond d'une page : change si la page reçoit un autre PDF ou une autre photo (null = papier seul) */
export function bgKey(page: Pick<Page, 'pdf' | 'image'>): string | null {
  if (page.pdf) return `pdf:${page.pdf.fileId}:${page.pdf.pageIndex}`;
  if (page.image) return `photo:${page.image.fileId}`;
  return null;
}

export function toSharedPage(page: Page): SharedPage {
  return {
    id: page.id,
    width: page.width,
    height: page.height,
    paper: page.paper,
    ...(page.paperColor ? { paperColor: page.paperColor } : {}),
    strokes: page.strokes,
    bg: bgKey(page) !== null,
  };
}

export interface SharePlan {
  /** Pages à (ré)envoyer : nouvelles ou modifiées depuis le dernier envoi */
  pages: Page[];
  /** Pages dont le fond est à envoyer (nouveau fond, ou fond changé) */
  bgs: Page[];
  /** Pages retirées du cahier : leurs documents (page et fond) sont à supprimer */
  removed: string[];
  /** Pages toujours là mais qui n'ont plus de fond : l'ancien fond est à supprimer */
  bgRemoved: string[];
}

/** Ce qu'il faut envoyer pour que le partage rattrape le cahier local, sans rien renvoyer d'inchangé. */
export function planShare(local: readonly Page[], remote: Pick<ShareDoc, 'pageIds' | 'versions' | 'bgKeys'> | null): SharePlan {
  const versions = remote?.versions ?? {};
  const bgKeys = remote?.bgKeys ?? {};
  const present = new Set(local.map((p) => p.id));
  return {
    pages: local.filter((p) => versions[p.id] !== p.updatedAt),
    bgs: local.filter((p) => {
      const key = bgKey(p);
      return key !== null && bgKeys[p.id] !== key;
    }),
    removed: (remote?.pageIds ?? []).filter((id) => !present.has(id)),
    bgRemoved: local.filter((p) => bgKey(p) === null && bgKeys[p.id] !== undefined).map((p) => p.id),
  };
}
