const CACHE_NAME = 'contractor-attendance-v4';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/geo.js?v=4',
  './js/sites.js?v=4',
  './js/supabase.js?v=1',
  './js/api.js?v=4',
  './js/app.js?v=4',
  './js/xlsx.full.min.js',
  './manifest.json',
  './assets/icon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS).catch(err => console.warn('PWA caching warning:', err));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((k) => {
          if (k !== CACHE_NAME) return caches.delete(k);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Only handle GET requests (Cache API does not support POST/PUT/DELETE)
  if (e.request.method !== 'GET') {
    return;
  }

  // Network only for external APIs & telemetry endpoints
  if (
    e.request.url.includes('api.ipify.org') ||
    e.request.url.includes('ipapi.co') ||
    e.request.url.includes('script.google.com') ||
    e.request.url.includes('supabase.co')
  ) {
    return;
  }

  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

