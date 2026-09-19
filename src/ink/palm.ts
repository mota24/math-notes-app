import type { Handedness, InputKind, StylusMode } from './types';

/** Échantillon d'un contact, en px CSS (coordonnées écran). size = diamètre du contact. */
export interface Sample {
  x: number;
  y: number;
  p: number;
  t: number;
  size: number;
}

/** Taille de contact : apprise sur tes traits, seuil manuel, ou ignorée. */
export type SizeMode = 'auto' | 'manual' | 'off';

export interface ClassifierConfig {
  mode: StylusMode;
  sizeMode: SizeMode;
  /** Seuil manuel (px CSS) : au-delà, c'est une paume. */
  palmSize: number;
  /** Conservé pour les anciens réglages : l'anti-paume ne dépend plus de la position de la main. */
  handedness: Handedness;
  /** Outil « main » : tout contact déplace la page. */
  handTool: boolean;
  /** Zone de repos : ordonnée écran (px CSS) sous laquelle tout contact tactile est ignoré. */
  restTop: number | null;
  /** Un contact nettement plus gros que ton stylet et resté posé n'écrit plus jusqu'à ce qu'il se lève. */
  lockBigStill?: boolean;
  /** Délai (ms) au-delà duquel un contact resté sur place est « posé » (250 par défaut). */
  staticAfter?: number;
  /** Taille du stylet (px) retenue des sessions précédentes : le filtre de taille marche dès le premier contact. */
  penSize?: number | null;
  /** Appui long immobile du stylet = gomme temporaire (null ou 0 : désactivé). */
  holdEraseMs?: number | null;
  /**
   * Appui long en fin d'un vrai tracé (pas un contact resté immobile depuis le départ, voir
   * `holdEraseMs`) = tentative de reconnaissance de forme (null ou 0 : désactivé).
   */
  shapeHoldMs?: number | null;
}

export interface ClassifierListener {
  drawStart(id: number, kind: InputKind, samples: Sample[]): void;
  drawMove(id: number, samples: Sample[], predicted: Sample[]): void;
  drawEnd(id: number): void;
  /** Le contact s'est révélé être une paume : effacer le trait en cours. */
  drawCancel(id: number): void;
  /** Déplacement (dx, dy) et zoom (factor) autour du centre (cx, cy), en px CSS. */
  panZoom(dx: number, dy: number, cx: number, cy: number, factor: number): void;
  twoFingerTap(): void;
  penDetected(): void;
  /** Appui long immobile pendant un trait : bascule ce contact en gomme jusqu'à ce qu'il se lève. */
  holdErase?(id: number): void;
  /**
   * Appui long en fin de tracé (dessiner → maintenir → ajuster) : essaie de reconnaître une forme
   * dans ce qui vient d'être dessiné. Si rien n'est reconnu, le trait continue normalement.
   */
  shapeHold?(id: number): void;
  /** Nouvelle taille de stylet apprise (px) : à retenir pour les prochaines sessions. */
  penSizeLearned?(size: number): void;
}

export type TrackState = 'pending' | 'draw' | 'palm' | 'gesture';

interface Track {
  id: number;
  kind: InputKind;
  state: TrackState;
  down: Sample;
  last: Sample;
  /** Échantillons récents : rejoués quand le trait est décidé en retard. */
  samples: Sample[];
  maxSize: number;
  /** Éloignement maximal depuis le début du trait (px) */
  moved: number;
  /** Longueur parcourue (px), mesurée sur la position lissée : le tremblement ne l'allonge pas */
  path: number;
  smooth: { x: number; y: number };
  anchor: { x: number; y: number };
  /** Début du trait (appui, ou départ après une pause) */
  since: number;
  peer?: number;
  /** Posé pendant qu'un autre contact écrivait, ou là où une paume vient de se lever : doit bouger davantage */
  strict: boolean;
  /** Posé pendant qu'un autre contact écrivait */
  duringStroke: boolean;
  /** Ignoré pour l'instant, mais peut encore écrire s'il part franchement */
  promotable: boolean;
  /** Refusé parce qu'un autre trait avançait : réessaie à chaque mouvement, trait complet */
  contested: boolean;
  /** Déjà reconnu comme paume une fois : ne repart qu'avec un mouvement vif */
  suspect: boolean;
  /** Mémoriser sa position comme paume quand il se lève */
  remember: boolean;
  /** Bascule en gomme déjà déclenchée par un appui long */
  held: boolean;
  /** Dernière décision, affichée dans « Infos stylet » */
  reason: string;
}

export interface TrackInfo {
  id: number;
  kind: InputKind;
  state: TrackState;
  size: number;
  moved: number;
  reason: string;
  /** Position écran (px CSS) : sert à dessiner les contacts sur la page */
  x: number;
  y: number;
}

type Schedule = (fn: () => void, ms: number) => void;

/*
 * Stylet capacitif (vu comme un doigt, parfois aussi gros qu'une paume) : « le mouvement d'abord ».
 * - Un contact écrit dès qu'il se déplace franchement : assez loin, assez vite, et à peu près en ligne
 *   (le centre d'une paume tremble dans tous les sens sans vraiment avancer).
 * - Un contact immobile est ignoré. Il ne bloque JAMAIS les autres, quels que soient leur nombre et leur position.
 * - Un seul trait à la fois : quand un nouveau contact part vite, un « trait » court et arrêté était une paume
 *   qui a glissé en se posant (effacé) ; un vrai trait arrêté est gardé et le nouveau contact prend le relais.
 * Les vitesses comparent des positions moyennes : le tremblement d'une paume s'annule.
 */
const COMMIT_DIST = 5; // px de déplacement (position lissée)
const COMMIT_DIST_STRICT = 15;
const COMMIT_SPEED = 30; // px/s de moyenne depuis l'appui
const STRAIGHTNESS = 3; // longueur parcourue ≤ 3 × déplacement + 4 px
const STATIC_AFTER = 250; // ms : au-delà, un contact resté sur place est « posé »
const QUICK_DIST = 8; // un contact posé écrit s'il parcourt 8 px en 70 ms…
const QUICK_MS = 70;
const SLOW_DIST = 15; // … ou 15 px en 250 ms, en ligne
const SLOW_MS = 250;
const SPEED_WINDOW = 160; // ms
const IDLE_SPEED = 20; // px/s
const PAIR_WINDOW = 200; // ms : deux appuis aussi proches = geste à deux doigts possible
const PAIR_DECIDE = 20; // px : on tranche une paire quand l'un des deux a bougé autant
const PAIR_BOTH = 12; // px : l'autre a vraiment bougé aussi
const PAIR_GESTURE = 30; // px : deux contacts qui glissent ensemble défilent seulement au-delà
const PAIR_STALE = 600; // ms : une paire restée immobile plus longtemps est une main posée
const GESTURE_STALE = 300; // ms : geste immobile = doigts (ou paume) posés, il ne bloque plus
const DOT_MAX_MS = 250;
const TAP_MS = 300;
const TAP_MOVE = 14;
const LIMBO_MS = 160;
const SWITCH_MOVED = 25; // px : un trait plus court peut être effacé quand un autre contact écrit
const SWITCH_PATH = 80;
const DRIFT_SPEED = 70; // px/s : vitesse moyenne d'une paume qui glisse (un stylet qui écrit va plus vite)
const BIG_RATIO = 1.3; // au-delà de 1,3 × la taille du stylet (et +25 px), c'est une paume
const BIG_MARGIN = 25;
const GUESS_MIN = 6; // contacts « en forme de trait » avant de risquer un seuil deviné
const GUESS_STROKE_PATH = 15; // px : en dessous, c'est un tap ou un point, pas un trait représentatif
const GUESS_STROKE_MS = 80;
// Marge volontairement énorme : la taille d'un doigt varie beaucoup plus que celle d'un stylet
// d'un contact à l'autre, cette estimation ne doit jamais couper une utilisation normale au doigt.
const GUESS_RATIO = 3;
const GUESS_MARGIN = 160;
const GESTURE_WINDOW = 200; // ms : fenêtre où deux contacts qui bougent ensemble deviennent un geste
// ~150 px/s : nettement plus vite qu'une main qui glisse en écrivant (le filtre de taille exclut déjà
// la paume identifiée comme telle ; cette marge protège aussi tant qu'elle ne l'est pas encore).
const GESTURE_MOVE = 30; // px (position lissée) parcourus par chacun dans cette fenêtre
const GESTURE_PINCH = 15; // px d'écartement/rapprochement pour un zoom
const HOLD_PATH = 8; // px : un appui long doit rester sur place
const SHAPE_MIN_PATH = 22; // px : en dessous, ce n'est pas un vrai tracé (zone morte avec HOLD_PATH,
// pour ne jamais confondre un appui long « gomme » et un appui long « forme »)
const HOLD_RETRY_MS = 120; // ms entre deux tentatives si la première a échoué
const HOLD_RETRY_SPAN = 4000; // ms au-delà du délai initial : on arrête de retenter
const IDLE_PEN_MS = 800; // un « trait » court arrêté aussi longtemps, quand un autre contact arrive : paume
const IDLE_PEN_MOVED = 20;
const PALM_MEMORY_MS = 1000;
const PALM_MEMORY_RADIUS = 60;
const SIDE_BY_SIDE_DY = 60; // px
const SIDE_BY_SIDE_GAP = 100; // px
const KEEP_SAMPLES_MS = 600;
const LEARN_MIN = 8;
const LEARN_MAX = 40;
const JOURNAL = 8;

export class InputClassifier {
  config: ClassifierConfig;
  penSeen = false;
  private listener: ClassifierListener;
  private schedule: Schedule;
  private tracks = new Map<number, Track>();
  private gestureLast = new Map<number, { x: number; y: number }>();
  private gestureInfo: { start: number; lastMove: number; ids: Set<number>; maxMoved: number; tapDone: boolean } | null =
    null;
  private limbo: { track: Track; peerId: number; upTime: number } | null = null;
  private palmSpots: { x: number; y: number; t: number }[] = [];
  private penSizes: number[] = [];
  /** Tailles des derniers contacts levés : sert de repère tant que rien n'est appris */
  private seenSizes: number[] = [];
  private journal: string[] = [];

  constructor(config: ClassifierConfig, listener: ClassifierListener, schedule?: Schedule) {
    this.config = config;
    this.listener = listener;
    this.schedule = schedule ?? ((fn, ms) => void setTimeout(fn, ms));
  }

  get effectiveMode(): 'active' | 'capacitive' | 'finger' {
    const m = this.config.mode;
    if (m === 'auto') return 'finger';
    return m;
  }

  /** Taille habituelle de ton stylet, apprise sur tes traits (médiane). */
  learnedPenSize(): number | null {
    if (this.penSizes.length < LEARN_MIN) return null;
    const sorted = [...this.penSizes].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  /**
   * Taille de référence du stylet : ce qui a été appris sur tes traits, sinon la valeur retenue des
   * sessions précédentes, sinon le plus fin des contacts récents (ta pointe est l'objet le plus fin de l'écran).
   */
  penReference(): number | null {
    return this.solidReference() ?? this.guessedReference();
  }

  /** Mesure fiable : apprise sur tes traits, ou retenue/calibrée sur cet appareil. */
  private solidReference(): number | null {
    return this.learnedPenSize() ?? (this.config.penSize || null);
  }

  /**
   * À défaut de mesure fiable : la taille « typique » des contacts récents qui ressemblaient à de
   * vrais traits (pas des taps). Sert seulement de garde-fou très large tant que rien n'est appris
   * ou calibré — dessiner au doigt (grande variance naturelle de taille d'un contact à l'autre) ne
   * doit jamais s'en trouver bloqué.
   */
  private guessedReference(): number | null {
    if (this.seenSizes.length < GUESS_MIN) return null;
    const sorted = [...this.seenSizes].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  palmThreshold(): number | null {
    if (this.config.sizeMode === 'off') return null;
    if (this.config.sizeMode === 'manual') return this.config.palmSize;
    const solid = this.solidReference();
    // Tant que la taille du stylet n'est pas sûre (rien d'appris, rien de calibré), la marge est
    // volontairement énorme : mieux vaut ne jamais bloquer un doigt ou un stylet que couper un peu de
    // paume. Le seuil serré, précis, c'est le rôle de la calibration manuelle ou des 8 traits appris.
    const m = solid ?? this.guessedReference();
    if (m === null) return null;
    return solid === null
      ? Math.round(Math.max(m * GUESS_RATIO, m + GUESS_MARGIN))
      : Math.round(Math.max(m * BIG_RATIO, m + BIG_MARGIN));
  }

  snapshot(): TrackInfo[] {
    return [...this.tracks.values()].map((t) => ({
      id: t.id,
      kind: t.kind,
      state: t.state,
      size: Math.round(t.maxSize),
      moved: Math.round(t.moved),
      reason: t.reason,
      x: t.last.x,
      y: t.last.y,
    }));
  }

  /** Dernières décisions, de la plus ancienne à la plus récente (pour comprendre un blocage sur l'appareil). */
  decisions(): string[] {
    return [...this.journal];
  }

  /** Survol d'un stylet actif (S Pen, stylet EMR) */
  hover(kind: InputKind) {
    if (kind === 'pen') this.markPen();
  }

  down(kind: InputKind, id: number, s: Sample, forcePan = false) {
    // Un nouveau contact pendant l'attente d'un tap à deux doigts : ce n'était pas un tap
    this.flushLimbo();
    const t: Track = {
      id, kind, state: 'pending', down: s, last: s, samples: [s], maxSize: s.size, moved: 0, path: 0,
      smooth: { x: s.x, y: s.y }, anchor: { x: s.x, y: s.y }, since: s.t, strict: false, duringStroke: false,
      promotable: false, contested: false, suspect: false, remember: true, held: false,
      reason: 'immobile : attend de bouger',
    };
    this.tracks.set(id, t);

    if (this.config.handTool || forcePan) return this.joinGesture(t);
    if (kind === 'pen') {
      this.markPen();
      return this.startDraw(t, 'stylet actif');
    }
    if (kind === 'mouse') return this.startDraw(t, 'souris');

    const mode = this.effectiveMode;
    if (mode === 'capacitive') {
      if (this.inRestZone(s)) return this.toPalm(t, 'zone de repos');
      if (this.anyDrawing('pen')) return this.toPalm(t, 'stylet actif en cours');
      if (this.gestureInfo && s.t - this.gestureInfo.lastMove > GESTURE_STALE) {
        this.dropGesture();
      }
      if (this.firstInState('gesture', t)) return this.toPalm(t, 'geste en cours');
      this.armHold(t);
      this.reviewPens(s.t, t);
      if (this.isPalmSized(t)) return this.toPalm(t, 'taille de paume');
    } else {
      // Tactile normal : acceptation directe sans rejet logiciel basé sur pointerType (rejet paume géré par l'OS)
      if (this.firstInState('gesture', t)) return this.joinGesture(t);
      return this.downFinger(t);
    }
    // Un trait qui vient à peine de commencer quand un second contact se pose : les deux se sont
    // peut-être posés ensemble (paume en deux points, deux doigts). On le remet en observation.
    for (const o of this.tracks.values()) {
      if (o !== t && o.kind === 'touch' && o.state === 'draw' && s.t - o.since <= PAIR_WINDOW && o.moved < PAIR_DECIDE) {
        this.listener.drawCancel(o.id);
        o.state = 'pending';
        o.reason = 'second contact posé en même temps : observé';
        this.note(`#${o.id % 1000} remis en observation (second contact)`);
      }
    }
    t.duringStroke = this.anyDrawing('touch');
    const nearPalm = this.nearPalmSpot(s);
    t.strict = t.duringStroke || nearPalm;
    if (nearPalm) t.reason = 'là où une paume vient de se lever : doit bouger davantage';
    else if (t.duringStroke) t.reason = 'posé pendant un trait : doit bouger davantage';
    if (!t.duringStroke) {
      // Deux appuis presque simultanés : peut-être un geste à deux doigts, leurs mouvements trancheront
      for (const o of this.tracks.values()) {
        if (o !== t && o.kind === 'touch' && o.state === 'pending' && o.peer === undefined && s.t - o.since <= PAIR_WINDOW) {
          o.peer = t.id;
          t.peer = o.id;
          break;
        }
      }
    }
  }

  move(id: number, samples: Sample[], predicted: Sample[] = []) {
    const t = this.tracks.get(id);
    if (!t || samples.length === 0) return;
    for (const s of samples) this.addSample(t, s);

    if (this.limbo && this.limbo.peerId === id && t.moved >= TAP_MOVE) this.flushLimbo();
    const capacitive = t.kind === 'touch' && this.effectiveMode === 'capacitive';
    if (capacitive) {
      this.reviewPens(t.last.t, t);
      // Veto absolu, vérifié à CHAQUE mouvement et quel que soit l'état : une taille de paume ne peut
      // jamais écrire ni participer à un geste, même après avoir déjà été prise pour un stylet ou un
      // doigt de défilement. Rien, plus bas dans cette fonction, ne doit pouvoir passer outre.
      if (this.isPalmSized(t)) {
        if (t.state === 'gesture') this.leaveGesture(t, t.last.t, false);
        if (t.state !== 'palm') return this.toPalm(t, 'taille de paume');
        return;
      }
    }
    // Deux contacts qui bougent en même temps : défilement ou zoom, quel que soit leur état
    if (t.kind === 'touch' && this.effectiveMode !== 'finger' && this.detectGesture(t.last.t)) return;
    this.checkHold(t);
    this.checkShapeHold(t);

    switch (t.state) {
      case 'draw':
        return this.listener.drawMove(id, samples, predicted);
      case 'gesture':
        return this.updateGesture(t);
      case 'pending':
        if (capacitive) this.resolvePending(t);
        return;
      case 'palm':
        if (capacitive && this.lockedStill(t)) return;
        if (capacitive && t.contested && this.anyDrawing('touch')) {
          this.becomePen(t, 'prend le relais', null);
        } else if (capacitive && t.promotable) {
          t.contested = false;
          const from = this.startsMoving(t);
          if (from !== null) this.becomePen(t, 'part franchement', from);
        }
        return;
    }
  }

  up(id: number, s?: Sample) {
    const t = this.tracks.get(id);
    if (!t) return;
    if (s) this.addSample(t, s);
    const now = t.last.t;
    this.tracks.delete(id);
    this.rememberSize(t);

    if (this.limbo && this.limbo.peerId === id) {
      const quick = now - this.limbo.upTime <= LIMBO_MS && t.moved < TAP_MOVE && now - t.down.t < TAP_MS + LIMBO_MS;
      const pending = this.limbo.track;
      this.limbo = null;
      if (quick) this.listener.twoFingerTap();
      else this.flushStroke(pending);
      return this.clearPeers(id);
    }

    switch (t.state) {
      case 'draw':
        this.finishStroke(t, true);
        break;
      case 'gesture':
        this.leaveGesture(t, now, true);
        break;
      case 'pending':
        this.upPending(t, now);
        break;
      case 'palm': {
        // Trait vif refusé jusqu'au bout pendant qu'une paume glissait : on le dessine en entier
        const active = [...this.tracks.values()].find((o) => o.kind === 'touch' && o.state === 'draw');
        if (
          t.contested && active && t.down.t > active.down.t && (active.suspect || this.isDrifting(active, now)) &&
          t.moved >= COMMIT_DIST_STRICT && this.pace(t, now) >= 60
        ) {
          this.eraseAsPalm(active, 'paume qui glisse');
          this.flushStroke(t, 'trait vif pendant que la paume glissait');
        } else if (now - t.down.t > 400) this.rememberPalm(t);
        break;
      }
    }
    this.clearPeers(id);
  }

  cancel(id: number) {
    const t = this.tracks.get(id);
    if (!t) return;
    this.tracks.delete(id);
    this.rememberSize(t);
    if (this.limbo && this.limbo.peerId === id) this.flushLimbo();
    switch (t.state) {
      case 'draw':
        // Android annule parfois le stylet quand il croit voir une paume : on garde les vrais traits
        if (t.kind === 'pen' || t.path >= 20) this.finishStroke(t, false);
        else this.listener.drawCancel(id);
        this.note(`#${id % 1000} annulé par Android`);
        break;
      case 'gesture':
        this.leaveGesture(t, t.last.t, false);
        break;
      case 'palm':
        this.rememberPalm(t);
        break;
      case 'pending':
        break;
    }
    this.clearPeers(id);
  }

  reset() {
    for (const t of this.tracks.values()) if (t.state === 'draw') this.listener.drawCancel(t.id);
    this.tracks.clear();
    this.gestureLast.clear();
    this.gestureInfo = null;
    this.limbo = null;
  }

  // ---------------------------------------------------------------- décisions

  private downFinger(t: Track) {
    const drawing = this.firstInState('draw', t);
    if (drawing) {
      if (drawing.moved < 12 && t.down.t - drawing.down.t <= PAIR_WINDOW) {
        this.listener.drawCancel(drawing.id);
        drawing.state = 'pending';
        this.joinGesture(drawing);
        return this.joinGesture(t);
      }
      return this.toPalm(t, 'un autre doigt écrit');
    }
    this.startDraw(t, 'doigt');
  }

  private resolvePending(t: Track) {
    const now = t.last.t;
    const peer = t.peer !== undefined ? this.tracks.get(t.peer) : undefined;
    if (peer && peer.state === 'pending') {
      if (!this.anyDrawing('touch') && now - Math.min(t.down.t, peer.down.t) <= PAIR_STALE) return this.resolvePair(t, peer);
      peer.peer = undefined;
    }
    t.peer = undefined;
    const age = now - t.down.t;
    if (age <= this.staticAfter) {
      if (this.pennish(t, age)) this.becomePen(t, 'se déplace', null);
      return;
    }
    if (this.lockedStill(t)) return this.toPalm(t, 'gros contact posé : verrouillé jusqu’à ce qu’il se lève');
    const from = this.startsMoving(t);
    if (from !== null) this.becomePen(t, 'part après une pause', from);
  }

  /** Deux contacts posés presque ensemble : geste à deux doigts, ou stylet + paume ? */
  private resolvePair(t: Track, peer: Track) {
    // Tout se compare depuis l'instant où les deux étaient posés : le second doigt part souvent en retard
    const start = Math.max(t.since, peer.since);
    const from = { t: this.posAt(t, start), peer: this.posAt(peer, start) };
    const step = (o: Track, o0: Sample) => ({ x: o.last.x - o0.x, y: o.last.y - o0.y });
    const a = step(t, from.t);
    const b = step(peer, from.peer);
    const na = Math.hypot(a.x, a.y);
    const nb = Math.hypot(b.x, b.y);
    const [mover, still, dm, ds] = na >= nb ? [t, peer, na, nb] : [peer, t, nb, na];
    if (dm < PAIR_DECIDE) return;
    const gap = Math.hypot(from.t.x - from.peer.x, from.t.y - from.peer.y);
    const gapNow = Math.hypot(t.last.x - peer.last.x, t.last.y - peer.last.y);
    const sideBySide = Math.abs(from.t.y - from.peer.y) < SIDE_BY_SIDE_DY && gap < SIDE_BY_SIDE_GAP;
    const bothMove = ds >= PAIR_BOTH;
    const cos = (a.x * b.x + a.y * b.y) / (na * nb || 1);
    const together = bothMove && cos > 0.7 && ds >= 0.6 * dm;
    const pinch = bothMove && cos < -0.3 && gap > 10 && Math.abs(gapNow - gap) / gap > 0.15;
    // Deux contacts qui glissent ensemble : défilement… ou paume qui se pose en deux points. On attend plus.
    if (together && dm < PAIR_GESTURE) return;
    mover.peer = still.peer = undefined;
    if (sideBySide || together || pinch) {
      this.joinGesture(still);
      this.joinGesture(mover);
      this.note(`#${mover.id % 1000} + #${still.id % 1000} : geste à deux doigts`);
      // Rattrape le mouvement fait pendant l'hésitation
      const cx = (t.last.x + peer.last.x) / 2;
      const cy = (t.last.y + peer.last.y) / 2;
      this.listener.panZoom(
        cx - (from.t.x + from.peer.x) / 2,
        cy - (from.t.y + from.peer.y) / 2,
        cx, cy,
        gap > 10 ? gapNow / gap : 1,
      );
      return;
    }
    still.reason = 'immobile : attend de bouger';
    this.becomePen(mover, 'se déplace, l’autre contact reste posé', null);
  }

  /**
   * Le contact veut écrire. Il n'est refusé que si un autre trait avance vraiment en même temps.
   * from : début du mouvement quand il part après une pause (seule cette partie est dessinée).
   */
  private becomePen(t: Track, why: string, from: number | null) {
    // Deuxième filet, en plus du veto déjà posé dans move() : quel que soit le chemin qui a mené ici,
    // un contact de la taille d'une paume ne devient jamais un stylet.
    if (t.kind === 'touch' && this.effectiveMode === 'capacitive' && this.isPalmSized(t)) {
      return this.toPalm(t, 'taille de paume');
    }
    const now = t.last.t;
    const active = [...this.tracks.values()].find((o) => o !== t && o.kind === 'touch' && o.state === 'draw');
    if (active) {
      // Vitesse de tracé, pas simple déplacement : une lettre tourne sur place sans être à l'arrêt
      const va = this.pace(active, now);
      const vt = this.pace(t, now);
      // Le contact posé en dernier est en général le stylet : c'est la paume qui était là avant
      const newer = t.down.t > active.down.t;
      const short = active.moved < SWITCH_MOVED && active.path < SWITCH_PATH;
      const idle = va < IDLE_SPEED && this.smoothedDispSince(active, now, 150) < 4;
      const sure = vt >= 60 && (!t.duringStroke || t.moved >= COMMIT_DIST_STRICT);
      if (newer && short && idle) {
        this.eraseAsPalm(active, 'paume qui a glissé en se posant');
      } else if (newer && (active.suspect || this.isDrifting(active, now))) {
        // Soupçon gardé : la vitesse moyenne d'une paume qui glisse oscille autour du seuil
        active.suspect = true;
        if (!sure) return this.refuse(t, true);
        this.eraseAsPalm(active, 'paume qui glisse');
      } else if (
        newer
          ? va < IDLE_SPEED || (vt >= 60 && vt >= 2 * va)
          : // Un contact posé avant ne reprend la main que si le trait en cours est vraiment à l'arrêt
            now - active.since >= 300 && this.smoothedDispSince(active, now, 300) < 4
      ) {
        // Relais : un trait remplacé qui n'a jamais tracé vite était une paume, sinon on le garde
        if (newer && sure && this.meanSpeed(active, now) < 1.5 * DRIFT_SPEED) {
          this.eraseAsPalm(active, 'paume lente remplacée par le stylet');
        } else if (active.path < 6) {
          // Quelques points à peine : garder ce grain de poussière ne sert à rien
          this.toPalm(active, 'trait trop court (effacé)');
        } else {
          this.finishStroke(active, false);
          active.state = 'palm';
          active.promotable = true;
          active.remember = false;
          active.reason = 'trait gardé, un autre contact écrit';
        }
      } else {
        return this.refuse(t, newer);
      }
    }
    if (t.peer !== undefined) {
      const p = this.tracks.get(t.peer);
      if (p) p.peer = undefined;
      t.peer = undefined;
    }
    if (from !== null) this.rebase(t, from);
    this.startDraw(t, why);
  }

  /**
   * Deux contacts qui bougent vraiment en même temps = défilement ou zoom, même s'ils ont été posés
   * à plusieurs secondes d'intervalle, même si l'un d'eux avait été pris pour une paume.
   */
  private detectGesture(now: number): boolean {
    if (this.gestureInfo) return false;
    const movers: { track: Track; from: Sample; step: { x: number; y: number }; d: number }[] = [];
    const capacitive = this.effectiveMode === 'capacitive';
    for (const o of this.tracks.values()) {
      if (o.kind !== 'touch' || o.state === 'gesture') continue;
      // Un contact de la taille d'une paume ne peut jamais déclencher un défilement ou un zoom, même
      // s'il glisse : un vrai geste se fait avec deux doigts, pas avec la main qui se déplace en écrivant.
      if (capacitive && this.isPalmSized(o)) continue;
      // Un vrai trait (long ou déjà ancien) n'est pas sacrifié ; un début de gribouillis, si
      if (o.state === 'draw' && (now - o.since > 700 || o.path > 120)) continue;
      // Déplacement lissé : le tremblement d'une paume posée ne compte pas
      const d = this.smoothedDispSince(o, now, GESTURE_WINDOW);
      if (d < GESTURE_MOVE) continue;
      // …et un mouvement franc, pas un gribouillage : la longueur parcourue suit le déplacement
      if (this.pathSince(o, now, GESTURE_WINDOW) > 2.2 * d) continue;
      const from = this.posAt(o, now - GESTURE_WINDOW);
      movers.push({ track: o, from, step: { x: o.last.x - from.x, y: o.last.y - from.y }, d });
    }
    if (movers.length < 2) return false;
    movers.sort((a, b) => b.d - a.d);
    const [a, b] = movers;
    const cos = (a.step.x * b.step.x + a.step.y * b.step.y) / (a.d * b.d || 1);
    const gapBefore = Math.hypot(a.from.x - b.from.x, a.from.y - b.from.y);
    const gapNow = Math.hypot(a.track.last.x - b.track.last.x, a.track.last.y - b.track.last.y);
    // Défilement : les deux vont dans le même sens, à la même allure. Zoom : l'écart change nettement.
    const together = cos > 0.8 && b.d >= 0.5 * a.d;
    const pinch = cos < 0.2 && Math.abs(gapNow - gapBefore) >= GESTURE_PINCH;
    if (!together && !pinch) return false;
    for (const m of [a, b]) {
      if (m.track.state === 'draw') this.listener.drawCancel(m.track.id);
      m.track.peer = undefined;
      this.joinGesture(m.track);
    }
    this.note(`#${a.track.id % 1000} + #${b.track.id % 1000} : ${pinch && !together ? 'zoom' : 'défilement'} à deux doigts`);
    // Rattrape le mouvement fait avant la détection
    const cx = (a.track.last.x + b.track.last.x) / 2;
    const cy = (a.track.last.y + b.track.last.y) / 2;
    this.listener.panZoom(
      (a.step.x + b.step.x) / 2,
      (a.step.y + b.step.y) / 2,
      cx,
      cy,
      gapBefore > 10 ? gapNow / gapBefore : 1,
    );
    return true;
  }

  /**
   * Appui long immobile pendant un trait : le contact passe en gomme jusqu'à ce qu'il se lève
   * (comme JNotes). Vérifié à chaque mouvement et par un minuteur, car un stylet immobile
   * n'envoie parfois plus rien.
   */
  private checkHold(t: Track, now = t.last.t): boolean {
    const delay = this.config.holdEraseMs ?? 0;
    if (!delay || t.held || !this.listener.holdErase || !this.holdCandidate(t)) return false;
    if (now - t.since < delay) return false;
    if (t.path > HOLD_PATH || this.smoothedDispSince(t, Math.max(now, t.last.t), Math.min(delay, 400)) > 4) return false;
    t.held = true;
    // Posé sans rien tracer : le trait (vide) commence maintenant, aussitôt transformé en gomme
    if (t.state !== 'draw') this.startDraw(t, 'appui long');
    t.reason = 'appui long : gomme';
    this.note(`#${t.id % 1000} appui long → gomme`);
    this.listener.holdErase(t.id);
    return true;
  }

  /**
   * Appui long à la fin d'un vrai tracé (dessiner → maintenir → ajuster) : le contact vient de
   * dessiner quelque chose (path assez long) puis s'est arrêté net pendant tout le délai — pas
   * juste depuis le début (une forme peut se dessiner lentement). Zone morte avec `checkHold` :
   * un tracé trop court pour l'un n'est pas encore assez long pour l'autre, jamais les deux à la fois.
   */
  private checkShapeHold(t: Track, now = t.last.t): boolean {
    const delay = this.config.shapeHoldMs ?? 0;
    if (!delay || t.held || t.kind === 'mouse' || !this.listener.shapeHold || t.state !== 'draw') return false;
    if (t.path < SHAPE_MIN_PATH) return false;
    if (now - t.since < delay) return false;
    // Vraiment immobile : plus un seul échantillon depuis (presque) tout le délai. Comparer la
    // position à deux instants passés se ferait piéger par une forme refermée (un cercle revient
    // près de son départ) alors que le stylet est peut-être encore en train de bouger.
    if (now - t.last.t < delay - HOLD_RETRY_MS) return false;
    t.held = true;
    t.reason = 'appui long : forme ?';
    this.note(`#${t.id % 1000} appui long → forme ?`);
    this.listener.shapeHold(t.id);
    return true;
  }

  /**
   * Qui a le droit de devenir une gomme par appui long ? Le contact qui écrit déjà, ou — s'il est
   * seul et de la taille du stylet connu — un contact simplement posé. Jamais une paume.
   */
  private holdCandidate(t: Track): boolean {
    if (t.kind !== 'touch') return t.state === 'draw';
    if (t.state === 'draw') return true;
    if (t.state !== 'pending') return false;
    if (this.anyDrawing('touch') || this.anyDrawing('pen')) return false;
    // Même seuil que partout ailleurs : s'il n'est pas (encore) reconnu comme une paume, il peut gommer.
    // Sans aucune référence de taille (tout début de session), on laisse faire : mieux vaut un appui
    // long trop permissif au premier contact qu'un appui long qui ne marche jamais.
    return !this.isPalmSized(t);
  }

  /** Refusé pour l'instant : un contact posé après le trait en cours réessaie à chaque mouvement. */
  private refuse(t: Track, retry: boolean) {
    if (t.state !== 'palm') this.toPalm(t, retry ? 'un autre contact écrit (on vérifie)' : 'un autre trait avance', true);
    t.contested = retry;
  }

  private eraseAsPalm(t: Track, reason: string) {
    this.toPalm(t, `${reason} (trait effacé)`, true);
    t.suspect = true;
  }

  /** Lent depuis le début et encore lent : une paume qui glisse avec la main, pas un stylet qui écrit. */
  private isDrifting(t: Track, now: number) {
    const life = now - t.since;
    return life >= 150 && (t.path * 1000) / life < DRIFT_SPEED && this.meanSpeed(t, now) < DRIFT_SPEED;
  }

  /** Vitesse de tracé (px/s) : moyenne sur 300 ms si possible, sinon vitesse récente. */
  private pace(t: Track, now: number) {
    const m = this.meanSpeed(t, now, 300);
    return Number.isFinite(m) ? m : this.speed(t, now);
  }

  private upPending(t: Track, now: number) {
    const duration = now - t.down.t;
    const peer = t.peer !== undefined ? this.tracks.get(t.peer) : undefined;
    if (peer && peer.state === 'pending' && t.moved < TAP_MOVE && duration < TAP_MS) {
      // Tap à deux doigts… ou point au stylet pendant que la paume reste posée
      const limbo = { track: t, peerId: peer.id, upTime: now };
      this.limbo = limbo;
      this.schedule(() => {
        if (this.limbo === limbo) this.flushLimbo();
      }, LIMBO_MS);
      return;
    }
    if (peer) peer.peer = undefined;
    // Les deux contacts bougeaient ensemble (début de défilement) : pas de trait
    const gestureLike = !!peer && peer.state === 'pending' && peer.moved >= PAIR_BOTH;
    if (!gestureLike && !t.duringStroke && !this.anyDrawing('touch')) {
      // Point (virgule décimale, point du i…) ou petit trait très vif levé avant d'être validé
      if (t.moved < COMMIT_DIST && duration <= DOT_MAX_MS) return this.flushStroke(t, 'point');
      if (duration <= this.staticAfter && this.pennish(t, duration)) return this.flushStroke(t, 'petit trait');
    }
    if (duration > 400) this.rememberPalm(t);
  }

  /** Quand un autre contact arrive ou bouge : un « trait » court resté arrêté longtemps était une paume. */
  private reviewPens(now: number, except: Track) {
    for (const o of this.tracks.values()) {
      if (o === except || o.kind !== 'touch' || o.state !== 'draw') continue;
      if (now - o.since > IDLE_PEN_MS && o.moved < IDLE_PEN_MOVED && this.speed(o, now, 400) < 10) {
        this.toPalm(o, 'posé sans bouger (trait effacé)', true);
        o.suspect = true;
      }
    }
  }

  // ---------------------------------------------------------------- mesures

  /** Déplacement franc depuis l'appui : assez loin (position lissée), assez vite, et à peu près en ligne. */
  private pennish(t: Track, age: number): boolean {
    const d = this.smoothedDisp(t);
    const min = t.strict ? COMMIT_DIST_STRICT : COMMIT_DIST;
    return d >= min && t.path <= STRAIGHTNESS * d + 4 && (d * 1000) / Math.max(age, 1) >= COMMIT_SPEED;
  }

  /** Un contact posé qui part franchement : renvoie le début de ce mouvement, sinon null. */
  private startsMoving(t: Track): number | null {
    const now = t.last.t;
    const quick = this.smoothedDispSince(t, now, QUICK_MS);
    if (quick >= QUICK_DIST && this.pathSince(t, now, QUICK_MS) <= STRAIGHTNESS * quick + 4) return now - QUICK_MS;
    if (t.suspect) return null;
    const slow = this.smoothedDispSince(t, now, SLOW_MS);
    if (slow >= SLOW_DIST && this.pathSince(t, now, SLOW_MS) <= 2 * slow + 4) return now - SLOW_MS;
    return null;
  }

  /** Déplacement sur la fenêtre, entre positions moyennées sur 24 ms (le tremblement ne compte pas). */
  private smoothedDispSince(t: Track, now: number, windowMs: number): number {
    const mean = (time: number) => {
      const a = this.posAt(t, time);
      const b = this.posAt(t, time - 12);
      const c = this.posAt(t, time - 24);
      return { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 };
    };
    const p = mean(now);
    const q = mean(now - windowMs);
    return Math.hypot(p.x - q.x, p.y - q.y);
  }

  /** Distance entre la position moyenne des 3 derniers échantillons et le début du trait. */
  private smoothedDisp(t: Track): number {
    const s = t.samples.slice(-3);
    const x = s.reduce((a, p) => a + p.x, 0) / s.length;
    const y = s.reduce((a, p) => a + p.y, 0) / s.length;
    return Math.hypot(x - t.samples[0].x, y - t.samples[0].y);
  }

  /** Vitesse moyenne (px/s) sur la fin du trait, positions moyennées par tranches de 40 ms. */
  private meanSpeed(t: Track, now: number, windowMs = 500): number {
    const start = Math.max(t.since, now - windowMs);
    const buckets = Math.floor((now - start) / 40);
    if (buckets < 3) return Infinity;
    const meanPos = (time: number) => {
      let x = 0;
      let y = 0;
      for (let k = 0; k < 5; k++) {
        const p = this.posAt(t, time - k * 8);
        x += p.x;
        y += p.y;
      }
      return { x: x / 5, y: y / 5 };
    };
    let prev = meanPos(start + 40);
    let dist = 0;
    for (let i = 2; i <= buckets; i++) {
      const p = meanPos(start + i * 40);
      dist += Math.hypot(p.x - prev.x, p.y - prev.y);
      prev = p;
    }
    return (dist * 1000) / ((buckets - 1) * 40);
  }

  /** Position du contact à l'instant time (dernier échantillon reçu avant). */
  private posAt(t: Track, time: number): Sample {
    const s = t.samples;
    if (time <= s[0].t) return s[0];
    let lo = 0;
    let hi = s.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (s[mid].t <= time) lo = mid;
      else hi = mid - 1;
    }
    return s[lo];
  }

  private pathSince(t: Track, now: number, windowMs: number): number {
    const s = t.samples;
    let prev = this.posAt(t, now - windowMs);
    let path = 0;
    for (let i = s.indexOf(prev) + 1; i < s.length; i++) {
      path += Math.hypot(s[i].x - prev.x, s[i].y - prev.y);
      prev = s[i];
    }
    return path;
  }

  /** Vitesse (px/s) entre les positions moyennes des deux moitiés de la fenêtre : insensible au tremblement. */
  private speed(t: Track, now: number, windowMs = SPEED_WINDOW): number {
    const half = windowMs / 2;
    const n = 4;
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < n; i++) {
      const a = this.posAt(t, now - windowMs + ((i + 0.5) * half) / n);
      const b = this.posAt(t, now - half + ((i + 0.5) * half) / n);
      dx += b.x - a.x;
      dy += b.y - a.y;
    }
    return ((Math.hypot(dx, dy) / n) * 1000) / half;
  }

  private get staticAfter() {
    return this.config.staticAfter ?? STATIC_AFTER;
  }

  /**
   * Nettement plus gros que ton stylet (taille apprise sur tes traits) et posé depuis assez longtemps :
   * ta paume. Elle ne pourra plus écrire, même si elle se met à glisser, tant qu'elle n'est pas levée.
   */
  private lockedStill(t: Track) {
    if (!this.config.lockBigStill || this.config.sizeMode === 'off') return false;
    // Déjà classé « taille de paume » (seuil calibré ou appris) : verrouillé tout de suite, sans attendre.
    if (this.isPalmSized(t)) return true;
    const m = this.penReference();
    return m !== null && t.maxSize >= Math.max(m * 1.15, m + 20) && t.last.t - t.down.t > this.staticAfter;
  }

  private isPalmSized(t: Track) {
    const threshold = this.palmThreshold();
    return threshold !== null && t.maxSize > threshold;
  }

  /** Taille des contacts levés : repère du plus fin (le stylet) tant que rien n'est appris. */
  /**
   * Ne retient que des contacts qui ressemblent à un vrai trait (pas un tap, pas un point, pas un
   * effleurement d'une fraction de seconde) : ceux-là seuls donnent une idée fiable de la taille
   * habituelle d'un contact sur cet écran. Un tap/point peut remonter une taille minuscule qui n'a
   * rien à voir avec un trait normal, et fausserait complètement l'estimation.
   */
  private rememberSize(t: Track) {
    if (t.kind !== 'touch' || t.maxSize <= 0) return;
    if (t.path < GUESS_STROKE_PATH || t.last.t - t.since < GUESS_STROKE_MS) return;
    this.seenSizes.push(t.maxSize);
    if (this.seenSizes.length > 24) this.seenSizes.shift();
  }

  private nearPalmSpot(s: Sample) {
    return this.palmSpots.some((p) => s.t - p.t <= PALM_MEMORY_MS && Math.hypot(s.x - p.x, s.y - p.y) < PALM_MEMORY_RADIUS);
  }

  private inRestZone(s: Sample) {
    return this.config.restTop !== null && s.y >= this.config.restTop;
  }

  // ---------------------------------------------------------------- transitions

  private note(message: string) {
    if (this.journal[this.journal.length - 1] === message) return;
    this.journal.push(message);
    if (this.journal.length > JOURNAL) this.journal.shift();
  }

  private addSample(t: Track, s: Sample) {
    t.samples.push(s);
    // Une paume posée longtemps envoie des centaines d'échantillons : seuls les récents servent
    if (t.samples.length > 240 && s.t - t.samples[0].t > 2 * KEEP_SAMPLES_MS) {
      t.samples = t.samples.filter((x) => s.t - x.t <= KEEP_SAMPLES_MS);
    }
    this.trace(t, s, s.t - t.last.t);
    t.last = s;
    t.maxSize = Math.max(t.maxSize, s.size);
    t.moved = Math.max(t.moved, Math.hypot(s.x - t.down.x, s.y - t.down.y));
  }

  /** Longueur parcourue sur une position lissée (≈ 20 ms) : le tremblement d'une paume ne s'additionne pas. */
  private trace(t: Track, s: Sample, dt: number) {
    const a = 1 - Math.exp(-Math.max(dt, 4) / 20);
    t.smooth = { x: t.smooth.x + a * (s.x - t.smooth.x), y: t.smooth.y + a * (s.y - t.smooth.y) };
    const step = Math.hypot(t.smooth.x - t.anchor.x, t.smooth.y - t.anchor.y);
    if (step >= 1.5) {
      t.path += step;
      t.anchor = { ...t.smooth };
    }
  }

  /** Le trait commence à from : on oublie ce qui précède (le contact était posé). */
  private rebase(t: Track, from: number) {
    const first = this.posAt(t, from);
    t.samples = t.samples.slice(t.samples.indexOf(first));
    t.down = { ...t.down, x: first.x, y: first.y };
    t.since = first.t;
    t.moved = 0;
    t.path = 0;
    t.smooth = { x: first.x, y: first.y };
    t.anchor = { x: first.x, y: first.y };
    for (let i = 1; i < t.samples.length; i++) {
      const s = t.samples[i];
      t.moved = Math.max(t.moved, Math.hypot(s.x - first.x, s.y - first.y));
      this.trace(t, s, s.t - t.samples[i - 1].t);
    }
  }

  private clearPeers(id: number) {
    for (const o of this.tracks.values()) if (o.peer === id) o.peer = undefined;
  }

  private markPen() {
    if (this.penSeen) return;
    this.penSeen = true;
    this.listener.penDetected();
  }

  private anyDrawing(kind: InputKind) {
    for (const o of this.tracks.values()) if (o.kind === kind && o.state === 'draw') return true;
    return false;
  }

  private firstInState(state: TrackState, except: Track) {
    for (const o of this.tracks.values()) if (o !== except && o.state === state) return o;
    return undefined;
  }

  /** Un stylet immobile n'envoie plus d'événement : un minuteur vient vérifier l'appui long. */
  private armHold(t: Track) {
    const eraseDelay = this.config.holdEraseMs ?? 0;
    const shapeDelay = this.config.shapeHoldMs ?? 0;
    const wantErase = eraseDelay > 0 && !!this.listener.holdErase;
    const wantShape = shapeDelay > 0 && !!this.listener.shapeHold;
    if ((!wantErase && !wantShape) || t.kind === 'mouse') return;
    const firstDelay = Math.min(...[wantErase ? eraseDelay : Infinity, wantShape ? shapeDelay : Infinity]);
    const maxDelay = Math.max(wantErase ? eraseDelay : 0, wantShape ? shapeDelay : 0);
    // Un stylet parfaitement immobile n'envoie parfois plus un seul événement : c'est ce minuteur, et
    // lui seul, qui peut déclencher la gomme ou la reconnaissance de forme. S'il rate sa chance une
    // première fois (un autre contact dessinait encore à cet instant précis, par exemple), il
    // retente, jusqu'à ce que le contact soit levé.
    const tick = (elapsed: number) => {
      if (t.held || this.tracks.get(t.id) !== t) return;
      const now = Math.max(t.last.t, t.since + elapsed);
      if (wantErase && this.checkHold(t, now)) return;
      if (wantShape && this.checkShapeHold(t, now)) return;
      if (elapsed < maxDelay + HOLD_RETRY_SPAN) this.schedule(() => tick(elapsed + HOLD_RETRY_MS), HOLD_RETRY_MS);
    };
    this.schedule(() => tick(firstDelay + 20), firstDelay + 20);
  }

  private startDraw(t: Track, why: string) {
    t.state = 'draw';
    t.promotable = false;
    t.contested = false;
    this.armHold(t);
    t.reason = `écrit : ${why}`;
    if (t.kind === 'touch') this.note(`#${t.id % 1000} écrit (${why})`);
    this.listener.drawStart(t.id, t.kind, t.samples.slice());
  }

  private finishStroke(t: Track, learn: boolean) {
    this.listener.drawEnd(t.id);
    // Un trait déjà soupçonné d'être une paume n'a rien à apprendre sur la taille du stylet
    if (learn && !t.suspect && t.kind === 'touch' && t.path >= 20 && t.last.t - t.since >= 60 && t.maxSize > 0) {
      const before = this.learnedPenSize();
      this.penSizes.push(t.maxSize);
      if (this.penSizes.length > LEARN_MAX) this.penSizes.shift();
      const after = this.learnedPenSize();
      // La taille du stylet est retenue d'une session à l'autre : le filtre marche dès le premier trait
      if (after !== null && after !== before) this.listener.penSizeLearned?.(after);
    }
  }

  /** Dessine d'un coup un contact décidé à sa levée (point, ou petit trait). */
  private flushStroke(t: Track, why = 'point') {
    if (t.kind === 'touch') this.note(`#${t.id % 1000} écrit (${why})`);
    this.listener.drawStart(t.id, t.kind, t.samples.slice());
    this.finishStroke(t, false);
  }

  private flushLimbo() {
    const limbo = this.limbo;
    if (!limbo) return;
    this.limbo = null;
    this.flushStroke(limbo.track);
    const peer = this.tracks.get(limbo.peerId);
    if (peer) this.toPalm(peer, 'posé pendant un point au stylet', true);
  }

  private rememberPalm(t: Track) {
    if (!t.remember) return;
    const now = t.last.t;
    this.palmSpots = this.palmSpots.filter((p) => now - p.t <= PALM_MEMORY_MS).slice(-11);
    this.palmSpots.push({ x: t.last.x, y: t.last.y, t: now });
  }

  private toPalm(t: Track, reason: string, promotable = false) {
    if (t.state === 'draw') this.listener.drawCancel(t.id);
    if (t.state === 'gesture') {
      t.state = 'palm';
      this.leaveGesture(t, t.last.t, false);
    }
    if (t.peer !== undefined) {
      const p = this.tracks.get(t.peer);
      if (p) p.peer = undefined;
      t.peer = undefined;
    }
    t.state = 'palm';
    t.promotable = promotable;
    t.reason = `ignoré : ${reason}`;
    if (t.kind === 'touch') this.note(`#${t.id % 1000} ignoré (${reason})`);
  }

  /** Geste resté immobile : ce sont des doigts ou une paume posés, ils ne bloquent plus l'écriture. */
  private dropGesture() {
    for (const o of this.tracks.values()) {
      if (o.state !== 'gesture') continue;
      o.state = 'palm';
      o.promotable = false;
      o.remember = false;
      o.reason = 'ignoré : geste arrêté';
    }
    this.gestureInfo = null;
    this.gestureLast.clear();
  }

  private joinGesture(t: Track) {
    t.state = 'gesture';
    t.reason = 'geste (défilement / zoom)';
    if (!this.gestureInfo) {
      this.gestureInfo = { start: t.down.t, lastMove: t.last.t, ids: new Set(), maxMoved: 0, tapDone: false };
    }
    this.gestureInfo.ids.add(t.id);
    this.gestureInfo.lastMove = Math.max(this.gestureInfo.lastMove, t.last.t);
    this.resetGestureAnchors();
  }

  private leaveGesture(t: Track, now: number, allowTap: boolean) {
    const info = this.gestureInfo;
    const remaining = [...this.tracks.values()].filter((o) => o.state === 'gesture' && o !== t);
    if (info) info.maxMoved = Math.max(info.maxMoved, t.moved, ...remaining.map((o) => o.moved));
    // Tap à deux doigts = annuler, détecté dès le premier doigt levé
    const isTap =
      allowTap && !!info && !info.tapDone && info.ids.size === 2 && info.maxMoved < TAP_MOVE && now - info.start < TAP_MS;
    if (isTap && info) {
      info.tapDone = true;
      this.listener.twoFingerTap();
    }
    const keepPanning = !isTap && (this.effectiveMode === 'active' || this.config.handTool);
    if (remaining.length === 0 || !keepPanning) {
      // Après un zoom ou un tap, le doigt restant ne doit pas se mettre à écrire
      for (const o of remaining) {
        o.state = 'palm';
        o.remember = false;
        o.promotable = false;
        o.reason = 'ignoré : fin de geste';
      }
      this.gestureInfo = null;
      this.gestureLast.clear();
      return;
    }
    this.resetGestureAnchors();
  }

  private resetGestureAnchors() {
    this.gestureLast.clear();
    for (const o of this.tracks.values()) {
      if (o.state === 'gesture') this.gestureLast.set(o.id, { x: o.last.x, y: o.last.y });
    }
  }

  private updateGesture(t: Track) {
    const g = [...this.tracks.values()].filter((o) => o.state === 'gesture').slice(0, 2);
    if (this.gestureInfo) this.gestureInfo.maxMoved = Math.max(this.gestureInfo.maxMoved, t.moved);
    // Des doigts (ou une paume) qui ne bougent plus : le geste s'arrête, l'écriture redevient possible
    if (
      this.effectiveMode === 'capacitive' && g.length >= 2 &&
      t.last.t - (this.gestureInfo?.lastMove ?? t.last.t) > GESTURE_STALE &&
      g.every((o) => this.smoothedDispSince(o, t.last.t, GESTURE_STALE) < 5)
    ) {
      return this.dropGesture();
    }
    const before = g.map((o) => this.gestureLast.get(o.id) ?? { x: o.last.x, y: o.last.y });
    const after = g.map((o) => ({ x: o.last.x, y: o.last.y }));
    for (const o of g) this.gestureLast.set(o.id, { x: o.last.x, y: o.last.y });

    const center = (pts: { x: number; y: number }[]) => ({
      x: pts.reduce((a, p) => a + p.x, 0) / pts.length,
      y: pts.reduce((a, p) => a + p.y, 0) / pts.length,
    });
    const c0 = center(before);
    const c1 = center(after);
    let factor = 1;
    if (g.length === 2) {
      const d0 = Math.hypot(before[0].x - before[1].x, before[0].y - before[1].y);
      const d1 = Math.hypot(after[0].x - after[1].x, after[0].y - after[1].y);
      if (d0 > 10) factor = d1 / d0;
    }
    // Le tremblement d'une main posée ne compte pas comme « le geste continue »
    if (this.gestureInfo && (Math.hypot(c1.x - c0.x, c1.y - c0.y) >= 2.5 || Math.abs(factor - 1) > 0.03)) {
      this.gestureInfo.lastMove = t.last.t;
    }
    this.listener.panZoom(c1.x - c0.x, c1.y - c0.y, c1.x, c1.y, factor);
  }
}
