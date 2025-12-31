
const CACHE_NAME = 'traffic-os-v1.2';
const UI_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  'https://cdn.tailwindcss.com',
  'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@300;400;500;600;700;800&display=swap',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet.markercluster@1.4.1/dist/leaflet.markercluster.js',
  'https://unpkg.com/leaflet.markercluster@1.4.1/dist/MarkerCluster.css',
  'https://unpkg.com/leaflet.markercluster@1.4.1/dist/MarkerCluster.Default.css',
  'https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js'
];

// ESM dependencies from importmap (cached via fetch listener, but we can pre-cache main ones)
const ESM_ASSETS = [
  'https://esm.sh/@google/genai@^1.34.0',
  'https://esm.sh/react@^19.2.3',
  'https://esm.sh/react-dom@^19.2.3',
  'https://esm.sh/leaflet@1.9.4'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Matrix Uplink: Pre-caching UI assets and ESM dependencies');
      return cache.addAll([...UI_ASSETS, ...ESM_ASSETS]);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Matrix Uplink: Clearing legacy cache', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Strategy for Traffic Camera Images: Network First, then Cache
  // This ensures we see the latest traffic data when online, but have last-seen when offline.
  if (event.request.destination === 'image' && url.hostname.includes('trafficnz.info')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clonedResponse = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clonedResponse);
          });
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Strategy for XML data and Proxies: Network Only
  // We don't want to cache stale XML traffic data as it's time-sensitive.
  if (url.pathname.includes('/service/traffic/rest/') || url.hostname.includes('corsproxy') || url.hostname.includes('allorigins')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Strategy for UI Assets & ESM Modules: Stale-While-Revalidate
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        // Only cache successful GET responses
        if (networkResponse && networkResponse.status === 200 && event.request.method === 'GET') {
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, networkResponse.clone());
          });
        }
        return networkResponse;
      }).catch(() => {
        // Silently fail fetch if offline; cachedResponse will be returned
      });

      return cachedResponse || fetchPromise;
    })
  );
});
