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
test('creates a named favorite list from a tree pin and exports a compact share code', async ({ page }) => {
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
  await expect(page.locator('#exportCode')).toHaveValue(/^N[A-Za-z0-9_-]+$/);
});

test('converts v2 favorite storage to v3 and removes v2 only after saving it', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'ff14_favorite_lists_v2',
      JSON.stringify({
        version: 2,
        selectedListId: 'old-list',
        lists: [
          {
            id: 'old-list',
            name: '旧リスト',
            itemIds: [1602],
            materialSelected: false
          }
        ]
      })
    );
  });

  await openApp(page);
  const stored = await page.evaluate(() => ({
    v2: localStorage.getItem('ff14_favorite_lists_v2'),
    v3: JSON.parse(localStorage.getItem('ff14_favorite_lists_v3'))
  }));
  expect(stored.v2).toBeNull();
  expect(stored.v3.version).toBe(3);
  expect(stored.v3.selectedListId).toBe('old-list');
  expect(stored.v3.lists.find(list => list.id === 'old-list')).toMatchObject({
    name: '旧リスト',
    itemIds: ['バスタードソード'],
    recipeSelections: {}
  });
});

test('removes legacy favorites excluded from Lodestone and reports their names', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('legacy-excluded-seeded') === '1') return;
    sessionStorage.setItem('legacy-excluded-seeded', '1');
    localStorage.setItem(
      'ff14_favorite_lists_v3',
      JSON.stringify({
        version: 3,
        selectedListId: 'legacy-excluded',
        lists: [
          {
            id: 'legacy-excluded',
            name: '旧対象外',
            itemIds: [45917, 1602],
            recipeSelections: {},
            materialSelected: false
          }
        ]
      })
    );
  });

  await openApp(page);
  await expect(page.locator('#loadStatus')).toHaveText('patch 7.55 対応');
  await expect(page.locator('#loadStatus')).not.toHaveAttribute('title');
  await expect(page.locator('#confirmOverlay')).toHaveClass(/info/);
  await expect(page.locator('#confirmMsg')).toHaveText(
    'お気に入りを現行データへ移行しました。\n\n' +
      '現在の対象データに存在しない1件を除外しました。\n・ヘビーアタキサイト'
  );
  await page.locator('#confirmNo').click();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('ff14_favorite_lists_v3')));
  expect(stored.lists.find(list => list.id === 'legacy-excluded').itemIds).toEqual(['バスタードソード']);

  await page.reload();
  await expect(page.locator('#loadStatus')).toHaveText('patch 7.55 対応');
  await expect(page.locator('#loadingOverlay')).not.toHaveClass(/open/);
  await expect(page.locator('#confirmOverlay')).not.toHaveClass(/info/);
});

test('silently removes non-recipe items from recent history and keeps them removed', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('recent-non-recipe-seeded') === '1') return;
    sessionStorage.setItem('recent-non-recipe-seeded', '1');
    localStorage.setItem(
      'ff14_favorite_lists_v3',
      JSON.stringify({
        version: 3,
        selectedListId: 'SYSTEM_RECENT_ITEMS',
        lists: [
          {
            id: 'SYSTEM_RECENT_ITEMS',
            name: '検索履歴',
            itemIds: ['ティターニアの羽根'],
            recipeSelections: {}
          }
        ]
      })
    );
  });

  await openApp(page);
  await expect(page.locator('#confirmOverlay')).not.toHaveClass(/info/);
  let recentItems = await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('ff14_favorite_lists_v3'));
    return stored.lists.find(list => list.id === 'SYSTEM_RECENT_ITEMS').itemIds;
  });
  expect(recentItems).toEqual([]);

  await page.reload();
  await expect(page.locator('#loadStatus')).toHaveText('patch 7.55 対応');
  await expect(page.locator('#loadingOverlay')).not.toHaveClass(/open/);
  await expect(page.locator('#confirmOverlay')).not.toHaveClass(/info/);
  recentItems = await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('ff14_favorite_lists_v3'));
    return stored.lists.find(list => list.id === 'SYSTEM_RECENT_ITEMS').itemIds;
  });
  expect(recentItems).toEqual([]);
});

test('round-trips a selected recipe through the compact favorite share code', async ({ page }) => {
  await routeMirageRecipeVariants(page);
  await page.addInitScript(() => {
    localStorage.setItem(
      'ff14_favorite_lists_v3',
      JSON.stringify({
        version: 3,
        selectedListId: 'mirage-list',
        lists: [
          {
            id: 'mirage-list',
            name: 'ミラージュ',
            itemIds: [21800],
            recipeSelections: { 21800: '0e351054234' },
            materialSelected: false
          }
        ]
      })
    );
  });

  await openApp(page);
  await page.locator('#settingsBtn').click();
  await page.locator('#exportListToggle').click();
  await page.locator('#exportListChoices').getByText('ミラージュ', { exact: true }).click();
  const shareCode = await page.locator('#exportCode').inputValue();
  expect(shareCode).toMatch(/^N[A-Za-z0-9_-]+$/);
  expect(shareCode.length).toBeLessThan(100);

  await page.locator('#importCode').fill(shareCode);
  await page.locator('#startImportBtn').click();
  await expect(page.locator('#settingsOverlay')).not.toHaveClass(/open/);

  const imported = await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem('ff14_favorite_lists_v3'));
    return store.lists.find(list => list.id !== 'mirage-list' && list.name.startsWith('ミラージュ'));
  });
  expect(imported.itemIds).toEqual(['ミラージュプリズム']);
  expect(imported.recipeSelections).toEqual({ ミラージュプリズム: '0e351054234' });
});

test('uses the favorite list recipe selection for its material calculation', async ({ page }) => {
  await routeMirageRecipeVariants(page);
  await page.addInitScript(() => {
    localStorage.setItem(
      'ff14_favorite_lists_v3',
      JSON.stringify({
        version: 3,
        selectedListId: 'mirage-list',
        lists: [
          {
            id: 'mirage-list',
            name: '木工ミラージュ',
            itemIds: [21800],
            recipeSelections: { 21800: '0e351054234' },
            materialSelected: false
          }
        ]
      })
    );
  });

  await openApp(page);
  await page.locator('#favBtn').click();
  await page.locator('#favoriteLists').getByText('木工ミラージュ', { exact: true }).click();
  await page.locator('#recipeList').getByText('素材リストを表示').click();
  await expect(page.locator('.materials-list')).toContainText('ウォルナット材');
  await expect(page.locator('.materials-list')).not.toContainText('グロースフォーミュラ・ガンマ');

  await page.reload();
  await expect(page.locator('#loadingOverlay')).not.toHaveClass(/open/);
  await expect(page.locator('.materials-list')).toContainText('ウォルナット材');
  await expect(page.locator('.materials-list')).not.toContainText('グロースフォーミュラ・ガンマ');
  await expect(page.locator('#confirmOverlay')).not.toHaveClass(/open/);
});

test('automatically saves a recipe method that minimizes craft job changes', async ({ page }) => {
  await routeMirageRecipeVariants(page, {
    parentName: 'バスタードソード',
    includeVariantMaterial: false
  });
  await page.addInitScript(() => {
    localStorage.setItem(
      'ff14_favorite_lists_v3',
      JSON.stringify({
        version: 3,
        selectedListId: 'legacy-list',
        lists: [
          {
            id: 'legacy-list',
            name: '旧ミラージュ',
            itemIds: [1602],
            recipeSelections: {},
            materialSelected: false
          }
        ]
      })
    );
  });

  await openApp(page);
  await page.locator('#favBtn').click();
  await page.locator('#favoriteLists').getByText('旧ミラージュ', { exact: true }).click();
  await expect(page.locator('#recipeList .badge-provisional')).toHaveCount(0);
  await expect(page.locator('#confirmOverlay')).toHaveClass(/open/);
  await expect(page.locator('#confirmMsg')).toContainText('製作方法情報がなかったため、次の製作方法に設定しました');
  await expect(page.locator('#confirmMsg')).toContainText(
    'ミラージュプリズム：鍛冶秘伝書:ミラージュプリズム'
  );

  const selections = await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem('ff14_favorite_lists_v3'));
    return store.lists.find(list => list.id === 'legacy-list').recipeSelections;
  });
  expect(selections).toEqual({ ミラージュプリズム: 'a0d2fcedeb3' });

  await page.locator('#confirmNo').click();
  await page.locator('#recipeList').getByText('素材リストを表示').click();
  const intermediateMethod = page
    .locator('.intermediate-tree-node > .intermediate-tree-row .material-name')
    .filter({ hasText: /^ミラージュプリズム$/ })
    .locator('xpath=ancestor::li[contains(@class,"intermediate-tree-node")]')
    .locator('.material-content > .recipe-method-control');
  await intermediateMethod.locator('.recipe-method-summary').click();
  await page
    .locator('.intermediate-tree-node .recipe-method-choice')
    .filter({ hasText: '木工秘伝書:ミラージュプリズム' })
    .click();
  const savedSelections = await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem('ff14_favorite_lists_v3'));
    return store.lists.find(list => list.id === 'legacy-list').recipeSelections;
  });
  expect(savedSelections).toEqual({ ミラージュプリズム: '0e351054234' });
});

test('finalizes missing legacy recipe methods when restoring a favorite list', async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('ff14_favorite_lists_v3')) return;
    localStorage.setItem(
      'ff14_favorite_lists_v3',
      JSON.stringify({
        version: 3,
        selectedListId: 'legacy-restore-list',
        lists: [
          {
            id: 'legacy-restore-list',
            name: '旧データ復帰',
            itemIds: [1602],
            recipeSelections: {},
            materialSelected: false
          }
        ]
      })
    );
  });
  await openApp(page);
  await page.evaluate(() => {
    favoriteStore.selectedListId = 'legacy-restore-list';
    listMode = 'fav';
    saveViewState();
  });

  await page.reload();
  await expect(page.locator('#loadingOverlay')).not.toHaveClass(/open/);
  await expect(page.locator('#confirmMsg')).toContainText(
    '製作方法情報がなかったため、次の製作方法に設定しました'
  );
  const restoredSelections = await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem('ff14_favorite_lists_v3'));
    return store.lists.find(list => list.id === 'legacy-restore-list').recipeSelections;
  });
  expect(Object.keys(restoredSelections).length).toBeGreaterThan(0);

  await page.locator('#confirmNo').click();
  await page.reload();
  await expect(page.locator('#loadingOverlay')).not.toHaveClass(/open/);
  await expect(page.locator('#confirmOverlay')).not.toHaveClass(/open/);
});

test('keeps different recipe selections when summing multiple favorite lists', async ({ page }) => {
  await routeMirageRecipeVariants(page);
  await page.addInitScript(() => {
    localStorage.setItem(
      'ff14_favorite_lists_v3',
      JSON.stringify({
        version: 3,
        selectedListId: null,
        lists: [
          {
            id: 'carpenter-list',
            name: '木工ミラージュ',
            itemIds: [21800],
            recipeSelections: { 21800: '0e351054234' },
            materialSelected: true
          },
          {
            id: 'alchemist-list',
            name: '錬金ミラージュ',
            itemIds: [21800],
            recipeSelections: { 21800: '169de6ea318' },
            materialSelected: true
          }
        ]
      })
    );
  });

  await openApp(page);
  await page.locator('#checkedFavoriteMaterialsBtn').click();
  await expect(page.locator('.materials-list')).toContainText('ウォルナット材');
  await expect(page.locator('.materials-list')).toContainText('グロースフォーミュラ・ガンマ');
});

test('keeps a protected recent-items list limited to recipes', async ({ page }) => {
  await openApp(page);

  await page.locator('#favBtn').click();
  const recentChoice = page.locator('#favoriteLists li').first();
  await expect(recentChoice).toHaveText('検索履歴');
  await expect(recentChoice).toHaveClass(/recent-favorite-list/);
  await expect(recentChoice.locator('button')).toHaveCount(0);

  await searchFor(page, 'アリペブレ');
  await page.getByText('アリペブレ', { exact: true }).first().click();
  await searchFor(page, '山羊乳');
  await page.locator('#recipeList').getByText('山羊乳', { exact: true }).first().click();

  await page.locator('#favBtn').click();
  await page.locator('#favoriteLists').getByText('検索履歴', { exact: true }).click();
  const recentRows = page.locator('#recipeList li.fav-item-row');
  await expect(recentRows).toHaveCount(1);
  await expect(recentRows.nth(0)).toContainText('アリペブレ');
  await expect(page.locator('#recipeList').getByText('並び替え')).toHaveCount(0);
  await expect(page.locator('#recipeList').getByText('素材リストを表示')).toHaveCount(0);

  await recentRows.nth(0).click();
  await expect(page.locator('.result-root-summary .pin-btn').first()).toHaveClass(/inactive/);
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
  await expect
    .poll(async () => {
    const upper = await intermediateHeader.boundingBox();
    const lower = await materialsHeader.boundingBox();
    if (!upper || !lower) return 999;
    return Math.round(lower.y - (upper.y + upper.height));
    })
    .toBeLessThanOrEqual(2);
  await materialsHeader.click();
  await expect(materialsHeader.locator('xpath=following-sibling::*[1]')).toHaveClass(/collapsed/);
  const crystalHeader = page.locator('.materials-section-header').filter({ hasText: '必要なシャード' });
  const exchangeHeader = page.locator('.materials-section-header').filter({ hasText: '必要な交換貨幣' });
  await expect
    .poll(async () => {
    const upper = await materialsHeader.boundingBox();
    const lower = await crystalHeader.boundingBox();
    if (!upper || !lower) return 999;
    return Math.round(lower.y - (upper.y + upper.height));
    })
    .toBeLessThanOrEqual(2);
  await expect
    .poll(async () => {
    const upper = await crystalHeader.boundingBox();
    const lower = await exchangeHeader.boundingBox();
    if (!upper || !lower) return 999;
    return Math.round(lower.y - (upper.y + upper.height));
    })
    .toBeLessThanOrEqual(2);

  await page.reload();
  await expect(page.locator('#loadStatus')).toHaveText('patch 7.55 対応');
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

test('restores left and right scroll positions after reload', async ({ page }) => {
  await openApp(page, 600, 500);
  await page.evaluate(() => {
    const rootName = 'コートリーラヴァー・ソード';
    const itemIds = [
      itemIdForName(rootName),
      ...recipeNames.slice(0, 60).map(itemIdForName)
    ].filter(Boolean);
    const list = createFavoriteList('スクロール復帰', itemIds, {}, { captureSelections: true });
    selectFavoriteList(list.id);
    selectRecipeByName(rootName);
  });
  await page.locator('#materialsViewBtn').click();
  const rightScroll = await page.locator('#panelRight').evaluate(panel => {
    panel.scrollTop = Math.min(180, panel.scrollHeight - panel.clientHeight);
    panel.dispatchEvent(new Event('scroll'));
    return panel.scrollTop;
  });
  expect(rightScroll).toBeGreaterThan(0);

  await page.evaluate(() => showMobilePanel('left'));
  const leftScroll = await page.locator('#recipeList').evaluate(list => {
    list.scrollTop = Math.min(180, list.scrollHeight - list.clientHeight);
    list.dispatchEvent(new Event('scroll'));
    return list.scrollTop;
  });
  expect(leftScroll).toBeGreaterThan(0);
  await page.evaluate(() => showMobilePanel('right'));
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('ff14_view_state_v1')).scroll))
    .toMatchObject({
      recipeList: leftScroll,
      panelRight: rightScroll
    });

  await page.reload();
  await expect(page.locator('#loadingOverlay')).not.toHaveClass(/open/);
  await expect.poll(() => page.locator('#panelRight').evaluate(panel => panel.scrollTop)).toBe(rightScroll);
  await page.evaluate(() => showMobilePanel('left'));
  await expect.poll(() => page.locator('#recipeList').evaluate(list => list.scrollTop)).toBe(leftScroll);
});

test('limits the protected recent-items list to one hundred entries', async ({ page }) => {
  await openApp(page);
  await page.evaluate(async () => {
    const items = (await fetch('./data/Item.json').then(response => response.json())).Items;
    const itemIds = items
      .filter(item => item.Recipe)
      .map(item => item.Name)
      .filter(Boolean)
      .slice(0, 101);
    localStorage.setItem(
      'ff14_favorite_lists_v3',
      JSON.stringify({
      version: 3,
      selectedListId: 'SYSTEM_RECENT_ITEMS',
        lists: [
          {
        id: 'SYSTEM_RECENT_ITEMS',
        name: '検索履歴',
        itemIds,
        recipeSelections: {}
          }
        ]
      })
    );
  });
  await page.reload();
  await expect(page.locator('#loadStatus')).toHaveText('patch 7.55 対応');
  await page.locator('#favBtn').click();
  await page.locator('#favoriteLists').getByText('検索履歴', { exact: true }).click();
  await expect(page.locator('#recipeList li.fav-item-row')).toHaveCount(100);
});
