const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const input = {
  crafterLevel: 100, craftsmanship: 5655, control: 5399, maxCp: 200,
  maxDurability: 40, maxProgress: 500, maxQuality: 3000, targetQuality: 3000,
  recipeLevel: { jobLevel: 100, progressDivisor: 170, qualityDivisor: 150, progressModifier: 90, qualityModifier: 75 },
  materialQualityPercent: 0, ingredients: [], manipulationAvailable: true,
  heartAndSoulAvailable: false, quickInnovationAvailable: false, trainedEyeAvailable: false,
  adversarial: true, stellarSteadyHandCharges: 0
};

test('制限下の探索を通常探索と比較して結果・時間・退避・確保要求を記録する', async ({ page }, testInfo) => {
  test.setTimeout(300000);
  const sourceRoot = process.env.MACRO_TEST_ASSET_ROOT || 'site/macro-app';
  const results = [];
  page.on('console', message => { if (message.type() === 'error') console.log(message.text()); });
  page.on('requestfailed', request => console.log(request.url(), request.failure()));
  let limit = 65536, cache = 0;
  await page.route('**/macro-app/**', async route => {
    const relative = new URL(route.request().url()).pathname.split('/macro-app/')[1];
    const file = path.resolve(sourceRoot, relative);
    let body = fs.readFileSync(file);
    if (relative === 'web/solver-worker.js') body = Buffer.from(`
      globalThis.__xivcaWasmMaximumPages = ${limit};
      globalThis.__xivcaStorageCacheBytes = ${cache};
      const OriginalMemory = WebAssembly.Memory;
      WebAssembly.Memory = class extends OriginalMemory {
        constructor(options) { super({ ...options, maximum: Math.min(options.maximum ?? 65536, ${limit}) }); }
      };
    ` + body.toString());
    if (relative === 'web/opfs-search-storage.js') body = Buffer.from('globalThis.__xivcaSearchCapacityBytes = 64 * 1024 * 1024;\n' + body.toString());
    await route.fulfill({ headers: { 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin' }, body, contentType: relative.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
  });
  await page.goto('/');
  for (const limited of [false, true]) {
    limit = limited ? 511 : 65536;
    cache = limited ? 256 * 1024 : 0;
    const result = await page.evaluate(input => new Promise((resolve, reject) => {
      const worker = new Worker('/macro-app/web/solver-worker.js', { type: 'module' });
      const output = { samples: [], events: [] };
      const start = performance.now();
      worker.onerror = event => { worker.terminate(); reject(new Error(event.message)); };
      worker.onmessage = ({ data }) => {
        if (data.type === 'telemetry') output.samples.push(data.snapshot);
        if (data.type === 'storage-progress') output.events.push(data.metrics);
        if (data.type === 'error' || data.type === 'search-result') {
          output[data.type === 'error' ? 'error' : 'result'] = data.type === 'error' ? data : data.result;
          output.elapsedMs = performance.now() - start;
          worker.terminate(); resolve(output);
        }
      };
      worker.postMessage({ type: 'solve', requestId: 'constrained', input });
    }), input);
    results.push({ limited, ...result });
    fs.writeFileSync(testInfo.outputPath('comparison.json'), JSON.stringify(results, null, 2));
    expect(result.error).toBeUndefined();
    const final = result.samples.at(-1);
    expect(final.stage).toBe('complete');
    expect(result.result.actions).toHaveLength(6);
    expect(result.result.duration).toBe(17);
    expect(result.events.at(-1).storageClosed).toBe(true);
    if (limited) {
      expect(result.result).toEqual(results[0].result);
      expect(final.storagePageReads).toBeGreaterThan(0);
      expect(final.storagePageWrites).toBeGreaterThan(0);
      expect(Math.max(...result.samples.map(s => s.wasmMemoryBytes))).toBeLessThanOrEqual(limit * 65536);
      if (final.wasmMemoryMaximumBytes) {
        expect(final.wasmMemoryMaximumBytes).toBe(limit * 65536);
        expect(final.wasmMemoryGrowFailures).toBe(0);
        for (const event of result.samples.flatMap(s => s.wasmMemoryEvents || [])) {
          if (event.outcome !== 0) expect(event.currentPages + event.requestedPages).toBeLessThanOrEqual(event.maximumPages);
        }
      }
    }
    console.log(JSON.stringify({ constrained: limited, elapsedMs: result.elapsedMs,
      nodes: final.searchNodes, memory: final.wasmMemoryBytes, failures: final.wasmMemoryGrowFailures,
      avoided: final.wasmMemoryLimitAvoided, reads: final.storagePageReads, writes: final.storagePageWrites,
      kind: final.wasmEngineKind }));
  }
});


test('通知追加前後の単独生成を同じ条件で交互に比較する', async ({ page }, testInfo) => {
  test.skip(!process.env.MACRO_TEST_PROGRESS_BASELINE, '比較する旧成果物が指定された場合だけ実行する');
  test.setTimeout(240000);
  let assetRoot;
  await page.route('**/macro-app/**', route => {
    const relative = new URL(route.request().url()).pathname.split('/macro-app/')[1];
    let body = fs.readFileSync(path.join(assetRoot, relative));
    if (relative === 'web/opfs-search-storage.js') body = Buffer.from('globalThis.__xivcaSearchCapacityBytes = 64 * 1024 * 1024;\n' + body.toString());
    return route.fulfill({ body,
      contentType: relative.endsWith('.wasm') ? 'application/wasm' : 'text/javascript',
      headers: { 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin' } });
  });
  await page.goto('/');
  const comparisons = [];
  const requestInput = { ...input, maxCp: 400, maxDurability: 70, maxProgress: 4000, maxQuality: 7000, targetQuality: 7000 };
  for (const current of [false, true, true, false]) {
    assetRoot = current ? 'site/macro-app' : process.env.MACRO_TEST_PROGRESS_BASELINE;
    const result = await page.evaluate(input => new Promise((resolve, reject) => {
      const worker = new Worker('/macro-app/web/solver-worker.js', { type: 'module' });
      const output = { workMessages: 0 };
      worker.onerror = event => { worker.terminate(); reject(new Error(event.message)); };
      worker.onmessage = ({ data }) => {
        if (data.type === 'telemetry') output.final = data.snapshot;
        if (data.type === 'work-progress') output.workMessages++;
        if (data.type === 'search-result' || data.type === 'error') {
          output[data.type === 'error' ? 'error' : 'result'] = data.type === 'error' ? data.message : data.result;
          worker.terminate(); resolve(output);
        }
      };
      worker.postMessage({ type: 'solve', requestId: 'progress-benchmark', input });
    }), requestInput);
    expect(result.error).toBeUndefined();
    expect(result.result.actions).toHaveLength(13);
    expect(result.final.storagePageWrites).toBe(0);
    if (current) expect(result.workMessages).toBeGreaterThan(0);
    if (comparisons.length) expect(result.result).toEqual(comparisons[0].result);
    comparisons.push({ current, ...result });
    fs.writeFileSync(testInfo.outputPath('progress-overhead.json'), JSON.stringify(comparisons, null, 2));
    console.log(JSON.stringify({ current, elapsedMs: result.final.workerElapsedMs, nodes: result.final.searchNodes, workMessages: result.workMessages }));
  }
});
