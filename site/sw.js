const APP_CACHE_VERSION = 'ff14recipe-app-20260728-v2.96';
const DATA_CACHE_VERSION = 'ff14recipe-data-7.50-6e392bcc';
const CACHE_PREFIX = 'ff14recipe-';

const PRECACHE_FILES = [
  './index.html',
  './styles.css',
  './calculation.js',
  './app.js',
  './docs/license-notice.md',
  './docs/privacy-policy.md',
  './assets/app-icons/favicon.png',
  './assets/app-icons/icon-192.png',
  './assets/app-icons/icon-512.png',
  './assets/job-icons/alchemist.webp',
  './assets/job-icons/armorer.webp',
  './assets/job-icons/blacksmith.webp',
  './assets/job-icons/botanist.webp',
  './assets/job-icons/carpenter.webp',
  './assets/job-icons/culinarian.webp',
  './assets/job-icons/fisher.webp',
  './assets/job-icons/goldsmith.webp',
  './assets/job-icons/leatherworker.webp',
  './assets/job-icons/miner.webp',
  './assets/job-icons/weaver.webp',
  './manifest.webmanifest',
];

const CACHE_FIRST_PATTERNS = [
  /\/data\/Item\.json$/,
  /\/assets\/item-icons\//,
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_CACHE_VERSION).then(cache => cache.addAll(PRECACHE_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key.startsWith(CACHE_PREFIX) && ![APP_CACHE_VERSION, DATA_CACHE_VERSION].includes(key))
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // 緊急メッセージを常に最新にするため、tips.mdは一切キャッシュしない
  if (/\/data\/tips\.md$/.test(url.pathname)) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (CACHE_FIRST_PATTERNS.some(pattern => pattern.test(url.pathname))) {
    event.respondWith(cacheFirst(request, DATA_CACHE_VERSION));
    return;
  }

  event.respondWith(networkFirst(request, APP_CACHE_VERSION));
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Network error', { status: 503 });
  }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached || new Response('Offline', { status: 503 });
  }
}

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(APP_CACHE_VERSION);
      await cache.put('./index.html', response.clone());
    }
    return response;
  } catch {
    return (await caches.match(request))
      || (await caches.match('./index.html'))
      || new Response('Offline', { status: 503 });
  }
}
