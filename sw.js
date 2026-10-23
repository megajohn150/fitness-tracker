// Offline shell. The app itself keeps its data in localStorage and syncs through
// an outbox, so all the worker has to do is make sure the files load with no network.
const VERSION = 'gym-v2';
const SHELL = [
  './', './index.html', './css/app.css', './manifest.webmanifest',
  './js/app.js', './js/db.js', './js/calc.js', './js/config.js',
  './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.hostname.endsWith('supabase.co')) return;   // never cache the API or auth

  // Serve from cache immediately, refresh in the background for the next launch.
  event.respondWith(
    caches.open(VERSION).then(async cache => {
      const hit = await cache.match(request, { ignoreSearch: url.origin === self.location.origin });
      const fetching = fetch(request)
        .then(response => {
          if (response.ok && (url.origin === self.location.origin || request.mode !== 'navigate')) {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => hit);
      return hit || fetching;
    })
  );
});
