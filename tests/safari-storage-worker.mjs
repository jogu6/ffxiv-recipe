import { openOpfsSearchStore } from '/macro-app/web/opfs-search-storage.js';

const TOTAL = 3 * 1024 ** 3;
const CHUNK = 1024 ** 2;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const report = (stage, data = {}) => self.postMessage({ stage, ...data });

async function ownFiles(root, prefix) {
  const files = [];
  for await (const name of root.keys()) if (name.startsWith(`${prefix}-`)) files.push(name);
  return files;
}

async function run() {
  const root = await navigator.storage.getDirectory();
  const results = [];
  // Repeat on the same origin to verify cleanup permits another generation.
  for (let round = 1; round <= 2; round++) {
    const store = await openOpfsSearchStore();
    assert(store?.metrics.storageBackend === 'opfs', 'Safari OPFS is unavailable; no fallback is permitted in this experiment');
    const prefix = store.databaseName.slice(5);
    let metrics;
    try {
      const before = await navigator.storage.estimate();
      report('preparing', { round, before });
      await store.reserve(TOTAL);
      await store.reserve(TOTAL);
      assert(store.metrics.storageReservedBytes === TOTAL, 'Reservation must cover exactly 3 GiB');
      assert(store.metrics.storageReserveTransactions === 1, 'Repeated reserve must not allocate again');
      assert(store.metrics.storageSegmentCount === 49, 'Expected 49 page-aligned segments below WebKit rounding boundaries');
      report('reserved', { round, metrics: { ...store.metrics } });

      // A sparse truncate alone cannot prove that all disk blocks can be written.
      // Use a bounded 1 MiB buffer to write AND verify every byte of all 3 GiB.
      const words = new Uint32Array(CHUNK / 4);
      const bytes = new Uint8Array(words.buffer);
      const writeStart = performance.now();
      for (let at = 0; at < TOTAL; at += CHUNK) {
        const pattern = ((at / CHUNK) ^ (round * 0x13579bdf)) >>> 0;
        words.fill(pattern);
        store.write(at, bytes);
        if ((at + CHUNK) % (256 * CHUNK) === 0) report('writing', { round, bytes: at + CHUNK });
      }
      const writeMs = performance.now() - writeStart;
      const afterWrite = await navigator.storage.estimate();
      const readStart = performance.now();
      for (let at = TOTAL - CHUNK; at >= 0; at -= CHUNK) {
        words.fill(0);
        store.read(at, bytes);
        const expected = ((at / CHUNK) ^ (round * 0x13579bdf)) >>> 0;
        for (let i = 0; i < words.length; i++) {
          if (words[i] !== expected) throw new Error(`Data mismatch at byte ${at + i * 4}`);
        }
        if (at % (256 * CHUNK) === 0) report('reading', { round, bytes: TOTAL - at });
      }
      const readAndVerifyMs = performance.now() - readStart;
      let capacityError = false;
      try { store.write(TOTAL, new Uint8Array([1])); }
      catch (error) { capacityError = error.name === 'QuotaExceededError'; }
      assert(capacityError, 'A write past the fixed capacity must fail');
      let resizeError = false;
      try { await store.reserve(TOTAL + CHUNK); }
      catch { resizeError = true; }
      assert(resizeError, 'Resizing during generation must fail');
      metrics = { round, before, afterWrite, writeMs, readAndVerifyMs, capacityError, resizeError, ...store.metrics };
    } finally {
      await store.close();
    }
    assert((await ownFiles(root, prefix)).length === 0, 'Temporary files remain after close');
    const cleanupSamples = [];
    for (const waitMs of [0, 1000, 5000]) {
      if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
      const entries = [];
      for await (const [name, handle] of root.entries()) {
        entries.push({ name, kind: handle.kind, bytes: handle.kind === 'file' ? (await handle.getFile()).size : null });
      }
      assert(entries.length === 0, 'The isolated test origin contains leftover OPFS entries');
      cleanupSamples.push({ waitMs, entries, estimate: await navigator.storage.estimate() });
    }
    results.push({ ...metrics, cleanedUp: true, cleanupSamples });
    report('round-complete', results.at(-1));
  }
  // A stale estimate must not reject an allocation that the browser permits.
  const originalEstimate = navigator.storage.estimate.bind(navigator.storage);
  navigator.storage.estimate = async () => ({ quota: TOTAL, usage: TOTAL });
  const staleStore = await openOpfsSearchStore();
  const stalePrefix = staleStore.databaseName.slice(5);
  try {
    await staleStore.reserve(TOTAL);
    const value = new Uint8Array([17, 34, 51, 68]);
    staleStore.write(TOTAL - value.length, value);
    const actual = new Uint8Array(value.length);
    staleStore.read(TOTAL - actual.length, actual);
    assert(actual.every((byte, index) => byte === value[index]), 'Stale-estimate allocation failed');
  } finally {
    await staleStore.close();
    navigator.storage.estimate = originalEstimate;
  }
  assert((await ownFiles(root, stalePrefix)).length === 0, 'Stale-estimate test did not clean up');
  report('stale-estimate-complete', { accepted: true, cleanedUp: true });
  report('complete', { results });
}

run().catch(error => report('error', { message: error.message, stack: error.stack }));
