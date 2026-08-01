const { expect, test } = require('@playwright/test');

test('saved level 10 fits the viewport and keeps live changes inside the preview', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ff14_font_size_level_v2', '10'));
  await page.goto('/');
  await expect(page.locator('#loadStatus')).toContainText(/patch/);
  await expect(page.locator('#loadingOverlay')).not.toHaveClass(/open/);

  await expect(page.locator('html')).toHaveAttribute('data-font-size-level', '10');
  await expect
    .poll(() => page.locator('body').evaluate(element => parseFloat(getComputedStyle(element).fontSize)))
    .toBeCloseTo(23.8, 4);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);

  await page.locator('#settingsBtn').click();
  await page.locator('#settingsDisplayTab').click();
  await expect(page.locator('#fontSizeLevelInput')).toHaveValue('10');
  await expect(page.locator('#fontSizeApplyBtn')).toBeDisabled();
  await expect(page.locator('#fontSizePreview .checkable-item-icon')).toHaveCSS('width', '68px');

  const expectedWidths = ['32px', '36px', '40px', '44px', '48px', '52px', '56px', '60px', '64px', '68px'];
  for (let level = 1; level <= 10; level += 1) {
    await page.locator('#fontSizeLevelInput').fill(String(level));
    await expect(page.locator('#fontSizePreview .checkable-item-icon')).toHaveCSS(
      'width',
      expectedWidths[level - 1]
    );
  }
  await expect(page.locator('html')).toHaveAttribute('data-font-size-level', '10');
  const dialogBox = await page.locator('#settingsDialog').boundingBox();
  expect(dialogBox.x).toBeGreaterThanOrEqual(0);
  expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth + 0.5));
});

test('level 10 keeps dialog actions inside a compact viewport', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ff14_font_size_level_v2', '10'));
  await page.setViewportSize({ width: 375, height: 600 });
  await page.goto('/');
  await expect(page.locator('#loadingOverlay')).not.toHaveClass(/open/);

  await page.locator('#settingsBtn').click();
  const settingsLayout = await page.locator('#settingsDialog').evaluate(dialog => {
    const action = dialog.querySelector('#settingsCloseBtn').getBoundingClientRect();
    const rect = dialog.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, actionTop: action.top, actionBottom: action.bottom };
  });
  expect(settingsLayout.top).toBeGreaterThanOrEqual(0);
  expect(settingsLayout.bottom).toBeLessThanOrEqual(600);
  expect(settingsLayout.actionTop).toBeGreaterThanOrEqual(settingsLayout.top);
  expect(settingsLayout.actionBottom).toBeLessThanOrEqual(settingsLayout.bottom);

  await page.locator('#licenseBtn').click();
  await expect(page.locator('#licenseOverlay')).toHaveClass(/open/);
  const licenseLayout = await page.locator('#licenseDialog').evaluate(dialog => {
    const action = dialog.querySelector('#licenseCloseBtn').getBoundingClientRect();
    const rect = dialog.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, actionTop: action.top, actionBottom: action.bottom };
  });
  expect(licenseLayout.top).toBeGreaterThanOrEqual(0);
  expect(licenseLayout.bottom).toBeLessThanOrEqual(600);
  expect(licenseLayout.actionTop).toBeGreaterThanOrEqual(licenseLayout.top);
  expect(licenseLayout.actionBottom).toBeLessThanOrEqual(licenseLayout.bottom);
});
