const { expect, test } = require('@playwright/test');
const { publishedAppVersion } = require('./helpers/app.js');

for (const tipsAvailable of [true, false]) {
  test(`更新時に${tipsAvailable ? 'リリース追記のないtipsでも起動できる' : 'tipsの通信失敗を追記なしと誤認しない'}`, async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('ff14_acknowledged_release_version', 'v0.0');
      sessionStorage.setItem('ff14_update_reload_pending', '1');
    });
    await page.route('**/data/tips.md*', route => route.fulfill({
      status: tipsAvailable ? 200 : 503,
      contentType: 'text/markdown; charset=utf-8',
      body: tipsAvailable ? '## v0.0 リリース\n\n以前から掲載しているお知らせ' : 'unavailable',
    }));
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-app-ready', 'true');
    await expect(page.locator('#releaseNoticeOverlay')).not.toHaveClass(/open/);
    if (tipsAvailable) {
      await expect(page.locator('#loadingOverlay')).not.toHaveClass(/open/);
      await expect(page.locator('#tipsMsg')).toContainText('以前から掲載しているお知らせ');
      await expect(page.locator('#searchBox')).toBeEditable();
      expect(await page.evaluate(() => localStorage.getItem('ff14_acknowledged_release_version'))).toBe(publishedAppVersion);
      expect(await page.evaluate(() => sessionStorage.getItem('ff14_update_reload_pending'))).toBe(null);
    } else {
      await expect(page.locator('#loadingTitle')).toHaveText('更新内容を読み込めませんでした');
      expect(await page.evaluate(() => localStorage.getItem('ff14_acknowledged_release_version'))).toBe('v0.0');
    }
  });
}

for (const controlledAtBoot of [false, true]) {
  test(`分離ヘッダーのない起動でもSW${controlledAtBoot ? '更新' : '初回登録'}で読み込みを繰り返さない`, async ({ page }) => {
    let navigations = 0;
    let itemRequests = 0;
    page.on('framenavigated', frame => {
      if (frame === page.mainFrame()) navigations += 1;
    });
    page.on('request', request => {
      if (new URL(request.url()).pathname.endsWith('/data/Item.json')) itemRequests += 1;
    });
    await page.route('**/*', async route => {
      if (!route.request().isNavigationRequest()) return route.continue();
      const response = await route.fetch();
      const headers = { ...response.headers() };
      delete headers['cross-origin-embedder-policy'];
      delete headers['cross-origin-opener-policy'];
      await route.fulfill({ response, headers });
    });
    await page.addInitScript(({ controlledAtBoot, version }) => {
      localStorage.setItem('ff14_acknowledged_release_version', version);
      const container = new EventTarget();
      const registration = new EventTarget();
      registration.update = async () => {};
      container.controller = controlledAtBoot ? {} : null;
      let resolveReady;
      container.ready = new Promise(resolve => { resolveReady = resolve; });
      container.register = async () => registration;
      Object.defineProperty(navigator, 'serviceWorker', { value: container });
      window.applyStartupWorker = () => {
        container.controller = {};
        resolveReady(registration);
        container.dispatchEvent(new Event('controllerchange'));
        container.dispatchEvent(new Event('controllerchange'));
      };
      if (controlledAtBoot) resolveReady(registration);
    }, { controlledAtBoot, version: publishedAppVersion });

    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-app-ready', 'true');
    await expect(page.locator('#loadingOverlay')).not.toHaveClass(/open/);
    expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);
    await page.locator('#searchBox').fill('ウォルナット');
    await page.evaluate(() => window.applyStartupWorker());
    await page.waitForTimeout(300);
    expect(navigations).toBe(1);
    expect(itemRequests).toBe(1);
    await expect(page.locator('#searchBox')).toHaveValue('ウォルナット');
    expect(await page.evaluate(() => performance.getEntriesByName('application-data-setup').length)).toBe(1);
  });
}

test('起動画面を表示してから7秒で数値パーセントへ切り替える', async ({ page }) => {
  await page.route('**/data/Item.json*', async route => {
    await new Promise(resolve => setTimeout(resolve, 8500));
    await route.continue();
  });

  await page.goto('/');
  await expect(page.locator('#loadingTitle')).toHaveText('データ読み込み中...');
  await expect(page.locator('#loadingProgressRow')).toBeVisible();
  await expect(page.locator('#loadingProgress')).toHaveCSS('animation-name', 'startup-progress-pulse');
  await expect(page.locator('#loadingProgressPercent')).toBeVisible({ timeout: 7500 });
});
