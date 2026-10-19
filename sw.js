// sw.js — Hace la tienda instalable y abre aunque falle la conexión.
// Páginas y datos: primero la red (siempre lo último publicado); la copia guardada solo si no hay red.
// Estilos, scripts e imágenes propios: copia guardada y se refresca por detrás (llevan ?v=<fecha>).
// Nunca guarda Supabase, n8n ni nada de otro dominio.
const CACHE = 'dc-tienda-v2'; // cambiar el número borra lo guardado en los celulares
const BASICOS = ['/', '/index.html', '/img/logo-dc-192.png'];

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASICOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
    e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
        .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;
    const esDato = req.mode === 'navigate' || /\.(html|json)$/.test(url.pathname) || url.pathname.endsWith('/');
    if (esDato) {
        e.respondWith(fetch(req).then((r) => {
            if (r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(req, copia)); }
            return r;
        }).catch(() => caches.match(req).then((r) => r || (req.mode === 'navigate' ? caches.match('/') : Response.error()))));
        return;
    }
    if (/\.(css|js|png|jpg|jpeg|webp|svg|woff2?)$/.test(url.pathname)) {
        e.respondWith(caches.open(CACHE).then(async (c) => {
            const guardada = await c.match(req);
            const red = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => guardada);
            return guardada || red;
        }));
    }
});
