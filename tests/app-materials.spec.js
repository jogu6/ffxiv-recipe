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
test('intermediate materials follow craft order, show usage, and open an independent material tree', async ({
  page
}) => {
  await openApp(page);
  await searchFor(page, 'ブラスバスタードソード');
  await page.getByText('ブラスバスタードソード', { exact: true }).first().click();
  await page.locator('#materialsViewBtn').click();

  const intermediateHeader = page.locator('.materials-section-header').filter({ hasText: '製作する中間素材' });
  const bastardNode = page
    .locator('.material-name')
    .filter({ hasText: /^バスタードソード$/ })
    .locator('xpath=ancestor::div[contains(@class,"intermediate-tree-row")]');
  const intermediateNames = await page.locator('.intermediate-tree-row .material-name').allTextContents();
  expect(intermediateNames.indexOf('ブロンズインゴット')).toBeLessThan(intermediateNames.indexOf('バスタードソード'));
  await expect(bastardNode.locator('.badge')).toHaveText('鍛冶Lv2');
  await expect(bastardNode.locator('.badge .job-icon')).toHaveCount(0);
  const craftJobIcon = bastardNode.locator('.craft-job-label > .job-icon');
  await expect(craftJobIcon).toHaveAttribute('src', './assets/job-icons/blacksmith.webp');
  await expect(craftJobIcon).toHaveAttribute('alt', '');
  await expect(craftJobIcon).toHaveAttribute('aria-hidden', 'true');
  const craftBadgeSizes = await bastardNode.locator('.material-primary').evaluate(primary => ({
    fontSize: Number.parseFloat(getComputedStyle(primary.querySelector('.material-name')).fontSize),
    iconWidth: primary.querySelector('.job-icon').getBoundingClientRect().width,
    iconHeight: primary.querySelector('.job-icon').getBoundingClientRect().height
  }));
  expect(Math.abs(craftBadgeSizes.iconWidth / craftBadgeSizes.fontSize - 1.154)).toBeLessThan(0.01);
  expect(Math.abs(craftBadgeSizes.iconHeight / craftBadgeSizes.fontSize - 1.154)).toBeLessThan(0.01);
  await expect(bastardNode).not.toContainText('ブラスバスタードソードに使用');
  await expect(bastardNode.locator('.material-primary > .item-action-buttons')).toHaveCount(1);

  await intermediateHeader.click();
  await expect(bastardNode.locator('..')).toHaveClass(/collapsed/);
  await intermediateHeader.click();
  await expect(bastardNode.locator('..')).not.toHaveClass(/collapsed/);

  const materialsHeader = page.locator('.materials-section-header').filter({ hasText: '必要素材' });
  const firstMaterial = materialsHeader.locator('xpath=following-sibling::*[1]');
  await materialsHeader.click();
  await expect(firstMaterial).toHaveClass(/collapsed/);
  await materialsHeader.click();
  await expect(firstMaterial).not.toHaveClass(/collapsed/);

  const crystalsHeader = page
    .locator('.materials-section-header')
    .filter({ hasText: '必要なシャード/クリスタル/クラスター' });
  const firstCrystal = crystalsHeader.locator('xpath=following-sibling::*[1]');
  await expect(firstCrystal).toHaveClass(/collapsed/);
  await crystalsHeader.click();
  await expect(firstCrystal).not.toHaveClass(/collapsed/);
  await crystalsHeader.click();
  await expect(firstCrystal).toHaveClass(/collapsed/);

  await bastardNode.locator('.intermediate-material-tree-btn').first().click();
  await expect(bastardNode.locator('.intermediate-material-tree-btn').first()).toHaveText('🌲');
  await expect(page.locator('#materialTreeOverlay')).toHaveClass(/open/);
  await expect(page.locator('#materialTreeTitle')).toHaveText('素材ツリー');
  await expect(page.locator('.material-tree-root-summary')).toContainText('バスタードソード');
  await expect(page.locator('.material-tree-root-summary .badge-craft')).toHaveText('鍛冶Lv2');
  await expect(page.locator('.material-tree-root-summary')).not.toContainText('鍛冶師');
  await expect(page.locator('.material-tree-root-summary .node-icon')).toHaveCSS('width', '40px');
  await expect(page.locator('#materialTreeContent > .tree-node').first()).not.toContainText('バスタードソード');
  await expect(page.locator('#materialTreeContent')).toContainText('ブロンズインゴット');
  await expect(page.locator('#materialTreeContent .pin-btn')).toHaveCount(0);
  const materialTreeHeight = await page
    .locator('#materialTreeContent')
    .evaluate(el => Math.round(el.getBoundingClientRect().height));
  await page.locator('#materialTreeContent .tree-node .node-row').first().click();
  await page.waitForTimeout(220);
  const foldedMaterialTreeHeight = await page
    .locator('#materialTreeContent')
    .evaluate(el => Math.round(el.getBoundingClientRect().height));
  expect(foldedMaterialTreeHeight).toBe(materialTreeHeight);
  await page.locator('#materialTreeContent .tree-node .node-row').first().click();
  const initialCount = Number(await page.locator('#materialTreeCountInput').inputValue());
  await page.locator('#materialTreeIncrease5Btn').click();
  await expect(page.locator('#materialTreeCountInput')).toHaveValue(String(initialCount + 5));
  await page.locator('#materialTreeCountInput').fill('1000');
  await expect(page.locator('#materialTreeCountInput')).toHaveValue('999');
  await page.locator('#materialTreeIncrease5Btn').click();
  await expect(page.locator('#materialTreeCountInput')).toHaveValue('999');
  await page.locator('#materialTreeCountInput').fill('');
  await expect(page.locator('#materialTreeCountInput')).toHaveValue('');
  await page.locator('#materialTreeCountInput').pressSequentially('300');
  await expect(page.locator('#materialTreeCountInput')).toHaveValue('300');
  await page.locator('#materialTreeCloseBtn').click();
  await expect(page.locator('#materialTreeOverlay')).not.toHaveClass(/open/);
});

test('timed gathering dialog uses gatherer icons only for its gathering methods', async ({ page }) => {
  await openApp(page);

  await searchFor(page, '金鉱');
  await page.locator('#recipeList .gathering-timer-btn').first().click();
  const miningBadge = page.locator('#gatheringContent .gathering-method').first();
  await expect(miningBadge).toContainText('採掘');
  await expect(miningBadge.locator('.job-icon')).toHaveAttribute('src', './assets/job-icons/miner.webp');
  await page.locator('#gatheringCloseBtn').click();

  await searchFor(page, 'ブラックトリュフ');
  await page.locator('#recipeList .gathering-timer-btn').first().click();
  const botanyBadge = page.locator('#gatheringContent .gathering-method').first();
  await expect(botanyBadge).toContainText('草刈');
  await expect(botanyBadge.locator('.job-icon')).toHaveAttribute('src', './assets/job-icons/botanist.webp');
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

test('selects ingredient-only search results when opening used-in recipes', async ({ page }) => {
  await openApp(page);
  await searchFor(page, '山羊乳');

  const row = page.locator('#recipeList li').filter({ hasText: '山羊乳' }).first();
  await row.click();

  await expect(row).toHaveClass(/selected/);
  await expect(page.locator('#usesTitle')).toContainText('山羊乳');
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
  await page.locator('.materials-section-header').filter({ hasText: '必要なシャード' }).click();
  await expect(
    page
      .locator('.materials-section-header')
      .filter({ hasText: '必要なシャード' })
      .locator('xpath=following-sibling::*[1]')
  ).not.toHaveClass(/collapsed/);
  await page.locator('#treeContainer').evaluate(el => {
    el.scrollTop = 120;
  });

  await searchFor(page, 'バスタードソード');
  await page.getByText('バスタードソード', { exact: true }).first().click();
  await expect(page.locator('#treeViewBtn')).toHaveClass(/active/);
  expect(await page.locator('.tree-node').count()).toBeGreaterThan(0);
  await expect.poll(() => page.locator('#treeContainer').evaluate(el => el.scrollTop)).toBe(0);

  await page.locator('#materialsViewBtn').click();
  const resetCrystalFirstRow = page
    .locator('.materials-section-header')
    .filter({ hasText: '必要なシャード' })
    .locator('xpath=following-sibling::*[1]');
  await expect(resetCrystalFirstRow).toHaveClass(/collapsed/);
});

test('materials list shows exchange supplements and summary totals', async ({ page }) => {
  await openApp(page);
  await searchFor(page, 'アリペブレ');
  await page.getByText('アリペブレ', { exact: true }).first().click();

  await page.locator('#materialsViewBtn').click();
  const spiritSandRow = page.locator('.materials-list li').filter({ hasText: '紫電の霊砂' }).first();
  await expect(spiritSandRow.locator('.supplement-refine-label')).toContainText('精選、または');
  await expect(spiritSandRow.locator('.supplement-refine-label')).toHaveCSS('color', 'rgb(91, 213, 200)');
  await expect(spiritSandRow).toContainText('ギャザラースクリップ:橙貨');
  await expect(spiritSandRow).toContainText('× 300');
  await expect(page.locator('.materials-summary-separator')).toHaveCount(0);
  const summaryHeader = page.locator('.materials-section-header').filter({ hasText: '必要な交換貨幣' });
  await expect(summaryHeader).toContainText('▶');
  await summaryHeader.click();
  const summaryRow = page.locator('.materials-summary-row').filter({ hasText: 'ギャザラースクリップ:橙貨' }).first();
  await expect(summaryRow.locator('.material-refine-row')).toContainText('精選、または');
  await expect(summaryRow.locator('.material-primary')).toContainText('ギャザラースクリップ:橙貨');
  await expect(summaryRow.locator('.material-primary')).toContainText('× 300');
});

test('materials list sorts normal items before crystals and shows supplement icons', async ({ page }) => {
  await openApp(page);
  await searchFor(page, 'アリペブレ');
  await page.getByText('アリペブレ', { exact: true }).first().click();

  await page.locator('#materialsViewBtn').click();
  await expect(page.locator('.materials-section-header')).toContainText([
    '製作する中間素材',
    '必要素材',
    '必要なシャード/クリスタル/クラスター',
    '必要な交換貨幣'
  ]);
  const crystalsHeader = page
    .locator('.materials-section-header')
    .filter({ hasText: '必要なシャード/クリスタル/クラスター' });
  await expect(crystalsHeader.locator('xpath=following-sibling::*[1]')).toHaveClass(/collapsed/);
  const text = await page.locator('.materials-list').innerText();
  await page.locator('.materials-section-header').filter({ hasText: '必要な交換貨幣' }).click();
  const summaryText = await page.locator('.materials-summary-row').innerText();
  expect(text.indexOf('ゴールデンイール')).toBeGreaterThanOrEqual(0);
  expect(text.indexOf('紫電の霊砂')).toBeGreaterThan(text.indexOf('ゴールデンイール'));
  await crystalsHeader.click();
  const expandedText = await page.locator('.materials-list').innerText();
  expect(expandedText.indexOf('ファイアクラスター')).toBeGreaterThan(expandedText.indexOf('紫電の霊砂'));
  expect(summaryText).toContain('ギャザラースクリップ:橙貨');
  await expect(page.locator('.materials-summary-separator')).toHaveCount(0);
  await expect(page.locator('.material-supplement-icon').first()).toBeVisible();
  await expect(page.locator('.material-sub-surplus').first()).toHaveCSS('color', 'rgb(106, 191, 105)');
  await expect(page.locator('.material-sub-num:not(.material-sub-surplus)').first()).toHaveCSS(
    'color',
    'rgb(106, 191, 105)'
  );
});

test('favorite materials show intermediate usage and dependency-aware craft order', async ({ page }) => {
  const shareCode =
    'Z00273F0Y320Y1M0Y6D55576G4H436D4J4R0W243A1A1G1C0Y180Y2X0Y1M2J1E1C1G1D181E1K1C1I181F1D1G1I181F1I1D1I181F1G1C1J181F1K1H1I181G1E1F1J181G1F1G1F181G1D1F1J181G1G1J1E2L3H';
  await openApp(page);
  await page.locator('#settingsBtn').click();
  await page.locator('#importCode').fill(shareCode);
  await page.locator('#startImportBtn').click();
  await dismissInfoDialog(page);
  await page.locator('#recipeList .favorite-materials-row > .favorite-list-action').click();

  const threadRow = page
    .locator('.intermediate-tree-row')
    .filter({
    has: page.getByText('亜麻糸', { exact: true })
    })
    .first();
  await expect(threadRow.locator('.badge')).toHaveText('裁縫Lv32');
  await expect(threadRow).toContainText('× 10');
  await expect(threadRow).toContainText('うち 8 個は亜麻布に使用');
  await expect(threadRow).not.toContainText('ウールコイフ');
  await expect(threadRow.locator('.material-usage-detail')).toHaveCount(1);
  await expect(threadRow.locator('.material-usage-emphasis')).toHaveCount(2);
  const names = await page.locator('.intermediate-tree-row .material-name').allTextContents();
  expect(names.indexOf('亜麻糸')).toBeLessThan(names.indexOf('亜麻布'));
});

test('imports from the share code plaza with naming confirmation and keeps the plaza open', async ({ page }) => {
  const shareCode =
    'Z00273F0Y320Y1M0Y6D55576G4H436D4J4R0W243A1A1G1C0Y180Y2X0Y1M2J1E1C1G1D181E1K1C1I181F1D1G1I181F1I1D1I181F1G1C1J181F1K1H1I181G1E1F1J181G1F1G1F181G1D1F1J181G1G1J1E2L3H';
  await openApp(page);
  await expect(page.locator('#sharePlazaFrame')).toHaveAttribute('allow', 'clipboard-write');
  await importFavoriteFromPlaza(page, shareCode, '広場から保存');
  await expect(page.locator('#sharePlazaOverlay')).toHaveClass(/open/);
  await expect(page.locator('#settingsOverlay')).toHaveClass(/open/);
  await closeSharePlaza(page);
  await expect(page.locator('#settingsOverlay')).toHaveClass(/open/);
});

test('combined materials delay a craft job until its cross-job dependencies are ready', async ({ page }) => {
  const shareCode =
    'Z002X3F0Y320Y1M0Y6F49590W6B3M4Z6B3N586B3N3S6B3N4Q6B3N586B3N4P6B3N506B3M4H6B3N580Y180Y2X0Y1M2J1G1L1E1L1I181G1L1E1L1J181G1L1E1L1K181G1L1E1L1L181G1L1F1C1C181G1L1F1C1L181G1L1F1D1G181G1L1F1D1L181G1L1F1E1G181G1I1E1H1F2L3H';
  await openApp(page);
  await page.locator('#settingsBtn').click();
  await page.locator('#importCode').fill(shareCode);
  await page.locator('#startImportBtn').click();
  await dismissInfoDialog(page);
  await page.locator('#recipeList .favorite-materials-row > .favorite-list-action').click();

  const names = await page.locator('.intermediate-tree-row .material-name').allTextContents();
  const whetstone = names.indexOf('マグネシア砥石');
  const water = names.indexOf('心力の宝水G4');
  const garnet = names.indexOf('ローズガーネット');
  const blackStar = names.indexOf('ブラックスター');
  expect(whetstone).toBeGreaterThanOrEqual(0);
  expect(water).toBeGreaterThanOrEqual(0);
  expect(Math.min(garnet, blackStar)).toBeGreaterThan(whetstone);
  expect(Math.min(garnet, blackStar)).toBeGreaterThan(water);
  expect(Math.abs(blackStar - garnet)).toBe(1);
});

test('exchange materials are sorted by their exchange currency first', async ({ page }) => {
  await openApp(page);
  await searchFor(page, 'オールドキングダム・ディフェンダーヘルム');
  await page.getByText('オールドキングダム・ディフェンダーヘルム', { exact: true }).first().click();

  await page.locator('#materialsViewBtn').click();
  const rows = await page
    .locator('.materials-list li:not(.materials-summary-row)')
    .evaluateAll(items =>
    items
      .map(item => item.textContent || '')
      .filter(text => text.includes('アラガントームストーン:数理') || text.includes('ギャザラースクリップ:橙貨'))
  );

  expect(rows.length).toBeGreaterThan(1);
  const firstOrangeIndex = rows.findIndex(text => text.includes('ギャザラースクリップ:橙貨'));
  const lastTomestoneIndex = rows.map(text => text.includes('アラガントームストーン:数理')).lastIndexOf(true);
  expect(firstOrangeIndex).toBeGreaterThan(lastTomestoneIndex);
});

test('materials summary keeps exchange alternatives as もしくは groups', async ({ page }) => {
  await openApp(page);
  await searchFor(page, 'ピレトリン');
  await page.getByText('ピレトリン', { exact: true }).first().click();

  await page.locator('#materialsViewBtn').click();
  await page.locator('.materials-section-header').filter({ hasText: '必要な交換貨幣' }).click();
  const summaryRows = page.locator('.materials-summary-row');
  await expect(summaryRows.last()).toContainText('クラフタースクリップ:紫貨');
  await expect(summaryRows.last()).toContainText('ギャザラースクリップ:紫貨');
  await expect(summaryRows.last()).toContainText('もしくは');
  await expect(summaryRows.last()).toContainText('× 200');
});

test('formats displayed quantities with grouping separators', async ({ page }) => {
  await openApp(page);
  await searchFor(page, 'アリペブレ');
  await page.getByText('アリペブレ', { exact: true }).first().click();

  await page.locator('#countInput').fill('999');
  await expect(page.locator('.result-root-summary')).toContainText('アリペブレ');
  await expect(page.locator('#countInput')).toHaveValue('999');
  await expect(page.locator('#treeContainer')).toContainText(/× \d{1,3},\d{3}/);
});

test('restricts requested counts to integers from 1 through 999', async ({ page }) => {
  await openApp(page);
  await searchFor(page, 'アリペブレ');
  await page.getByText('アリペブレ', { exact: true }).first().click();

  await page.locator('#countInput').fill('1000');
  await expect(page.locator('#countInput')).toHaveValue('999');
  await page.locator('#countIncrease5Btn').click();
  await expect(page.locator('#countInput')).toHaveValue('999');

  await page.locator('#countInput').fill('-1');
  await expect(page.locator('#countInput')).toHaveValue('1');
  await page.locator('#countInput').fill('1.5');
  await expect(page.locator('#countInput')).toHaveValue('1');
  await page.locator('#countInput').fill('');
  await expect(page.locator('#countInput')).toHaveValue('');
  await page.locator('#countInput').pressSequentially('300');
  await expect(page.locator('#countInput')).toHaveValue('300');
  await expect(page.locator('.result-root-summary')).toContainText('アリペブレ');
  await page.locator('#countInput').fill('');
  await page.locator('#countInput').press('Enter');
  await expect(page.locator('#countInput')).toHaveValue('1');
});
