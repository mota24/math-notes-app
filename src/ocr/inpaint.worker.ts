import { eraseText } from './inpaint';
import type { Rect } from './inpaint';

/**
 * Worker de l'effacement : le remplissage parcourt des centaines de milliers de pixels, hors du fil de
 * l'interface (le stylet et le défilement restent fluides pendant ce temps).
 */
export interface EraseJob {
  id: number;
  data: Uint8ClampedArray;
  width: number;
  height: number;
  words: Rect[];
  patch: Rect;
  halo: number;
}

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<EraseJob>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
};

scope.onmessage = (e) => {
  const job = e.data;
  try {
    const result = eraseText(job.data, job.width, job.height, job.words, job.patch, job.halo);
    scope.postMessage({ id: job.id, ok: true, ...result }, [result.pixels.buffer]);
  } catch (err) {
    scope.postMessage({ id: job.id, ok: false, error: (err as Error)?.message ?? String(err) }, []);
  }
};
