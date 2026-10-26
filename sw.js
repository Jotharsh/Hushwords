// Offline support for the app's own files. Rooms need the internet; this makes the app open instantly and survive a bad signal.
// Change VERSION whenever any file changes, so phones fetch the new files and drop the old cache.
const VERSION = 'v2';
const CACHE = `hushwords-${VERSION}`;
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'vendor/peerjs.min.js',
  'js/app.js', 'js/config.js', 'js/ui.js', 'js/install.js', 'js/store.js', 'js/game.js', 'js/words.js', 'js/net.js', 'js/sync.js', 'js/sound.js', 'js/confetti.js',
  'js/views/home.js', 'js/views/room.js', 'js/views/more.js',
  'fonts/Bricolage-Variable.woff2', 'fonts/SpaceMono-400.woff2', 'fonts/SpaceMono-700.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png',
];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('hushwords-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    try { const r = await fetch(request); if (r.ok) (await caches.open(CACHE)).put(request, r.clone()); return r; }
    catch { if (request.mode === 'navigate') return (await caches.match('index.html')) ?? Response.error(); return Response.error(); }
  })());
});
