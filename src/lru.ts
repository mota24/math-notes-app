/**
 * Caches de module bornés (« le moins récemment utilisé s'en va ») : texte lu des pages, couvertures, pages d'un
 * cahier partagé. Sans borne, parcourir un PDF de 300 pages gardait tout en mémoire jusqu'à la fermeture de
 * l'onglet. Une Map garde l'ordre d'insertion : relire une entrée la remet en dernier. Testé sous Node.
 */

/** La valeur de `key`, remise en tête (la plus récemment utilisée) ; undefined si absente */
export function lruGet<K, V>(map: Map<K, V>, key: K): V | undefined {
  if (!map.has(key)) return undefined;
  const value = map.get(key) as V;
  map.delete(key);
  map.set(key, value);
  return value;
}

/** Range `value` en tête, puis retire les plus anciennes au-delà de `max` (`evicted` est prévenu pour chacune) */
export function lruSet<K, V>(map: Map<K, V>, key: K, value: V, max: number, evicted?: (value: V, key: K) => void): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) {
    const oldest = map.keys().next().value as K;
    const old = map.get(oldest) as V;
    map.delete(oldest);
    evicted?.(old, oldest);
  }
}
