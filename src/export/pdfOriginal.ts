import { BlendMode, PDFDocument, concatTransformationMatrix, degrees, popGraphicsState, pushGraphicsState, rgb } from 'pdf-lib';
import type { PDFImage, PDFPage } from 'pdf-lib';
import { db } from '../db/db';
import type { Page } from '../db/schema';
import { HIGHLIGHT_ALPHA, PAPER_BACKGROUND, braceDepth, bracePathD, dashPattern, paperLines, parenPathD, strokeSvgPath } from '../ink/draw';
import { strokeBBox } from '../ink/geometry';
import { sheetRanges } from '../ink/pageExtent';
import { volumeParts } from '../ink/volumes';
import type { PaperColor, Stroke } from '../ink/types';
import { printPngBytes } from './printImage';
import { textStrokePng } from './textImage';
import { printColor } from './printInk';

const f3 = (v: number) => v.toFixed(3);

const PT_PER_MM = 72 / 25.4;

function color(hex: string) {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function dataUrlBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function fileBytes(fileId: string, what: string) {
  const file = await db.getFile(fileId);
  if (!file) throw new Error(`${what} n’est pas sur cet appareil (synchronisation en cours ?).`);
  return { bytes: await file.blob.arrayBuffer(), type: file.type };
}

/**
 * Ce que dessine `draw`, tourné de l'angle du trait (sens horaire à l'écran) autour du centre de son
 * rectangle, dans le même repère mm → points que le reste de la page : une forme à deux coins ou une
 * image tourne ainsi (les autres traits tournent en réécrivant leurs points).
 */
function rotated(target: PDFPage, box: { x: number; y: number; height: number }, scale: number, s: Stroke, draw: () => void) {
  if (!s.angle || s.points.length < 2) return draw();
  const cx = box.x + ((s.points[0][0] + s.points[1][0]) / 2) * scale;
  const cy = box.y + box.height - ((s.points[0][1] + s.points[1][1]) / 2) * scale;
  // L'axe y d'un PDF monte : ce qui tourne dans le sens horaire à l'écran tourne de −angle
  const cos = Math.cos(s.angle);
  const sin = Math.sin(s.angle);
  target.pushOperators(pushGraphicsState(), concatTransformationMatrix(cos, -sin, sin, cos, cx - cos * cx - sin * cy, cy + sin * cx - cos * cy));
  draw();
  target.pushOperators(popGraphicsState());
}

/**
 * Un trait « forme » (cercle, tampon…) exporté en vectoriel pur : primitives pdf-lib plutôt qu'un
 * contour de trait, net à tout zoom, dans le même repère (mm → points) que le reste de la page.
 */
function drawShapeOnPdf(
  target: PDFPage,
  box: { x: number; y: number; width: number; height: number },
  scale: number,
  s: Stroke,
) {
  if (!s.shape || s.points.length < 2) return;
  const [ax, ay] = s.points[0];
  const [bx, by] = s.points[1];
  const x0 = Math.min(ax, bx);
  const y0 = Math.min(ay, by);
  const x1 = Math.max(ax, bx);
  const y1 = Math.max(ay, by);
  const w = Math.max(1e-3, x1 - x0);
  const h = Math.max(1e-3, y1 - y0);
  const c = color(s.color);
  const strokeMm = Math.max(0.35, s.size);
  /** Épaisseur en points, pour les primitives pdf-lib qui travaillent en unités de page. */
  const weight = strokeMm * scale;
  const dashed = !!s.dashed;
  const dashMm = dashPattern(strokeMm);
  const dashPt = [dashMm[0] * scale, dashMm[1] * scale];
  const toX = (x: number) => box.x + x * scale;
  const toY = (y: number) => box.y + box.height - y * scale;
  const line = (px1: number, py1: number, px2: number, py2: number, broken = false) =>
    target.drawLine({
      start: { x: toX(px1), y: toY(py1) },
      end: { x: toX(px2), y: toY(py2) },
      thickness: weight,
      color: c,
      ...(broken ? { dashArray: dashPt } : {}),
    });
  /**
   * Chemin donné en coordonnées page (mm), comme les traits d'encre. Attention : pdf-lib applique
   * l'échelle AVANT l'épaisseur et les tirets, qui se donnent donc ici en mm, pas en points.
   */
  const path = (d: string, opts: { fill?: boolean; broken?: boolean }) =>
    target.drawSvgPath(d, {
      x: box.x,
      y: box.y + box.height,
      scale,
      ...(opts.fill ? { color: c } : { borderColor: c, borderWidth: strokeMm }),
      ...(opts.broken ? { borderDashArray: dashMm } : {}),
    });
  /** Pointe de flèche pleine (repères) : hampe + triangle rempli, net à toute taille. */
  const vectorHead = (px1: number, py1: number, px2: number, py2: number) => {
    const angle = Math.atan2(py2 - py1, px2 - px1);
    const headMm = Math.max(strokeMm * 3.2, 3.5);
    const backX = px2 - headMm * Math.cos(angle);
    const backY = py2 - headMm * Math.sin(angle);
    line(px1, py1, backX, backY);
    const wing = headMm * 0.55;
    const lx = backX + wing * Math.sin(angle);
    const ly = backY - wing * Math.cos(angle);
    const rx = backX - wing * Math.sin(angle);
    const ry = backY + wing * Math.cos(angle);
    path(`M${f3(px2)},${f3(py2)} L${f3(lx)},${f3(ly)} L${f3(rx)},${f3(ry)} Z`, { fill: true });
  };
  switch (s.shape) {
    case 'circle':
      target.drawEllipse({
        x: toX((x0 + x1) / 2),
        y: toY((y0 + y1) / 2),
        xScale: (w / 2) * scale,
        yScale: (h / 2) * scale,
        borderColor: c,
        borderWidth: weight,
        ...(dashed ? { borderDashArray: dashPt } : {}),
      });
      break;
    case 'rect':
      target.drawRectangle({
        x: toX(x0),
        y: toY(y1),
        width: w * scale,
        height: h * scale,
        borderColor: c,
        borderWidth: weight,
        ...(dashed ? { borderDashArray: dashPt } : {}),
      });
      break;
    case 'triangle':
      path(`M${f3(x0 + w / 2)},${f3(y0)} L${f3(x1)},${f3(y1)} L${f3(x0)},${f3(y1)} Z`, { broken: dashed });
      break;
    case 'arrow': {
      // Hampe (éventuellement en pointillés) + pointe ouverte en V, toujours pleine
      line(ax, ay, bx, by, dashed);
      const angle = Math.atan2(by - ay, bx - ax);
      const len = Math.max(strokeMm * 3.4, 3);
      for (const side of [-0.46, 0.46]) line(bx, by, bx - len * Math.cos(angle + side), by - len * Math.sin(angle + side));
      break;
    }
    case 'line':
      line(ax, ay, bx, by, dashed);
      break;
    case 'axes2d':
      vectorHead(x0, y1, x1, y1);
      vectorHead(x0, y1, x0, y0);
      break;
    case 'axes3d': {
      // Perspective cavalière : z strictement vertical, y strictement horizontal, x en diagonale à
      // 45° vers le bas-gauche (profondeur) — convention du dessin technique / bilan des actions mécaniques.
      const ox = x0 + w * 0.4;
      const oy = y0 + h * 0.62;
      const lenZ = (oy - y0) * 0.9;
      const lenY = (x1 - ox) * 0.9;
      const lenX = Math.min(ox - x0, y1 - oy) * 1.15;
      const diag = lenX * Math.SQRT1_2;
      vectorHead(ox, oy, ox, oy - lenZ);
      vectorHead(ox, oy, ox + lenY, oy);
      vectorHead(ox, oy, ox - diag, oy + diag);
      break;
    }
    case 'torseur': {
      // Deux grandes accolades qui se font face, le centre laissé vide pour les colonnes (comme à l'écran).
      const topY = y0 + h * 0.04;
      const botY = y1 - h * 0.04;
      const depth = braceDepth(w, h);
      path(bracePathD(x0 + w * 0.06, topY, botY, depth), {});
      path(bracePathD(x1 - w * 0.06, topY, botY, -depth), {});
      break;
    }
    case 'matrix': {
      // Deux grandes parenthèses dessinées, largement écartées : la place entre elles est pour les composantes.
      const topY = y0 + h * 0.04;
      const botY = y1 - h * 0.04;
      const bulge = w * 0.16;
      path(parenPathD(x0 + w * 0.12, topY, botY, bulge, true), {});
      path(parenPathD(x1 - w * 0.12, topY, botY, bulge, false), {});
      break;
    }
    default:
      // Volumes 3D : arêtes visibles en continu (ou en pointillés si demandé), arêtes cachées en tirets
      for (const part of volumeParts(s.shape, x0, y0, w, h)) path(part.d, { broken: dashed || !!part.hidden });
  }
}

export interface InkPdfOptions {
  /** Papier du cahier, pour les pages qui n'ont pas le leur */
  defaultPaperColor?: PaperColor;
  /**
   * Mode impression : fond blanc (réglures pâles), encre claire convertie en foncé. Les surligneurs,
   * faits pour rester colorés, gardent leur couleur.
   */
  print?: boolean;
}

/** Le trait tel qu'il doit s'imprimer sur du papier blanc */
function forPrint(s: Stroke): Stroke {
  if (s.tool === 'highlighter' || s.tool === 'image') return s;
  return { ...s, color: printColor(s.color) };
}

/**
 * PDF « comme dans l'appli » : papier réglé (clair ou sombre, comme à l'écran), page du PDF d'origine
 * ou photo, et les traits en vectoriel (net à tous les zooms, fichier léger).
 */
export async function exportInkPdf(
  pages: Page[],
  onProgress?: (done: number, total: number) => void,
  { defaultPaperColor = 'light', print = false }: InkPdfOptions = {},
): Promise<Blob> {
  const out = await PDFDocument.create();
  const sources = new Map<string, PDFDocument>();
  const embeddedImages = new Map<string, PDFImage>();
  const embedStrokeImage = async (dataUrl: string): Promise<PDFImage> => {
    let img = embeddedImages.get(dataUrl);
    if (!img) {
      // Les photos posées sur la page sont en JPEG (voir insertImageFile) : les passer à embedPng faisait
      // échouer TOUT l'export du cahier. L'impression, elle, renvoie toujours un PNG retouché.
      const printed = print ? await printPngBytes(dataUrl) : null;
      if (printed) img = await out.embedPng(printed);
      else if (/^data:image\/jpe?g/i.test(dataUrl)) img = await out.embedJpg(dataUrlBytes(dataUrl));
      else img = await out.embedPng(dataUrlBytes(dataUrl));
      embeddedImages.set(dataUrl, img);
    }
    return img;
  };

  /** Les traits d'une page, ou d'une feuille d'une longue page (`sheet`, en mm), sur le PDF, en vectoriel. */
  const drawInk = async (
    target: PDFPage,
    box: { x: number; y: number; width: number; height: number },
    scale: number,
    page: Page,
    sheet?: { top: number; bottom: number },
  ) => {
    for (const original of page.strokes) {
      // Une feuille ne reçoit que les traits qui la touchent : le reste n'est pas de sa page
      if (sheet) {
        const bb = strokeBBox(original);
        if (bb.maxY < sheet.top || bb.minY > sheet.bottom) continue;
      }
      const s = print ? forPrint(original) : original;
      if (s.tool === 'shape') {
        rotated(target, box, scale, s, () => drawShapeOnPdf(target, box, scale, s));
        continue;
      }
      if (s.tool === 'text' || s.tool === 'image') {
        let img: PDFImage;
        if (s.tool === 'text') {
          // Zone de texte : rendue en image nette (même police et mêmes lignes qu'à l'écran)
          const png = await textStrokePng(s);
          if (!png) continue;
          img = await out.embedPng(png);
        } else {
          if (!s.image || s.points.length < 2) continue;
          img = await embedStrokeImage(s.image);
        }
        const x0 = Math.min(s.points[0][0], s.points[1][0]);
        const y0 = Math.min(s.points[0][1], s.points[1][1]);
        const x1 = Math.max(s.points[0][0], s.points[1][0]);
        const y1 = Math.max(s.points[0][1], s.points[1][1]);
        rotated(target, box, scale, s, () =>
          target.drawImage(img, {
            x: box.x + x0 * scale,
            y: box.y + box.height - y1 * scale,
            width: (x1 - x0) * scale,
            height: (y1 - y0) * scale,
          }),
        );
        continue;
      }
      const highlight = s.tool === 'highlighter';
      target.drawSvgPath(strokeSvgPath(s), {
        x: box.x,
        y: box.y + box.height,
        scale,
        color: color(s.color),
        borderWidth: 0,
        ...(highlight ? { opacity: HIGHLIGHT_ALPHA, blendMode: BlendMode.Multiply } : {}),
      });
    }
  };

  for (const [i, page] of pages.entries()) {
    if (!page.pdf && !page.image) {
      // Page d'écriture : à l'impression, les feuilles A4 d'un canevas allongé deviennent autant de pages du PDF
      // À l'impression, le papier sombre devient du papier blanc ordinaire
      const paperColor = print ? 'light' : (page.paperColor ?? defaultPaperColor);
      const rules = paperLines(page.paper, page.width, page.height, paperColor);
      for (const sheet of sheetRanges(page.height)) {
        const target = out.addPage([page.width * PT_PER_MM, (sheet.bottom - sheet.top) * PT_PER_MM]);
        // Papier sombre : sans fond, l'encre claire du cahier serait blanche sur du blanc
        if (paperColor === 'dark') target.drawRectangle({ x: 0, y: 0, width: target.getWidth(), height: target.getHeight(), color: color(PAPER_BACKGROUND.dark) });
        for (const group of rules) {
          const c = color(group.color);
          for (const [x1, y1, x2, y2] of group.lines) {
            // Les réglures gardent leur place absolue sur la page : elles se prolongent d'une feuille à l'autre
            if (y2 < sheet.top || y1 > sheet.bottom) continue;
            target.drawLine({
              start: { x: x1 * PT_PER_MM, y: (sheet.bottom - Math.max(y1, sheet.top)) * PT_PER_MM },
              end: { x: x2 * PT_PER_MM, y: (sheet.bottom - Math.min(y2, sheet.bottom)) * PT_PER_MM },
              thickness: 0.35,
              color: c,
            });
          }
        }
        const box = target.getCropBox();
        const scale = box.width / page.width;
        // Repère décalé : le haut de cette feuille est à l'ordonnée sheet.top de la page
        await drawInk(target, { ...box, height: box.height + sheet.top * scale }, scale, page, sheet);
      }
      onProgress?.(i + 1, pages.length);
      continue;
    }
    let target: PDFPage;
    if (page.pdf) {
      let source = sources.get(page.pdf.fileId);
      if (!source) {
        source = await PDFDocument.load((await fileBytes(page.pdf.fileId, 'Le PDF d’origine')).bytes, { ignoreEncryption: true });
        sources.set(page.pdf.fileId, source);
      }
      const sourcePage = source.getPage(page.pdf.pageIndex);
      const angle = ((sourcePage.getRotation().angle % 360) + 360) % 360;
      if (angle === 0) {
        const [copied] = await out.copyPages(source, [page.pdf.pageIndex]);
        target = out.addPage(copied);
      } else {
        // Page marquée « tournée » : on la pose droite, comme elle s'affiche dans l'appli
        const embedded = await out.embedPage(sourcePage);
        const { width: w, height: h } = embedded;
        target = out.addPage(angle === 180 ? [w, h] : [h, w]);
        const placement =
          angle === 90 ? { x: 0, y: w, rotate: degrees(-90) } : angle === 180 ? { x: w, y: h, rotate: degrees(180) } : { x: h, y: 0, rotate: degrees(90) };
        target.drawPage(embedded, { ...placement, width: w, height: h });
      }
    } else {
      const { bytes, type } = await fileBytes(page.image!.fileId, 'La photo');
      const image = type === 'image/png' ? await out.embedPng(bytes) : await out.embedJpg(bytes);
      target = out.addPage([page.width * PT_PER_MM, page.height * PT_PER_MM]);
      target.drawImage(image, { x: 0, y: 0, width: target.getWidth(), height: target.getHeight() });
    }
    // Repère visible de la page (la zone de recadrage peut ne pas commencer en 0,0)
    const box = target.getCropBox();
    await drawInk(target, box, box.width / page.width, page);
    onProgress?.(i + 1, pages.length);
  }
  return new Blob([(await out.save()) as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
}
