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
test('loading overlay blocks interaction while it is displayed', async ({ page }) => {
  await openApp(page);
  await expect(page).toHaveTitle('XIVca | FinalFantasy XIV® Crafting Assistant');
  await expect(page.locator('.app-name-logo')).toBeVisible();
  await expect(page.locator('.app-name-logo')).toHaveAttribute(
    'alt',
    'FinalFantasy XIV® Crafting Assistant XIVca(シヴカ)'
  );
  await expect(page.locator('#loadingOverlay')).toHaveCSS('pointer-events', 'auto');
  await expect(page.locator('header #loadStatus')).toHaveText('patch 7.55 対応');
  const cachedItemRequests = await page.evaluate(async () => {
    const dataCacheName = (await caches.keys()).find(name => name.startsWith('ff14recipe-data-'));
    const cache = await caches.open(dataCacheName);
    return (await cache.keys()).filter(request => request.url.includes('/data/Item.json?')).length;
  });
  expect(cachedItemRequests).toBe(1);
  await page.locator('#settingsBtn').click();
  await expect(page.locator('#settingsDialog #appVersion')).toHaveText('v3.21');
});

test('paints startup progress before beginning the data-loading work', async ({ page }) => {
  await page.route('**/data/tips.md*', async route => {
    await new Promise(resolve => setTimeout(resolve, 3500));
    await route.continue();
  });
  await page.goto('/');

  await expect(page.locator('#loadingTitle')).toHaveText('データ読み込み中...');
  await expect(page.locator('#loadingProgressRow')).toBeVisible();
  await expect(page.locator('#loadingDetail')).toBeVisible();
  await expect(page.locator('#loadingProgressPercent')).toBeHidden();
  await expect(page.locator('#loadStatus')).toHaveText('patch 7.55 対応', { timeout: 10_000 });
});

test('shows a startup error instead of leaving the loading message indefinitely', async ({ page }) => {
  await page.route('**/font-size-settings.js*', route =>
    route.fulfill({ contentType: 'text/javascript', body: 'throw new Error("startup test");' })
  );
  await page.goto('/');

  await expect(page.locator('#loadingOverlay')).toHaveClass(/open/);
  await expect(page.locator('#loadingOverlay .loading-title')).toHaveText(
    'アプリの起動に失敗しました。再読み込みしてください。'
  );
  await expect(page.locator('#loadingErrorDetail')).toContainText('startup test');
  await expect(page.locator('#loadStatus')).toHaveText('読み込みエラー');
});

test('keeps search and favorites available when the item image pack cannot be prepared', async ({ page }) => {
  await seedAppStorage(page, {
    favoritesV3: favoriteStore({
      selectedListId: 'pack-failure-list',
      lists: [favoriteList({ id: 'pack-failure-list', name: '画像失敗確認', itemIds: [4422] })]
    })
  });
  const individualImageRequests = [];
  page.on('request', request => {
    if (/\/assets\/item-icons\//u.test(new URL(request.url()).pathname)) individualImageRequests.push(request.url());
  });
  await page.route('**/data/item-icons.pack.gz', route => route.abort());

  await openApp(page);
  await searchFor(page, '岩塩');
  await page.locator('#favBtn').click();
  await page.locator('#favoriteLists').getByText('画像失敗確認', { exact: true }).click();

  await expect(page.locator('#recipeList')).toContainText('カッパーリング');
  expect(individualImageRequests).toEqual([]);
});

test('does not request Cloudflare analytics outside the public site', async ({ page }) => {
  const analyticsRequests = [];
  page.on('request', request => {
    if (request.url().startsWith('https://static.cloudflareinsights.com/')) {
      analyticsRequests.push(request.url());
    }
  });
  await openApp(page);

  expect(analyticsRequests).toEqual([]);
});

test('shows the transfer and listing restriction badge only for confirmed EX items', async ({ page }) => {
  await openApp(page);
  await searchFor(page, '改良用のアイアンネイル');
  const exRow = page.locator('#recipeList li').filter({ hasText: '改良用のアイアンネイル' }).first();
  await expect(exRow.locator('.badge-ex')).toHaveText('譲渡・出品✖');
  const badgeFontSizes = await exRow.evaluate(row => ({
    ex: getComputedStyle(row.querySelector('.badge-ex')).fontSize,
    craft: getComputedStyle(row.querySelector('.job-badge')).fontSize
  }));
  expect(badgeFontSizes.ex).toBe(badgeFontSizes.craft);
  await exRow.click();
  await expect(page.locator('.result-root-summary .badge-ex')).toHaveText('譲渡・出品✖');

  await searchFor(page, 'バスタードソード');
  const normalRow = page
    .locator('#recipeList li')
    .filter({ has: page.getByText('バスタードソード', { exact: true }) })
    .first();
  await expect(normalRow.locator('.badge-ex')).toHaveCount(0);
  await normalRow.click();
  const root = page.locator('.result-root-summary');
  await expect(root.locator('.badge-craft')).toHaveText('鍛冶Lv2');
  await expect(root.locator('.badge-equipment')).toHaveText('Lv5/IL5');
  await expect(root.locator('.badge-equipment-job')).toHaveText('ナ剣');
  await expect(root.getByRole('button', { name: 'バスタードソードの店情報' })).toBeVisible();
});

test('shows the confirmed masterbook on recipe item labels', async ({ page }) => {
  await openApp(page);
  await searchFor(page, 'ギガントガルロングソード');
  const masterbookRow = page
    .locator('#recipeList li')
    .filter({ has: page.getByText('ギガントガルロングソード', { exact: true }) })
    .first();
  await expect(masterbookRow.locator('.badge-craft')).toHaveText('錬成秘伝書:第1巻');
  await expect(masterbookRow.locator('.craft-job-label > .job-icon')).toHaveAttribute(
    'src',
    /^blob:/
  );

  await searchFor(page, 'バスタードソード');
  const normalRow = page
    .locator('#recipeList li')
    .filter({ has: page.getByText('バスタードソード', { exact: true }) })
    .first();
  await expect(normalRow.locator('.badge-craft')).toHaveText('鍛冶Lv2');
});

test('shows one selectable search row per recipe variant and uses the selected ingredients', async ({ page }) => {
  await routeMirageRecipeVariants(page);
  await openApp(page, 420, 700);
  await searchFor(page, 'ミラージュプリズム');
  const rows = page
    .locator('#recipeList li')
    .filter({ has: page.getByText('ミラージュプリズム', { exact: true }) });
  await expect(rows).toHaveCount(7);
  await expect(rows.nth(0).locator('.badge-craft')).toHaveText('木工秘伝書:ミラージュプリズム');
  const firstJobIcon = rows.nth(0).locator('.craft-job-label > .job-icon');
  await expect(firstJobIcon).toHaveAttribute('data-item-icon-file', 'job-icons/carpenter.webp');
  await expect.poll(() => firstJobIcon.evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
  await expect(rows.nth(6).locator('.badge-craft')).toHaveText('錬成秘伝書:ミラージュプリズム');

  const overflowingRows = await rows.evaluateAll(elements => {
    return elements.filter(element => {
      const rowRect = element.getBoundingClientRect();
      const badgeRect = element.querySelector('.craft-job-label').getBoundingClientRect();
      return badgeRect.right > rowRect.right + 0.5;
    }).length;
  });
  expect(overflowingRows).toBe(0);

  const searchIconWidth = await rows
    .nth(0)
    .locator('.craft-job-label > .job-icon')
    .evaluate(icon => icon.getBoundingClientRect().width);
  await rows.nth(0).click();
  await expect(page.locator('#treeContainer')).toContainText('ウォルナット材');
  await expect(page.locator('#treeContainer')).not.toContainText('グロースフォーミュラ・ガンマ');
  const rootSummary = page.locator('.result-root-summary');
  await expect(rootSummary).toHaveClass(/recipe-method-root/);
  await expect(rootSummary.locator('.root-item-main > .recipe-method-control')).toHaveCount(1);
  await expect(rootSummary.locator('.root-item-display-label .craft-job-label')).toHaveCount(0);
  await expect(rootSummary.getByText('製作方法', { exact: true })).toHaveCount(0);
  await expect(page.locator('.recipe-methods-section')).toHaveCount(0);
  const rootLayout = await rootSummary.evaluate(root => {
    const name = root.querySelector('.list-name').getBoundingClientRect();
    const qty = root.querySelector('.node-qty').getBoundingClientRect();
    const method = root.querySelector('.root-item-main > .recipe-method-control').getBoundingClientRect();
    const box = root.getBoundingClientRect();
    return {
      quantityGap: qty.left - name.right,
      methodAboveName: method.bottom <= name.top,
      methodNameAlignment: Math.abs(method.left - name.left),
      methodWidthShare: method.width / box.width,
      methodInside: method.left >= box.left && method.right <= box.right && method.bottom <= box.bottom
    };
  });
  expect(rootLayout.quantityGap).toBeLessThanOrEqual(12);
  expect(rootLayout.methodAboveName).toBe(true);
  expect(rootLayout.methodNameAlignment).toBeLessThan(1);
  expect(rootLayout.methodWidthShare).toBeLessThan(0.75);
  expect(rootLayout.methodInside).toBe(true);
  const selectorIconWidth = await page
    .locator('.result-root-summary .recipe-method-summary .craft-job-label > .job-icon')
    .evaluate(icon => icon.getBoundingClientRect().width);
  expect(Math.abs(searchIconWidth - selectorIconWidth)).toBeLessThan(0.01);
  await page.locator('.result-root-summary .recipe-method-summary').click();
  await expect(page.locator('.result-root-summary .recipe-method-choice')).toHaveCount(7);
  await expect(page.locator('.result-root-summary .recipe-method-choice').first()).toBeVisible();
  for (let level = 1; level <= 10; level += 1) {
    await page.locator('html').evaluate((element, selectedLevel) => {
      element.dataset.fontSizeLevel = String(selectedLevel);
    }, level);
    const dropdownLayout = await page.locator('.result-root-summary .recipe-method-selector').evaluate(selector => {
      const trigger = selector.querySelector('.recipe-method-summary').getBoundingClientRect();
      const list = selector.querySelector('.recipe-method-choices').getBoundingClientRect();
      const summary = selector.querySelector('.recipe-method-summary');
      const choice = selector.querySelector('.recipe-method-choice');
      return {
        trigger,
        list,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        scale: Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--font-size-scale')),
        summaryFont: Number.parseFloat(getComputedStyle(summary).fontSize),
        choiceFont: Number.parseFloat(getComputedStyle(choice).fontSize),
        summaryBadgeFont: Number.parseFloat(getComputedStyle(summary.querySelector('.badge')).fontSize),
        choiceBadgeFont: Number.parseFloat(getComputedStyle(choice.querySelector('.badge')).fontSize),
        summaryIconWidth: summary.querySelector('.job-icon').getBoundingClientRect().width,
        checkFont: Number.parseFloat(getComputedStyle(choice.querySelector('.recipe-method-check')).fontSize)
      };
    });
    expect(Math.abs(dropdownLayout.list.left - dropdownLayout.trigger.left), `method left Level ${level}`).toBeLessThan(1);
    expect(Math.abs(dropdownLayout.list.width - dropdownLayout.trigger.width), `method width Level ${level}`).toBeLessThan(1);
    expect(Math.abs(dropdownLayout.list.top - dropdownLayout.trigger.bottom), `method top Level ${level}`).toBeLessThan(1);
    expect(dropdownLayout.list.right, `method right Level ${level}`).toBeLessThanOrEqual(dropdownLayout.viewportWidth);
    expect(dropdownLayout.list.bottom, `method bottom Level ${level}`).toBeLessThanOrEqual(dropdownLayout.viewportHeight);
    expect(dropdownLayout.summaryFont, `method summary font Level ${level}`).toBeCloseTo(13 * dropdownLayout.scale, 1);
    expect(dropdownLayout.choiceFont, `method choice font Level ${level}`).toBeCloseTo(13 * dropdownLayout.scale, 1);
    expect(dropdownLayout.summaryBadgeFont, `method summary badge Level ${level}`).toBeCloseTo(12 * dropdownLayout.scale, 1);
    expect(dropdownLayout.choiceBadgeFont, `method choice badge Level ${level}`).toBeCloseTo(12 * dropdownLayout.scale, 1);
    expect(dropdownLayout.summaryIconWidth, `method job icon Level ${level}`).toBeCloseTo(17.78 * dropdownLayout.scale, 1);
    expect(dropdownLayout.checkFont, `method check Level ${level}`).toBeCloseTo(13 * dropdownLayout.scale, 1);
  }
  await page.locator('html').evaluate(element => { element.dataset.fontSizeLevel = '3'; });
  const clippedRecipeMethodLabels = await page
    .locator('.result-root-summary .recipe-method-choice')
    .evaluateAll(choices =>
      choices.filter(choice => {
        const choiceBox = choice.getBoundingClientRect();
        const visualBox = choice.querySelector('.recipe-method-visual').getBoundingClientRect();
        return visualBox.left < choiceBox.left || visualBox.right > choiceBox.right;
      }).length
    );
  expect(clippedRecipeMethodLabels).toBe(0);
  const mobileSelectorWidths = await page.locator('.result-root-summary .recipe-method-control').evaluate(control => ({
    control: control.getBoundingClientRect().width,
    choices: control.querySelector('.recipe-method-choices').getBoundingClientRect().width
  }));
  expect(Math.abs(mobileSelectorWidths.control - mobileSelectorWidths.choices)).toBeLessThan(1);
  await page.evaluate(() => showMobilePanel('left', { animate: false }));
  await rows.nth(6).click();
  await expect(page.locator('#treeContainer')).toContainText('グロースフォーミュラ・ガンマ');
  await expect(page.locator('#treeContainer')).not.toContainText('ウォルナット材');

  await page.reload();
  await expect(page.locator('#loadingOverlay')).not.toHaveClass(/open/);
  await expect(page.locator('#treeContainer')).toContainText('グロースフォーミュラ・ガンマ');
  await expect(page.locator('#treeContainer')).not.toContainText('ウォルナット材');
});

test('loads all recipe variants from the published item data', async ({ page }) => {
  await openApp(page);
  await searchFor(page, 'ミラージュプリズム');
  const rows = page
    .locator('#recipeList li')
    .filter({ has: page.getByText('ミラージュプリズム', { exact: true }) });
  await expect(rows).toHaveCount(7);
  await expect(rows.nth(0).locator('.craft-job-label > .job-icon')).toHaveAttribute(
    'src',
    /^blob:/
  );
  await expect(rows.nth(6).locator('.craft-job-label > .job-icon')).toHaveAttribute(
    'src',
    /^blob:/
  );
});

test('keeps recipe method text aligned with the left list and job icons aligned with the right panel', async ({
  page
}) => {
  await routeMirageRecipeVariants(page);
  await openApp(page, 900, 700);
  await searchFor(page, 'ミラージュプリズム');
  const row = page
    .locator('#recipeList li')
    .filter({ has: page.getByText('ミラージュプリズム', { exact: true }) })
    .first();
  await row.click();
  const selector = page.locator('.result-root-summary .recipe-method-selector');
  await selector.locator('.recipe-method-summary').click();

  const sizes = await page.evaluate(() => {
    const leftBadge = document.querySelector('#recipeList li .craft-job-label .badge');
    const summary = document.querySelector('.result-root-summary .recipe-method-summary');
    const choice = document.querySelector('.result-root-summary .recipe-method-choice');
    const scale = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--font-size-scale'));
    return {
      scale,
      leftBadgeFont: Number.parseFloat(getComputedStyle(leftBadge).fontSize),
      leftBadgeColor: getComputedStyle(leftBadge).color,
      leftBadgeBackground: getComputedStyle(leftBadge).backgroundColor,
      leftIconWidth: leftBadge.closest('.craft-job-label').querySelector('.job-icon').getBoundingClientRect().width,
      summaryBadgeFont: Number.parseFloat(getComputedStyle(summary.querySelector('.badge')).fontSize),
      choiceBadgeFont: Number.parseFloat(getComputedStyle(choice.querySelector('.badge')).fontSize),
      summaryIconWidth: summary.querySelector('.job-icon').getBoundingClientRect().width,
      choiceIconWidth: choice.querySelector('.job-icon').getBoundingClientRect().width,
      maxJobCenterDelta: Math.max(
        ...[...document.querySelectorAll('.job-icon')]
          .filter(icon => icon.getClientRects().length > 0)
          .map(icon => {
            const label = icon.closest('.craft-job-label, .job-badge');
            const text = label?.querySelector('.job-badge-text');
            if (!text) return 0;
            const iconBox = icon.getBoundingClientRect();
            const textBox = text.getBoundingClientRect();
            return Math.abs(iconBox.top + iconBox.height / 2 - (textBox.top + textBox.height / 2));
          })
      ),
      summaryPadding: getComputedStyle(summary).padding,
      choicePadding: getComputedStyle(choice).padding
    };
  });
  expect(sizes.summaryBadgeFont).toBeCloseTo(sizes.leftBadgeFont, 1);
  expect(sizes.choiceBadgeFont).toBeCloseTo(sizes.leftBadgeFont, 1);
  expect(sizes.summaryIconWidth).toBeCloseTo(sizes.leftIconWidth, 1);
  expect(sizes.summaryIconWidth).toBeCloseTo(17.78 * sizes.scale, 1);
  expect(sizes.choiceIconWidth).toBeCloseTo(sizes.summaryIconWidth, 1);
  expect(sizes.maxJobCenterDelta).toBeLessThan(0.51);

  await page.locator('#settingsBtn').click();
  await page.locator('#settingsDisplayTab').click();
  const previewSizes = await page.locator('#fontSizePreview .craft-job-label').evaluate(label => ({
    badgeFont: Number.parseFloat(getComputedStyle(label.querySelector('.badge')).fontSize),
    badgeColor: getComputedStyle(label.querySelector('.badge')).color,
    badgeBackground: getComputedStyle(label.querySelector('.badge')).backgroundColor,
    iconWidth: label.querySelector('.job-icon').getBoundingClientRect().width,
    centerDelta: (() => {
      const iconBox = label.querySelector('.job-icon').getBoundingClientRect();
      const textBox = label.querySelector('.job-badge-text').getBoundingClientRect();
      return Math.abs(iconBox.top + iconBox.height / 2 - (textBox.top + textBox.height / 2));
    })()
  }));
  expect(previewSizes.badgeFont).toBeCloseTo(sizes.leftBadgeFont, 1);
  expect(previewSizes.badgeColor).toBe(sizes.leftBadgeColor);
  expect(previewSizes.badgeBackground).toBe(sizes.leftBadgeBackground);
  expect(previewSizes.iconWidth).toBeCloseTo(sizes.summaryIconWidth, 1);
  expect(previewSizes.centerDelta).toBeLessThan(0.51);
  await expect(page.locator('#fontSizePreview .craft-supplement-count')).toHaveCount(1);
  await page.locator('#settingsCloseBtn').click();

  await page.setViewportSize({ width: 420, height: 700 });
  await searchFor(page, 'ミラージュプリズム');
  await page
    .locator('#recipeList li')
    .filter({ has: page.getByText('ミラージュプリズム', { exact: true }) })
    .first()
    .click();
  await page.locator('.result-root-summary .recipe-method-summary').click();
  const mobileSizes = await page.evaluate(() => {
    const summary = document.querySelector('.result-root-summary .recipe-method-summary');
    const choice = document.querySelector('.result-root-summary .recipe-method-choice');
    return {
      summaryBadgeFont: Number.parseFloat(getComputedStyle(summary.querySelector('.badge')).fontSize),
      choiceBadgeFont: Number.parseFloat(getComputedStyle(choice.querySelector('.badge')).fontSize),
      summaryIconWidth: summary.querySelector('.job-icon').getBoundingClientRect().width,
      choiceIconWidth: choice.querySelector('.job-icon').getBoundingClientRect().width,
      summaryPadding: getComputedStyle(summary).padding,
      choicePadding: getComputedStyle(choice).padding
    };
  });
  expect(mobileSizes).toEqual({
    summaryBadgeFont: sizes.summaryBadgeFont,
    choiceBadgeFont: sizes.choiceBadgeFont,
    summaryIconWidth: sizes.summaryIconWidth,
    choiceIconWidth: sizes.choiceIconWidth,
    summaryPadding: sizes.summaryPadding,
    choicePadding: sizes.choicePadding
  });
});

test('uses the right-panel item name size across every panel and the display preview', async ({ page }) => {
  await openApp(page, 900, 700);
  await searchFor(page, 'バスタードソード');
  await page.getByText('バスタードソード', { exact: true }).first().click();
  await page.evaluate(() => showUsesPanel('ブロンズインゴット', { record: false }));

  const assertCommonItemNameFonts = async selectors => {
    for (let level = 1; level <= 10; level += 1) {
      const result = await page.evaluate(({ selectedLevel, selectedSelectors }) => {
        document.documentElement.dataset.fontSizeLevel = String(selectedLevel);
        const scale = Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue('--font-size-scale')
        );
        return {
          expected: 14 * scale,
          fonts: selectedSelectors.map(selector => {
            const element = document.querySelector(selector);
            return element ? Number.parseFloat(getComputedStyle(element).fontSize) : null;
          })
        };
      }, { selectedLevel: level, selectedSelectors: selectors });
      expect(result.fonts.every(font => font !== null), `item names exist at Level ${level}`).toBe(true);
      result.fonts.forEach(font => expect(font, `item name Level ${level}`).toBeCloseTo(result.expected, 1));
    }
  };

  await assertCommonItemNameFonts([
    '#recipeList .list-name',
    '#usesList .list-name',
    '.result-root-summary .list-name',
    '#treeContainer .node-name'
  ]);
  await page.locator('#materialsViewBtn').click();
  await assertCommonItemNameFonts([
    '#recipeList .list-name',
    '#usesList .list-name',
    '.result-root-summary .list-name',
    '#treeContainer .material-name'
  ]);

  await page.locator('#settingsBtn').click();
  await page.locator('#settingsDisplayTab').click();
  for (let level = 1; level <= 10; level += 1) {
    const previewFont = await page.locator('#fontSizePreview').evaluate((preview, selectedLevel) => {
      preview.dataset.fontSizeLevel = String(selectedLevel);
      const scale = Number.parseFloat(getComputedStyle(preview).getPropertyValue('--font-size-scale'));
      return {
        expected: 14 * scale,
        actual: Number.parseFloat(getComputedStyle(preview.querySelector('.list-name')).fontSize)
      };
    }, level);
    expect(previewFont.actual, `preview item name Level ${level}`).toBeCloseTo(previewFont.expected, 1);
  }
});

test('offers the same recipe selector for an intermediate item in the tree and materials list', async ({
  page
}) => {
  await routeMirageRecipeVariants(page, { parentName: 'バスタードソード' });
  await openApp(page);
  await searchFor(page, 'バスタードソード');
  await page.getByText('バスタードソード', { exact: true }).first().click();
  await page.locator('#countInput').fill('6');

  const intermediate = page.locator('.tree-node').filter({
    has: page.getByText('ミラージュプリズム', { exact: true })
  });
  await expect(intermediate.locator('.node-main > .recipe-method-control')).toHaveCount(1);
  const methodSummary = intermediate.locator('.node-main > .recipe-method-control .recipe-method-summary');
  await methodSummary.click();
  await expect(methodSummary).toHaveAttribute('aria-expanded', 'true');
  await intermediate
    .locator('.node-main > .recipe-method-control .recipe-method-choice')
    .filter({ hasText: '木工秘伝書:ミラージュプリズム' })
    .click();
  await expect(page.locator('#countInput')).toHaveValue('6');
  await expect(page.locator('#treeContainer')).toContainText('ウォルナット材');

  await page.locator('#materialsViewBtn').click();
  await expect(page.locator('.recipe-methods-section')).toHaveCount(0);
  const materialIntermediate = page
    .locator('.intermediate-tree-node > .intermediate-tree-row .material-name')
    .filter({ hasText: /^ミラージュプリズム$/ })
    .locator('xpath=ancestor::li[contains(@class,"intermediate-tree-node")]');
  await expect(materialIntermediate.locator('.material-content > .recipe-method-control')).toHaveCount(1);
  await expect(materialIntermediate.locator('.material-primary > .craft-job-label')).toHaveCount(0);
  await expect(materialIntermediate.getByText('製作方法', { exact: true })).toHaveCount(0);
  const materialMethodLayout = await materialIntermediate.evaluate(node => {
    const item = node.getBoundingClientRect();
    const icon = node.querySelector('.checkable-item-icon, .intermediate-tree-row > .list-icon').getBoundingClientRect();
    const actions = node.querySelector('.intermediate-tree-row > .item-action-buttons').getBoundingClientRect();
    const method = node.querySelector('.material-content > .recipe-method-control').getBoundingClientRect();
    const name = node.querySelector('.material-name').getBoundingClientRect();
    const itemBorder = getComputedStyle(node.querySelector(':scope > .intermediate-tree-row')).borderBottomWidth;
    const nodeBorder = getComputedStyle(node).borderBottomWidth;
    return {
      indented: method.left > item.left,
      methodAboveName: method.bottom <= name.top,
      methodNameAlignment: Math.abs(method.left - name.left),
      iconCenter: icon.top + icon.height / 2 - (item.top + item.height / 2),
      actionCenter: actions.top + actions.height / 2 - (item.top + item.height / 2),
      selectorActionGap: actions.left - method.right,
      trailingSpace: item.right - actions.right,
      itemBorder,
      nodeBorder
    };
  });
  expect(materialMethodLayout.indented).toBe(true);
  expect(materialMethodLayout.methodAboveName).toBe(true);
  expect(materialMethodLayout.methodNameAlignment).toBeLessThan(1);
  expect(Math.abs(materialMethodLayout.iconCenter)).toBeLessThan(1);
  expect(Math.abs(materialMethodLayout.actionCenter)).toBeLessThan(1);
  expect(materialMethodLayout.selectorActionGap).toBeGreaterThanOrEqual(0);
  expect(materialMethodLayout.trailingSpace).toBeGreaterThan(20);
  expect(materialMethodLayout.itemBorder).toBe('0px');
  expect(materialMethodLayout.nodeBorder).toBe('1px');

  await materialIntermediate.locator('.recipe-method-summary').click();
  const methodChoiceLayout = await materialIntermediate.locator('.recipe-method-choice').first().evaluate(choice => {
    const check = choice.querySelector('.recipe-method-check').getBoundingClientRect();
    const visual = choice.querySelector('.recipe-method-visual').getBoundingClientRect();
    return {
      flexWrap: getComputedStyle(choice).flexWrap,
      checkBeforeVisual: check.right <= visual.left + 1,
      verticallyAligned: check.top < visual.bottom && check.bottom > visual.top
    };
  });
  expect(methodChoiceLayout.flexWrap).toBe('nowrap');
  expect(methodChoiceLayout.checkBeforeVisual).toBe(true);
  expect(methodChoiceLayout.verticallyAligned).toBe(true);

  const intermediateHeader = page.locator('.materials-section-header').filter({ hasText: '製作する中間素材' });
  await intermediateHeader.click();
  await expect(materialIntermediate).toHaveClass(/collapsed/);
  await expect(materialIntermediate.locator('.checkable-item-icon')).toBeHidden();
  await expect.poll(() => materialIntermediate.evaluate(node => node.getBoundingClientRect().height)).toBe(0);
  await intermediateHeader.click();
  await expect(materialIntermediate).not.toHaveClass(/collapsed/);

  await materialIntermediate.locator('.intermediate-material-tree-btn').click();
  const materialTreeRoot = page.locator('#materialTreeContent .material-tree-root-summary');
  await expect(materialTreeRoot.locator('.root-item-main > .recipe-method-control')).toHaveCount(1);
  const materialTreeMethodLayout = await materialTreeRoot.evaluate(root => {
    const method = root.querySelector('.root-item-main > .recipe-method-control').getBoundingClientRect();
    const name = root.querySelector('.list-name').getBoundingClientRect();
    return {
      methodAboveName: method.bottom <= name.top,
      methodNameAlignment: Math.abs(method.left - name.left)
    };
  });
  expect(materialTreeMethodLayout.methodAboveName).toBe(true);
  expect(materialTreeMethodLayout.methodNameAlignment).toBeLessThan(1);
  await page.locator('#materialTreeCloseBtn').click();

  const rootAndListWidths = await page.evaluate(() => {
    const root = document.querySelector('.result-root-summary').getBoundingClientRect();
    const list = document.querySelector('.materials-list').getBoundingClientRect();
    return { root: root.width, list: list.width };
  });
  expect(Math.abs(rootAndListWidths.root - rootAndListWidths.list)).toBeLessThan(1);

  await page.setViewportSize({ width: 600, height: 780 });
  await searchFor(page, 'バスタードソード');
  await page
    .locator('#recipeList li')
    .filter({ has: page.getByText('バスタードソード', { exact: true }) })
    .first()
    .click();
  await page.locator('#materialsViewBtn').click();
  const mobileMaterialIntermediate = page
    .locator('.intermediate-tree-node > .intermediate-tree-row .material-name')
    .filter({ hasText: /^ミラージュプリズム$/ })
    .locator('xpath=ancestor::li[contains(@class,"intermediate-tree-node")]');
  const materialMethod = mobileMaterialIntermediate.locator('.material-content > .recipe-method-control');
  await materialMethod.locator('.recipe-method-summary').click();
  const mobileMethodLayout = await mobileMaterialIntermediate.evaluate(node => {
    const name = node.querySelector('.material-name').getBoundingClientRect();
    const summary = node.querySelector('.recipe-method-summary').getBoundingClientRect();
    const choices = node.querySelector('.recipe-method-choices').getBoundingClientRect();
    const actions = node.querySelector('.intermediate-tree-row .item-action-buttons').getBoundingClientRect();
    const next = node.nextElementSibling?.getBoundingClientRect();
    return {
      connected: Math.abs(choices.top - summary.bottom),
      pushesNextRow: !next || next.top >= choices.bottom - 1,
      nameAlignment: Math.abs(summary.left - name.left),
      actionGap: actions.left - summary.right
    };
  });
  expect(mobileMethodLayout.connected).toBeLessThan(1);
  expect(mobileMethodLayout.pushesNextRow).toBe(false);
  expect(mobileMethodLayout.nameAlignment).toBeLessThanOrEqual(3);
  expect(mobileMethodLayout.actionGap).toBeGreaterThanOrEqual(0);
  await page.setViewportSize({ width: 320, height: 780 });
  const narrowLayout = await mobileMaterialIntermediate.evaluate(node => {
    const nodeBox = node.getBoundingClientRect();
    const icon = node.querySelector('.checkable-item-icon, .intermediate-tree-row > .list-icon').getBoundingClientRect();
    const actions = node.querySelector('.intermediate-tree-row > .item-action-buttons').getBoundingClientRect();
    const selector = node.querySelector('.material-content > .recipe-method-control').getBoundingClientRect();
    return {
      iconCenter: icon.top + icon.height / 2 - (nodeBox.top + nodeBox.height / 2),
      actionCenter: actions.top + actions.height / 2 - (nodeBox.top + nodeBox.height / 2),
      selectorActionGap: actions.left - selector.right
    };
  });
  expect(Math.abs(narrowLayout.iconCenter)).toBeLessThan(1);
  expect(Math.abs(narrowLayout.actionCenter)).toBeLessThan(1);
  expect(narrowLayout.selectorActionGap).toBeGreaterThanOrEqual(0);
});

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
    await expect(page.locator(selector)).toHaveCSS('font-size', '19.8px');
    await expect(page.locator(selector)).toHaveCSS('font-weight', '700');
    await expect.poll(() => page.locator(selector).evaluate(element => Number.parseFloat(getComputedStyle(element).height))).toBeGreaterThanOrEqual(24);
  }

  await page.setViewportSize({ width: 600, height: 700 });
  await expect(page.locator('#countInput')).toHaveCSS('appearance', 'textfield');
  await expect(page.locator('#countInput')).toHaveCSS('font-size', '24.2px');
  await expect.poll(() => page.locator('#countInput').evaluate(element => Number.parseFloat(getComputedStyle(element).height))).toBeGreaterThanOrEqual(32);
  await expect(page.locator('#materialTreeCountInput')).toHaveCSS('font-size', '19.8px');
  for (const selector of ['#materialTreeCountInput', '#materialTreeDecreaseBtn', '#materialTreeIncreaseBtn']) {
    await expect.poll(() => page.locator(selector).evaluate(element => Number.parseFloat(getComputedStyle(element).height))).toBeGreaterThanOrEqual(24);
  }

  await searchFor(page, 'ブラスバスタードソード');
  await page.getByText('ブラスバスタードソード', { exact: true }).first().click();
  await expect(page.locator('#treeContainer .tree-node .node-row').first()).toHaveCSS('white-space', 'normal');
  await page.locator('#materialsViewBtn').click();
  await page.locator('.intermediate-material-tree-btn').first().click();
  await expect(page.locator('#materialTreeContent .tree-node .node-row').first()).toHaveCSS('white-space', 'normal');

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
