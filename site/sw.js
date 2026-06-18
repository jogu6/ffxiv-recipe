// データを更新したときは、このバージョンを手動で上げる
const CACHE_VERSION = 'ff14recipe-v2.1';
const CACHE_PREFIX = 'ff14recipe-';

const PRECACHE_FILES = [
  './index.html',
  './styles.css',
  './app.js',
  './docs/license-notice.md',
  './docs/privacy-policy.md',
  './assets/app-icons/favicon.png',
  './assets/app-icons/icon-192.png',
  './assets/app-icons/icon-512.png',
  './manifest.webmanifest',
];

const CACHE_FIRST_PATTERNS = [
  /\/data\/Item\.json$/,
  /\/assets\/item-icons\//,
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(PRECACHE_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_VERSION)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // 緊急メッセージを常に最新にするため、tips.jsonは一切キャッシュしない
  if (/\/data\/tips\.json$/.test(url.pathname)) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (CACHE_FIRST_PATTERNS.some(pattern => pattern.test(url.pathname))) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(networkFirst(request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Network error', { status: 503 });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('Offline', { status: 503 });
  }
}

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      await cache.put('./index.html', response.clone());
    }
    return response;
  } catch {
    return (await caches.match(request))
      || (await caches.match('./index.html'))
      || new Response('Offline', { status: 503 });
  }
}
