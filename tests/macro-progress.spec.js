const { test, expect } = require('@playwright/test');

for (const development of [false, true]) test(`${development ? '開発' : '本番'}の生成表示と報告情報`, async ({ page }) => {
  await page.route('**/macro-app/web/app.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      globalThis.__xivcaDevelopment = ${development};
      globalThis.__testProgress = { engine: snapshot => { profiler.sample(snapshot); observeEngineTelemetry(snapshot); },
        storage: observeStorageProgress, start: () => profiler.start({}, { recipeId: state.recipe?.id }),
        render: renderGenerationActivity };` });
  });
  await page.goto('/macro-app/web/index.html?siteRoot=../..');
  await page.waitForFunction(() => globalThis.__testProgress);
  await page.evaluate(() => {
    __testProgress.start();
    __testProgress.engine({ stage: 'bestFirstSearch', workUnits: 10000, searchNodes: 10000,
      storageDiskUsedBytes: 1024 ** 3, storageDiskCapacityBytes: 3 * 1024 ** 3 });
    __testProgress.storage({ operation: 'reserve', storageBackend: 'opfs', storageReservationMode: 'opfs-file-size',
      storageReservedBytes: 3 * 1024 ** 3, storagePersistent: false });
  });
  await expect(page.locator('#generationStatus')).toContainText('確認した候補：10,000件');
  await expect(page.locator('#progress')).not.toHaveAttribute('value');
  await page.evaluate(() => __testProgress.storage({ operation: 'write', storageWrittenBytes: 8 * 1024 ** 3,
    storageReadBytes: 4 * 1024 ** 3 }));
  const status = page.locator('#generationStatus');
  await expect(status).toContainText('端末への一時保存：1.00GB／3.00GB');
  await expect(status).not.toContainText('8.00GB');
  const before = await status.textContent();
  await page.evaluate(() => __testProgress.storage({ operation: 'read', storageReadBytes: 4 * 1024 ** 3 }));
  expect(await status.textContent()).toBe(before);
  expect(before.includes('一時保存からの読み込み')).toBe(development);
  expect(before.includes('最後に処理の進行を確認')).toBe(development);
  await page.evaluate(() => __testProgress.engine({ stage: 'bestFirstSearch', workUnits: 10000, searchNodes: 10000,
    storageDiskUsedBytes: 512 * 1024 ** 2, storageDiskCapacityBytes: 3 * 1024 ** 3 }));
  await expect(status).toContainText('端末への一時保存：512.0MB／3.00GB');
  const report = await page.evaluate(() => captureInquiryDiagnostics());
  expect(report['一時保存の計測'].storageDiskUsedBytes).toBe(512 * 1024 ** 2);
  expect(report['一時保存の計測'].storageBackend).toBe('opfs');
  expect(report['一時保存の計測'].storageReadBytes).toBe(4 * 1024 ** 3);
  expect(report['直近の探索計測'].at(-1).storagePersistent).toBe(false);
  await page.evaluate(() => {
    const now = Date.now;
    Date.now = () => now() + 31000;
    // The same counters arriving again do not indicate progress.
    __testProgress.storage({ operation: 'write', storageWrittenBytes: 8 * 1024 ** 3 });
    __testProgress.render();
  });
  expect((await status.textContent()).split('\n')[0]).toBe(before.split('\n')[0]);
  await expect(status).not.toContainText('進み具合を確認できていません');
  await page.evaluate(() => __testProgress.engine({ stage: 'bestFirstSearch', workUnits: 20000, searchNodes: 20000 }));
  await expect(page.locator('#generationStatus')).toContainText('確認した候補：20,000件');
  await expect(page.locator('#generationStatus')).not.toContainText('進み具合を確認できていません');
});

test('保存処理のAbortErrorを利用者の中止と取り違えず報告用情報に残す', async ({ page }) => {
  await page.route('**/solver-host.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `
    self.onmessage = ({ data }) => {
      if (data.type === 'prepare') postMessage({ type: 'ready', requestId: data.requestId, threadCount: 1 });
      if (data.type === 'solve') postMessage({ type: 'error', requestId: data.requestId,
        errorName: 'AbortError', message: '一時保存の準備に失敗しました',
        diagnostics: { phase: 'reserve', storage: { storageBackend: 'opfs', storageRequestedBytes: 3221225472 } } });
      if (data.type === 'dispose') { postMessage({ type: 'disposed' }); self.close(); }
    };` });
  });
  await page.goto('/macro-app/web/index.html?siteRoot=../..&recipe=b5cc569f3e4');
  await expect(page.locator('#generateButton')).toBeEnabled();
  await page.evaluate(() => {
    for (const [key, value] of Object.entries({ level: 100, craftsmanship: 5655, control: 5399, cp: 664 })) {
      const element = document.getElementById(key);
      element.value = value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await page.locator('#generateButton').click();
  await expect(page.locator('#confirmMsg')).toContainText('一時保存の準備に失敗しました');
  const report = await page.evaluate(() => captureInquiryDiagnostics());
  expect(report['直近の生成記録']['状態']).toBe('error');
  expect(report['生成エラー詳細']['種類']).toBe('AbortError');
  expect(report['生成エラー詳細'].phase).toBe('reserve');
  expect(report['生成エラー詳細'].storage.storageRequestedBytes).toBe(3 * 1024 ** 3);
});
