import type { ReactNode } from 'react';
import type { ShapeKind } from '../ink/types';
import { icon } from './icons';

/** Le catalogue du sous-menu « Formes & tampons » : gabarits d'ingénierie posés d'un tap ou d'un glissé. */

export type StampGroup = { title: string; items: { kind: ShapeKind; label: string; hint?: string; icon: ReactNode }[] };

const DASHED = { strokeDasharray: '2 2' };

/** Les tampons du sous-menu « Formes & tampons » : gabarits d'ingénierie posés d'un tap ou d'un glissé. */
export const STAMP_GROUPS: StampGroup[] = [
  {
    title: 'Formes',
    items: [
      { kind: 'circle', label: 'Cercle', icon: icon(<circle cx="12" cy="12" r="8" />) },
      { kind: 'rect', label: 'Rectangle', icon: icon(<rect x="4" y="6" width="16" height="12" rx="1" />) },
      { kind: 'triangle', label: 'Triangle', icon: icon(<path d="M12 4L20 20H4Z" />) },
      { kind: 'arrow', label: 'Flèche', icon: icon(<path d="M4 18L18 6M11 6h7v7" />) },
      {
        kind: 'line',
        label: 'Ligne',
        hint: 'Ligne droite',
        icon: icon(
          <>
            <path d="M5 19L19 5" />
            <circle cx="5" cy="19" r="1.6" fill="currentColor" />
            <circle cx="19" cy="5" r="1.6" fill="currentColor" />
          </>,
        ),
      },
    ],
  },
  {
    title: 'Mécanique',
    items: [
      {
        kind: 'axes2d',
        label: 'Repère 2D',
        icon: icon(<path d="M5 20.5V4M5 20.5H21M3.3 8L5 4l1.7 4M17 18.8L21 20.5l-1.7-3.7" />),
      },
      {
        kind: 'axes3d',
        label: 'Repère 3D',
        icon: icon(<path d="M12 21V6M12 21H22M12 21L4 15M10.3 8L12 4l1.7 4M18 17.5L22 21l-4.5-1M4.3 12L4 15l3.5 1" />),
      },
      {
        kind: 'torseur',
        label: 'Torseur',
        icon: icon(
          <text x="11" y="18" textAnchor="middle" fontSize="19" fontFamily="Georgia, 'Times New Roman', serif" stroke="none" fill="currentColor">
            {'{'}
          </text>,
        ),
      },
      {
        kind: 'matrix',
        label: 'Matrice',
        icon: icon(
          <text x="12" y="18" textAnchor="middle" fontSize="16" fontFamily="Georgia, 'Times New Roman', serif" stroke="none" fill="currentColor">
            {'( )'}
          </text>,
        ),
      },
    ],
  },
  {
    title: 'Volumes 3D (arêtes cachées en tirets)',
    items: [
      {
        kind: 'cylinder',
        label: 'Cylindre',
        icon: icon(
          <>
            <ellipse cx="12" cy="6" rx="7" ry="2.2" />
            <path d="M5 6v12M19 6v12M5 18c0 1.2 3.1 2.2 7 2.2s7-1 7-2.2" />
            <path d="M5 18c0-1.2 3.1-2.2 7-2.2s7 1 7 2.2" {...DASHED} />
          </>,
        ),
      },
      {
        kind: 'cone',
        label: 'Cône',
        icon: icon(
          <>
            <path d="M12 3L5 17M12 3l7 14M5 17c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6" />
            <path d="M5 17c0-1.4 3.1-2.6 7-2.6s7 1.2 7 2.6" {...DASHED} />
          </>,
        ),
      },
      {
        kind: 'sphere',
        label: 'Sphère',
        icon: icon(
          <>
            <circle cx="12" cy="12" r="8" />
            <path d="M4 12c0 2 3.6 3.6 8 3.6s8-1.6 8-3.6" />
            <path d="M4 12c0-2 3.6-3.6 8-3.6s8 1.6 8 3.6" {...DASHED} />
          </>,
        ),
      },
      {
        kind: 'hemisphere',
        label: 'Demi-sphère',
        icon: icon(
          <>
            <path d="M4 15a8 8 0 0116 0M4 15c0 2 3.6 3.6 8 3.6s8-1.6 8-3.6" />
            <path d="M4 15c0-2 3.6-3.6 8-3.6s8 1.6 8 3.6" {...DASHED} />
          </>,
        ),
      },
      {
        kind: 'pyramid',
        label: 'Pyramide',
        icon: icon(
          <>
            <path d="M4 19h11l5-4M12 4L4 19M12 4l3 15M12 4l8 11" />
            <path d="M4 19l5-4h11M12 4L9 15" {...DASHED} />
          </>,
        ),
      },
      {
        kind: 'cuboid',
        label: 'Pavé droit',
        hint: 'Parallélépipède rectangle',
        icon: icon(
          <>
            <path d="M3 9h12v11H3zM3 9l5-5h12M15 9l5-5M15 20l5-5V4" />
            <path d="M3 20l5-5h12M8 15V4" {...DASHED} />
          </>,
        ),
      },
      {
        kind: 'torus',
        label: 'Tore',
        icon: icon(
          <>
            <ellipse cx="12" cy="12" rx="9" ry="6.4" />
            <ellipse cx="12" cy="11.2" rx="3.5" ry="1.8" />
            <path d="M3.4 13.4c1.4 1.6 4.6 2.6 8.6 2.6s7.2-1 8.6-2.6" />
            <path d="M3.4 13.4c1.4-1.6 4.6-2.6 8.6-2.6s7.2 1 8.6 2.6" {...DASHED} />
          </>,
        ),
      },
      {
        kind: 'prism',
        label: 'Prisme',
        hint: 'Prisme triangulaire',
        icon: icon(
          <>
            <path d="M3 19h12L9 7zM15 19l5-3-6-12-5 3" />
            <path d="M3 19l5-3h12M8 16l6-12" {...DASHED} />
          </>,
        ),
      },
      {
        kind: 'tetrahedron',
        label: 'Tétraèdre',
        icon: icon(
          <>
            <path d="M3 19h12l6-5L11 4zM11 4l4 15" />
            <path d="M3 19l18-5" {...DASHED} />
          </>,
        ),
      },
      {
        kind: 'ellipsoid',
        label: 'Ellipsoïde',
        icon: icon(
          <>
            <ellipse cx="12" cy="12" rx="9" ry="6.4" />
            <path d="M3 12.6c0 1.8 4 3.2 9 3.2s9-1.4 9-3.2" />
            <path d="M3 12.6c0-1.8 4-3.2 9-3.2s9 1.4 9 3.2" {...DASHED} />
          </>,
        ),
      },
    ],
  },
];
export const ALL_STAMPS = STAMP_GROUPS.flatMap((g) => g.items);
