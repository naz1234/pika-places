const CACHE = 'pika-shell-v3-family-theme';
const SHELL = ['/', '/index.html', '/styles.css', '/js/app.js', '/js/model.js', '/js/store.js', '/js/sync.js', '/assets/pika-places-favicon-32.png', '/assets/pika-places-apple-touch-180.png', '/assets/pika-places-192.png', '/assets/pika-places-512.png', '/manifest.webmanifest'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))); });
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('pika-shell-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Never cache API responses or claim a network write succeeded offline.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(response => {
      if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put('/index.html', copy))); }
      return response;
    }).catch(() => caches.match('/index.html')));
    return;
  }
  if (!SHELL.includes(url.pathname)) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy))); }
    return response;
  }).catch(() => caches.match(event.request)));
});
