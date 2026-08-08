const { expect, test } = require('@playwright/test');
const { loverWeapons } = require('./fixtures/favorite-share-codes.js');
const {
  chooseCustomOption,
  closeSharePlaza,
  dismissInfoDialog,
  dragHandleAfter,
  importFavoriteFromPlaza,
  loadPublishedItems,
  openApp,
  routeMirageRecipeVariants,
  searchFor
} = require('./helpers/app.js');
test('single-column shop dialog stays compact at six hundred pixels and expands only for multiple columns', async ({
  page
}) => {
  await openApp(page, 600, 720);
  await page.evaluate(() => showShopDialog('コバルトスキレット'));
  await expect(page.locator('#shopTitle')).toContainText('店情報: コバルトスキレット');
  await expect(page.locator('.shop-entry')).toHaveCount(10);
  const columnCount = () =>
    page.locator('.shop-entry-list').evaluate(list => {
      return getComputedStyle(list).gridTemplateColumns.split(' ').filter(Boolean).length;
    });
  await expect.poll(columnCount).toBe(1);
  const compactWidth = await page.locator('#shopDialog').evaluate(dialog => dialog.getBoundingClientRect().width);
  expect(compactWidth).toBeLessThanOrEqual(440);

  await page.setViewportSize({ width: 900, height: 720 });
  await expect.poll(columnCount).toBeGreaterThan(1);
  await expect
    .poll(() => page.locator('#shopDialog').evaluate(dialog => dialog.getBoundingClientRect().width))
    .toBeGreaterThan(compactWidth);
});

test('shows shop info button and dialog for items with ShopInfo', async ({ page }) => {
  await page.route('**/data/Item.json*', async route => {
    const items = await loadPublishedItems();
    const target = items.find(item => item.Name === 'アリペブレ');
    target.ShopInfo = {
      price: 4,
      shops: [
        {
        shopName: '素材屋 テスト',
        area: 'リムサ・ロミンサ：下甲板層',
        x: 8.6,
        y: 11.8,
        requiredRank: '1: 中立'
        },
        {
        shopName: '通常ショップ テスト',
        area: 'グリダニア：新市街'
        }
      ]
    };
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ Version: '7.55', Items: items })
    });
  });
  await openApp(page);
  await searchFor(page, 'アリペブレ');
  await page.getByText('アリペブレ', { exact: true }).first().click();
  await page.locator('.result-root-summary .shop-info-btn').click();
  await expect(page.locator('#shopOverlay')).toHaveClass(/open/);
  await expect(page.locator('#shopTitle')).toContainText('店情報: アリペブレ');
  await expect(page.locator('#shopPriceHeader')).toContainText('販売価格');
  await expect(page.locator('#shopPriceHeader')).toContainText('4ギル');
  await expect(page.locator('#shopContent')).toContainText('素材屋 テスト');
  await expect(page.locator('#shopContent')).toContainText('リムサ・ロミンサ：下甲板層 X:8.6 Y:11.8');
  await expect(page.locator('#shopContent')).toContainText('必要友好ランク：1: 中立');
  await expect(page.locator('.shop-required-rank')).toHaveCount(1);
  await expect
    .poll(async () => {
      const tops = await page
        .locator('.shop-entry')
        .evaluateAll(entries => entries.map(entry => entry.getBoundingClientRect().top));
      return tops.length === 2 && tops[0] === tops[1];
    })
    .toBe(true);
  const shopCards = await page.locator('.shop-entry').evaluateAll(entries =>
    entries.map(entry => ({
      top: entry.getBoundingClientRect().top,
      width: entry.getBoundingClientRect().width,
      wraps: entry.scrollWidth > entry.clientWidth + 1
    }))
  );
  expect(shopCards[0].top).toBe(shopCards[1].top);
  expect(Math.abs(shopCards[0].width - shopCards[1].width)).toBeLessThan(1);
  expect(shopCards.some(card => card.wraps)).toBe(false);
  const multipleShopDialogWidth = await page.locator('#shopDialog').evaluate(dialog => dialog.getBoundingClientRect().width);
  await page.evaluate(() =>
    showShopDialog('オーク材', {
      allowIntermediatePurchase: true,
      intermediatePurchase: { qty: 1 }
    })
  );
  await expect(page.locator('#shopTitle')).toContainText('店情報: オーク材');
  await expect(page.locator('.shop-entry')).toHaveCount(1);
  await expect(page.locator('.shop-purchase-option')).toContainText('1個を購入');
  const singleCardWidths = await page.locator('.shop-entry-list').evaluate(list => ({
    list: list.getBoundingClientRect().width,
    card: list.querySelector('.shop-entry').getBoundingClientRect().width
  }));
  expect(Math.abs(singleCardWidths.list - singleCardWidths.card)).toBeLessThan(1);
  await expect.poll(() => page.locator('#shopDialog').evaluate(dialog => dialog.getBoundingClientRect().width)).toBeLessThanOrEqual(440);
  const singleShopDialogWidth = await page.locator('#shopDialog').evaluate(dialog => dialog.getBoundingClientRect().width);
  expect(singleShopDialogWidth).toBeLessThan(multipleShopDialogWidth);
});

test('purchased intermediate keeps rows visible and marks its unused materials', async ({ page }) => {
  await openApp(page);
  await searchFor(page, 'ブラスバスタードソード');
  await page.getByText('ブラスバスタードソード', { exact: true }).first().click();
  await page.locator('#materialsViewBtn').click();

  const purchasedNode = page
    .locator('.intermediate-tree-row .material-name')
    .filter({ hasText: /^バスタードソード$/ })
    .locator('xpath=ancestor::li[contains(@class,"intermediate-tree-node")]');
  await expect(purchasedNode).not.toHaveClass(/purchase-selected/);
  await page.locator('#treeContainer').evaluate(element => {
    element.scrollTop = 120;
  });
  const scrollBeforePurchase = await page.locator('#treeContainer').evaluate(element => element.scrollTop);
  await purchasedNode.locator('.shop-info-btn').click();
  const option = page.getByLabel('この中間素材は購入💰して用意する');
  await expect(option).not.toBeChecked();
  await expect(page.locator('.shop-purchase-option')).toContainText('1個を購入');
  await expect(page.locator('.shop-purchase-option')).not.toContainText('バスタードソード 1個');
  await expect(option).toHaveCSS('appearance', 'none');
  await expect.poll(() => option.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(22);
  await expect.poll(() => option.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(22);
  await expect(option).toHaveCSS('background-color', 'rgb(26, 26, 26)');
  const fireShardRow = page.locator('.materials-list li').filter({ hasText: 'ファイアシャード' });
  const earthShardRow = page.locator('.materials-list li').filter({ hasText: 'アースシャード' });
  await expect(fireShardRow.locator('.material-qty')).toHaveText('× 3');
  await expect(earthShardRow.locator('.material-qty')).toHaveText('× 2');
  await option.check();
  await expect(option).toHaveCSS('background-color', 'rgb(200, 168, 75)');
  await expect
    .poll(() => page.locator('#treeContainer').evaluate(element => element.scrollTop))
    .toBe(scrollBeforePurchase);
  await page.locator('#shopCloseBtn').click();

  await expect(purchasedNode).toHaveClass(/purchase-selected/);
  await expect(purchasedNode.locator('.purchase-status')).toHaveCount(0);
  await expect(purchasedNode.locator('.shop-info-btn')).toHaveText('💰🛒');
  await expect(fireShardRow.locator('.material-qty')).toHaveText('× 1');
  await expect(earthShardRow.locator('.material-qty')).toHaveText('× 1');
  const lowerIntermediate = page
    .locator('.intermediate-tree-row .material-name')
    .filter({ hasText: /^メープル材$/ })
    .locator('xpath=ancestor::li[contains(@class,"intermediate-tree-node")]');
  await expect(lowerIntermediate).toHaveClass(/purchase-unneeded/);
  await page.locator('#treeContainer').evaluate(element => {
    element.scrollTop = 60;
  });
  const scrollBeforeDisabledDialog = await page.locator('#treeContainer').evaluate(element => element.scrollTop);
  await lowerIntermediate.locator('.shop-info-btn').click();
  await expect(page.getByLabel('この中間素材は購入💰して用意する')).toBeDisabled();
  await expect(page.locator('.shop-purchase-option')).toContainText('現在は購入指定できません');
  await expect(page.locator('.shop-purchase-reason')).toContainText('バスタードソード');
  await page.locator('#shopCloseBtn').click();
  await expect
    .poll(() => page.locator('#treeContainer').evaluate(element => element.scrollTop))
    .toBe(scrollBeforeDisabledDialog);
  const unusedRow = page.locator('.materials-list li').filter({ hasText: 'メープル原木' });
  await expect(unusedRow).toHaveClass(/purchase-unneeded/);
  await expect(unusedRow.locator('.purchase-status')).toHaveText('中間素材購入💰の為不要');
  await expect(unusedRow.locator('.item-action-buttons button').first()).toBeEnabled();
  const unusedStatusBox = await unusedRow.locator('.purchase-status').boundingBox();
  const unusedIconBox = await unusedRow.locator('img').first().boundingBox();
  const unusedButtonsBox = await unusedRow.locator('.item-action-buttons').boundingBox();
  expect(unusedStatusBox.x).toBeGreaterThanOrEqual(unusedIconBox.x + unusedIconBox.width);
  expect(unusedStatusBox.x + unusedStatusBox.width).toBeLessThanOrEqual(unusedButtonsBox.x);

  await page.reload();
  await expect(page.locator('#loadingOverlay')).not.toHaveClass(/open/);
  await expect(
    page
      .locator('.intermediate-tree-row .material-name')
      .filter({ hasText: /^バスタードソード$/ })
      .locator('xpath=ancestor::li[contains(@class,"intermediate-tree-node")]')
  ).toHaveClass(/purchase-selected/);
  const restoredPurchasedNode = page
    .locator('.intermediate-tree-row .material-name')
    .filter({ hasText: /^バスタードソード$/ })
    .locator('xpath=ancestor::li[contains(@class,"intermediate-tree-node")]');
  await restoredPurchasedNode.locator('.shop-info-btn').click();
  await expect(page.getByLabel('この中間素材は購入💰して用意する')).toBeChecked();
  await page.getByLabel('この中間素材は購入💰して用意する').uncheck();
  await page.locator('#shopCloseBtn').click();
  await expect(restoredPurchasedNode.locator('.shop-info-btn')).toHaveText('🛒');
});

test('intermediate and necessary-material bulk purchases stay independent and collapsible', async ({ page }) => {
  await openApp(page);
  await searchFor(page, 'ブラスバスタードソード');
  await page.getByText('ブラスバスタードソード', { exact: true }).first().click();
  await page.locator('#materialsViewBtn').click();
  const header = page.locator('.materials-section-header').filter({ hasText: '製作する中間素材' });
  await expect(header.locator('xpath=following-sibling::*[1]')).toHaveClass(/materials-bulk-actions/);
  await expect(page.getByRole('button', { name: '購入取消' })).toHaveCount(2);
  await expect(page.getByRole('button', { name: '購入取消' }).first()).toBeDisabled();
  const intermediateBulk = header.locator('xpath=following-sibling::*[1]');
  const materialHeader = page.locator('.materials-section-header').filter({ hasText: '必要素材' });
  const materialBulk = materialHeader.locator('xpath=following-sibling::*[1]');
  await materialBulk.getByRole('button', { name: '全て購入' }).click();
  await expect(materialBulk.getByRole('button', { name: '全て購入' })).toBeDisabled();
  await expect(intermediateBulk.getByRole('button', { name: '全て購入' })).toBeEnabled();
  await expect(materialBulk.getByRole('button', { name: '購入取消' })).toBeEnabled();
  await intermediateBulk.getByRole('button', { name: '全て購入' }).click();
  await expect(intermediateBulk.getByRole('button', { name: '全て購入' })).toBeDisabled();
  await expect(materialHeader.locator('xpath=following-sibling::*[1]')).not.toHaveClass(/materials-bulk-actions/);
  await intermediateBulk.getByRole('button', { name: '購入取消' }).click();
  await header.click();
  const collapsedBulkActions = header.locator('xpath=following-sibling::*[1]');
  const nextHeader = page.locator('.materials-section-header').filter({ hasText: '必要素材' });
  await expect(collapsedBulkActions).toHaveClass(/collapsed/);
  await expect
    .poll(async () => Math.round((await collapsedBulkActions.boundingBox())?.height ?? 999))
    .toBe(0);
  await expect
    .poll(async () => {
      const upper = await header.boundingBox();
      const lower = await nextHeader.boundingBox();
      if (!upper || !lower) return 999;
      return Math.round(lower.y - (upper.y + upper.height));
    })
    .toBeLessThanOrEqual(1);
});

test('selecting another search result clears purchase flags', async ({ page }) => {
  await openApp(page);
  await searchFor(page, 'ブラスバスタードソード');
  await page.getByText('ブラスバスタードソード', { exact: true }).first().click();
  await page.locator('#materialsViewBtn').click();
  const maple = () =>
    page
      .locator('.intermediate-tree-row .material-name')
      .filter({ hasText: /^メープル材$/ })
      .locator('xpath=ancestor::li[contains(@class,"intermediate-tree-node")]');
  await maple().locator('.shop-info-btn').click();
  await page.getByLabel('この中間素材は購入💰して用意する').check();
  await page.locator('#shopCloseBtn').click();
  await searchFor(page, 'バスタードソード');
  await page.locator('#recipeList').getByText('バスタードソード', { exact: true }).click();
  await page.locator('#materialsViewBtn').click();
  await expect(maple()).not.toHaveClass(/purchase-selected/);
});

test('necessary-material purchases are visual-only, persist for the same target, and clear for another target', async ({
  page
}) => {
  await openApp(page);
  await searchFor(page, 'ブラスバスタードソード');
  await page.getByText('ブラスバスタードソード', { exact: true }).first().click();
  await page.locator('#materialsViewBtn').click();
  const copper = () =>
    page
      .locator('.materials-list > li')
      .filter({ has: page.getByText('銅鉱', { exact: true }) })
      .first();
  const quantityBefore = await copper().locator('.material-qty').textContent();
  await copper().locator('.shop-info-btn').click();
  await page.getByLabel('この素材は購入💰して用意する').check();
  await page.locator('#shopCloseBtn').click();
  await expect(copper()).toHaveClass(/purchase-selected/);
  await expect(copper().locator('.material-qty')).toHaveText(quantityBefore);

  await page.reload();
  await expect(page.locator('#loadingOverlay')).not.toHaveClass(/open/);
  await expect(copper()).toHaveClass(/purchase-selected/);

  await searchFor(page, 'バスタードソード');
  await page.locator('#recipeList').getByText('バスタードソード', { exact: true }).click();
  await page.locator('#materialsViewBtn').click();
  await expect(page.locator('.materials-list > li.purchase-selected')).toHaveCount(0);
});

test('purchased intermediate status is visible on mobile', async ({ page }) => {
  await openApp(page, 423, 780);
  await searchFor(page, 'ブラスバスタードソード');
  await page.getByText('ブラスバスタードソード', { exact: true }).first().click();
  await page.locator('#materialsViewBtn').click();
  const purchasedNode = page
    .locator('.intermediate-tree-row .material-name')
    .filter({ hasText: /^バスタードソード$/ })
    .locator('xpath=ancestor::li[contains(@class,"intermediate-tree-node")]');
  await purchasedNode.locator('.shop-info-btn').click();
  await page.getByLabel('この中間素材は購入💰して用意する').check();
  await page.locator('#shopCloseBtn').click();
  await expect(
    page.locator('.materials-list li').filter({ hasText: 'メープル原木' }).locator('.purchase-status')
  ).toBeVisible();
  await page.locator('#appTitle').click();
  await searchFor(page, 'ブラスバスタードソード');
  await page.locator('#recipeList').getByText('ブラスバスタードソード', { exact: true }).click();
  await page.locator('#materialsViewBtn').click();
  const resetNode = page
    .locator('.intermediate-tree-row .material-name')
    .filter({ hasText: /^バスタードソード$/ })
    .locator('xpath=ancestor::li[contains(@class,"intermediate-tree-node")]');
  await expect(resetNode).not.toHaveClass(/purchase-selected/);
  await expect(resetNode.locator('.shop-info-btn')).toHaveText('🛒');
});

test('update reload skips saved view restoration once', async ({ page }) => {
  await openApp(page);
  await searchFor(page, 'アリペブレ');
  await page.getByText('アリペブレ', { exact: true }).first().click();
  await expect(page.locator('.result-root-summary')).toContainText('アリペブレ');
  await page.evaluate(() => sessionStorage.setItem('ff14_skip_restore_once', '1'));
  await page.reload();
  await expect(page.locator('#loadStatus')).toHaveText('patch 7.55 対応');
  await expect(page.locator('#loadingOverlay')).not.toHaveClass(/open/);
  await expect(page.locator('#searchBox')).toHaveValue('');
  await expect(page.locator('.result-root-summary')).toHaveCount(0);
});
