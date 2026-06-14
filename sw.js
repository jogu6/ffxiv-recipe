// ===== キャッシュバージョン =====
// データを更新したときはここの番号を上げてください
const CACHE_VERSION = 'ff14recipe-v1.2';

// ===== キャッシュ対象のリソース種別 =====
const CACHE_FIRST_PATTERNS = [
  /\/data\/Item\.json$/,   // レシピデータ（重いのでキャッシュ優先）
  /\/picture\//,           // アイコン画像
];

// ===== インストール =====
// SW登録直後に発火。index.html だけ事前キャッシュする
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.add('./index.html'))
  );
  // 旧SWを待たずに即座に有効化
  self.skipWaiting();
});

// ===== アクティベート =====
// 古いバージョンのキャッシュを削除する
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_VERSION)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ===== フェッチ =====
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Cache First: Item.json・画像
  if (CACHE_FIRST_PATTERNS.some(p => p.test(url))) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // Network First: index.html その他
  event.respondWith(networkFirst(event.request));
});

// --- Cache First 戦略 ---
// キャッシュにあればそれを返す。なければfetchしてキャッシュに保存
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Network error', { status: 503 });
  }
}

// --- Network First 戦略 ---
// まずネットワークを試みる。失敗したらキャッシュを返す
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('Offline', { status: 503 });
  }
}
