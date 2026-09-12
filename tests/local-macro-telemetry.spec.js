const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

test('開発サーバーだけが計測値と停止中の応答状況を受信し通信復帰後に再送する', async ({ page, context, request }) => {
  test.setTimeout(45000);
  const source = fs.readFileSync(path.resolve(__dirname, '../site/macro-app/web/index.html'), 'utf8');
  expect(source).not.toContain('/__local/');
  expect(fs.existsSync(path.resolve(__dirname, '../site/tools/local-macro-client.js'))).toBe(false);
  const startedAt = new Date().toISOString();
  await page.addInitScript(startedAt => {
    globalThis.__xivcaMacroProfile = { schemaVersion: 1, startedAt, status: 'running',
      input: { test: 'local-upload' }, metadata: { device: 'E2E' },
      samples: [{ elapsedMs: 1, searchNodes: 10000001, wasmMemoryBytes: 1073741824 }] };
  }, startedAt);
  // Block application initialization; exercise the real Python injection and receiver independently.
  await page.route('**/macro-app/web/app.js', route => route.abort());
  await page.goto('/macro-app/web/index.html?siteRoot=../..&recipe=b5cc569f3e4');
  await expect.poll(() => page.evaluate(() => __localMacroUpload.state)).toBe('received');
  const runId = await page.evaluate(() => __localMacroUpload.runId);
  const file = path.resolve(__dirname, `../pipeline/reports/macro-profiles/received/${runId}.json`);
  expect(JSON.parse(fs.readFileSync(file, 'utf8')).samples[0].searchNodes).toBe(10000001);
  await expect.poll(() => JSON.parse(fs.readFileSync(file, 'utf8')).reception.heartbeat.lastObservedChangeAgeMs,
    { timeout: 10000 }).toBeGreaterThan(4000);
  await context.setOffline(true);
  await page.evaluate(() => {
    __xivcaMacroProfile.samples.push({ elapsedMs: 5000, searchNodes: 12000000, wasmMemoryBytes: 1400000000 });
    __xivcaMacroProfile.status = 'cancelled';
  });
  await expect.poll(() => page.evaluate(() => __localMacroUpload.state), { timeout: 12000 }).toBe('retrying');
  await context.setOffline(false);
  await expect.poll(() => JSON.parse(fs.readFileSync(file, 'utf8')).status, { timeout: 10000 }).toBe('cancelled');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(saved.metadata.localResourceTest.enabled).toBe(null);
  expect(saved.metadata.localResourceTest.unknown).toBe(true);
  expect(saved.samples).toHaveLength(2);
  expect(saved.samples[1].searchNodes).toBe(12000000);
  const status = await request.get('/__local/macro-status');
  expect((await status.json()).find(run => run.runId === runId).status).toBe('cancelled');
  const rejected = await request.post('/__local/macro-profile', { data: {} });
  expect(rejected.status()).toBe(403);
  // Logs are intentionally kept outside the public site root.
  expect((await request.get(`/pipeline/reports/macro-profiles/received/${runId}.json`)).status()).toBe(404);
});
