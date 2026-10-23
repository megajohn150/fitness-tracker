// Offline shell. The app keeps its data in localStorage and syncs through an
// outbox, so all the worker does is make sure the files load with no network.
//
// Safari refuses to serve a redirected response for a navigation, and Pages
// redirects /index.html to /, so every cached response is rebuilt without its
// redirect history before it is stored.
const VERSION = 'gym-v4';
const ROOT = './';
const SHELL = [
  ROOT, './css/app.css', './manifest.webmanifest',
  './js/app.js', './js/db.js', './js/calc.js', './js/config.js',
  './icons/icon-192.png', './icons/icon-512.png'
];

async function plain(response) {
  if (!response || !response.redirected) return response;
  const body = await response.blob();
  return new Response(body, {
    status: response.status, statusText: response.statusText, headers: response.headers
  });
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await Promise.all(SHELL.map(async path => {
      try {
        const response = await fetch(new Request(path, { cache: 'reload' }));
        if (response.ok) await cache.put(path, await plain(response));
      } catch { /* a missing file must not block the install */ }
    }));
    await self.skipWaiting();
  })());
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

  // Pages are fetched fresh when possible; the cached shell is the fallback.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try {
        const response = await plain(await fetch(request));
        if (response.ok) cache.put(ROOT, response.clone());
        return response;
      } catch {
        return (await cache.match(ROOT)) ?? Response.error();
      }
    })());
    return;
  }

  // Our own code must match the page that asked for it, so it is fetched fresh
  // when there is a network and only falls back to the cache offline. Serving a
  // stale script next to a new page is how you get a half-working app.
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try {
        const response = await plain(await fetch(request));
        if (response.ok) cache.put(request, response.clone());
        return response;
      } catch {
        return (await cache.match(request, { ignoreSearch: true })) ?? Response.error();
      }
    })());
    return;
  }

  // Third-party files (fonts, the Supabase client) never change under the same
  // URL, so cache them hard and refresh in the background.
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(request);
    const fetching = fetch(request)
      .then(async response => {
        if (response.ok) cache.put(request, (await plain(response.clone())));
        return response;
      })
      .catch(() => hit);
    return hit || fetching;
  })());
});
