const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

test('本番配信のレポートはアプリ内記録だけから全期間と容量推計を出力する', async ({ page }) => {
  const requests = [];
  page.on('request', request => requests.push(new URL(request.url()).pathname));
  // Serve the actual published files without development-server injections.
  for (const file of ['index.html', 'app.js']) await page.route(url => url.pathname === `/macro-app/web/${file}`, route => route.fulfill({
    body: fs.readFileSync(path.join(__dirname, '../site/macro-app/web', file)),
    contentType: file.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8'
  }));
  await page.addInitScript(() => {
    localStorage.setItem('xivca.macro.profile.v1', JSON.stringify({
      status: 'completed', startedAt: '2026-09-13T12:00:00+09:00', elapsedMs: 5000,
      metadata: { recipeId: 'b5cc569f3e4' }, input: { maxCp: 649 },
      samples: Array.from({ length: 60 }, (_, i) => ({ stage: i < 5 ? 'resourceQualityBound' : 'bestFirstSearch',
        elapsedMs: i * 50, searchNodes: i * 100, wasmEngineKind: 'parallel',
        storageQuotaBytes: 0, storageUsageBytes: 0, storageDiskUsedBytes: 0 })),
      storage: { storageDiskUsedBytes: 0, storageQuotaBytes: 0 },
      storageEvents: [{ operation: 'reserve', elapsedMs: 20, storageReservedBytes: 3221225472,
        storageQuotaBytes: 2147483648, storageUsageBytes: 5478342143, storageAvailableBytes: 0 }],
      memoryEvents: []
    }));
  });
  await page.goto('/macro-app/web/index.html?siteRoot=../..&recipe=b5cc569f3e4');
  await expect(page.locator('#recipeInfo')).toContainText('アリペブレ', { timeout: 30000 });
  const result = await page.evaluate(() => {
    const before = JSON.stringify(globalThis.__xivcaMacroProfile);
    const start = performance.now();
    const report = captureInquiryDiagnostics();
    return { report, elapsedMs: performance.now() - start, unchanged: before === JSON.stringify(globalThis.__xivcaMacroProfile),
      development: globalThis.__xivcaDevelopment === true };
  });
  expect(result.development).toBe(false);
  expect(result.unchanged).toBe(true);
  expect(result.report.出力元JavaScript識別子).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(result.report.生成全体の記録.保存済み計測数).toBe(60);
  expect(result.report.生成全体の記録.段階別[0].初回観測ms).toBe(0);
  expect(result.report.生成全体の記録.全期間の推移).toHaveLength(32);
  expect(result.report.ブラウザー容量推計[0].storageQuotaBytes).toBe(2147483648);
  expect(result.report.直近の探索計測[0].storageQuotaBytes).toBeUndefined();
  expect(requests.some(path => path.startsWith('/__local/') || path.startsWith('/pipeline/'))).toBe(false);
  console.log(JSON.stringify({ reportCaptureMs: result.elapsedMs }));
});
