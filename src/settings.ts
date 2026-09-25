import { useCallback, useState } from 'react';
import type { SizeMode } from './ink/palm';
import type { Handedness, PaperStyle, StylusMode } from './ink/types';
import { DEFAULT_SELECTION_COLORS, normalizeSelectionColors, normalizeShapeColor } from './colors';

export interface Settings {
  color: string;
  size: number;
  /** Couleur des formes et des lignes ; `null` : automatique (noire sur papier clair, blanche sur papier sombre) */
  shapeColor: string | null;
  /** Trait en pointillés au stylo et pour les formes */
  dashed: boolean;
  /** Gomme : par trait (efface tout le trait touché) ou de précision (efface seulement la zone touchée) */
  eraserMode: 'stroke' | 'precision';
  /** Lasso : tracé à main levée, ou cadre rectangulaire tiré d'un coin à l'autre */
  lassoShape: 'free' | 'rect';
  /** Rayon de la gomme (px d'écran) */
  eraserSize: number;
  paper: PaperStyle;
  stylusMode: StylusMode;
  sizeMode: SizeMode;
  palmSize: number;
  handedness: Handedness;
  /** Part basse de la zone d'écriture réservée à la main (0 = désactivée) */
  restZone: number;
  /** Un contact plus gros que le stylet appris et resté posé n'écrit plus avant d'être levé */
  lockBigStill: boolean;
  /** Délai (ms) au-delà duquel un contact resté sur place est « posé » */
  staticAfter: number;
  /** Taille du stylet (px) apprise sur tes traits, retenue d’une session à l’autre */
  penSizePx: number | null;
  /** Appui long immobile du stylet = gomme temporaire */
  holdEraser: boolean;
  /** Durée de l’appui long (ms) */
  holdMs: number;
  /** Dessiner → maintenir → ajuster : appui long en fin de tracé = reconnaissance de forme */
  shapeHold: boolean;
  /** Durée de l’appui long avant reconnaissance (ms) */
  shapeHoldMs: number;
  lowLatency: boolean;
  penSeen: boolean;
  /** ID client OAuth Google (gratuit) pour la sauvegarde Drive */
  driveClientId: string;
  driveAutoSync: boolean;
  /**
   * Synchronisation temps réel via Firebase Firestore (expérimental, à activer soi-même). Désactivée par
   * défaut : tant qu'elle est fausse, aucune connexion Firestore n'est ouverte et l'appli fonctionne
   * exactement comme avant (hors-ligne + Drive). Voir src/sync/firestore.ts.
   */
  firestoreSync: boolean;
  /** Export manuscrit */
  handStyle: 'mine' | 'caveat' | 'kalam' | 'patrick';
  handInk: string;
  handPaper: PaperStyle;
  handSize: 'small' | 'medium' | 'large';
  /** Amplitude des variations naturelles (0,5 légère · 1 naturelle · 1,6 forte) */
  handVariation: number;
  highlightColor: string;
  highlightSize: number;
  /** Palette de la barre d'une sélection : les 3 dernières couleurs choisies, la plus récente en premier */
  selectionColors: string[];
  /** Export « PDF de mes notes » en mode impression : fond blanc, encre claire convertie en foncé */
  printMode: boolean;
}

const KEY = 'notes-maths.settings';

const DEFAULTS: Settings = {
  color: '#1d2433',
  size: 0.6,
  shapeColor: null,
  dashed: false,
  eraserMode: 'stroke',
  lassoShape: 'free',
  eraserSize: 12,
  paper: 'grid',
  // Mode 'active' strict : seul le stylet écrit/gomme, le tactile déplace et zoome (aucun trait fantôme de paume)
  stylusMode: 'active',
  sizeMode: 'off',
  palmSize: 300,
  handedness: 'right',
  restZone: 0,
  lockBigStill: false,
  staticAfter: 250,
  penSizePx: null,
  holdEraser: true,
  holdMs: 700,
  shapeHold: true,
  shapeHoldMs: 300,
  lowLatency: false,
  penSeen: false,
  driveClientId: '',
  driveAutoSync: true,
  firestoreSync: false,
  handStyle: 'caveat',
  handInk: '#1f3a8a',
  handPaper: 'seyes',
  handSize: 'medium',
  handVariation: 1,
  highlightColor: '#facc15',
  highlightSize: 5,
  selectionColors: [...DEFAULT_SELECTION_COLORS],
  printMode: false,
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const saved = JSON.parse(raw) as Partial<Settings>;
    // Ancien seuil fixe de 50 px, inadapté aux stylets vus comme de gros doigts
    if (saved.sizeMode === undefined) delete saved.palmSize;
    // Réglages d'anciennes versions (trousse, ruban d'étude) : abandonnés
    // `lockEnabled` : le verrouillage n'est plus optionnel, il est systématique.
    // `showContacts` (diagnostic dessiné sur la page) et `restZone` (bande réservée à la main) ont quitté les
    // Réglages : on les remet à leur valeur par défaut, sinon ils resteraient actifs sans aucun moyen de les
    // couper. Le calibrage anti-paume déjà enregistré, lui, est conservé tel quel.
    // La conversion par IA (Gemini) est abandonnée : sa clé API ne doit plus traîner dans le stockage du
    // navigateur, pas plus que ses réglages.
    const legacyKeys = ['pencilCase', 'tapeColor', 'tapeSize', 'tapeHintSeen', 'lockEnabled', 'showContacts', 'restZone', 'apiKey', 'model', 'autoFallback', 'subject', 'convertBackground'];
    const hadLegacy = legacyKeys.some((k) => k in saved);
    for (const legacy of legacyKeys) delete (saved as Record<string, unknown>)[legacy];
    // Réécrit tout de suite, sans attendre le prochain réglage modifié : la clé API disparaît du disque dès
    // l'ouverture de l'appli
    if (hadLegacy) localStorage.setItem(KEY, JSON.stringify(saved));
    // Migration vers le mode actif strict par défaut
    if (saved.stylusMode === 'auto' || saved.stylusMode === 'capacitive' || !saved.stylusMode) {
      saved.stylusMode = 'active';
      saved.sizeMode = 'off';
    }
    return { ...DEFAULTS, ...saved, selectionColors: normalizeSelectionColors(saved.selectionColors), shapeColor: normalizeShapeColor(saved.shapeColor) };
  } catch {
    return DEFAULTS;
  }
}


export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [settings, setSettings] = useState(load);
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* stockage indisponible (navigation privée) */
      }
      return next;
    });
  }, []);
  return [settings, update];
}
