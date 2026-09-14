const { test, expect } = require('@playwright/test');
const { openApp } = require('./helpers/app.js');

for (const width of [320, 390]) {
  test(`ライセンス原文を幅${width}pxで文字化け・別タブ・横スクロールなく読んで戻れる`, async ({ page, context }, testInfo) => {
    await openApp(page);
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => window.innerWidth)).toBe(width);
    await page.locator('#settingsBtn').click();
    await page.locator('#licenseBtn').click();
    const links = page.locator('#licenseText a[href*="/vendor/licenses/"]');
    await expect(links).toHaveCount(8);
    const pageCount = context.pages().length;
    const backgroundFont = await page.locator('body').evaluate(el => getComputedStyle(el).fontFamily);
    for (let index = 0; index < 8; index++) {
      const link = links.nth(index);
      const title = await link.textContent();
      const href = await link.getAttribute('href');
      await link.scrollIntoViewIfNeeded();
      const scroll = await page.locator('#licenseText').evaluate(el => el.scrollTop);
      await link.click();
      const frame = page.frameLocator('#licenseText iframe');
      await expect(frame.locator('body')).toContainText(/Permission is hereby granted|Apache License/);
      await expect(page.locator('#licenseText iframe')).toHaveAttribute('title', title);
      const layout = await frame.locator('html').evaluate(el => ({
        charset: document.characterSet,
        width: window.innerWidth,
        scrollWidth: el.scrollWidth,
        fontSize: parseFloat(getComputedStyle(document.body).fontSize),
        foreground: getComputedStyle(el).color,
        background: getComputedStyle(el).backgroundColor,
        viewport: document.querySelector('meta[name="viewport"]')?.content
      }));
      expect(layout.charset).toBe('UTF-8');
      expect(layout.viewport).toContain('width=device-width');
      expect(layout.fontSize).toBeGreaterThanOrEqual(16);
      expect(layout.background).not.toBe('rgba(0, 0, 0, 0)');
      expect(layout.foreground).not.toBe(layout.background);
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width + 1);
      expect(layout.width).toBeLessThan(width);
      expect(context.pages()).toHaveLength(pageCount);
      expect(await page.locator('body').evaluate(el => getComputedStyle(el).fontFamily)).toBe(backgroundFont);
      if (href.includes('third-party-NOTICES')) {
        await expect(frame.getByRole('heading', { name: '第三者ソフトウェアのライセンス・権利表記', exact: true })).toBeVisible();
        await expect(frame.locator('pre')).toContainText('主要ライブラリの原文');
        await page.locator('#licenseDialog').screenshot({ path: testInfo.outputPath('third-party-mobile.png') });
      }
      if (href.includes('rust-COPYRIGHT')) {
        await expect(frame.getByRole('heading', { name: 'Copyright notices for The Rust Standard Library', exact: true })).toBeVisible();
        await frame.locator('details').first().evaluate(el => { el.open = true; });
        expect(await frame.locator('html').evaluate(el => el.scrollWidth <= window.innerWidth + 1)).toBe(true);
        await page.locator('#licenseDialog').screenshot({ path: testInfo.outputPath('rust-mobile.png') });
      }
      await page.getByRole('button', { name: 'ライセンス一覧に戻る', exact: true }).click();
      await expect(links).toHaveCount(8);
      expect(await page.locator('#licenseText').evaluate(el => el.scrollTop)).toBeCloseTo(scroll, 0);
    }
    await page.locator('#licenseCloseBtn').click();
    await expect(page.locator('#licenseOverlay')).not.toHaveClass(/open/);
  });
}
