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
const { favoriteList, favoriteStore, seedAppStorage } = require('./helpers/app-storage.js');
test('favorites and shares an ingredient while preserving search results', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('clipboard permission denied')) }
    });
    document.execCommand = command => {
      window.__copiedShareCode = document.activeElement?.value || '';
      return command === 'copy';
    };
  });
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
  await page.locator('#copyExportBtn').click();
  await expect(page.locator('#copyExportBtn')).toHaveText('コピー済み');
  await expect.poll(() => page.evaluate(() => window.__copiedShareCode)).toBe(shareCode);
  await page.locator('#importCode').fill(shareCode);
  await page.locator('#startImportBtn').click();
  await expect(page.locator('#recipeList')).toContainText('山羊乳');
});

test('exports and imports all favorite lists through one text file', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'ff14_favorite_lists_v3',
      JSON.stringify({
        version: 3,
        selectedListId: 'file-list-a',
        lists: [
          { id: 'file-list-a', name: '一括リストA', itemIds: [4422], recipeSelections: {} },
          { id: 'file-list-b', name: '一括リストB', itemIds: [4422], recipeSelections: {} }
        ]
      })
    );
  });
  await openApp(page);
  await page.locator('#settingsBtn').click();
  await expect(page.getByText('お気に入りリストの一括入出力', { exact: true })).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#exportAllFavoritesBtn').click()
  ]);
  expect(download.suggestedFilename()).toMatch(/^favorite-lists-\d{4}-\d{2}-\d{2}\.txt$/);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const fileText = Buffer.concat(chunks).toString('utf8');
  expect(fileText).toContain('FinalFantasy XIV® Crafting Assistant XIVca(シヴカ) お気に入りリスト');
  expect(fileText).toContain('【一括リストA】');
  expect(fileText).toContain('登録アイテム:\n・カッパーリング');
  expect(fileText).toContain('復元コード:\nN');
  expect(fileText).not.toContain('"format"');
  expect(fileText).not.toContain('"version"');
  expect(fileText).not.toContain('createdAt');

  const upload = { name: 'favorite-lists.txt', mimeType: 'text/plain', buffer: Buffer.from(fileText) };
  await page.locator('#importAllFavoritesFile').setInputFiles(upload);
  await expect(page.locator('#confirmMsg')).toContainText('2件のお気に入りリストを読み込みます');
  await expect(page.locator('#confirmYes')).toHaveText('読み込む');
  const importDialogLayout = await page.locator('#confirmDialog').evaluate(dialog => ({
    width: dialog.getBoundingClientRect().width,
    previewMaxHeight: Number.parseFloat(getComputedStyle(dialog.querySelector('.favorite-list-file-preview')).maxHeight),
    previewFontSize: getComputedStyle(dialog.querySelector('.favorite-list-file-preview')).fontSize,
    dialogFontSize: getComputedStyle(document.querySelector('#confirmMsg')).fontSize,
    viewportHeight: window.innerHeight
  }));
  expect(importDialogLayout.width).toBeGreaterThan(500);
  expect(importDialogLayout.previewMaxHeight).toBeCloseTo(importDialogLayout.viewportHeight * 0.45, 0);
  expect(importDialogLayout.previewFontSize).toBe(importDialogLayout.dialogFontSize);
  await page.locator('#confirmYes').click();
  await expect(page.locator('#favoriteListFileStatus')).toContainText('2件のお気に入りリストを追加して読み込みました');
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('ff14_favorite_lists_v3')).lists
        .filter(list => list.id !== 'SYSTEM_RECENT_ITEMS')
        .map(list => list.name)
    )
  ).toEqual(['一括リストA', '一括リストB', '一括リストA（1）', '一括リストB（1）']);

  await page.locator('#importAllFavoritesFile').setInputFiles(upload);
  await page.locator('#confirmMsg input[value="replace"]').check();
  await page.locator('#confirmYes').click();
  await expect(page.locator('#favoriteListFileStatus')).toContainText(
    '2件のお気に入りリストを置き換えて読み込みました'
  );
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('ff14_favorite_lists_v3')).lists
        .filter(list => list.id !== 'SYSTEM_RECENT_ITEMS')
        .map(list => list.name)
    )
  ).toEqual(['一括リストA', '一括リストB']);
});

test('favorite target dialog grows with list count within the existing viewport limit', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'ff14_favorite_lists_v3',
      JSON.stringify({
        version: 3,
        selectedListId: 'target-list-1',
        lists: Array.from({ length: 12 }, (_, index) => ({
          id: `target-list-${index + 1}`,
          name: index === 0 ? 'とても長い名前の登録先お気に入りリストその一' : `登録先${index + 1}`,
          itemIds: [4422],
          recipeSelections: {}
        }))
      })
    );
  });
  await openApp(page, 423, 420);
  await searchFor(page, 'アリペブレ');
  await page.getByText('アリペブレ', { exact: true }).first().click();
  await page.locator('.result-root-summary .pin-btn').first().click();
  await expect(page.locator('#favoriteTargetChoices .choice-list-btn')).toHaveCount(12);
  const layout = await page.locator('#favoriteTargetDialog').evaluate(dialog => {
    const choices = dialog.querySelector('#favoriteTargetChoices');
    return {
      dialogHeight: dialog.getBoundingClientRect().height,
      dialogWidth: dialog.getBoundingClientRect().width,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      choicesClientHeight: choices.clientHeight,
      choicesScrollHeight: choices.scrollHeight
    };
  });
  expect(layout.dialogHeight).toBeLessThanOrEqual(layout.viewportHeight * 0.88 + 1);
  expect(layout.dialogWidth).toBeGreaterThan(300);
  expect(layout.dialogWidth).toBeLessThanOrEqual(layout.viewportWidth - 24 + 1);
  expect(layout.choicesScrollHeight).toBeGreaterThan(layout.choicesClientHeight);
  await page.locator('#favoriteTargetCancelBtn').click();
  await page.locator('#settingsBtn').click();
  const settingsHeight = await page.locator('#settingsDialog').evaluate(dialog => dialog.getBoundingClientRect().height);
  await page.locator('#exportListToggle').click();
  await expect
    .poll(() => page.locator('#exportListChoices').evaluate(list => list.getBoundingClientRect().height))
    .toBeGreaterThan(180);
  const exportListLayout = await page.locator('#exportListChoices').evaluate(list => ({
    height: list.getBoundingClientRect().height,
    scrollHeight: list.scrollHeight
  }));
  expect(exportListLayout.height).toBeGreaterThan(180);
  expect(exportListLayout.height).toBeLessThanOrEqual(370);
  expect(exportListLayout.scrollHeight).toBeGreaterThan(exportListLayout.height);
  await expect
    .poll(() => page.locator('#settingsDialog').evaluate(dialog => dialog.getBoundingClientRect().height))
    .toBe(settingsHeight);
});

test('save-as starts with the next non-nested duplicate name', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'ff14_favorite_lists_v3',
      JSON.stringify({
        version: 3,
        selectedListId: 'a',
        lists: [
          { id: 'a', name: '装備案', itemIds: [1602], recipeSelections: {}, materialSelected: false },
          { id: 'a1', name: '装備案（1）', itemIds: [4422], recipeSelections: {}, materialSelected: false }
        ]
      })
    );
  });
  await openApp(page);
  await page.locator('#favBtn').click();
  await page.locator('#favoriteLists').getByText('装備案', { exact: true }).click();
  await dismissInfoDialog(page);
  await page.getByRole('button', { name: '新規リストとして保存' }).click();
  await expect(page.locator('#textInputField')).toHaveValue('装備案（2）');
  await page.locator('#textInputOkBtn').click();
  await expect(page.locator('#favBtn')).toContainText('装備案（2）');
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
  await expect(listA.locator('.favorite-list-name')).toHaveCSS('font-size', '14.3px');
  const nameBoxBefore = await listA.locator('.favorite-list-name').boundingBox();
  await listA.locator('.favorite-list-curtain-toggle').click();
  await expect(listA.locator('.favorite-list-curtain')).toHaveClass(/expanded/);
  await expect(listA).toHaveCSS('user-select', 'none');
  await expect.poll(() => listA.locator('.favorite-list-curtain').evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(170);
  await expect(listA.locator('.favorite-list-curtain-toggle')).toHaveText('▶');
  const nameBoxAfter = await listA.locator('.favorite-list-name').boundingBox();
  expect(nameBoxAfter.width).toBeCloseTo(nameBoxBefore.width, 0);
  expect(nameBoxAfter.height).toBeCloseTo(nameBoxBefore.height, 0);

  const actionButtons = listA.locator('.favorite-list-curtain-actions button');
  const firstActionBox = await actionButtons.nth(0).boundingBox();
  const secondActionBox = await actionButtons.nth(1).boundingBox();
  expect(secondActionBox.x - (firstActionBox.x + firstActionBox.width)).toBeGreaterThanOrEqual(10);

  await listA.getByRole('button', { name: '「リストA」の名前を変更' }).click();
  await expect(page.locator('#textInputOverlay')).toHaveClass(/open/);
  await page.locator('#textInputCancelBtn').click();
  await expect(page.locator('#favoriteLists')).toHaveClass(/open/);

  await listA.getByRole('button', { name: '「リストA」を削除' }).click();
  await expect(page.locator('#confirmOverlay')).toHaveClass(/open/);
  await page.locator('#confirmNo').click();
  await expect(page.locator('#favoriteLists')).toHaveClass(/open/);

  await dragHandleAfter(page, listA.locator('.reorder-handle'), listB);

  await expect(page.locator('#favoriteLists li').nth(0)).toContainText('検索履歴');
  await expect(page.locator('#favoriteLists li').nth(1)).toContainText('リストB');
  await expect(page.locator('#favoriteLists li').nth(2)).toContainText('リストA');

  await page.reload();
  await openApp(page);
  await expect(page.locator('#favoriteLists')).toHaveClass(/open/);
  await expect(page.locator('#favoriteLists li').nth(0)).toContainText('検索履歴');
  await expect(page.locator('#favoriteLists li').nth(1)).toContainText('リストB');
  await expect(page.locator('#favoriteLists li').nth(2)).toContainText('リストA');
  const restoredListA = page.locator('#favoriteLists li').filter({ hasText: 'リストA' }).first();
  await expect(restoredListA.locator('.favorite-list-curtain')).toHaveClass(/expanded/);

  await restoredListA.locator('.favorite-list-curtain-toggle').click();
  await page.locator('#favBtn').click();
  await expect(page.locator('#favoriteLists')).not.toHaveClass(/open/);
  await page.reload();
  await openApp(page);
  await expect(page.locator('#favoriteLists')).not.toHaveClass(/open/);
  await page.locator('#favBtn').click();
  await expect(
    page.locator('#favoriteLists li').filter({ hasText: 'リストA' }).first().locator('.favorite-list-curtain')
  ).not.toHaveClass(/expanded/);
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
  await expect(page.locator('#recipeList li.fav-item-row').first().locator('.favorite-item-job')).toHaveClass(
    /badge-craft/
  );
  await expect(page.locator('.result-header')).toBeHidden();
  const favoriteMaterialActionHeights = await page.locator('#recipeList .favorite-materials-row').evaluate(row => ({
    material: row.querySelector(':scope > .favorite-list-action').getBoundingClientRect().height,
    toggle: row.querySelector('.favorite-material-curtain').getBoundingClientRect().height
  }));
  expect(Math.abs(favoriteMaterialActionHeights.material - favoriteMaterialActionHeights.toggle)).toBeLessThan(1);
  await page.locator('#recipeList').getByText('素材リストを表示').click();
  await page.locator('#countIncrease5Btn').click();

  await expect(page.locator('#countLabel')).toHaveText('セット数:');
  await expect(page.locator('#countInput')).toHaveValue('6');
  await expect(page.locator('#materialsViewBtn')).toBeVisible();
  await expect(page.locator('#treeViewBtn')).toBeHidden();
  const ringSection = page.locator('.favorite-ring-section');
  await expect(ringSection.locator(':scope > .materials-section-header')).toHaveText('指輪');
  await expect(ringSection.locator('.favorite-ring-controls')).toContainText('カッパーリング');
  await expect(ringSection.locator('.favorite-list-root-summary')).toHaveCount(0);
  await expect(ringSection.locator('.favorite-ring-bulk-actions')).toHaveCount(0);
  const ringContentGap = await ringSection.evaluate(section => {
    const header = section.querySelector(':scope > .materials-section-header').getBoundingClientRect();
    const controls = section.querySelector(':scope > .favorite-ring-controls').getBoundingClientRect();
    return controls.top - header.bottom;
  });
  expect(ringContentGap).toBeGreaterThanOrEqual(8);
  const ringIconBox = await ringSection.locator('.favorite-ring-row .list-icon').first().boundingBox();
  const intermediateIconBox = await page.locator('.intermediate-tree-row .list-icon').first().boundingBox();
  expect(ringIconBox).toBeTruthy();
  expect(intermediateIconBox).toBeTruthy();
  expect(Math.abs(ringIconBox.x - intermediateIconBox.x)).toBeLessThan(1);
  await expect(page.locator('.favorite-ring-separator')).toBeVisible();
  await expect(page.locator('.favorite-ring-toggle button')).toHaveCount(3);
  await expect(page.locator('.favorite-ring-toggle button').filter({ hasText: /^0$/ })).toBeVisible();
  await expect(page.locator('.favorite-ring-toggle')).toContainText('1つ');
  await expect(page.locator('.materials-list')).toContainText('ゴールデンイール');
  const sectionOrder = await page.locator('#treeContainer').evaluate(container => {
    const production = container.querySelector('.production-content-section');
    const rings = container.querySelector('.favorite-ring-section');
    const materials = [...container.querySelectorAll('.materials-section-header')].find(header =>
      header.textContent.includes('製作する中間素材')
    );
    return {
      productionBeforeRings:
        Boolean(production && rings) &&
        Boolean(production.compareDocumentPosition(rings) & Node.DOCUMENT_POSITION_FOLLOWING),
      ringsBeforeMaterials:
        Boolean(rings && materials) &&
        Boolean(rings.compareDocumentPosition(materials) & Node.DOCUMENT_POSITION_FOLLOWING)
    };
  });
  expect(sectionOrder).toEqual({ productionBeforeRings: true, ringsBeforeMaterials: true });

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
  await expect(page.locator('#recipeList .favorite-materials-row').getByText('素材リストを表示(1/2)')).toHaveClass(
    /active/
  );
  await page.locator('#settingsBtn').click();
  await page.locator('#exportListToggle').click();
  await page.locator('#exportListChoices').getByText('個数確認').click();
  await expect(page.locator('#exportCode')).toHaveValue(shareCodeBeforeCounts);
  await page.locator('#settingsCloseBtn').click();

  await page.locator('#recipeList').getByText('素材リストを表示(1/2)').click();
  await expect(page.locator('.favorite-ring-controls')).toHaveCount(0);
  await expect(page.locator('.production-content-section .production-content-toggle')).toHaveText('▶製作内容');
  await page.locator('.production-content-section .production-content-toggle').click();
  await expect(page.locator('.production-content-section .production-content-toggle')).toHaveText('▼製作内容');
  await expect(page.locator('.production-content-section .production-content-toggle')).toHaveClass(
    /materials-section-header/
  );
  await expect(page.locator('.favorite-material-root-summary')).toHaveCount(1);
  await expect
    .poll(() =>
      page.locator('.production-content-section').evaluate(section => {
        const header = section.querySelector('.production-content-toggle').getBoundingClientRect();
        const firstItem = section.querySelector('.favorite-material-root-summary').getBoundingClientRect();
        return firstItem.top - header.bottom;
      })
    )
    .toBeGreaterThan(4);
  await expect(page.locator('.favorite-material-root-summary')).toContainText('カッパーリング');
  await expect(page.locator('.favorite-material-root-summary')).not.toContainText('アリペブレ');
  await expect(page.locator('.favorite-material-root-summary .node-icon')).toHaveCSS('width', '40px');
  await expect(page.locator('.materials-list')).toContainText(/カッパーインゴット\s*× 1/);
  await expect(page.locator('.materials-list')).not.toContainText('ゴールデンイール');

  await page.reload();
  await expect(page.locator('#loadingOverlay')).not.toHaveClass(/open/);
  await expect(page.locator('.favorite-material-root-summary')).toHaveCount(1);
  await expect(page.locator('.favorite-material-root-summary')).toContainText('カッパーリング');
  await expect(page.locator('.materials-list')).toContainText(/カッパーインゴット\s*× 1/);
  await expect(page.locator('.materials-list')).not.toContainText('ゴールデンイール');
  await page.locator('.favorite-material-curtain-toggle').click();
  await expect(page.locator('.favorite-material-curtain-actions').getByText('個数指定')).toHaveClass(/active/);

  await page.locator('.favorite-material-curtain-actions').getByText('どれか1アイテム').click();
  await expect(page.locator('.favorite-material-curtain-actions').getByText('どれか1アイテム')).toHaveClass(/active/);
  await expect(page.locator('.favorite-material-curtain-actions').getByText('個数指定')).not.toHaveClass(/active/);
  await expect(page.locator('.favorite-material-curtain-actions').getByText('全てOn')).toBeVisible();
  const bulkButtonLayout = await page.locator('.favorite-material-bulk-group').evaluate(group => {
    const box = group.getBoundingClientRect();
    const [first, second] = [...group.querySelectorAll('button')].map(button => button.getBoundingClientRect());
    return {
      left: first.left - box.left,
      right: box.right - second.right,
      widthDifference: Math.abs(first.width - second.width)
    };
  });
  expect(bulkButtonLayout.left).toBeLessThan(1);
  expect(bulkButtonLayout.right).toBeLessThan(1);
  expect(bulkButtonLayout.widthDifference).toBeLessThan(1);
  await expect(page.locator('.favorite-item-count-controls input[type="checkbox"]')).toHaveCount(2);
  await page.locator('.favorite-material-curtain-actions').getByText('全てOn').click();
  await expect(page.locator('.favorite-item-count-controls input[type="checkbox"]:checked')).toHaveCount(2);
  const storedAnyOneTargets = await page.evaluate(() => localStorage.getItem('ff14_favorite_item_counts_v1'));
  expect(storedAnyOneTargets).toContain('anyOneTargets');
  await page.locator('#recipeList .favorite-material-help-btn').click();
  await expect(page.locator('#licenseTitle')).toContainText('拡張機能について');
  await expect(page.locator('#licenseText')).toContainText('お気に入りリスト内全アイテム');
  await expect(page.locator('#licenseText')).toContainText('セット数分');
  await expect(page.locator('#licenseText')).toContainText('全てを制作する素材リストではありません');
  await expect(page.locator('#licenseText')).toContainText('完成品が直接使う同じ末端素材');
  await expect(page.locator('#licenseText')).toContainText('候補間で最も多く必要な数');
  await expect(page.locator('#licenseText')).toContainText('共通して使う末端素材は合算');
  await page.locator('#licenseCloseBtn').click();
  await expect(page.locator('#countInput')).toBeVisible();
  await expect(page.locator('#countInput')).toBeEnabled();
  await page.locator('#countInput').fill('2');
  await page.locator('#countInput').dispatchEvent('input');
  await page.locator('#countInput').blur();
  await expect(page.locator('#countInput')).toHaveValue('2');
  await page.locator('#recipeList').getByText('素材リストを表示').click();
  await expect(page.locator('.production-content-section .production-content-toggle')).toHaveText('▶製作内容');
  await page.locator('.production-content-section .production-content-toggle').click();
  await expect(page.locator('.production-content-section .production-content-toggle')).toHaveText('▼製作内容');
  await expect(page.locator('.favorite-material-root-summary')).toHaveCount(2);
  await expect(page.locator('.favorite-material-root-or')).toHaveCount(1);
  await expect(page.locator('.favorite-material-root-or')).toHaveText('もしくは');
  await expect(page.locator('.favorite-material-root-summary').filter({ hasText: 'アリペブレ' })).toContainText('× 3');
  await expect(page.locator('.favorite-material-root-summary').filter({ hasText: 'アリペブレ' })).toContainText('余り');
  await expect(page.locator('.favorite-material-root-summary').filter({ hasText: 'カッパーリング' })).toContainText(
    '× 2'
  );
  await page.locator('.production-content-section .production-content-toggle').click();
  await expect(page.locator('.production-content-section .production-content-toggle')).toHaveText('▶製作内容');
  await expect
    .poll(() =>
      page.locator('.production-content-section .production-content-toggle').evaluate(header => {
        const firstMaterialsHeader = document.querySelector(
          '.materials-section-header:not(.production-content-toggle)'
        );
        return Math.abs(firstMaterialsHeader.getBoundingClientRect().top - header.getBoundingClientRect().bottom);
      })
    )
    .toBeLessThan(1);

  await page.reload();
  await expect(page.locator('#loadingOverlay')).not.toHaveClass(/open/);
  await expect(page.locator('.favorite-material-root-summary')).toHaveCount(2);
  await expect(page.locator('.production-content-section .production-content-toggle')).toHaveText('▶製作内容');
  await expect(page.locator('.favorite-material-root-or')).toHaveText('もしくは');
  await expect(page.locator('.favorite-material-root-summary').filter({ hasText: 'アリペブレ' })).toContainText('× 3');
  await expect(page.locator('.favorite-material-root-summary').filter({ hasText: 'カッパーリング' })).toContainText(
    '× 2'
  );
  await page.locator('.favorite-material-curtain-toggle').click();
  await expect(page.locator('.favorite-material-curtain-actions').getByText('どれか1アイテム')).toHaveClass(/active/);
});

test('favorite child count changes preserve the list scroll position', async ({ page }) => {
  await seedAppStorage(page, {
    favoritesV2: favoriteStore({
      version: 2,
      selectedListId: 'count-scroll',
      lists: [
        favoriteList({
          id: 'count-scroll',
          name: '個数スクロール',
          itemIds: ['2834', '3425', '3648', '3870', '4126', '4254', '4353', '4422', '46253']
        })
      ]
    })
  });
  await openApp(page, 900, 400);
  await page.locator('#favBtn').click();
  await page.locator('#favoriteLists').getByText('個数スクロール', { exact: true }).click();
  await dismissInfoDialog(page);
  await page.locator('.favorite-material-curtain-toggle').click();
  await page.locator('.favorite-material-curtain-actions').getByText('個数指定').click();
  await page.locator('#recipeList').evaluate(list => {
    list.scrollTop = list.scrollHeight;
  });
  const scrollTop = await page.locator('#recipeList').evaluate(list => list.scrollTop);
  expect(scrollTop).toBeGreaterThan(0);

  const lastControls = page.locator('#recipeList li.fav-item-row .favorite-item-count-controls').last();
  await lastControls.getByRole('button', { name: '＋' }).click();
  await expect.poll(() => page.locator('#recipeList').evaluate(list => list.scrollTop)).toBe(scrollTop);
  await expect(lastControls.locator('input')).toHaveValue('2');

  await lastControls.locator('input').fill('4');
  await lastControls.locator('input').dispatchEvent('change');
  await expect.poll(() => page.locator('#recipeList').evaluate(list => list.scrollTop)).toBe(scrollTop);
  await expect(lastControls.locator('input')).toHaveValue('4');

  await lastControls.getByRole('button', { name: '－' }).click();
  await expect.poll(() => page.locator('#recipeList').evaluate(list => list.scrollTop)).toBe(scrollTop);
  await expect(lastControls.locator('input')).toHaveValue('3');
});

test('favorite any-item materials cover shared ingredients for every distinct intermediate', async ({ page }) => {
  await openApp(page);
  await importFavoriteFromPlaza(page, loverWeapons.code, '宝水確認');
  await closeSharePlaza(page);
  await page.locator('#settingsCloseBtn').click();
  await page.locator('#favBtn').click();
  await page.locator('#favoriteLists').getByText('宝水確認').click();
  await dismissInfoDialog(page);
  await page.locator('.favorite-material-curtain-toggle').click();
  await page.locator('.favorite-material-curtain-actions').getByText('どれか1アイテム').click();
  await page.locator('#recipeList').getByText('素材リストを表示').click();

  for (const name of ['活力の宝水G4', '剛力の宝水G4', '眼力の宝水G4', '心力の宝水G4', '知力の宝水G4']) {
    await expect(page.locator('.materials-list')).toContainText(name);
  }
  await expect(page.locator('.materials-list')).toContainText(/ガーデン・ソフトウォーター\s*×\s*15/);
  await expect(page.locator('.materials-list')).toContainText(/ヤクテル天然水\s*×\s*5/);
});

test('mobile favorite ring controls keep the count toggle on one right-aligned row', async ({ page }) => {
  await openApp(page, 600, 720);

  await searchFor(page, 'カッパーリング');
  await page.getByText('カッパーリング', { exact: true }).first().click();
  await page.locator('.result-root-summary .pin-btn').first().click();
  await page.locator('#favoriteTargetCreate').getByText('新規作成').click();
  await page.locator('#textInputField').fill('指輪確認');
  await page.locator('#textInputOkBtn').click();
  await page.evaluate(() => showMobilePanel('left', { animate: false }));
  await page.locator('#favBtn').click();
  await page.locator('#favoriteLists').getByText('指輪確認').click();
  await page.locator('#recipeList').getByText('素材リストを表示').click();
  await page.waitForFunction(() => !document.querySelector('.main')?.swiper?.animating);

  const rowBox = await page.locator('.favorite-ring-row').first().boundingBox();
  const nameBox = await page.locator('.favorite-ring-name').first().boundingBox();
  const toggleBox = await page.locator('.favorite-ring-toggle').first().boundingBox();
  const buttonTops = await page
    .locator('.favorite-ring-toggle button')
    .evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().top));
  expect(rowBox).toBeTruthy();
  expect(nameBox).toBeTruthy();
  expect(toggleBox).toBeTruthy();
  expect(buttonTops).toHaveLength(3);
  expect(Math.max(...buttonTops) - Math.min(...buttonTops)).toBeLessThan(1);
  expect(Math.abs(toggleBox.x + toggleBox.width - (rowBox.x + rowBox.width))).toBeLessThanOrEqual(2);
  expect(toggleBox.y).toBeLessThan(nameBox.y + nameBox.height);
});

test('mobile pin turns active after adding to a favorite list', async ({ page }) => {
  await openApp(page, 600, 700);
  await searchFor(page, 'バスタードソード');
  await page.getByText('バスタードソード', { exact: true }).first().click();
  await expect(page.locator('#mobileBackBtn')).toBeVisible();
  await expect(page.locator('#backBtn')).toBeHidden();
  const titleBox = await page.locator('#appTitle').boundingBox();
  const settingsBox = await page.locator('#settingsBtn').boundingBox();
  const primaryRowBox = await page.locator('.header-primary-row').boundingBox();
  expect(Math.abs(primaryRowBox.y + primaryRowBox.height / 2 - (settingsBox.y + settingsBox.height / 2))).toBeLessThan(1);
  expect(titleBox.x).toBeGreaterThanOrEqual(primaryRowBox.x);
  expect(primaryRowBox.x + primaryRowBox.width).toBeLessThanOrEqual(settingsBox.x + 1);

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

  await page.locator('#panelRight').evaluate(panel => {
    panel.scrollTop = 100;
  });
  await page.evaluate(() => showMobilePanel('left', { animate: false }));
  await page.locator('#favBtn').click();
  await page.locator('#favoriteLists').getByText('スマホ確認').click();
  await expect(page.locator('#recipeList')).toHaveCSS('overflow-y', 'auto');
  await expect(page.locator('#panelLeft')).toHaveCSS('min-height', '0px');
  const materialsButton = page.locator('#recipeList .favorite-materials-row').getByText('素材リストを表示');
  await materialsButton.click();
  await expect(materialsButton).toHaveClass(/active/);
  await expect.poll(() => page.locator('#panelRight').evaluate(panel => panel.scrollTop)).toBe(0);
  await page.evaluate(() => showMobilePanel('left', { animate: false }));
  await expect(page.locator('#recipeList .favorite-materials-row').getByText('素材リストを表示')).toHaveClass(/active/);
});

test('mobile panels align list actions and scroll on the intended element', async ({ page }) => {
  await openApp(page, 423, 780);
  await searchFor(page, '岩塩');

  const saltRow = page
    .locator('#recipeList li')
    .filter({ has: page.getByText('岩塩', { exact: true }) })
    .first();
  const leftRowBox = await saltRow.boundingBox();
  const actionBox = await saltRow.locator('.item-action-buttons').boundingBox();
  expect(leftRowBox).toBeTruthy();
  expect(actionBox).toBeTruthy();
  expect(leftRowBox.x + leftRowBox.width - (actionBox.x + actionBox.width)).toBeLessThanOrEqual(16);

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

  await page.evaluate(() => showMobilePanel('left', { animate: false }));
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
  await page.evaluate(() => showMobilePanel('left', { animate: false }));
  await searchFor(page, 'アリペブレ');
  await page.getByText('アリペブレ', { exact: true }).first().click();
  await expect.poll(() => page.locator('#panelRight').evaluate(panel => panel.scrollTop)).toBe(0);
});

test('mobile content changes reset only the destination panel scroll', async ({ page }) => {
  await openApp(page, 423, 520);
  await searchFor(page, 'アリペブレ');
  await page.getByText('アリペブレ', { exact: true }).first().click();
  await page.locator('#panelRight').evaluate(panel => {
    panel.scrollTop = 100;
    panel.dispatchEvent(new Event('scroll'));
  });
  await expect.poll(() => page.locator('#panelRight').evaluate(panel => panel.scrollTop)).toBeGreaterThan(0);

  await page.evaluate(() => showMobilePanel('left', { animate: false }));
  const leftScroll = await page.locator('#recipeList').evaluate(list => {
    const spacer = document.createElement('li');
    spacer.style.height = '1000px';
    spacer.style.flexShrink = '0';
    list.appendChild(spacer);
    list.scrollTop = 80;
    list.dispatchEvent(new Event('scroll'));
    return list.scrollTop;
  });
  await page.getByText('アリペブレ', { exact: true }).first().evaluate(row => row.closest('li').click());
  await expect.poll(() => page.locator('#panelRight').evaluate(panel => panel.scrollTop)).toBe(0);
  await expect.poll(() => page.locator('#recipeList').evaluate(list => list.scrollTop)).toBe(leftScroll);

  await page.evaluate(() => showMobilePanel('left', { animate: false }));
  await searchFor(page, '岩塩');
  const saltRow = page
    .locator('#recipeList li')
    .filter({ has: page.getByText('岩塩', { exact: true }) })
    .first();
  await saltRow.locator('.uses-list-btn').click();
  await page.locator('#usesList').evaluate(list => {
    const spacer = document.createElement('li');
    spacer.style.height = '1000px';
    spacer.style.flexShrink = '0';
    list.appendChild(spacer);
    list.scrollTop = 90;
    list.dispatchEvent(new Event('scroll'));
  });
  await page.evaluate(() => showMobilePanel('left', { animate: false }));
  const leftUsesScroll = await page.locator('#recipeList').evaluate(list => {
    const spacer = document.createElement('li');
    spacer.style.height = '1000px';
    spacer.style.flexShrink = '0';
    list.appendChild(spacer);
    list.scrollTop = 70;
    list.dispatchEvent(new Event('scroll'));
    return list.scrollTop;
  });
  await saltRow.locator('.uses-list-btn').evaluate(button => button.click());
  await expect.poll(() => page.locator('#usesList').evaluate(list => list.scrollTop)).toBe(0);
  await expect.poll(() => page.locator('#recipeList').evaluate(list => list.scrollTop)).toBe(leftUsesScroll);

  await page.evaluate(() => showMobilePanel('right', { animate: false }));
  await page.locator('#panelRight').evaluate(panel => {
    panel.scrollTop = 100;
    panel.dispatchEvent(new Event('scroll'));
  });
  await expect.poll(() => page.locator('#panelRight').evaluate(panel => panel.scrollTop)).toBeGreaterThan(0);
  await page.evaluate(() => showMobilePanel('middle', { animate: false }));
  const middleScroll = await page.locator('#usesList').evaluate(list => {
    const spacer = document.createElement('li');
    spacer.style.height = '1000px';
    spacer.style.flexShrink = '0';
    list.appendChild(spacer);
    list.scrollTop = 80;
    list.dispatchEvent(new Event('scroll'));
    return list.scrollTop;
  });
  await page.locator('#usesList li').first().evaluate(row => row.click());
  await expect.poll(() => page.locator('#panelRight').evaluate(panel => panel.scrollTop)).toBe(0);
  await expect.poll(() => page.locator('#usesList').evaluate(list => list.scrollTop)).toBe(middleScroll);
});
