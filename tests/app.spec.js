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
  await expect.poll(() => page.evaluate(() => window.__contactUrl)).toBe('https://discord.gg/GAVwZ9Ca');
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
  await expect(page.locator('.materials-summary-separator').first()).toBeVisible();
  await expect(page.locator('.materials-summary-row')).toContainText('ギャザラースクリップ:橙貨');
  await expect(page.locator('.materials-summary-row')).toContainText('× 300');
});

test('materials list sorts normal items before crystals and shows supplement icons', async ({ page }) => {
  await openApp(page);
  await searchFor(page, 'アリペブレ');
  await page.getByText('アリペブレ', { exact: true }).first().click();

  await page.locator('#materialsViewBtn').click();
  await expect(page.locator('.materials-section-header')).toContainText([
    '製作する中間素材',
    '必要素材',
    '必要なシャード/クリスタル/クラスター'
  ]);
  const text = await page.locator('.materials-list').innerText();
  const summaryText = await page.locator('.materials-summary-row').innerText();
  expect(text.indexOf('ゴールデンイール')).toBeGreaterThanOrEqual(0);
  expect(text.indexOf('紫電の霊砂')).toBeGreaterThan(text.indexOf('ゴールデンイール'));
  expect(text).not.toContain('ファイアクラスター');
  await page.locator('.materials-section-header').filter({ hasText: '必要なシャード/クリスタル/クラスター' }).click();
  const expandedText = await page.locator('.materials-list').innerText();
  expect(expandedText.indexOf('ファイアクラスター')).toBeGreaterThan(expandedText.indexOf('紫電の霊砂'));
  expect(summaryText).toContain('ギャザラースクリップ:橙貨');
  await expect(page.locator('.materials-summary-separator')).toHaveCount(1);
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

  await page.locator('#countInput').fill('1000');
  await expect(page.locator('#resultTitle')).toContainText('1,000個分');
  await expect(page.locator('.tree-node').first()).toContainText('× 1,002');
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
  await expect(page.locator('#favBtn')).toContainText('剣リスト');
  await expect(page.locator('#recipeList')).toContainText('バスタードソード');

  await page.locator('#recipeList .pin-btn').first().click();
  await expect(page.locator('#confirmMsg')).toContainText('「剣リスト」から削除しますか？');
  await page.locator('#confirmNo').click();

  await page.locator('#settingsBtn').click();
  await page.locator('#exportListToggle').click();
  await page.locator('#exportListChoices').getByText('剣リスト').click();
  await expect(page.locator('#exportListToggle')).toContainText('剣リスト');
  await expect(page.locator('#exportCode')).toHaveValue(/^[0-9A-Z]+$/);
});

test('reorders favorite lists locally with the rightmost drag handle', async ({ page }) => {
  await openApp(page);

  await searchFor(page, 'バスタードソード');
  await page.getByText('バスタードソード', { exact: true }).first().click();
  await page.locator('.tree-node .pin-btn').first().click();
  await page.locator('#favoriteTargetCreate').getByText('新規作成').click();
  await page.locator('#textInputField').fill('リストA');
  await page.locator('#textInputOkBtn').click();

  await searchFor(page, 'アリペブレ');
  await page.getByText('アリペブレ', { exact: true }).first().click();
  await page.locator('.tree-node .pin-btn').first().click();
  await page.locator('#favoriteTargetCreate').getByText('新規作成').click();
  await page.locator('#textInputField').fill('リストB');
  await page.locator('#textInputOkBtn').click();

  await page.locator('#favBtn').click();
  const listA = page.locator('#favoriteLists li').filter({ hasText: 'リストA' }).first();
  const listB = page.locator('#favoriteLists li').filter({ hasText: 'リストB' }).first();
  await dragHandleAfter(page, listA.locator('.reorder-handle'), listB);

  await expect(page.locator('#favoriteLists li').nth(0)).toContainText('リストB');
  await expect(page.locator('#favoriteLists li').nth(1)).toContainText('リストA');

  await page.reload();
  await openApp(page);
  await page.locator('#favBtn').click();
  await expect(page.locator('#favoriteLists li').nth(0)).toContainText('リストB');
  await expect(page.locator('#favoriteLists li').nth(1)).toContainText('リストA');
});

test('reorders favorite items locally and changes the exported share code order', async ({ page }) => {
  await openApp(page);

  await searchFor(page, 'バスタードソード');
  await page.getByText('バスタードソード', { exact: true }).first().click();
  await page.locator('.tree-node .pin-btn').first().click();
  await page.locator('#favoriteTargetCreate').getByText('新規作成').click();
  await page.locator('#textInputField').fill('並び確認');
  await page.locator('#textInputOkBtn').click();

  await searchFor(page, 'アリペブレ');
  await page.getByText('アリペブレ', { exact: true }).first().click();
  await page.locator('.tree-node .pin-btn').first().click();
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
  await page.locator('.tree-node .pin-btn').first().click();
  await page.locator('#favoriteTargetCreate').getByText('新規作成').click();
  await page.locator('#textInputField').fill('切替確認');
  await page.locator('#textInputOkBtn').click();

  await searchFor(page, 'アリペブレ');
  await page.getByText('アリペブレ', { exact: true }).first().click();
  await expect(page.locator('#resultViewSwitch')).toBeVisible();

  await page.locator('#favBtn').click();
  await page.locator('#favoriteLists').getByText('切替確認').click();
  await expect(page.locator('#resultViewSwitch')).toBeHidden();
  await expect(page.locator('#resultTitle')).toHaveText('');
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
  await expect(page.locator('.favorite-ring-separator')).toBeVisible();
  await expect(page.locator('.favorite-ring-toggle')).toContainText('1つ');
  await expect(page.locator('.materials-list')).toContainText('ゴールデンイール');

  await page.getByText('アリペブレ', { exact: true }).first().click();
  await expect(page.locator('#countLabel')).toHaveText('個数:');
  await expect(page.locator('#treeViewBtn')).toBeVisible();
  await expect(page.locator('.favorite-ring-controls')).toHaveCount(0);
});

test('mobile pin turns active after adding to a favorite list', async ({ page }) => {
  await openApp(page, 600, 700);
  await searchFor(page, 'バスタードソード');
  await page.getByText('バスタードソード', { exact: true }).first().click();

  const pin = page.locator('.tree-node .pin-btn').first();
  await expect(pin).toHaveClass(/inactive/);
  await pin.click();
  await page.locator('#favoriteTargetCreate').getByText('新規作成').click();
  await page.locator('#textInputField').fill('スマホ確認');
  await page.locator('#textInputOkBtn').click();

  await expect(pin).not.toHaveClass(/inactive/);

  await page.locator('#appTitle').click();
  await searchFor(page, 'アリペブレ');
  await page.getByText('アリペブレ', { exact: true }).first().click();
  const secondPin = page.locator('.tree-node .pin-btn').first();
  await secondPin.click();
  await page.locator('#favoriteTargetChoices').getByText('スマホ確認').click();
  await expect(page.locator('#confirmMsg')).toContainText('「スマホ確認」に登録しますか？');
  await page.locator('#confirmNo').click();
  await expect(page.locator('#favoriteTargetOverlay')).toHaveClass(/open/);
  await expect(secondPin).toHaveClass(/inactive/);

  await page.locator('#favoriteTargetChoices').getByText('スマホ確認').click();
  await page.locator('#confirmYes').click();
  await expect(secondPin).not.toHaveClass(/inactive/);
});

test('title returns to the startup view', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('#tipsMsg .tips-about-btn')).toHaveText('このアプリは何ですか？');
  await searchFor(page, 'バスタードソード');
  await page.getByText('バスタードソード', { exact: true }).first().click();
  await expect(page.locator('#resultTitle')).toContainText('バスタードソード');

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
  await expect(page.locator('#resultTitle')).toContainText('バスタードソード');

  await page.setViewportSize({ width: 600, height: 700 });
  await expect(page.locator('#panelLeft')).toHaveClass(/mobile-visible/);
  await expect(page.locator('#searchBox')).toHaveValue('');
  await expect(page.locator('#countInput')).toHaveValue('1');
  await expect(page.locator('#resultTitle')).toHaveText('');
  await expect(page.locator('#recipeList li.tips-li')).toBeVisible();
  await expect(page.locator('#recipeList li.tips-li .tips-about-btn')).toHaveText('このアプリは何ですか？');

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
