import { selectSolverWorkerCount } from './worker-policy.js';
import { SHARED_STORAGE_BYTES } from './shared-search-storage.js';

// Supervision stays responsive while the solver and its Rayon children wait
// for page faults. The existing solver-worker remains usable on its own.
let compute, storageWorker, storage, failurePort, failureBroadcast, databaseName;
let prepared, active, failing = false;
let storageRequest;
const parallel = globalThis.crossOriginIsolated && typeof SharedArrayBuffer === 'function';
const threadError = parallel ? '' : 'この実行環境ではWASMの共有メモリを利用できません';
function storageCall(type) {
  return new Promise((resolve, reject) => {
    storageRequest = { resolve, reject };
    storageWorker.postMessage({ type, buffer: storage.buffer });
  });
}
async function fail(error) {
  if (failing) return;
  failing = true;
  compute?.terminate();
  compute = undefined;
  prepared = undefined;
  failurePort?.close();
  failureBroadcast?.close();
  storageWorker?.terminate();
  storageWorker = undefined;
  if (databaseName) await new Promise(resolve => {
    const request = indexedDB.deleteDatabase(databaseName);
    request.onsuccess = request.onerror = resolve;
  });
  databaseName = undefined;
  const requestId = active?.requestId;
  active = undefined;
  self.postMessage({ type: 'error', requestId, message: String(error?.message || error),
    errorStack: String(error?.errorStack || error?.stack || '') });
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
        if (data.type === 'storage-open') databaseName = data.databaseName;
        if (data.type === 'error') {
          storageRequest?.reject(new Error(data.message));
          storageRequest = undefined;
          void fail(data);
        } else {
          storageRequest?.resolve(data);
          storageRequest = undefined;
        }
      };
      storageWorker.onerror = event => { storageRequest?.reject(new Error(event.message)); storageRequest = undefined; void fail(event); };
    }
    compute.onerror = event => { reject(new Error(event.message)); void fail(event); };
    compute.onmessage = async ({ data }) => {
      if (failing) return;
      if (data.type === 'ready') { resolve(data); return; }
      if (data.type === 'storage-open') databaseName = data.databaseName;
      if (data.type === 'error') { reject(new Error(data.message)); void fail(data); return; }
      if (data.type === 'search-result') {
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
  if (!['prepare', 'solve'].includes(message?.type)) return;
  if (active) {
    self.postMessage({ type: 'error', requestId: message.requestId, message: 'マクロ生成は既に実行中です' });
    return;
  }
  active = message;
  failing = false;
  try {
    const ready = await prepare(message);
    if (message.type === 'prepare') {
      active = undefined;
      self.postMessage({ ...ready, requestId: message.requestId });
      return;
    }
    if (parallel) {
      new Int32Array(storage.buffer).fill(0);
      const opened = await storageCall('open');
      self.postMessage({ ...opened, requestId: message.requestId });
    }
    compute.postMessage({ ...message, storage, cacheBytes: globalThis.__xivcaStorageCacheBytes ?? 0 });
  } catch (error) { void fail(error); }
};
