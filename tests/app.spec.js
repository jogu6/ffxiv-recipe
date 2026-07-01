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

test('intermediate materials form a collapsible tree and open an independent material tree', async ({ page }) => {
  await openApp(page);
  await searchFor(page, 'ブラスバスタードソード');
  await page.getByText('ブラスバスタードソード', { exact: true }).first().click();
  await page.locator('#materialsViewBtn').click();

  const intermediateHeader = page.locator('.materials-section-header').filter({ hasText: '製作する中間素材' });
  const bastardNode = page.locator('.intermediate-tree-row').filter({
    has: page.getByText('バスタードソード', { exact: true }),
  }).first().locator('..');
  const leafNode = page.locator('.intermediate-tree-node:not(:has(> .intermediate-tree-children))').first();
  await expect(leafNode.locator('.intermediate-tree-toggle-spacer')).toHaveCount(1);
  await expect(bastardNode.locator('.intermediate-tree-children')).toContainText('ブロンズインゴット');
  await bastardNode.locator('.intermediate-tree-toggle').first().click();
  await expect(bastardNode.locator('.intermediate-tree-children')).toHaveClass(/collapsed/);

  await intermediateHeader.click();
  await expect(bastardNode).toHaveClass(/collapsed/);
  await intermediateHeader.click();
  await expect(bastardNode).not.toHaveClass(/collapsed/);
  await expect(bastardNode.locator('.intermediate-tree-children')).toHaveClass(/collapsed/);

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
  await expect(page.locator('.material-tree-root-summary .node-icon')).toHaveCSS('width', '48px');
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
  const text = await page.locator('.materials-list').innerText();
  await page.locator('.materials-section-header').filter({ hasText: '必要な交換貨幣' }).click();
  const summaryText = await page.locator('.materials-summary-row').innerText();
  expect(text.indexOf('ゴールデンイール')).toBeGreaterThanOrEqual(0);
  expect(text.indexOf('紫電の霊砂')).toBeGreaterThan(text.indexOf('ゴールデンイール'));
  expect(text).not.toContain('ファイアクラスター');
  await page.locator('.materials-section-header').filter({ hasText: '必要なシャード/クリスタル/クラスター' }).click();
  const expandedText = await page.locator('.materials-list').innerText();
  expect(expandedText.indexOf('ファイアクラスター')).toBeGreaterThan(expandedText.indexOf('紫電の霊砂'));
  expect(summaryText).toContain('ギャザラースクリップ:橙貨');
  await expect(page.locator('.materials-summary-separator')).toHaveCount(0);
  await expect(page.locator('.material-supplement-icon').first()).toBeVisible();
  await expect(page.locator('.material-sub-surplus').first()).toHaveCSS('color', 'rgb(106, 191, 105)');
  await expect(page.locator('.material-sub-num:not(.material-sub-surplus)').first()).toHaveCSS('color', 'rgb(106, 191, 105)');
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
  await expect(page.locator('#recipeList').getByText('素材リスト')).toHaveCount(0);

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
  await page.locator('#recipeList').getByText('素材リスト').click();
  await page.locator('#countIncrease5Btn').click();

  await expect(page.locator('#countLabel')).toHaveText('セット数:');
  await expect(page.locator('#countInput')).toHaveValue('6');
  await expect(page.locator('#materialsViewBtn')).toBeVisible();
  await expect(page.locator('#treeViewBtn')).toBeHidden();
  await expect(page.locator('.favorite-ring-controls')).toContainText('カッパーリング');
  await expect(page.locator('.favorite-ring-separator')).toBeVisible();
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
  await page.locator('#recipeList').getByText('素材リスト').click();
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
  await expect(page.locator('#recipeList').getByText('素材リスト(1/2)')).toBeVisible();
  await page.locator('#recipeList li.fav-item-row').filter({ hasText: 'カッパーリング' }).click();
  await expect(page.locator('#countLabel')).toHaveText('セット数:');
  await expect(page.locator('#recipeList .favorite-materials-row').getByText('素材リスト(1/2)')).toHaveClass(/active/);
  await page.locator('#settingsBtn').click();
  await page.locator('#exportListToggle').click();
  await page.locator('#exportListChoices').getByText('個数確認').click();
  await expect(page.locator('#exportCode')).toHaveValue(shareCodeBeforeCounts);
  await page.locator('#settingsCloseBtn').click();

  await page.locator('#recipeList').getByText('素材リスト(1/2)').click();
  await expect(page.locator('.favorite-ring-controls')).toHaveCount(0);
  await expect(page.locator('.favorite-material-root-summary')).toHaveCount(1);
  await expect(page.locator('.favorite-material-root-summary')).toContainText('カッパーリング');
  await expect(page.locator('.favorite-material-root-summary')).not.toContainText('アリペブレ');
  await expect(page.locator('.favorite-material-root-summary .node-icon')).toHaveCSS('width', '48px');
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
  await expect(page.locator('#confirmMsg')).toContainText('1個以上指定したアイテム');
  await expect(page.locator('#confirmMsg')).toContainText('セット数分');
  await expect(page.locator('#confirmMsg')).toContainText('全てを制作する素材リストではありません');
  await page.locator('#confirmNo').click();
  await expect(page.locator('#countInput')).toBeVisible();
  await expect(page.locator('#countInput')).toBeEnabled();
  await page.locator('#countInput').fill('2');
  await page.locator('#countInput').dispatchEvent('input');
  await page.locator('#countInput').blur();
  await expect(page.locator('#countInput')).toHaveValue('2');
  await page.locator('#recipeList').getByText('素材リスト').click();
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
  await page.locator('#recipeList').getByText('素材リスト').click();

  const rowBox = await page.locator('.favorite-ring-row').first().boundingBox();
  const nameBox = await page.locator('.favorite-ring-name').first().boundingBox();
  const toggleBox = await page.locator('.favorite-ring-toggle').first().boundingBox();
  expect(rowBox).toBeTruthy();
  expect(nameBox).toBeTruthy();
  expect(toggleBox).toBeTruthy();
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

  await page.locator('#mobileBackBtn').click();
  await page.locator('#favBtn').click();
  await page.locator('#favoriteLists').getByText('スマホ確認').click();
  await expect(page.locator('#recipeList')).toHaveCSS('overflow-y', 'auto');
  await expect(page.locator('#panelLeft')).toHaveCSS('min-height', '0px');
  const materialsButton = page.locator('#recipeList .favorite-materials-row').getByText('素材リスト');
  await materialsButton.click();
  await expect(materialsButton).toHaveClass(/active/);
  await page.locator('#mobileBackBtn').click();
  await expect(page.locator('#recipeList .favorite-materials-row').getByText('素材リスト')).not.toHaveClass(/active/);
});

test('title returns to the startup view', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('#tipsMsg .tips-about-btn')).toHaveText('このアプリは何ですか？');
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
