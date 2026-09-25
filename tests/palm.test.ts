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

/** Stylet : passe par les points [temps, x, y] à vitesse constante entre deux points, léger bruit. */
function pen(id: number, keys: [number, number, number][], size = 20): Contact {
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
  // Mode par défaut : 'finger' — l'OS gère le rejet de paume, tous les contacts sont acceptés
  const cfg: ClassifierConfig = {
    mode: 'finger',
    sizeMode: 'off',
    palmSize: 300,
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
    /** Aucun trait de ce contact n'est resté sur la page */
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

/** Dernier scénario créé : affiché en cas d'échec */
let last: { events: Ev[]; c: InputClassifier } | null = null;

const results: [string, () => void][] = [];
const test = (name: string, fn: () => void) => results.push([name, fn]);

// ------------------------------------------------------------------------------------------
// Fonctionnement de base en mode 'finger' (l'OS gère le rejet de paume)

test('1. trait simple au toucher', () => {
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

test("3. contact de grande taille : écrit quand même (l'OS gère le rejet de paume)", () => {
  // En mode 'finger', tous les contacts peuvent écrire, quelle que soit leur taille
  const t = setup().at(0).down(1, 300, 400, 250).drag(1, [300, 400], [340, 410], 250).up(1, 340, 410, 250);
  assert.equal(t.count('start:1'), 1, 'tout contact peut écrire');
  assert.equal(t.count('end:1'), 1);
});

test('4. mode stylet actif strict : le stylet écrit, le doigt déplace la page (aucun trait)', () => {
  const t = setup({ mode: 'active' }).at(0).down(1, 200, 300, 1, 'pen').drag(1, [200, 300], [230, 300], 1).up(1, 230, 300, 1);
  t.at(500).down(2, 100, 100, 20).drag(2, [100, 100], [100, 160], 20).up(2, 100, 160, 20);
  assert.equal(t.count('pen!'), 1);
  assert.equal(t.count('start:1:pen'), 1, 'le stylet écrit');
  assert.equal(t.count('start:2'), 0, 'le doigt ne trace aucun trait');
  assert.ok(t.count('pan') > 5, 'le doigt déplace la page');
});

test('4b. mode strict sur un téléphone (aucun stylet actif vu) : le doigt écrit', () => {
  const t = setup({ mode: 'active' }).at(0).down(1, 200, 300, 20).drag(1, [200, 300], [260, 320], 20).up(1, 260, 320, 20);
  assert.equal(t.count('start:1'), 1, 'le doigt trace un trait');
  assert.equal(t.count('end:1'), 1);
  assert.equal(t.count('pan'), 0, 'la page ne défile pas');
});

test('4c. mode strict, stylet déjà vu sur cet appareil (réglage retenu) : le doigt déplace la page', () => {
  const t = setup({ mode: 'active' });
  t.c.penSeen = true;
  t.at(0).down(1, 100, 100, 20).drag(1, [100, 100], [100, 160], 20).up(1, 100, 160, 20);
  assert.equal(t.count('start:1'), 0, 'aucun trait au doigt');
  assert.ok(t.count('pan') > 5, 'le doigt déplace la page');
});

test('4d. mode strict sans stylet : deux doigts zooment ou défilent, sans laisser de trait', () => {
  const t = setup({ mode: 'active' }).at(0).down(1, 200, 300, 20).at(10).down(2, 400, 300, 20);
  for (let i = 1; i <= 20; i++) t.at(10 + i * 8).move(1, 200 - i * 3, 300, 20).move(2, 400 + i * 3, 300, 20);
  t.up(1, 140, 300, 20).up(2, 460, 300, 20);
  assert.equal(t.count('end:1') + t.count('end:2'), 0, 'aucun trait gardé');
  assert.ok(t.count('pan') > 3, 'geste de zoom');
});

test('4e. iPad / stylet actif : la paume posée AVANT le stylet tremble sans faire bouger la page, puis le stylet écrit', () => {
  const t = setup({ mode: 'active' });
  t.c.penSeen = true;
  t.at(0).down(1, 500, 600, 150);
  // Tremblement de la paume : ±6 px pendant 400 ms
  for (let i = 1; i <= 50; i++) t.at(i * 8).move(1, 500 + ((i * 37) % 13) - 6, 600 + ((i * 53) % 11) - 5, 150);
  assert.equal(t.count('pan'), 0, 'la page ne tremble pas avec la paume');
  t.at(420).down(2, 300, 300, 1, 'pen').drag(2, [300, 300], [360, 320], 1).up(2, 360, 320, 1);
  assert.equal(t.count('start:2:pen'), 1, 'le stylet écrit');
  assert.equal(t.count('end:2'), 1);
  assert.equal(t.count('start:1'), 0, 'la paume n’écrit jamais');
});

test('5. annulation Android : un vrai trait est gardé, un début de trait est retiré', () => {
  const t = setup().at(0).down(1, 200, 300, 20).drag(1, [200, 300], [240, 300], 20);
  t.c.cancel(1);
  assert.equal(t.count('end:1'), 1);
  assert.equal(t.count('cancel:1'), 0);
  t.at(3000).down(2, 200, 400, 20).drag(2, [200, 400], [210, 400], 20);
  t.c.cancel(2);
  assert.equal(t.count('cancel:2'), 1);
});

// ------------------------------------------------------------------------------------------
// Gestes à deux doigts : défilement, zoom, tap.

test('6. défilement à deux doigts', () => {
  const t = setup().at(0).down(1, 100, 300, 20).at(40).down(2, 180, 300, 20);
  for (let i = 1; i <= 20; i++) t.at(40 + i * 10).move(1, 100, 300 - i * 3, 20).move(2, 180, 300 - i * 3, 20);
  t.up(1, 100, 240, 20).up(2, 180, 240, 20);
  assert.ok(t.noInk(1), 'le début de trait est annulé dès que le geste à 2 doigts démarre');
  assert.ok(t.count('pan') > 10);
  assert.equal(t.count('tap2'), 0);
});

test('7. zoom à deux doigts (écartement)', () => {
  const t = setup().at(0).down(1, 200, 300, 20).at(30).down(2, 260, 300, 20);
  for (let i = 1; i <= 20; i++) t.at(30 + i * 10).move(1, 200 - i * 3, 300, 20).move(2, 260 + i * 3, 300, 20);
  const factors = t.events.filter((e) => e.startsWith('pan')).map((e) => Number(e.split(',')[2]));
  assert.ok(factors.some((f) => f > 1.01), 'zoom avant attendu');
  assert.ok(t.noInk(1));
});

test('8. tap à deux doigts → annuler', () => {
  const t = setup().at(0).down(1, 100, 100, 20).at(30).down(2, 160, 100, 20).at(130).up(1, 100, 100, 20).at(150).up(2, 160, 100, 20);
  t.at(400);
  assert.equal(t.count('tap2'), 1);
  assert.ok(t.noInk(1));
});

test("9. après un zoom, le doigt restant n'écrit pas", () => {
  const t = setup().at(0).down(1, 200, 300, 20).at(30).down(2, 260, 300, 20);
  for (let i = 1; i <= 10; i++) t.at(30 + i * 10).move(1, 200 - i * 3, 300, 20).move(2, 260 + i * 3, 300, 20);
  t.up(1, 170, 300, 20).drag(2, [290, 300], [340, 320], 20).up(2, 340, 320, 20);
  assert.ok(t.noInk(1) && t.noInk(2));
});

test('10. deux traits successifs au même doigt', () => {
  const t = setup()
    .at(0).down(1, 100, 100).drag(1, [100, 100], [150, 110]).up(1, 150, 110)
    .at(500).down(1, 200, 200).drag(1, [200, 200], [250, 210]).up(1, 250, 210);
  assert.equal(t.count('start:1'), 2);
  assert.equal(t.count('end:1'), 2);
  assert.equal(t.count('cancel'), 0);
});

test('11. un seul doigt écrit à la fois (le deuxième attend)', () => {
  // En mode finger : si un contact écrit et qu'un second arrive, le second est mis en attente
  // jusqu'à ce que le premier se lève
  const t = setup().at(0).down(1, 100, 100).drag(1, [100, 100], [140, 110]);
  t.at(200).down(2, 300, 300).at(300).up(1, 140, 110);
  // Le premier trait est terminé
  assert.equal(t.count('start:1'), 1);
  assert.equal(t.count('end:1'), 1);
});

test('12. journal des décisions lisible', () => {
  const t = setup()
    .at(0).down(1, 100, 200).drag(1, [100, 200], [150, 210]).up(1, 150, 210);
  const log = t.c.decisions();
  assert.ok(log.some((m) => m.startsWith('#1 écrit')), log.join(' | '));
});

// ------------------------------------------------------------------------------------------
// Geste à deux doigts : cas avancés.

test('13. zoom à deux doigts dont un reste immobile', () => {
  const t = setup().at(0).down(1, 300, 400, 20).at(30).down(2, 360, 400, 20);
  for (let i = 1; i <= 15; i++) t.at(30 + i * 12).move(2, 360 + i * 4, 400, 20);
  t.up(2, 420, 400, 20).at(400).up(1, 300, 400, 20);
  assert.ok(t.noInk(1) && t.noInk(2), 'aucun trait ne reste');
  const factors = t.events.filter((e) => e.startsWith('pan')).map((e) => Number(e.split(',')[2]));
  assert.ok(factors.some((f) => f > 1.01), 'zoom avant');
});

// ------------------------------------------------------------------------------------------
// Appui long = gomme temporaire (comme JNotes).

test('14. appui long immobile : bascule en gomme, une seule fois', () => {
  const t = setup({ holdEraseMs: 700 }).at(0).down(1, 200, 300, 20);
  t.drag(1, [200, 300], [208, 300], 20); // petit départ : le trait commence
  assert.equal(t.count('start:1'), 1);
  t.at(760).move(1, 209, 300, 20);
  assert.equal(t.count('gomme:1'), 1, 'gomme déclenchée');
  t.at(1200).move(1, 240, 320, 20);
  assert.equal(t.count('gomme:1'), 1, 'pas de second déclenchement');
  t.up(1, 240, 320, 20);
  assert.equal(t.count('end:1'), 1);
});

test('15. appui long sans le moindre événement : le minuteur tranche', () => {
  const t = setup({ holdEraseMs: 700 }).at(0).down(1, 200, 300, 20);
  t.drag(1, [200, 300], [210, 300], 20);
  t.at(900); // plus aucun échantillon : seul le minuteur peut décider
  assert.equal(t.count('gomme:1'), 1);
});

test('16. trait qui avance : pas de gomme', () => {
  const t = setup({ holdEraseMs: 700 }).at(0).down(1, 200, 300, 20);
  for (let i = 1; i <= 100; i++) t.at(i * 10).move(1, 200 + i, 300 + Math.sin(i / 4) * 6, 20);
  t.up(1, 300, 300, 20);
  assert.equal(t.count('gomme:1'), 0);
  assert.ok(t.wrote(1));
});

test('17. stylet posé sans rien tracer : appui long = gomme', () => {
  const t = setup({ holdEraseMs: 700 }).at(0).down(1, 200, 300, 20);
  t.at(400).move(1, 201, 300, 20);
  t.at(900);
  assert.equal(t.count('gomme:1'), 1, "la gomme s'active sans trait préalable");
  assert.equal(t.count('start:1:'), 1, 'un trait (vide) est ouvert pour gommer');
  t.up(1, 201, 300, 20);
  assert.equal(t.count('end:1'), 1);
});

test('18. appui long désactivé par défaut', () => {
  const t = setup().at(0).down(1, 200, 300, 20);
  t.drag(1, [200, 300], [206, 300], 20).at(1500);
  assert.equal(t.count('gomme:1'), 0);
});

test('19. appui long : rien ne bouge du tout (première utilisation, sans calibration)', () => {
  const t = setup({ mode: 'finger', sizeMode: 'off', palmSize: 300, handedness: 'right', handTool: false, restTop: null, holdEraseMs: 700 })
    .at(0)
    .down(1, 300, 400, 20);
  t.at(750);
  assert.equal(t.count('gomme:1'), 1, 'la gomme doit marcher dès la première session');
});

test('20. appui long : se déclenche après une immobilisation prolongée', () => {
  const t = setup({ holdEraseMs: 700 }).at(0).down(1, 300, 400, 20);
  t.drag(1, [300, 400], [303, 402], 20); // léger mouvement < 8px
  t.at(400); // 400ms: pas encore le délai de 700ms
  assert.equal(t.count('gomme:1'), 0);
  t.at(800); // 800ms: délai atteint, la gomme s'active
  assert.equal(t.count('gomme:1'), 1);
  t.up(1, 303, 402, 20);
  assert.equal(t.count('end:1'), 1);
});

// ------------------------------------------------------------------------------------------
// Dessiner → Maintenir → Ajuster (reconnaissance de forme).

/** Laisse le minuteur de l'appui long retenter jusqu'à `until`, par pas réalistes. */
function settle(t: ReturnType<typeof setup>, until: number, step = 130) {
  for (let at = step; at <= until; at += step) t.at(at);
  return t;
}

test('21. cercle dessiné puis maintenu : appui long « forme »', () => {
  const t = setup({ shapeHoldMs: 500 }).at(0).down(1, 200, 300, 20);
  for (let i = 1; i <= 30; i++) {
    const a = (i / 30) * Math.PI * 2;
    t.at(i * 15).move(1, 240 + Math.cos(a) * 40, 300 + Math.sin(a) * 40, 20);
  }
  settle(t, 1100);
  assert.equal(t.count('forme:1'), 1);
  assert.equal(t.count('gomme:1'), 0, "ce n'est pas un appui long « gomme »");
  t.up(1, 240, 260, 20);
});

test('22. appui long statique (rien dessiné) : toujours la gomme, jamais une forme', () => {
  const t = setup({ holdEraseMs: 700, shapeHoldMs: 500 });
  t.at(0).down(1, 200, 300, 20);
  settle(t, 1000);
  assert.equal(t.count('gomme:1'), 1);
  assert.equal(t.count('forme:1'), 0);
});

test('23. petit trait (zone morte) : ni gomme, ni forme', () => {
  const t = setup({ holdEraseMs: 700, shapeHoldMs: 500 }).at(0).down(1, 200, 300, 20);
  t.drag(1, [200, 300], [212, 306], 20); // ~13 px : entre HOLD_PATH (8) et SHAPE_MIN_PATH (22)
  settle(t, 1100);
  assert.equal(t.count('gomme:1'), 0);
  assert.equal(t.count('forme:1'), 0);
});

test('24. un vrai trait qui continue de bouger ne déclenche pas la forme trop tôt', () => {
  const t = setup({ shapeHoldMs: 500 }).at(0).down(1, 200, 300, 20);
  for (let i = 1; i <= 60; i++) t.at(i * 15).move(1, 200 + i * 3, 300 + Math.sin(i / 4) * 20, 20);
  assert.equal(t.count('forme:1'), 0);
});

test('25. reconnaissance de forme désactivée par défaut', () => {
  const t = setup().at(0).down(1, 200, 300, 20);
  for (let i = 1; i <= 30; i++) {
    const a = (i / 30) * Math.PI * 2;
    t.at(i * 15).move(1, 240 + Math.cos(a) * 40, 300 + Math.sin(a) * 40, 20);
  }
  settle(t, 1500);
  assert.equal(t.count('forme:1'), 0);
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