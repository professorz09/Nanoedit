// Minimal service worker — exists purely to satisfy the "installable PWA"
// criteria (Add to Home Screen / desktop install prompt). It deliberately
// does NOT cache the app shell or JS/CSS bundles: this is a fast-moving app
// (new Vite-hashed chunks + edge functions on every deploy) and a caching SW
// risks serving a stale bundle against a changed API contract after a
// release — a classic PWA footgun.
//
// NO fetch handler: an earlier version added one that called
// event.respondWith(fetch(event.request)) to "pass everything through" —
// but that re-issues EVERY request (including every <img> load) through the
// SW's own fetch() call with zero error handling. A list of images mounting/
// unmounting while scrolling aborts fetches constantly under normal browser
// behavior (harmless, silently ignored with no SW); routed through
// respondWith() instead, that same abort/any transient hiccup rejects the
// promise, which the browser then treats as a hard network error for that
// request — images (generated results, saved personas, layers) intermittently
// failing to load site-wide. Modern Chrome/Safari don't require a fetch
// handler for install eligibility, so the safe fix is to not add one at all:
// with none registered, every request is handled exactly as if there were no
// service worker present.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
