import { openIndexedSearchStore } from './search-storage.js';
let enginePromise;
let engineThreadCount = 1;
let parallel = false;
let wasmMemory;
let solving = false;
async function openSearchStore(requestId) {
  if (parallel) return;
  globalThis.__xivcaSearchStore = await openIndexedSearchStore();
  self.postMessage({ type: 'storage-open', requestId, databaseName: globalThis.__xivcaSearchStore.databaseName });
}

async function closeSearchStore() {
  if (parallel) return;
  await globalThis.__xivcaSearchStore?.close?.();
  delete globalThis.__xivcaSearchStore;
}
// stage-site substitutes the SHA-256 of the deployed WASM, including on HTTP LAN.
const wasmSha256 = '__STAGED_WASM_SHA256__';
const parallelWasmSha256 = '__STAGED_PARALLEL_WASM_SHA256__';

function prepareEngine(message) {
  if (enginePromise) return enginePromise;
  parallel = !!message.storage;
  enginePromise = import(parallel ? '../build/engine-parallel/xivca_macro_engine.js' : '../build/engine/xivca_macro_engine.js').then(async engine => {
    const wasm = await engine.default();
    wasmMemory = wasm.memory;
    if (parallel) {
      const { createSharedSearchStore } = await import('./shared-search-storage.js');
      globalThis.__xivcaThreadStorage = message.storage;
      globalThis.__xivcaThreadFailurePort = message.failurePort;
      globalThis.__xivcaSearchStore = createSharedSearchStore(message.storage.buffer);
      await engine.initThreadPool(message.threadCount);
      engineThreadCount = engine.solver_thread_count();
    }
    return engine;
  });
  return enginePromise;
}

self.addEventListener('message', async event => {
  const message = event.data || {};
  if (!['prepare', 'solve'].includes(message.type)) return;
  if (message.type === 'solve' && solving) {
    self.postMessage({ type: 'error', requestId: message.requestId, message: 'マクロ生成は既に実行中です' });
    return;
  }
  if (message.type === 'solve') solving = true;
  try {
    const engine = await prepareEngine(message);
    if (message.type === 'prepare') {
      self.postMessage({
        type: 'ready', requestId: message.requestId, threadCount: engineThreadCount,
        activeThreadCount: parallel ? engine.solver_active_thread_count() : 1,
        threadError: message.threadError || ''
      });
      return;
    }
    if (!message.input) throw new Error('探索入力がありません');
    const input = JSON.stringify(message.input);
    if (message.type === 'solve') {
      await openSearchStore(message.requestId);
      // Zero means grow while allocations succeed. A fixed budget is only an
      // injected test condition, never an estimate of a phone's available RAM.
      const cacheBytes = globalThis.__xivcaStorageCacheBytes ?? message.cacheBytes ?? 0;
      engine.configure_storage_cache(cacheBytes);
      const started = performance.now();
      const reportTelemetry = json => self.postMessage({
        type: 'telemetry',
        requestId: message.requestId,
        snapshot: { ...JSON.parse(json), workerElapsedMs: performance.now() - started,
          wasmMemoryBytes: wasmMemory.buffer.byteLength, threadCount: engineThreadCount,
          wasmSha256: parallel ? parallelWasmSha256 : wasmSha256,
          ...globalThis.__xivcaSearchStore.metrics }
      });
      const result = JSON.parse(await engine.solve_exact_observed_json(input, reportTelemetry));
      await closeSearchStore();
      self.postMessage({ type: 'search-result', requestId: message.requestId, result });
      return;
    }
  } catch (error) {
    try { await closeSearchStore(); } catch (cleanupError) {
      console.error('探索用一時データの削除に失敗しました', cleanupError);
    }
    self.postMessage({ type: 'error', requestId: message.requestId, message: String(error?.message || error),
      errorStack: String(error?.stack || '') });
  } finally {
    if (message.type === 'solve') solving = false;
  }
});
