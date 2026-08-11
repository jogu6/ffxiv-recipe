const { expect, test } = require('@playwright/test');
const sharp = require('sharp');
const { openApp, routeMirageRecipeVariants, searchFor } = require('./helpers/app.js');

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
  await expect.poll(() => page.evaluate(() => window.__sharedText || '')).toContain('バスタードソード');
  await expect.poll(() => page.evaluate(() => window.__sharedText || '')).toContain('@ff14_recipe');
  await expect.poll(() => page.evaluate(() => (window.__sharedText || '').split('\n').length)).toBeGreaterThan(5);
  await expect.poll(() => page.evaluate(() => Math.max(...(window.__sharedText || '').split('\n').map(line => line.length)))).toBeLessThan(200);
  await expect.poll(() => page.evaluate(() => window.__textShareCalls || 0)).toBe(0);
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
  expect(text).toContain('・フェアリーキングアクス ×1');
  expect(text).toContain('製作: 鍛冶師 / 秘伝書 第7巻');
  expect(text).toContain('  ├─ タングステンスチールインゴット ×3');
  expect(text).toContain('  │  ├─ タングステン鉱 ×12\n  │  │  入手: 時間指定採集');
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
        selectedBackground: selected ? getComputedStyle(selected).backgroundColor : ''
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
    selectedBackground: 'rgba(0, 0, 0, 0)'
  });
  await page.locator('#shareDiscardBtn').click();

  await page.locator('#favBtn').click();
  await page.locator('#favoriteLists').getByText('指輪', { exact: true }).click();
  await page.locator('#recipeList').getByText('素材リストを表示').click();
  await expect(page.locator('.materials-list')).toBeVisible();
  await page.locator('#shareBtn').click();
  await selectSharePanelIfShown('指輪の素材リスト');
  await page.locator('#contentShareTextBtn').click();
  text = await page.evaluate(() => window.__sharedText || '');
  expect(text).toContain('【製作する中間素材】');
  expect(text).toContain('・スーパージュラルミンインゴット ×1');
  expect(text).toContain('製作回数: 1回');
  expect(text).toContain('【必要素材】');
  expect(text).not.toMatch(/[▼▶]/u);

  await page.evaluate(() => {
    const original = window.html2canvas;
    window.html2canvas = async (host, options) => {
      const icons = [...host.querySelectorAll('.materials-list .checkable-item-icon img')];
      window.__materialIconInspection ||= {
        count: icons.length,
        missing: icons.filter(image => !image.complete || image.naturalWidth < 1).length
      };
      return original(host, options);
    };
  });
  await page.locator('#shareBtn').click();
  await selectSharePanelIfShown('指輪の素材リスト');
  await page.locator('#contentShareImageBtn').click();
  await expect(page.locator('#shareReadyBtn')).toBeVisible({ timeout: 30_000 });
  const iconInspection = await page.evaluate(() => window.__materialIconInspection);
  expect(iconInspection.count).toBeGreaterThan(10);
  expect(iconInspection.missing).toBe(0);
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
        titleWhiteSpace: titleStyle.whiteSpace
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
  expect(inspection.titleHeight).toBeLessThanOrEqual(inspection.titleLineHeight * 1.1);
  const backgroundPixel = await sharp(await download.path()).extract({ left: 0, top: 0, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  expect([...backgroundPixel]).toEqual([26, 26, 26]);
  await expect(page.locator('#shareProgressPanel')).toBeHidden();
  await expect(page.locator('#shareBtn')).toBeEnabled();
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
