// Red primero, caché como respaldo: así siempre recibes la versión nueva
// pero la app abre aunque no haya internet (el enlace celular-proyector sí lo necesita).
const CACHE = 'proyectalo-v1';
const ASSETS = ['./', 'index.html', 'css/style.css', 'js/app.js', 'js/renderer.js', 'js/store.js', 'js/link.js',
  'vendor/peerjs.min.js', 'vendor/qrcode.js', 'manifest.webmanifest', 'icons/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
