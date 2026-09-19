/** Fusion « la version la plus récente gagne », entité par entité. Sans dépendance : testable avec Node. */

export interface VersionedLike {
  updatedAt: number;
  deletedAt: number | null;
}

export interface StoneLike {
  deletedAt: number;
}

export interface MergePlan<V> {
  /** État fusionné à écrire dans l'index distant */
  merged: Record<string, V>;
  /** À télécharger (version distante plus récente ou absente en local) */
  pull: string[];
  /** À envoyer (version locale plus récente ou absente à distance) */
  push: string[];
  /** Supprimées définitivement sur un appareil : à effacer en local */
  purge: string[];
}

export function mergeRecords<V extends VersionedLike>(
  local: Record<string, V>,
  remote: Record<string, V>,
  tombstones: Record<string, StoneLike>,
  stoneKey: (id: string) => string = (id) => id,
): MergePlan<V> {
  const plan: MergePlan<V> = { merged: {}, pull: [], push: [], purge: [] };
  const ids = new Set([...Object.keys(local), ...Object.keys(remote)]);
  for (const id of ids) {
    const l = local[id];
    const r = remote[id];
    if (tombstones[stoneKey(id)]) {
      if (l) plan.purge.push(id);
      continue;
    }
    if (!r || (l && l.updatedAt > r.updatedAt)) {
      plan.merged[id] = l;
      plan.push.push(id);
    } else if (!l || r.updatedAt > l.updatedAt) {
      plan.merged[id] = r;
      plan.pull.push(id);
    } else {
      plan.merged[id] = l;
    }
  }
  return plan;
}

export function byKey<T>(items: T[], key: (item: T) => string): Record<string, T> {
  return Object.fromEntries(items.map((item) => [key(item), item]));
}

/** Union des suppressions définitives ; on oublie celles de plus de 90 jours. */
export function mergeTombstones<S extends StoneLike>(a: Record<string, S>, b: Record<string, S>, now: number): Record<string, S> {
  const out: Record<string, S> = {};
  const limit = now - 90 * 24 * 3600 * 1000;
  for (const [id, stone] of [...Object.entries(a), ...Object.entries(b)]) {
    if (stone.deletedAt < limit) continue;
    if (!out[id] || stone.deletedAt > out[id].deletedAt) out[id] = stone;
  }
  return out;
}
