import type { Worker as OcrWorker } from 'tesseract.js';
import { fromTesseract } from './textModel';
import type { OcrBlocks, TextWord } from './textModel';

/**
 * Le moteur de lecture (Tesseract.js). Tout tourne dans un Web Worker : l'interface reste fluide pendant la
 * lecture d'une page. Rien n'est chargé au démarrage de l'appli ; au premier scan lu, le navigateur télécharge
 * le moteur (~4 Mo) et les langues française et anglaise (~3,6 Mo), servis par le site lui-même puis gardés
 * pour les fois suivantes (hors-ligne compris). Le worker est libéré après deux minutes sans lecture : il
 * occupe plus de 100 Mo de mémoire, précieux sur une tablette.
 */

const BASE = `${import.meta.env.BASE_URL}ocr/${import.meta.env.VITE_OCR_VERSION}/`;
const IDLE_MS = 120_000;

/** Le navigateur exécute-t-il les instructions WebAssembly SIMD (moteur plus rapide) ? */
function simd(): boolean {
  try {
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch {
    return false;
  }
}

export interface OcrProgress {
  /** Étape en clair : téléchargement du moteur, des langues, lecture */
  status: string;
  /** 0 → 1 */
  progress: number;
}

const listeners = new Set<(p: OcrProgress) => void>();
/** Suit l'avancement du moteur (chargement puis lecture). Renvoie de quoi se désabonner. */
export function onOcrProgress(fn: (p: OcrProgress) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const STATUS: Record<string, string> = {
  'loading tesseract core': 'Chargement du moteur de lecture…',
  'initializing tesseract': 'Démarrage du moteur…',
  'loading language traineddata': 'Chargement du français et de l’anglais…',
  'initializing api': 'Démarrage du moteur…',
  'recognizing text': 'Lecture du texte…',
};

let worker: Promise<OcrWorker> | null = null;
let idle = 0;

function getWorker(): Promise<OcrWorker> {
  worker ??= (async () => {
    const { createWorker, OEM } = await import('tesseract.js');
    const w = await createWorker(['fra', 'eng'], OEM.LSTM_ONLY, {
      workerPath: `${BASE}worker.min.js`,
      corePath: `${BASE}${simd() ? 'core-simd-lstm.wasm.js' : 'core-lstm.wasm.js'}`,
      langPath: BASE.replace(/\/$/, ''),
      gzip: true,
      // Worker chargé depuis le site (et non recopié dans un blob:) : c'est ce que la CSP autorise
      workerBlobURL: false,
      logger: (m) => {
        const status = STATUS[m.status] ?? m.status;
        for (const fn of listeners) fn({ status, progress: m.progress });
      },
    });
    // Mise en page conservée (colonnes, tableaux de plans techniques) et espaces multiples respectés
    await w.setParameters({ preserve_interword_spaces: '1' });
    return w;
  })();
  worker.catch(() => (worker = null));
  return worker;
}

function scheduleRelease() {
  window.clearTimeout(idle);
  idle = window.setTimeout(() => {
    const w = worker;
    worker = null;
    void w?.then((x) => x.terminate()).catch(() => undefined);
  }, IDLE_MS);
}

/** Une lecture à la fois : le worker n'en traite qu'une, et la mémoire de la tablette est limitée */
let queue: Promise<unknown> = Promise.resolve();

/** Lit le texte d'une image (page de PDF rendue, photo). Positions en fractions de l'image. */
export function recognize(image: HTMLCanvasElement): Promise<TextWord[]> {
  const run = queue.then(async () => {
    window.clearTimeout(idle);
    try {
      const w = await getWorker();
      const { data } = await w.recognize(image, {}, { blocks: true, text: false });
      return fromTesseract(data as OcrBlocks, image.width, image.height);
    } finally {
      scheduleRelease();
    }
  });
  queue = run.catch(() => undefined);
  return run;
}
