const { test: base, expect } = require('@playwright/test');
// Normal disk-backed profiles, not incognito's smaller in-memory quota.
const test = base.extend({
  context: async ({ playwright, browserName, contextOptions, baseURL, viewport }, use, testInfo) => {
    if (browserName === 'webkit' && process.platform === 'win32') {
      const browser = await playwright.webkit.launch();
      const context = await browser.newContext({ ...contextOptions, baseURL, viewport, serviceWorkers: 'block' });
      try { await use(context); } finally { await browser.close(); }
      return;
    }
    const context = await playwright[browserName].launchPersistentContext(testInfo.outputPath('profile'), {
      ...contextOptions, baseURL, viewport, headless: true, serviceWorkers: 'block'
    });
    try { await use(context); } finally { await context.close(); }
  }
});

async function opfsNames(page) {
  return page.evaluate(async () => {
    if (!navigator.storage?.getDirectory) return [];
    const root = await navigator.storage.getDirectory();
    const names = [];
    for await (const name of root.keys()) names.push(name);
    return names.filter(name => name.startsWith('xivca-search-'));
  });
}

test('ChromiumとWebKitで一時領域を確保してページを欠落なく読み戻す', async ({ page, browserName }) => {
  await page.route('**/profiling.js?opfs-worker', async route => {
    await route.fulfill({ contentType: 'text/javascript',
      headers: { 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin' }, body: `
      import { openIndexedSearchStore } from '/macro-app/web/search-storage.js';
      const store = await openIndexedSearchStore();
      const gib = 1024 * 1024 * 1024;
      const safeBytes = 3 * gib;
      const firstStarted = performance.now();
      await store.reserve(safeBytes);
      const firstReserveMs = performance.now() - firstStarted;
      // Repeated calls must do no additional allocation.
      await store.reserve(safeBytes);
      const expected = new Uint8Array(4096);
      for (let index = 0; index < expected.length; index++) expected[index] = index % 251;
      const blank = new Uint8Array(4096);
      for (let index = 0; index < 127; index++) await store.write(index * 4096, blank);
      await store.write(safeBytes - expected.byteLength, expected);
      const actual = new Uint8Array(expected.length);
      await store.read(safeBytes - actual.byteLength, actual);
      const matches = actual.every((value, index) => value === expected[index]);
      let limitError = '';
      try { await store.reserve(3.5 * gib); } catch (error) { limitError = error.message; }
      const detail = { name: store.databaseName, matches, firstReserveMs,
        safeBytes, limitError,
        metrics: { ...store.metrics } };
      await store.close();
      postMessage(detail);
    ` });
  });
  await page.goto('/macro-app/web/index.html?siteRoot=../..');
  console.log(JSON.stringify({ browserName, estimate: await page.evaluate(() => navigator.storage?.estimate?.()) }));
  const result = await page.evaluate(async () => new Promise((resolve, reject) => {
    const worker = new Worker('/macro-app/web/profiling.js?opfs-worker', { type: 'module' });
    worker.onmessage = ({ data }) => { worker.terminate(); resolve(data); };
    worker.onerror = event => { worker.terminate(); reject(new Error(event.message)); };
  }));
  expect(result.matches).toBe(true);
  if (browserName === 'chromium') expect(result.metrics.storageBackend).toBe('opfs');
  else expect(['opfs', 'indexeddb']).toContain(result.metrics.storageBackend);
  expect(result.metrics.storageReservedBytes).toBe(3 * 1024 * 1024 * 1024);
  expect(result.metrics.storageReserveTransactions).toBe(1);
  expect(result.limitError).toContain('拡張できません');
  if (result.metrics.storageBackend === 'opfs') {
    expect((await opfsNames(page)).some(name => name.startsWith(`${result.name.slice(5)}-`))).toBe(false);
    expect(result.metrics.storageSegmentCount).toBe(49);
  }
  console.log(JSON.stringify({ browserName, backend: result.metrics.storageBackend,
    firstReserveMs: result.firstReserveMs }));
});

test('ChromiumとWebKitでWASM探索の退避と読み戻しを完走する', async ({ page, browserName }) => {
  test.setTimeout(180000);
  await page.route('**/search-storage.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text())
      .replace('const blockLimit = 128;', 'const blockLimit = 0;')
      .replace('pending.size >= 128', 'pending.size >= 1') });
  });
  await page.route('**/solver-worker.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `globalThis.__xivcaStorageCacheBytes = 8192;
      globalThis.__xivcaSearchCapacityBytes = 64 * 1024 * 1024;
      ${await response.text()}` });
  });
  await page.goto('/macro-app/web/index.html?siteRoot=../..');
  const result = await page.evaluate(async () => new Promise((resolve, reject) => {
    const worker = new Worker('./solver-worker.js', { type: 'module' });
    const snapshots = [];
    const storageEvents = [];
    let storage;
    worker.onerror = event => { worker.terminate(); reject(new Error(event.message)); };
    worker.onmessage = ({ data }) => {
      if (data.type === 'storage-open') storage = data;
      if (data.type === 'storage-progress') storageEvents.push(data.metrics);
      if (data.type === 'telemetry') snapshots.push(data.snapshot);
      if (data.type === 'error') { worker.terminate(); reject(new Error(data.message)); }
      if (data.type === 'search-result') {
        worker.terminate();
        resolve({ result: data.result, snapshots, storageEvents, storage });
      }
    };
    worker.postMessage({ type: 'solve', requestId: 'solve', input: {
      crafterLevel: 100, craftsmanship: 5655, control: 5399, maxCp: 100,
      maxDurability: 40, maxProgress: 500, maxQuality: 1000, targetQuality: 1000,
      recipeLevel: { jobLevel: 100, progressDivisor: 170, qualityDivisor: 150,
        progressModifier: 90, qualityModifier: 75 },
      materialQualityPercent: 0, ingredients: [], manipulationAvailable: true,
      heartAndSoulAvailable: false, quickInnovationAvailable: false,
      trainedEyeAvailable: false, adversarial: true, stellarSteadyHandCharges: 0
    } });
  }));
  expect(result.result.actions.length).toBeGreaterThan(0);
  expect(result.snapshots.some(sample => sample.storagePageWrites > 0)).toBe(true);
  expect(result.snapshots.some(sample => sample.storagePageReads > 0)).toBe(true);
  expect(result.snapshots.some(sample => sample.storageDiskUsedBytes > 0
    && sample.storageDiskUsedBytes <= sample.storageDiskHighWaterBytes
    && sample.storageDiskHighWaterBytes <= sample.storageDiskCapacityBytes)).toBe(true);
  expect(result.storageEvents.some(metrics => metrics.storageClosed === true)).toBe(true);
  expect(['opfs', 'indexeddb']).toContain(result.storage.metrics.storageBackend);
  expect(result.storageEvents.some(metrics => metrics.storageWrittenBytes > 0)).toBe(true);
  const final = result.snapshots.at(-1);
  if (result.storage.metrics.storageBackend === 'opfs') {
    expect(final.storageSolverWaitCount).toBe(0);
    expect(final.storageSolverWaitMs).toBe(0);
  } else {
    expect(final.storageSolverWaitCount).toBeGreaterThan(0);
    expect(final.storageSolverWaitMs).toBeGreaterThan(0);
    expect(final.storageSolverMaxWaitMs).toBeLessThanOrEqual(final.storageSolverWaitMs);
  }
});

test('OPFS並列探索は準備中の中止・削除・再生成とページ入出力を完了する', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Windows WebKitのOPFSは未提供。Safariの保存機能はmacOSで別途検証する');
  test.setTimeout(60000);
  await page.route('**/opfs-runner.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>OPFS並列試験</title>',
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } }));
  await page.route('**/opfs-search-storage.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: 'globalThis.__xivcaSearchCapacityBytes = 64 * 1024 * 1024;\n'
      + (await response.text()).replace('async reserve(requestedBytes) {',
        'async reserve(requestedBytes) { await new Promise(resolve => setTimeout(resolve, 250));') });
  });
  await page.route('**/solver-worker.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: 'globalThis.__xivcaStorageCacheBytes = 8192;\n' + await response.text() });
  });
  await page.route('**/solver-host.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: "Object.defineProperty(navigator, 'hardwareConcurrency', { value: 8 });\n" + await response.text() });
  });
  await page.goto('/opfs-runner.html');
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  for (const cancel of [true, false]) {
    const result = await page.evaluate(async cancel => {
      const worker = new Worker('/macro-app/web/solver-host.js', { type: 'module' });
      const output = { snapshots: [] };
      try {
        return await new Promise((resolve, reject) => {
          worker.onerror = event => reject(new Error(event.message));
          worker.onmessage = ({ data }) => {
            if (data.type === 'storage-created') {
              output.name = data.databaseName;
              if (cancel) worker.postMessage({ type: 'dispose' });
            }
            if (data.type === 'storage-open') output.backend = data.metrics.storageBackend;
            if (data.type === 'telemetry') output.snapshots.push(data.snapshot);
            if (data.type === 'error') reject(new Error(data.message));
            if (data.type === 'search-result') { output.result = data.result; worker.postMessage({ type: 'dispose' }); }
            if (data.type === 'disposed') resolve(output);
          };
          worker.postMessage({ type: 'solve', requestId: 'test', input: {
            crafterLevel: 100, craftsmanship: 5655, control: 5399, maxCp: 100,
            maxDurability: 40, maxProgress: 500, maxQuality: 1000, targetQuality: 1000,
            recipeLevel: { jobLevel: 100, progressDivisor: 170, qualityDivisor: 150, progressModifier: 90, qualityModifier: 75 },
            materialQualityPercent: 0, ingredients: [], manipulationAvailable: true,
            heartAndSoulAvailable: false, quickInnovationAvailable: false, trainedEyeAvailable: false,
            adversarial: true, stellarSteadyHandCharges: 0
          } });
        });
      } finally { worker.terminate(); }
    }, cancel);
    expect(result.name).toMatch(/^opfs:/);
    expect(await opfsNames(page)).toEqual([]);
    if (cancel) expect(result.result).toBeUndefined();
    else {
      expect(result.backend).toBe('opfs');
      expect(result.result.actions.length).toBeGreaterThan(0);
      expect(result.snapshots.some(sample => sample.threadCount === 5 && sample.storagePageReads > 0 && sample.storagePageWrites > 0)).toBe(true);
    }
  }
});
