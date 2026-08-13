(function initItemIconPack(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ItemIconPack = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function createItemIconPackApi() {
  'use strict';

  const MAGIC = 'XIVIPK01';
  const HEADER_BYTES = 48;
  const PACK_SOURCE = './data/item-icons.pack.gz';
  const PACK_VERSION = 'ff868b30521663058a826e92809b142ef3bc79b3dcc1256f65fb387489daac38';
  const INDEXED_DB_NAME = 'ff14recipe-item-icons-v1';
  const INDEXED_DB_STORE = 'packs';
  const JOB_ICON_PACK_FILES = Object.freeze([
    'job-icons/alchemist.webp', 'job-icons/armorer.webp', 'job-icons/blacksmith.webp',
    'job-icons/botanist.webp', 'job-icons/carpenter.webp', 'job-icons/culinarian.webp',
    'job-icons/fisher.webp', 'job-icons/goldsmith.webp', 'job-icons/leatherworker.webp',
    'job-icons/miner.webp', 'job-icons/weaver.webp'
  ]);
  const SHA256_INITIAL = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ]);
  const SHA256_CONSTANTS = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);

  function iconFileNames(document) {
    const items = Array.isArray(document) ? document : document?.Items;
    if (!Array.isArray(items)) throw new TypeError('Item.jsonにアイテム一覧がありません。');
    return [...new Set(items.map(item => item?.IconFile).filter(Boolean))];
  }

  function bytesToHex(bytes) {
    return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  }

  function rotateRight(value, bits) {
    return (value >>> bits) | (value << (32 - bits));
  }

  function createSha256FallbackState(buffer) {
    const source = new Uint8Array(buffer);
    const bitLength = source.byteLength * 8;
    const paddedLength = Math.ceil((source.byteLength + 9) / 64) * 64;
    const padded = new Uint8Array(paddedLength);
    padded.set(source);
    padded[source.byteLength] = 0x80;
    const paddedView = new DataView(padded.buffer);
    paddedView.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
    paddedView.setUint32(paddedLength - 4, bitLength >>> 0, false);
    return {
      padded,
      paddedLength,
      paddedView,
      hash: new Uint32Array(SHA256_INITIAL),
      words: new Uint32Array(64)
    };
  }

  function processSha256FallbackBlock(state, offset) {
    const { paddedView, hash, words } = state;
      for (let index = 0; index < 16; index += 1) words[index] = paddedView.getUint32(offset + index * 4, false);
      for (let index = 16; index < 64; index += 1) {
        const left = words[index - 15];
        const right = words[index - 2];
        const sigma0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3);
        const sigma1 = rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10);
        words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = hash;
      for (let index = 0; index < 64; index += 1) {
        const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
        const choice = (e & f) ^ (~e & g);
        const temporary1 = (h + sum1 + choice + SHA256_CONSTANTS[index] + words[index]) >>> 0;
        const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
        const majority = (a & b) ^ (a & c) ^ (b & c);
        const temporary2 = (sum0 + majority) >>> 0;
        h = g;
        g = f;
        f = e;
        e = (d + temporary1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (temporary1 + temporary2) >>> 0;
      }
      hash[0] = (hash[0] + a) >>> 0;
      hash[1] = (hash[1] + b) >>> 0;
      hash[2] = (hash[2] + c) >>> 0;
      hash[3] = (hash[3] + d) >>> 0;
      hash[4] = (hash[4] + e) >>> 0;
      hash[5] = (hash[5] + f) >>> 0;
      hash[6] = (hash[6] + g) >>> 0;
      hash[7] = (hash[7] + h) >>> 0;
  }

  function finishSha256Fallback(state) {
    const output = new Uint8Array(32);
    const outputView = new DataView(output.buffer);
    state.hash.forEach((value, index) => outputView.setUint32(index * 4, value, false));
    return bytesToHex(output);
  }

  function sha256Fallback(buffer) {
    const state = createSha256FallbackState(buffer);
    for (let offset = 0; offset < state.paddedLength; offset += 64) {
      processSha256FallbackBlock(state, offset);
    }
    return finishSha256Fallback(state);
  }

  function yieldToMainThread() {
    if (globalThis.scheduler?.yield) return globalThis.scheduler.yield();
    return new Promise(resolve => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        channel.port2.close();
        resolve();
      };
      channel.port2.postMessage(null);
    });
  }

  async function sha256FallbackAsync(buffer, { blockBatchSize = 2048, yieldTask = yieldToMainThread } = {}) {
    const state = createSha256FallbackState(buffer);
    let processedBlocks = 0;
    for (let offset = 0; offset < state.paddedLength; offset += 64) {
      processSha256FallbackBlock(state, offset);
      processedBlocks += 1;
      if (processedBlocks % blockBatchSize === 0 && offset + 64 < state.paddedLength) await yieldTask();
    }
    return finishSha256Fallback(state);
  }

  async function sha256(buffer, cryptoApi = globalThis.crypto) {
    if (!cryptoApi?.subtle) return sha256FallbackAsync(buffer);
    return bytesToHex(new Uint8Array(await cryptoApi.subtle.digest('SHA-256', buffer)));
  }

  function parsePack(buffer, files) {
    if (!(buffer instanceof ArrayBuffer)) throw new TypeError('画像パックがArrayBufferではありません。');
    if (buffer.byteLength < HEADER_BYTES) throw new Error('画像パックが短すぎます。');
    const bytes = new Uint8Array(buffer);
    const magic = String.fromCharCode(...bytes.subarray(0, 8));
    if (magic !== MAGIC) throw new Error('画像パックの形式が不正です。');
    const view = new DataView(buffer);
    const count = view.getUint32(8, true);
    const headerBytes = view.getUint32(12, true);
    if (headerBytes !== HEADER_BYTES || count !== files.length) {
      throw new Error('画像パックとItem.jsonの件数が一致しません。');
    }
    const indexEnd = headerBytes + count * 4;
    if (indexEnd > buffer.byteLength) throw new Error('画像パックの索引が不正です。');
    let offset = indexEnd;
    const entries = new Map();
    for (let index = 0; index < count; index += 1) {
      const length = view.getUint32(headerBytes + index * 4, true);
      if (length < 12 || offset + length > buffer.byteLength) throw new Error('画像パックの画像範囲が不正です。');
      if (
        String.fromCharCode(...bytes.subarray(offset, offset + 4)) !== 'RIFF'
        || String.fromCharCode(...bytes.subarray(offset + 8, offset + 12)) !== 'WEBP'
      ) throw new Error(`画像パック内のWebPが不正です: ${files[index]}`);
      entries.set(files[index], { offset, length });
      offset += length;
    }
    if (offset !== buffer.byteLength) throw new Error('画像パック末尾に不正なデータがあります。');
    return { entries, bodyOffset: HEADER_BYTES, expectedBodyHash: bytesToHex(bytes.subarray(16, 48)) };
  }

  async function validatePack(buffer, files, cryptoApi = globalThis.crypto, expectedVersion = '') {
    const parsed = parsePack(buffer, files);
    if (expectedVersion && parsed.expectedBodyHash !== expectedVersion) {
      throw new Error('画像パックの公開版が一致しません。');
    }
    const bodyHash = await sha256(buffer.slice(parsed.bodyOffset), cryptoApi);
    if (bodyHash !== parsed.expectedBodyHash) throw new Error('画像パックの内容ハッシュが一致しません。');
    return parsed.entries;
  }

  async function decompressGzip(buffer, DecompressionStreamClass = globalThis.DecompressionStream) {
    if (typeof DecompressionStreamClass !== 'function') throw new Error('gzip展開機能を利用できません。');
    const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStreamClass('gzip'));
    return new Response(stream).arrayBuffer();
  }

  function cacheRequest(dataVersion, packVersion = PACK_VERSION, baseUrl = globalThis.location?.href || 'http://localhost/') {
    return new Request(new URL(
      `./data/item-icons-${encodeURIComponent(dataVersion)}-${encodeURIComponent(packVersion)}.pack`,
      baseUrl
    ));
  }

  function indexedDbRequest(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB操作に失敗しました。'));
    });
  }

  async function createIndexedDbCache(indexedDBApi = globalThis.indexedDB) {
    if (!indexedDBApi?.open) return null;
    const openRequest = indexedDBApi.open(INDEXED_DB_NAME, 1);
    openRequest.onupgradeneeded = () => {
      if (!openRequest.result.objectStoreNames.contains(INDEXED_DB_STORE)) {
        openRequest.result.createObjectStore(INDEXED_DB_STORE);
      }
    };
    const database = await indexedDbRequest(openRequest);
    const store = mode => database.transaction(INDEXED_DB_STORE, mode).objectStore(INDEXED_DB_STORE);
    return {
      async match(request) {
        const buffer = await indexedDbRequest(store('readonly').get(request.url));
        return buffer instanceof ArrayBuffer
          ? new Response(buffer, { headers: { 'Content-Type': 'application/octet-stream' } })
          : undefined;
      },
      async put(request, response) {
        const buffer = await response.arrayBuffer();
        await indexedDbRequest(store('readwrite').put(buffer, request.url));
      },
      async delete(request) {
        await indexedDbRequest(store('readwrite').delete(typeof request === 'string' ? request : request.url));
        return true;
      },
      async keys() {
        const keys = await indexedDbRequest(store('readonly').getAllKeys());
        return keys.map(key => new Request(String(key)));
      }
    };
  }

  async function openPackCache(dataVersion, cacheStorage, indexedDBApi) {
    if (cacheStorage?.open) {
      try {
        return await cacheStorage.open(dataVersion);
      } catch {}
    }
    try {
      return await createIndexedDbCache(indexedDBApi);
    } catch {
      return null;
    }
  }

  async function cleanupCache(cache, keepRequest) {
    const requests = await cache.keys();
    await Promise.all(requests.map(request => {
      const url = new URL(request.url);
      const legacyIcon = /\/assets\/item-icons\//u.test(url.pathname);
      const oldPack = /\/data\/item-icons-[^/]+\.pack$/u.test(url.pathname) && request.url !== keepRequest.url;
      return legacyIcon || oldPack ? cache.delete(request) : undefined;
    }));
  }

  async function prepare({
    document,
    dataVersion,
    cacheStorage = globalThis.caches,
    indexedDBApi = globalThis.indexedDB,
    fetchImpl = globalThis.fetch,
    cryptoApi = globalThis.crypto,
    DecompressionStreamClass = globalThis.DecompressionStream,
    packVersion = PACK_VERSION,
    additionalFiles = JOB_ICON_PACK_FILES,
    onProgress = () => {}
  }) {
    if (typeof fetchImpl !== 'function') throw new Error('画像パックを取得できません。');
    const files = [...iconFileNames(document), ...additionalFiles];
    const request = cacheRequest(dataVersion, packVersion);
    const cache = await openPackCache(dataVersion, cacheStorage, indexedDBApi);
    let response;
    try {
      response = await cache?.match(request);
    } catch {
      response = null;
    }
    let buffer;
    if (response) {
      onProgress('ローカルのアイテム画像を確認しています', 12);
      buffer = await response.arrayBuffer();
      try {
        const parsed = parsePack(buffer, files);
        if (parsed.expectedBodyHash !== packVersion) throw new Error('画像パックの版が一致しません。');
        const entries = parsed.entries;
        await cleanupCache(cache, request).catch(() => {});
        return createPreparedPack(buffer, entries);
      } catch {
        await cache.delete(request).catch(() => {});
        buffer = null;
      }
    }

    onProgress('アイテム画像を取得しています', 15);
    response = await fetchImpl(PACK_SOURCE, { cache: 'no-store' });
    if (!response.ok) throw new Error(`アイテム画像を取得できませんでした (${response.status})`);
    const compressed = await response.arrayBuffer();
    onProgress('アイテム画像を展開しています', 45);
    const sourceMagic = String.fromCharCode(...new Uint8Array(compressed, 0, Math.min(8, compressed.byteLength)));
    buffer = sourceMagic === MAGIC
      ? compressed
      : await decompressGzip(compressed, DecompressionStreamClass);
    onProgress('アイテム画像を検証しています', 65);
    const entries = await validatePack(buffer, files, cryptoApi, packVersion);
    onProgress('アイテム画像をローカルへ保存しています', 78);
    if (cache) {
      await cache.put(request, new Response(buffer, { headers: { 'Content-Type': 'application/octet-stream' } })).catch(() => {});
      await cleanupCache(cache, request).catch(() => {});
    }
    return createPreparedPack(buffer, entries);
  }

  function createPreparedPack(buffer, entries) {
    const urls = new Map();
    return Object.freeze({
      size: buffer.byteLength,
      has: file => entries.has(file),
      url(file) {
        if (urls.has(file)) return urls.get(file);
        const entry = entries.get(file);
        if (!entry) return '';
        const url = URL.createObjectURL(new Blob([buffer.slice(entry.offset, entry.offset + entry.length)], { type: 'image/webp' }));
        urls.set(file, url);
        return url;
      },
      close() {
        urls.forEach(url => URL.revokeObjectURL(url));
        urls.clear();
      }
    });
  }

  return Object.freeze({
    HEADER_BYTES,
    JOB_ICON_PACK_FILES,
    MAGIC,
    PACK_SOURCE,
    PACK_VERSION,
    cacheRequest,
    createIndexedDbCache,
    iconFileNames,
    parsePack,
    prepare,
    sha256Fallback,
    sha256FallbackAsync,
    validatePack
  });
});
