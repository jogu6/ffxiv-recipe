const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

test('ページ再読込なしで幅を変えた次の生成から制限を適用・解除する', async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => localStorage.setItem('xivca.macro.crafter-status.v1', JSON.stringify({
    調理師: { level: 100, craftsmanship: 5655, control: 5399, cp: 664,
      manipulation: true, heartAndSoul: false, quickInnovation: false }
  })));
  await page.setViewportSize({ width: 601, height: 900 });
  await page.goto('/macro-app/web/index.html?siteRoot=../..&recipe=b5cc569f3e4');
  await expect(page.locator('#generateButton')).toBeEnabled({ timeout: 30000 });
  for (const width of [600, 601]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('#generateButton').click();
    await expect.poll(() => page.evaluate(() => __localMobileMode)).toBe(width <= 600);
    await expect.poll(() => page.evaluate(() => __xivcaMacroRuntime.threadCount)).toBe(1);
    await page.locator('#cancelButton').click();
    await expect(page.locator('#progressOverlay')).toBeHidden();
  }
  await expect(page.getByRole('button', { name: /計測ログを保存/ })).toHaveCount(0);
});

test('通常ブラウザーの600px境界で開発用の休止制御とWASM上限だけが切り替わる', async ({ browser }) => {
  test.setTimeout(120000);
  const results = [];
  for (const { width, lan } of [{ width: 601 }, { width: 600 }, { width: 390 }, { width: 600, lan: true }]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    try {
      if (lan) await page.route('http://192.0.2.1:4173/**', async route => {
        const url = new URL(route.request().url());
        const response = await route.fetch({ url: `http://127.0.0.1:4173${url.pathname}${url.search}` });
        await route.fulfill({ response });
      });
      await page.route('**/macro-app/web/app.js', route => route.abort());
      await page.route('**/solver-worker.js*', async route => {
        const url = new URL(route.request().url());
        const response = await route.fetch({ url: `http://127.0.0.1:4173${url.pathname}${url.search}` });
        const probe = `self.addEventListener('message', event => {
          if (!event.data.testProbe) return;
          const times = []; let checksum = 0;
          for (let trial = 0; trial < 4; trial++) {
            const start = Date.now();
            for (let block = 0; block < 100; block++) {
              for (let i = 0; i < 500000; i++) checksum = Math.imul(checksum ^ i, 1664525) + 1013904223 | 0;
              performance.now();
            }
            if (trial) times.push(Date.now() - start);
          }
          wasmMemory.grow(16384 - wasmMemory.buffer.byteLength / 65536);
          let exceededGiB = true;
          try { wasmMemory.grow(1); } catch (error) { exceededGiB = false; }
          self.postMessage({ type: 'probe-result', times, checksum, exceededGiB,
            sleepMs: globalThis.__localMobileSleepMs || 0, wasmBytes: wasmMemory.buffer.byteLength });
        });`;
        await route.fulfill({ response, body: await response.text() + probe });
      });
      await page.goto(`http://${lan ? '192.0.2.1' : '127.0.0.1'}:4173/macro-app/web/index.html?siteRoot=../..`);
      const result = await page.evaluate(() => new Promise((resolve, reject) => {
        const worker = new Worker('./solver-worker.js', { type: 'module' });
        worker.onerror = reject;
        worker.onmessage = ({ data }) => {
          if (data.type === 'ready') worker.postMessage({ type: 'solve', testProbe: true });
          if (data.type === 'probe-result') { worker.terminate(); resolve({ ...data, limits: __localMobileLimits() }); }
        };
        worker.postMessage({ type: 'prepare', threadCount: 1 });
      }));
      expect(result.exceededGiB).toBe(width > 600);
      expect(result.sleepMs > 0).toBe(width <= 600);
      results.push({ width, origin: lan ? 'lan' : 'localhost', ...result });
    } finally { await context.close(); }
  }
  const median = values => [...values].sort((a, b) => a - b)[1];
  const directory = path.resolve(__dirname, '../pipeline/reports/macro-profiles');
  fs.mkdirSync(directory, { recursive: true });
  for (const result of results.slice(1)) result.measuredSlowdown = median(result.times) / median(results[0].times);
  fs.writeFileSync(path.join(directory, 'mobile-resource-calibration.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
  for (const result of results.slice(1)) expect(result.measuredSlowdown).toBeGreaterThan(2);
  for (const result of results.slice(1)) expect(result.measuredSlowdown).toBeLessThan(6);
  const published = fs.readFileSync(path.resolve(__dirname, '../site/macro-app/web/solver-worker.js'), 'utf8');
  expect(published).not.toContain('__localMobile');
  expect(published).not.toContain('Atomics.wait');
});
