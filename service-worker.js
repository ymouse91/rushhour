const CACHE = 'rushhour3-v4';
const ASSETS = [
  './',
  './index.html',
  './rushx.txt',
  './manifest.webmanifest'
  // lisää myös ikonisi kun lisäät ne:
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (e)=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});
self.addEventListener('activate', (e)=>{
  e.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', (e)=>{
  const req = e.request;
  e.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(resp=>{
      const copy = resp.clone();
      caches.open(CACHE).then(c=>c.put(req, copy));
      return resp;
    }).catch(()=>cached))
  );
});
