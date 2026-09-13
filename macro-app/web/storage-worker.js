import { openIndexedSearchStore, SEARCH_DISK_BYTES } from './search-storage.js';
let store, control, running = false;
let processing = Promise.resolve();
let opening = Promise.resolve(), closing = false;
let phase = 'open';
self.onmessage = async ({ data }) => {
  if (data.type === 'close') {
    try {
      closing = true;
      running = false;
      if (control) Atomics.notify(control, 1);
      await opening.catch(() => {});
      await processing;
      await store?.close();
      if (store) self.postMessage({ type: 'storage-progress',
        metrics: { ...store.metrics, operation: 'close', storageClosed: true } });
      store = undefined;
      self.postMessage({ type: 'closed' });
    } catch (error) {
      self.postMessage({ type: 'error', message: String(error?.message || error), errorName: error?.name,
        diagnostics: { phase: 'close', storage: { ...store?.metrics } } });
    }
    return;
  }
  if (data.type !== 'open') return;
  closing = false;
  control = new Int32Array(data.buffer, 0, 16);
  try {
    opening = (async () => {
      phase = 'open';
      store = await openIndexedSearchStore({
        onActivity: metrics => self.postMessage({ type: 'storage-progress', metrics })
      });
      self.postMessage({ type: 'storage-created', databaseName: store.databaseName });
      phase = 'reserve';
      await store.reserve(SEARCH_DISK_BYTES);
    })();
    await opening;
    if (closing) return;
    running = true;
    self.postMessage({ type: 'storage-open', databaseName: store.databaseName,
      metrics: { ...store.metrics } });
    const address = new Float64Array(data.buffer, 16, 1);
    const page = new Uint8Array(data.buffer, 64);
    // Native file APIs need an ordinary ArrayBuffer on some browsers.
    const ioPage = new Uint8Array(page.length);
    while (running) {
      const command = Atomics.load(control, 1);
      if (!command) {
        if (Atomics.waitAsync) await Atomics.waitAsync(control, 1, 0).value;
        else await new Promise(resolve => setTimeout(resolve, 1));
        continue;
      }
      const bytes = ioPage.subarray(0, control[6]);
      phase = command === 1 ? 'read' : 'write';
      if (command !== 1) bytes.set(page.subarray(0, control[6]));
      const operation = command === 1 ? store.read(address[0], bytes) : store.write(address[0], bytes);
      processing = Promise.resolve(operation);
      await processing;
      if (command === 1) page.set(bytes);
      const metrics = store.metrics;
      [metrics.storageReadTransactions, metrics.storageWriteTransactions, metrics.storageReadMs, metrics.storageWriteMs]
        .forEach((value, index) => Atomics.store(control, index + 8, Math.round(value)));
      Atomics.store(control, 12, Math.floor(metrics.storageReadBytes / 4096));
      Atomics.store(control, 13, Math.floor(metrics.storageWrittenBytes / 4096));
      Atomics.store(control, 14, Math.min(0x7fffffff, Math.floor(metrics.storageQuotaBytes / 1048576)));
      Atomics.store(control, 15, Math.min(0x7fffffff, Math.floor(metrics.storageUsageBytes / 1048576)));
      Atomics.store(control, 1, 0);
      Atomics.notify(control, 1);
    }
  } catch (error) {
    const diagnostics = { phase, storage: { ...store?.metrics }, stack: String(error?.stack || '') };
    running = false;
    processing = Promise.resolve();
    const failure = new TextEncoder().encode(String(error?.message || error));
    const page = new Uint8Array(data.buffer, 64);
    const length = Math.min(page.length, failure.length);
    page.set(failure.subarray(0, length));
    control[7] = length;
    Atomics.store(control, 3, 1);
    Atomics.notify(control, 1);
    Atomics.notify(control, 0);
    try { await store?.close(); } catch (cleanupError) {
      diagnostics.cleanupError = String(cleanupError?.message || cleanupError);
    }
    store = undefined;
    self.postMessage({ type: 'error', message: String(error?.message || error),
      errorName: error?.name || 'Error', diagnostics });
  }
};
