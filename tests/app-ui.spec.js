const { expect, test } = require('@playwright/test');
const { loverWeapons } = require('./fixtures/favorite-share-codes.js');
const {
  chooseCustomOption,
  closeSharePlaza,
  dismissInfoDialog,
  dragHandleAfter,
  importFavoriteFromPlaza,
  openApp,
  routeMirageRecipeVariants,
  searchFor
} = require('./helpers/app.js');
test('title returns to the startup view', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('#tipsMsg .tips-about-btn')).toHaveText('このアプリは何ですか？');
  await expect(page.locator('#tipsMsg .tips-about-btn')).toHaveAttribute(
    'data-url',
    'http://127.0.0.1:4174/'
  );
  await expect(page.locator('#tipsMsg .tips-about-description')).toHaveText(
    '← 選択すると、このアプリでできることや各種機能の説明画面が表示されます'
  );
  await searchFor(page, 'バスタードソード');
  await page.getByText('バスタードソード', { exact: true }).first().click();
  await expect(page.locator('.result-root-summary')).toContainText('バスタードソード');

  await page.locator('#appTitle').click();
  await expect(page.locator('#searchBox')).toHaveValue('');
  await expect(page.locator('#favBtn')).toHaveText('📌 お気に入り');
  await expect(page.locator('#resultTitle')).toHaveText('');
  await expect(page.locator('#tipsMsg')).toBeVisible();
});

test('tips groups releases before v2.5 in a collapsed accordion', async ({ page }) => {
  await openApp(page);
  const details = page.locator('#tipsMsg details');
  const summary = details.locator('summary');

  await expect(details).toHaveCount(1);
  await expect(summary).toHaveText('v2.5未満のリリース情報');
  await expect(details).not.toHaveAttribute('open', '');
  await expect(details.getByText('v1.384 リリース')).toBeHidden();
  await expect.poll(() => summary.evaluate(element => getComputedStyle(element, '::before').content)).toContain('▶');

  await summary.click();
  await expect(details).toHaveAttribute('open', '');
  await expect(details.getByText('v1.384 リリース')).toBeVisible();
  await expect.poll(() => summary.evaluate(element => getComputedStyle(element, '::before').content)).toContain('▼');
});

test('tips treats one newline as a line break and keeps indented text in its list item', async ({ page }) => {
  await page.route('**/data/tips.md', route =>
    route.fulfill({
      contentType: 'text/markdown; charset=utf-8',
      body: '通常行1\n通常行2\n\n- 箇条書き\n  箇条内の改行'
    })
  );
  await openApp(page);

  await expect(page.locator('#tipsMsg p')).toHaveText('通常行1通常行2');
  await expect(page.locator('#tipsMsg p br')).toHaveCount(1);
  await expect(page.locator('#tipsMsg li')).toHaveText('箇条書き箇条内の改行');
  await expect(page.locator('#tipsMsg li br')).toHaveCount(1);
  await expect(page.locator('#tipsMsg li')).toHaveCount(1);
});

test('hides the popup button when launched as a desktop PWA', async ({ page }) => {
  await page.addInitScript(() => {
    const originalMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = query => {
      if (query === '(display-mode: standalone)') {
        return {
          matches: true,
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false
        };
      }
      return originalMatchMedia(query);
    };
  });
  await openApp(page);
  await expect(page.locator('#popupBtn')).toBeHidden();
});

test('crossing the responsive breakpoint resets to startup view', async ({ page }) => {
  await openApp(page, 601, 700);
  await searchFor(page, 'バスタードソード');
  await page.getByText('バスタードソード', { exact: true }).first().click();
  await page.locator('#countIncrease5Btn').click();
  await expect(page.locator('.result-root-summary')).toContainText('バスタードソード');

  await page.setViewportSize({ width: 600, height: 700 });
  await expect(page.locator('#panelLeft')).toHaveClass(/mobile-visible/);
  await expect(page.locator('#searchBox')).toHaveValue('');
  await expect(page.locator('#countInput')).toHaveValue('1');
  await expect(page.locator('#resultTitle')).toHaveText('');
  await expect(page.locator('#recipeList')).toBeHidden();
  await expect(page.locator('#recipeList li.tips-li')).toHaveCount(0);
  await expect(page.locator('#mobileTipsMsg')).toBeVisible();
  await expect(page.locator('#mobileTipsMsg .tips-about-btn')).toHaveText('このアプリは何ですか？');
  await expect(page.locator('#mobileTipsMsg .tips-about-description')).toBeVisible();
  await expect(page.locator('#mobileTipsMsg .tips-row')).toBeVisible();
  await expect(page.locator('#mobileTipsMsg')).toHaveCSS('padding', '16px 20px 22px');
  await expect(page.locator('#mobileTipsMsg')).toHaveCSS('background-color', 'rgb(26, 26, 26)');

  await page.locator('#searchBox').fill('山羊乳');
  await expect(page.locator('#mobileTipsMsg')).toBeHidden();
  await expect(page.locator('#recipeList')).toBeVisible();
  await expect(page.locator('#recipeList li').first()).toContainText('山羊乳');

  await page.setViewportSize({ width: 601, height: 700 });
  await expect(page.locator('#panelLeft')).not.toHaveClass(/mobile-visible/);
  await expect(page.locator('#searchBox')).toHaveValue('');
  await expect(page.locator('#countInput')).toHaveValue('1');
  await expect(page.locator('#resultTitle')).toHaveText('');
  await expect(page.locator('#mobileTipsMsg')).toBeHidden();
  await expect(page.locator('#tipsMsg')).toBeVisible();
});
