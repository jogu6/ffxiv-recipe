import { openOpfsSearchStore } from './opfs-search-storage.js';

export const SEARCH_DISK_BYTES = 3 * 1024 * 1024 * 1024;

// IndexedDB works on HTTP LAN origins too. Asyncify suspends WASM at page faults;
// pending writes are bounded and never retain the entire search in the JS heap.
export async function openIndexedSearchStore({ onActivity = () => {} } = {}) {
  const opfs = await openOpfsSearchStore({ onActivity });
  if (opfs) return opfs;
  // Deletion waits for live connections, so another active generation keeps its
  // database. Closed remnants of a terminated tab can be reclaimed immediately.
  for (const database of await indexedDB.databases()) {
    if (database.name?.startsWith('xivca-search-')) indexedDB.deleteDatabase(database.name);
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const databaseName = `xivca-search-${Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')}`;
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('pages');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const pending = new Map();
  const blocks = new Map();
  const metrics = { storageReadTransactions: 0, storageWriteTransactions: 0,
    storageReadMs: 0, storageWriteMs: 0, storageReadBytes: 0, storageWrittenBytes: 0,
    storageQuotaBytes: 0, storageUsageBytes: 0, storageAvailableBytes: 0,
    storageFourGiBAvailable: false, storageReservedBytes: 0,
    storageReserveTransactions: 0, storageReserveMs: 0,
    storageBackend: 'indexeddb', storageReservationMode: 'indexeddb-logical-limit',
    storageRequestedBytes: 0, storagePersistent: false };
  const quotaCheckIntervalBytes = 32 * 1024 * 1024;
  let writtenAtQuotaCheck = -quotaCheckIntervalBytes;
  function reportActivity(operation) {
    try { onActivity({ operation, ...metrics }); } catch {}
  }
  function capacityError() {
    const error = new Error('端末の一時保存領域が不足しています。空き容量を増やしてから、もう一度お試しください');
    error.name = 'QuotaExceededError';
    return error;
  }
  async function checkCapacity(requiredBytes = 0, force = false) {
    if (!navigator.storage?.estimate || (!force && metrics.storageWrittenBytes > 0
      && metrics.storageWrittenBytes - writtenAtQuotaCheck < quotaCheckIntervalBytes)) return;
    const estimate = await navigator.storage.estimate();
    metrics.storageQuotaBytes = Math.max(0, Number(estimate.quota) || 0);
    metrics.storageUsageBytes = Math.max(0, Number(estimate.usage) || 0);
    metrics.storageAvailableBytes = Math.max(0, metrics.storageQuotaBytes - metrics.storageUsageBytes);
    metrics.storageFourGiBAvailable = metrics.storageAvailableBytes >= 4 * 1024 * 1024 * 1024;
    writtenAtQuotaCheck = metrics.storageWrittenBytes;
    if (metrics.storageQuotaBytes > 0
      && metrics.storageUsageBytes + requiredBytes > metrics.storageQuotaBytes) throw capacityError();
  }
  if (navigator.storage?.persist) {
    try { metrics.storagePersistent = await navigator.storage.persist(); } catch {}
  }
  await checkCapacity(0, true);
  const blockBytes = 65536;
  const blockLimit = 128; // At most 8 MiB of read-ahead, independent of search size.
  async function flush() {
    const entries = [...pending];
    if (entries.length === 0) return;
    const batchBytes = entries.reduce((sum, [, bytes]) => sum + bytes.byteLength, 0);
    await checkCapacity(batchBytes);
    const started = performance.now();
    metrics.storageWriteTransactions++;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('pages', 'readwrite', { durability: 'relaxed' });
      const store = transaction.objectStore('pages');
      for (const [at, bytes] of entries) store.put(bytes, at);
      pending.clear();
      transaction.oncomplete = () => {
        metrics.storageWriteMs += performance.now() - started;
        metrics.storageWrittenBytes += batchBytes;
        reportActivity('write');
        resolve();
      };
      transaction.onerror = () => reject(transaction.error?.name === 'QuotaExceededError'
        ? capacityError() : transaction.error);
      transaction.onabort = () => reject(transaction.error?.name === 'QuotaExceededError'
        ? capacityError() : transaction.error || new Error('探索用の一時保存に失敗しました'));
    });
  }
  return {
    databaseName,
    metrics,
    async reserve(requestedBytes) {
      const bytes = Math.max(0, Math.floor(globalThis.__xivcaSearchCapacityBytes ?? requestedBytes));
      metrics.storageRequestedBytes = bytes;
      if (metrics.storageReservedBytes === bytes) return;
      if (metrics.storageReservedBytes) throw new Error('探索中は一時保存領域を拡張できません');
      const started = performance.now();
      await checkCapacity(bytes, true);
      metrics.storageReserveTransactions++;
      metrics.storageReserveMs += performance.now() - started;
      metrics.storageReservedBytes = bytes;
      reportActivity('reserve');
    },
    write(at, bytes) {
      metrics.storageLastOperation = 'write';
      metrics.storageLastOffsetBytes = at;
      metrics.storageLastLengthBytes = bytes.byteLength;
      if (at < 0 || at + bytes.byteLength > metrics.storageReservedBytes) throw capacityError();
      const copy = bytes.slice();
      pending.set(at, copy);
      blocks.get(Math.floor(at / blockBytes))?.set(at, copy);
      if (pending.size >= 128) return flush();
    },
    read(at, bytes) {
      metrics.storageLastOperation = 'read';
      metrics.storageLastOffsetBytes = at;
      metrics.storageLastLengthBytes = bytes.byteLength;
      if (pending.has(at)) { bytes.set(pending.get(at)); return; }
      const block = Math.floor(at / blockBytes);
      if (blocks.get(block)?.has(at)) {
        const values = blocks.get(block);
        blocks.delete(block); blocks.set(block, values);
        bytes.set(values.get(at)); return;
      }
      const started = performance.now();
      metrics.storageReadTransactions++;
      return new Promise((resolve, reject) => {
        const transaction = database.transaction('pages');
        const store = transaction.objectStore('pages');
        const range = IDBKeyRange.bound(block * blockBytes, (block + 1) * blockBytes, false, true);
        const keys = store.getAllKeys(range);
        const values = store.getAll(range);
        transaction.oncomplete = () => {
          metrics.storageReadMs += performance.now() - started;
          const loaded = new Map(keys.result.map((key, index) => [key, values.result[index]]));
          if (loaded.get(at)?.length !== bytes.length) { reject(new Error('探索用の一時データを読み込めません')); return; }
          blocks.delete(block);
          blocks.set(block, loaded);
          while (blocks.size > blockLimit) blocks.delete(blocks.keys().next().value);
          bytes.set(loaded.get(at));
          metrics.storageReadBytes += values.result.reduce((sum, value) => sum + value.byteLength, 0);
          reportActivity('read');
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error('探索用の一時データを読み込めません'));
      });
    },
    async close() {
      pending.clear();
      blocks.clear();
      database.close();
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(databaseName);
        request.onsuccess = resolve;
        request.onerror = () => reject(request.error);
      });
    }
  };
}
