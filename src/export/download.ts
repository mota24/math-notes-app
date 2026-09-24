export function safeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'notes';
}

/** Récupère un fichier généré : dossier Téléchargements du navigateur. */
export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  const name = safeFilename(filename);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
