const { expect, test } = require('@playwright/test');

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
