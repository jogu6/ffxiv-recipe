const { expect, test } = require('@playwright/test');
const { openApp } = require('./helpers/app.js');

test.use({ serviceWorkers: 'allow' });

test('registers the service worker and precaches the published application shell', async ({ page }) => {
  await openApp(page);

  const state = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const cacheNames = await caches.keys();
    const appCacheName = cacheNames.find(name => name.startsWith('ff14recipe-app-'));
    const appCache = appCacheName ? await caches.open(appCacheName) : null;
    const cachedApp = appCache ? await appCache.match(new URL('./app.js', location.href)) : null;

    return {
      activeScript: registration.active?.scriptURL || '',
      appCacheName: appCacheName || '',
      appScriptCached: Boolean(cachedApp)
    };
  });

  expect(state.activeScript).toMatch(/\/sw\.js$/);
  expect(state.appCacheName).toMatch(/^ff14recipe-app-/);
  expect(state.appScriptCached).toBe(true);
});
