// Service worker : coquille de l'appli en cache (hors ligne), API toujours en réseau.
const CACHE = 'safetylift-v2.0.0';
const SHELL = ['/', '/index.html', '/app.css', '/app.js', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) return; // données : réseau uniquement
  // Polices Google : cache au premier passage
  if (/fonts\.(googleapis|gstatic)\.com/.test(url.host)) {
    e.respondWith(caches.match(req).then(c => c || fetch(req).then(r => { const cl = r.clone(); caches.open(CACHE).then(ca => ca.put(req, cl)); return r; })));
    return;
  }
  if (url.origin !== location.origin) return;
  // Navigation : réseau d'abord, coquille en secours
  if (req.mode === 'navigate') { e.respondWith(fetch(req).catch(() => caches.match('/index.html'))); return; }
  // Fichiers statiques : cache, mis à jour en arrière-plan
  e.respondWith(caches.match(req).then(cached => {
    const net = fetch(req).then(r => { if (r.ok) { const cl = r.clone(); caches.open(CACHE).then(c => c.put(req, cl)); } return r; }).catch(() => cached);
    return cached || net;
  }));
});
