// Service worker: houdt de app offline beschikbaar. Verhoog VERSION bij elke release.
const VERSION = 'vakwerk-v26';
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/db.js', './js/util.js', './js/views.js', './js/editor.js', './js/ink.js',
  './js/markdown.js', './js/srs.js', './js/pack.js', './js/planner.js', './js/inbox.js', './js/pdf.js', './js/keyterms.js', './js/planmove.js', './js/plansets.js',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', e => {
  // Nieuwe versie direct actief maken; de app herlaadt zichzelf dan (zie app.js)
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/inbox/')) return; // inbox altijd vers van het net
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('./index.html').then(r => r || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req)));
});
