/* Notes Maths : fonctionnement hors-ligne.
 * - Page (index.html) : réseau d'abord pour récupérer la dernière version, sinon la copie en cache.
 * - Fichiers de l'appli : tous mis en cache à l'installation (liste precache.json générée au build).
 * - Requêtes vers d'autres sites (Gemini, Google Drive) : jamais mises en cache. */

const CACHE = 'notes-maths';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];

async function precacheList() {
  const response = await fetch('./precache.json', { cache: 'no-store' });
  const { files } = await response.json();
  return [...SHELL, './precache.json', ...files.map((f) => `./${f}`)];
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        await cache.addAll(await precacheList());
      } catch {
        await cache.addAll(SHELL);
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Retire les fichiers d'anciennes versions
      try {
        const keep = new Set((await precacheList()).map((u) => new URL(u, self.location.href).href));
        const cache = await caches.open(CACHE);
        for (const request of await cache.keys()) if (!keep.has(request.url)) await cache.delete(request);
      } catch {
        /* hors-ligne : on garde tout */
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Pages de connexion Firebase relayées par vercel.json (/__/auth/*) : jamais en cache, et surtout jamais
  // enregistrées comme copie hors-ligne de l'appli.
  if (url.pathname.startsWith('/__/')) return;
  // Fonctions serveur (sauvegarde Drive, retour de l'autorisation Google) : toujours le réseau, jamais le
  // cache — et surtout pas la copie de l'appli à la place d'une redirection
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          // Seule une vraie page (200) remplace la copie hors-ligne : une erreur passagère du serveur
          // (500, 404 pendant un déploiement…) ne doit jamais devenir la page servie hors-ligne.
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put('./index.html', copy));
            return response;
          }
          return (await caches.match('./index.html')) ?? response;
        })
        .catch(async () => (await caches.match('./index.html')) ?? Response.error()),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
