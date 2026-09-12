const { test, expect } = require('@playwright/test');

const input = {
  crafterLevel: 100, craftsmanship: 5655, control: 5399, maxCp: 100,
  maxDurability: 40, maxProgress: 500, maxQuality: 1000, targetQuality: 1000,
  recipeLevel: { jobLevel: 100, progressDivisor: 170, qualityDivisor: 150, progressModifier: 90, qualityModifier: 75 },
  materialQualityPercent: 0, ingredients: [], manipulationAvailable: true,
  heartAndSoulAvailable: false, quickInnovationAvailable: false, trainedEyeAvailable: false,
  adversarial: true, stellarSteadyHandCharges: 0
};
async function openRunner(page) {
  await page.route('**/parallel-runner.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>並列探索試験</title>',
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } }));
  await page.route('**/solver-host.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: "Object.defineProperty(navigator, 'hardwareConcurrency', { value: 8 });\n" + await response.text() });
  });
  await page.goto('/parallel-runner.html');
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
}
async function solve(page, file = 'solver-host.js', stopAtStorage = false, requestInput = input) {
  return page.evaluate(async ({ input, file, stopAtStorage }) => {
    const worker = new Worker(`/macro-app/web/${file}`, { type: 'module' });
    let storage, ready;
    const snapshots = [];
    try {
      return await new Promise((resolve, reject) => {
        worker.onerror = event => reject(new Error(event.message));
        worker.onmessage = ({ data }) => {
          if (data.type === 'ready') { ready = data; worker.postMessage({ type: 'solve', requestId: 'solve', input }); }
          if (data.type === 'storage-open') {
            storage = data;
            if (stopAtStorage) resolve({ storage });
          }
          if (data.type === 'telemetry') snapshots.push(data.snapshot);
          if (data.type === 'error') resolve({ error: data.message, errorStack: data.errorStack, snapshots, storage, ready });
          if (data.type === 'search-result') resolve({ result: data.result, storage, snapshots, ready });
        };
        worker.postMessage({ type: 'prepare', requestId: 'prepare' });
      });
    } finally {
      worker.terminate();
      if (stopAtStorage && storage) await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(storage.databaseName);
        request.onsuccess = resolve; request.onerror = () => reject(request.error);
      });
    }
  }, { input: requestInput, file, stopAtStorage });
}
async function expectDeleted(page, result) {
  expect(result.storage?.databaseName).toBeTruthy();
  expect(await page.evaluate(async name => (await indexedDB.databases()).some(db => db.name === name), result.storage.databaseName)).toBe(false);
}
test('並列探索は退避・読み戻し後も単独探索と同じ結果になり一時保存を削除する', async ({ page }) => {
  test.setTimeout(180000);
  await openRunner(page);
  const serial = await solve(page, 'solver-worker.js');
  expect(serial.error).toBeUndefined();
  const normal = await solve(page);
  expect(normal.error).toBeUndefined();
  expect(normal.ready.threadCount).toBe(4);
  expect(normal.ready.activeThreadCount).toBe(4);
  expect(normal.result).toEqual(serial.result);
  await expectDeleted(page, normal);
  await page.route('**/solver-worker.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: 'globalThis.__xivcaStorageCacheBytes = 8192;\n' + await response.text() });
  });
  await page.route('**/search-storage.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('const blockLimit = 128;', 'const blockLimit = 0;').replace('pending.size >= 128', 'pending.size >= 1') });
  });
  const paged = await solve(page);
  expect(paged.error).toBeUndefined();
  expect(paged.ready.threadCount).toBe(4);
  expect(paged.ready.activeThreadCount).toBe(4);
  expect(paged.result).toEqual(normal.result);
  expect(paged.snapshots.some(sample => sample.storagePageReads > 0 && sample.storageReadTransactions > 0)).toBe(true);
  expect(paged.snapshots.some(sample => sample.storagePageWrites > 0 && sample.storageWriteTransactions > 0)).toBe(true);
  await expectDeleted(page, paged);
  console.log(JSON.stringify({ parallelResult: normal.result, memoryBytes: Math.max(...normal.snapshots.map(sample => sample.wasmMemoryBytes)), paged: paged.snapshots.at(-1) }));
});
for (const operation of ['read', 'write']) {
  test(`並列探索の一時保存${operation}が失敗しても待機を解消して削除する`, async ({ page }) => {
    test.setTimeout(60000);
    await openRunner(page);
    await page.route('**/solver-worker.js', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: 'globalThis.__xivcaStorageCacheBytes = 8192;\n' + await response.text() });
    });
    await page.route('**/search-storage.js', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replace(`${operation}(at, bytes) {`, `${operation}(at, bytes) { return Promise.reject(new Error('検証用の保存障害'));`) });
    });
    const result = await solve(page);
    expect(result.error).toContain('検証用の保存障害');
    await expectDeleted(page, result);
  });
}
test('並列探索を中断して一時保存を削除した後に再生成できる', async ({ page }) => {
  test.setTimeout(60000);
  await openRunner(page);
  const cancelled = await solve(page, 'solver-host.js', true);
  await expectDeleted(page, cancelled);
  const resumed = await solve(page);
  expect(resumed.error).toBeUndefined();
  expect(resumed.result.actions.length).toBeGreaterThan(0);
  await expectDeleted(page, resumed);
});

test('並列WASMの確保上限に達しても退避で回復して完走する', async ({ page }) => {
  test.setTimeout(60000);
  await openRunner(page);
  const requestInput = { ...input, maxCp: 200, maxQuality: 3000, targetQuality: 3000 };
  const baseline = await solve(page, 'solver-host.js', false, requestInput);
  expect(baseline.error).toBeUndefined();
  const baselinePages = Math.max(...baseline.snapshots.map(sample => sample.wasmMemoryBytes)) / 65536;
  console.log(JSON.stringify({ baselinePages, baselineResult: baseline.result, residentBytes: baseline.snapshots.at(-1).storageResidentBytes }));
  const maximum = Number(process.env.MACRO_TEST_WASM_PAGES || baselinePages - 1);
  await page.route('**/solver-worker.js', async route => {
    const response = await route.fetch();
    const prefix = `const OriginalMemory = WebAssembly.Memory;
      WebAssembly.Memory = class extends OriginalMemory {
        constructor(options) { super({ ...options, maximum: Math.min(options.maximum ?? 65536, ${maximum}) }); }
      };\n`;
    await route.fulfill({ response, body: prefix + await response.text() });
  });
  await page.route('**/search-storage.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('const blockLimit = 128;', 'const blockLimit = 0;').replace('pending.size >= 128', 'pending.size >= 1') });
  });
  const result = await solve(page, 'solver-host.js', false, requestInput);
  console.log(JSON.stringify({ limitedMemoryPages: maximum, error: result.error, errorStack: result.errorStack, final: result.snapshots.at(-1), result: result.result }));
  expect(result.error).toBeUndefined();
  expect(result.snapshots.some(sample => sample.storagePressureEvents > 0)).toBe(true);
  expect(result.snapshots.some(sample => sample.storageReadTransactions > 0 && sample.storageWriteTransactions > 0)).toBe(true);
  expect(Math.max(...result.snapshots.map(sample => sample.wasmMemoryBytes))).toBeLessThanOrEqual(maximum * 65536);
  expect(result.result).toEqual(baseline.result);
  await expectDeleted(page, result);
});
