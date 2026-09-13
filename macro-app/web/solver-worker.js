import { openIndexedSearchStore, SEARCH_DISK_BYTES } from './search-storage.js';
import { createWorkProgressReporter } from './profiling.js';
let enginePromise;
let activeEngine;
let engineThreadCount = 1;
let parallel = false;
let wasmMemory;
let solving = false;
let phase = 'prepare';
let memoryEventSequence = 0;
function memoryDiagnostics(engine) {
  const [count, events] = JSON.parse(engine.wasm_memory_events_json());
  const fresh = events.filter(event => event.sequence > memoryEventSequence);
  memoryEventSequence = count;
  return {
    wasmMemoryMaximumBytes: (globalThis.__xivcaWasmMaximumPages ?? 65536) * 65536,
    wasmMemoryGrowCalls: engine.wasm_memory_grow_calls(),
    wasmMemoryGrowFailures: engine.wasm_memory_grow_failures(),
    wasmMemoryGrownBytes: engine.wasm_memory_grown_pages() * 65536,
    wasmMemoryLimitAvoided: engine.wasm_memory_limit_avoided(),
    wasmMemoryEventCount: count,
    wasmMemoryEvents: fresh
  };
}
async function openSearchStore(requestId) {
  if (parallel) return;
  phase = 'open';
  globalThis.__xivcaSearchStore = await openIndexedSearchStore({
    onActivity: metrics => self.postMessage({ type: 'storage-progress', requestId, metrics })
  });
  self.postMessage({ type: 'storage-open', requestId,
    databaseName: globalThis.__xivcaSearchStore.databaseName,
    metrics: { ...globalThis.__xivcaSearchStore.metrics } });
  phase = 'reserve';
  await globalThis.__xivcaSearchStore.reserve(SEARCH_DISK_BYTES);
}

async function closeSearchStore(requestId) {
  if (parallel) return;
  const store = globalThis.__xivcaSearchStore;
  await store?.close?.();
  if (store) self.postMessage({ type: 'storage-progress', requestId,
    metrics: { ...store.metrics, operation: 'close', storageClosed: true } });
  delete globalThis.__xivcaSearchStore;
}
// stage-site substitutes the SHA-256 of the deployed WASM, including on HTTP LAN.
const wasmSha256 = '__STAGED_WASM_SHA256__';
const parallelWasmSha256 = '__STAGED_PARALLEL_WASM_SHA256__';

function prepareEngine(message) {
  if (enginePromise) return enginePromise;
  parallel = !!message.storage;
  memoryEventSequence = 0;
  enginePromise = import(parallel ? '../build/engine-parallel/xivca_macro_engine.js' : '../build/engine/xivca_macro_engine.js').then(async engine => {
    const wasm = await engine.default();
    activeEngine = engine;
    wasmMemory = wasm.memory;
    if (!engine.configure_memory_limit(globalThis.__xivcaWasmMaximumPages ?? 65536)) {
      throw new Error('WASMメモリー上限の設定が実際の確保量と一致しません');
    }
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
    phase = 'prepare';
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
      // Zero keeps every page in RAM while allocation succeeds. A real failure
      // switches PageStore to lossless eviction; tests may inject a lower budget.
      const cacheBytes = globalThis.__xivcaStorageCacheBytes ?? message.cacheBytes ?? 0;
      engine.configure_storage_cache(cacheBytes);
      phase = 'solve';
      const started = performance.now();
      if (!parallel) globalThis.__xivcaWorkProgress = createWorkProgressReporter(work => {
        self.postMessage({ type: 'work-progress', requestId: message.requestId,
          ...work, workerElapsedMs: performance.now() - started });
      });
      if (parallel) self.postMessage({ type: 'live-progress-memory', requestId: message.requestId,
        memory: wasmMemory, address: engine.live_search_nodes_address(), activityAddress: engine.live_search_activity_address() });
      const reportTelemetry = json => {
        const snapshot = JSON.parse(json);
        if (Number.isSafeInteger(snapshot.liveSearchNodes)) {
          self.postMessage({ type: 'search-progress', requestId: message.requestId, searchNodes: snapshot.liveSearchNodes });
          return;
        }
        engine.configure_memory_stage(['preparing', 'finishBound', 'resourceQualityBound', 'stepLowerBound', 'bestFirstSearch', 'complete'].indexOf(snapshot.stage) + 1);
        self.postMessage({
        type: 'telemetry',
        requestId: message.requestId,
        snapshot: { ...snapshot, workerElapsedMs: performance.now() - started,
          wasmMemoryBytes: wasmMemory.buffer.byteLength,
          ...memoryDiagnostics(engine),
          threadCount: engineThreadCount,
          wasmSha256: parallel ? parallelWasmSha256 : wasmSha256,
          wasmEngineKind: parallel ? 'parallel' : 'async',
          ...globalThis.__xivcaSearchStore.metrics }
        });
      };
      const result = JSON.parse(await engine.solve_exact_observed_json(input, reportTelemetry));
      phase = 'close';
      await closeSearchStore(message.requestId);
      self.postMessage({ type: 'search-result', requestId: message.requestId, result });
      return;
    }
  } catch (error) {
    const diagnostics = { phase, storage: { ...globalThis.__xivcaSearchStore?.metrics },
      stack: String(error?.stack || '') };
    if (activeEngine) {
      try { diagnostics.memory = memoryDiagnostics(activeEngine); }
      catch { /* Preserve the original failure even when diagnostics cannot allocate. */ }
    }
    try { await closeSearchStore(message.requestId); } catch (cleanupError) {
      diagnostics.cleanupError = String(cleanupError?.message || cleanupError);
      console.error('探索用一時データの削除に失敗しました', cleanupError);
    }
    self.postMessage({ type: 'error', requestId: message.requestId, message: String(error?.message || error),
      errorName: error?.name || 'Error', diagnostics, errorStack: String(error?.stack || '') });
  } finally {
    if (message.type === 'solve') {
      solving = false;
      delete globalThis.__xivcaWorkProgress;
    }
  }
});
