/**
 * L'écran partagé retenu pour chaque cahier : le cahier ouvert à côté (le PDF du cours, typiquement). Gardé sur
 * l'appareil ; l'éditeur le relit à son ouverture, la bibliothèque l'écrit pour « Ouvrir à côté ».
 */
export const SPLIT_KEY = 'notes-maths:split';

export function readSplits(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SPLIT_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function writeSplits(map: Record<string, string>) {
  try {
    localStorage.setItem(SPLIT_KEY, JSON.stringify(map));
  } catch {
    // Navigation privée, stockage plein : la préférence ne sera simplement pas retenue
  }
}

/** `sideId` s'affichera à côté de `mainId` à sa prochaine ouverture */
export function setSplit(mainId: string, sideId: string | null) {
  const map = readSplits();
  if (sideId) map[mainId] = sideId;
  else delete map[mainId];
  writeSplits(map);
}
