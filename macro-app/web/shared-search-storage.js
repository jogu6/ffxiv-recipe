// A single bounded RPC slot serializes page I/O across the Rayon pool. The
// storage worker remains asynchronous; only compute workers wait on Atomics.
export const SHARED_STORAGE_BYTES = 64 + 4096;
export function createSharedSearchStore(buffer) {
  const control = new Int32Array(buffer, 0, 16);
  const address = new Float64Array(buffer, 16, 1);
  const page = new Uint8Array(buffer, 64);
  function checkFailure() {
    if (Atomics.load(control, 3)) {
      throw new Error(new TextDecoder().decode(page.subarray(0, control[7])) || '探索用の一時保存を継続できません');
    }
  }
  function transfer(command, at, bytes) {
    if (bytes.length > page.length) throw new Error('探索ページが転送領域を超えました');
    while (Atomics.compareExchange(control, 0, 0, 1) !== 0) {
      checkFailure();
      Atomics.wait(control, 0, 1);
    }
    try {
      checkFailure();
      address[0] = at;
      control[6] = bytes.length;
      if (command === 2) page.set(bytes);
      Atomics.store(control, 1, command);
      Atomics.notify(control, 1);
      while (Atomics.load(control, 1) !== 0) {
        checkFailure();
        Atomics.wait(control, 1, command);
      }
      checkFailure();
      if (command === 1) bytes.set(page.subarray(0, bytes.length));
    } finally {
      Atomics.store(control, 0, 0);
      Atomics.notify(control, 0);
    }
  }
  return {
    read: (at, bytes) => transfer(1, at, bytes),
    write: (at, bytes) => transfer(2, at, bytes),
    get metrics() {
      return { storageReadTransactions: Atomics.load(control, 8), storageWriteTransactions: Atomics.load(control, 9),
        storageReadMs: Atomics.load(control, 10), storageWriteMs: Atomics.load(control, 11) };
    }
  };
}
