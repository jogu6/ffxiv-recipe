const { test, expect } = require('@playwright/test');

test('Firefox is blocked before application startup', async ({ page }) => {
  const requests = [];
  page.on('request', request => requests.push(new URL(request.url()).pathname));

  await page.goto('/');

  await expect(page.locator('html')).toHaveAttribute('data-browser-support', 'blocked');
  await expect(page.locator('#loadingOverlay')).toHaveClass(/open/);
  await expect(page.locator('#loadingTitle')).toHaveText('FirefoxではXIVcaを利用できません');
  await expect(page.locator('#loadingDetail')).toHaveText([
    '次のいずれかのブラウザーを使用してください。',
    '・Google Chrome 111 以上',
    '・Microsoft Edge 111 以上',
    '・Brave Browser 1.49 以上',
    '・Safari 16.4 以上',
    '最新バージョンをご利用されることをお勧めします。',
  ].join('\n'));
  await expect(page.locator('#loadStatus')).toHaveText('非対応ブラウザー');
  await expect(page.locator('header')).toBeHidden();
  await expect(page.locator('.main')).toBeHidden();
  await expect(page.locator('.footer')).toBeHidden();
  await expect(page.locator('html')).not.toHaveAttribute('data-app-ready', 'true');
  await expect.poll(() => page.evaluate(() => ({
    htmlOverflow: getComputedStyle(document.documentElement).overflow,
    bodyOverflow: getComputedStyle(document.body).overflow,
    scrollable:
      document.documentElement.scrollHeight > document.documentElement.clientHeight ||
      document.body.scrollHeight > document.body.clientHeight,
  }))).toEqual({
    htmlOverflow: 'hidden',
    bodyOverflow: 'hidden',
    scrollable: false,
  });
  expect(requests.some(path => path.endsWith('/data/Item.json'))).toBe(false);
});
