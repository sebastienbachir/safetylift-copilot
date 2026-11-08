// Service worker : coquille de l'appli en cache (hors ligne), API toujours en réseau.
const CACHE = 'safetylift-v2.1.1';
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
  // Réseau d'abord (toujours la dernière version), cache en secours hors ligne
  e.respondWith(fetch(req).then(r => {
    if (r.ok) { const cl = r.clone(); caches.open(CACHE).then(c => c.put(req, cl)); }
    return r;
  }).catch(() => caches.match(req).then(c => c || (req.mode === 'navigate' ? caches.match('/index.html') : Response.error()))));
});

/* ---------- Notifications push ---------- */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'SafetyLift', {
    body: d.body || '', tag: d.tag || 'safetylift', renotify: true,
    icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url: d.url || '/' },
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.startsWith(self.location.origin)) { c.navigate(url).catch(() => {}); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
