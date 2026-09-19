import type { InkStats } from './InkCanvas';

/**
 * Le canevas ouvert y publie ses statistiques en direct ; les Réglages les lisent pour le
 * diagnostic anti-paume (calibrage, contacts, journal), qui n'a plus de panneau flottant à lui.
 */
export const liveStats: { current: InkStats | null } = { current: null };
