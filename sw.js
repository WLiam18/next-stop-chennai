const CACHE = 'next-stop-chennai-3';
const SHELL = ['./', './index.html', './style.css?v=3', './app.mjs?v=3', './tracking.mjs?v=3', './route-map.mjs?v=3', './network.json', './map-network.json',
  './fonts/barlow-condensed-bold.woff2', './mark.svg?v=3', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('next-stop-chennai-') && key !== CACHE).map(key => caches.delete(key)))));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('./index.html')));
    return;
  }
  event.respondWith(caches.open(CACHE).then(async cache => {
    const hit = await cache.match(event.request);
    if (hit) return hit;
    const response = await fetch(event.request);
    if (response.ok && url.pathname.includes('/geometry-')) await cache.put(event.request, response.clone());
    return response;
  }));
});
