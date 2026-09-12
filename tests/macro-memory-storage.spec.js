const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const bravePath = 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe';
if (fs.existsSync(bravePath)) test.use({ launchOptions: { executablePath: bravePath } });

for (const backend of ['localhost', 'lan']) {
  test(`小容量で退避して完走し一時保存を削除する（${backend}）`, async ({ page }) => {
    test.setTimeout(180000);
    if (backend === 'lan') {
      await page.route('http://192.0.2.1:4173/**', async route => {
        const url = new URL(route.request().url());
        const response = await route.fetch({ url: `http://127.0.0.1:4173${url.pathname}${url.search}` });
        await route.fulfill({ response });
      });
    }
    await page.route('**/solver-worker.js*', async route => {
      const url = new URL(route.request().url());
      const response = await route.fetch({ url: `http://127.0.0.1:4173${url.pathname}${url.search}` });
      await route.fulfill({ response, body: `WebAssembly.Suspending = undefined; WebAssembly.promising = undefined; globalThis.__xivcaStorageCacheBytes = 8192;\n` + await response.text() });
    });
    // Force real transactions rather than satisfying every fault from JS buffers.
    await page.route('**/search-storage.js', async route => {
      const response = await route.fetch({ url: 'http://127.0.0.1:4173/macro-app/web/search-storage.js' });
      const body = (await response.text()).replace('const blockLimit = 128;', 'const blockLimit = 0;')
        .replace('pending.size >= 128', 'pending.size >= 1');
      await route.fulfill({ response, body });
    });
    const origin = backend === 'lan' ? 'http://192.0.2.1:4173' : '';
    await page.goto(`${origin}/macro-app/web/index.html?siteRoot=../..&recipe=b5cc569f3e4`);
    const result = await page.evaluate(async () => {
      const worker = new Worker('./solver-worker.js', { type: 'module' });
      const snapshots = [];
      let storage;
      try {
        return await new Promise((resolve, reject) => {
          worker.onerror = event => reject(new Error(event.message));
          worker.onmessage = ({ data }) => {
            if (data.type === 'storage-open') storage = data;
            if (data.type === 'telemetry') snapshots.push(data.snapshot);
            if (data.type === 'error') reject(new Error(data.message));
            if (data.type === 'search-result') resolve({ result: data.result, snapshots, storage });
          };
          worker.postMessage({ type: 'solve', input: {
            crafterLevel: 100, craftsmanship: 5655, control: 5399, maxCp: 100,
            maxDurability: 40, maxProgress: 500, maxQuality: 1000, targetQuality: 1000,
            recipeLevel: { jobLevel: 100, progressDivisor: 170, qualityDivisor: 150, progressModifier: 90, qualityModifier: 75 },
            materialQualityPercent: 0, ingredients: [], manipulationAvailable: true,
            heartAndSoulAvailable: false, quickInnovationAvailable: false, trainedEyeAvailable: false,
            adversarial: true, stellarSteadyHandCharges: 0
          } });
        });
      } finally { worker.terminate(); }
    });
    expect(result.result.actions.length).toBeGreaterThan(0);
    expect(result.snapshots.some(sample => sample.storagePageReads > 0)).toBe(true);
    expect(result.snapshots.some(sample => sample.storageReadTransactions > 0)).toBe(true);
    expect(Math.max(...result.snapshots.map(sample => sample.storageResidentBytes || 0))).toBeLessThanOrEqual(16384);
    expect(await page.evaluate(async name => (await indexedDB.databases()).some(db => db.name === name), result.storage.databaseName)).toBe(false);
  });
}

for (const operation of ['read', 'write']) {
  test(`退避の${operation}が失敗したらエラーを返して一時保存を削除する`, async ({ page }) => {
    test.setTimeout(60000);
    await page.route('**/solver-worker.js*', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: 'globalThis.__xivcaStorageCacheBytes = 8192;\n' + await response.text() });
    });
    await page.route('**/search-storage.js', async route => {
      const response = await route.fetch();
      const body = (await response.text()).replace(`${operation}(at, bytes) {`,
        `${operation}(at, bytes) { return Promise.reject(new Error('計測用の保存失敗'));`);
      await route.fulfill({ response, body });
    });
    await page.goto('/macro-app/web/index.html?siteRoot=../..&recipe=b5cc569f3e4');
    const result = await page.evaluate(async () => {
      const worker = new Worker('./solver-worker.js', { type: 'module' });
      let databaseName;
      try {
        return await new Promise((resolve, reject) => {
          worker.onerror = event => reject(new Error(event.message));
          worker.onmessage = ({ data }) => {
            if (data.type === 'storage-open') databaseName = data.databaseName;
            if (data.type === 'error') resolve({ message: data.message, databaseName });
            if (data.type === 'search-result') reject(new Error('保存失敗を成功扱いにしました'));
          };
          worker.postMessage({ type: 'solve', input: {
            crafterLevel: 100, craftsmanship: 5655, control: 5399, maxCp: 100,
            maxDurability: 40, maxProgress: 500, maxQuality: 1000, targetQuality: 1000,
            recipeLevel: { jobLevel: 100, progressDivisor: 170, qualityDivisor: 150, progressModifier: 90, qualityModifier: 75 },
            materialQualityPercent: 0, ingredients: [], manipulationAvailable: true,
            heartAndSoulAvailable: false, quickInnovationAvailable: false, trainedEyeAvailable: false,
            adversarial: true, stellarSteadyHandCharges: 0
          } });
        });
      } finally { worker.terminate(); }
    });
    expect(result.message).toContain('計測用の保存失敗');
    expect(result.databaseName).toBeTruthy();
    expect(await page.evaluate(async name => (await indexedDB.databases()).some(db => db.name === name), result.databaseName)).toBe(false);
  });
}

test('localhostとLANでWASMの待機APIの利用可否が一致する', async ({ page }) => {
  const results = [];
  await page.route('http://192.0.2.1:4173/**', async route => {
    const url = new URL(route.request().url());
    await route.fulfill({ response: await route.fetch({ url: `http://127.0.0.1:4173${url.pathname}${url.search}` }) });
  });
  for (const host of ['127.0.0.1', '192.0.2.1']) {
    await page.goto(`http://${host}:4173/macro-app/web/index.html?siteRoot=../..`);
    results.push(await page.evaluate(() => new Promise(resolve => {
      const blob = new Blob([`postMessage({suspending:typeof WebAssembly.Suspending,promising:typeof WebAssembly.promising,secure:isSecureContext})`], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob), worker = new Worker(url);
      worker.onmessage = ({ data }) => { worker.terminate(); URL.revokeObjectURL(url); resolve(data); };
    })));
  }
  console.log(JSON.stringify({ wasmWaitingApi: results }));
  expect(results[0].suspending).toBe(results[1].suspending);
  expect(results[0].promising).toBe(results[1].promising);
});
