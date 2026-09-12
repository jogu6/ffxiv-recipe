// IndexedDB works on HTTP LAN origins too. Asyncify suspends WASM at page faults;
// pending writes are bounded and never retain the entire search in the JS heap.
export async function openIndexedSearchStore() {
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
    storageReadMs: 0, storageWriteMs: 0 };
  const blockBytes = 65536;
  const blockLimit = 128; // At most 8 MiB of read-ahead, independent of search size.
  function flush() {
    const started = performance.now();
    metrics.storageWriteTransactions++;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('pages', 'readwrite', { durability: 'relaxed' });
      const store = transaction.objectStore('pages');
      for (const [at, bytes] of pending) store.put(bytes, at);
      pending.clear();
      transaction.oncomplete = () => { metrics.storageWriteMs += performance.now() - started; resolve(); };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('探索用の一時保存に失敗しました'));
    });
  }
  return {
    databaseName,
    metrics,
    write(at, bytes) {
      const copy = bytes.slice();
      pending.set(at, copy);
      blocks.get(Math.floor(at / blockBytes))?.set(at, copy);
      if (pending.size >= 128) return flush();
    },
    read(at, bytes) {
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
