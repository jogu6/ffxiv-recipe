// Prepended only by the development server for a narrow-window solver worker.
{
  const OriginalMemory = WebAssembly.Memory;
  globalThis.__xivcaWasmMaximumPages = 16384;
  WebAssembly.Memory = class extends OriginalMemory {
    constructor(options) { super({ ...options, maximum: Math.min(options.maximum ?? 16384, 16384) }); }
  };
  // Leave half of the 1 GiB WASM limit for indexes, work arrays and the engine.
  globalThis.__xivcaStorageCacheBytes = 512 * 1024 * 1024;
  // Compatibility with injection by an already-running development server.
  globalThis.__localMobileTrackStore = store => store;
}
