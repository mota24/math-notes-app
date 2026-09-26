import assert from 'node:assert/strict';
import { lruGet, lruSet } from '../src/lru.ts';

const map = new Map<string, number>();
const evicted: string[] = [];
lruSet(map, 'a', 1, 3);
lruSet(map, 'b', 2, 3);
lruSet(map, 'c', 3, 3);
assert.equal(lruGet(map, 'a'), 1, 'lire « a » le rend récent');
lruSet(map, 'd', 4, 3, (_v, k) => evicted.push(k));
assert.deepEqual([...map.keys()], ['c', 'a', 'd'], 'le moins récemment utilisé (b) est parti');
assert.deepEqual(evicted, ['b'], 'prévenu du départ (pour libérer une adresse blob:, par exemple)');
assert.equal(lruGet(map, 'b'), undefined);
lruSet(map, 'c', 30, 3);
assert.deepEqual([...map.entries()], [['a', 1], ['d', 4], ['c', 30]], 'réécrire une clé la remet en tête sans doublon');
console.log('Caches bornés : tout passe');
