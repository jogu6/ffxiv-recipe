// Prepended only by the development server for a narrow-window solver worker.
// Cooperative delay between engine timing checkpoints; this is not hardware emulation.
{
  const OriginalMemory = WebAssembly.Memory;
  const waitBuffer = new Int32Array(new OriginalMemory({ initial: 1, maximum: 1, shared: true }).buffer);
  WebAssembly.Memory = class extends OriginalMemory {
    constructor(options) { super({ ...options, maximum: Math.min(options.maximum ?? 16384, 16384) }); }
  };
  const originalNow = performance.now.bind(performance);
  let active = false;
  let waiting = 0;
  let checkpoint = originalNow();
  let debt = 0;
  globalThis.__localMobileSleepMs = 0;
  self.addEventListener('message', event => {
    if (event.data?.type === 'solve') { active = true; checkpoint = originalNow(); debt = 0; }
  });
  globalThis.__localMobileTrackStore = store => {
    for (const name of ['read', 'write', 'close']) {
      const operation = store[name].bind(store);
      store[name] = (...args) => {
        performance.now();
        const result = operation(...args);
        if (!result || typeof result.then !== 'function') return result;
        waiting++;
        return Promise.resolve(result).finally(() => {
          waiting--;
          checkpoint = originalNow();
        });
      };
    }
    return store;
  };
  Object.defineProperty(performance, 'now', { value() {
    const now = originalNow();
    if (active && waiting === 0) {
      debt += (now - checkpoint) * 3;
      if (debt >= 5) {
        // Bound each pause so cancellation via Worker.terminate stays responsive.
        const delay = Math.min(debt, 100);
        const before = originalNow();
        Atomics.wait(waitBuffer, 0, 0, delay);
        const slept = originalNow() - before;
        globalThis.__localMobileSleepMs += slept;
        // Keep oversleep as credit; OS timer rounding must not compound the slowdown.
        debt -= slept;
      }
    }
    checkpoint = originalNow();
    return checkpoint;
  } });
}
