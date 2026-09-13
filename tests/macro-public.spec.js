const { expect, test } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { openApp, searchFor, swipe } = require('./helpers/app.js');

const itemDocument = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'site', 'data', 'Item.json'),
  'utf8'
));
const recipeItem = itemDocument.Items.find(item => item.Recipe?.CraftingData);
const maximumCrafterLevel = Math.max(
  ...itemDocument.Items.flatMap(item => [item.Recipe, ...(item.Recipes || [])])
    .map(recipe => Number(recipe?.CraftInfo?.level) || 0)
);

test('開いたマクロは設定倍率に即時追従し入力と画面を保持する', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ff14_font_size_level_v2', '1'));
  await openApp(page, 1200, 900);
  await searchFor(page, recipeItem.Name);
  await page.locator('#recipeList').getByText(recipeItem.Name, { exact: true }).first().click();
  const launch = page.locator('.result-root-summary .macro-launch-btn');
  await expect(launch).toBeEnabled({ timeout: 30_000 });
  await launch.click();
  const macro = page.frameLocator('#macroFrame');
  await expect(macro.locator('#recipeInfo')).toContainText(recipeItem.Name, { timeout: 30_000 });
  await macro.locator('#cp').fill('649');
  await macro.locator('body').evaluate(() => { window.__scaleTestIdentity = 'retained'; });
  const frameUrl = await page.locator('#macroFrame').getAttribute('src');
  for (const level of ['10', '1']) {
    await page.locator('#settingsBtn').click();
    await page.locator('#settingsDisplayTab').click();
    await page.locator('#fontSizeLevelInput').fill(level);
    await page.locator('#fontSizeApplyBtn').click();
    await expect(macro.locator('html')).toHaveAttribute('data-font-size-level', level);
    await expect(macro.locator('body')).toHaveCSS('font-size',
      await page.locator('body').evaluate(element => getComputedStyle(element).fontSize));
    await expect(macro.locator('#cp')).toHaveValue('649');
    await expect(page.locator('#macroFrame')).toHaveAttribute('src', frameUrl);
    expect(await macro.locator('body').evaluate(() => window.__scaleTestIdentity)).toBe('retained');
  }
});

test('Webアプリ起動後のマクロ用データ準備中だけ全📜を無効化する', async ({ page }) => {
  let releasePreparation;
  const preparationGate = new Promise(resolve => { releasePreparation = resolve; });
  await page.route('**/macro-app/web/data-loader.js', async route => {
    await preparationGate;
    await route.continue();
  });

  await openApp(page, 900, 800);
  await searchFor(page, recipeItem.Name);
  await page.locator('#recipeList').getByText(recipeItem.Name, { exact: true }).first().click();
  const buttons = page.locator('.macro-launch-btn');
  await expect(buttons.first()).toBeVisible();
  expect(await buttons.count()).toBeGreaterThan(1);
  expect(await buttons.evaluateAll(values => values.every(button => button.disabled))).toBe(true);

  releasePreparation();
  await expect.poll(() => buttons.evaluateAll(values => values.every(button => !button.disabled)), {
    timeout: 30_000
  }).toBe(true);

  await page.reload();
  await expect(page.locator('#loadingOverlay')).not.toHaveClass(/open/);
  await expect.poll(() => page.evaluate(() =>
    performance.getEntriesByName('macro-consumable-cache-hit').length
  ), { timeout: 30_000 }).toBe(1);
});

test('右パネルから公開マクロ画面を開き必須入力と製作情報を表示できる', async ({ page, context }) => {
  expect(recipeItem?.Recipe?.RecipeKey).toBeTruthy();
  const itemPackRequests = [];
  page.on('request', request => {
    if (request.url().includes('/data/item-icons.pack.gz')) itemPackRequests.push(request.url());
  });
  const job = recipeItem.Recipe.CraftInfo.job;
  await page.addInitScript(({ jobName }) => {
    localStorage.setItem('ff14_font_size_level_v2', '10');
    localStorage.setItem('xivca.macro.crafter-status.v1', JSON.stringify({
      [jobName]: {
        level: 999,
        craftsmanship: 5635,
        control: 5379,
        cp: 649,
        manipulation: true,
        heartAndSoul: false,
        quickInnovation: false
      }
    }));
  }, { jobName: job });

  await openApp(page, 900, 800);
  await searchFor(page, recipeItem.Name);
  await page.locator('#recipeList').getByText(recipeItem.Name, { exact: true }).first().click();
  const rootMacroButton = page.locator('.result-root-summary .macro-launch-btn');
  await expect(rootMacroButton).toBeEnabled({ timeout: 30_000 });
  await rootMacroButton.click();
  await expect(page.locator('#panelMacro')).toBeVisible();

  const macro = page.frameLocator('#macroFrame');
  await expect(macro.locator('#recipeInfo')).toContainText(recipeItem.Name, { timeout: 30_000 });
  await expect.poll(() => macro.locator('#recipeInfo .item-icon').evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
  expect(itemPackRequests.length).toBeLessThanOrEqual(1);
  await expect(macro.locator('#foodList .consumable-choice')).not.toHaveCount(0);
  await expect(macro.locator('#medicineList .consumable-choice')).not.toHaveCount(0);
  await expect(macro.getByRole('button', { name: '食事リスト' })).toHaveAttribute('aria-expanded', 'false');
  await expect(macro.getByRole('button', { name: '薬品リスト' })).toHaveAttribute('aria-expanded', 'false');
  await expect(macro.locator('#foodCurrent')).toHaveText('使用しない');
  await expect(macro.locator('#medicineCurrent')).toHaveText('使用しない');
  await expect(macro.locator('#foodList .consumable-choice').first()).toContainText('製作Lv.');
  await expect(macro.locator('#medicineList .consumable-choice').first()).toContainText('製作Lv.');
  await expect(macro.locator('#foodList')).not.toContainText('NQ');
  await expect(macro.locator('#medicineList')).not.toContainText('NQ');
  await expect(page.locator('#macroPanelCloseButton')).toBeVisible();
  await page.locator('#macroPanelCloseButton').click();
  await expect(page.locator('#panelMacro')).toBeHidden();
  await expect(page.locator('#macroFrame')).toHaveAttribute('src', 'about:blank');
  await rootMacroButton.click();
  await expect(macro.locator('#recipeInfo')).toContainText(recipeItem.Name, { timeout: 30_000 });
  await page.evaluate(() => {
    const frame = document.querySelector('#macroFrame');
    window.dispatchEvent(new MessageEvent('message', {
      origin: location.origin,
      source: frame.contentWindow,
      data: { source: 'xivca-macro', type: 'busy' }
    }));
    window.dispatchEvent(new MessageEvent('message', {
      origin: location.origin,
      source: frame.contentWindow,
      data: { source: 'xivca-macro', type: 'progress', percent: 42 }
    }));
  });
  await expect(page.locator('#macroProgressOverlay')).toBeVisible();
  await expect(page.locator('#macroProgressOverlay h2')).toHaveText('マクロ生成中');
  await expect(page.locator('.macro-generation-note')).toContainText('ページが保持されていれば復帰後に計算を続行します');
  await expect(page.locator('#macroProgressPercent')).toBeHidden();
  await expect(page.locator('#macroProgress')).not.toHaveAttribute('value');
  await expect(page.locator('#macroElapsedTime')).toHaveText(/^\d{2}:\d{2}$/);
  await expect(page.locator('.main')).toHaveAttribute('inert', '');
  await page.evaluate(() => {
    const frame = document.querySelector('#macroFrame');
    window.dispatchEvent(new MessageEvent('message', {
      origin: location.origin,
      source: frame.contentWindow,
      data: { source: 'xivca-macro', type: 'idle' }
    }));
  });
  await expect(page.locator('#macroProgressOverlay')).not.toBeVisible();
  await expect(macro.locator('#statusDialog')).toHaveCount(0);
  await expect(macro.locator('#generateButton')).toBeEnabled();
  await expect(macro.locator('#crafterStatusSection .accordion-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(macro.locator('#jobToggle .job-icon')).toBeVisible();
  await macro.locator('#jobToggle').click();
  await expect(macro.locator('#jobChoices [role="option"] .job-icon')).toHaveCount(8);
  await macro.locator(`#jobChoices [data-job="${job}"]`).click();
  await expect(macro.locator('#level')).toBeEditable();
  await expect(macro.locator('#level')).toHaveAttribute('max', String(maximumCrafterLevel));
  await expect(macro.locator('#level')).toHaveValue('');
  await macro.locator('#level').fill(String(maximumCrafterLevel + 1));
  await expect(macro.locator('#level')).toHaveValue(String(maximumCrafterLevel));

  await macro.locator('#craftsmanship').fill('5635');
  await macro.locator('#control').fill('5379');
  await macro.locator('#cp').fill('649');
  await expect(macro.locator('#level')).toHaveCSS('text-align', 'center');
  await macro.locator('#crafterStatusSection .accordion-toggle').click();
  await expect(macro.locator('#crafterStatusSection .accordion-toggle')).toHaveAttribute('aria-expanded', 'false');

  await page.locator('#materialsViewBtn').click();
  const materialRow = page.locator('.intermediate-tree-row').filter({
    has: page.locator('.macro-launch-btn')
  }).first();
  const materialName = await materialRow.locator('.material-name').first().textContent();
  await materialRow.locator('.macro-launch-btn').click();
  await expect(macro.locator('#recipeInfo')).toContainText(materialName, { timeout: 30_000 });

  await page.locator('#treeViewBtn').click();
  const treeMacroButton = page.locator('.tree-node .macro-launch-btn').first();
  const treeItemName = (await treeMacroButton.getAttribute('title')).replace(/のマクロを生成$/u, '');
  await treeMacroButton.click();
  await expect(macro.locator('#recipeInfo')).toContainText(treeItemName, { timeout: 30_000 });

  await page.setViewportSize({ width: 601, height: 800 });
  const parentFontSize = await page.locator('body').evaluate(element => getComputedStyle(element).fontSize);
  const macroFontSize = await macro.locator('body').evaluate(element => getComputedStyle(element).fontSize);
  expect(macroFontSize).toBe(parentFontSize);
  await expect(macro.locator('html')).toHaveAttribute('data-font-size-level', '10');
  expect(await macro.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);

  await page.setViewportSize({ width: 600, height: 800 });
  await expect(page.locator('#macroPanelCloseButton')).toBeHidden();
  await searchFor(page, recipeItem.Name);
  await page.locator('#recipeList').getByText(recipeItem.Name, { exact: true }).first().click();
  await expect(page.locator('#panelRight')).toHaveClass(/mobile-visible/);
  await page.waitForFunction(() => !document.querySelector('.main')?.swiper?.animating);
  await page.evaluate(() => {
    window.__macroPanelTransitionSpeed = null;
    document.querySelector('.main').swiper.on('beforeTransitionStart', (_swiper, speed) => {
      window.__macroPanelTransitionSpeed = speed;
    });
  });
  await page.locator('.result-root-summary .macro-launch-btn').click();
  await expect(page.locator('#panelMacro')).toHaveClass(/mobile-visible/);
  await expect.poll(() => page.evaluate(() => window.__macroPanelTransitionSpeed)).toBe(360);
  await expect(macro.locator('#recipeInfo')).toContainText(recipeItem.Name);
  expect(await macro.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);

  await swipe(page, page.locator('#macroFrame'), 0.2, 0.8);
  await expect(page.locator('#panelRight')).toHaveClass(/mobile-visible/);
  await page.waitForFunction(() => !document.querySelector('.main')?.swiper?.animating);

  await swipe(page, page.locator('#panelRight'), 0.8, 0.2);
  await expect(page.locator('#panelMacro')).toHaveClass(/mobile-visible/);

  await page.evaluate(() => {
    const frame = document.querySelector('#macroFrame');
    window.dispatchEvent(new MessageEvent('message', {
      origin: location.origin,
      source: frame.contentWindow,
      data: {
        source: 'xivca-macro', type: 'scroll',
        scrollTop: 200, scrollHeight: 1800, clientHeight: 600
      }
    }));
  });
  await expect(page.locator('header')).toHaveClass(/mobile-title-hidden/);
  await page.evaluate(() => {
    const frame = document.querySelector('#macroFrame');
    window.dispatchEvent(new MessageEvent('message', {
      origin: location.origin,
      source: frame.contentWindow,
      data: {
        source: 'xivca-macro', type: 'scroll',
        scrollTop: 0, scrollHeight: 1800, clientHeight: 600
      }
    }));
  });
  await expect(page.locator('header')).not.toHaveClass(/mobile-title-hidden/);

  await expect.poll(() => page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('ff14_view_state_v1'));
    return {
      open: stored.macro?.open,
      recipeId: stored.macro?.recipeId,
      mobilePanel: stored.view?.mobilePanel
    };
  })).toEqual({
    open: true,
    recipeId: recipeItem.Recipe.RecipeKey,
    mobilePanel: 'macro'
  });

  await page.close();
  const reopenedPage = await context.newPage();
  await openApp(reopenedPage, 600, 800);
  await expect(reopenedPage.locator('#panelMacro')).toHaveClass(/mobile-visible/);
  await expect(reopenedPage.frameLocator('#macroFrame').locator('#recipeInfo'))
    .toContainText(recipeItem.Name, { timeout: 30_000 });
});


test('マクロの失敗通知をXIVca共通のスタイルと画面全体の中央に表示する', async ({ page }, testInfo) => {
  await page.route('**/macro-app/web/app.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text()
      + '\nglobalThis.__showTestGenerationMessage = showGenerationMessage;' });
  });
  await openApp(page, 1200, 900);
  await searchFor(page, recipeItem.Name);
  await page.locator('#recipeList').getByText(recipeItem.Name, { exact: true }).first().click();
  const launch = page.locator('.result-root-summary .macro-launch-btn');
  await expect(launch).toBeEnabled({ timeout: 30000 });
  await launch.click();
  const macro = page.frameLocator('#macroFrame');
  await expect(macro.locator('#recipeInfo')).toContainText(recipeItem.Name, { timeout: 30000 });
  const message = '現在の製作ステータスと設定では、完成に必要な工数・品質を満たす手順が見つかりませんでした。\n食事・薬品の使用や、製作ステータス・HQ素材の設定を見直してください。';
  const geometry = () => page.locator('#confirmDialog').evaluate(element => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      background: style.backgroundColor, border: style.border, padding: style.padding,
      text: getComputedStyle(document.querySelector('#confirmMsg')).fontSize };
  });
  for (const width of [390, 1200]) {
    await page.setViewportSize({ width, height: 900 });
    for (const level of ['1', '10']) {
      await page.evaluate(({ level, message }) => {
        document.documentElement.setAttribute('data-font-size-level', level);
        showMacroGenerationNotice(message);
      }, { level, message });
      const expected = await geometry();
      await page.locator('#confirmNo').click();
      await macro.locator('body').evaluate(() => __showTestGenerationMessage('マクロを生成できません: NoSolution'));
      await expect(page.locator('#confirmOverlay')).toHaveClass(/open/);
      await expect(page.locator('#confirmMsg')).toHaveText(message);
      await expect(page.locator('#confirmMsg')).toHaveCSS('text-align', 'left');
      await expect(page.locator('#confirmTitle')).toHaveText('マクロを生成できませんでした');
      await expect(page.locator('#confirmTitle')).toBeVisible();
      await expect(page.locator('#confirmDialog')).toHaveCSS('border-top-color',
        await page.locator('#confirmTitle').evaluate(element => getComputedStyle(element).color));
      await expect(macro.locator('#confirmOverlay')).toBeHidden();
      expect(await geometry()).toEqual(expected);
      expect(Math.abs(expected.x + expected.width / 2 - width / 2)).toBeLessThan(1);
      expect(Math.abs(expected.y + expected.height / 2 - 450)).toBeLessThan(1);
      if (level === '10') await page.screenshot({ path: testInfo.outputPath(`macro-failure-${width}.png`) });
      await page.locator('#confirmMsg').click();
      await expect(page.locator('#confirmOverlay')).toHaveClass(/open/);
      await page.locator('#confirmOverlay').click({ position: { x: 2, y: 2 } });
      await expect(page.locator('#confirmOverlay')).not.toHaveClass(/open/);
      await expect.poll(() => macro.locator('body').evaluate(() => captureInquiryDiagnostics()['通知の詳細']['表示中'])).toBe(false);
      await page.evaluate(() => showInfo('通常の通知'));
      await expect(page.locator('#confirmTitle')).toBeHidden();
      await expect(page.locator('#confirmOverlay')).not.toHaveClass(/macro-generation-notice/);
      await page.locator('#confirmOverlay').click({ position: { x: 2, y: 2 } });
      await expect(page.locator('#confirmOverlay')).not.toHaveClass(/open/);
    }
  }
  await page.evaluate(() => {
    window.__confirmedByTest = false;
    showConfirm('はい・いいえを選ぶ確認', () => { window.__confirmedByTest = true; });
  });
  await page.locator('#confirmOverlay').click({ position: { x: 2, y: 2 } });
  await expect(page.locator('#confirmOverlay')).toHaveClass(/open/);
  expect(await page.evaluate(() => window.__confirmedByTest)).toBe(false);
  await page.locator('#confirmNo').click();
});


for (const width of [1200, 390]) test(`右パネルのマクロ起動は同じ製作アイテムの位置を保ち、新規と別アイテムは先頭にする（幅${width}）`, async ({ page }) => {
  await openApp(page, width, 700);
  const clickRightButton = async button => {
    if (width === 390 && await page.locator('#panelMacro').getAttribute('aria-hidden') === 'false') {
      await swipe(page, page.locator('#macroFrame'), 0.2, 0.8);
    }
    await button.click();
  };
  await searchFor(page, 'アリペブレ');
  await page.locator('#recipeList').getByText('アリペブレ', { exact: true }).first().click();
  const rootButton = page.locator('.result-root-summary .macro-launch-btn');
  await expect(rootButton).toBeEnabled({ timeout: 30000 });
  await clickRightButton(rootButton);
  const macro = page.frameLocator('#macroFrame');
  const content = macro.locator('#macroContent');
  await expect(macro.locator('#recipeInfo')).toContainText('アリペブレ');
  await expect.poll(() => content.evaluate(element => element.scrollTop)).toBe(0);
  await macro.getByRole('button', { name: '食事リスト' }).click();
  await expect.poll(() => content.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(150);
  await content.evaluate(element => { element.scrollTop = 150; window.__scrollIdentity = 'same-recipe'; });
  await expect.poll(() => content.evaluate(element => element.scrollTop)).toBe(150);
  const sameUrl = await page.locator('#macroFrame').getAttribute('src');
  await clickRightButton(rootButton);
  await expect(page.locator('#macroFrame')).toHaveAttribute('src', sameUrl);
  expect(await content.evaluate(() => window.__scrollIdentity)).toBe('same-recipe');
  await expect.poll(() => content.evaluate(element => element.scrollTop)).toBe(150);

  const otherButton = page.locator('#panelRight .macro-launch-btn:not([title="アリペブレのマクロを生成"])').first();
  await expect(otherButton).toBeEnabled();
  const otherName = (await otherButton.getAttribute('title')).replace(/のマクロを生成$/, '');
  await clickRightButton(otherButton);
  await expect(macro.locator('#recipeInfo')).toContainText(otherName);
  await expect.poll(() => content.evaluate(element => element.scrollTop)).toBe(0);
  expect(await content.evaluate(() => window.__scrollIdentity)).toBeUndefined();
  await clickRightButton(rootButton);
  await expect(macro.locator('#recipeInfo')).toContainText('アリペブレ');
  await expect.poll(() => content.evaluate(element => element.scrollTop)).toBe(0);

  if (width === 1200) {
    await macro.getByRole('button', { name: '食事リスト' }).click();
    await expect.poll(() => content.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(150);
    await content.evaluate(element => { element.scrollTop = 150; });
    await page.locator('#macroPanelCloseButton').click();
    await expect(page.locator('#macroFrame')).toHaveAttribute('src', 'about:blank');
    await clickRightButton(rootButton);
    await expect(macro.locator('#recipeInfo')).toContainText('アリペブレ');
    await expect.poll(() => content.evaluate(element => element.scrollTop)).toBe(0);
  }
});
