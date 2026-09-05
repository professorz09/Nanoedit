// Kill switch: retires the service worker registered by an earlier PWA
// install feature. That feature's fetch handler
// (event.respondWith(fetch(event.request))) turned ordinary aborted image
// fetches — routine when a gallery of images mounts/unmounts while scrolling
// — into hard network errors, breaking generated thumbnails, saved personas,
// and layer photos across the app. The PWA feature has been removed
// (index.html no longer links a manifest or registers a worker), but a
// browser that already installed the old sw.js keeps running it until
// something replaces it — this file's job is exactly that: install
// immediately, unregister itself, and let every open tab reload so it's
// gone for good.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await self.registration.unregister();
      const clientsList = await self.clients.matchAll({ type: 'window' });
      for (const client of clientsList) {
        client.navigate(client.url);
      }
    })()
  );
});
