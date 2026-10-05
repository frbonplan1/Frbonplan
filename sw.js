/* Frbonplan — Service Worker
   Stratégie :
   - navigation (index.html)  : réseau d'abord, cache en secours (= page lisible hors-ligne)
   - images / css / js locaux : cache d'abord, rafraîchi en arrière-plan
   - tout le reste (CDN, Shopify, Google) : jamais mis en cache
   Pour publier une nouvelle version : incrémentez CACHE_VERSION. */

const CACHE_VERSION = 'v20';
const CACHE_NAME = 'frbonplan-' + CACHE_VERSION;

const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './unnamed.png',
  './produit-ecouteurs.jpg',
  './produit-polo.png',
  './produit-sneakers.png',
  './produit-tshirt.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.allSettled(PRECACHE.map((url) => cache.add(url))))
      .catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (e) {}
    }
    await self.clients.claim();
  })());
});

// Permet au bandeau « Mettre à jour » d'activer immédiatement la nouvelle version
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // Pages : réseau d'abord pour toujours avoir le contenu à jour
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const preload = await event.preloadResponse;
        if (preload) {
          const cache = await caches.open(CACHE_NAME);
          cache.put('./index.html', preload.clone()).catch(() => {});
          return preload;
        }
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put('./index.html', fresh.clone()).catch(() => {});
        return fresh;
      } catch (e) {
        const cached = await caches.match('./index.html');
        return cached || new Response(
          '<!doctype html><meta charset="utf-8"><title>Hors connexion</title>' +
          '<body style="background:#0b0f14;color:#f5f3ee;font-family:system-ui;text-align:center;padding:60px 24px">' +
          '<h1 style="font-size:1.2rem">Pas de connexion</h1>' +
          '<p style="color:#a8b0bc;font-size:.9rem">Reconnectez-vous puis rouvrez Frbonplan.</p></body>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    })());
    return;
  }

  // Produits Hacoo (products.json) : réseau d'abord, pour que les publications
  // faites depuis l'admin apparaissent tout de suite sans attendre un vieux cache.
  if (sameOrigin && url.pathname.endsWith('/products.json')) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone()).catch(() => {});
        return fresh;
      } catch (e) {
        const cached = await caches.match(req);
        return cached || new Response('{"products":[]}', { headers: { 'Content-Type': 'application/json' } });
      }
    })());
    return;
  }

  // Ressources du site : cache d'abord, mise à jour silencieuse ensuite
  if (sameOrigin) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      const network = fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          caches.open(CACHE_NAME).then((c) => c.put(req, res.clone())).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })());
  }
  // Domaines externes : on laisse passer sans jamais mettre en cache
});
