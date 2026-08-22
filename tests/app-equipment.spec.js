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
  publishedDataVersion,
  routeMirageRecipeVariants,
  searchFor
} = require('./helpers/app.js');

const FIXTURE_ITEM_LEVEL_CAP = 770;
test('equipment search lists target gear and saves results as a favorite list', async ({ page }) => {
  await openApp(page);

  await page.locator('#equipmentSearchToggle').click();
  await expect(page.locator('#equipmentSearchToggle')).toHaveText('▲');
  await expect(page.locator('#searchBox')).toBeDisabled();
  await expect(page.locator('#saveEquipmentSearchBtn')).toBeDisabled();
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

test('equipment search reset clears only the conditions', async ({ page }) => {
  await openApp(page);
  await page.locator('#equipmentSearchToggle').click();
  await chooseCustomOption(page, 'equipmentJobSelect', 'ナイト');
  await page.locator('#equipmentLevelInput').fill('100');
  await page.locator('#equipmentLevelInput').dispatchEvent('input');
  await chooseCustomOption(page, 'equipmentItemLevelSelect', '770');
  await page.locator('#equipmentSearchBtn').click();
  await page.locator('#recipeList').getByText('コートリーラヴァー・ソード', { exact: true }).click();
  await expect(page.locator('.result-root-summary')).toContainText('コートリーラヴァー・ソード');
  await expect(page.locator('#equipmentSearchPanel')).toHaveClass(/open/);

  await page.locator('#equipmentSearchResetBtn').click();
  await expect(page.locator('#equipmentJobSelect')).toHaveAttribute('data-value', '');
  await expect(page.locator('#equipmentLevelInput')).toHaveValue('100');
  await expect(page.locator('#equipmentItemLevelSelect')).toHaveAttribute('data-value', '');
  await expect(page.locator('#equipmentSlotSelect')).toHaveAttribute('data-value', 'all');
  await expect(page.locator('#equipmentSearchBtn')).toBeDisabled();
  await expect(page.locator('#equipmentSearchPanel')).toHaveClass(/open/);
  await expect(page.locator('#recipeList')).toContainText('コートリーラヴァー・ソード');
  await expect(page.locator('.result-root-summary')).toContainText('コートリーラヴァー・ソード');
  await expect(page.locator('#saveEquipmentSearchBtn')).toBeDisabled();
});

test('equipment search uses custom dropdowns and recommended roles', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('.equipment-search-grid select')).toHaveCount(0);
  await page.locator('#equipmentSearchToggle').click();
  await expect.poll(() => page.locator('#equipmentSearchToggle').evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(26);
  await expect(page.locator('#favBtn')).toBeHidden();
  await expect(page.locator('#checkedFavoriteMaterialsActions')).toBeHidden();
  await expect(page.locator('#equipmentSearchPanel')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

  await expect(page.locator('#equipmentJobSelect')).toHaveAttribute('data-value', '');
  await expect(page.locator('#equipmentJobSelect')).toContainText('---');
  await expect(page.locator('#equipmentLevelInput')).toHaveJSProperty(
    'value',
    await page.locator('#equipmentLevelInput').getAttribute('max')
  );
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
  await expect(page.locator('#equipmentItemLevelSelect .custom-select-option[data-value="45"]')).toHaveCount(1);
  await expect(page.locator('#equipmentItemLevelSelect')).toHaveAttribute('data-value', '46');
  await page.locator('#equipmentLevelInput').fill('46');
  await page.locator('#equipmentLevelInput').dispatchEvent('input');
  await expect(page.locator('#equipmentItemLevelSelect .custom-select-option[data-value="48"]')).toHaveCount(0);
  await expect(page.locator('#equipmentItemLevelSelect .custom-select-option[data-value="46"]')).toHaveCount(1);
  await expect(page.locator('#equipmentItemLevelSelect')).toHaveAttribute('data-value', '46');
  await expect(page.locator('#equipmentItemLevelSelect .custom-select-option')).toHaveCount(1);
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
  await expect(page.locator('#equipmentJobSelect .job-icon')).toHaveCount(0);
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

test('equipment search applies primary stats and shared low-level physical gear to monk', async ({ page }) => {
  await openApp(page);
  const unclassifiedBattleJobs = await page.evaluate(() =>
    [...EQUIPMENT_JOB_GROUPS.ファイター, ...EQUIPMENT_JOB_GROUPS.ソーサラー]
      .filter(job => !equipmentSearchModel.equipmentPrimaryStatForJob(job))
  );
  expect(unclassifiedBattleJobs).toEqual([]);
  await page.locator('#equipmentSearchToggle').click();
  await chooseCustomOption(page, 'equipmentJobSelect', 'モンク');
  await page.locator('#equipmentLevelInput').fill('45');
  await page.locator('#equipmentLevelInput').dispatchEvent('input');
  await expect(page.locator('#equipmentItemLevelSelect')).toHaveAttribute('data-value', '48');
  await page.locator('#equipmentSearchBtn').click();
  for (const name of [
    'ラプトルフィンガレスグローブ',
    'オルタード・ウールハット',
    'レンジャーハット',
    'ウールチュニック',
    'レンジャーチュニック',
    'ウールトラウザー',
    'オルタード・ウールトラウザー',
    'ボアモカシン',
    'ガーネットチョーカー',
    'ガーネットリング'
  ]) {
    await expect(page.locator('#recipeList')).toContainText(name);
  }
  for (const name of [
    'ボアフィンガレスグローブ', 'ウールケクス', 'アメジストチョーカー', 'アメジストリング'
  ]) {
    await expect(page.locator('#recipeList')).not.toContainText(name);
  }
});

test('desktop left panel resizes, persists, and stacks equipment fields only when required', async ({ page }) => {
  await openApp(page, 1200, 800);
  const setupDuration = await page.evaluate(() => performance.getEntriesByName('application-data-setup')[0]?.duration);
  expect(setupDuration).toBeLessThan(2500);
  await page.locator('#equipmentSearchToggle').click();
  await expect(page.locator('#panelLeft')).not.toHaveClass(/equipment-search-stacked/);
  const sameRow = await page.locator('#equipmentSearchPanel').evaluate(panel => {
    const job = panel.querySelector('.equipment-search-grid > label').getBoundingClientRect();
    const level = panel.querySelector('.equipment-search-field').getBoundingClientRect();
    return Math.abs(job.top - level.top);
  });
  expect(sameRow).toBeLessThan(1);

  const initialWidth = await page.locator('#panelLeft').evaluate(panel => panel.getBoundingClientRect().width);
  const handle = page.locator('#panelLeftResizeHandle');
  const initialMinimumWidth = Number(await handle.getAttribute('data-minimum-width'));
  expect(Math.abs(initialWidth - initialMinimumWidth)).toBeLessThanOrEqual(1);
  const handleBox = await handle.boundingBox();
  expect(handleBox).toBeTruthy();
  await page.mouse.move(handleBox.x + 0.5, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + 80, handleBox.y + handleBox.height / 2, { steps: 5 });
  await page.mouse.up();
  const resizedWidth = await page.locator('#panelLeft').evaluate(panel => panel.getBoundingClientRect().width);
  expect(resizedWidth).toBeGreaterThan(initialWidth + 70);
  await expect.poll(async () =>
    Math.abs((await page.evaluate(() => Number(localStorage.getItem('ff14_panel_left_width_v1')))) - resizedWidth)
  ).toBeLessThanOrEqual(1);

  await page.locator('#appTitle').click();
  await expect.poll(async () =>
    Math.abs((await page.locator('#panelLeft').evaluate(panel => panel.getBoundingClientRect().width)) - resizedWidth)
  ).toBeLessThanOrEqual(1);
  await page.reload();
  await expect(page.locator('#loadingOverlay')).not.toHaveClass(/open/);
  await expect.poll(async () =>
    Math.abs((await page.locator('#panelLeft').evaluate(panel => panel.getBoundingClientRect().width)) - resizedWidth)
  ).toBeLessThanOrEqual(1);

  await page.locator('html').evaluate(element => {
    element.dataset.fontSizeLevel = '10';
  });
  await page.setViewportSize({ width: 600, height: 800 });
  await expect(handle).toBeHidden();
  await page.setViewportSize({ width: 601, height: 800 });
  await expect(handle).toBeVisible();
  await expect(page.locator('#panelLeft')).toHaveClass(/equipment-search-stacked/);
  await page.locator('#equipmentSearchToggle').click();
  const stackedRows = await page.locator('#equipmentSearchPanel').evaluate(panel => {
    const job = panel.querySelector('.equipment-search-grid > label').getBoundingClientRect();
    const level = panel.querySelector('.equipment-search-field').getBoundingClientRect();
    return level.top >= job.bottom;
  });
  expect(stackedRows).toBe(true);

  await page.locator('html').evaluate(element => {
    element.dataset.fontSizeLevel = '3';
  });
  await page.setViewportSize({ width: 1200, height: 800 });
  await expect(page.locator('#panelLeft')).not.toHaveClass(/equipment-search-stacked/);
  await expect.poll(async () =>
    Math.abs((await page.locator('#panelLeft').evaluate(panel => panel.getBoundingClientRect().width)) - resizedWidth)
  ).toBeLessThanOrEqual(1);
});

test('mobile equipment job and level share a row when their controls fit', async ({ page }) => {
  await openApp(page, 480, 800);
  await page.locator('#equipmentSearchToggle').click();
  await expect(page.locator('#panelLeft')).not.toHaveClass(/equipment-search-stacked/);

  const layout = await page.locator('#equipmentSearchPanel').evaluate(panel => {
    const job = panel.querySelector('.equipment-search-grid > label').getBoundingClientRect();
    const level = panel.querySelector('.equipment-search-field').getBoundingClientRect();
    const input = panel.querySelector('#equipmentLevelInput').getBoundingClientRect();
    const buttons = [...panel.querySelectorAll('.equipment-level-control button')].map(button =>
      button.getBoundingClientRect()
    );
    return {
      rowOffset: Math.abs(job.top - level.top),
      inputHeight: input.height,
      inputWidth: input.width,
      buttonHeights: buttons.map(button => button.height),
      buttonWidths: buttons.map(button => button.width),
      controlGaps: [
        buttons[1].left - buttons[0].right,
        input.left - buttons[1].right,
        buttons[2].left - input.right,
        buttons[3].left - buttons[2].right
      ]
    };
  });
  expect(layout.rowOffset).toBeLessThan(1);
  for (const buttonHeight of layout.buttonHeights) {
    expect(Math.abs(layout.inputHeight - buttonHeight)).toBeLessThan(0.1);
  }
  for (const buttonWidth of layout.buttonWidths.slice(1)) {
    expect(Math.abs(layout.buttonWidths[0] - buttonWidth)).toBeLessThan(0.1);
  }
  expect(layout.inputWidth).toBeLessThan(80);
  for (const gap of layout.controlGaps) {
    expect(Math.abs(gap - 3)).toBeLessThan(0.1);
  }
});

test('middle panel uses temporary width and yields before the right panel', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ff14_panel_left_width_v1', '700'));
  await openApp(page, 1000, 800);
  await expect.poll(() => page.locator('#panelLeft').evaluate(panel => panel.getBoundingClientRect().width)).toBeCloseTo(
    700,
    0
  );

  await searchFor(page, 'バスタードソード');
  await page.getByText('バスタードソード', { exact: true }).first().click();
  await page.locator('#usesBtn').click();
  const openLayout = await page.evaluate(() => ({
    left: document.querySelector('#panelLeft').getBoundingClientRect().width,
    middle: document.querySelector('#panelMiddle').getBoundingClientRect().width,
    right: document.querySelector('#panelRight').getBoundingClientRect().width
  }));
  expect(openLayout.left).toBeLessThan(700);
  expect(openLayout.middle).toBeGreaterThanOrEqual(159.5);
  expect(openLayout.right).toBeGreaterThanOrEqual(190);

  await page.locator('#searchBox').click();
  await expect(page.locator('#panelMiddle')).not.toHaveClass(/open/);
  await expect.poll(() => page.locator('#panelLeft').evaluate(panel => panel.getBoundingClientRect().width)).toBeCloseTo(
    700,
    0
  );
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
  await page.addInitScript(() => localStorage.setItem('ff14_search_history', JSON.stringify(['岩塩', 'ブロンズインゴット'])));
  await openApp(page);
  await page.locator('#searchBox').fill('岩塩');
  await expect(page.locator('#recipeList')).not.toContainText('岩塩');
  await page.locator('#searchBox').blur();
  await expect(page.locator('#recipeList li').first()).toContainText('岩塩');
  await page.locator('#searchClearBtn').click();
  await expect(page.locator('#searchBox')).toHaveValue('');
  await expect(page.locator('#recipeList .search-empty-message')).toHaveText('条件に一致するアイテムがありません');
  await expect(page.locator('#recipeList .search-empty-scope')).toHaveText(
    '⚠️ このアプリには、Lodestone に掲載されている「製作レシピがあるアイテム」と、「製作に必要なアイテム」のみ登録されています。'
  );
  const [messageBox, scopeBox] = await Promise.all([
    page.locator('#recipeList .search-empty-message').boundingBox(),
    page.locator('#recipeList .search-empty-scope').boundingBox()
  ]);
  expect(messageBox).toBeTruthy();
  expect(scopeBox).toBeTruthy();
  expect(scopeBox.y).toBeGreaterThanOrEqual(messageBox.y + messageBox.height);
  await expect(page.locator('#searchHistory')).not.toHaveClass(/open/);
  await expect(page.locator('#searchBox')).not.toBeFocused();
});

test('updated search results and result views return to the top', async ({ page }) => {
  await openApp(page);
  await searchFor(page, 'コートリー');
  await page.locator('#recipeList').evaluate(element => {
    element.scrollTop = element.scrollHeight;
  });
  await searchFor(page, '岩塩');
  await expect.poll(() => page.locator('#recipeList').evaluate(element => element.scrollTop)).toBe(0);

  await searchFor(page, 'アリペブレ');
  await page.getByText('アリペブレ', { exact: true }).first().click();
  await page.locator('#treeContainer').evaluate(element => {
    element.scrollTop = element.scrollHeight;
  });
  await page.locator('#materialsViewBtn').click();
  await expect.poll(() => page.locator('#treeContainer').evaluate(element => element.scrollTop)).toBe(0);
});

test('equipment search item levels update by job and restore after reload', async ({ page }) => {
  await openApp(page);

  await page.locator('#equipmentSearchToggle').click();
  await chooseCustomOption(page, 'equipmentJobSelect', '調理師');
  await page.locator('#equipmentLevelInput').fill('50');
  await page.locator('#equipmentLevelInput').dispatchEvent('input');
  await expect(page.locator('#equipmentItemLevelSelect')).toHaveAttribute('data-value', '70');
  await page.locator('#equipmentLevelInput').fill('51');
  await page.locator('#equipmentLevelInput').dispatchEvent('input');
  await expect(page.locator('#equipmentItemLevelSelect')).toHaveAttribute('data-value', '70');
  await page.locator('#equipmentLevelInput').blur();
  await chooseCustomOption(page, 'equipmentItemLevelSelect', '65');
  await chooseCustomOption(page, 'equipmentSlotSelect', 'mainTool');
  await page.locator('#equipmentSearchBtn').click();
  await expect(page.locator('#recipeList')).toContainText('イフリートフライパン');
  await expect(page.locator('#recipeList')).not.toContainText('アーティザンクリナリーナイフ');

  await chooseCustomOption(page, 'equipmentJobSelect', '竜騎士');
  await page.locator('#equipmentLevelInput').fill('100');
  await page.locator('#equipmentLevelInput').dispatchEvent('input');
  await expect(page.locator('#equipmentItemLevelSelect')).toHaveAttribute('data-value', '770');
  await expect(page.locator('#equipmentItemLevelSelect .custom-select-option[data-value="1"]')).toHaveCount(0);

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
  const levelInputWidth = await page
    .locator('#equipmentLevelInput')
    .evaluate(element => element.getBoundingClientRect().width);
  expect(levelInputWidth).toBeGreaterThanOrEqual(42);
});

test('equipment search maximum item level never decreases as equipment level rises', async ({ page }) => {
  await openApp(page);

  const result = await page.evaluate(() => {
    const failures = [];
    let checkedLevels = 0;
    EQUIPMENT_JOB_OPTIONS.forEach(job => {
      setCustomSelectValue(elements.equipmentJobSelect, job);
      let previousMaximum = 0;
      equipmentLevelsForJob(job)
        .sort((a, b) => a - b)
        .forEach(level => {
          elements.equipmentLevelInput.value = String(level);
          updateEquipmentItemLevelOptions();
          const maximum = selectedEquipmentItemLevel();
          checkedLevels += 1;
          if (maximum < previousMaximum) {
            failures.push({ job, level, previousMaximum, maximum });
          }
          previousMaximum = maximum;
        });
    });
    return {
      checkedJobs: EQUIPMENT_JOB_OPTIONS.length,
      checkedLevels,
      failures
    };
  });

  expect(result.checkedJobs).toBeGreaterThan(0);
  expect(result.checkedLevels).toBeGreaterThan(result.checkedJobs);
  expect(result.failures).toEqual([]);
});

test('equipment search excludes bait from web search targets', async ({ page }) => {
  await openApp(page);

  await page.locator('#equipmentSearchToggle').click();
  await chooseCustomOption(page, 'equipmentJobSelect', '漁師');
  await page.locator('#equipmentLevelInput').fill('5');
  await page.locator('#equipmentLevelInput').dispatchEvent('input');

  await expect(page.locator('#equipmentItemLevelSelect .custom-select-option[data-value="5"]')).toHaveCount(1);
  await expect(page.locator('#equipmentSearchBtn')).toBeEnabled();
  await page.locator('#equipmentSearchBtn').click();
  await expect(page.locator('#recipeList')).toContainText('バンダナ');
  await expect(page.locator('#recipeList')).not.toContainText('ザリガニボール');
});

test('equipment search classifies all-class crafter and gatherer gear by every relevant stat family', async ({
  page
}) => {
  await openApp(page);
  await page.locator('#equipmentSearchToggle').click();

  await chooseCustomOption(page, 'equipmentJobSelect', '木工師');
  await page.locator('#equipmentLevelInput').fill('50');
  await page.locator('#equipmentLevelInput').dispatchEvent('input');
  await page.locator('#equipmentSearchBtn').click();
  await expect(page.locator('#recipeList')).toContainText('アーティザンエプロン');
  await expect(page.locator('#recipeList')).toContainText('アーティザンミトン');
  await expect(page.locator('#recipeList')).not.toContainText('フォリジャーベスト');

  await chooseCustomOption(page, 'equipmentJobSelect', '採掘師');
  await page.locator('#equipmentLevelInput').fill('50');
  await page.locator('#equipmentLevelInput').dispatchEvent('input');
  await page.locator('#equipmentSearchBtn').click();
  await expect(page.locator('#recipeList')).toContainText('フォリジャーベスト');
  await expect(page.locator('#recipeList')).not.toContainText('アーティザンエプロン');

  for (const job of ['木工師', '採掘師']) {
    await chooseCustomOption(page, 'equipmentJobSelect', job);
    await page.locator('#equipmentLevelInput').fill('15');
    await page.locator('#equipmentLevelInput').dispatchEvent('input');
    await page.locator('#equipmentSearchBtn').click();
    await expect(page.locator('#recipeList')).toContainText('コットンシェパードチュニック');
  }
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
    const items = (await loadPublishedItems()).filter(item => !item.EquipmentInfo);
    const equipment = (ID, Name, category, jobs, equipLevel, itemLevel) => ({
      ID,
      Name,
      Patch: 750,
      IconFile: '000000.webp',
      ItemUICategoryName: category,
      EquipmentInfo: {
        jobs,
        equipLevel,
        itemLevel,
        stats: { STR: 1, DEX: 0, VIT: 1, INT: 0, MND: 0 },
        performance: {
          physicalDamage: 99999,
          magicalDamage: 0,
          physicalDefense: 99999,
          magicalDefense: 99999
        }
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
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ Version: publishedDataVersion, Items: items })
    });
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
  await expect(
    page.locator('#recipeList li').filter({ hasText: '試験用公式順頭' }).locator('.badge-equipment-job')
  ).toHaveText('ナ詩');
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
    const items = await loadPublishedItems();
    const equipment = (ID, Name, defense, stats) => ({
      ID,
      Name,
      IconFile: '000000.webp',
      ItemUICategoryName: '頭防具',
      Recipe: {
        CraftType: '1',
        AmountResult: '1',
        Ingredients: []
      },
      CraftInfo: [{ job: '鍛冶師', level: 50 }],
      EquipmentInfo: {
        jobs: ['ナイト'],
        equipLevel: 50,
        itemLevel: FIXTURE_ITEM_LEVEL_CAP,
        stats,
        performance: {
          physicalDamage: 0,
          magicalDamage: 0,
          physicalDefense: defense,
          magicalDefense: defense
        }
      }
    });
    items.push(
      equipment('990011', '試験用低防御頭', 9000, { STR: 1, VIT: 1 }),
      equipment('990012', '試験用専門なし頭', 9999, { STR: 9, VIT: 9 }),
      equipment('990013', '試験用同値頭A', 9999, {
        STR: 9,
        VIT: 9,
        不屈: 6,
        DEX: 3
      }),
      equipment('990014', '試験用同値頭B', 9999, {
        STR: 9,
        VIT: 9,
        不屈: 6,
        MND: 4
      })
    );
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ Version: publishedDataVersion, Items: items })
    });
  });
  await openApp(page);
  await page.locator('#equipmentSearchToggle').click();
  await chooseCustomOption(page, 'equipmentJobSelect', 'ナイト');
  await page.locator('#equipmentLevelInput').fill('50');
  await page.locator('#equipmentLevelInput').dispatchEvent('input');
  await chooseCustomOption(page, 'equipmentItemLevelSelect', String(FIXTURE_ITEM_LEVEL_CAP));
  await chooseCustomOption(page, 'equipmentSlotSelect', 'head');
  await page.locator('#equipmentSearchBtn').click();

  await expect(page.locator('#recipeList')).not.toContainText('試験用低防御頭');
  await expect(page.locator('#recipeList')).not.toContainText('試験用専門なし頭');
  await expect(page.locator('#recipeList')).toContainText('試験用同値頭A');
  await expect(page.locator('#recipeList')).toContainText('試験用同値頭B');
  await expect(page.locator('#recipeList .equipment-duplicate-row')).toHaveCount(2);
  await expect(page.locator('#recipeList .equipment-duplicate-warning')).toHaveCount(2);
  await expect(page.locator('#recipeList')).toContainText('DEX +3');
  await expect(page.locator('#recipeList')).toContainText('MND +4');
  await expect(page.locator('#recipeList')).not.toContainText('STR +9');
  await expect(page.locator('#recipeList')).not.toContainText('不屈 +6');
  await expect(page.locator('#recipeList')).not.toContainText('物理防御');
  await page.locator('#saveEquipmentSearchBtn').click();
  await page.locator('#textInputOkBtn').click();
  await expect(page.locator('#recipeList .equipment-duplicate-warning')).toHaveCount(0);
  await expect(page.locator('#recipeList .equipment-parameters')).toHaveCount(2);
  await page
    .locator('#recipeList li')
    .filter({ has: page.getByText('試験用同値頭A', { exact: true }) })
    .click();
  await expect(page.locator('.result-root-summary .equipment-parameters')).toHaveText('DEX +3');
  await expect(page.locator('.result-root-summary')).not.toContainText('STR +9');

  await page.evaluate(() => {
    const list = getDisplayedFavoriteList();
    list.itemIds.push(990012);
    saveFavorites();
    renderList();
  });
  await expect(page.locator('#recipeList .equipment-parameters')).toHaveCount(2);
  await expect(page.locator('#recipeList')).not.toContainText('STR +9');

  await page.evaluate(() => {
    const list = createFavoriteList('通常のお気に入り', ['試験用同値頭A', '試験用同値頭B']);
    selectFavoriteList(list.id);
  });
  await expect(page.locator('#recipeList .equipment-parameters')).toHaveCount(0);

  await page.evaluate(() => {
    const list = favoriteStore.lists.find(candidate => candidate.name.includes('ナイト:装備Lv50'));
    selectFavoriteList(list.id);
  });
  await expect(page.locator('#recipeList .equipment-parameters')).toHaveCount(2);
  await page.locator('#recipeList').getByText('素材リストを表示').click();
  await expect(page.locator('.production-content-section .equipment-parameters')).toHaveCount(0);
});
