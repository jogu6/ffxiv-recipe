(function initSharePngStore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SharePngStore = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function createSharePngStoreApi() {
  'use strict';

  const DB_NAME = 'xivca-share-png-v1';
  const STORE_NAME = 'pngs';
  const MAX_COUNT = 5;
  const MAX_BYTES = 50 * 1024 * 1024;
  const HOLD_MS = 10 * 60 * 1000;

  function validRecord(record, now) {
    return Boolean(
      record && typeof record.id === 'string' && record.blob instanceof Blob && record.blob.type === 'image/png' &&
      record.size === record.blob.size && Number.isFinite(record.createdAt) && Number.isFinite(record.expiresAt) &&
      record.expiresAt > now && record.expiresAt <= now + HOLD_MS + 60_000
    );
  }

  async function createMemoryBackend(BroadcastChannelClass) {
    const records = new Map();
    const channel = BroadcastChannelClass ? new BroadcastChannelClass('xivca-share-png-memory-v1') : null;
    const requestId = `${Date.now()}-${Math.random()}`;
    if (channel) {
      channel.onmessage = event => {
        const message = event.data;
        if (message?.type === 'put' && message.record) records.set(message.record.id, message.record);
        if (message?.type === 'delete') records.delete(message.id);
        if (message?.type === 'query') channel.postMessage({ type: 'snapshot', requestId: message.requestId, records: [...records.values()] });
        if (message?.type === 'snapshot' && message.requestId === requestId) {
          message.records.forEach(record => records.set(record.id, record));
        }
      };
      channel.postMessage({ type: 'query', requestId });
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    return {
      async all() { return [...records.values()]; },
      async put(record) { records.set(record.id, record); channel?.postMessage({ type: 'put', record }); },
      async delete(id) { records.delete(id); channel?.postMessage({ type: 'delete', id }); },
      async close() { channel?.close(); }
    };
  }

  function openIndexedDb(indexedDB) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      };
      request.onerror = () => reject(request.error || new Error('IndexedDBを開けませんでした。'));
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        const requestFor = (mode, operation) => new Promise((res, rej) => {
          const transaction = db.transaction(STORE_NAME, mode);
          const store = transaction.objectStore(STORE_NAME);
          const value = operation(store);
          transaction.oncomplete = () => res(value?.result);
          transaction.onerror = () => rej(transaction.error || new Error('IndexedDB操作に失敗しました。'));
          transaction.onabort = () => rej(transaction.error || new Error('IndexedDB操作が中止されました。'));
        });
        resolve({
          all: () => requestFor('readonly', store => store.getAll()),
          put: record => requestFor('readwrite', store => store.put(record)),
          delete: id => requestFor('readwrite', store => store.delete(id)),
          close: async () => db.close()
        });
      };
    });
  }

  async function createStore({
    indexedDB = globalThis.indexedDB,
    BroadcastChannelClass = globalThis.BroadcastChannel,
    now = () => Date.now()
  } = {}) {
    let mode = 'indexeddb';
    let backend;
    try {
      if (!indexedDB) throw new Error('IndexedDB unavailable');
      backend = await openIndexedDb(indexedDB);
      await backend.all();
    } catch {
      mode = 'memory';
      backend = await createMemoryBackend(BroadcastChannelClass);
    }

    async function cleanup() {
      const current = now();
      const records = await backend.all();
      const valid = [];
      for (const record of records) {
        if (validRecord(record, current)) valid.push(record);
        else if (record?.id) await backend.delete(record.id);
      }
      return valid;
    }

    async function stats() {
      const records = await cleanup();
      return {
        count: records.length,
        bytes: records.reduce((sum, record) => sum + record.blob.size, 0),
        nextAvailableAt: records.length ? Math.min(...records.map(record => record.expiresAt)) : 0,
        full: records.length >= MAX_COUNT || records.reduce((sum, record) => sum + record.blob.size, 0) >= MAX_BYTES
      };
    }

    async function save({ id, blob, ownerId, fileName, title }) {
      if (!(blob instanceof Blob) || blob.type !== 'image/png') throw new TypeError('PNG Blobが必要です。');
      const records = await cleanup();
      const bytes = records.reduce((sum, record) => sum + record.blob.size, 0);
      if (records.length >= MAX_COUNT || bytes + blob.size > MAX_BYTES) {
        const error = new Error('画像共有の一時保存上限に達しています。');
        error.code = 'SHARE_STORAGE_FULL';
        error.nextAvailableAt = records.length ? Math.min(...records.map(record => record.expiresAt)) : now() + HOLD_MS;
        throw error;
      }
      const createdAt = now();
      const record = { id, blob, size: blob.size, ownerId, fileName, title, createdAt, expiresAt: createdAt + HOLD_MS };
      await backend.put(record);
      return record;
    }

    async function get(id) {
      return (await cleanup()).find(record => record.id === id) || null;
    }

    return Object.freeze({ cleanup, close: () => backend.close(), get, getMode: () => mode, remove: id => backend.delete(id), save, stats });
  }

  return Object.freeze({ DB_NAME, HOLD_MS, MAX_BYTES, MAX_COUNT, STORE_NAME, createStore, validRecord });
});
