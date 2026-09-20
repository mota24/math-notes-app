import { PDFDocument } from 'pdf-lib';

/**
 * Assemble des pages rendues en canvas (export « manuscrit lisible ») en un PDF, une image JPEG par page A4.
 * Dans son propre module pour que pdf-lib ne soit chargé qu'au moment d'un export (import() dynamique).
 */
export async function canvasesToPdf(canvases: HTMLCanvasElement[]): Promise<Blob> {
  const pdf = await PDFDocument.create();
  for (const canvas of canvases) {
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Impossible de créer l’image de la page.'))), 'image/jpeg', 0.9),
    );
    const image = await pdf.embedJpg(await blob.arrayBuffer());
    const page = pdf.addPage([595.28, 841.89]);
    page.drawImage(image, { x: 0, y: 0, width: 595.28, height: 841.89 });
  }
  return new Blob([(await pdf.save()) as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
}
