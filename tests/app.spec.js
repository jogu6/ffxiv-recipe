const { expect, test } = require('@playwright/test');

async function openApp(page, width = 900, height = 700) {
  await page.setViewportSize({ width, height });
  await page.goto('/');
  await expect(page.locator('#loadStatus')).toContainText(/patch/);
  await expect(page.locator('#loadingOverlay')).not.toHaveClass(/open/);
}

test('loading overlay blocks interaction while it is displayed', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('#loadingOverlay')).toHaveCSS('pointer-events', 'auto');
});

async function searchFor(page, value) {
  await page.locator('#searchBox').fill(value);
  if ([...value].length < 3) await page.locator('#searchBox').blur();
  await expect(page.locator('#recipeList li').first()).toContainText(value);
}

async function chooseCustomOption(page, selectId, value) {
  const select = page.locator(`#${selectId}`);
  if (await select.getAttribute('data-value') === value) return;
  await select.locator('.custom-select-toggle').click();
  await select.locator(`.custom-select-option[data-value="${value}"]`).click();
}

async function dragHandleAfter(page, handle, targetRow) {
  const handleBox = await handle.boundingBox();
  const targetBox = await targetRow.boundingBox();
  if (!handleBox || !targetBox) throw new Error('Cannot drag invisible reorder handle');

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height * 0.85, { steps: 6 });
  await page.mouse.up();
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

test('opens privacy policy and contact link from settings', async ({ page }) => {
  await openApp(page);

  await page.locator('#settingsBtn').click();
  await page.locator('#privacyBtn').click();

  await expect(page.locator('#licenseOverlay')).toHaveClass(/open/);
  await expect(page.locator('#licenseTitle')).toContainText('プライバシー');
  await expect(page.locator('#licenseText')).toContainText('Cloudflare Web Analytics');

  await page.locator('#licenseCloseBtn').click();
  await page.evaluate(() => {
    window.__contactUrl = '';
    window.open = url => {
      window.__contactUrl = url;
      return null;
    };
  });
  await page.locator('#contactBtn').click();
  await expect.poll(() => page.evaluate(() => window.__contactUrl)).toBe('https://discord.gg/eZP5temK6e');
});

test('count step buttons adjust the selected recipe count', async ({ page }) => {
  await openApp(page);
  await searchFor(page, 'バスタードソード');
  await page.getByText('バスタードソード', { exact: true }).first().click();
  await expect(page.locator('#countInput')).toHaveValue('1');
  await expect(page.locator('.result-root-summary')).toContainText('バスタードソード');
  await page.locator('#countIncrease5Btn').click();
  await expect(page.locator('#countInput')).toHaveValue('6');
  await page.locator('#countDecrease5Btn').click();
  await expect(page.locator('#countInput')).toHaveValue('1');

  await page.locator('#countIncrease5Btn').click();
  await searchFor(page, 'アリペブレ');
  await page.getByText('アリペブレ', { exact: true }).first().click();
  await expect(page.locator('#countInput')).toHaveValue('1');
});

test('number inputs hide native spin buttons', async ({ page }) => {
  await openApp(page, 900);

  for (const selector of ['#countInput', '#materialTreeCountInput']) {
    await expect(page.locator(selector)).toHaveCSS('appearance', 'textfield');
    await expect(page.locator(selector)).toHaveCSS('color', 'rgb(200, 168, 75)');
    await expect(page.locator(selector)).toHaveCSS('font-size', '18px');
    await expect(page.locator(selector)).toHaveCSS('font-weight', '700');
    await expect(page.locator(selector)).toHaveCSS('height', '26px');
  }

  await page.setViewportSize({ width: 600, height: 700 });
  await expect(page.locator('#countInput')).toHaveCSS('appearance', 'textfield');
  await expect(page.locator('#countInput')).toHaveCSS('font-size', '22px');
  await expect(page.locator('#countInput')).toHaveCSS('height', '32px');
  await expect(page.locator('#materialTreeCountInput')).toHaveCSS('font-size', '18px');
  await expect(page.locator('#materialTreeCountInput')).toHaveCSS('height', '26px');
  await expect(page.locator('#materialTreeDecreaseBtn')).toHaveCSS('height', '26px');
  await expect(page.locator('#materialTreeIncreaseBtn')).toHaveCSS('height', '26px');

  await searchFor(page, 'ブラスバスタードソード');
  await page.getByText('ブラスバスタードソード', { exact: true }).first().click();
  await expect(page.locator('#treeContainer .tree-node .node-row').first()).toHaveCSS('white-space', 'normal');
  await page.locator('#materialsViewBtn').click();
  await page.locator('.intermediate-material-tree-btn').first().click();
  await expect(page.locator('#materialTreeContent .tree-node .node-row').first()).toHaveCSS('white-space', 'nowrap');

  await page.evaluate(() => openMaterialTree('ローズガーネット', 6));
  const materialTreeRightGap = await page.evaluate(() => {
    const content = document.querySelector('#materialTreeContent');
    content.scrollLeft = content.scrollWidth;
    const row = [...content.querySelectorAll('.node-row')].find(node => node.textContent.includes('数理'));
    const contentBox = content.getBoundingClientRect();
    const qtyBox = row.querySelector('.node-qty').getBoundingClientRect();
    return contentBox.right - qtyBox.right;
  });
  expect(materialTreeRightGap).toBeGreaterThanOrEqual(8);
});

test('intermediate materials follow craft order, show usage, and open an independent material tree', async ({ page }) => {
  await openApp(page);
  await searchFor(page, 'ブラスバスタードソード');
  await page.getByText('ブラスバスタードソード', { exact: true }).first().click();
  await page.locator('#materialsViewBtn').click();

  const intermediateHeader = page.locator('.materials-section-header').filter({ hasText: '製作する中間素材' });
  const bastardNode = page.locator('.material-name').filter({ hasText: /^バスタードソード$/ })
    .locator('xpath=ancestor::div[contains(@class,"intermediate-tree-row")]');
  const intermediateNames = await page.locator('.intermediate-tree-row .material-name').allTextContents();
  expect(intermediateNames.indexOf('ブロンズインゴット')).toBeLessThan(intermediateNames.indexOf('バスタードソード'));
  await expect(bastardNode).toContainText('鍛冶');
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

  const crystalsHeader = page.locator('.materials-section-header').filter({ hasText: '必要なシャード/クリスタル/クラスター' });
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
  await expect(page.locator('.material-tree-root-summary .node-icon')).toHaveCSS('width', '40px');
  await expect(page.locator('#materialTreeContent > .tree-node').first()).not.toContainText('バスタードソード');
  await expect(page.locator('#materialTreeContent')).toContainText('ブロンズインゴット');
  await expect(page.locator('#materialTreeContent .pin-btn')).toHaveCount(0);
  const materialTreeHeight = await page.locator('#materialTreeContent').evaluate(el => Math.round(el.getBoundingClientRect().height));
  await page.locator('#materialTreeContent .tree-node .node-row').first().click();
  await page.waitForTimeout(220);
  const foldedMaterialTreeHeight = await page.locator('#materialTreeContent').evaluate(el => Math.round(el.getBoundingClientRect().height));
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
  await expect(page.locator('.materials-section-header').filter({ hasText: '必要なシャード' }).locator('xpath=following-sibling::*[1]')).not.toHaveClass(/collapsed/);
  await page.locator('#treeContainer').evaluate(el => { el.scrollTop = 120; });

  await searchFor(page, 'バスタードソード');
  await page.getByText('バスタードソード', { exact: true }).first().click();
  await expect(page.locator('#treeViewBtn')).toHaveClass(/active/);
  expect(await page.locator('.tree-node').count()).toBeGreaterThan(0);
  await expect.poll(() => page.locator('#treeContainer').evaluate(el => el.scrollTop)).toBe(0);

  await page.locator('#materialsViewBtn').click();
  const resetCrystalFirstRow = page.locator('.materials-section-header').filter({ hasText: '必要なシャード' }).locator('xpath=following-sibling::*[1]');
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
  const crystalsHeader = page.locator('.materials-section-header').filter({ hasText: '必要なシャード/クリスタル/クラスター' });
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
  await expect(page.locator('.material-sub-num:not(.material-sub-surplus)').first()).toHaveCSS('color', 'rgb(106, 191, 105)');
});

test('favorite materials show intermediate usage and dependency-aware craft order', async ({ page }) => {
  const shareCode = 'Z00273F0Y320Y1M0Y6D55576G4H436D4J4R0W243A1A1G1C0Y180Y2X0Y1M2J1E1C1G1D181E1K1C1I181F1D1G1I181F1I1D1I181F1G1C1J181F1K1H1I181G1E1F1J181G1F1G1F181G1D1F1J181G1G1J1E2L3H';
  await openApp(page);
  await page.locator('#settingsBtn').click();
  await page.locator('#importCode').fill(shareCode);
  await page.locator('#startImportBtn').click();
  await page.locator('#recipeList .favorite-materials-row > .favorite-list-action').click();

  const threadRow = page.locator('.intermediate-tree-row').filter({
    has: page.getByText('亜麻糸', { exact: true })
  }).first();
  await expect(threadRow).toContainText('裁縫');
  await expect(threadRow).toContainText('× 10');
  await expect(threadRow).toContainText('うち 8 個は亜麻布に使用');
  await expect(threadRow).not.toContainText('ウールコイフ');
  await expect(threadRow.locator('.material-usage-detail')).toHaveCount(1);
  await expect(threadRow.locator('.material-usage-emphasis')).toHaveCount(2);
  const names = await page.locator('.intermediate-tree-row .material-name').allTextContents();
  expect(names.indexOf('亜麻糸')).toBeLessThan(names.indexOf('亜麻布'));
});

test('combined materials delay a craft job until its cross-job dependencies are ready', async ({ page }) => {
  const shareCode = 'Z002X3F0Y320Y1M0Y6F49590W6B3M4Z6B3N586B3N3S6B3N4Q6B3N586B3N4P6B3N506B3M4H6B3N580Y180Y2X0Y1M2J1G1L1E1L1I181G1L1E1L1J181G1L1E1L1K181G1L1E1L1L181G1L1F1C1C181G1L1F1C1L181G1L1F1D1G181G1L1F1D1L181G1L1F1E1G181G1I1E1H1F2L3H';
  await openApp(page);
  await page.locator('#settingsBtn').click();
  await page.locator('#importCode').fill(shareCode);
  await page.locator('#startImportBtn').click();
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
  const rows = await page.locator('.materials-list li:not(.materials-summary-row)').evaluateAll(items =>
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

test('creates a named favorite list from a tree pin and exports a base36 share code', async ({ page }) => {
  await openApp(page);
  await searchFor(page, 'バスタードソード');
  await page.getByText('バスタードソード', { exact: true }).first().click();

  await page.locator('.result-root-summary .pin-btn').first().click();
  await expect(page.locator('#favoriteTargetOverlay')).toHaveClass(/open/);
  await page.locator('#favoriteTargetCreate').getByText('新規作成').click();
  await page.locator('#textInputField').fill('剣リスト');
  await page.locator('#textInputOkBtn').click();

  await page.locator('#favBtn').click();
  await expect(page.locator('#favoriteLists')).toHaveClass(/open/);
  await page.locator('#favoriteLists').getByText('剣リスト').click();
  await expect(page.locator('#favBtn')).toContainText('剣リスト');
  await expect(page.locator('#recipeList')).toContainText('バスタードソード');

  await page.locator('#recipeList .pin-btn').first().click();
  await expect(page.locator('#confirmMsg')).toContainText('「剣リスト」から削除しますか？');
  await page.locator('#confirmNo').click();

  await page.locator('#settingsBtn').click();
  await page.locator('#exportListToggle').click();
  await expect(page.locator('#exportListChoices')).not.toContainText('検索履歴');
  await page.locator('#exportListChoices').getByText('剣リスト').click();
  await expect(page.locator('#exportListToggle')).toContainText('剣リスト');
  await expect(page.locator('#exportCode')).toHaveValue(/^[0-9A-Z]+$/);
});

test('keeps a protected recent-items list with recipes and reverse-looked-up materials', async ({ page }) => {
  await openApp(page);

  await page.locator('#favBtn').click();
  const recentChoice = page.locator('#favoriteLists li').first();
  await expect(recentChoice).toHaveText('検索履歴');
  await expect(recentChoice).toHaveClass(/recent-favorite-list/);
  await expect(recentChoice.locator('button')).toHaveCount(0);

  await searchFor(page, 'アリペブレ');
  await page.getByText('アリペブレ', { exact: true }).first().click();
  await searchFor(page, '山羊乳');
  await page.getByText('山羊乳', { exact: true }).first().click();

  await page.locator('#favBtn').click();
  await page.locator('#favoriteLists').getByText('検索履歴', { exact: true }).click();
  const recentRows = page.locator('#recipeList li.fav-item-row');
  await expect(recentRows).toHaveCount(2);
  await expect(recentRows.nth(0)).toContainText('山羊乳');
  await expect(recentRows.nth(1)).toContainText('アリペブレ');
  await expect(page.locator('#recipeList').getByText('並び替え')).toHaveCount(0);
  await expect(page.locator('#recipeList').getByText('素材リストを表示')).toHaveCount(0);

  await recentRows.nth(0).click();
  await expect(page.locator('#usesTitle')).toContainText('山羊乳');
  await recentRows.nth(1).click();
  await expect(page.locator('.result-root-summary .pin-btn').first()).toHaveClass(/inactive/);

  await recentRows.nth(0).locator('.pin-btn').click();
  await page.locator('#confirmYes').click();
  await expect(page.locator('#recipeList')).not.toContainText('山羊乳');
});

test('restores selected view state after reload without saving calculated material output', async ({ page }) => {
  await openApp(page);
  await searchFor(page, 'アリペブレ');
  await page.getByText('アリペブレ', { exact: true }).first().click();
  await page.locator('#countIncrease5Btn').click();
  await page.locator('#materialsViewBtn').click();
  const intermediateHeader = page.locator('.materials-section-header').filter({ hasText: '製作する中間素材' });
  const materialsHeader = page.locator('.materials-section-header').filter({ hasText: '必要素材' });
  await intermediateHeader.click();
  await expect(intermediateHeader.locator('xpath=following-sibling::*[1]')).toHaveClass(/collapsed/);
  await expect.poll(async () => {
    const upper = await intermediateHeader.boundingBox();
    const lower = await materialsHeader.boundingBox();
    if (!upper || !lower) return 999;
    return Math.round(lower.y - (upper.y + upper.height));
  }).toBeLessThanOrEqual(2);
  await materialsHeader.click();
  await expect(materialsHeader.locator('xpath=following-sibling::*[1]')).toHaveClass(/collapsed/);
  const crystalHeader = page.locator('.materials-section-header').filter({ hasText: '必要なシャード' });
  const exchangeHeader = page.locator('.materials-section-header').filter({ hasText: '必要な交換貨幣' });
  await expect.poll(async () => {
    const upper = await materialsHeader.boundingBox();
    const lower = await crystalHeader.boundingBox();
    if (!upper || !lower) return 999;
    return Math.round(lower.y - (upper.y + upper.height));
  }).toBeLessThanOrEqual(2);
  await expect.poll(async () => {
    const upper = await crystalHeader.boundingBox();
    const lower = await exchangeHeader.boundingBox();
    if (!upper || !lower) return 999;
    return Math.round(lower.y - (upper.y + upper.height));
  }).toBeLessThanOrEqual(2);

  await page.reload();
  await expect(page.locator('#loadStatus')).toContainText(/patch/);
  await expect(page.locator('#searchBox')).toHaveValue('アリペブレ');
  await expect(page.locator('#countInput')).toHaveValue('6');
  await expect(page.locator('.result-root-summary')).toContainText('アリペブレ');
  await expect(page.locator('#materialsViewBtn')).toHaveClass(/active/);
  await expect(page.locator('.materials-list')).toContainText('ゴールデンイール');
  const restoredIntermediateHeader = page.locator('.materials-section-header').filter({ hasText: '製作する中間素材' });
  const restoredMaterialsHeader = page.locator('.materials-section-header').filter({ hasText: '必要素材' });
  await expect(restoredIntermediateHeader.locator('xpath=following-sibling::*[1]')).toHaveClass(/collapsed/);
  await expect(restoredMaterialsHeader.locator('xpath=following-sibling::*[1]')).toHaveClass(/collapsed/);

  const storedState = await page.evaluate(() => JSON.parse(localStorage.getItem('ff14_view_state_v1')));
  expect(storedState.selected.recipe).toBe('アリペブレ');
  expect(storedState.input.count).toBe('6');
  expect(storedState.view.resultMode).toBe('materials');
  expect(storedState.materials.sections['recipe:アリペブレ:製作する中間素材']).toBe(true);
  expect(storedState.materials.sections['recipe:アリペブレ:必要素材']).toBe(true);
  expect(JSON.stringify(storedState)).not.toContain('ゴールデンイール');
});

test('limits the protected recent-items list to one hundred entries', async ({ page }) => {
  await openApp(page);
  await page.evaluate(async () => {
    const items = await fetch('./data/Item.json').then(response => response.json());
    const itemIds = items
      .map(item => Number(item.ID))
      .filter(id => Number.isInteger(id) && id > 0)
      .slice(0, 101);
    localStorage.setItem('ff14_favorite_lists_v2', JSON.stringify({
      version: 2,
      selectedListId: 'SYSTEM_RECENT_ITEMS',
      lists: [{
        id: 'SYSTEM_RECENT_ITEMS',
        name: '検索履歴',
        itemIds
      }]
    }));
  });
  await page.reload();
  await expect(page.locator('#loadStatus')).toContainText(/patch/);
  await page.locator('#favBtn').click();
  await page.locator('#favoriteLists').getByText('検索履歴', { exact: true }).click();
  await expect(page.locator('#recipeList li.fav-item-row')).toHaveCount(100);
});

test('shows shop info button and dialog for items with ShopInfo', async ({ page }) => {
  await page.route('**/data/Item.json*', async route => {
    const response = await route.fetch();
    const items = await response.json();
    const target = items.find(item => item.Name === 'アリペブレ');
    target.ShopInfo = {
      price: 4,
      shops: [{
        shopName: '素材屋 テスト',
        area: 'リムサ・ロミンサ：下甲板層',
        x: 8.6,
        y: 11.8,
        requiredRank: '1: 中立'
      }, {
        shopName: '通常ショップ テスト',
        area: 'グリダニア：新市街'
      }]
    };
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(items)
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
});

test('purchased intermediate keeps rows visible and marks its unused materials', async ({ page }) => {
  await openApp(page);
  await searchFor(page, 'ブラスバスタードソード');
  await page.getByText('ブラスバスタードソード', { exact: true }).first().click();
  await page.locator('#materialsViewBtn').click();

  const purchasedNode = page.locator('.intermediate-tree-row .material-name').filter({ hasText: /^バスタードソード$/ })
    .locator('xpath=ancestor::li[contains(@class,"intermediate-tree-node")]');
  await expect(purchasedNode).not.toHaveClass(/purchase-selected/);
  await page.locator('#treeContainer').evaluate(element => { element.scrollTop = 120; });
  const scrollBeforePurchase = await page.locator('#treeContainer').evaluate(element => element.scrollTop);
  await purchasedNode.locator('.shop-info-btn').click();
  const option = page.getByLabel('この中間素材は購入💰して用意する');
  await expect(option).not.toBeChecked();
  await expect(page.locator('.shop-purchase-option')).toContainText('1個を購入');
  await expect(page.locator('.shop-purchase-option')).not.toContainText('バスタードソード 1個');
  await expect(option).toHaveCSS('appearance', 'none');
  await expect(option).toHaveCSS('width', '22px');
  await expect(option).toHaveCSS('height', '22px');
  await expect(option).toHaveCSS('background-color', 'rgb(26, 26, 26)');
  const fireShardRow = page.locator('.materials-list li').filter({ hasText: 'ファイアシャード' });
  const earthShardRow = page.locator('.materials-list li').filter({ hasText: 'アースシャード' });
  await expect(fireShardRow.locator('.material-qty')).toHaveText('× 2');
  await expect(earthShardRow.locator('.material-qty')).toHaveText('× 2');
  await option.check();
  await expect(option).toHaveCSS('background-color', 'rgb(200, 168, 75)');
  await expect.poll(() => page.locator('#treeContainer').evaluate(element => element.scrollTop)).toBe(scrollBeforePurchase);
  await page.locator('#shopCloseBtn').click();

  await expect(purchasedNode).toHaveClass(/purchase-selected/);
  await expect(purchasedNode.locator('.purchase-status')).toHaveCount(0);
  await expect(purchasedNode.locator('.shop-info-btn')).toHaveText('💰🛒');
  await expect(fireShardRow.locator('.material-qty')).toHaveText('× 1');
  await expect(earthShardRow.locator('.material-qty')).toHaveText('× 1');
  const lowerIntermediate = page.locator('.intermediate-tree-row .material-name').filter({ hasText: /^メープル材$/ })
    .locator('xpath=ancestor::li[contains(@class,"intermediate-tree-node")]');
  await expect(lowerIntermediate).toHaveClass(/purchase-unneeded/);
  await page.locator('#treeContainer').evaluate(element => { element.scrollTop = 60; });
  const scrollBeforeDisabledDialog = await page.locator('#treeContainer').evaluate(element => element.scrollTop);
  await lowerIntermediate.locator('.shop-info-btn').click();
  await expect(page.getByLabel('この中間素材は購入💰して用意する')).toBeDisabled();
  await expect(page.locator('.shop-purchase-option')).toContainText('現在は購入指定できません');
  await expect(page.locator('.shop-purchase-reason')).toContainText('バスタードソード');
  await page.locator('#shopCloseBtn').click();
  await expect.poll(() => page.locator('#treeContainer').evaluate(element => element.scrollTop)).toBe(scrollBeforeDisabledDialog);
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
  await expect(page.locator('.intermediate-tree-row .material-name').filter({ hasText: /^バスタードソード$/ })
    .locator('xpath=ancestor::li[contains(@class,"intermediate-tree-node")]')).toHaveClass(/purchase-selected/);
  const restoredPurchasedNode = page.locator('.intermediate-tree-row .material-name').filter({ hasText: /^バスタードソード$/ })
    .locator('xpath=ancestor::li[contains(@class,"intermediate-tree-node")]');
  await restoredPurchasedNode.locator('.shop-info-btn').click();
  await expect(page.getByLabel('この中間素材は購入💰して用意する')).toBeChecked();
  await page.getByLabel('この中間素材は購入💰して用意する').uncheck();
  await page.locator('#shopCloseBtn').click();
  await expect(restoredPurchasedNode.locator('.shop-info-btn')).toHaveText('🛒');
});

test('purchased intermediate status is visible on mobile', async ({ page }) => {
  await openApp(page, 423, 780);
  await searchFor(page, 'ブラスバスタードソード');
  await page.getByText('ブラスバスタードソード', { exact: true }).first().click();
  await page.locator('#materialsViewBtn').click();
  const purchasedNode = page.locator('.intermediate-tree-row .material-name').filter({ hasText: /^バスタードソード$/ })
    .locator('xpath=ancestor::li[contains(@class,"intermediate-tree-node")]');
  await purchasedNode.locator('.shop-info-btn').click();
  await page.getByLabel('この中間素材は購入💰して用意する').check();
  await page.locator('#shopCloseBtn').click();
  await expect(page.locator('.materials-list li').filter({ hasText: 'メープル原木' }).locator('.purchase-status'))
    .toBeVisible();
  await page.locator('#appTitle').click();
  await searchFor(page, 'ブラスバスタードソード');
  await page.locator('#recipeList').getByText('ブラスバスタードソード', { exact: true }).click();
  await page.locator('#materialsViewBtn').click();
  const resetNode = page.locator('.intermediate-tree-row .material-name').filter({ hasText: /^バスタードソード$/ })
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
  await expect(page.locator('#loadStatus')).toContainText(/patch/);
  await expect(page.locator('#loadingOverlay')).not.toHaveClass(/open/);
  await expect(page.locator('#searchBox')).toHaveValue('');
  await expect(page.locator('.result-root-summary')).toHaveCount(0);
});

test('favorites and shares an ingredient while preserving search results', async ({ page }) => {
  await openApp(page);
  await searchFor(page, '山羊乳');
  const ingredientRow = page.locator('#recipeList li').filter({ hasText: '山羊乳' }).first();
  await expect(ingredientRow.locator('.pin-btn')).toHaveCount(0);
  await ingredientRow.click();
  await page.locator('#usesList li').first().click();
  const treeIngredient = page.locator('.tree-node').filter({ hasText: '山羊乳' }).last();
  await treeIngredient.locator('.pin-btn').click();
  await expect(page.locator('#favoriteTargetChoices')).not.toContainText('検索履歴');
  await page.locator('#favoriteTargetCreate').getByText('新規作成').click();
  await page.locator('#textInputField').fill('素材お気に入り');
  await page.locator('#textInputOkBtn').click();

  await expect(page.locator('#searchBox')).toHaveValue('山羊乳');
  await expect(page.locator('#recipeList')).toContainText('山羊乳');

  await page.locator('#favBtn').click();
  await page.locator('#favoriteLists').getByText('素材お気に入り').click();
  const favoriteIngredient = page.locator('#recipeList li.fav-item-row');
  await expect(favoriteIngredient).toContainText('使用先');
  await expect(favoriteIngredient).not.toContainText('素材');
  await favoriteIngredient.click();
  await expect(page.locator('#usesTitle')).toContainText('山羊乳');

  await page.locator('#settingsBtn').click();
  await page.locator('#exportListToggle').click();
  await page.locator('#exportListChoices').getByText('素材お気に入り').click();
  const shareCode = await page.locator('#exportCode').inputValue();
  await page.locator('#importCode').fill(shareCode);
  await page.locator('#startImportBtn').click();
  await expect(page.locator('#recipeList')).toContainText('山羊乳');
});

test('reorders favorite lists locally with the rightmost drag handle', async ({ page }) => {
  await openApp(page);

  await searchFor(page, 'バスタードソード');
  await page.getByText('バスタードソード', { exact: true }).first().click();
  await page.locator('.result-root-summary .pin-btn').first().click();
  await page.locator('#favoriteTargetCreate').getByText('新規作成').click();
  await page.locator('#textInputField').fill('リストA');
  await page.locator('#textInputOkBtn').click();

  await searchFor(page, 'アリペブレ');
  await page.getByText('アリペブレ', { exact: true }).first().click();
  await page.locator('.result-root-summary .pin-btn').first().click();
  await page.locator('#favoriteTargetCreate').getByText('新規作成').click();
  await page.locator('#textInputField').fill('リストB');
  await page.locator('#textInputOkBtn').click();

  await page.locator('#favBtn').click();
  const listA = page.locator('#favoriteLists li').filter({ hasText: 'リストA' }).first();
  const listB = page.locator('#favoriteLists li').filter({ hasText: 'リストB' }).first();
  await expect(listA).toHaveCSS('user-select', 'text');
  await expect(listA.locator('.favorite-list-curtain')).not.toHaveClass(/expanded/);
  const nameBoxBefore = await listA.locator('.favorite-list-name').boundingBox();
  await listA.locator('.favorite-list-curtain-toggle').click();
  await expect(listA.locator('.favorite-list-curtain')).toHaveClass(/expanded/);
  await expect(listA).toHaveCSS('user-select', 'none');
  await expect(listA.locator('.favorite-list-curtain')).toHaveCSS('width', '170px');
  await expect(listA.locator('.favorite-list-curtain-toggle')).toHaveText('▶');
  const nameBoxAfter = await listA.locator('.favorite-list-name').boundingBox();
  expect(nameBoxAfter.width).toBeCloseTo(nameBoxBefore.width, 0);
  expect(nameBoxAfter.height).toBeCloseTo(nameBoxBefore.height, 0);

  const actionButtons = listA.locator('.favorite-list-curtain-actions button');
  const firstActionBox = await actionButtons.nth(0).boundingBox();
  const secondActionBox = await actionButtons.nth(1).boundingBox();
  expect(secondActionBox.x - (firstActionBox.x + firstActionBox.width)).toBeGreaterThanOrEqual(firstActionBox.width - 1);

  await dragHandleAfter(page, listA.locator('.reorder-handle'), listB);

  await expect(page.locator('#favoriteLists li').nth(0)).toContainText('検索履歴');
  await expect(page.locator('#favoriteLists li').nth(1)).toContainText('リストB');
  await expect(page.locator('#favoriteLists li').nth(2)).toContainText('リストA');

  await page.reload();
  await openApp(page);
  await page.locator('#favBtn').click();
  await expect(page.locator('#favoriteLists li').nth(0)).toContainText('検索履歴');
  await expect(page.locator('#favoriteLists li').nth(1)).toContainText('リストB');
  await expect(page.locator('#favoriteLists li').nth(2)).toContainText('リストA');
});

test('reorders favorite items locally and changes the exported share code order', async ({ page }) => {
  await openApp(page);

  await searchFor(page, 'バスタードソード');
  await page.getByText('バスタードソード', { exact: true }).first().click();
  await page.locator('.result-root-summary .pin-btn').first().click();
  await page.locator('#favoriteTargetCreate').getByText('新規作成').click();
  await page.locator('#textInputField').fill('並び確認');
  await page.locator('#textInputOkBtn').click();

  await searchFor(page, 'アリペブレ');
  await page.getByText('アリペブレ', { exact: true }).first().click();
  await page.locator('.result-root-summary .pin-btn').first().click();
  await page.locator('#favoriteTargetChoices').getByText('並び確認').click();

  await page.locator('#favBtn').click();
  await page.locator('#favoriteLists').getByText('並び確認').click();
  await expect(page.locator('#recipeList li.fav-item-row').nth(0)).toContainText('バスタードソード');
  await expect(page.locator('#recipeList li.fav-item-row').nth(1)).toContainText('アリペブレ');
  await expect(page.locator('#recipeList li.fav-item-row .reorder-handle')).toHaveCount(0);

  await page.locator('#settingsBtn').click();
  await page.locator('#exportListToggle').click();
  await page.locator('#exportListChoices').getByText('並び確認').click();
  const beforeCode = await page.locator('#exportCode').inputValue();
  await page.locator('#settingsCloseBtn').click();

  await page.locator('.favorite-material-curtain-toggle').click();
  await page.locator('#recipeList .favorite-materials-row').getByText('並び替え').click();
  await expect(page.locator('#recipeList li.fav-item-row .reorder-handle')).toHaveCount(2);
  await expect(page.locator('#recipeList li.fav-item-row').first()).toHaveCSS('user-select', 'none');
  const first = page.locator('#recipeList li.fav-item-row').nth(0);
  const second = page.locator('#recipeList li.fav-item-row').nth(1);
  await dragHandleAfter(page, first.locator('.reorder-handle'), second);
  await expect(page.locator('#recipeList li.fav-item-row').nth(0)).toContainText('アリペブレ');
  await expect(page.locator('#recipeList li.fav-item-row').nth(1)).toContainText('バスタードソード');

  await page.locator('#settingsBtn').click();
  await page.locator('#exportListToggle').click();
  await page.locator('#exportListChoices').getByText('並び確認').click();
  const afterCode = await page.locator('#exportCode').inputValue();
  expect(afterCode).not.toBe(beforeCode);
});

test('favorite list selection clears the recipe view switch', async ({ page }) => {
  await openApp(page);
  await searchFor(page, 'バスタードソード');
  await page.getByText('バスタードソード', { exact: true }).first().click();
  await page.locator('.result-root-summary .pin-btn').first().click();
  await page.locator('#favoriteTargetCreate').getByText('新規作成').click();
  await page.locator('#textInputField').fill('切替確認');
  await page.locator('#textInputOkBtn').click();

  await searchFor(page, 'アリペブレ');
  await page.getByText('アリペブレ', { exact: true }).first().click();
  await expect(page.locator('#resultViewSwitch')).toBeVisible();
  await page.locator('#countIncrease5Btn').click();

  await page.locator('#favBtn').click();
  await page.locator('#favoriteLists').getByText('切替確認').click();
  await expect(page.locator('#countInput')).toHaveValue('1');
  await expect(page.locator('#resultViewSwitch')).toBeHidden();
  await expect(page.locator('#resultTitle')).toHaveText('');
});

test('shows favorite list materials mode with set count and ring toggles', async ({ page }) => {
  await openApp(page);

  await searchFor(page, 'アリペブレ');
  await page.getByText('アリペブレ', { exact: true }).first().click();
  await page.locator('.result-root-summary .pin-btn').first().click();
  await page.locator('#favoriteTargetCreate').getByText('新規作成').click();
  await page.locator('#textInputField').fill('素材確認');
  await page.locator('#textInputOkBtn').click();

  await searchFor(page, 'カッパーリング');
  await page.getByText('カッパーリング', { exact: true }).first().click();
  await page.locator('.result-root-summary .pin-btn').first().click();
  await page.locator('#favoriteTargetChoices').getByText('素材確認').click();

  await page.locator('#favBtn').click();
  await page.locator('#favoriteLists').getByText('素材確認').click();
  await expect(page.locator('#recipeList li.fav-item-row').first().locator('.favorite-item-job')).toHaveClass(/badge-craft/);
  const favoriteItemFontSizes = await page.locator('#recipeList li.fav-item-row').first().evaluate(row => ({
    job: getComputedStyle(row.querySelector('.favorite-item-job')).fontSize,
    name: getComputedStyle(row.querySelector('.favorite-item-name')).fontSize,
  }));
  expect(favoriteItemFontSizes.job).toBe(favoriteItemFontSizes.name);
  await expect(page.locator('.result-header')).toBeHidden();
  await page.locator('#recipeList').getByText('素材リストを表示').click();
  await page.locator('#countIncrease5Btn').click();

  await expect(page.locator('#countLabel')).toHaveText('セット数:');
  await expect(page.locator('#countInput')).toHaveValue('6');
  await expect(page.locator('#materialsViewBtn')).toBeVisible();
  await expect(page.locator('#treeViewBtn')).toBeHidden();
  await expect(page.locator('.favorite-ring-controls')).toContainText('カッパーリング');
  await expect(page.locator('.favorite-ring-separator')).toBeVisible();
  await expect(page.locator('.favorite-ring-toggle button')).toHaveCount(3);
  await expect(page.locator('.favorite-ring-toggle button').filter({ hasText: /^0$/ })).toBeVisible();
  await expect(page.locator('.favorite-ring-toggle')).toContainText('1つ');
  await expect(page.locator('.materials-list')).toContainText('ゴールデンイール');

  const materialsHeader = page.locator('.materials-section-header').filter({ hasText: '必要素材' });
  await materialsHeader.click();
  await expect(materialsHeader.locator('xpath=following-sibling::*[1]')).toHaveClass(/collapsed/);
  await page.locator('.favorite-ring-toggle button').filter({ hasText: '2つ' }).click();
  const rerenderedHeader = page.locator('.materials-section-header').filter({ hasText: '必要素材' });
  await expect(rerenderedHeader.locator('xpath=following-sibling::*[1]')).toHaveClass(/collapsed/);
  await page.reload();
  await expect(page.locator('.favorite-ring-toggle button').filter({ hasText: '2つ' })).toHaveClass(/active/);

  await page.getByText('アリペブレ', { exact: true }).first().click();
  await expect(page.locator('#countLabel')).toHaveText('個数:');
  await expect(page.locator('#countInput')).toHaveValue('1');
  await expect(page.locator('#treeViewBtn')).toBeVisible();
  await expect(page.locator('.favorite-ring-controls')).toHaveCount(0);
});

test('favorite list count mode excludes zero-count items from materials', async ({ page }) => {
  await openApp(page);

  await searchFor(page, 'アリペブレ');
  await page.getByText('アリペブレ', { exact: true }).first().click();
  await page.locator('.result-root-summary .pin-btn').first().click();
  await page.locator('#favoriteTargetCreate').getByText('新規作成').click();
  await page.locator('#textInputField').fill('個数確認');
  await page.locator('#textInputOkBtn').click();

  await searchFor(page, 'カッパーリング');
  await page.getByText('カッパーリング', { exact: true }).first().click();
  await page.locator('.result-root-summary .pin-btn').first().click();
  await page.locator('#favoriteTargetChoices').getByText('個数確認').click();

  await page.locator('#favBtn').click();
  await page.locator('#favoriteLists').getByText('個数確認').click();
  await page.locator('#recipeList').getByText('素材リストを表示').click();
  await page.locator('.favorite-ring-toggle button').filter({ hasText: '2つ' }).click();
  await expect(page.locator('.favorite-ring-toggle button').filter({ hasText: '2つ' })).toHaveClass(/active/);
  await page.locator('#settingsBtn').click();
  await page.locator('#exportListToggle').click();
  await page.locator('#exportListChoices').getByText('個数確認').click();
  const shareCodeBeforeCounts = await page.locator('#exportCode').inputValue();
  await page.locator('#settingsCloseBtn').click();

  await expect(page.locator('.favorite-material-curtain-toggle')).toHaveText('▼');
  await page.locator('.favorite-material-curtain-toggle').click();
  await expect(page.locator('.favorite-material-curtain-toggle')).toHaveText('▲');
  await page.locator('.favorite-material-curtain-actions').getByText('個数指定').click();
  await expect(page.locator('.favorite-item-count-curtain.expanded')).toHaveCount(2);
  await expect(page.locator('#recipeList li.fav-item-row .pin-btn')).toHaveCount(0);
  await expect(page.locator('#countInput')).toBeHidden();
  await expect(page.locator('#countInput')).toBeDisabled();
  const storedCountsWhileEnabled = await page.evaluate(() => localStorage.getItem('ff14_favorite_item_counts_v1'));
  expect(storedCountsWhileEnabled).not.toContain('enabled');

  const aripebreRow = page.locator('#recipeList li.fav-item-row').filter({ hasText: 'アリペブレ' });
  await aripebreRow.locator('.favorite-item-count-controls input').fill('0');
  await aripebreRow.locator('.favorite-item-count-controls input').dispatchEvent('change');
  await expect(aripebreRow).toHaveClass(/favorite-count-zero/);
  await expect(page.locator('#recipeList').getByText('素材リストを表示(1/2)')).toBeVisible();
  await page.locator('#recipeList li.fav-item-row').filter({ hasText: 'カッパーリング' }).click();
  await expect(page.locator('#countLabel')).toHaveText('セット数:');
  await expect(page.locator('#recipeList .favorite-materials-row').getByText('素材リストを表示(1/2)')).toHaveClass(/active/);
  await page.locator('#settingsBtn').click();
  await page.locator('#exportListToggle').click();
  await page.locator('#exportListChoices').getByText('個数確認').click();
  await expect(page.locator('#exportCode')).toHaveValue(shareCodeBeforeCounts);
  await page.locator('#settingsCloseBtn').click();

  await page.locator('#recipeList').getByText('素材リストを表示(1/2)').click();
  await expect(page.locator('.favorite-ring-controls')).toHaveCount(0);
  await expect(page.locator('.favorite-material-root-summary')).toHaveCount(1);
  await expect(page.locator('.favorite-material-root-summary')).toContainText('カッパーリング');
  await expect(page.locator('.favorite-material-root-summary')).not.toContainText('アリペブレ');
  await expect(page.locator('.favorite-material-root-summary .node-icon')).toHaveCSS('width', '40px');
  await expect(page.locator('.materials-list')).toContainText(/カッパーインゴット\s*× 1/);
  await expect(page.locator('.materials-list')).not.toContainText('ゴールデンイール');

  await page.locator('.favorite-material-curtain-actions').getByText('どれでも1つ').click();
  await expect(page.locator('.favorite-material-curtain-actions').getByText('どれでも1つ')).toHaveClass(/active/);
  await expect(page.locator('.favorite-material-curtain-actions').getByText('個数指定')).not.toHaveClass(/active/);
  await expect(page.locator('.favorite-material-curtain-actions').getByText('全てOn')).toBeVisible();
  await expect(page.locator('.favorite-item-count-controls input[type="checkbox"]')).toHaveCount(2);
  await page.locator('.favorite-material-curtain-actions').getByText('全てOn').click();
  await expect(page.locator('.favorite-item-count-controls input[type="checkbox"]:checked')).toHaveCount(2);
  const storedAnyOneTargets = await page.evaluate(() => localStorage.getItem('ff14_favorite_item_counts_v1'));
  expect(storedAnyOneTargets).toContain('anyOneTargets');
  await page.locator('.favorite-material-help-btn').click();
  await expect(page.locator('#licenseTitle')).toContainText('拡張機能について');
  await expect(page.locator('#licenseText')).toContainText('お気に入りリスト内全アイテム');
  await expect(page.locator('#licenseText')).toContainText('セット数分');
  await expect(page.locator('#licenseText')).toContainText('全てを制作する素材リストではありません');
  await page.locator('#licenseCloseBtn').click();
  await expect(page.locator('#countInput')).toBeVisible();
  await expect(page.locator('#countInput')).toBeEnabled();
  await page.locator('#countInput').fill('2');
  await page.locator('#countInput').dispatchEvent('input');
  await page.locator('#countInput').blur();
  await expect(page.locator('#countInput')).toHaveValue('2');
  await page.locator('#recipeList').getByText('素材リストを表示').click();
  await expect(page.locator('.favorite-material-root-summary')).toHaveCount(2);
  await expect(page.locator('.favorite-material-root-or')).toHaveCount(1);
  await expect(page.locator('.favorite-material-root-or')).toHaveText('もしくは');
  await expect(page.locator('.favorite-material-root-summary').filter({ hasText: 'アリペブレ' })).toContainText('× 3');
  await expect(page.locator('.favorite-material-root-summary').filter({ hasText: 'アリペブレ' })).toContainText('余り');
  await expect(page.locator('.favorite-material-root-summary').filter({ hasText: 'カッパーリング' })).toContainText('× 2');
});

test('mobile favorite ring controls keep the count toggle on one right-aligned row', async ({ page }) => {
  await openApp(page, 600, 720);

  await searchFor(page, 'カッパーリング');
  await page.getByText('カッパーリング', { exact: true }).first().click();
  await page.locator('.result-root-summary .pin-btn').first().click();
  await page.locator('#favoriteTargetCreate').getByText('新規作成').click();
  await page.locator('#textInputField').fill('指輪確認');
  await page.locator('#textInputOkBtn').click();
  await page.locator('#mobileBackBtn').click();
  await page.locator('#favBtn').click();
  await page.locator('#favoriteLists').getByText('指輪確認').click();
  await page.locator('#recipeList').getByText('素材リストを表示').click();

  const rowBox = await page.locator('.favorite-ring-row').first().boundingBox();
  const nameBox = await page.locator('.favorite-ring-name').first().boundingBox();
  const toggleBox = await page.locator('.favorite-ring-toggle').first().boundingBox();
  const buttonTops = await page.locator('.favorite-ring-toggle button').evaluateAll(buttons =>
    buttons.map(button => button.getBoundingClientRect().top)
  );
  expect(rowBox).toBeTruthy();
  expect(nameBox).toBeTruthy();
  expect(toggleBox).toBeTruthy();
  expect(buttonTops).toHaveLength(3);
  expect(Math.max(...buttonTops) - Math.min(...buttonTops)).toBeLessThan(1);
  expect(Math.abs((toggleBox.x + toggleBox.width) - (rowBox.x + rowBox.width))).toBeLessThanOrEqual(2);
  expect(toggleBox.y).toBeLessThan(nameBox.y + nameBox.height);
});

test('mobile pin turns active after adding to a favorite list', async ({ page }) => {
  await openApp(page, 600, 700);
  await searchFor(page, 'バスタードソード');
  await page.getByText('バスタードソード', { exact: true }).first().click();
  await expect(page.locator('#mobileBackBtn')).toBeVisible();
  await expect(page.locator('#backBtn')).toBeHidden();
  const titleBox = await page.locator('#appTitle').boundingBox();
  const mobileBackBox = await page.locator('#mobileBackBtn').boundingBox();
  const settingsBox = await page.locator('#settingsBtn').boundingBox();
  const primaryRowBox = await page.locator('.header-primary-row').boundingBox();
  expect(titleBox.y).toBeLessThan(mobileBackBox.y);
  expect(mobileBackBox.x).toBeLessThan(settingsBox.x);
  expect(Math.abs(
    (primaryRowBox.x + primaryRowBox.width / 2) - 300
  )).toBeLessThan(1);
  expect(Math.abs(
    (mobileBackBox.y + mobileBackBox.height / 2) - (settingsBox.y + settingsBox.height / 2)
  )).toBeLessThan(1);
  await expect(page.locator('#mobileBackBtn')).toHaveCSS('font-size', '15px');

  const pin = page.locator('.result-root-summary .pin-btn').first();
  await expect(pin).toHaveClass(/inactive/);
  await pin.click();
  await page.locator('#favoriteTargetCreate').getByText('新規作成').click();
  await page.locator('#textInputField').fill('スマホ確認');
  await page.locator('#textInputOkBtn').click();

  await expect(pin).not.toHaveClass(/inactive/);

  await page.locator('#appTitle').click();
  await searchFor(page, 'アリペブレ');
  await page.getByText('アリペブレ', { exact: true }).first().click();
  const secondPin = page.locator('.result-root-summary .pin-btn').first();
  await secondPin.click();
  await page.locator('#favoriteTargetChoices').getByText('スマホ確認').click();
  await expect(page.locator('#confirmMsg')).toContainText('「スマホ確認」に登録しますか？');
  await page.locator('#confirmNo').click();
  await expect(page.locator('#favoriteTargetOverlay')).toHaveClass(/open/);
  await expect(secondPin).toHaveClass(/inactive/);

  await page.locator('#favoriteTargetChoices').getByText('スマホ確認').click();
  await page.locator('#confirmYes').click();
  await expect(secondPin).not.toHaveClass(/inactive/);

  await page.locator('#panelRight').evaluate(panel => { panel.scrollTop = 100; });
  await page.locator('#mobileBackBtn').click();
  await page.locator('#favBtn').click();
  await page.locator('#favoriteLists').getByText('スマホ確認').click();
  await expect(page.locator('#recipeList')).toHaveCSS('overflow-y', 'auto');
  await expect(page.locator('#panelLeft')).toHaveCSS('min-height', '0px');
  const materialsButton = page.locator('#recipeList .favorite-materials-row').getByText('素材リストを表示');
  await materialsButton.click();
  await expect(materialsButton).toHaveClass(/active/);
  await expect.poll(() => page.locator('#panelRight').evaluate(panel => panel.scrollTop)).toBe(0);
  await page.locator('#mobileBackBtn').click();
  await expect(page.locator('#recipeList .favorite-materials-row').getByText('素材リストを表示')).not.toHaveClass(/active/);
});

test('mobile panels align list actions and scroll on the intended element', async ({ page }) => {
  await openApp(page, 423, 780);
  await searchFor(page, '岩塩');

  const saltRow = page.locator('#recipeList li').filter({ has: page.getByText('岩塩', { exact: true }) }).first();
  const leftRowBox = await saltRow.boundingBox();
  const actionBox = await saltRow.locator('.item-action-buttons').boundingBox();
  expect(leftRowBox).toBeTruthy();
  expect(actionBox).toBeTruthy();
  expect((leftRowBox.x + leftRowBox.width) - (actionBox.x + actionBox.width)).toBeLessThanOrEqual(16);

  const leftMetrics = await page.locator('#panelLeft').evaluate(panel => {
    const list = panel.querySelector('#recipeList');
    return {
      panelOverflowY: getComputedStyle(panel).overflowY,
      listOverflowY: getComputedStyle(list).overflowY,
      widthDiff: Math.abs(panel.clientWidth - list.offsetWidth)
    };
  });
  expect(leftMetrics.panelOverflowY).toBe('hidden');
  expect(leftMetrics.listOverflowY).toBe('auto');
  expect(leftMetrics.widthDiff).toBeLessThanOrEqual(1);

  await saltRow.locator('.uses-list-btn').click();
  const middleMetrics = await page.locator('#panelMiddle').evaluate(panel => {
    const list = panel.querySelector('#usesList');
    return {
      panelOverflowY: getComputedStyle(panel).overflowY,
      listOverflowY: getComputedStyle(list).overflowY,
      widthDiff: Math.abs(panel.clientWidth - list.offsetWidth)
    };
  });
  expect(middleMetrics.panelOverflowY).toBe('hidden');
  expect(middleMetrics.listOverflowY).toBe('auto');
  expect(middleMetrics.widthDiff).toBeLessThanOrEqual(1);

  await page.locator('#mobileBackBtn').click();
  await page.setViewportSize({ width: 423, height: 520 });
  await searchFor(page, 'バスタードソード');
  await page.getByText('バスタードソード', { exact: true }).first().click();
  const rightMetrics = await page.locator('#panelRight').evaluate(panel => {
    panel.scrollTop = 100;
    return {
      overflowY: getComputedStyle(panel).overflowY,
      scrollTop: panel.scrollTop,
      scrollHeight: panel.scrollHeight,
      clientHeight: panel.clientHeight
    };
  });
  expect(rightMetrics.overflowY).toBe('auto');
  expect(rightMetrics.scrollHeight).toBeGreaterThan(rightMetrics.clientHeight);
  expect(rightMetrics.scrollTop).toBeGreaterThan(0);
  await page.locator('#mobileBackBtn').click();
  await searchFor(page, 'アリペブレ');
  await page.getByText('アリペブレ', { exact: true }).first().click();
  await expect.poll(() => page.locator('#panelRight').evaluate(panel => panel.scrollTop)).toBe(0);
});

test('selecting an item in the left panel closes and resets the middle panel', async ({ page }) => {
  await openApp(page);
  await searchFor(page, '岩塩');
  await page.locator('#recipeList li').filter({ has: page.getByText('岩塩', { exact: true }) }).first().locator('.uses-list-btn').click();
  await expect(page.locator('#panelMiddle')).toHaveClass(/open/);
  await page.locator('#usesList').evaluate(list => { list.scrollTop = list.scrollHeight; });

  await searchFor(page, 'バスタードソード');
  await page.getByText('バスタードソード', { exact: true }).first().click();
  await expect(page.locator('#panelMiddle')).not.toHaveClass(/open/);
  await expect.poll(() => page.locator('#usesList').evaluate(list => list.scrollTop)).toBe(0);
});

test('combined favorite materials opens directly without confirmation dialog', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('ff14_favorite_lists_v2', JSON.stringify({
      version: 2,
      selectedListId: 'list-defense',
      lists: [
        {
          id: 'list-defense',
          name: 'コートリーブーツ・ディフェンダー',
          itemIds: [1602],
          materialSelected: true
        },
        {
          id: 'list-healer',
          name: 'コートリーブーツ・ヒーラー',
          itemIds: [4422],
          materialSelected: true
        }
      ]
    }));
  });

  await openApp(page, 423, 780);
  await page.locator('#checkedFavoriteMaterialsBtn').click();
  await expect(page.locator('#confirmOverlay')).not.toHaveClass(/open/);
  await expect(page.locator('.favorite-list-root-summary').filter({ hasText: 'コートリーブーツ・ディフェンダー' })).toBeVisible();
  await expect(page.locator('.favorite-list-root-summary').filter({ hasText: 'コートリーブーツ・ヒーラー' })).toBeVisible();
});

test('checked favorite lists use a dedicated combined materials entry and reset on main navigation', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('ff14_favorite_lists_v2', JSON.stringify({
      version: 2,
      selectedListId: 'list-defense',
      lists: [
        {
          id: 'list-defense',
          name: 'コートリーブーツ・ディフェンダー',
          itemIds: [1602],
          materialSelected: true
        },
        {
          id: 'list-healer',
          name: 'コートリーブーツ・ヒーラー',
          itemIds: [4422],
          materialSelected: true
        }
      ]
    }));
  });

  await openApp(page, 423, 780);
  await expect(page.locator('#checkedFavoriteMaterialsActions')).toHaveClass(/visible/);
  await expect(page.locator('#checkedFavoriteMaterialsBtn')).toBeVisible();
  await expect(page.locator('#clearFavoriteMaterialChecksBtn')).toBeVisible();
  const actionColor = await page.locator('#checkedFavoriteMaterialsBtn').evaluate(el => getComputedStyle(el).color);
  await expect(page.locator('#clearFavoriteMaterialChecksBtn')).toHaveCSS('color', actionColor);
  await expect(page.locator('#checkedFavoriteMaterialsBtn')).toContainText('チェックしたお気に入りリストの合算素材リスト');

  await page.locator('#checkedFavoriteMaterialsBtn').click();
  await expect(page.locator('#confirmOverlay')).not.toHaveClass(/open/);
  await expect(page.locator('.favorite-list-root-summary').filter({ hasText: 'コートリーブーツ・ディフェンダー' })).toBeVisible();
  await expect(page.locator('.favorite-list-root-summary').filter({ hasText: 'コートリーブーツ・ヒーラー' })).toBeVisible();

  await page.locator('#appTitle').click();
  await expect(page.locator('#checkedFavoriteMaterialsActions')).not.toHaveClass(/visible/);
  await page.locator('#favBtn').click();
  await expect(page.locator('#favoriteLists')).toHaveClass(/open/);
  await expect(page.locator('#favoriteLists .favorite-list-material-checkbox:checked')).toHaveCount(0);

  await page.locator('#favoriteLists .favorite-list-material-checkbox').first().check();
  await expect(page.locator('#checkedFavoriteMaterialsActions')).toHaveClass(/visible/);
  await page.locator('#clearFavoriteMaterialChecksBtn').click();
  await expect(page.locator('#checkedFavoriteMaterialsActions')).not.toHaveClass(/visible/);
  await expect(page.locator('#favoriteLists .favorite-list-material-checkbox:checked')).toHaveCount(0);

  if (!await page.locator('#favoriteLists').evaluate(list => list.classList.contains('open'))) {
    await page.locator('#favBtn').click();
    await expect(page.locator('#favoriteLists')).toHaveClass(/open/);
  }
  await page.locator('#favoriteLists .favorite-list-material-checkbox').first().check();
  await expect(page.locator('#checkedFavoriteMaterialsActions')).toHaveClass(/visible/);
  await searchFor(page, 'バスタードソード');
  await page.getByText('バスタードソード', { exact: true }).first().click();
  await expect(page.locator('#checkedFavoriteMaterialsActions')).not.toHaveClass(/visible/);
  await page.locator('#mobileBackBtn').click();
  await page.locator('#favBtn').click();
  await expect(page.locator('#favoriteLists')).toHaveClass(/open/);
  await expect(page.locator('#favoriteLists .favorite-list-material-checkbox:checked')).toHaveCount(0);
});

test('combined favorite materials supports ring count toggles and restores them', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('ff14_favorite_lists_v2', JSON.stringify({
      version: 2,
      selectedListId: 'list-ring-a',
      lists: [
        {
          id: 'list-ring-a',
          name: '指輪A',
          itemIds: [4422],
          materialSelected: true
        },
        {
          id: 'list-ring-b',
          name: '指輪B',
          itemIds: [4422],
          materialSelected: true
        }
      ]
    }));
  });

  await openApp(page, 423, 780);
  await page.locator('#checkedFavoriteMaterialsBtn').click();
  await expect(page.locator('.favorite-ring-controls')).toContainText('カッパーリング');
  const listBox = await page.locator('.favorite-list-root-summary').last().boundingBox();
  const ringBox = await page.locator('.favorite-ring-controls').boundingBox();
  expect(listBox).toBeTruthy();
  expect(ringBox).toBeTruthy();
  expect(ringBox.y).toBeGreaterThanOrEqual(listBox.y + listBox.height - 1);
  await page.locator('.favorite-ring-toggle button').filter({ hasText: /^0$/ }).click();
  await expect(page.locator('.favorite-ring-toggle button').filter({ hasText: /^0$/ })).toHaveClass(/active/);
  await expect(page.locator('.materials-list')).not.toContainText('銅鉱');

  await page.reload();
  await expect(page.locator('#loadingOverlay')).not.toHaveClass(/open/);
  await expect(page.locator('.favorite-ring-toggle button').filter({ hasText: /^0$/ })).toHaveClass(/active/);
  await page.locator('.favorite-ring-toggle button').filter({ hasText: '2つ' }).click();
  await expect(page.locator('.favorite-ring-toggle button').filter({ hasText: '2つ' })).toHaveClass(/active/);
  await expect(page.locator('.materials-list')).toContainText(/銅鉱\s*×\s*12/);

  await page.reload();
  await expect(page.locator('#loadingOverlay')).not.toHaveClass(/open/);
  await expect(page.locator('.favorite-ring-controls')).toContainText('カッパーリング');
  await expect(page.locator('.favorite-ring-toggle button').filter({ hasText: '2つ' })).toHaveClass(/active/);
  await expect(page.locator('.materials-list')).toContainText(/銅鉱\s*×\s*12/);
});

test('favorite dropdown max height stays within the viewport with checked-list buttons', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('ff14_favorite_lists_v2', JSON.stringify({
      version: 2,
      selectedListId: null,
      lists: Array.from({ length: 40 }, (_, index) => ({
        id: `list-${index}`,
        name: `お気に入りリスト${index + 1}`,
        itemIds: [1602],
        materialSelected: index < 2
      }))
    }));
  });

  await openApp(page, 423, 780);
  await page.locator('#favBtn').click();
  await page.waitForTimeout(250);
  const dropdown = await page.locator('#favoriteLists').evaluate(list => {
    const rect = list.getBoundingClientRect();
    return {
      bottom: rect.bottom,
      maxHeight: Number.parseFloat(getComputedStyle(list).maxHeight)
    };
  });
  expect(dropdown.bottom).toBeLessThanOrEqual(780 - 10);
  const maxHeight = dropdown.maxHeight;
  expect(maxHeight).toBeLessThanOrEqual(Math.floor(780 * 0.7) + 2);
  expect(maxHeight).toBeGreaterThan(250);
});

test('equipment search lists target gear and saves results as a favorite list', async ({ page }) => {
  await openApp(page);

  await page.locator('#equipmentSearchToggle').click();
  await expect(page.locator('#equipmentSearchToggle')).toHaveText('▲');
  await expect(page.locator('#searchBox')).toBeDisabled();
  await expect(page.locator('#equipmentJobSelect')).toContainText('剣術士');
  await chooseCustomOption(page, 'equipmentJobSelect', 'ナイト');
  await page.locator('#equipmentLevelInput').fill('100');
  await page.locator('#equipmentLevelInput').dispatchEvent('input');
  await chooseCustomOption(page, 'equipmentItemLevelSelect', '770');
  await page.locator('#equipmentSearchBtn').click();
  await expect(page.locator('#equipmentSearchingOverlay')).toHaveCount(0);

  await expect(page.locator('#recipeList')).toContainText('コートリーラヴァー・ソード');
  await expect(page.locator('#recipeList')).toContainText('コートリーラヴァー・ディフェンダーリング');
  await expect(page.locator('#recipeList .item-list-badges').first()).toContainText('Lv100/IL770');
  await expect(page.locator('#recipeList')).not.toContainText('装備Lv100');
  await expect(page.locator('#saveEquipmentSearchBtn')).toBeEnabled();

  await page.locator('#saveEquipmentSearchBtn').click();
  await expect(page.locator('#textInputField')).toHaveValue('ナイト:装備Lv100:IL770');
  await page.locator('#textInputOkBtn').click();
  await expect(page.locator('#equipmentSearchPanel')).not.toHaveClass(/open/);
  await expect(page.locator('#favBtn')).toContainText('ナイト:装備Lv100:IL770');
  await expect(page.locator('#recipeList')).toContainText('コートリーラヴァー・ソード');
});

test('equipment search uses custom dropdowns and recommended roles', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('.equipment-search-grid select')).toHaveCount(0);
  await page.locator('#equipmentSearchToggle').click();
  await expect(page.locator('#equipmentSearchToggle')).toHaveCSS('width', '26px');
  await expect(page.locator('#favBtn')).toBeHidden();
  await expect(page.locator('#checkedFavoriteMaterialsActions')).toBeHidden();
  await expect(page.locator('#equipmentSearchPanel')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

  await expect(page.locator('#equipmentJobSelect')).toHaveAttribute('data-value', '');
  await expect(page.locator('#equipmentJobSelect')).toContainText('---');
  await expect(page.locator('#equipmentLevelInput')).toHaveJSProperty('value', await page.locator('#equipmentLevelInput').getAttribute('max'));
  await expect(page.locator('#equipmentItemLevelSelect')).toHaveAttribute('data-value', '');
  await expect(page.locator('#equipmentSearchBtn')).toBeDisabled();
  const levelBeforeBlankClick = await page.locator('#equipmentLevelInput').inputValue();
  await page.locator('.equipment-search-field > span').click({ position: { x: 120, y: 5 } });
  await expect(page.locator('#equipmentLevelInput')).toHaveValue(levelBeforeBlankClick);
  const jobBox = await page.locator('#equipmentJobSelect').boundingBox();
  const itemLevelBox = await page.locator('#equipmentItemLevelSelect').boundingBox();
  expect(jobBox).toBeTruthy();
  expect(itemLevelBox).toBeTruthy();
  expect(Math.abs(jobBox.x - itemLevelBox.x)).toBeLessThan(1);
  expect(Math.abs(jobBox.width - itemLevelBox.width)).toBeLessThan(1);

  await chooseCustomOption(page, 'equipmentJobSelect', '幻術士');
  await expect(page.locator('#equipmentSlotSelect .custom-select-option[data-value="shield"]')).toHaveCount(1);
  await expect(page.locator('#equipmentSlotSelect .custom-select-option[data-value="mainTool"]')).toHaveCount(0);
  await page.locator('#equipmentLevelInput').fill('16');
  await page.locator('#equipmentLevelInput').dispatchEvent('input');
  await chooseCustomOption(page, 'equipmentItemLevelSelect', '16');
  await page.locator('#equipmentSearchBtn').click();
  await expect(page.locator('#recipeList')).toContainText('ブラスリストレット');
  await expect(page.locator('#recipeList')).not.toContainText('ブラスゴルゲット');

  await page.locator('#equipmentLevelInput').fill('45');
  await page.locator('#equipmentLevelInput').dispatchEvent('input');
  await expect(page.locator('#equipmentItemLevelSelect .custom-select-option[data-value="48"]')).toHaveCount(1);
  await expect(page.locator('#equipmentItemLevelSelect')).toHaveAttribute('data-value', '48');
  await page.locator('#equipmentLevelInput').fill('46');
  await page.locator('#equipmentLevelInput').dispatchEvent('input');
  await expect(page.locator('#equipmentItemLevelSelect .custom-select-option[data-value="48"]')).toHaveCount(1);
  await expect(page.locator('#equipmentItemLevelSelect')).toHaveAttribute('data-value', '48');
  await page.locator('#equipmentLevelInput').fill('16');
  await page.locator('#equipmentLevelInput').dispatchEvent('input');

  await chooseCustomOption(page, 'equipmentJobSelect', '剣術士');
  await expect(page.locator('#equipmentSlotSelect .custom-select-option[data-value="shield"]')).toHaveCount(1);
  await chooseCustomOption(page, 'equipmentItemLevelSelect', '16');
  await page.locator('#equipmentSearchBtn').click();
  await expect(page.locator('#recipeList')).toContainText('ブラスゴルゲット');
  await expect(page.locator('#recipeList')).not.toContainText('ブラスリストレット');

  await chooseCustomOption(page, 'equipmentJobSelect', 'ナイト');
  await expect(page.locator('#equipmentSlotSelect .custom-select-option[data-value="shield"]')).toHaveCount(1);
  await chooseCustomOption(page, 'equipmentJobSelect', '木工師');
  await expect(page.locator('#equipmentSlotSelect .custom-select-option[data-value="mainTool"]')).toHaveCount(1);
  await expect(page.locator('#equipmentSlotSelect .custom-select-option[data-value="offTool"]')).toHaveCount(1);

  await chooseCustomOption(page, 'equipmentJobSelect', '白魔道士');
  await page.locator('#equipmentLevelInput').fill('50');
  await page.locator('#equipmentLevelInput').dispatchEvent('input');
  await chooseCustomOption(page, 'equipmentItemLevelSelect', '115');
  await chooseCustomOption(page, 'equipmentSlotSelect', 'all');
  await page.locator('#equipmentSearchBtn').click();
  await expect(page.locator('#recipeList')).toContainText('アゲートヒーラーリング');
  await expect(page.locator('#recipeList')).not.toContainText('トルマリンリング');

  await chooseCustomOption(page, 'equipmentJobSelect', '呪術士');
  await page.locator('#equipmentLevelInput').fill('30');
  await page.locator('#equipmentLevelInput').dispatchEvent('input');
  await chooseCustomOption(page, 'equipmentItemLevelSelect', '29');
  await page.locator('#equipmentSearchBtn').click();
  await expect(page.locator('#recipeList')).toContainText('ダンビュライトイヤリング');
  await expect(page.locator('#recipeList')).not.toContainText('ラピスラズリイヤリング');

  await chooseCustomOption(page, 'equipmentJobSelect', '巴術士');
  await page.locator('#equipmentLevelInput').fill('29');
  await page.locator('#equipmentLevelInput').dispatchEvent('input');
  await chooseCustomOption(page, 'equipmentItemLevelSelect', '29');
  await page.locator('#equipmentSearchBtn').click();
  await expect(page.locator('#recipeList')).toContainText('ダンビュライトイヤリング');
  await expect(page.locator('#recipeList')).not.toContainText('ラピスラズリイヤリング');
});

test('desktop left panel widens only on large layouts', async ({ page }) => {
  await openApp(page, 1024, 800);
  await expect(page.locator('#panelLeft')).toHaveCSS('width', '336px');
  const setupDuration = await page.evaluate(() => performance.getEntriesByName('application-data-setup')[0]?.duration);
  expect(setupDuration).toBeLessThan(2500);
  await page.setViewportSize({ width: 800, height: 800 });
  await expect(page.locator('#panelLeft')).toHaveCSS('width', '280px');
});

test('equipment custom dropdown stays inside a mobile viewport', async ({ page }) => {
  await openApp(page, 423, 780);
  await page.locator('#equipmentSearchToggle').click();
  await page.locator('#equipmentJobSelect .custom-select-toggle').click();
  const rect = await page.locator('#equipmentJobSelect .custom-select-options').boundingBox();
  expect(rect).toBeTruthy();
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.y).toBeGreaterThanOrEqual(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(423);
  expect(rect.y + rect.height).toBeLessThanOrEqual(780);
});

test('short search runs on blur and clear button resets it', async ({ page }) => {
  await openApp(page);
  await page.locator('#searchBox').fill('岩塩');
  await expect(page.locator('#recipeList')).not.toContainText('岩塩');
  await page.locator('#searchBox').blur();
  await expect(page.locator('#recipeList li').first()).toContainText('岩塩');
  await page.locator('#searchClearBtn').click();
  await expect(page.locator('#searchBox')).toHaveValue('');
  await expect(page.locator('#recipeList')).toContainText('該当するレシピがありません');
});

test('updated search results and result views return to the top', async ({ page }) => {
  await openApp(page);
  await searchFor(page, 'コートリー');
  await page.locator('#recipeList').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await searchFor(page, '岩塩');
  await expect.poll(() => page.locator('#recipeList').evaluate(element => element.scrollTop)).toBe(0);

  await searchFor(page, 'アリペブレ');
  await page.getByText('アリペブレ', { exact: true }).first().click();
  await page.locator('#treeContainer').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await page.locator('#materialsViewBtn').click();
  await expect.poll(() => page.locator('#treeContainer').evaluate(element => element.scrollTop)).toBe(0);
});

test('equipment search item levels update by job and restore after reload', async ({ page }) => {
  await openApp(page);

  await page.locator('#equipmentSearchToggle').click();
  await chooseCustomOption(page, 'equipmentJobSelect', '竜騎士');
  await page.locator('#equipmentLevelInput').fill('100');
  await page.locator('#equipmentLevelInput').dispatchEvent('input');
  await expect(page.locator('#equipmentItemLevelSelect')).toHaveAttribute('data-value', '770');

  await chooseCustomOption(page, 'equipmentJobSelect', '木工師');
  await expect(page.locator('#equipmentItemLevelSelect')).toHaveAttribute('data-value', '750');
  await expect(page.locator('#equipmentItemLevelSelect .custom-select-option[data-value="770"]')).toHaveCount(0);
  await page.locator('#equipmentSearchBtn').click();
  await expect(page.locator('#recipeList')).toContainText('ゴールデンサム・ソー');

  await page.reload();
  await expect(page.locator('#loadingOverlay')).not.toHaveClass(/open/);
  await expect(page.locator('#equipmentSearchPanel')).toHaveClass(/open/);
  await expect(page.locator('#searchBox')).toBeDisabled();
  await expect(page.locator('#equipmentJobSelect')).toHaveAttribute('data-value', '木工師');
  await expect(page.locator('#equipmentLevelInput')).toHaveValue('100');
  await expect(page.locator('#equipmentItemLevelSelect')).toHaveAttribute('data-value', '750');
  await expect(page.locator('#recipeList')).toContainText('ゴールデンサム・ソー');

  await page.locator('#equipmentSearchResetBtn').click();
  await expect(page.locator('#equipmentJobSelect')).toHaveAttribute('data-value', '');
  await expect(page.locator('#equipmentSlotSelect')).toHaveAttribute('data-value', 'all');
  await expect(page.locator('#equipmentLevelInput')).toHaveValue('100');
  await expect(page.locator('#equipmentItemLevelSelect')).toHaveAttribute('data-value', '');
  await expect(page.locator('#equipmentSearchBtn')).toBeDisabled();
  await page.reload();
  await expect(page.locator('#equipmentJobSelect')).toHaveAttribute('data-value', '');
  await expect(page.locator('#equipmentLevelInput')).toHaveValue('100');
  await expect(page.locator('#equipmentItemLevelSelect')).toHaveAttribute('data-value', '');
  await expect(page.locator('#equipmentSearchBtn')).toBeDisabled();
  await chooseCustomOption(page, 'equipmentJobSelect', '剣術士');
  await page.locator('#equipmentLevelInput').fill('100');
  await page.locator('#equipmentLevelInput').dispatchEvent('input');
  await expect(page.locator('#equipmentLevelInput')).toHaveValue('100');
  await expect(page.locator('#equipmentItemLevelSelect')).not.toHaveAttribute('data-value', '');
  await page.locator('#equipmentLevelDown5Btn').click();
  await expect(page.locator('#equipmentLevelInput')).toHaveValue('95');
  await page.locator('#equipmentLevelUp5Btn').click();
  await expect(page.locator('#equipmentLevelInput')).toHaveValue('100');
  const levelInputWidth = await page.locator('#equipmentLevelInput').evaluate(element => element.getBoundingClientRect().width);
  expect(levelInputWidth).toBeGreaterThanOrEqual(42);
});

test('equipment search excludes bait from web search targets', async ({ page }) => {
  await openApp(page);

  await page.locator('#equipmentSearchToggle').click();
  await chooseCustomOption(page, 'equipmentJobSelect', '漁師');
  await page.locator('#equipmentLevelInput').fill('5');
  await page.locator('#equipmentLevelInput').dispatchEvent('input');

  await expect(page.locator('#equipmentItemLevelSelect .custom-select-option[data-value="5"]')).toHaveCount(0);
  await expect(page.locator('#equipmentSearchBtn')).toBeDisabled();
});

test('equipment search does not mix all-class crafter gear into battle class results', async ({ page }) => {
  await openApp(page);

  await page.locator('#equipmentSearchToggle').click();
  await chooseCustomOption(page, 'equipmentJobSelect', '幻術士');
  await page.locator('#equipmentLevelInput').fill('40');
  await page.locator('#equipmentLevelInput').dispatchEvent('input');

  await expect(page.locator('#equipmentItemLevelSelect .custom-select-option[data-value="43"]')).toHaveCount(0);
});

test('equipment search keeps classes separate and falls back per slot', async ({ page }) => {
  await page.route('**/data/Item.json*', async route => {
    const response = await route.fetch();
    const items = (await response.json()).filter(item => !item.EquipmentInfo);
    const equipment = (ID, Name, category, jobs, equipLevel, itemLevel) => ({
      ID, Name, Patch: 750, IconFile: '000000.webp', ItemUICategoryName: category,
      EquipmentInfo: {
        jobs, equipLevel, itemLevel,
        stats: { STR: 1, DEX: 0, VIT: 1, INT: 0, MND: 0 },
        performance: { physicalDamage: 99999, magicalDamage: 0, physicalDefense: 99999, magicalDefense: 99999 }
      }
    });
    items.push(
      equipment('990001', '試験用剣術士頭', '頭防具', ['剣術士'], 50, 115),
      equipment('990002', '試験用ナイト頭', '頭防具', ['ナイト'], 50, 115),
      equipment('990003', '試験用ナイト足・最高', '足防具', ['ナイト'], 49, 90),
      equipment('990004', '試験用ナイト足・低IL', '足防具', ['ナイト'], 49, 80),
      equipment('990005', '試験用公式順頭', '頭防具', ['吟遊詩人', 'ナイト'], 50, 115),
      equipment('990006', '試験用両手呪具', '両手呪具', ['呪術士'], 30, 100),
      equipment('990007', '試験用呪術盾', '盾', ['呪術士'], 30, 100)
    );
    await route.fulfill({ response, contentType: 'application/json', body: JSON.stringify(items) });
  });
  await openApp(page);
  await page.locator('#equipmentSearchToggle').click();
  await chooseCustomOption(page, 'equipmentJobSelect', '剣術士');
  await page.locator('#equipmentLevelInput').fill('50');
  await page.locator('#equipmentLevelInput').dispatchEvent('input');
  await chooseCustomOption(page, 'equipmentItemLevelSelect', '115');
  await page.locator('#equipmentSearchBtn').click();
  await expect(page.locator('#recipeList')).toContainText('試験用剣術士頭');
  await expect(page.locator('#recipeList')).not.toContainText('試験用ナイト頭');

  await chooseCustomOption(page, 'equipmentJobSelect', 'ナイト');
  await chooseCustomOption(page, 'equipmentItemLevelSelect', '115');
  await page.locator('#equipmentSearchBtn').click();
  await expect(page.locator('#recipeList')).toContainText('試験用ナイト頭');
  await expect(page.locator('#recipeList li').filter({ hasText: '試験用公式順頭' }).locator('.badge-equipment-job')).toHaveText('ナ詩');
  await expect(page.locator('#recipeList')).toContainText('試験用ナイト足・最高');
  await expect(page.locator('#recipeList')).not.toContainText('試験用ナイト足・低IL');
  await expect(page.locator('#recipeList')).not.toContainText('試験用剣術士頭');

  await chooseCustomOption(page, 'equipmentJobSelect', '呪術士');
  await page.locator('#equipmentLevelInput').fill('30');
  await page.locator('#equipmentLevelInput').dispatchEvent('input');
  await chooseCustomOption(page, 'equipmentItemLevelSelect', '100');
  await page.locator('#equipmentSearchBtn').click();
  await expect(page.locator('#recipeList')).toContainText('試験用両手呪具');
  await expect(page.locator('#recipeList')).not.toContainText('試験用呪術盾');
  await chooseCustomOption(page, 'equipmentSlotSelect', 'shield');
  await page.locator('#equipmentSearchBtn').click();
  await expect(page.locator('#recipeList')).toContainText('試験用呪術盾');
});

test('equipment search prefers tenacity or piety and shows only differing tied parameters', async ({ page }) => {
  await page.route('**/data/Item.json*', async route => {
    const response = await route.fetch();
    const items = await response.json();
    const equipment = (ID, Name, defense, stats) => ({
      ID, Name, IconFile: '000000.webp', ItemUICategoryName: '頭防具',
      EquipmentInfo: {
        jobs: ['ナイト'], equipLevel: 50, itemLevel: 999,
        stats,
        performance: { physicalDamage: 0, magicalDamage: 0, physicalDefense: defense, magicalDefense: defense }
      }
    });
    items.push(
      equipment('990011', '試験用低防御頭', 9000, { STR: 1, VIT: 1 }),
      equipment('990012', '試験用専門なし頭', 9999, { STR: 9, VIT: 9 }),
      equipment('990013', '試験用同値頭A', 9999, { STR: 9, VIT: 9, 不屈: 6, DEX: 3 }),
      equipment('990014', '試験用同値頭B', 9999, { STR: 9, VIT: 9, 不屈: 6, MND: 4 })
    );
    await route.fulfill({ response, contentType: 'application/json', body: JSON.stringify(items) });
  });
  await openApp(page);
  await page.locator('#equipmentSearchToggle').click();
  await chooseCustomOption(page, 'equipmentJobSelect', 'ナイト');
  await page.locator('#equipmentLevelInput').fill('50');
  await page.locator('#equipmentLevelInput').dispatchEvent('input');
  await chooseCustomOption(page, 'equipmentItemLevelSelect', '999');
  await chooseCustomOption(page, 'equipmentSlotSelect', 'head');
  await page.locator('#equipmentSearchBtn').click();

  await expect(page.locator('#recipeList')).not.toContainText('試験用低防御頭');
  await expect(page.locator('#recipeList')).not.toContainText('試験用専門なし頭');
  await expect(page.locator('#recipeList')).toContainText('試験用同値頭A');
  await expect(page.locator('#recipeList')).toContainText('試験用同値頭B');
  await expect(page.locator('#recipeList')).toContainText('DEX +3');
  await expect(page.locator('#recipeList')).toContainText('MND +4');
  await expect(page.locator('#recipeList')).not.toContainText('STR +9');
  await expect(page.locator('#recipeList')).not.toContainText('不屈 +6');
  await expect(page.locator('#recipeList')).not.toContainText('物理防御');
  await page.locator('#saveEquipmentSearchBtn').click();
  await page.locator('#textInputOkBtn').click();
  await expect(page.locator('#recipeList .equipment-parameters')).toHaveCount(2);
});

test('title returns to the startup view', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('#tipsMsg .tips-about-btn')).toHaveText('このアプリは何ですか？');
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
