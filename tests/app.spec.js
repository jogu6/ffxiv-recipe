const { expect, test } = require('@playwright/test');

async function openApp(page, width = 900, height = 700) {
  await page.setViewportSize({ width, height });
  await page.goto('/');
  await expect(page.locator('#loadStatus')).toContainText(/patch/);
}

async function searchFor(page, value) {
  await page.locator('#searchBox').fill(value);
  await expect(page.locator('#recipeList li').first()).toContainText(value);
}

test('opens the license notice from settings', async ({ page }) => {
  await openApp(page);

  await page.locator('#settingsBtn').click();
  await page.locator('#licenseBtn').click();

  await expect(page.locator('#licenseOverlay')).toHaveClass(/open/);
  await expect(page.locator('#licenseText')).toContainText('SQUARE ENIX');

  await page.locator('#licenseCloseBtn').click();
  await expect(page.locator('#licenseOverlay')).not.toHaveClass(/open/);
});

test('count step buttons adjust the selected recipe count', async ({ page }) => {
  await openApp(page);
  await searchFor(page, 'バスタードソード');
  await page.getByText('バスタードソード', { exact: true }).first().click();

  await expect(page.locator('#countInput')).toHaveValue('1');
  await page.locator('#countIncrease5Btn').click();
  await expect(page.locator('#countInput')).toHaveValue('6');
  await page.locator('#countDecrease5Btn').click();
  await expect(page.locator('#countInput')).toHaveValue('1');
});

test('uses buttons share the accent style', async ({ page }) => {
  await openApp(page);
  await searchFor(page, '山羊乳');

  const listButton = page.locator('.uses-list-btn').first();
  await expect(listButton).toHaveText('使用先');
  await expect(listButton).toHaveCSS('background-color', 'rgb(200, 168, 75)');
  await expect(listButton).toHaveCSS('color', 'rgb(26, 26, 26)');

  await searchFor(page, 'バスタードソード');
  await page.getByText('バスタードソード', { exact: true }).first().click();
  const treeButton = page.locator('#usesBtn');
  await expect(treeButton).toBeVisible();
  await expect(treeButton).toHaveCSS('background-color', 'rgb(200, 168, 75)');
  await expect(treeButton).toHaveCSS('color', 'rgb(26, 26, 26)');
});

test('toggles between recipe tree and materials list, and resets to tree on new selection', async ({ page }) => {
  await openApp(page);
  await searchFor(page, 'アリペブレ');
  await page.getByText('アリペブレ', { exact: true }).first().click();

  await expect(page.locator('#resultViewSwitch')).toBeVisible();
  await expect(page.locator('#treeViewBtn')).toHaveClass(/active/);
  expect(await page.locator('.tree-node').count()).toBeGreaterThan(0);

  await page.locator('#materialsViewBtn').click();
  await expect(page.locator('#materialsViewBtn')).toHaveClass(/active/);
  await expect(page.locator('.materials-list')).toBeVisible();
  await expect(page.locator('.materials-list')).toContainText('ゴールデンイール');
  await expect(page.locator('.tree-node')).toHaveCount(0);

  await searchFor(page, 'バスタードソード');
  await page.getByText('バスタードソード', { exact: true }).first().click();
  await expect(page.locator('#treeViewBtn')).toHaveClass(/active/);
  expect(await page.locator('.tree-node').count()).toBeGreaterThan(0);
});

test('materials list shows exchange supplements and summary totals', async ({ page }) => {
  await openApp(page);
  await searchFor(page, 'アリペブレ');
  await page.getByText('アリペブレ', { exact: true }).first().click();

  await page.locator('#materialsViewBtn').click();
  const spiritSandRow = page.locator('.materials-list li').filter({ hasText: '紫電の霊砂' }).first();
  await expect(spiritSandRow).toContainText('ギャザラースクリップ:橙貨');
  await expect(spiritSandRow).toContainText('× 300');
  await expect(page.locator('.materials-summary-separator')).toBeVisible();
  await expect(page.locator('.materials-summary-row')).toContainText('ギャザラースクリップ:橙貨');
  await expect(page.locator('.materials-summary-row')).toContainText('× 300');
});

test('materials summary keeps exchange alternatives as もしくは groups', async ({ page }) => {
  await openApp(page);
  await searchFor(page, 'ピレトリン');
  await page.getByText('ピレトリン', { exact: true }).first().click();

  await page.locator('#materialsViewBtn').click();
  const summaryRows = page.locator('.materials-summary-row');
  await expect(summaryRows.last()).toContainText('クラフタースクリップ:紫貨');
  await expect(summaryRows.last()).toContainText('ギャザラースクリップ:紫貨');
  await expect(summaryRows.last()).toContainText('もしくは');
  await expect(summaryRows.last()).toContainText('× 200');
});

test('creates a named favorite list from a tree pin and exports a base36 share code', async ({ page }) => {
  await openApp(page);
  await searchFor(page, 'バスタードソード');
  await page.getByText('バスタードソード', { exact: true }).first().click();

  await page.locator('.tree-node .pin-btn').first().click();
  await expect(page.locator('#favoriteTargetOverlay')).toHaveClass(/open/);
  await page.locator('#favoriteTargetCreate').getByText('新規作成').click();
  await page.locator('#textInputField').fill('剣リスト');
  await page.locator('#textInputOkBtn').click();

  await page.locator('#favBtn').click();
  await expect(page.locator('#favoriteLists')).toHaveClass(/open/);
  await page.locator('#favoriteLists').getByText('剣リスト').click();
  await expect(page.locator('#recipeList')).toContainText('バスタードソード');

  await page.locator('#settingsBtn').click();
  await page.locator('#exportListToggle').click();
  await page.locator('#exportListChoices').getByText('剣リスト').click();
  await expect(page.locator('#exportListToggle')).toContainText('剣リスト');
  await expect(page.locator('#exportCode')).toHaveValue(/^[0-9A-Z]+$/);
});

test('shows favorite list materials mode with set count and ring toggles', async ({ page }) => {
  await openApp(page);

  await searchFor(page, 'アリペブレ');
  await page.getByText('アリペブレ', { exact: true }).first().click();
  await page.locator('.tree-node .pin-btn').first().click();
  await page.locator('#favoriteTargetCreate').getByText('新規作成').click();
  await page.locator('#textInputField').fill('素材確認');
  await page.locator('#textInputOkBtn').click();

  await searchFor(page, 'カッパーリング');
  await page.getByText('カッパーリング', { exact: true }).first().click();
  await page.locator('.tree-node .pin-btn').first().click();
  await page.locator('#favoriteTargetChoices').getByText('素材確認').click();

  await page.locator('#favBtn').click();
  await page.locator('#favoriteLists').getByText('素材確認').click();
  await page.locator('#recipeList').getByText('素材リスト').click();

  await expect(page.locator('#countLabel')).toHaveText('セット数:');
  await expect(page.locator('#materialsViewBtn')).toBeVisible();
  await expect(page.locator('#treeViewBtn')).toBeHidden();
  await expect(page.locator('.favorite-ring-controls')).toContainText('カッパーリング');
  await expect(page.locator('.favorite-ring-toggle')).toContainText('1つ');
  await expect(page.locator('.materials-list')).toContainText('ゴールデンイール');

  await page.getByText('アリペブレ', { exact: true }).first().click();
  await expect(page.locator('#countLabel')).toHaveText('個数:');
  await expect(page.locator('#treeViewBtn')).toBeVisible();
  await expect(page.locator('.favorite-ring-controls')).toHaveCount(0);
});

test('crossing the responsive breakpoint resets to startup view', async ({ page }) => {
  await openApp(page, 601, 700);
  await searchFor(page, 'バスタードソード');
  await page.getByText('バスタードソード', { exact: true }).first().click();
  await page.locator('#countIncrease5Btn').click();
  await expect(page.locator('#resultTitle')).toContainText('バスタードソード');

  await page.setViewportSize({ width: 600, height: 700 });
  await expect(page.locator('#panelLeft')).toHaveClass(/mobile-visible/);
  await expect(page.locator('#searchBox')).toHaveValue('');
  await expect(page.locator('#countInput')).toHaveValue('1');
  await expect(page.locator('#resultTitle')).toHaveText('');
  await expect(page.locator('#recipeList li.tips-li')).toBeVisible();

  await page.locator('#searchBox').fill('山羊乳');
  await expect(page.locator('#recipeList li').first()).toContainText('山羊乳');

  await page.setViewportSize({ width: 601, height: 700 });
  await expect(page.locator('#panelLeft')).not.toHaveClass(/mobile-visible/);
  await expect(page.locator('#searchBox')).toHaveValue('');
  await expect(page.locator('#countInput')).toHaveValue('1');
  await expect(page.locator('#resultTitle')).toHaveText('');
  await expect(page.locator('#recipeList li.tips-li')).toHaveCount(0);
  await expect(page.locator('#tipsMsg')).toBeVisible();
});
