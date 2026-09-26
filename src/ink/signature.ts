/**
 * Signatures enregistrées : tracées une fois dans le cadre prévu, puis posées d'un toucher sur une page (en bas
 * des formulaires et rapports). Gardées SEULEMENT sur cet appareil (base locale, magasin `meta`, jamais
 * synchronisé ni inclus dans les sauvegardes) : une signature est une donnée personnelle sensible.
 * Sans import de valeur : testé sous Node (tests/signature.test.ts).
 */
import type { InkPoint } from './types';

export interface Signature {
  id: string;
  /** Traits en mm, origine au coin haut-gauche de l'encre (plus une petite marge) */
  strokes: InkPoint[][];
  width: number;
  height: number;
  createdAt: number;
}

/** Clé de la base locale */
export const SIGNATURES_KEY = 'signatures';
/** Signature complète, paraphe… : trois suffisent */
export const MAX_SIGNATURES = 3;
/** Taille posée par défaut (mm) : la largeur d'une signature en bas d'un formulaire */
export const PLACED_WIDTH = 45;
export const PLACED_MAX_HEIGHT = 22;

/**
 * Les traits du cadre de saisie (en pixels, `pxPerMm` pixels par mm) ramenés en mm, collés au coin haut-gauche
 * de l'encre avec `margin` mm tout autour. null : trop peu tracé pour être une signature.
 */
export function normalizeSignature(strokes: readonly InkPoint[][], pxPerMm: number, margin = 1): Omit<Signature, 'id' | 'createdAt'> | null {
  const points = strokes.flat();
  if (points.length < 4) return null;
  const minX = Math.min(...points.map((p) => p[0]));
  const minY = Math.min(...points.map((p) => p[1]));
  const maxX = Math.max(...points.map((p) => p[0]));
  const maxY = Math.max(...points.map((p) => p[1]));
  const width = (maxX - minX) / pxPerMm;
  const height = (maxY - minY) / pxPerMm;
  if (Math.max(width, height) < 3) return null;
  return {
    strokes: strokes.filter((s) => s.length).map((s) => s.map(([x, y, p]): InkPoint => [(x - minX) / pxPerMm + margin, (y - minY) / pxPerMm + margin, p])),
    width: width + 2 * margin,
    height: height + 2 * margin,
  };
}

/** Taille posée : largeur PLACED_WIDTH, sans dépasser PLACED_MAX_HEIGHT de haut ni la page */
export function placedSize(sig: Pick<Signature, 'width' | 'height'>, page: { width: number; height: number }): { w: number; h: number } {
  let k = PLACED_WIDTH / sig.width;
  if (sig.height * k > PLACED_MAX_HEIGHT) k = PLACED_MAX_HEIGHT / sig.height;
  k = Math.min(k, (page.width * 0.9) / sig.width, (page.height * 0.9) / sig.height);
  return { w: sig.width * k, h: sig.height * k };
}

/** Où la poser : en bas à droite de la page, là où l'on signe un formulaire */
export function placedAt(size: { w: number; h: number }, page: { width: number; height: number }): { x: number; y: number } {
  return { x: Math.max(0, page.width - size.w - 20), y: Math.max(0, page.height - size.h - 25) };
}

const isPoint = (p: unknown) => Array.isArray(p) && p.length === 3 && p.every((v) => typeof v === 'number' && Number.isFinite(v));

/** Les signatures lues dans la base locale, abîmées ou inconnues écartées */
export function readSignatures(raw: unknown): Signature[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (s): s is Signature =>
        !!s &&
        typeof s === 'object' &&
        typeof (s as Signature).id === 'string' &&
        typeof (s as Signature).width === 'number' &&
        typeof (s as Signature).height === 'number' &&
        Array.isArray((s as Signature).strokes) &&
        (s as Signature).strokes.every((st) => Array.isArray(st) && st.every(isPoint)),
    )
    .slice(0, MAX_SIGNATURES);
}
