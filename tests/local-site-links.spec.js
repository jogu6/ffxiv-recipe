const { test, expect } = require('@playwright/test');
const { openApp } = require('./helpers/app.js');

test('ローカル本体は広場を4174へ開き、ガイドが必要な公開文書を取得できる', async ({ page, request }) => {
  for (const path of ['/docs/license-notice.md', '/vendor/marked.umd.js', '/vendor/purify.min.js']) {
    const response = await request.get(path);
    expect(response.ok()).toBe(true);
    expect(response.headers()['access-control-allow-origin']).toBe('*');
    expect(response.headers()['cross-origin-resource-policy']).toBe('cross-origin');
  }
  const app = await request.get('/');
  expect(app.headers()['cross-origin-embedder-policy']).toBe('require-corp');
  expect(app.headers()['cross-origin-opener-policy']).toBe('same-origin');
  await page.route('http://127.0.0.1:4174/**', route => route.fulfill({
    body: '<p>ローカルのシェアコード広場</p>', contentType: 'text/html; charset=utf-8',
    headers: { 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'cross-origin' },
  }));
  await openApp(page);
  await page.locator('#settingsBtn').click();
  await page.locator('#sharePlazaOpenBtn').click();
  await expect(page.locator('#sharePlazaFrame')).toHaveAttribute('src', 'http://127.0.0.1:4174/share-code-plaza.html');
  await expect(page.frameLocator('#sharePlazaFrame').locator('body')).toContainText('ローカルのシェアコード広場');
});
