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

async function seedFavoriteLists(page, lists, selectedListId = lists[0]?.id || null) {
  await seedAppStorage(page, {
    favoritesV2: favoriteStore({
      version: 2,
      selectedListId,
      lists: lists.map(favoriteList)
    })
  });
}

test('selecting an item in the left panel closes and resets the middle panel', async ({ page }) => {
  await openApp(page);
  await searchFor(page, '岩塩');
  await page
    .locator('#recipeList li')
    .filter({ has: page.getByText('岩塩', { exact: true }) })
    .first()
    .locator('.uses-list-btn')
    .click();
  await expect(page.locator('#panelMiddle')).toHaveClass(/open/);
  await page.locator('#usesList').evaluate(list => {
    list.scrollTop = list.scrollHeight;
  });

  await searchFor(page, 'バスタードソード');
  await page.getByText('バスタードソード', { exact: true }).first().click();
  await expect(page.locator('#panelMiddle')).not.toHaveClass(/open/);
  await expect.poll(() => page.locator('#usesList').evaluate(list => list.scrollTop)).toBe(0);
});

test('combined favorite materials opens directly without confirmation dialog', async ({ page }) => {
  await seedFavoriteLists(page, [
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
  ]);
  await seedAppStorage(page, {
    viewState: {
      v: 1,
      dataVersion: 'ff14recipe-data-7.50-6e392bcc',
      equipmentSearch: { open: true }
    }
  });

  await openApp(page, 423, 780);
  await page.locator('#checkedFavoriteMaterialsBtn').click();
  await expect(page.locator('#confirmOverlay')).toHaveClass(/info/);
  await expect(page.locator('#confirmMsg')).toContainText(
    '製作方法情報がなかったため、次の製作方法に設定しました'
  );
  const resolutionDialogLayout = await page.locator('#confirmDialog').evaluate(dialog => ({
    width: dialog.getBoundingClientRect().width,
    borderWidth: getComputedStyle(dialog).borderTopWidth,
    listBorderWidth: getComputedStyle(dialog.querySelector('.recipe-resolution-list')).borderTopWidth
  }));
  expect(resolutionDialogLayout.width).toBeLessThanOrEqual(420);
  expect(resolutionDialogLayout.borderWidth).toBe('1px');
  expect(resolutionDialogLayout.listBorderWidth).toBe('1px');
  await page.locator('#confirmNo').click();
  await expect(
    page
      .locator('.production-content-section .favorite-list-root-summary')
      .filter({ hasText: 'コートリーブーツ・ディフェンダー' })
  ).toBeVisible();
  await expect(
    page
      .locator('.production-content-section .favorite-list-root-summary')
      .filter({ hasText: 'コートリーブーツ・ヒーラー' })
  ).toBeVisible();
  await expect(page.locator('.production-content-section .production-content-toggle')).toHaveText('▶製作内容');
  await page.locator('.production-content-section .production-content-toggle').click();
  await expect
    .poll(() =>
      page.locator('.production-content-section').evaluate(section => {
        const header = section.querySelector('.production-content-toggle').getBoundingClientRect();
        const firstList = section.querySelector('.favorite-list-root-summary').getBoundingClientRect();
        return firstList.top - header.bottom;
      })
    )
    .toBeGreaterThan(4);
});

test('checked favorite lists use a dedicated combined materials entry and reset on main navigation', async ({
  page
}) => {
  await seedFavoriteLists(page, [
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
  ]);

  await openApp(page, 423, 780);
  await expect(page.locator('#checkedFavoriteMaterialsActions')).toHaveClass(/visible/);
  await expect(page.locator('#searchBox')).toBeDisabled();
  await expect(page.locator('#equipmentSearchToggle')).toBeDisabled();
  await expect(page.locator('#equipmentSearchPanel')).not.toHaveClass(/open/);
  await expect(page.locator('.search-row')).toHaveAttribute('aria-hidden', 'true');
  await expect.poll(() => page.locator('.search-row').evaluate(row => row.getBoundingClientRect().height)).toBe(0);
  await expect(page.locator('#checkedFavoriteMaterialsBtn')).toBeVisible();
  await expect(page.locator('#clearFavoriteMaterialChecksBtn')).toBeVisible();
  const actionColor = await page.locator('#checkedFavoriteMaterialsBtn').evaluate(el => getComputedStyle(el).color);
  await expect(page.locator('#clearFavoriteMaterialChecksBtn')).toHaveCSS('color', actionColor);
  await expect(page.locator('#checkedFavoriteMaterialsActions')).toContainText('拡張機能');
  await expect(page.locator('#checkedFavoriteSumModeBtn')).toHaveClass(/active/);
  await expect(page.locator('#checkedFavoriteMaterialsBtn')).toContainText('素材リストを表示');
  await expect(page.locator('#clearFavoriteMaterialChecksBtn')).toContainText('戻る');
  const modeWidths = await page
    .locator('.checked-favorite-materials-mode button')
    .evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().width));
  expect(Math.abs(modeWidths[0] - modeWidths[1])).toBeLessThan(1);
  const modeLayout = await page.locator('.checked-favorite-materials-mode').evaluate(group => {
    const [first, second] = [...group.querySelectorAll('button')].map(button => button.getBoundingClientRect());
    return {
      gap: getComputedStyle(group).gap,
      separation: second.left - first.right
    };
  });
  expect(modeLayout.gap).toBe('normal');
  expect(Math.abs(modeLayout.separation)).toBeLessThan(1);
  await page.locator('#favBtn').click();
  await expect(page.locator('#favoriteLists')).toHaveClass(/open/);
  await expect(page.locator('#favoriteLists')).not.toContainText('検索履歴');
  await page.locator('#checkedFavoriteMaterialsHelpBtn').click();
  await expect(page.locator('#licenseText')).toContainText('チェックした複数のお気に入りリスト');
  await expect(page.locator('#licenseText')).toContainText('どれか1リスト');
  await expect(page.locator('#licenseText')).toContainText('完成品が直接使う同じ末端素材は各リスト内で合算');
  await expect(page.locator('#licenseText')).toContainText('同じ中間素材もリスト間で最も多く必要な数');
  await expect(page.locator('#licenseText')).toContainText('共通して使う末端素材は合算');
  await page.locator('#licenseCloseBtn').click();
  await expect(page.locator('#favoriteLists')).toHaveClass(/open/);

  await page.locator('#checkedFavoriteMaterialsBtn').click();
  await expect(page.locator('#confirmOverlay')).toHaveClass(/info/);
  await expect(page.locator('#confirmMsg')).toContainText(
    '製作方法情報がなかったため、次の製作方法に設定しました'
  );
  await page.locator('#confirmNo').click();
  await expect(
    page
      .locator('.production-content-section .favorite-list-root-summary')
      .filter({ hasText: 'コートリーブーツ・ディフェンダー' })
  ).toBeVisible();
  await expect(
    page
      .locator('.production-content-section .favorite-list-root-summary')
      .filter({ hasText: 'コートリーブーツ・ヒーラー' })
  ).toBeVisible();
  await expect(page.locator('.production-content-section .production-content-toggle')).toHaveText('▶製作内容');

  await page.locator('#appTitle').click();
  await expect(page.locator('#checkedFavoriteMaterialsActions')).not.toHaveClass(/visible/);
  await expect(page.locator('#searchBox')).toBeEnabled();
  await expect(page.locator('#equipmentSearchToggle')).toBeEnabled();
  await expect(page.locator('.search-row')).toHaveAttribute('aria-hidden', 'false');
  await expect
    .poll(() => page.locator('.search-row').evaluate(row => row.getBoundingClientRect().height))
    .toBeGreaterThan(25);
  await page.locator('#favBtn').click();
  await expect(page.locator('#favoriteLists')).toHaveClass(/open/);
  await expect(page.locator('#favoriteLists .favorite-list-material-checkbox:checked')).toHaveCount(0);

  await page.locator('#favoriteLists .favorite-list-material-checkbox').first().check();
  await expect(page.locator('#checkedFavoriteMaterialsActions')).toHaveClass(/visible/);
  await page.locator('#clearFavoriteMaterialChecksBtn').click();
  await expect(page.locator('#checkedFavoriteMaterialsActions')).not.toHaveClass(/visible/);
  await expect(page.locator('#searchBox')).toBeEnabled();
  await expect(page.locator('#equipmentSearchToggle')).toBeEnabled();
  await expect(page.locator('#favoriteLists .favorite-list-material-checkbox:checked')).toHaveCount(0);

  if (!(await page.locator('#favoriteLists').evaluate(list => list.classList.contains('open')))) {
    await page.locator('#favBtn').click();
    await expect(page.locator('#favoriteLists')).toHaveClass(/open/);
  }
  await page.locator('#favoriteLists .favorite-list-material-checkbox').first().check();
  await expect(page.locator('#checkedFavoriteMaterialsActions')).toHaveClass(/visible/);
  await expect(page.locator('#searchBox')).toBeDisabled();
  await expect(page.locator('#equipmentSearchToggle')).toBeDisabled();
  await page.locator('#clearFavoriteMaterialChecksBtn').click();
  await searchFor(page, 'バスタードソード');
  await page.getByText('バスタードソード', { exact: true }).first().click();
  await expect(page.locator('#checkedFavoriteMaterialsActions')).not.toHaveClass(/visible/);
  await page.locator('#mobileBackBtn').click();
  await page.locator('#favBtn').click();
  await expect(page.locator('#favoriteLists')).toHaveClass(/open/);
  await expect(page.locator('#favoriteLists .favorite-list-material-checkbox:checked')).toHaveCount(0);
});

test('multiple rings show production bulk controls and preserve purchases when counts change', async ({ page }) => {
  await seedFavoriteLists(page, [
    { id: 'multi-ring', name: '複数指輪', itemIds: [4422, 4430], materialSelected: true }
  ]);
  await openApp(page);
  await page.locator('#checkedFavoriteMaterialsBtn').click();
  const ringSection = page.locator('.favorite-ring-section');
  await expect(ringSection.locator(':scope > .materials-section-header')).toHaveText('指輪');
  await expect(ringSection.locator('.favorite-ring-bulk-actions').getByRole('button')).toHaveText([
    '全て0',
    '全て1つ',
    '全て2つ'
  ]);
  const copper = page
    .locator('.intermediate-tree-row .material-name')
    .filter({ hasText: /^カッパーインゴット$/ })
    .locator('xpath=ancestor::li[contains(@class,"intermediate-tree-node")]');
  await copper.locator('.shop-info-btn').click();
  await page.getByLabel('この中間素材は購入💰して用意する').check();
  await page.locator('#shopCloseBtn').click();
  await ringSection.getByRole('button', { name: '全て2つ' }).click();
  await expect(page.locator('.favorite-ring-toggle button.active').filter({ hasText: '2つ' })).toHaveCount(2);
  await expect(
    page
      .locator('.intermediate-tree-row .material-name')
      .filter({ hasText: /^カッパーインゴット$/ })
      .locator('xpath=ancestor::li[contains(@class,"intermediate-tree-node")]')
  ).toHaveClass(/purchase-selected/);
});

test('combined favorite materials supports ring count toggles and restores them', async ({ page }) => {
  await seedFavoriteLists(page, [
    { id: 'list-ring-a', name: '指輪A', itemIds: [4422], materialSelected: true },
    { id: 'list-ring-b', name: '指輪B', itemIds: [4422], materialSelected: true }
  ]);

  await openApp(page, 423, 780);
  await page.locator('#checkedFavoriteMaterialsBtn').click();
  const ringSection = page.locator('.favorite-ring-section');
  await expect(ringSection.locator('.favorite-ring-controls')).toHaveCount(2);
  await expect(page.locator('.production-content-section .favorite-ring-controls')).toHaveCount(0);
  await expect(ringSection.locator(':scope > .favorite-ring-bulk-actions')).toBeVisible();
  await expect(ringSection.locator('.favorite-ring-bulk-actions button')).toHaveText([
    '全て0',
    '全て1つ',
    '全て2つ'
  ]);
  await expect(ringSection.locator('.favorite-list-root-summary')).toHaveText(['指輪A', '指輪B']);
  const ringSectionLayout = await ringSection.evaluate(section => {
    const header = section.querySelector(':scope > .materials-section-header').getBoundingClientRect();
    const bulk = section.querySelector(':scope > .favorite-ring-bulk-actions').getBoundingClientRect();
    const listBlock = section.querySelector('.favorite-list-production-block');
    const listRoot = listBlock.querySelector('.favorite-list-root-summary .node-row');
    return {
      bulkWidth: bulk.width,
      headerWidth: header.width,
      bulkGap: bulk.top - header.bottom,
      listBorderWidth: getComputedStyle(listBlock).borderLeftWidth,
      listRootBackground: getComputedStyle(listRoot).backgroundColor,
      listRootBorderWidth: getComputedStyle(listRoot).borderTopWidth
    };
  });
  expect(ringSectionLayout.bulkWidth).toBeLessThan(ringSectionLayout.headerWidth);
  expect(ringSectionLayout.bulkGap).toBeGreaterThanOrEqual(8);
  expect(ringSectionLayout.listBorderWidth).toBe('1px');
  expect(ringSectionLayout.listRootBackground).toBe('rgba(0, 0, 0, 0)');
  expect(ringSectionLayout.listRootBorderWidth).toBe('0px');
  const listBox = await page.locator('.favorite-list-root-summary').last().boundingBox();
  const ringBox = await ringSection.locator('.favorite-ring-controls').last().boundingBox();
  expect(listBox).toBeTruthy();
  expect(ringBox).toBeTruthy();
  expect(ringBox.y).toBeGreaterThanOrEqual(listBox.y + listBox.height - 1);
  const firstList = ringSection.locator('.favorite-list-production-block').first();
  const secondList = ringSection.locator('.favorite-list-production-block').last();
  await firstList.locator('.favorite-ring-toggle button').filter({ hasText: /^0$/ }).click();
  await expect(firstList.locator('.favorite-ring-toggle button').filter({ hasText: /^0$/ })).toHaveClass(/active/);
  await expect(secondList.locator('.favorite-ring-toggle button').filter({ hasText: '1つ' })).toHaveClass(/active/);
  await expect(page.locator('.materials-list')).toContainText(/銅鉱\s*×\s*3/);

  await page.reload();
  await expect(page.locator('#loadingOverlay')).not.toHaveClass(/open/);
  await expect(page.locator('#favoriteLists')).toHaveClass(/open/);
  await expect(
    page
      .locator('.favorite-ring-section .favorite-list-production-block')
      .first()
      .locator('.favorite-ring-toggle button')
      .filter({ hasText: /^0$/ })
  ).toHaveClass(/active/);
  await page
    .locator('.favorite-ring-section .favorite-list-production-block')
    .last()
    .locator('.favorite-ring-toggle button')
    .filter({ hasText: '2つ' })
    .click();
  await expect(page.locator('.materials-list')).toContainText(/銅鉱\s*×\s*6/);

  await page.reload();
  await expect(page.locator('#loadingOverlay')).not.toHaveClass(/open/);
  await expect(page.locator('.favorite-ring-section .favorite-ring-controls')).toHaveCount(2);
  await expect(
    page
      .locator('.favorite-ring-section .favorite-list-production-block')
      .first()
      .locator('.favorite-ring-toggle button')
      .filter({ hasText: /^0$/ })
  ).toHaveClass(/active/);
  await expect(
    page
      .locator('.favorite-ring-section .favorite-list-production-block')
      .last()
      .locator('.favorite-ring-toggle button')
      .filter({ hasText: '2つ' })
  ).toHaveClass(/active/);
  await expect(page.locator('.materials-list')).toContainText(/銅鉱\s*×\s*6/);
});

test('checked favorite lists calculate any one list and restore production disclosure state', async ({ page }) => {
  await seedFavoriteLists(page, [
    { id: 'list-ring-a', name: '指輪A', itemIds: [4422], materialSelected: true },
    { id: 'list-ring-b', name: '指輪B', itemIds: [4422], materialSelected: true }
  ]);

  await openApp(page, 423, 780);
  await page.locator('#checkedFavoriteAnyOneModeBtn').click();
  await expect(page.locator('#checkedFavoriteAnyOneModeBtn')).toHaveClass(/active/);
  await page.locator('#checkedFavoriteMaterialsBtn').click();
  await expect(page.locator('.production-content-section .production-content-toggle')).toHaveText('▶製作内容');
  await page.locator('.production-content-section .production-content-toggle').click();
  await expect(page.locator('.production-content-section .favorite-list-root-summary')).toHaveCount(2);
  await expect(page.locator('.favorite-ring-section .favorite-list-root-summary')).toHaveCount(2);
  const productionLists = page.locator('.production-content-section .production-list-block');
  await expect(productionLists.locator('.production-list-toggle')).toHaveText(['▶', '▶']);
  const productionHierarchy = await page.locator('.production-content-section').evaluate(section => {
    const header = section.querySelector(':scope > .production-content-toggle').getBoundingClientRect();
    const firstList = section.querySelector('.production-list-block').getBoundingClientRect();
    return { childIndent: firstList.left - header.left };
  });
  expect(productionHierarchy.childIndent).toBeGreaterThanOrEqual(12);
  await expect
    .poll(() =>
      page.locator('.production-content-section').evaluate(section => {
        const lastList = [...section.querySelectorAll('.production-list-block')].at(-1).getBoundingClientRect();
        const ringHeader = document
          .querySelector('.favorite-ring-section > .materials-section-header')
          .getBoundingClientRect();
        return ringHeader.top - lastList.bottom;
      })
    )
    .toBeGreaterThanOrEqual(8);
  await expect(productionLists.first().locator(':scope > .production-content-clip')).toHaveClass(/collapsed/);
  await expect(productionLists.first().locator(':scope > .production-content-clip')).toHaveCSS(
    'transition-duration',
    '0.18s'
  );
  await productionLists.first().locator(':scope > .favorite-list-root-summary').click();
  await expect(productionLists.first().locator('.production-list-toggle')).toHaveText('▼');
  await expect(productionLists.first().locator(':scope > .production-content-clip')).not.toHaveClass(/collapsed/);
  await expect(page.locator('.favorite-material-root-or')).toHaveText('もしくは');
  const alternativeGap = await page.locator('.favorite-material-root-or').evaluate(separator => {
    const previous = separator.previousElementSibling.getBoundingClientRect();
    const current = separator.getBoundingClientRect();
    const next = separator.nextElementSibling.getBoundingClientRect();
    return {
      previousGap: current.top - previous.bottom,
      nextGap: next.top - current.bottom
    };
  });
  expect(alternativeGap.previousGap).toBeGreaterThanOrEqual(4);
  expect(alternativeGap.nextGap).toBeGreaterThanOrEqual(4);
  await expect(page.locator('.materials-list')).toContainText(/銅鉱\s*×\s*3/);

  await page
    .locator('.favorite-ring-section .favorite-list-production-block')
    .first()
    .locator('.favorite-ring-toggle button')
    .filter({ hasText: '2つ' })
    .click();
  await expect(page.locator('.materials-list')).toContainText(/銅鉱\s*×\s*6/);
  await page.locator('.production-content-section .production-content-toggle').click();
  await expect(page.locator('.production-content-section .production-content-toggle')).toHaveText('▶製作内容');
  await expect(page.locator('.favorite-ring-section')).toBeVisible();
  await expect
    .poll(() =>
      page.locator('.production-content-section .production-content-toggle').evaluate(header => {
        const ringHeader = document.querySelector('.favorite-ring-section > .materials-section-header');
        return Math.abs(ringHeader.getBoundingClientRect().top - header.getBoundingClientRect().bottom);
      })
    )
    .toBeLessThan(1);

  await page.reload();
  await expect(page.locator('#loadingOverlay')).not.toHaveClass(/open/);
  await expect(page.locator('#favoriteLists')).toHaveClass(/open/);
  await expect(page.locator('#checkedFavoriteAnyOneModeBtn')).toHaveClass(/active/);
  await expect(page.locator('#searchBox')).toBeDisabled();
  await expect(page.locator('#equipmentSearchToggle')).toBeDisabled();
  await expect(page.locator('.production-content-section .production-content-toggle')).toHaveText('▶製作内容');
  await expect(
    page.locator('.production-content-section .production-list-block').first().locator('.production-list-toggle')
  ).toHaveText('▼');
  await expect(
    page.locator('.production-content-section .production-list-block').last().locator('.production-list-toggle')
  ).toHaveText('▶');
  await expect(page.locator('.materials-list')).toContainText(/銅鉱\s*×\s*6/);

  await page.locator('#mobileBackBtn').click();
  await page.locator('#clearFavoriteMaterialChecksBtn').click();
  await expect(page.locator('#checkedFavoriteMaterialsActions')).not.toHaveClass(/visible/);
  await expect(page.locator('.materials-list')).toHaveCount(0);
});

test('checked favorite materials runs with one list and zero ring count', async ({ page }) => {
  await seedFavoriteLists(page, [
    { id: 'list-ring', name: '指輪だけ', itemIds: [4422], materialSelected: true }
  ]);

  await openApp(page, 423, 780);
  await page.locator('#checkedFavoriteAnyOneModeBtn').click();
  await page.locator('#checkedFavoriteMaterialsBtn').click();
  await expect(page.locator('.favorite-list-root-summary')).toContainText('指輪だけ');
  await expect(page.locator('.favorite-material-root-or')).toHaveCount(0);
  await expect(page.locator('.production-content-section .production-list-toggle')).toHaveCount(0);
  await expect(page.locator('.favorite-ring-section .favorite-ring-bulk-actions')).toHaveCount(0);
  await expect(page.locator('.favorite-ring-section .favorite-list-root-summary')).toHaveCount(0);
  await page.locator('.favorite-ring-toggle button').filter({ hasText: /^0$/ }).click();
  await expect(page.locator('.materials-list')).not.toContainText('銅鉱');

  await page.reload();
  await expect(page.locator('#loadingOverlay')).not.toHaveClass(/open/);
  await expect(page.locator('.favorite-ring-toggle button').filter({ hasText: /^0$/ })).toHaveClass(/active/);
  await expect(page.locator('.materials-list')).not.toContainText('銅鉱');
});

test('favorite any-list materials cover shared ingredients for every distinct intermediate', async ({ page }) => {
  await seedFavoriteLists(
    page,
    [49251, 49250, 49258, 49254, 49256].map((itemId, index) => ({
      id: `lover-list-${index}`,
      name: `宝水確認${index + 1}`,
      itemIds: [itemId],
      materialSelected: true
    }))
  );

  await openApp(page);
  await page.locator('#checkedFavoriteAnyOneModeBtn').click();
  await page.locator('#checkedFavoriteMaterialsBtn').click();

  for (const name of ['活力の宝水G4', '剛力の宝水G4', '眼力の宝水G4', '心力の宝水G4', '知力の宝水G4']) {
    await expect(page.locator('.materials-list')).toContainText(name);
  }
  await expect(page.locator('.materials-list')).toContainText(/ガーデン・ソフトウォーター\s*×\s*15/);
  await expect(page.locator('.materials-list')).toContainText(/ヤクテル天然水\s*×\s*5/);
});

test('removing the last material-list check returns to a normal favorite list and restores search history', async ({
  page
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'ff14_favorite_lists_v3',
      JSON.stringify({
        version: 3,
        selectedListId: 'SYSTEM_RECENT_ITEMS',
        lists: [
          {
            id: 'checked-list',
            name: '確認対象',
            itemIds: [1602],
            recipeSelections: {},
            materialSelected: true
          }
        ]
      })
    );
  });
  await openApp(page);
  await page.locator('#favBtn').click();
  await expect(page.locator('#favoriteLists')).not.toContainText('検索履歴');
  await page.locator('#favoriteLists .favorite-list-material-checkbox').uncheck();
  await expect(page.locator('#checkedFavoriteMaterialsActions')).not.toHaveClass(/visible/);
  await expect(page.locator('#favoriteLists')).toContainText('検索履歴');
  await expect(page.locator('#favoriteLists').getByText('確認対象', { exact: true }).locator('..')).toHaveClass(/active/);
});

test('favorite dropdown max height stays within the viewport with checked-list buttons', async ({ page }) => {
  await seedFavoriteLists(
    page,
    Array.from({ length: 40 }, (_, index) => ({
        id: `list-${index}`,
        name: `お気に入りリスト${index + 1}`,
        itemIds: [1602],
        materialSelected: index < 2
    })),
    null
  );

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
