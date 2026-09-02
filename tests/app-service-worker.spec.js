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
    const cachedPwaUpdate = appCache ? await appCache.match(new URL('./pwa-update.js', location.href)) : null;
    const cachedBrandLogo = appCache ? await appCache.match(new URL('./assets/branding/xivca-logo.webp', location.href)) : null;

    return {
      activeScript: registration.active?.scriptURL || '',
      appCacheName: appCacheName || '',
      appScriptCached: Boolean(cachedApp),
      pwaUpdateCached: Boolean(cachedPwaUpdate),
      brandLogoCached: Boolean(cachedBrandLogo),
      updateViaCache: registration.updateViaCache
    };
  });

  expect(state.activeScript).toMatch(/\/sw\.js$/);
  expect(state.appCacheName).toMatch(/^ff14recipe-app-/);
  expect(state.appScriptCached).toBe(true);
  expect(state.pwaUpdateCached).toBe(true);
  expect(state.brandLogoCached).toBe(true);
  expect(state.updateViaCache).toBe('none');
});

test('keeps an installed cache update waiting without reloading the initialized app', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
    await page.reload();
    await expect(page.locator('#loadingOverlay')).not.toHaveClass(/open/);
  }

  let itemDataRequests = 0;
  page.on('request', request => {
    if (/\/data\/Item\.json$/u.test(new URL(request.url()).pathname)) itemDataRequests += 1;
  });
  const instanceId = await page.evaluate(() => {
    window.__pwaUpdateTestInstance = crypto.randomUUID();
    return window.__pwaUpdateTestInstance;
  });

  await page.evaluate(() => {
    void navigator.serviceWorker.register('./sw.js?e2e-cache-update=1', { updateViaCache: 'none' });
  });
  await expect.poll(() => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration?.waiting?.scriptURL || '';
  })).toContain('e2e-cache-update=1');

  expect(await page.evaluate(() => window.__pwaUpdateTestInstance)).toBe(instanceId);
  expect(itemDataRequests).toBe(0);
  await expect(page.locator('#loadingOverlay')).not.toHaveClass(/open/);
});

test('stores one expanded item image pack and does not cache individual item images', async ({ page }) => {
  const itemImageRequests = [];
  const jobImageRequests = [];
  const packRequests = [];
  page.on('request', request => {
    const pathname = new URL(request.url()).pathname;
    if (/\/assets\/item-icons\//u.test(pathname)) itemImageRequests.push(pathname);
    if (/\/assets\/job-icons\//u.test(pathname)) jobImageRequests.push(pathname);
    if (/\/data\/item-icons\.pack\.gz$/u.test(pathname)) packRequests.push(pathname);
  });
  await openApp(page);
  await page.locator('#searchBox').fill('バスタードソード');
  const icon = page.locator('#recipeList img.list-icon').first();
  await expect(icon).toBeVisible();
  await expect.poll(() => icon.evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
  const state = await page.evaluate(async () => {
    const cacheNames = await caches.keys();
    const dataCacheName = cacheNames.find(name => name.startsWith('ff14recipe-data-'));
    const cache = dataCacheName ? await caches.open(dataCacheName) : null;
    const requests = cache ? await cache.keys() : [];
    const packRequest = requests.find(request => /\/data\/item-icons-[^/]+\.pack$/u.test(new URL(request.url).pathname));
    const pack = packRequest ? await cache.match(packRequest) : null;
    return {
      dataCacheName,
      individualCount: requests.filter(request => /\/assets\/item-icons\//u.test(new URL(request.url).pathname)).length,
      packCount: requests.filter(request => /\/data\/item-icons-[^/]+\.pack$/u.test(new URL(request.url).pathname)).length,
      packBytes: pack ? (await pack.blob()).size : 0
    };
  });
  expect(state.dataCacheName).toBeTruthy();
  expect(state.individualCount).toBe(0);
  expect(state.packCount).toBe(1);
  expect(state.packBytes).toBeGreaterThan(15 * 1024 * 1024);
  expect(state.packBytes).toBeLessThan(17 * 1024 * 1024);
  expect(itemImageRequests).toEqual([]);
  expect(jobImageRequests).toEqual([]);
  expect(packRequests).toHaveLength(1);
});
