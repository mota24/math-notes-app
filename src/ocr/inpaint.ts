/**
 * Effacement d'un texte sur un scan, sans toucher au scan : on calcule une « rustine » (image posée par-dessus,
 * comme un calque) où l'encre des mots choisis est remplacée par le papier qui l'entoure. Sans DOM ni import de
 * valeur : exécuté dans un Web Worker (inpaint.worker.ts) et testé sous Node (tests/inpaint.test.ts).
 *
 * Remplissage « pull-push » multirésolution : l'image est réduite par paliers en ne gardant que les pixels de
 * papier (pull), puis reconstruite en comblant chaque trou par le palier plus grossier (push). Le papier autour
 * — dégradés d'éclairage, jaunissement, ombre de reliure — se prolonge sans raccord ni flou baveux, en quelques
 * dizaines de millisecondes pour une ligne de texte. Toute l'encre visible dans le cadre de lecture (y compris
 * celle des lignes voisines) est écartée des échantillons : elle ne déteint jamais dans le remplissage.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Écart minimal de luminosité entre l'encre et le papier pour qu'il y ait quelque chose à effacer */
const MIN_CONTRAST = 40;

const lum = (d: ArrayLike<number>, i: number) => 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];

/** Seuil d'Otsu (0–255) : sépare au mieux l'encre du papier dans ces pixels */
export function otsu(d: ArrayLike<number>, indices: Iterable<number>): number {
  const hist = new Float64Array(256);
  let n = 0;
  for (const i of indices) {
    hist[Math.max(0, Math.min(255, Math.round(lum(d, i))))]++;
    n++;
  }
  if (!n) return 128;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let from = 128;
  let to = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      from = to = t;
    } else if (between === best) to = t;
  }
  // Encre et papier bien séparés : tout un intervalle de seuils se vaut, on prend son milieu
  return (from + to) / 2;
}

/** Élargit un masque de `r` pixels (carré, en deux passes) : le liseré gris autour des lettres part aussi */
export function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return mask.slice();
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) tmp[y * w + k] = 1;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!tmp[y * w + x]) continue;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) out[k * w + x] = 1;
    }
  return out;
}

/**
 * Comble les pixels inconnus (`known` = 0) de `rgb` (3 valeurs par pixel) à partir des pixels connus. Les pixels
 * connus ne changent pas. Sans aucun pixel connu, l'image est laissée telle quelle.
 */
export function pullPush(rgb: Float32Array, known: Uint8Array, w: number, h: number): void {
  interface Level {
    w: number;
    h: number;
    /** Couleur prémultipliée par le poids */
    c: Float32Array;
    a: Float32Array;
  }
  const base: Level = { w, h, c: new Float32Array(w * h * 3), a: new Float32Array(w * h) };
  for (let i = 0; i < w * h; i++) {
    if (!known[i]) continue;
    base.a[i] = 1;
    base.c[i * 3] = rgb[i * 3];
    base.c[i * 3 + 1] = rgb[i * 3 + 1];
    base.c[i * 3 + 2] = rgb[i * 3 + 2];
  }
  const levels = [base];
  // Pull : chaque palier moyenne 2 × 2 pixels du précédent, pondérés par ce qu'ils savent
  while (levels[levels.length - 1].w > 1 || levels[levels.length - 1].h > 1) {
    const f = levels[levels.length - 1];
    const W = Math.ceil(f.w / 2);
    const H = Math.ceil(f.h / 2);
    const g: Level = { w: W, h: H, c: new Float32Array(W * H * 3), a: new Float32Array(W * H) };
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let a = 0;
        let r = 0;
        let gg = 0;
        let b = 0;
        for (let dy = 0; dy < 2; dy++)
          for (let dx = 0; dx < 2; dx++) {
            const fx = 2 * x + dx;
            const fy = 2 * y + dy;
            if (fx >= f.w || fy >= f.h) continue;
            const j = fy * f.w + fx;
            a += f.a[j];
            r += f.c[j * 3];
            gg += f.c[j * 3 + 1];
            b += f.c[j * 3 + 2];
          }
        const i = y * W + x;
        if (a > 0) {
          const weight = Math.min(1, a);
          g.a[i] = weight;
          g.c[i * 3] = (r / a) * weight;
          g.c[i * 3 + 1] = (gg / a) * weight;
          g.c[i * 3 + 2] = (b / a) * weight;
        }
      }
    levels.push(g);
  }
  if (levels[levels.length - 1].a[0] === 0) return; // aucun pixel connu
  // Push : du plus grossier au plus fin, chaque trou reçoit la couleur (interpolée) du palier au-dessus
  for (let l = levels.length - 2; l >= 0; l--) {
    const f = levels[l];
    const g = levels[l + 1];
    const color = (x: number, y: number, k: number) => {
      const i = Math.min(g.h - 1, Math.max(0, y)) * g.w + Math.min(g.w - 1, Math.max(0, x));
      return g.a[i] > 0 ? g.c[i * 3 + k] / g.a[i] : 0;
    };
    for (let y = 0; y < f.h; y++)
      for (let x = 0; x < f.w; x++) {
        const i = y * f.w + x;
        if (f.a[i] >= 1) continue;
        const gx = (x + 0.5) / 2 - 0.5;
        const gy = (y + 0.5) / 2 - 0.5;
        const x0 = Math.floor(gx);
        const y0 = Math.floor(gy);
        const tx = gx - x0;
        const ty = gy - y0;
        const rest = 1 - f.a[i];
        for (let k = 0; k < 3; k++) {
          const up =
            (1 - tx) * (1 - ty) * color(x0, y0, k) + tx * (1 - ty) * color(x0 + 1, y0, k) + (1 - tx) * ty * color(x0, y0 + 1, k) + tx * ty * color(x0 + 1, y0 + 1, k);
          f.c[i * 3 + k] += rest * up;
        }
        f.a[i] = 1;
      }
  }
  for (let i = 0; i < w * h; i++) {
    if (known[i]) continue;
    rgb[i * 3] = base.c[i * 3];
    rgb[i * 3 + 1] = base.c[i * 3 + 1];
    rgb[i * 3 + 2] = base.c[i * 3 + 2];
  }
}

/**
 * Ce que l'encre dit du caractère d'origine, mesuré sur les pixels (Tesseract LSTM ne donne ni famille, ni
 * graisse, ni inclinaison) :
 *  - `stem` : épaisseur typique des traits verticaux (px) — la graisse ;
 *  - `thin` : épaisseur des traits horizontaux fins (px) — le contraste plein / délié des polices à empattements ;
 *  - `foot` : largeur de l'encre juste au-dessus de la ligne de base, rapportée au milieu des lettres — les
 *    empattements (« pieds ») l'élargissent nettement ;
 *  - `slant` : inclinaison (décalage horizontal par pixel de hauteur) — l'italique.
 */
export interface InkStyle {
  stem: number;
  thin: number;
  foot: number;
  slant: number;
}

export interface EraseResult {
  /** La rustine : le cadre `patch` de l'image, encre des mots effacée (RGBA opaque) */
  pixels: Uint8ClampedArray;
  /** Couleur moyenne de l'encre effacée (r, g, b), pour écrire la correction de la même couleur */
  ink: [number, number, number];
  /** Pixels d'encre trouvés dans les mots (0 : rien à effacer) */
  inkPixels: number;
  /** Mesures du caractère d'origine ; null si trop peu d'encre pour conclure */
  style: InkStyle | null;
}

const medianOf = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = xs.sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return 0;
  const s = xs.sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))];
};

/** Un mot à mesurer : son cadre (px) et, si elle est connue, sa ligne de base (px) et la hauteur des capitales (px) */
export interface StyleProbe extends Rect {
  base?: number;
  cap?: number;
}

/** Mesure le style de l'encre `ink` (1 = encre) dans les mots `probes` */
export function measureInkStyle(ink: Uint8Array, w: number, h: number, probes: readonly StyleProbe[]): InkStyle | null {
  const hRuns: number[] = [];
  const vRuns: number[] = [];
  const foot: number[] = [];
  const mid: number[] = [];
  let pixels = 0;
  // Coordonnées (x, y) de l'encre, pour chercher l'inclinaison
  const points: [number, number][] = [];
  for (const r of probes) {
    const x0 = Math.max(0, Math.floor(r.x));
    const x1 = Math.min(w, Math.ceil(r.x + r.w));
    const y0 = Math.max(0, Math.floor(r.y));
    const y1 = Math.min(h, Math.ceil(r.y + r.h));
    for (let y = y0; y < y1; y++) {
      let run = 0;
      const rowRuns: number[] = [];
      for (let x = x0; x <= x1; x++) {
        const on = x < x1 && ink[y * w + x] === 1;
        if (on) {
          run++;
          pixels++;
          if ((x + y) % 2 === 0) points.push([x, y]);
        } else if (run) {
          rowRuns.push(run);
          run = 0;
        }
      }
      hRuns.push(...rowRuns);
      if (r.base !== undefined && r.cap) {
        const fromBase = r.base - y;
        const total = rowRuns.reduce((a, b) => a + b, 0);
        if (fromBase > 0 && fromBase <= Math.max(1.5, r.cap * 0.1)) foot.push(total);
        else if (fromBase >= r.cap * 0.3 && fromBase <= r.cap * 0.55) mid.push(total);
      }
    }
    for (let x = x0; x < x1; x++) {
      let run = 0;
      for (let y = y0; y <= y1; y++) {
        const on = y < y1 && ink[y * w + x] === 1;
        if (on) run++;
        else if (run) {
          vRuns.push(run);
          run = 0;
        }
      }
    }
  }
  if (pixels < 40) return null;

  // Inclinaison : le cisaillement qui rend les colonnes d'encre les plus nettes (les fûts deviennent verticaux)
  let slant = 0;
  let best = -1;
  const cy = points.reduce((a, p) => a + p[1], 0) / Math.max(1, points.length);
  for (let s = -0.1; s <= 0.45 + 1e-9; s += 0.025) {
    const cols = new Map<number, number>();
    for (const [x, y] of points) {
      const k = Math.round(x + s * (y - cy));
      cols.set(k, (cols.get(k) ?? 0) + 1);
    }
    let sharp = 0;
    for (const c of cols.values()) sharp += c * c;
    if (sharp > best + 1e-9) {
      best = sharp;
      slant = s;
    }
  }
  const midWidth = medianOf(mid);
  return {
    stem: medianOf(hRuns),
    thin: quantile(vRuns, 0.25),
    foot: midWidth > 0 ? medianOf(foot) / midWidth : 1,
    slant: Math.round(slant * 1000) / 1000,
  };
}

/**
 * Efface l'encre des `words` (rectangles en pixels de l'image `data`) et renvoie la rustine du cadre `patch`.
 * `halo` : nombre de pixels ajoutés autour de chaque lettre (bords adoucis par la numérisation).
 */
export function eraseText(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  words: readonly Rect[],
  patch: Rect,
  halo: number,
  probes: readonly StyleProbe[] = [],
): EraseResult {
  const inWords = new Uint8Array(w * h);
  for (const r of words)
    for (let y = Math.max(0, Math.floor(r.y)); y < Math.min(h, Math.ceil(r.y + r.h)); y++)
      for (let x = Math.max(0, Math.floor(r.x)); x < Math.min(w, Math.ceil(r.x + r.w)); x++) inWords[y * w + x] = 1;
  const wordPixels: number[] = [];
  for (let i = 0; i < w * h; i++) if (inWords[i]) wordPixels.push(i);
  let t = otsu(data, wordPixels);
  // Pas de vrai contraste encre / papier (zone blanche, grain du papier) : on n'efface rien
  let dark = 0;
  let nDark = 0;
  let light = 0;
  let nLight = 0;
  for (const i of wordPixels) {
    const l = lum(data, i);
    if (l <= t) {
      dark += l;
      nDark++;
    } else {
      light += l;
      nLight++;
    }
  }
  if (!nDark || !nLight || light / nLight - dark / nDark < MIN_CONTRAST) t = -1;

  // Encre partout dans le cadre de lecture (écartée des échantillons de papier) ; encre des mots (effacée)
  const inkAll = new Uint8Array(w * h);
  const inkWords = new Uint8Array(w * h);
  const inkLums: number[] = [];
  let inkPixels = 0;
  for (let i = 0; i < w * h; i++) {
    const l = lum(data, i);
    if (l > t) continue;
    inkAll[i] = 1;
    if (!inWords[i]) continue;
    inkWords[i] = 1;
    inkLums.push(l);
    inkPixels++;
  }
  // Le cœur du trait (la moitié la plus foncée) donne la vraie couleur de l'encre, sans le liseré mêlé de papier
  const median = inkLums.sort((x, y) => x - y)[Math.floor(inkLums.length / 2)] ?? 0;
  let r = 0;
  let g = 0;
  let b = 0;
  let core = 0;
  for (let i = 0; i < w * h; i++) {
    if (!inkWords[i] || lum(data, i) > median) continue;
    r += data[i * 4];
    g += data[i * 4 + 1];
    b += data[i * 4 + 2];
    core++;
  }
  const erase = dilate(inkWords, w, h, halo);
  const avoid = dilate(inkAll, w, h, halo);

  const rgb = new Float32Array(w * h * 3);
  const known = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    rgb[i * 3] = data[i * 4];
    rgb[i * 3 + 1] = data[i * 4 + 1];
    rgb[i * 3 + 2] = data[i * 4 + 2];
    known[i] = avoid[i] ? 0 : 1;
  }
  pullPush(rgb, known, w, h);

  const px = Math.max(0, Math.floor(patch.x));
  const py = Math.max(0, Math.floor(patch.y));
  const pw = Math.max(1, Math.min(w - px, Math.round(patch.w)));
  const ph = Math.max(1, Math.min(h - py, Math.round(patch.h)));
  const pixels = new Uint8ClampedArray(pw * ph * 4);
  for (let y = 0; y < ph; y++)
    for (let x = 0; x < pw; x++) {
      const i = (py + y) * w + (px + x);
      const o = (y * pw + x) * 4;
      // Hors des lettres effacées, le scan tel quel : la rustine se fond dans la page, sans cadre visible
      const src = erase[i] ? [rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]] : [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
      pixels[o] = src[0];
      pixels[o + 1] = src[1];
      pixels[o + 2] = src[2];
      pixels[o + 3] = 255;
    }
  const ink: [number, number, number] = core ? [Math.round(r / core), Math.round(g / core), Math.round(b / core)] : [29, 36, 51];
  return { pixels, ink, inkPixels, style: probes.length && inkPixels ? measureInkStyle(inkWords, w, h, probes) : null };
}
