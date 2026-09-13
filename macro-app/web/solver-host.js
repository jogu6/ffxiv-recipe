import { selectSolverWorkerCount } from './worker-policy.js';
import { SHARED_STORAGE_BYTES } from './shared-search-storage.js';

// Supervision stays responsive while the solver and its Rayon children wait
// for page faults. The existing solver-worker remains usable on its own.
let compute, storageWorker, storage, failurePort, failureBroadcast, databaseName;
let prepared, active, failing = false;
let disposed = false, shutdownPromise;
let storageRequest, storageFailure;
const parallel = globalThis.crossOriginIsolated && typeof SharedArrayBuffer === 'function';
const threadError = parallel ? '' : 'この実行環境ではWASMの共有メモリを利用できません';
let liveProgressTimer, liveProgressMemory, liveProgressAddress, liveActivityAddress, lastLiveNodes = 0, lastLiveActivity = 0;
function stopLiveProgress() {
  clearInterval(liveProgressTimer);
  liveProgressTimer = undefined;
  liveProgressMemory = undefined;
  lastLiveNodes = 0;
  lastLiveActivity = 0;
}
function startLiveProgress(data) {
  stopLiveProgress();
  liveProgressMemory = data.memory;
  liveProgressAddress = data.address;
  liveActivityAddress = data.activityAddress;
  liveProgressTimer = setInterval(() => {
    if (!active || failing || disposed || !liveProgressMemory) return;
    // Recreate the view after memory.grow; it must not retain an old buffer.
    const searchNodes = Atomics.load(new Uint32Array(liveProgressMemory.buffer, liveProgressAddress, 1), 0);
    const activityCount = Atomics.load(new Uint32Array(liveProgressMemory.buffer, liveActivityAddress, 1), 0);
    if (searchNodes <= lastLiveNodes && activityCount <= lastLiveActivity) return;
    lastLiveNodes = Math.max(lastLiveNodes, searchNodes);
    lastLiveActivity = Math.max(lastLiveActivity, activityCount);
    self.postMessage({ type: 'search-progress', requestId: active.requestId, searchNodes: lastLiveNodes, activityCount });
  }, 500);
}
function storageCall(type) {
  return new Promise((resolve, reject) => {
    storageRequest = { type, resolve, reject };
    storageWorker.postMessage({ type, buffer: storage.buffer });
  });
}
async function deleteSearchStorage(name) {
  if (!name) return;
  if (name.startsWith('opfs:')) {
    try {
      const root = await navigator.storage.getDirectory();
      const prefix = name.slice(5);
      for (const delay of [0, 100, 500]) {
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        let failed = false;
        for await (const fileName of root.keys()) {
          if (fileName !== prefix && !fileName.startsWith(`${prefix}-`)) continue;
          try { await root.removeEntry(fileName); } catch { failed = true; }
        }
        if (!failed) return;
      }
    } catch {}
    return;
  }
  await new Promise(resolve => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = request.onerror = request.onblocked = resolve;
  });
}
function shutdown() {
  if (shutdownPromise) return shutdownPromise;
  failing = true;
  stopLiveProgress();
  compute?.terminate();
  compute = undefined;
  prepared = undefined;
  failurePort?.close();
  failureBroadcast?.close();
  storageRequest?.reject(new Error('マクロ生成を中断しました'));
  storageRequest = undefined;
  shutdownPromise = (async () => {
    if (storageWorker) {
      let timeout;
      try {
        await Promise.race([storageCall('close'), new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('一時保存の終了待ちが長すぎます')), 3000);
        })]);
      } catch {} finally { clearTimeout(timeout); }
      storageWorker.terminate();
      storageWorker = undefined;
    }
    await deleteSearchStorage(databaseName);
    databaseName = undefined;
  })();
  return shutdownPromise;
}
async function fail(error) {
  if (failing) return;
  const requestId = active?.requestId;
  await shutdown();
  active = undefined;
  // Compute can observe the shared failure flag before storage has finished
  // closing. Prefer the original I/O diagnosis received during shutdown.
  const cause = storageFailure || error;
  self.postMessage({ type: 'error', requestId, message: String(cause?.message || cause),
    errorName: cause?.errorName || cause?.name || 'Error', diagnostics: cause?.diagnostics,
    errorStack: String(cause?.errorStack || cause?.stack || '') });
}
function prepare(message) {
  if (prepared) return prepared;
  prepared = new Promise((resolve, reject) => {
    const threadCount = parallel ? selectSolverWorkerCount(navigator) : 1;
    compute = new Worker('./solver-worker.js', { type: 'module' });
    const channel = new MessageChannel();
    failurePort = channel.port1;
    failurePort.onmessage = ({ data }) => { reject(new Error(data.message)); void fail(data); };
    if (parallel) {
      const failureChannel = `xivca-threads-${crypto.randomUUID()}`;
      failureBroadcast = new BroadcastChannel(failureChannel);
      failureBroadcast.onmessage = ({ data }) => { reject(new Error(data.message)); void fail(data); };
      storage = { buffer: new SharedArrayBuffer(SHARED_STORAGE_BYTES), module: new URL('./shared-search-storage.js', import.meta.url).href, failureChannel };
      storageWorker = new Worker('./storage-worker.js', { type: 'module' });
      storageWorker.onmessage = ({ data }) => {
        if (data.type === 'storage-created') {
          databaseName = data.databaseName;
          self.postMessage({ ...data, requestId: active?.requestId });
          return;
        }
        if (data.type === 'storage-open') databaseName = data.databaseName;
        if (data.type === 'storage-progress') {
          self.postMessage({ ...data, requestId: active?.requestId });
          return;
        }
        if (data.type === 'error') {
          if (!storageFailure || storageFailure.diagnostics?.phase === 'close') storageFailure = data;
          storageRequest?.reject(new Error(data.message));
          storageRequest = undefined;
          void fail(data);
        } else if ((storageRequest?.type === 'open' && data.type === 'storage-open')
          || (storageRequest?.type === 'close' && data.type === 'closed')) {
          storageRequest?.resolve(data);
          storageRequest = undefined;
        }
      };
      storageWorker.onerror = event => { storageRequest?.reject(new Error(event.message)); storageRequest = undefined; void fail(event); };
    }
    compute.onerror = event => { reject(new Error(event.message)); void fail(event); };
    compute.onmessage = async ({ data }) => {
      if (failing) return;
      if (data.type === 'live-progress-memory') { startLiveProgress(data); return; }
      if (data.type === 'telemetry') lastLiveNodes = Math.max(lastLiveNodes, data.snapshot?.searchNodes || 0);
      if (data.type === 'ready') { resolve(data); return; }
      if (data.type === 'storage-open') databaseName = data.databaseName;
      if (data.type === 'error') { reject(new Error(data.message)); void fail(data); return; }
      if (data.type === 'search-result') {
        stopLiveProgress();
        try { if (storageWorker) await storageCall('close'); }
        catch (error) { void fail(error); return; }
        active = undefined;
        databaseName = undefined;
      }
      self.postMessage(data);
    };
    compute.postMessage({ type: 'prepare', requestId: message.requestId, threadCount, threadError,
      storage, failurePort: channel.port2 }, [channel.port2]);
  });
  return prepared;
}
self.onmessage = async ({ data: message }) => {
  if (message?.type === 'dispose') {
    disposed = true;
    await shutdown();
    self.postMessage({ type: 'disposed' });
    self.close();
    return;
  }
  if (disposed) return;
  if (!['prepare', 'solve'].includes(message?.type)) return;
  if (active) {
    self.postMessage({ type: 'error', requestId: message.requestId, message: 'マクロ生成は既に実行中です' });
    return;
  }
  active = message;
  storageFailure = undefined;
  failing = false;
  shutdownPromise = undefined;
  try {
    const ready = await prepare(message);
    if (disposed) return;
    if (message.type === 'prepare') {
      active = undefined;
      self.postMessage({ ...ready, requestId: message.requestId });
      return;
    }
    if (parallel) {
      new Int32Array(storage.buffer).fill(0);
      const opened = await storageCall('open');
      if (disposed) return;
      self.postMessage({ ...opened, requestId: message.requestId });
    }
    compute.postMessage({ ...message, storage, cacheBytes: globalThis.__xivcaStorageCacheBytes ?? 0 });
  } catch (error) { void fail(error); }
};
