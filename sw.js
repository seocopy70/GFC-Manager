const CACHE_NAME = 'gfc-manager-v2';
const BASE_URL = new URL('./', self.registration.scope);
const BASE = BASE_URL.pathname;
const APP_SHELL = [
  BASE,
  new URL('index.html', BASE_URL).href,
  new URL('app.js', BASE_URL).href,
  new URL('config.js', BASE_URL).href,
  new URL('manifest.webmanifest', BASE_URL).href,
  new URL('icons/icon-192.svg', BASE_URL).href,
  new URL('icons/icon-512.svg', BASE_URL).href
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // API responses (including authentication and personal data) are never cached.
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // App navigation: network first, then cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(new URL('index.html', BASE_URL).href).then((response) => response || caches.match(BASE_URL.href)))
    );
    return;
  }

  // Static same-origin assets: cache first, then network.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
