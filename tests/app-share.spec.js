const { expect, test } = require('@playwright/test');
const sharp = require('sharp');
const { chooseCustomOption, dismissInfoDialog, openApp, routeMirageRecipeVariants, searchFor } = require('./helpers/app.js');
const { favoriteList, favoriteStore, seedAppStorage } = require('./helpers/app-storage.js');

test('share button follows panel availability and opens panel selection on desktop', async ({ page }) => {
  await openApp(page, 1000, 760);
  await expect(page.locator('#shareBtn')).toBeDisabled();

  await searchFor(page, 'バスタードソード');
  await expect(page.locator('#shareBtn')).toBeEnabled();
  await page.getByText('バスタードソード', { exact: true }).first().click();
  await page.locator('#shareBtn').click();

  await expect(page.locator('#contentShareOverlay')).toHaveClass(/open/);
  await expect(page.locator('#contentSharePanelChoices button')).toHaveCount(3);
  await expect(page.locator('#contentSharePanelChoices button').nth(1)).toBeDisabled();
  await expect(page.locator('#contentShareTitle')).toHaveText('検索結果');
  await page.locator('#contentSharePanelChoices button').last().click();
  await expect(page.locator('#contentShareTitle')).toContainText('レシピツリー');
});

test('mobile sharing targets only the current panel without showing a selector', async ({ page }) => {
  await openApp(page, 390, 720);
  await searchFor(page, 'バスタードソード');
  await page.locator('#shareBtn').click();
  await expect(page.locator('#contentSharePanelChoices')).toBeEmpty();
  await expect(page.locator('#contentShareTitle')).toHaveText('検索結果');
  await expect(page.locator('.share-panel-highlight-overlay')).toHaveCount(0);
  await expect(page.locator('#contentShareDescription')).toContainText('生成中は画面を閉じたり再読み込みしないでください');
  await expect(page.locator('#contentShareDescription')).not.toContainText('チェック状態は画像に反映されます');
});

test('text sharing copies the complete fallback text with title and footer', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: () => { window.__textShareCalls = (window.__textShareCalls || 0) + 1; return Promise.resolve(); }
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: text => { window.__sharedText = text; return Promise.resolve(); } }
    });
  });
  await openApp(page);
  await searchFor(page, 'バスタードソード');
  await page.locator('#shareBtn').click();
  await page.locator('#contentShareTextBtn').click();
  await expect.poll(() => page.evaluate(() => window.__sharedText || '')).toContain('検索結果');
  await expect.poll(() => page.evaluate(() => window.__sharedText || '')).toContain('検索語句: バスタードソード');
  await expect.poll(() => page.evaluate(() => window.__sharedText || '')).toContain('バスタードソード');
  await expect.poll(() => page.evaluate(() => window.__sharedText || '')).toContain('@ff14_recipe');
  await expect.poll(() => page.evaluate(() => window.__sharedText || '')).not.toContain('共有します');
  await expect.poll(() => page.evaluate(() => (window.__sharedText || '').split('\n').length)).toBeGreaterThan(5);
  await expect.poll(() => page.evaluate(() => Math.max(...(window.__sharedText || '').split('\n').map(line => line.length)))).toBeLessThan(200);
  await expect.poll(() => page.evaluate(() => window.__textShareCalls || 0)).toBe(0);
});

test('search sharing includes only the conditions that produced the displayed results', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: text => { window.__sharedText = text; return Promise.resolve(); } }
    });
  });
  await seedAppStorage(page, {
    favoritesV2: favoriteStore({
      version: 2,
      selectedListId: 'share-favorite',
      lists: [favoriteList({ id: 'share-favorite', name: '装備お気に入り', itemIds: [1602] })]
    })
  });
  await openApp(page);
  await page.locator('#equipmentSearchToggle').click();
  await chooseCustomOption(page, 'equipmentJobSelect', 'ナイト');
  await page.locator('#equipmentLevelInput').fill('100');
  await page.locator('#equipmentLevelInput').dispatchEvent('input');
  await chooseCustomOption(page, 'equipmentItemLevelSelect', '770');
  await page.locator('#equipmentSearchBtn').click();

  await page.locator('#shareBtn').click();
  await page.locator('#contentShareTextBtn').click();
  let text = await page.evaluate(() => window.__sharedText || '');
  expect(text).toContain('ジョブ: ナイト');
  expect(text).toContain('装備レベル: 100');
  expect(text).toContain('アイテムレベル: 770');
  expect(text).toContain('部位: 全部');

  await page.evaluate(() => {
    const original = window.html2canvas;
    window.html2canvas = async (host, options) => {
      window.__equipmentShareDescription ||= host.querySelector('.share-capture-description')?.textContent || '';
      window.__equipmentPanelInShare ||= Boolean(host.querySelector('[data-share-source-id="equipmentSearchPanel"]'));
      return original(host, options);
    };
  });
  await page.locator('#shareBtn').click();
  await page.locator('#contentShareImageBtn').click();
  await expect(page.locator('#shareReadyBtn')).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => window.__equipmentShareDescription)).toBe(
    'ジョブ: ナイト\n装備レベル: 100\nアイテムレベル: 770\n部位: 全部'
  );
  expect(await page.evaluate(() => window.__equipmentPanelInShare)).toBe(false);
  await page.locator('#shareDiscardBtn').click();

  await page.locator('#favBtn').click();
  await page.locator('#favoriteLists').getByText('装備お気に入り', { exact: true }).click();
  await dismissInfoDialog(page);
  await page.locator('#shareBtn').click();
  await page.locator('#contentShareTextBtn').click();
  text = await page.evaluate(() => window.__sharedText || '');
  expect(text).toContain('装備お気に入り');
  expect(text).not.toContain('ジョブ: ナイト');
  expect(text).not.toContain('装備レベル: 100');
  expect(text).not.toContain('検索語句:');
});

test('non-PC text sharing keeps the Web Share path', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      get: () => 'Mozilla/5.0 (Linux; Android 15; Mobile) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36'
    });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: payload => { window.__textSharePayload = payload; return Promise.resolve(); }
    });
  });
  await openApp(page, 390, 720);
  await searchFor(page, 'バスタードソード');
  await page.locator('#shareBtn').click();
  await page.locator('#contentShareTextBtn').click();
  await expect.poll(() => page.evaluate(() => window.__textSharePayload?.text || '')).toContain('バスタードソード');
});

test('favorite, used-in, and material sharing use semantic text blocks and retain material icons', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: text => { window.__sharedText = text; return Promise.resolve(); } }
    });
  });
  await openApp(page);
  const selectSharePanelIfShown = async title => {
    const choice = page.locator('#contentSharePanelChoices button').filter({ hasText: title });
    if (await choice.count()) await choice.click();
  };

  const ringName = 'コートリーラヴァー・キャスターリング';
  await searchFor(page, ringName);
  await page.getByText(ringName, { exact: true }).first().click();
  await page.locator('.result-root-summary .pin-btn').first().click();
  await page.locator('#favoriteTargetCreate').getByText('新規作成').click();
  await page.locator('#textInputField').fill('指輪');
  await page.locator('#textInputOkBtn').click();
  await page.locator('#favBtn').click();
  await page.locator('#favoriteLists').getByText('指輪', { exact: true }).click();

  await page.locator('#shareBtn').click();
  await selectSharePanelIfShown('指輪');
  await page.locator('#contentShareTextBtn').click();
  let text = await page.evaluate(() => window.__sharedText || '');
  expect(text).toContain(`・${ringName}`);
  expect(text).toContain('製作: 彫金師 / 秘伝書 第12巻');
  expect(text).toContain('装備: 黒魔道士');
  expect(text).not.toContain('Lv100/IL770黒');
  expect(text).not.toContain('拡張機能');

  await searchFor(page, 'ティターニアの羽根');
  await page.locator('#recipeList li').filter({ hasText: 'ティターニアの羽根' }).first().locator('.uses-list-btn').click();
  await page.locator('#shareBtn').click();
  await selectSharePanelIfShown('ティターニアの羽根の作成先');
  await page.locator('#contentShareTextBtn').click();
  text = await page.evaluate(() => window.__sharedText || '');
  expect(text).toContain('・フェアリーキングアクス');
  expect(text).toContain('製作: 鍛冶師 / 秘伝書 第7巻');
  expect(text).toContain('装備: 戦士・斧術士 / Lv80 / IL430');
  expect(text).toMatch(/IL430\n\n・フェアリーキングディバイダー/u);
  expect(text).not.toContain('Lv80/IL430戦');

  await page.getByText('フェアリーキングアクス', { exact: true }).first().click();
  await page.locator('#shareBtn').click();
  await selectSharePanelIfShown('フェアリーキングアクスのレシピツリー');
  await page.locator('#contentShareTextBtn').click();
  text = await page.evaluate(() => window.__sharedText || '');
  expect(text).toContain('個数: 1');
  expect(text).not.toContain('個数・セット数');
  expect(text).not.toContain('現在の内容を共有します');
  expect(text).toContain('・フェアリーキングアクス ×1');
  expect(text).toContain('製作: 鍛冶師 / 秘伝書 第7巻');
  expect(text).toContain('  ├─ タングステンスチールインゴット ×3');
  expect(text).toContain('  │  ├─ タングステン鉱 ×12\n  │  │  ⏰');
  expect(text).not.toContain('入手:');
  expect(text).toMatch(/製作回数: 3回\n  │  ├─ タングステン鉱/u);
  expect(text).not.toMatch(/\n\n[ ]*[│├└]/u);
  expect(text).not.toMatch(/^[▼▶⏰]$/mu);

  await searchFor(page, 'ティターニア');
  await expect(page.locator('#recipeList li')).toHaveCount(3);
  await page.locator('#shareBtn').click();
  await selectSharePanelIfShown('検索結果');
  await page.locator('#contentShareTextBtn').click();
  text = await page.evaluate(() => window.__sharedText || '');
  expect(text).toContain('・ティターニア・バード');
  expect(text).toContain('製作: 甲冑師 / 秘伝書 第6巻');
  expect(text).toMatch(/秘伝書 第6巻\n\n・ティターニアの羽根\n\n・ティターニアの壁掛け/u);
  expect(text).not.toContain('第6巻ティターニア');

  await page.getByText('ティターニア・バード', { exact: true }).first().click();
  await page.evaluate(() => {
    const original = window.html2canvas;
    window.html2canvas = async (host, options) => {
      const list = host.querySelector('[data-share-source-id="recipeList"]');
      const selected = list?.querySelector('li.selected');
      const icon = list?.querySelector('li .list-icon, li .checkable-item-icon');
      const label = list?.querySelector('li .item-list-label');
      const iconRect = icon?.getBoundingClientRect();
      const labelRect = label?.getBoundingClientRect();
      window.__searchImageLayout ||= {
        display: list ? getComputedStyle(list.querySelector('li')).display : '',
        labelBesideIcon: Boolean(iconRect && labelRect && labelRect.left >= iconRect.right),
        selectedBackground: selected ? getComputedStyle(selected).backgroundColor : '',
        description: host.querySelector('.share-capture-description')?.textContent || ''
      };
      return original(host, options);
    };
  });
  await page.locator('#shareBtn').click();
  await selectSharePanelIfShown('検索結果');
  await page.locator('#contentShareImageBtn').click();
  await expect(page.locator('#shareReadyBtn')).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => window.__searchImageLayout)).toEqual({
    display: 'flex',
    labelBesideIcon: true,
    selectedBackground: 'rgba(0, 0, 0, 0)',
    description: '検索語句: ティターニア'
  });
  await page.locator('#shareDiscardBtn').click();

  await page.locator('#favBtn').click();
  await page.locator('#favoriteLists').getByText('指輪', { exact: true }).click();
  await page.locator('#recipeList').getByText('素材リストを表示').click();
  await expect(page.locator('.materials-list')).toBeVisible();
  const materialChecks = page.locator('.materials-list .checkable-item-icon');
  await materialChecks.first().click();
  await page.locator('#shareBtn').click();
  await selectSharePanelIfShown('指輪の素材リスト');
  await page.locator('#contentShareTextBtn').click();
  text = await page.evaluate(() => window.__sharedText || '');
  expect(text).toContain('セット数: 1');
  expect(text).not.toContain('個数・セット数');
  expect(text).not.toContain('現在の内容を共有します');
  expect(text).toContain('【製作する中間素材】');
  expect(text).toContain('・スーパージュラルミンインゴット ×1');
  expect(text).toContain('製作回数: 1回');
  expect(text).toContain('【必要素材】');
  expect(text).toContain('☑️');
  expect(text).toContain('⬜');
  expect(text).not.toMatch(/[▼▶]/u);

  await page.locator('#favBtn').click();
  await page.locator('#favoriteLists').getByText('指輪', { exact: true }).click();
  await page.locator('#recipeList .favorite-material-curtain-toggle').click();
  await page.locator('#recipeList').getByText('個数指定').click();
  await page.locator('#recipeList').getByText('素材リストを表示').click();
  await expect(page.locator('.result-header')).toHaveClass(/hide-count-input/);
  await page.locator('#shareBtn').click();
  await selectSharePanelIfShown('指輪の素材リスト');
  await page.locator('#contentShareTextBtn').click();
  text = await page.evaluate(() => window.__sharedText || '');
  expect(text).not.toMatch(/^セット数:/mu);
  expect(text).toContain('計算方法: 合算');

  await page.evaluate(() => {
    const original = window.html2canvas;
    window.html2canvas = async (host, options) => {
      const icons = [...host.querySelectorAll('.materials-list .checkable-item-icon img')];
      const checks = [...host.querySelectorAll('.materials-list .item-image-check')];
      window.__materialIconInspection ||= {
        count: icons.length,
        missing: icons.filter(image => !image.complete || image.naturalWidth < 1).length,
        visibleChecks: checks.filter(mark => getComputedStyle(mark).opacity !== '0').length,
        acquisitionMarkers: [...host.querySelectorAll('.materials-list .gathering-timer-btn, .materials-list .shop-info-btn')]
          .map(marker => marker.textContent).join(''),
        description: host.querySelector('.share-capture-description')?.textContent || ''
      };
      return original(host, options);
    };
  });
  await page.locator('#shareBtn').click();
  await selectSharePanelIfShown('指輪の素材リスト');
  await page.locator('#contentShareImageBtn').click();
  await expect(page.locator('#shareProgressPanel')).toBeVisible();
  await expect(page.locator('#shareProgressMessage')).toContainText('画像生成中');
  await expect(page.locator('#shareProgressRow')).toBeVisible();
  await expect(page.locator('#shareProgressPercent')).toBeHidden();
  await expect(page.locator('#shareReadyBtn')).toBeVisible({ timeout: 30_000 });
  const iconInspection = await page.evaluate(() => window.__materialIconInspection);
  expect(iconInspection.count).toBeGreaterThan(10);
  expect(iconInspection.missing).toBe(0);
  expect(iconInspection.visibleChecks).toBeGreaterThan(0);
  expect(iconInspection.acquisitionMarkers).toMatch(/[⏰🛒]/u);
  expect(iconInspection.description).toBe('計算方法: 合算');
  await page.locator('#shareDiscardBtn').click();
});

test('image sharing creates a PNG and falls back to a direct download', async ({ page }) => {
  await openApp(page);
  const itemName = 'コートリーラヴァー・フィルバートブラシ';
  await searchFor(page, itemName);
  await page.getByText(itemName, { exact: true }).first().click();
  await page.evaluate(() => {
    const original = window.html2canvas;
    window.html2canvas = async (host, options) => {
      const titleStyle = getComputedStyle(host.querySelector('h1'));
      const badge = host.querySelector('.badge:not(.hidden)');
      const badgeStyle = badge ? getComputedStyle(badge) : null;
      window.__shareCaptureInspection ||= {
        background: getComputedStyle(host).backgroundColor,
        badgeBackground: badgeStyle?.backgroundColor || '',
        badgeColor: badgeStyle?.color || '',
        iconCount: host.querySelectorAll('.checkable-item-icon img, img.node-icon, img.list-icon').length,
        jobIconCount: host.querySelectorAll('img.job-icon').length,
        missingJobIconCount: [...host.querySelectorAll('img.job-icon')]
          .filter(image => !image.complete || image.naturalWidth < 1).length,
        titleLineHeight: parseFloat(titleStyle.lineHeight),
        titleHeight: host.querySelector('h1').getBoundingClientRect().height,
        titleWhiteSpace: titleStyle.whiteSpace,
        description: host.querySelector('.share-capture-description')?.textContent || ''
      };
      return original(host, options);
    };
  });
  await page.locator('#shareBtn').click();
  await page.locator('#contentSharePanelChoices button').last().click();
  await page.locator('#contentShareImageBtn').click();
  await expect(page.locator('#shareReadyBtn')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#shareReadyBtn')).toHaveCSS('background-color', 'rgb(200, 168, 75)');
  await expect(page.locator('#shareReadyBtn')).toHaveCSS('color', 'rgb(26, 26, 26)');
  await expect(page.locator('#shareDiscardBtn')).toHaveCSS('background-color', 'rgb(200, 168, 75)');
  await expect(page.locator('#shareDiscardBtn')).toHaveCSS('color', 'rgb(26, 26, 26)');
  await expect(page.locator('#shareReadyActions')).toHaveCSS('animation-name', 'share-ready-flash');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#shareReadyBtn').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^コートリーラヴァー・フィルバートブラシのレシピツリー_\d{8}_\d{6}\.png$/);
  const metadata = await sharp(await download.path()).metadata();
  expect(metadata.format).toBe('png');
  expect(metadata.width).toBeLessThanOrEqual(1080);
  expect(metadata.height).toBeLessThanOrEqual(4630);
  const inspection = await page.evaluate(() => window.__shareCaptureInspection);
  expect(inspection.background).toBe('rgb(26, 26, 26)');
  expect(inspection.badgeBackground).not.toBe(inspection.badgeColor);
  expect(inspection.iconCount).toBeGreaterThan(0);
  expect(inspection.jobIconCount).toBeGreaterThan(0);
  expect(inspection.missingJobIconCount).toBe(0);
  expect(inspection.titleWhiteSpace).toBe('nowrap');
  expect(inspection.description).toBe('個数: 1');
  expect(inspection.titleHeight).toBeLessThanOrEqual(inspection.titleLineHeight * 1.1);
  const backgroundPixel = await sharp(await download.path()).extract({ left: 0, top: 0, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  expect([...backgroundPixel]).toEqual([26, 26, 26]);
  await expect(page.locator('#shareProgressPanel')).toBeHidden();
  await expect(page.locator('#shareBtn')).toBeEnabled();
});

test('image and text sharing preserve purchased and prepared intermediate markers', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: text => { window.__sharedText = text; return Promise.resolve(); } }
    });
  });
  await openApp(page);
  await searchFor(page, 'ブラスバスタードソード');
  await page.getByText('ブラスバスタードソード', { exact: true }).first().click();
  await page.locator('#materialsViewBtn').click();
  const purchasedNode = page
    .locator('.intermediate-tree-row .material-name')
    .filter({ hasText: /^バスタードソード$/ })
    .locator('xpath=ancestor::li[contains(@class,"intermediate-tree-node")]');
  await purchasedNode.locator('.shop-info-btn').click();
  await page.getByLabel('この中間素材は購入💰して用意する').check();
  await page.locator('#shopCloseBtn').click();
  await expect(purchasedNode.locator('.shop-info-btn')).toHaveText('💰🛒');
  await page.locator('#shareBtn').click();
  const materialChoice = page.locator('#contentSharePanelChoices button').filter({ hasText: '素材リスト' });
  if (await materialChoice.count()) await materialChoice.click();
  await page.locator('#contentShareTextBtn').click();
  expect(await page.evaluate(() => window.__sharedText || '')).toContain('中間素材購入💰の為不要');
  await page.evaluate(() => {
    const original = window.html2canvas;
    window.html2canvas = async (host, options) => {
      window.__purchasedShareMarkers = [...host.querySelectorAll('.shop-info-btn')]
        .map(marker => marker.textContent).join('');
      window.__purchasedShareReasons = [...host.querySelectorAll('[data-share-exclusion-status="true"]')]
        .map(status => status.textContent).join('\n');
      return original(host, options);
    };
  });
  await page.locator('#shareBtn').click();
  if (await materialChoice.count()) await materialChoice.click();
  await page.locator('#contentShareImageBtn').click();
  await expect(page.locator('#shareReadyBtn')).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => window.__purchasedShareMarkers)).toContain('💰🛒');
  expect(await page.evaluate(() => window.__purchasedShareReasons)).toContain('中間素材購入💰の為不要');
  await page.locator('#shareDiscardBtn').click();

  await purchasedNode.locator('.intermediate-prepared-btn').click();
  await expect(purchasedNode).toHaveClass(/prepared-selected/);
  await page.locator('#shareBtn').click();
  if (await materialChoice.count()) await materialChoice.click();
  await page.locator('#contentShareTextBtn').click();
  expect(await page.evaluate(() => window.__sharedText || '')).toContain('中間素材準備済📦の為不要');
  await page.evaluate(() => {
    const original = window.html2canvas;
    window.html2canvas = async (host, options) => {
      window.__preparedShareMarkers = [...host.querySelectorAll('.intermediate-prepared-btn')]
        .map(marker => marker.textContent).join('');
      window.__preparedShareReasons = [...host.querySelectorAll('[data-share-exclusion-status="true"]')]
        .map(status => status.textContent).join('\n');
      return original(host, options);
    };
  });
  await page.locator('#shareBtn').click();
  if (await materialChoice.count()) await materialChoice.click();
  await page.locator('#contentShareImageBtn').click();
  await expect(page.locator('#shareReadyBtn')).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => window.__preparedShareMarkers)).toContain('📦');
  expect(await page.evaluate(() => window.__preparedShareReasons)).toContain('中間素材準備済📦の為不要');
  await page.locator('#shareDiscardBtn').click();
});

test('image sharing keeps the selected recipe method and its job icon', async ({ page }) => {
  await routeMirageRecipeVariants(page);
  await openApp(page);
  await searchFor(page, 'ミラージュプリズム');
  await page.getByText('ミラージュプリズム', { exact: true }).first().click();
  await page.evaluate(() => {
    const original = window.html2canvas;
    window.html2canvas = async (host, options) => {
      const selection = host.querySelector('.recipe-method-share-selection');
      const icons = [...(selection?.querySelectorAll('img.job-icon') || [])];
      window.__recipeMethodShareInspection ||= {
        text: selection?.textContent?.trim() || '',
        iconCount: icons.length,
        missing: icons.filter(image => !image.complete || image.naturalWidth < 1).length,
        interactiveControlCount: host.querySelectorAll('.recipe-method-control, .recipe-method-summary').length
      };
      return original(host, options);
    };
  });
  await page.locator('#shareBtn').click();
  await page.locator('#contentSharePanelChoices button').last().click();
  await page.locator('#contentShareImageBtn').click();
  await expect(page.locator('#shareReadyBtn')).toBeVisible({ timeout: 30_000 });
  const inspection = await page.evaluate(() => window.__recipeMethodShareInspection);
  expect(inspection.text.length).toBeGreaterThan(0);
  expect(inspection.iconCount).toBeGreaterThan(0);
  expect(inspection.missing).toBe(0);
  expect(inspection.interactiveControlCount).toBe(0);
  await page.locator('#shareDiscardBtn').click();
});

test('panel selection highlights the full left and middle panels above the modal backdrop', async ({ page }) => {
  await openApp(page);
  await searchFor(page, 'ティターニアの羽根');
  await page.locator('#recipeList li').filter({ hasText: 'ティターニアの羽根' }).first().locator('.uses-list-btn').click();
  await page.locator('#shareBtn').click();

  for (const [title, panel, panelId] of [
    ['検索結果', 'left', 'panelLeft'],
    ['ティターニアの羽根の作成先', 'middle', 'panelMiddle']
  ]) {
    await page.locator('#contentSharePanelChoices button').filter({ hasText: title }).click();
    const highlight = page.locator(`.share-panel-highlight-overlay[data-panel="${panel}"]`);
    await expect(highlight).toBeVisible();
    await expect(highlight).toHaveCSS('border-top-width', '3px');
    const geometry = await page.evaluate(({ panelId, panel }) => {
      const target = document.getElementById(panelId).getBoundingClientRect();
      const overlay = document.querySelector(`.share-panel-highlight-overlay[data-panel="${panel}"]`).getBoundingClientRect();
      return {
        delta: Math.max(
          Math.abs(target.left - overlay.left),
          Math.abs(target.top - overlay.top),
          Math.abs(target.width - overlay.width),
          Math.abs(target.height - overlay.height)
        ),
        dialogZ: Number(getComputedStyle(document.getElementById('contentShareDialog')).zIndex),
        overlayZ: Number(getComputedStyle(document.querySelector('.share-panel-highlight-overlay')).zIndex)
      };
    }, { panelId, panel });
    expect(geometry.delta).toBeLessThan(1);
    expect(geometry.dialogZ).toBeGreaterThan(geometry.overlayZ);
  }
});

test('image generation is exclusive across tabs and releases after discard', async ({ context }) => {
  const first = await context.newPage();
  const second = await context.newPage();
  await openApp(first);
  await openApp(second);
  await searchFor(first, 'バスタードソード');
  await searchFor(second, 'バスタードソード');

  await first.locator('#shareBtn').click();
  await first.locator('#contentShareImageBtn').click();
  await expect(first.locator('#shareReadyBtn')).toBeVisible({ timeout: 30_000 });
  await expect(second.locator('#shareProgressMessage')).toHaveText('別の画面で画像の共有を待っています');
  await expect(second.locator('#shareBtn')).toBeDisabled();

  await first.locator('#shareDiscardBtn').click();
  await expect(second.locator('#shareProgressPanel')).toBeHidden();
  await expect(second.locator('#shareBtn')).toBeEnabled();
});

test('retained PNG survives an additional tab but is purged on the next cold start', async ({ context }) => {
  const recordCount = page => page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('xivca-share-png-v1', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const count = db.transaction('pngs', 'readonly').objectStore('pngs').count();
      count.onerror = () => reject(count.error);
      count.onsuccess = () => { db.close(); resolve(count.result); };
    };
  }));
  const first = await context.newPage();
  await openApp(first);
  await searchFor(first, 'バスタードソード');
  await first.evaluate(() => {
    window.html2canvas = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 2;
      return canvas;
    };
  });
  await first.locator('#shareBtn').click();
  await first.locator('#contentShareImageBtn').click();
  await expect(first.locator('#shareReadyBtn')).toBeVisible();
  const download = first.waitForEvent('download');
  await first.locator('#shareReadyBtn').click();
  await download;
  await expect.poll(() => recordCount(first)).toBe(1);

  const second = await context.newPage();
  await openApp(second);
  await expect.poll(() => recordCount(second)).toBe(1);
  await first.close();
  await second.close();

  const cold = await context.newPage();
  await openApp(cold);
  await expect.poll(() => recordCount(cold)).toBe(0);
});

test('five retained downloads disable only new image creation until expiry', async ({ page }) => {
  await openApp(page);
  await searchFor(page, 'バスタードソード');
  await page.evaluate(() => {
    window.html2canvas = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 2;
      return canvas;
    };
  });

  for (let index = 0; index < 5; index += 1) {
    await page.locator('#shareBtn').click();
    await page.locator('#contentShareImageBtn').click();
    await expect(page.locator('#shareReadyBtn')).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#shareReadyBtn').click();
    await downloadPromise;
  }

  await expect(page.locator('#shareBtn')).toBeEnabled();
  await page.locator('#shareBtn').click();
  await expect(page.locator('#contentShareTextBtn')).toBeEnabled();
  await expect(page.locator('#contentShareImageBtn')).toBeDisabled();
  await expect(page.locator('#contentShareDescription')).toContainText(/画像共有は\d+分\d+秒後に再利用できます/);
});

test('file share failure regenerates at a smaller scale before the next user action', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      get: () => 'Mozilla/5.0 (Linux; Android 15; Mobile) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36'
    });
    window.__imageShareCalls = 0;
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: () => {
        window.__imageShareCalls += 1;
        return window.__imageShareCalls === 1
          ? Promise.reject(new Error('file too large'))
          : Promise.resolve();
      }
    });
  });
  await openApp(page);
  await searchFor(page, 'バスタードソード');
  await page.locator('#shareBtn').click();
  await page.locator('#contentShareImageBtn').click();
  await expect(page.locator('#shareReadyBtn')).toBeVisible();
  await page.locator('#shareReadyBtn').click();
  await expect.poll(() => page.evaluate(() => window.__imageShareCalls)).toBe(1);
  await expect(page.locator('#shareReadyBtn')).toBeVisible({ timeout: 30_000 });
  await page.locator('#shareReadyBtn').click();
  await expect.poll(() => page.evaluate(() => window.__imageShareCalls)).toBe(2);
  await expect(page.locator('#shareProgressPanel')).toBeHidden();
});
