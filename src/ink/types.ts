/** Page A4, coordonnées en millimètres. */
export const PAGE_W = 210;
export const PAGE_H = 297;

/** [x (mm), y (mm), pression 0..1] */
export type InkPoint = [number, number, number];

export type InputKind = 'pen' | 'touch' | 'mouse';

export type StrokeTool = 'pen' | 'highlighter' | 'image' | 'shape' | 'text';

/**
 * Cercle/rectangle/triangle : le rectangle points[0]–points[1]. Flèche : points[0] = départ,
 * points[1] = arrivée (la pointe). Repères, torseur, matrice : le rectangle qui les contient.
 */
export type ShapeKind =
  | 'circle'
  | 'rect'
  | 'triangle'
  | 'arrow'
  | 'line'
  | 'axes2d'
  | 'axes3d'
  | 'torseur'
  | 'matrix'
  | 'cylinder'
  | 'cone'
  | 'sphere'
  | 'hemisphere'
  | 'pyramid'
  | 'cuboid'
  | 'torus'
  | 'prism'
  | 'tetrahedron'
  | 'ellipsoid';

export interface Stroke {
  id: string;
  points: InkPoint[];
  color: string;
  /** Épaisseur en mm (sans effet pour une image ou une forme) */
  size: number;
  input: InputKind;
  /** Absent = stylo (anciens traits) */
  tool?: StrokeTool;
  /**
   * tool === 'image' seulement : image PNG (fond transparent) posée sur le rectangle défini par
   * points[0] (coin haut-gauche) et points[1] (coin bas-droit), en mm. Sert à glisser une formule
   * convertie sur la page (voir src/export/insertImage.ts).
   */
  image?: string;
  /**
   * tool === 'text' seulement : le texte tapé au clavier, mis en page dans la boîte points[0]–points[1]
   * (retour à la ligne automatique, voir textLayout.ts) ; `size` est alors la taille du texte en mm.
   */
  text?: string;
  /** tool === 'text' seulement : « mine » = écrit avec « Mon écriture » (caractères enregistrés) ; absent = police */
  font?: 'mine';
  /** tool === 'shape' seulement : quelle forme dessiner (voir ShapeKind). */
  shape?: ShapeKind;
  /** Trait en pointillés (arêtes cachées, lignes de projection) : trait au stylo et formes. */
  dashed?: boolean;
  /**
   * Rotation en radians (sens des aiguilles d'une montre à l'écran) autour du centre du rectangle
   * points[0]–points[1] : formes à deux coins (cercle, rectangle, volumes…) et images. Absent = 0. Les
   * traits à main levée, les lignes et les flèches, eux, tournent en réécrivant leurs points.
   */
  angle?: number;
}

export type Tool = 'pen' | 'highlighter' | 'eraser' | 'lasso' | 'hand' | 'shapes' | 'capture' | 'text';

export type PaperStyle = 'grid' | 'seyes' | 'lined' | 'blank';

/** Clair (papier blanc, encre sombre) ou sombre (papier noir, encre pensée pour ressortir dessus). */
export type PaperColor = 'light' | 'dark';

/**
 * auto       : comme « capacitive » tant qu'aucun stylet actif (S Pen) n'a été vu
 * active     : seul un stylet actif écrit, les doigts déplacent la page
 * capacitive : stylet vu comme un doigt → anti-paume logiciel
 * finger     : écriture au doigt, sans anti-paume
 */
export type StylusMode = 'auto' | 'active' | 'capacitive' | 'finger';

export type Handedness = 'right' | 'left';

/** scale = pixels CSS par mm ; tx, ty = position de la page dans la zone (px CSS) */
export interface View {
  scale: number;
  tx: number;
  ty: number;
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function newId(): string {
  // crypto.randomUUID n'existe pas en http:// sur le réseau local
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
