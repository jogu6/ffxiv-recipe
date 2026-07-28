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
test('loading overlay blocks interaction while it is displayed', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('#loadingOverlay')).toHaveCSS('pointer-events', 'auto');
  await expect(page.locator('header #loadStatus')).toHaveText('patch 7.5 対応');
  await page.locator('#settingsBtn').click();
  await expect(page.locator('#settingsDialog #appVersion')).toHaveText('v2.96');
});

test('shows the transfer and listing restriction badge only for confirmed EX items', async ({ page }) => {
  await openApp(page);
  await searchFor(page, '改良用のアイアンネイル');
  const exRow = page.locator('#recipeList li').filter({ hasText: '改良用のアイアンネイル' }).first();
  await expect(exRow.locator('.badge-ex')).toHaveText('譲渡・出品✖');
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
    './assets/job-icons/alchemist.webp'
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
  await expect(rows.nth(0).locator('.craft-job-label > .job-icon')).toHaveAttribute(
    'src',
    './assets/job-icons/carpenter.webp'
  );
  await expect(rows.nth(6).locator('.badge-craft')).toHaveText('錬成秘伝書:ミラージュプリズム');

  const overflowingRows = await rows.evaluateAll(elements => {
    return elements.filter(element => {
      const rowRect = element.getBoundingClientRect();
      const badgeRect = element.querySelector('.craft-job-label').getBoundingClientRect();
      return badgeRect.right > rowRect.right + 0.5;
    }).length;
  });
  expect(overflowingRows).toBe(0);

  const searchIconRatio = await rows
    .nth(0)
    .locator('.craft-job-label')
    .evaluate(label => label.querySelector('.job-icon').getBoundingClientRect().width / parseFloat(getComputedStyle(label).fontSize));
  await rows.nth(0).click();
  await expect(page.locator('#treeContainer')).toContainText('ウォルナット材');
  await expect(page.locator('#treeContainer')).not.toContainText('グロースフォーミュラ・ガンマ');
  const rootSummary = page.locator('.result-root-summary');
  await expect(rootSummary).toHaveClass(/recipe-method-root/);
  await expect(rootSummary.locator(':scope > .recipe-method-control')).toHaveCount(1);
  await expect(rootSummary.locator('.root-item-display-label .craft-job-label')).toHaveCount(0);
  await expect(rootSummary.getByText('製作方法', { exact: true })).toHaveCount(0);
  await expect(page.locator('.recipe-methods-section')).toHaveCount(0);
  const rootLayout = await rootSummary.evaluate(root => {
    const name = root.querySelector('.list-name').getBoundingClientRect();
    const qty = root.querySelector('.node-qty').getBoundingClientRect();
    const method = root.querySelector(':scope > .recipe-method-control').getBoundingClientRect();
    const box = root.getBoundingClientRect();
    return {
      quantityGap: qty.left - name.right,
      methodInside: method.left >= box.left && method.right <= box.right && method.bottom <= box.bottom
    };
  });
  expect(rootLayout.quantityGap).toBeLessThanOrEqual(12);
  expect(rootLayout.methodInside).toBe(true);
  const selectorIconRatio = await page
    .locator('.result-root-summary .recipe-method-summary .craft-job-label')
    .evaluate(label => label.querySelector('.job-icon').getBoundingClientRect().width / parseFloat(getComputedStyle(label).fontSize));
  expect(Math.abs(searchIconRatio - selectorIconRatio)).toBeLessThan(0.01);
  await page.locator('.result-root-summary .recipe-method-summary').click();
  await expect(page.locator('.result-root-summary .recipe-method-choice')).toHaveCount(7);
  await expect(page.locator('.result-root-summary .recipe-method-choice').first()).toBeVisible();
  const mobileSelectorWidths = await page.locator('.result-root-summary .recipe-method-control').evaluate(control => ({
    control: control.getBoundingClientRect().width,
    choices: control.querySelector('.recipe-method-choices').getBoundingClientRect().width
  }));
  expect(Math.abs(mobileSelectorWidths.control - mobileSelectorWidths.choices)).toBeLessThan(1);
  await page.locator('#mobileBackBtn').click();
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
    './assets/job-icons/carpenter.webp'
  );
  await expect(rows.nth(6).locator('.craft-job-label > .job-icon')).toHaveAttribute(
    'src',
    './assets/job-icons/alchemist.webp'
  );
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
  await expect(intermediate.locator(':scope > .recipe-method-control')).toHaveCount(1);
  const methodSummary = intermediate.locator(':scope > .recipe-method-control .recipe-method-summary');
  await methodSummary.click();
  await expect(methodSummary).toHaveAttribute('aria-expanded', 'true');
  await intermediate
    .locator(':scope > .recipe-method-control .recipe-method-choice')
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
  await expect(materialIntermediate.locator(':scope > .recipe-method-control')).toHaveCount(1);
  await expect(materialIntermediate.locator('.material-primary > .craft-job-label')).toHaveCount(0);
  await expect(materialIntermediate.getByText('製作方法', { exact: true })).toHaveCount(0);
  const materialMethodLayout = await materialIntermediate.evaluate(node => {
    const item = node.querySelector(':scope > .intermediate-tree-row').getBoundingClientRect();
    const method = node.querySelector(':scope > .recipe-method-control').getBoundingClientRect();
    const itemBorder = getComputedStyle(node.querySelector(':scope > .intermediate-tree-row')).borderBottomWidth;
    const nodeBorder = getComputedStyle(node).borderBottomWidth;
    return {
      belowItem: method.top >= item.bottom - 1,
      indented: method.left > item.left,
      itemBorder,
      nodeBorder
    };
  });
  expect(materialMethodLayout).toEqual({
    belowItem: true,
    indented: true,
    itemBorder: '0px',
    nodeBorder: '1px'
  });

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
  const materialMethod = mobileMaterialIntermediate.locator(':scope > .recipe-method-control');
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
