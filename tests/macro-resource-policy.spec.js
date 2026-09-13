const { test, expect } = require('@playwright/test');
const fs = require('node:fs');

for (const width of [600, 601]) {
  test(`開発制限の境界 ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.route('**/solver-worker.js*', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: await response.text() + `
        self.addEventListener('message', ({ data }) => {
          if (data.type === 'test-policy') self.postMessage({
            cache: globalThis.__xivcaStorageCacheBytes ?? null,
            slowdown: typeof globalThis.__localMobileSleepMs === 'number'
          });
        });` });
    });
    await page.goto('/macro-app/web/index.html?siteRoot=../..');
    const policy = await page.evaluate(() => new Promise((resolve, reject) => {
      const worker = new Worker('./solver-worker.js', { type: 'module' });
      worker.onmessage = ({ data }) => { worker.terminate(); resolve(data); };
      worker.onerror = event => { worker.terminate(); reject(new Error(event.message)); };
      worker.postMessage({ type: 'test-policy' });
    }));
    expect(policy).toEqual(width === 600
      ? { cache: 512 * 1024 * 1024, slowdown: false }
      : { cache: null, slowdown: false });
  });
}

test('公開成果物には開発制限や計測送信スクリプトを含めない', async () => {
  for (const name of ['app.js', 'solver-worker.js', 'solver-host.js', 'index.html']) {
    const source = fs.readFileSync(`site/macro-app/web/${name}`, 'utf8');
    // Reading optional diagnostic metadata does not activate a restriction.
    expect(source).not.toMatch(/__localMobile\w*\s*=|localMobile=1|__local\/macro/);
  }
});
