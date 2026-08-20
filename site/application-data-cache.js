(function initApplicationDataCache(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ApplicationDataCache = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function createApplicationDataCacheApi() {
  'use strict';

  const DATABASE_NAME = 'xivca-application-data-v1';
  const STORE_NAME = 'models';
  const SCHEMA_VERSION = 1;

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
      request.onerror = () => reject(request.error || new Error('起動データキャッシュを開けませんでした。'));
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('起動データキャッシュの操作に失敗しました。'));
      transaction.onabort = () => reject(transaction.error || new Error('起動データキャッシュの操作が中止されました。'));
    });
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('起動データキャッシュを読み込めませんでした。'));
    });
  }

  function validEntry(entry, generation) {
    return entry?.generation === generation && entry?.schemaVersion === SCHEMA_VERSION && entry?.data;
  }

  async function load(generation, indexedDBApi = globalThis.indexedDB) {
    if (!generation) return null;
    const database = await openDatabase(indexedDBApi);
    if (!database) return null;
    try {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const entry = await requestResult(transaction.objectStore(STORE_NAME).get(generation));
      return validEntry(entry, generation) ? entry.data : null;
    } finally {
      database.close();
    }
  }

  async function save(generation, data, indexedDBApi = globalThis.indexedDB) {
    if (!generation || !data) return false;
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

  return Object.freeze({ DATABASE_NAME, SCHEMA_VERSION, STORE_NAME, load, save });
});
