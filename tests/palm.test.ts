import assert from 'node:assert/strict';
import { InputClassifier } from '../src/ink/palm.ts';
import type { ClassifierConfig, Sample } from '../src/ink/palm.ts';

type Ev = string;

/** Contact simulé : position à chaque instant, un échantillon toutes les 8 ms entre from et to. */
interface Contact {
  id: number;
  size: number;
  from: number;
  to: number;
  pos: (time: number) => [number, number];
}

/** Générateur pseudo-aléatoire reproductible (Park-Miller) */
function rng(seed: number) {
  let x = seed;
  return () => {
    x = (x * 16807) % 2147483647;
    return x / 2147483647;
  };
}

/** Paume posée : glisse de roll px pendant rollMs en se posant, puis tremble (bruit + lente dérive). */
function palm(
  id: number, x: number, y: number, from: number, to: number,
  o: { amp?: number; roll?: [number, number]; rollMs?: number; drift?: [number, number]; seed?: number; size?: number } = {},
): Contact {
  const r = rng(o.seed ?? id * 7919);
  const amp = o.amp ?? 2;
  const [rx, ry] = o.roll ?? [0, 0];
  const [vx, vy] = o.drift ?? [0, 0];
  return {
    id, size: o.size ?? 250, from, to,
    pos: (time) => {
      const k = Math.min(1, (time - from) / (o.rollMs ?? 100));
      const w = Math.sin((time - from) / 250 + id) * amp * 0.5;
      const s = (time - from) / 1000;
      return [x + rx * k + vx * s + (r() * 2 - 1) * amp + w, y + ry * k + vy * s + (r() * 2 - 1) * amp - w];
    },
  };
}

/** Stylet : passe par les points [temps, x, y] à vitesse constante entre deux points, léger bruit. */
function pen(id: number, keys: [number, number, number][], size = 203): Contact {
  const r = rng(id * 104729);
  return {
    id, size, from: keys[0][0], to: keys[keys.length - 1][0],
    pos: (time) => {
      let i = 0;
      while (i < keys.length - 2 && time > keys[i + 1][0]) i++;
      const [t0, x0, y0] = keys[i];
      const [t1, x1, y1] = keys[i + 1];
      const k = t1 > t0 ? Math.min(1, Math.max(0, (time - t0) / (t1 - t0))) : 1;
      return [x0 + (x1 - x0) * k + (r() - 0.5) * 0.8, y0 + (y1 - y0) * k + (r() - 0.5) * 0.8];
    },
  };
}

function setup(overrides: Partial<ClassifierConfig> = {}) {
  const events: Ev[] = [];
  const timers: { at: number; fn: () => void }[] = [];
  let clock = 0;
  const cfg: ClassifierConfig = {
    mode: 'capacitive',
    sizeMode: 'manual',
    palmSize: 50,
    handedness: 'right',
    handTool: false,
    restTop: null,
    ...overrides,
  };
  const c = new InputClassifier(
    cfg,
    {
      drawStart: (id, kind, s) => events.push(`start:${id}:${kind}:${s.length}`),
      drawMove: (id) => events.push(`move:${id}`),
      drawEnd: (id) => events.push(`end:${id}`),
      drawCancel: (id) => events.push(`cancel:${id}`),
      panZoom: (dx, dy, _cx, _cy, f) => events.push(`pan:${dx.toFixed(0)},${dy.toFixed(0)},${f.toFixed(2)}`),
      twoFingerTap: () => events.push('tap2'),
      tap: (x, y) => events.push(`tap1:${x.toFixed(0)},${y.toFixed(0)}`),
      penDetected: () => events.push('pen!'),
      holdErase: (id) => events.push(`gomme:${id}`),
      shapeHold: (id) => events.push(`forme:${id}`),
      penSizeLearned: (px) => events.push(`appris:${px}`),
    },
    (fn, ms) => timers.push({ at: clock + ms, fn }),
  );
  const s = (x: number, y: number, size = 8): Sample => ({ x, y, p: 0.5, t: clock, size });
  const api = {
    c,
    events,
    at(t: number) {
      clock = t;
      // Draine aussi les minuteurs qu'un minuteur qui vient de sonner reprogramme pour ≤ clock
      // (ex. l'appui long qui retente) : sinon une seule chaîne de retentatives resterait bloquée.
      for (;;) {
        const due: typeof timers = [];
        const rest: typeof timers = [];
        for (const tm of timers.splice(0)) (tm.at <= clock ? due : rest).push(tm);
        timers.push(...rest);
        if (due.length === 0) break;
        for (const tm of due) tm.fn();
      }
      return api;
    },
    down(id: number, x: number, y: number, size = 8, kind: 'touch' | 'pen' | 'mouse' = 'touch') {
      c.down(kind, id, s(x, y, size));
      return api;
    },
    move(id: number, x: number, y: number, size = 8) {
      c.move(id, [s(x, y, size)]);
      return api;
    },
    /** Déplacement progressif, 2 px par échantillon, 8 ms entre échantillons */
    drag(id: number, from: [number, number], to: [number, number], size = 8) {
      const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / 2));
      for (let i = 1; i <= steps; i++) {
        clock += 8;
        api.move(id, from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps, size);
      }
      return api;
    },
    up(id: number, x: number, y: number, size = 8) {
      c.up(id, s(x, y, size));
      return api;
    },
    /** Joue plusieurs contacts en même temps, un échantillon toutes les 8 ms. */
    play(contacts: Contact[], end: number) {
      const phase = new Map<number, 'down' | 'up'>();
      for (let time = Math.min(...contacts.map((k) => k.from)); time <= end; time += 8) {
        api.at(time);
        for (const k of contacts) {
          if (time < k.from || phase.get(k.id) === 'up') continue;
          const [x, y] = k.pos(time);
          if (!phase.has(k.id)) {
            phase.set(k.id, 'down');
            api.down(k.id, x, y, k.size);
          } else if (time >= k.to) {
            phase.set(k.id, 'up');
            api.up(k.id, x, y, k.size);
          } else api.move(k.id, x, y, k.size);
        }
      }
      return api;
    },
    /** Le contact a écrit un trait gardé (commencé, terminé, jamais effacé) */
    wrote(id: number) {
      return api.count(`start:${id}:`) === 1 && api.count(`end:${id}`) === 1 && api.count(`cancel:${id}`) === 0;
    },
    /** Aucun trait de ce contact n’est resté sur la page */
    noInk(id: number) {
      return api.count(`end:${id}`) === 0 && api.count(`start:${id}:`) === api.count(`cancel:${id}`);
    },
    count(prefix: string) {
      return events.filter((e) => e.startsWith(prefix)).length;
    },
  };
  last = api;
  return api;
}

/** Dernier scénario créé : affiché en cas d’échec */
let last: { events: Ev[]; c: InputClassifier } | null = null;

const results: [string, () => void][] = [];
const test = (name: string, fn: () => void) => results.push([name, fn]);

test('1. trait simple au stylet capacitif', () => {
  const t = setup().at(0).down(1, 100, 100).drag(1, [100, 100], [140, 110]).up(1, 140, 110);
  assert.equal(t.count('start:1'), 1);
  assert.ok(t.count('move:1') > 5);
  assert.equal(t.count('end:1'), 1);
  assert.equal(t.count('cancel'), 0);
});

test('2. point (virgule décimale)', () => {
  const t = setup().at(0).down(1, 100, 100).at(80).up(1, 100, 100);
  assert.equal(t.count('start:1'), 1);
  assert.equal(t.count('end:1'), 1);
  assert.equal(t.events.length, 2);
});

test('3. grosse paume : jamais dessinée', () => {
  const t = setup().at(0).down(1, 300, 400, 120).drag(1, [300, 400], [320, 420], 120).at(900).up(1, 320, 420, 120);
  assert.equal(t.count('start'), 0);
});

test('4. paume qui grossit après avoir commencé un trait → annulée', () => {
  const t = setup().at(0).down(1, 300, 400, 20);
  t.drag(1, [300, 400], [310, 400], 20).move(1, 311, 400, 90);
  assert.equal(t.count('start:1'), 1);
  assert.equal(t.count('cancel:1'), 1);
});

test('5. paume posée d’abord, stylet ensuite au-dessus à gauche', () => {
  const t = setup().at(0).down(1, 320, 420, 30); // paume, immobile
  t.at(500).down(2, 200, 300, 6).drag(2, [200, 300], [240, 310], 6).up(2, 240, 310, 6);
  t.at(1500).up(1, 320, 420, 30);
  assert.equal(t.count('start:1'), 0, 'la paume ne doit pas écrire');
  assert.equal(t.count('start:2'), 1);
  assert.equal(t.count('end:2'), 1);
  assert.equal(t.count('cancel:2'), 0);
});

test('6. la paume se pose pendant l’écriture → le trait continue', () => {
  const t = setup().at(0).down(1, 200, 300, 6).drag(1, [200, 300], [230, 300], 6);
  t.down(2, 320, 420, 35).drag(1, [230, 300], [260, 305], 6).drag(2, [320, 420], [322, 421], 35);
  t.up(1, 260, 305, 6).up(2, 322, 421, 35);
  assert.equal(t.count('cancel:1'), 0);
  assert.equal(t.count('end:1'), 1);
  assert.equal(t.count('start:2'), 0);
});

test('7. défilement à deux doigts', () => {
  const t = setup().at(0).down(1, 100, 300, 20).at(40).down(2, 180, 300, 20);
  for (let i = 1; i <= 20; i++) t.at(40 + i * 10).move(1, 100, 300 - i * 3, 20).move(2, 180, 300 - i * 3, 20);
  t.up(1, 100, 240, 20).up(2, 180, 240, 20);
  assert.equal(t.count('start'), 0);
  assert.ok(t.count('pan') > 10);
  assert.equal(t.count('tap2'), 0);
});

test('8. zoom à deux doigts (écartement)', () => {
  const t = setup().at(0).down(1, 200, 300, 20).at(30).down(2, 260, 300, 20);
  for (let i = 1; i <= 20; i++) t.at(30 + i * 10).move(1, 200 - i * 3, 300, 20).move(2, 260 + i * 3, 300, 20);
  const factors = t.events.filter((e) => e.startsWith('pan')).map((e) => Number(e.split(',')[2]));
  assert.ok(factors.some((f) => f > 1.01), 'zoom avant attendu');
  assert.equal(t.count('start'), 0);
});

test('9. tap à deux doigts → annuler', () => {
  const t = setup().at(0).down(1, 100, 100, 20).at(30).down(2, 160, 100, 20).at(130).up(1, 100, 100, 20).at(150).up(2, 160, 100, 20);
  t.at(400);
  assert.equal(t.count('tap2'), 1);
  assert.equal(t.count('start'), 0);
});

test('10. paume et stylet posés ensemble, le stylet écrit', () => {
  const t = setup().at(0).down(1, 320, 420, 30).at(60).down(2, 200, 300, 6);
  t.drag(2, [200, 300], [240, 305], 6).up(2, 240, 305, 6);
  assert.equal(t.count('start:2'), 1);
  assert.ok(Number(t.events.find((e) => e.startsWith('start:2'))!.split(':')[3]) > 3, 'les premiers points sont rejoués');
  assert.equal(t.count('start:1'), 0);
});

test('11. paume posée + point au stylet dans la foulée', () => {
  const t = setup().at(0).down(1, 320, 420, 30).at(50).down(2, 200, 300, 6).at(140).up(2, 200, 300, 6);
  t.at(400); // la paume reste posée, le minuteur tranche
  assert.equal(t.count('start:2'), 1);
  assert.equal(t.count('end:2'), 1);
  assert.equal(t.count('tap2'), 0);
  t.at(900).up(1, 320, 420, 30);
  assert.equal(t.count('start:1'), 0);
});

test('12. paume qui glisse (trait parasite) puis stylet → parasite effacé', () => {
  const t = setup().at(0).down(1, 320, 420, 30).drag(1, [320, 420], [335, 425], 30);
  assert.equal(t.count('start:1'), 1);
  t.at(700).down(2, 200, 300, 6).drag(2, [200, 300], [240, 300], 6).up(2, 240, 300, 6);
  assert.equal(t.count('cancel:1'), 1);
  assert.equal(t.count('start:2'), 1);
});

test('13. sans taille de contact (toujours 1 px) : la position suffit', () => {
  const t = setup().at(0).down(1, 320, 420, 1); // paume
  t.at(600).down(2, 200, 300, 1).drag(2, [200, 300], [240, 300], 1).up(2, 240, 300, 1);
  assert.equal(t.count('start:1'), 0);
  assert.equal(t.count('start:2'), 1);
});

test('14. stylet actif détecté : le doigt déplace la page', () => {
  const t = setup({ mode: 'auto' }).at(0).down(1, 200, 300, 1, 'pen').drag(1, [200, 300], [230, 300], 1).up(1, 230, 300, 1);
  t.at(500).down(2, 100, 100, 20).drag(2, [100, 100], [100, 160], 20).up(2, 100, 160, 20);
  assert.equal(t.count('pen!'), 1);
  assert.equal(t.count('start:1:pen'), 1);
  assert.equal(t.count('start:2'), 0);
  assert.ok(t.count('pan') > 5);
});

test('15. après un zoom, le doigt restant n’écrit pas', () => {
  const t = setup().at(0).down(1, 200, 300, 20).at(30).down(2, 260, 300, 20);
  for (let i = 1; i <= 10; i++) t.at(30 + i * 10).move(1, 200 - i * 3, 300, 20).move(2, 260 + i * 3, 300, 20);
  t.up(1, 170, 300, 20).drag(2, [290, 300], [340, 320], 20).up(2, 340, 320, 20);
  assert.equal(t.count('start'), 0);
});

// ------------------------------------------------------------------------------------------
// Galaxy Tab S6 + stylet générique : le stylet est vu comme un doigt de 203 px, la paume aussi.
// La taille n'est plus utilisable : la position, le mouvement et la mémoire doivent suffire.
const HUGE: Partial<ClassifierConfig> = { sizeMode: 'auto' };

test('16. stylet géant (203 px) seul : il écrit', () => {
  const t = setup(HUGE).at(0).down(1, 200, 300, 203).drag(1, [200, 300], [240, 310], 203).up(1, 240, 310, 203);
  assert.equal(t.count('start:1'), 1);
  assert.equal(t.count('end:1'), 1);
  assert.equal(t.count('cancel'), 0);
});

test('17. paume géante posée, stylet géant au-dessus à gauche', () => {
  const t = setup(HUGE).at(0).down(1, 330, 520, 250);
  t.at(400).down(2, 200, 400, 203).drag(2, [200, 400], [240, 410], 203).up(2, 240, 410, 203);
  t.at(1200).up(1, 330, 520, 250);
  assert.equal(t.count('start:1'), 0);
  assert.equal(t.count('start:2'), 1);
  assert.equal(t.count('end:2'), 1);
});

test('18. stylet géant qui écrit, paume géante posée en bas à droite', () => {
  const t = setup(HUGE).at(0).down(1, 200, 400, 203).drag(1, [200, 400], [230, 400], 203);
  t.down(2, 330, 530, 260).drag(1, [230, 400], [270, 405], 203).drag(2, [330, 530], [333, 531], 260);
  t.up(1, 270, 405, 203).up(2, 333, 531, 260);
  assert.equal(t.count('cancel:1'), 0);
  assert.equal(t.count('end:1'), 1);
  assert.equal(t.count('start:2'), 0);
});

test('19. stylet et paume géants posés ensemble, le stylet écrit', () => {
  const t = setup(HUGE).at(0).down(1, 330, 520, 203).at(80).down(2, 200, 400, 203);
  t.drag(2, [200, 400], [240, 405], 203).up(2, 240, 405, 203);
  t.at(900).up(1, 330, 520, 203);
  assert.equal(t.count('start:2'), 1);
  assert.equal(t.count('start:1'), 0);
});

test('20. la paume se relève et se repose au même endroit : ignorée', () => {
  const t = setup(HUGE).at(0).down(1, 330, 520, 250).at(600).up(1, 330, 520, 250);
  t.at(900).down(2, 336, 524, 250).drag(2, [336, 524], [346, 530], 250).up(2, 346, 530, 250);
  assert.equal(t.count('start'), 0);
});

test('21. contact posé sous la main sans bouger : ignoré, ligne suivante écrite', () => {
  const t = setup(HUGE).at(0).down(1, 200, 300, 203).drag(1, [200, 300], [240, 300], 203).up(1, 240, 300, 203);
  t.at(500).down(2, 300, 500, 250).at(850).up(2, 300, 500, 250);
  assert.equal(t.count('start:2'), 0, 'effleurement de la main sous le stylet');
  t.at(900).down(3, 160, 340, 203).drag(3, [160, 340], [200, 345], 203).up(3, 200, 345, 203);
  assert.equal(t.count('start:3'), 1, 'ligne suivante');
});

test('22. paume qui glisse lentement : aucun trait', () => {
  const t = setup(HUGE).at(0).down(1, 300, 500, 203);
  for (let i = 1; i <= 25; i++) t.at(i * 60).move(1, 300 + i, 500, 203);
  t.up(1, 325, 500, 203);
  assert.equal(t.count('start'), 0);
});

test('23. zone de repos : contact ignoré, écriture au-dessus normale', () => {
  const t = setup({ ...HUGE, restTop: 600 }).at(0).down(1, 300, 650, 203);
  t.drag(1, [300, 650], [340, 650], 203).up(1, 340, 650, 203);
  assert.equal(t.count('start'), 0);
  t.at(500).down(2, 300, 400, 203).drag(2, [300, 400], [340, 400], 203).up(2, 340, 400, 203);
  assert.equal(t.count('start:2'), 1);
});

test('24. taille apprise : une paume nettement plus grosse est reconnue', () => {
  const t = setup(HUGE);
  let clock = 0;
  for (let k = 0; k < 8; k++) {
    const x = 100 + k * 50;
    t.at(clock).down(10 + k, x, 200, 203).drag(10 + k, [x, 200], [x + 30, 200], 203).up(10 + k, x + 30, 200, 203);
    clock += 3000;
  }
  assert.equal(t.c.learnedPenSize(), 203);
  t.at(clock).down(50, 300, 300, 420).drag(50, [300, 300], [330, 300], 420).up(50, 330, 300, 420);
  assert.equal(t.count('start:50'), 0, 'contact de 420 px = paume');
  t.at(clock + 3000).down(51, 300, 300, 230).drag(51, [300, 300], [330, 300], 230).up(51, 330, 300, 230);
  assert.equal(t.count('start:51'), 1, 'contact de 230 px = stylet');
});

test('25. annulation Android : un vrai trait est gardé, un début de trait est retiré', () => {
  const t = setup(HUGE).at(0).down(1, 200, 300, 203).drag(1, [200, 300], [240, 300], 203);
  t.c.cancel(1);
  assert.equal(t.count('end:1'), 1);
  assert.equal(t.count('cancel:1'), 0);
  t.at(3000).down(2, 200, 400, 203).drag(2, [200, 400], [210, 400], 203);
  t.c.cancel(2);
  assert.equal(t.count('cancel:2'), 1);
});

test('26. défilement à deux doigts géants', () => {
  const t = setup(HUGE).at(0).down(1, 100, 300, 203).at(40).down(2, 180, 300, 203);
  for (let i = 1; i <= 20; i++) t.at(40 + i * 10).move(1, 100, 300 - i * 3, 203).move(2, 180, 300 - i * 3, 203);
  t.up(1, 100, 240, 203).up(2, 180, 240, 203);
  assert.equal(t.count('start'), 0);
  assert.ok(t.count('pan') > 10);
});

test('27. pouce qui tient la tablette, loin du stylet : le trait continue', () => {
  const t = setup(HUGE).at(0).down(1, 600, 300, 203).drag(1, [600, 300], [640, 300], 203);
  t.down(2, 10, 250, 203).drag(1, [640, 300], [680, 310], 203).up(1, 680, 310, 203);
  assert.equal(t.count('cancel:1'), 0);
  assert.equal(t.count('end:1'), 1);
  assert.equal(t.count('start:2'), 0);
});

test('28. paume géante qui glisse vite puis stylet au-dessus : trait parasite effacé', () => {
  const t = setup(HUGE).at(0).down(1, 330, 520, 250).drag(1, [330, 520], [345, 525], 250);
  assert.equal(t.count('start:1'), 1);
  t.at(700).down(2, 200, 400, 203).drag(2, [200, 400], [240, 400], 203).up(2, 240, 400, 203);
  assert.equal(t.count('cancel:1'), 1);
  assert.equal(t.count('start:2'), 1);
});

test('29. zoom à deux doigts dont un reste immobile', () => {
  const t = setup(HUGE).at(0).down(1, 300, 400, 203).at(30).down(2, 360, 400, 203);
  for (let i = 1; i <= 15; i++) t.at(30 + i * 12).move(2, 360 + i * 4, 400, 203);
  t.up(2, 420, 400, 203).at(400).up(1, 300, 400, 203);
  assert.ok(t.noInk(1) && t.noInk(2), 'aucun trait ne reste');
  const factors = t.events.filter((e) => e.startsWith('pan')).map((e) => Number(e.split(',')[2]));
  assert.ok(factors.some((f) => f > 1.01), 'zoom avant');
});

// ------------------------------------------------------------------------------------------
// Paumes réalistes : elles tremblent, glissent en se posant, touchent l’écran en plusieurs points.
// Principe : le contact qui bouge franchement écrit, les contacts posés ne bloquent jamais.

test('30. paume posée qui tremble + stylet : le stylet écrit à chaque fois', () => {
  const t = setup(HUGE).play([
    palm(1, 330, 520, 0, 1600, { amp: 2 }),
    pen(2, [[304, 200, 400], [704, 280, 410]]),
    pen(3, [[904, 180, 440], [1200, 260, 450]]),
  ], 1600);
  assert.ok(t.wrote(2), 'premier trait');
  assert.ok(t.wrote(3), 'deuxième trait');
  assert.ok(t.noInk(1), 'la paume');
});

test('31. paume en deux contacts qui tremblent + stylet', () => {
  const t = setup(HUGE).play([
    palm(1, 330, 520, 0, 1600, { amp: 2.5, roll: [4, 3] }),
    palm(2, 410, 480, 24, 1600, { amp: 2.5 }),
    pen(3, [[400, 200, 400], [800, 280, 405]]),
    pen(4, [[1000, 190, 440], [1300, 270, 445]]),
  ], 1600);
  assert.ok(t.wrote(3));
  assert.ok(t.wrote(4));
  assert.ok(t.noInk(1) && t.noInk(2));
});

test('32. phalange posée au-dessus à gauche du stylet (autre posture, gaucher)', () => {
  const t = setup(HUGE).play([
    palm(1, 120, 330, 0, 1200, { amp: 1.5, size: 150 }),
    palm(2, 420, 580, 40, 1200, { amp: 2 }),
    pen(3, [[500, 220, 420], [800, 300, 425]]),
  ], 1200);
  assert.ok(t.wrote(3));
  assert.ok(t.noInk(1) && t.noInk(2));
});

test('33. zone de repos + talon de la main juste au-dessus + stylet', () => {
  const t = setup({ ...HUGE, restTop: 600 }).play([
    palm(1, 330, 650, 0, 1200),
    palm(2, 300, 570, 104, 1200, { roll: [3, -4] }),
    pen(3, [[400, 200, 400], [704, 270, 405]]),
  ], 1200);
  assert.ok(t.wrote(3));
  assert.ok(t.noInk(1) && t.noInk(2));
});

test('34. paume qui glisse en se posant puis reste : son trait est effacé, le stylet écrit', () => {
  const t = setup(HUGE).play([
    palm(1, 330, 520, 0, 2000, { amp: 0.6, roll: [14, 4], rollMs: 64 }),
    pen(2, [[1200, 200, 400], [1504, 270, 410]]),
  ], 2000);
  assert.equal(t.count('start:1:'), 1, 'la glissade a d’abord écrit');
  assert.ok(t.noInk(1), 'puis a été effacée');
  assert.ok(t.wrote(2));
});

test('35. paume qui tremble fort, posée pendant un trait', () => {
  const t = setup(HUGE).play([
    pen(1, [[0, 200, 400], [800, 400, 420]]),
    palm(2, 420, 560, 200, 1400, { amp: 5, roll: [10, 6], rollMs: 120 }),
    pen(3, [[1000, 180, 460], [1304, 260, 470]]),
  ], 1400);
  assert.ok(t.wrote(1), 'trait en cours');
  assert.ok(t.wrote(3), 'trait suivant, paume toujours posée');
  assert.ok(t.noInk(2));
});

test('36. stylet posé qui attend puis part vite', () => {
  const t = setup(HUGE).play([
    palm(1, 330, 520, 0, 1400, { amp: 1.5 }),
    pen(2, [[240, 200, 400], [600, 200, 400], [840, 260, 405], [904, 262, 405]]),
  ], 1400);
  assert.ok(t.wrote(2));
  assert.ok(t.noInk(1));
});

test('37. trait lent (60 px/s) avec la paume posée', () => {
  const t = setup(HUGE).play([
    palm(1, 330, 520, 0, 1600, { amp: 1.5 }),
    pen(2, [[304, 200, 400], [1304, 260, 400]]),
  ], 1600);
  assert.ok(t.wrote(2));
  assert.ok(t.noInk(1));
});

test('38. la main glisse vers la droite en écrivant : tous les mots s’écrivent', () => {
  const t = setup(HUGE).play([
    palm(1, 330, 520, 0, 2400, { amp: 1.5, drift: [40, 0] }),
    pen(2, [[304, 200, 400], [600, 260, 410]]),
    pen(3, [[800, 270, 400], [1104, 330, 410]]),
    pen(4, [[1304, 340, 400], [1600, 400, 410]]),
  ], 2400);
  assert.ok(t.wrote(2) && t.wrote(3) && t.wrote(4));
  assert.ok(t.noInk(1));
});

test('39. paume en deux contacts côte à côte qui glissent : ne bloque pas le stylet', () => {
  const t = setup(HUGE).play([
    palm(1, 330, 520, 0, 1600, { amp: 1, roll: [20, 10], rollMs: 150 }),
    palm(2, 400, 540, 32, 1600, { amp: 1, roll: [20, 10], rollMs: 150 }),
    pen(3, [[704, 200, 400], [1000, 270, 410]]),
  ], 1600);
  assert.ok(t.wrote(3));
  assert.ok(t.noInk(1) && t.noInk(2));
});

test('40. journal des décisions lisible', () => {
  const t = setup(HUGE).play([palm(1, 330, 520, 0, 800), pen(2, [[304, 200, 400], [600, 260, 410]])], 800);
  const log = t.c.decisions();
  assert.ok(log.some((m) => m.startsWith('#2 écrit')), log.join(' | '));
});

// ------------------------------------------------------------------------------------------
// Verrou des gros contacts posés (lockBigStill) : « ignore totalement ma paume ».

/** Apprend la taille du stylet : 8 traits de 203 px, espacés dans le temps. */
function learn(t: ReturnType<typeof setup>, from = 0) {
  let clock = from;
  for (let k = 0; k < 8; k++) {
    const x = 100 + k * 50;
    t.at(clock).down(90 + k, x, 200, 203).drag(90 + k, [x, 200], [x + 30, 200], 203).up(90 + k, x + 30, 200, 203);
    clock += 3000;
  }
  return clock;
}

/** Une ligne écrite main posée (9 traits), puis la main se replace en glissant vers la droite. */
function lineScenario(): { contacts: Contact[]; end: number } {
  const strokes: Contact[] = [];
  for (let k = 0; k < 9; k++) {
    const t0 = 300 + k * 420;
    const x = 150 + k * 34;
    const y = 400 + (k % 3) * 4;
    strokes.push(pen(30 + k, [[t0, x, y], [t0 + 60, x + 12, y + 22], [t0 + 120, x + 24, y - 2]]));
  }
  const base = palm(1, 470, 560, 0, 4600, { amp: 1.5 });
  const hand: Contact = {
    ...base,
    pos: (time) => {
      const [x, y] = base.pos(time);
      const k = Math.min(1, Math.max(0, (time - 4100) / 150));
      return [x + 70 * k, y + 4 * k];
    },
  };
  return { contacts: [hand, ...strokes], end: 4600 };
}

test('41. verrou : gros contact posé qui se met à glisser franchement → aucun trait', () => {
  const run = (lockBigStill: boolean) => {
    const t = setup({ ...HUGE, lockBigStill });
    const clock = learn(t);
    t.at(clock).down(50, 500, 560, 250).at(clock + 400).drag(50, [500, 560], [560, 562], 250).up(50, 560, 562, 250);
    return t;
  };
  assert.equal(run(true).count('start:50:'), 0, 'verrou actif');
  assert.equal(run(false).count('start:50:'), 1, 'sans verrou, le contact peut encore écrire');
});

test('42. verrou : ton stylet posé qui attend puis part écrit toujours', () => {
  const t = setup({ ...HUGE, lockBigStill: true });
  const clock = learn(t);
  t.at(clock).down(60, 300, 400, 206).at(clock + 400).drag(60, [300, 400], [340, 410], 206).up(60, 340, 410, 206);
  assert.equal(t.count('start:60:'), 1);
});

test('43. ligne entière main posée, puis la main se replace : verrou actif', () => {
  const { contacts, end } = lineScenario();
  const t = setup({ ...HUGE, lockBigStill: true }).play(contacts, end);
  for (let k = 0; k < 9; k++) assert.ok(t.wrote(30 + k), `trait ${k + 1}`);
  assert.equal(t.c.learnedPenSize(), 203);
  assert.ok(t.noInk(1), 'la main qui se replace n’écrit pas');
  const u = setup({ ...HUGE, lockBigStill: false }).play(lineScenario().contacts, end);
  assert.ok(!u.noInk(1), 'sans verrou, la glissade de la main écrit');
});

test('44. délai « posé » réglable (verrou)', () => {
  const run = (staticAfter: number) => {
    const t = setup({ ...HUGE, lockBigStill: true, staticAfter });
    const clock = learn(t);
    t.at(clock).down(50, 500, 560, 250).at(clock + 400).drag(50, [500, 560], [560, 562], 250).up(50, 560, 562, 250);
    return t;
  };
  assert.equal(run(250).count('start:50:'), 0, 'posé après 250 ms : verrouillé');
  assert.equal(run(900).count('start:50:'), 1, 'posé seulement après 900 ms : il écrit encore');
});

// ------------------------------------------------------------------------------------------
// Taille : une paume nettement plus grosse que le stylet n'écrit jamais, même si elle glisse vite.

test('45. paume plus grosse que le stylet : ignorée dès qu’elle touche', () => {
  const t = setup({ ...HUGE, penSize: 203 });
  t.at(0).down(1, 300, 500, 300).drag(1, [300, 500], [360, 510], 300).up(1, 360, 510, 300);
  assert.equal(t.count('start'), 0, 'un contact de 300 px face à un stylet de 203 px');
  t.at(1200).down(2, 200, 300, 203).drag(2, [200, 300], [250, 310], 203).up(2, 250, 310, 203);
  assert.ok(t.wrote(2), 'le stylet écrit toujours');
});

test('46. taille du stylet retenue : le filtre marche dès le premier contact', () => {
  const sans = setup(HUGE);
  sans.at(0).down(1, 300, 500, 300).drag(1, [300, 500], [360, 510], 300).up(1, 360, 510, 300);
  assert.equal(sans.count('start:1:'), 1, 'sans repère, rien ne distingue ce contact');
  const avec = setup({ ...HUGE, penSize: 203 });
  avec.at(0).down(1, 300, 500, 300).drag(1, [300, 500], [360, 510], 300).up(1, 360, 510, 300);
  assert.equal(avec.count('start:1:'), 0, 'avec la taille retenue, la paume est écartée');
});

test('47. la taille apprise est remontée pour être retenue', () => {
  const t = setup(HUGE);
  learn(t);
  assert.ok(t.count('appris:203') >= 1, t.events.filter((e) => e.startsWith('appris')).join(' '));
  assert.equal(t.c.penReference(), 203);
});

test('48. taille « devinée » quand rien n’est appris : repère formé, mais très large', () => {
  const t = setup(HUGE);
  // six petits traits (levés) de taille comparable : le repère se forme sur leur médiane
  for (let k = 0; k < 6; k++) {
    const x = 100 + k * 40;
    t.at(k * 900).down(10 + k, x, 200, 120).drag(10 + k, [x, 200], [x + 30, 200], 120).up(10 + k, x + 30, 200, 120);
  }
  assert.equal(t.c.penReference(), 120);
  // Tant que ce n'est qu'une estimation, la marge est volontairement énorme : un contact deux fois
  // plus gros n'est PAS traité comme une paume (sinon la variance normale d'un doigt bloquerait tout).
  t.at(6000).down(30, 300, 500, 220).drag(30, [300, 500], [350, 510], 220).up(30, 350, 510, 220);
  assert.ok(t.wrote(30), '220 px face à un repère deviné de 120 px : encore accepté');
  // Un contact nettement plus gros (plus de 3× le repère) reste, lui, écarté d'office.
  t.at(7000).down(31, 300, 500, 500).drag(31, [300, 500], [350, 510], 500).up(31, 350, 510, 500);
  assert.equal(t.count('start:31:'), 0, '500 px : très nettement une paume, même deviné');
});

test('48bis. usage au doigt sans calibration : des taps mêlés aux traits ne bloquent jamais les doigts', () => {
  // Un doigt a une taille bien plus variable qu'un stylet : quelques taps très petits (point, tap UI),
  // puis des traits normaux entre 20 et 45 px. Rien ne doit jamais se bloquer.
  const t = setup({ mode: 'capacitive', sizeMode: 'auto', palmSize: 300, handedness: 'right', handTool: false, restTop: null });
  let clock = 0;
  const sizes = [6, 5, 22, 28, 35, 7, 40, 25, 45, 20, 30, 6];
  let id = 1;
  for (const size of sizes) {
    clock += 400;
    if (size < 15) {
      // un tap/point très bref
      t.at(clock).down(id, 200 + id * 5, 300, size).at(clock + 40).up(id, 200 + id * 5, 300, size);
    } else {
      t.at(clock).down(id, 200 + id * 5, 300, size).drag(id, [200 + id * 5, 300], [240 + id * 5, 310], size).up(id, 240 + id * 5, 310, size);
    }
    id++;
  }
  // Chaque trait (taille ≥ 15 px, donc pas un simple tap) doit avoir été écrit intégralement
  for (const [i, size] of sizes.entries()) {
    if (size < 15) continue;
    assert.ok(t.wrote(i + 1), `trait #${i + 1} (${size} px) doit s'écrire normalement`);
  }
});

// ------------------------------------------------------------------------------------------
// Geste à deux doigts : indépendant du moment où chaque doigt s'est posé.

test('49. zoom à deux doigts posés à plus d’une seconde d’intervalle', () => {
  const t = setup(HUGE).at(0).down(1, 300, 400, 203);
  t.at(1600).down(2, 380, 400, 203);
  for (let i = 1; i <= 12; i++) {
    t.at(1600 + i * 16)
      .move(1, 300 - i * 4, 400, 203)
      .move(2, 380 + i * 4, 400, 203);
  }
  assert.ok(t.noInk(1) && t.noInk(2), 'aucun trait ne reste');
  const factors = t.events.filter((e) => e.startsWith('pan')).map((e) => Number(e.split(',')[2]));
  assert.ok(factors.some((f) => f > 1.02), `zoom avant attendu : ${factors.join(' ')}`);
});

test('50. défilement à deux doigts après qu’un doigt a été pris pour une paume', () => {
  const t = setup(HUGE).at(0).down(1, 300, 400, 203).at(900); // posé, ignoré
  t.at(1000).down(2, 380, 420, 203).at(1400);
  for (let i = 1; i <= 12; i++) {
    t.at(1400 + i * 16)
      .move(1, 300, 400 - i * 5, 203)
      .move(2, 380, 420 - i * 5, 203);
  }
  assert.ok(t.noInk(1) && t.noInk(2), 'aucun trait ne reste');
  assert.ok(t.count('pan') > 4, 'la page défile');
});

test('51. paume posée qui tremble pendant l’écriture : aucun geste', () => {
  const t = setup(HUGE).play(
    [palm(1, 330, 520, 0, 1600, { amp: 3 }), pen(2, [[304, 200, 400], [904, 300, 420]])],
    1600,
  );
  assert.ok(t.wrote(2));
  assert.equal(t.count('pan'), 0, 'la page ne doit pas bouger');
});

// ------------------------------------------------------------------------------------------
// Appui long = gomme temporaire (comme JNotes).

test('52. appui long immobile : bascule en gomme, une seule fois', () => {
  const t = setup({ ...HUGE, holdEraseMs: 700 }).at(0).down(1, 200, 300, 203);
  t.drag(1, [200, 300], [208, 300], 203); // petit départ : le trait commence
  assert.equal(t.count('start:1'), 1);
  t.at(760).move(1, 209, 300, 203);
  assert.equal(t.count('gomme:1'), 1, 'gomme déclenchée');
  t.at(1200).move(1, 240, 320, 203);
  assert.equal(t.count('gomme:1'), 1, 'pas de second déclenchement');
  t.up(1, 240, 320, 203);
  assert.equal(t.count('end:1'), 1);
});

test('53. appui long sans le moindre événement : le minuteur tranche', () => {
  const t = setup({ ...HUGE, holdEraseMs: 700 }).at(0).down(1, 200, 300, 203);
  t.drag(1, [200, 300], [210, 300], 203);
  t.at(900); // plus aucun échantillon : seul le minuteur peut décider
  assert.equal(t.count('gomme:1'), 1);
});

test('54. trait qui avance : pas de gomme', () => {
  const t = setup({ ...HUGE, holdEraseMs: 700 }).at(0).down(1, 200, 300, 203);
  for (let i = 1; i <= 100; i++) t.at(i * 10).move(1, 200 + i, 300 + Math.sin(i / 4) * 6, 203);
  t.up(1, 300, 300, 203);
  assert.equal(t.count('gomme:1'), 0);
  assert.ok(t.wrote(1));
});

test('55bis. stylet posé sans rien tracer : appui long = gomme', () => {
  const t = setup({ ...HUGE, holdEraseMs: 700, penSize: 203 }).at(0).down(1, 200, 300, 203);
  t.at(400).move(1, 201, 300, 203);
  t.at(900);
  assert.equal(t.count('gomme:1'), 1, 'la gomme s’active sans trait préalable');
  assert.equal(t.count('start:1:'), 1, 'un trait (vide) est ouvert pour gommer');
  t.up(1, 201, 300, 203);
  assert.equal(t.count('end:1'), 1);
});

test('55ter. une paume posée ne devient jamais une gomme', () => {
  const t = setup({ ...HUGE, holdEraseMs: 700, penSize: 203 }).at(0).down(1, 330, 520, 320);
  for (let i = 1; i <= 12; i++) t.at(i * 100).move(1, 330 + (i % 2), 520, 320);
  t.at(1500);
  assert.equal(t.count('gomme:1'), 0);
  assert.equal(t.count('start'), 0);
});

test('55. appui long désactivé par défaut', () => {
  const t = setup(HUGE).at(0).down(1, 200, 300, 203);
  t.drag(1, [200, 300], [206, 300], 203).at(1500);
  assert.equal(t.count('gomme:1'), 0);
});

test('56. appui long : rien ne bouge du tout, sans aucune référence de taille (première utilisation)', () => {
  const t = setup({ mode: 'capacitive', sizeMode: 'auto', palmSize: 300, handedness: 'right', handTool: false, restTop: null, holdEraseMs: 700 })
    .at(0)
    .down(1, 300, 400, 203);
  t.at(750);
  assert.equal(t.count('gomme:1'), 1, 'la gomme doit marcher dès la première session, sans calibration');
});

test('57. appui long : retente si le premier essai tombe pendant qu’un autre trait s’achève', () => {
  const t = setup({ ...HUGE, holdEraseMs: 700 }).at(0).down(1, 300, 400, 203);
  // un autre contact écrit encore juste au moment où le minuteur du premier essai sonne
  t.at(600).down(2, 500, 400, 203).drag(2, [500, 400], [540, 405], 203);
  t.at(720); // premier essai (720 ms) : refusé, l’autre trait est en cours
  assert.equal(t.count('gomme:1'), 0);
  t.up(2, 540, 405, 203);
  t.at(900); // une retentative (toutes les 120 ms) doit réussir peu après
  assert.equal(t.count('gomme:1'), 1, 'la retentative doit finir par déclencher la gomme');
});

test('58. seuil calibré (manuel) : rien ne peut jamais promouvoir un contact plus gros', () => {
  const t = setup({ ...HUGE, sizeMode: 'manual', palmSize: 235, penSize: 203 });
  // paume posée qui glisse fort en se posant (le cas qui, avant, laissait un trait parasite), puis tremble
  t.at(0).down(1, 330, 520, 260);
  t.drag(1, [330, 520], [355, 530], 260); // glissade franche en se posant
  for (let i = 0; i < 20; i++) t.at(400 + i * 80).move(1, 330 + (i % 3), 520 + ((i + 1) % 3), 260);
  assert.equal(t.count('start'), 0, 'jamais un seul trait, même la glissade initiale');
  // un stylet à 203 px écrit normalement pendant que la paume est toujours là
  t.at(2200).down(2, 200, 300, 203).drag(2, [200, 300], [260, 310], 203).up(2, 260, 310, 203);
  assert.ok(t.wrote(2));
  t.at(2500).up(1, 330 + 2, 520 + 1, 260);
  assert.equal(t.count('start:1:'), 0);
});

test('59. seuil calibré : la paume, même en train de bouger, ne déclenche jamais un geste à deux doigts', () => {
  const t = setup({ ...HUGE, sizeMode: 'manual', palmSize: 235, penSize: 203 }).at(0).down(1, 300, 400, 260);
  t.at(60).down(2, 380, 400, 260);
  for (let i = 1; i <= 20; i++) {
    t.at(60 + i * 16)
      .move(1, 300 - i * 3, 400, 260)
      .move(2, 380 + i * 3, 400, 260);
  }
  assert.equal(t.count('pan'), 0, 'deux « doigts » à taille de paume ne doivent pas zoomer');
  assert.equal(t.count('start'), 0);
});

test('60. geste à deux doigts réel : toujours reconnu malgré le seuil de vitesse relevé', () => {
  const t = setup(HUGE).at(0).down(1, 300, 400, 203).at(30).down(2, 380, 400, 203);
  for (let i = 1; i <= 12; i++) {
    t.at(30 + i * 16)
      .move(1, 300 - i * 6, 400, 203)
      .move(2, 380 + i * 6, 400, 203);
  }
  assert.equal(t.count('start'), 0);
  const factors = t.events.filter((e) => e.startsWith('pan')).map((e) => Number(e.split(',')[2]));
  assert.ok(factors.some((f) => f > 1.02), `zoom avant attendu : ${factors.join(' ')}`);
});

// ------------------------------------------------------------------------------------------
// Dessiner → Maintenir → Ajuster (reconnaissance de forme) : ne doit jamais se confondre avec
// l'appui long « gomme ».

/** Laisse le minuteur de l'appui long retenter jusqu'à `until`, par pas réalistes de retentative. */
function settle(t: ReturnType<typeof setup>, until: number, step = 130) {
  for (let at = step; at <= until; at += step) t.at(at);
  return t;
}

test('61. cercle dessiné puis maintenu : appui long « forme »', () => {
  const t = setup({ ...HUGE, shapeHoldMs: 500 }).at(0).down(1, 200, 300, 203);
  for (let i = 1; i <= 30; i++) {
    const a = (i / 30) * Math.PI * 2;
    t.at(i * 15).move(1, 240 + Math.cos(a) * 40, 300 + Math.sin(a) * 40, 203);
  }
  settle(t, 1100); // reste posé au point d'arrivée ; le minuteur retente jusqu'à trancher
  assert.equal(t.count('forme:1'), 1);
  assert.equal(t.count('gomme:1'), 0, 'ce n’est pas un appui long « gomme »');
  t.up(1, 240, 260, 203);
});

test('62. appui long statique (rien dessiné) : toujours la gomme, jamais une forme', () => {
  const t = setup({ ...HUGE, holdEraseMs: 700, shapeHoldMs: 500 });
  t.at(0).down(1, 200, 300, 203);
  settle(t, 1000);
  assert.equal(t.count('gomme:1'), 1);
  assert.equal(t.count('forme:1'), 0);
});

test('63. petit trait (zone morte) : ni gomme, ni forme', () => {
  const t = setup({ ...HUGE, holdEraseMs: 700, shapeHoldMs: 500 }).at(0).down(1, 200, 300, 203);
  t.drag(1, [200, 300], [212, 306], 203); // ~13 px : entre HOLD_PATH (8) et SHAPE_MIN_PATH (22)
  settle(t, 1100);
  assert.equal(t.count('gomme:1'), 0);
  assert.equal(t.count('forme:1'), 0);
});

test('64. un vrai trait qui continue de bouger ne déclenche pas la forme trop tôt', () => {
  const t = setup({ ...HUGE, shapeHoldMs: 500 }).at(0).down(1, 200, 300, 203);
  for (let i = 1; i <= 60; i++) t.at(i * 15).move(1, 200 + i * 3, 300 + Math.sin(i / 4) * 20, 203);
  // toujours en mouvement à cet instant : aucune forme ne doit s'être déclenchée pendant le tracé
  assert.equal(t.count('forme:1'), 0);
});

test('65. désactivé par défaut', () => {
  const t = setup(HUGE).at(0).down(1, 200, 300, 203);
  for (let i = 1; i <= 30; i++) {
    const a = (i / 30) * Math.PI * 2;
    t.at(i * 15).move(1, 240 + Math.cos(a) * 40, 300 + Math.sin(a) * 40, 203);
  }
  settle(t, 1500);
  assert.equal(t.count('forme:1'), 0);
});

test('66. outil main : un tap bref d’un seul contact remonte à l’appli, une seule fois', () => {
  const t = setup({ handTool: true }).at(0).down(1, 100, 120).at(120).up(1, 100, 120);
  assert.equal(t.count('tap1:100,120'), 1);
  assert.equal(t.count('start'), 0);
});

test('67. outil main : un glissé (défilement) n’est pas un tap', () => {
  const t = setup({ handTool: true }).at(0).down(1, 100, 100).drag(1, [100, 100], [100, 220]).up(1, 100, 220);
  assert.equal(t.count('tap1'), 0);
  assert.ok(t.count('pan') > 3);
});

test('68. outil main : appui long immobile (plus d’un tap) : rien', () => {
  const t = setup({ handTool: true }).at(0).down(1, 100, 100).at(900).up(1, 100, 100);
  assert.equal(t.count('tap1'), 0);
});

test('69. avec un outil d’écriture, un tap reste un point : pas d’événement tap', () => {
  const t = setup({ handTool: false }).at(0).down(1, 100, 100).at(80).up(1, 100, 100);
  assert.equal(t.count('tap1'), 0);
});

test('70. outil main : le tap à deux doigts reste « annuler », pas un tap simple', () => {
  const t = setup({ handTool: true }).at(0).down(1, 100, 100).down(2, 160, 100).at(90).up(1, 100, 100).up(2, 160, 100);
  assert.equal(t.count('tap2'), 1);
  assert.equal(t.count('tap1'), 0);
});

let failed = 0;
for (const [name, fn] of results) {
  try {
    fn();
    console.log('OK  ', name);
  } catch (e) {
    failed++;
    console.log('FAIL', name, '\n     ', (e as Error).message);
    if (last) {
      console.log('      événements :', last.events.filter((x) => !x.startsWith('move')).join(' '));
      console.log('      décisions :', last.c.decisions().join(' | '));
    }
  }
}
console.log(failed ? `\n${failed} échec(s)` : '\nTous les scénarios passent');
process.exitCode = failed ? 1 : 0;
