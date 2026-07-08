/* BabyBloom 서비스워커 — 오프라인 캐시 (앱 셸 cache-first + 백그라운드 갱신) */
const VERSION = 'babybloom-v4';
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/config.js',
  './js/data.js',
  './js/app.js',
  './js/sync.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 같은 출처: stale-while-revalidate (캐시 먼저, 뒤에서 갱신) / 외부(CDN 폰트 등): network→cache 폴백
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const sameOrigin = new URL(e.request.url).origin === self.location.origin;
  e.respondWith(
    caches.open(VERSION).then(async cache => {
      const cached = await cache.match(e.request);
      const fetched = fetch(e.request).then(res => {
        if (res && res.status === 200 && (sameOrigin || res.type === 'basic' || res.type === 'cors')) {
          cache.put(e.request, res.clone());
        }
        return res;
      }).catch(() => cached);
      return sameOrigin && cached ? cached : (fetched || cached);
    })
  );
});
