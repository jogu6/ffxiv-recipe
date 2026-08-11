const { expect, test } = require('@playwright/test');

test('share assets are precached and the app reloads offline under Service Worker control', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.locator('#loadStatus')).toHaveText(/patch \d+\.\d+ 対応/);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    }
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  const cachedAssets = await page.evaluate(async () => {
    const keys = await caches.keys();
    const appKey = keys.find(key => key.includes('share6-v3.1'));
    const cache = appKey ? await caches.open(appKey) : null;
    const required = [
      './share-content-model.js',
      './share-coordinator.js',
      './share-png-store.js',
      './share-image-renderer.js',
      './vendor/html2canvas.min.js',
      './assets/app-icons/share.webp'
    ];
    return {
      appKey,
      matches: await Promise.all(required.map(path => cache?.match(new URL(path, location.href).href).then(Boolean)))
    };
  });
  expect(cachedAssets.appKey).toBeTruthy();
  expect(cachedAssets.matches).toEqual([true, true, true, true, true, true]);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#loadStatus')).toHaveText(/patch \d+\.\d+ 対応/);
  await expect(page.locator('#loadingOverlay')).not.toHaveClass(/open/);
  await context.setOffline(false);
});
