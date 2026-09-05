// Minimal service worker — exists purely to satisfy the "installable PWA"
// criteria (Add to Home Screen / desktop install prompt). It deliberately
// does NOT cache the app shell or JS/CSS bundles: this is a fast-moving app
// (new Vite-hashed chunks + edge functions on every deploy) and a caching SW
// risks serving a stale bundle against a changed API contract after a
// release — a classic PWA footgun. Every request just passes straight
// through to the network.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
