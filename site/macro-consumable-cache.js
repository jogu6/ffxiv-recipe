(function initMacroConsumableCache(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MacroConsumableCache = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function createMacroConsumableCacheApi() {
  'use strict';

  const DATABASE_NAME = 'xivca-macro-consumables-v1';
  const STORE_NAME = 'lists';
  const SCHEMA_VERSION = 2;

  function generationKey(document) {
    const version = String(document?.Version || '').trim();
    const generation = String(document?.DataGeneration || '').trim();
    return version && generation ? `${version}:${generation}` : '';
  }

  function validLists(value) {
    return value && Array.isArray(value.foods) && Array.isArray(value.medicines);
  }

  function openDatabase(indexedDBApi = globalThis.indexedDB) {
    if (!indexedDBApi?.open) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const request = indexedDBApi.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: 'generation' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('食事・薬品リストのキャッシュを開けませんでした。'));
    });
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('食事・薬品リストのキャッシュを読み込めませんでした。'));
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('食事・薬品リストの保存に失敗しました。'));
      transaction.onabort = () => reject(transaction.error || new Error('食事・薬品リストの保存が中止されました。'));
    });
  }

  async function load(document, indexedDBApi = globalThis.indexedDB) {
    const generation = generationKey(document);
    if (!generation) return null;
    const database = await openDatabase(indexedDBApi);
    if (!database) return null;
    try {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const entry = await requestResult(transaction.objectStore(STORE_NAME).get(generation));
      return entry?.generation === generation && entry?.schemaVersion === SCHEMA_VERSION && validLists(entry.data)
        ? entry.data
        : null;
    } finally {
      database.close();
    }
  }

  async function save(document, data, indexedDBApi = globalThis.indexedDB) {
    const generation = generationKey(document);
    if (!generation || !validLists(data)) return false;
    const database = await openDatabase(indexedDBApi);
    if (!database) return false;
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      store.clear();
      store.put({ generation, schemaVersion: SCHEMA_VERSION, data });
      await transactionDone(transaction);
      return true;
    } finally {
      database.close();
    }
  }

  return Object.freeze({ DATABASE_NAME, SCHEMA_VERSION, STORE_NAME, generationKey, load, save });
});
