import { openIndexedSearchStore } from './search-storage.js';
let store, control, running = false;
let processing = Promise.resolve();
self.onmessage = async ({ data }) => {
  if (data.type === 'close') {
    try {
      running = false;
      if (control) Atomics.notify(control, 1);
      await processing;
      await store?.close();
      store = undefined;
      self.postMessage({ type: 'closed' });
    } catch (error) {
      self.postMessage({ type: 'error', message: String(error?.message || error) });
    }
    return;
  }
  if (data.type !== 'open') return;
  control = new Int32Array(data.buffer, 0, 16);
  try {
    store = await openIndexedSearchStore();
    running = true;
    self.postMessage({ type: 'storage-open', databaseName: store.databaseName });
    const address = new Float64Array(data.buffer, 16, 1);
    const page = new Uint8Array(data.buffer, 64);
    while (running) {
      const command = Atomics.load(control, 1);
      if (!command) {
        if (Atomics.waitAsync) await Atomics.waitAsync(control, 1, 0).value;
        else await new Promise(resolve => setTimeout(resolve, 1));
        continue;
      }
      processing = Promise.resolve(store[command === 1 ? 'read' : 'write'](address[0], page.subarray(0, control[6])));
      await processing;
      const metrics = store.metrics;
      [metrics.storageReadTransactions, metrics.storageWriteTransactions, metrics.storageReadMs, metrics.storageWriteMs]
        .forEach((value, index) => Atomics.store(control, index + 8, Math.round(value)));
      Atomics.store(control, 1, 0);
      Atomics.notify(control, 1);
    }
  } catch (error) {
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
    self.postMessage({ type: 'error', message: String(error?.message || error) });
  }
};
