/**
 * cstrsk.de Workspace PWA Service Worker
 * Lizenziert unter GNU AGPLv3 (https://cstrsk.de)
 * Caches application shell and enables offline viewing of own bookings.
 */

const CACHE_NAME = 'cstrsk-workspace-v2';
const API_CACHE_NAME = 'cstrsk-api-offline-v1';

const STATIC_ASSETS = [
  './',
  './index.html',
  './app.js',
  './demo-api.js',
  './manifest.json',
  './logo.svg',
  './icon.svg',
  './apple-touch-icon.png',
  './pwa-192x192.png',
  './pwa-512x512.png',
  'https://cdn.jsdelivr.net/npm/mithril@2.2.2/mithril.min.js',
  'https://cdn.jsdelivr.net/npm/mithril@2.2.2/stream/stream.min.js',
  'https://cdn.tailwindcss.com'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key !== API_CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API Requests: Network First, fallback to cache for offline booking views
  if (url.pathname.includes('/api/')) {
    // Only cache GET requests (like my bookings, resources)
    if (event.request.method === 'GET') {
      event.respondWith(
        fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const responseClone = networkResponse.clone();
              caches.open(API_CACHE_NAME).then((cache) => {
                cache.put(event.request, responseClone);
              });
            }
            return networkResponse;
          })
          .catch(async () => {
            // Offline fallback
            const cachedResponse = await caches.match(event.request);
            if (cachedResponse) {
              return cachedResponse;
            }
            return new Response(
              JSON.stringify({
                offline: true,
                error: 'Offline-Modus aktiv. Daten konnten nicht vom Server geladen werden.',
                bookings: []
              }),
              { headers: { 'Content-Type': 'application/json' }, status: 200 }
            );
          })
      );
      return;
    }
    // Non-GET requests pass through
    return;
  }

  // Static Assets: Cache First, fallback to Network
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        if (
          networkResponse &&
          networkResponse.status === 200 &&
          event.request.method === 'GET' &&
          !url.protocol.startsWith('chrome-extension')
        ) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      });
    })
  );
});
