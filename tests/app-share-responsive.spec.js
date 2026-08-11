const { expect, test } = require('@playwright/test');
const { searchFor } = require('./helpers/app.js');

test('share controls and dialog fit compact devices at the largest font size', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ff14_font_size_level_v2', '10'));
  await page.goto('/');
  await expect(page.locator('#loadingOverlay')).not.toHaveClass(/open/);
  await searchFor(page, 'バスタードソード');
  await expect.poll(() => page.locator('#shareBtn img').evaluate(image => image.naturalWidth)).toBe(96);

  for (const selector of ['#shareBtn', '#settingsBtn']) {
    await expect(page.locator(selector)).toBeVisible();
    const rect = await page.locator(selector).boundingBox();
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth + 0.5));
  }

  await page.locator('#shareBtn').click();
  await expect(page.locator('#contentSharePanelChoices')).toBeEmpty();
  await expect(page.locator('#contentShareOverlay')).toHaveClass(/open/);
  const dialog = await page.locator('#contentShareDialog').boundingBox();
  expect(dialog.x).toBeGreaterThanOrEqual(0);
  expect(dialog.x + dialog.width).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth + 0.5));
  await expect(page.locator('#contentShareTextBtn')).toBeInViewport();
  await expect(page.locator('#contentShareImageBtn')).toBeInViewport();
});
