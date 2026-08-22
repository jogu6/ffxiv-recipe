const { expect, test } = require('@playwright/test');
const { loverWeapons } = require('./fixtures/favorite-share-codes.js');
const {
  beginSwipe,
  chooseCustomOption,
  closeSharePlaza,
  dismissInfoDialog,
  dragHandleAfter,
  endSwipe,
  importFavoriteFromPlaza,
  openApp,
  publishedAppVersion,
  publishedPatchStatus,
  routeMirageRecipeVariants,
  searchFor,
  swipe
} = require('./helpers/app.js');

test('current display keeps level 3 while using the enlarged baseline', async ({ page }) => {
  await openApp(page);

  await expect(page.locator('html')).toHaveAttribute('data-font-size-level', '3');
  await expect(page.locator('body')).toHaveCSS('font-size', '15.4px');
  await expect
    .poll(() =>
      page
        .locator('html')
        .evaluate(element => getComputedStyle(element).getPropertyValue('--font-size-scale').trim())
    )
    .toBe('1.1');
});

test('loading and image progress use the full width until their percentage appears', async ({ page }) => {
  await openApp(page);
  const metrics = await page.evaluate(() => {
    document.querySelector('#loadingOverlay').classList.add('open');
    document.querySelector('#shareProgressPanel').hidden = false;
    return [
      ['loadingProgressRow', 'loadingProgress', 'loadingProgressPercent'],
      ['shareProgressRow', 'shareProgress', 'shareProgressPercent']
    ].map(([rowId, progressId, percentId]) => {
      const row = document.getElementById(rowId);
      const progress = document.getElementById(progressId);
      const percent = document.getElementById(percentId);
      row.hidden = false;
      percent.hidden = true;
      const hiddenWidth = progress.getBoundingClientRect().width;
      percent.textContent = '42%';
      percent.hidden = false;
      const progressRect = progress.getBoundingClientRect();
      const percentRect = percent.getBoundingClientRect();
      return {
        hiddenWidth,
        visibleWidth: progressRect.width,
        sameRow: Math.abs(progressRect.top + progressRect.height / 2 - (percentRect.top + percentRect.height / 2)),
        percentAfterBar: percentRect.left - progressRect.right
      };
    });
  });
  for (const metric of metrics) {
    expect(metric.hiddenWidth).toBeGreaterThan(metric.visibleWidth);
    expect(metric.sameRow).toBeLessThan(1);
    expect(metric.percentAfterBar).toBeGreaterThanOrEqual(5.5);
  }
});

test('font size settings preview changes only the isolated example', async ({ page }) => {
  await openApp(page);
  await searchFor(page, 'バスタードソード');
  await page.getByText('バスタードソード', { exact: true }).first().click();
  const appliedName = page.locator('#treeContainer .result-root-summary .list-name');
  const appliedIcon = page.locator('#treeContainer .result-root-summary .checkable-item-icon');
  await expect(appliedName).toHaveCSS('font-size', '15.4px');
  await expect(appliedIcon).toHaveCSS('width', '40px');

  await page.locator('#settingsBtn').click();
  await page.locator('#settingsDisplayTab').click();
  await page.locator('#fontSizeLevelInput').fill('10');
  await expect(page.locator('#fontSizeLevelOutput')).toHaveText('170%');
  await expect(page.locator('#fontSizeLevelInput')).toHaveAttribute('aria-valuetext', '表示サイズ 170%');
  await expect(page.locator('.font-size-level-marks')).toHaveText(/小\s*大/);
  await expect(page.locator('#fontSizePreview .list-name')).toHaveCSS('font-size', '26.18px');
  await expect(page.locator('#fontSizePreview .checkable-item-icon')).toHaveCSS('width', '68px');
  await expect(appliedName).toHaveCSS('font-size', '15.4px');
  await expect(appliedIcon).toHaveCSS('width', '40px');
  await expect(page.locator('html')).toHaveAttribute('data-font-size-level', '3');
  await expect(page.locator('#fontSizeApplyBtn')).toBeEnabled();
  await expect
    .poll(() =>
      page.locator('#fontSizeApplyBtn').evaluate(button => {
        const section = button.closest('.font-size-settings-section');
        const sectionStyle = getComputedStyle(section);
        const contentWidth =
          section.getBoundingClientRect().width -
          parseFloat(sectionStyle.paddingLeft) -
          parseFloat(sectionStyle.paddingRight) -
          parseFloat(sectionStyle.borderLeftWidth) -
          parseFloat(sectionStyle.borderRightWidth);
        return Math.abs(button.getBoundingClientRect().width - contentWidth);
      })
    )
    .toBeLessThan(1);

  await page.locator('#fontSizePreviewPin').click();
  await expect(page.locator('#fontSizePreviewPin')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#fontSizePreviewCheck').click();
  await expect(page.locator('#fontSizePreviewCheck')).toHaveAttribute('aria-pressed', 'false');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('ff14_font_size_level_v2')))
    .toBeNull();

  await page.locator('#settingsCloseBtn').click();
  await page.locator('#fontSizeDiscardBtn').click();
  await expect(appliedName).toHaveText('バスタードソード');
  await page.locator('#settingsBtn').click();
  await page.locator('#settingsDisplayTab').click();
  await expect(page.locator('#fontSizePreviewPin')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#fontSizePreviewCheck')).toHaveAttribute('aria-pressed', 'true');
});

test('font size settings warn before discarding and backdrop continues editing', async ({ page }) => {
  await openApp(page);
  await page.locator('#settingsBtn').click();
  await page.locator('#settingsDisplayTab').click();
  await expect(page.locator('#fontSizeApplyBtn')).toBeDisabled();
  await page.locator('#fontSizeLevelInput').fill('4');

  await page.locator('#settingsCloseBtn').click();
  await expect(page.locator('#fontSizeDiscardOverlay')).toHaveClass(/open/);
  expect((await page.locator('#fontSizeDiscardDialog').boundingBox()).width).toBeGreaterThan(500);
  await page.locator('#fontSizeDiscardOverlay').click({ position: { x: 2, y: 2 } });
  await expect(page.locator('#fontSizeDiscardOverlay')).not.toHaveClass(/open/);
  await expect(page.locator('#settingsOverlay')).toHaveClass(/open/);

  await page.keyboard.press('Escape');
  await expect(page.locator('#fontSizeDiscardOverlay')).toHaveClass(/open/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#fontSizeDiscardOverlay')).not.toHaveClass(/open/);
  await expect(page.locator('#settingsOverlay')).toHaveClass(/open/);

  await page.locator('#settingsCloseBtn').click();
  await page.locator('#fontSizeDiscardBtn').click();
  await expect(page.locator('#settingsOverlay')).not.toHaveClass(/open/);
  await expect(page.locator('html')).toHaveAttribute('data-font-size-level', '3');

  await page.locator('#settingsBtn').click();
  await page.locator('#settingsDisplayTab').click();
  await page.locator('#fontSizeLevelInput').fill('10');
  await page.locator('#fontSizeLevelInput').fill('3');
  await expect(page.locator('#fontSizeApplyBtn')).toBeDisabled();
  await page.locator('#settingsCloseBtn').click();
  await expect(page.locator('#fontSizeDiscardOverlay')).not.toHaveClass(/open/);
  await expect(page.locator('#settingsOverlay')).not.toHaveClass(/open/);
});

test('applying a font size persists it and returns only that tab to the startup view', async ({ page, context }) => {
  await openApp(page);
  const otherPage = await context.newPage();
  await openApp(otherPage);
  await searchFor(page, 'バスタードソード');
  await page.getByText('バスタードソード', { exact: true }).first().click();

  await page.locator('#settingsBtn').click();
  await page.locator('#settingsDisplayTab').click();
  await page.locator('#fontSizeLevelInput').fill('10');
  await page.locator('#fontSizeApplyBtn').click();

  await expect(page.locator('#settingsOverlay')).not.toHaveClass(/open/);
  await expect(page.locator('html')).toHaveAttribute('data-font-size-level', '10');
  await expect(page.locator('body')).toHaveCSS('font-size', '26.18px');
  await expect(page.locator('#searchBox')).toHaveValue('');
  await expect(page.locator('#tipsMsg')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('ff14_font_size_level_v2')))
    .toBe('10');
  await expect(otherPage.locator('html')).toHaveAttribute('data-font-size-level', '3');

  await otherPage.reload();
  await expect(otherPage.locator('html')).toHaveAttribute('data-font-size-level', '10');
});

test('settings tabs retain in-dialog state and reopen on share and data', async ({ page }) => {
  await openApp(page, 544, 772);
  await page.locator('#settingsBtn').click();
  await expect(page.locator('#settingsShareTab')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#settingsDisplayPanel')).toBeHidden();
  const sharePanelOverflow = await page.locator('#settingsSharePanel').evaluate(panel => panel.scrollHeight - panel.clientHeight);
  expect(sharePanelOverflow).toBeLessThanOrEqual(0);
  await expect(page.locator('#settingsDialog')).not.toContainText('⚙');
  const settingsHeaderLayout = await page.locator('.settings-dialog-header').evaluate(header => {
    const version = header.querySelector('#appVersion').getBoundingClientRect();
    const actions = header.querySelector('.settings-top-actions').getBoundingClientRect();
    return {
      versionBeforeActions: version.right <= actions.left,
      verticalCenterDelta: version.top + version.height / 2 - (actions.top + actions.height / 2)
    };
  });
  expect(settingsHeaderLayout.versionBeforeActions).toBe(true);
  expect(Math.abs(settingsHeaderLayout.verticalCenterDelta)).toBeLessThan(1);
  await page.setViewportSize({ width: 375, height: 700 });
  const initialDialogBox = await page.locator('#settingsDialog').boundingBox();
  const shareBottomGap = await page.locator('#settingsDialog').evaluate(dialog => {
    const lastSection = dialog.querySelector('#settingsSharePanel > .settings-section:last-child');
    const close = dialog.querySelector('.settings-close');
    return close.getBoundingClientRect().top - lastSection.getBoundingClientRect().bottom;
  });
  expect(shareBottomGap).toBeLessThanOrEqual(50);

  await page.locator('#importCode').fill('入力途中のコード');
  await page.locator('#settingsSharePanel').evaluate(panel => {
    panel.scrollTop = 40;
  });
  const shareScroll = await page.locator('#settingsSharePanel').evaluate(panel => panel.scrollTop);
  await page.locator('#settingsDisplayTab').click();
  const displayDialogBox = await page.locator('#settingsDialog').boundingBox();
  expect(displayDialogBox.width).toBeCloseTo(initialDialogBox.width, 4);
  expect(displayDialogBox.height).toBeCloseTo(initialDialogBox.height, 4);
  await expect(page.locator('#fontSizeApplyNote')).toHaveText(
    '反映すると、表示中の検索・レシピ画面を終了して初期画面に戻ります。保存済みのお気に入りは保持されます。'
  );
  await page.locator('#fontSizeLevelInput').fill('8');
  await expect(page.locator('#fontSizePendingBadge')).toBeVisible();
  await page.locator('#settingsDisplayPanel').evaluate(panel => {
    panel.scrollTop = 30;
  });

  await page.locator('#settingsDisplayTab').press('ArrowLeft');
  await expect(page.locator('#settingsShareTab')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#importCode')).toHaveValue('入力途中のコード');
  await expect.poll(() => page.locator('#settingsSharePanel').evaluate(panel => panel.scrollTop)).toBe(shareScroll);
  await expect(page.locator('#fontSizePendingBadge')).toBeVisible();

  await page.locator('#settingsCloseBtn').click();
  await expect(page.locator('#fontSizeDiscardOverlay')).toHaveClass(/open/);
  await page.locator('#fontSizeDiscardBtn').click();
  await page.locator('#settingsBtn').click();
  await expect(page.locator('#settingsShareTab')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#importCode')).toHaveValue('');
});

test('button-like actions vibrate once while typing and completion do not add feedback', async ({ page }) => {
  await page.addInitScript(() => {
    window.__vibrationPatterns = [];
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value(pattern) {
        window.__vibrationPatterns.push(pattern);
        return true;
      }
    });
  });
  await openApp(page);
  const vibrationCount = () => page.evaluate(() => window.__vibrationPatterns.length);

  await page.locator('#searchBox').fill('バスタードソード');
  await expect.poll(vibrationCount).toBe(0);
  await page.locator('#recipeList .list-name').filter({ hasText: /^バスタードソード$/ }).click();
  await expect.poll(vibrationCount).toBe(1);

  await page.locator('#settingsBtn').click();
  await page.locator('#settingsDisplayTab').click();
  await page.locator('#fontSizeLevelInput').press('ArrowRight');
  await page.locator('#fontSizePreviewPin').click();
  await expect.poll(vibrationCount).toBe(5);
  await page.locator('#fontSizeApplyBtn').click();
  await expect.poll(vibrationCount).toBe(6);
  await page.waitForTimeout(50);
  await expect.poll(vibrationCount).toBe(6);

  await page.locator('#settingsBtn').click();
  await page.locator('#settingsOverlay').click({ position: { x: 2, y: 2 } });
  await expect.poll(vibrationCount).toBe(8);
  await expect(page.locator('#settingsOverlay')).not.toHaveClass(/open/);
  expect(await page.evaluate(() => window.__vibrationPatterns.every(pattern => pattern === 12))).toBe(true);
});

test('all font levels preserve fixed spacing and mobile content width', async ({ page }) => {
  test.setTimeout(120000);
  await page.addInitScript(() => localStorage.removeItem('ff14_view_state_v1'));
  const widths = [375, 600, 601, 1280];
  const expectedNameSizes = ['12.32px', '13.86px', '15.4px', '16.94px', '18.48px', '20.02px', '21.56px', '23.1px', '24.64px', '26.18px'];

  for (const width of widths) {
    await openApp(page, width, 800);
    await searchFor(page, 'バスタードソード');
    await page.locator('#recipeList .list-name').filter({ hasText: /^バスタードソード$/ }).click();
    const rootSummary = page.locator('#treeContainer .result-root-summary');
    await expect(rootSummary).toBeVisible();
    if (width <= 600) await page.waitForFunction(() => !document.querySelector('.main')?.swiper?.animating);

    for (let level = 1; level <= 10; level += 1) {
      await page.evaluate(value => {
        document.documentElement.setAttribute('data-font-size-level', String(value));
      }, level);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

      await expect(rootSummary.locator('.list-name')).toHaveCSS('font-size', expectedNameSizes[level - 1]);
      await expect(rootSummary.locator('.node-row')).toHaveCSS('column-gap', '6px');
      await expect(rootSummary.locator('.node-row')).toHaveCSS('padding-left', '8px');

      if (width <= 600) {
        const dimensions = await page.evaluate(() => {
          const panel = document.querySelector('#panelRight');
          const tree = document.querySelector('#treeContainer');
          const summary = tree.querySelector('.result-root-summary');
          const panelRect = panel.getBoundingClientRect();
          const summaryRect = summary.getBoundingClientRect();
          return {
            documentWidth: document.documentElement.scrollWidth,
            panelRight: panelRect.right,
            summaryLeft: summaryRect.left,
            summaryRight: summaryRect.right,
            treeClientWidth: tree.clientWidth,
            treeScrollWidth: tree.scrollWidth,
            viewportWidth: window.innerWidth
          };
        });
        expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
        expect(dimensions.panelRight).toBeLessThanOrEqual(dimensions.viewportWidth + 0.5);
        expect(dimensions.summaryLeft).toBeGreaterThanOrEqual(-0.5);
        expect(dimensions.summaryRight).toBeLessThanOrEqual(dimensions.viewportWidth + 0.5);
        expect(dimensions.treeScrollWidth).toBeLessThanOrEqual(dimensions.treeClientWidth + 1);
      }

      await page.evaluate(value => {
        const overlay = document.querySelector('#settingsOverlay');
        const preview = document.querySelector('#fontSizePreview');
        overlay.classList.add('open');
        preview.setAttribute('data-font-size-level', String(value));
      }, level);
      const settingsDialog = page.locator('#settingsDialog');
      await expect(settingsDialog).toBeVisible();
      if (width <= 600) {
        const dialogBox = await settingsDialog.boundingBox();
        expect(dialogBox.x).toBeGreaterThanOrEqual(0);
        expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(width + 0.5);
      }
      await page.evaluate(() => document.querySelector('#settingsOverlay').classList.remove('open'));
    }
  }
});

test('title returns to the startup view', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('#tipsMsg .tips-about-btn')).toHaveText('このアプリは何ですか？');
  await expect(page.locator('#tipsMsg .tips-about-btn')).toHaveAttribute(
    'data-url',
    'http://127.0.0.1:4174/'
  );
  await expect(page.locator('#tipsMsg .tips-about-description')).toHaveText(
    '← 選択すると、このアプリでできることや各種機能の説明画面が表示されます'
  );
  await searchFor(page, 'バスタードソード');
  await page.getByText('バスタードソード', { exact: true }).first().click();
  await expect(page.locator('.result-root-summary')).toContainText('バスタードソード');

  await page.locator('#appTitle').click();
  await expect(page.locator('#searchBox')).toHaveValue('');
  await expect(page.locator('#favBtn')).toHaveText('📌 お気に入り');
  await expect(page.locator('#resultTitle')).toHaveText('');
  await expect(page.locator('#tipsMsg')).toBeVisible();
});

test('tips groups releases before v3.0 in a collapsed accordion', async ({ page }) => {
  await openApp(page);
  const details = page.locator('#tipsMsg details');
  const summary = details.locator('summary');

  await expect(details).toHaveCount(1);
  await expect(summary).toHaveText('v3.0未満のリリース情報');
  await expect(details).not.toHaveAttribute('open', '');
  await expect(details.getByText('v1.384 リリース')).toBeHidden();
  await expect.poll(() => summary.evaluate(element => getComputedStyle(element, '::before').content)).toContain('▶');

  await summary.click();
  await expect(details).toHaveAttribute('open', '');
  await expect(details.getByText('v1.384 リリース')).toBeVisible();
  await expect.poll(() => summary.evaluate(element => getComputedStyle(element, '::before').content)).toContain('▼');
});

test('updated app blocks use until the current release notice is accepted', async ({ page }) => {
  await openApp(page);
  await searchFor(page, 'バスタードソード');
  await page.getByText('バスタードソード', { exact: true }).first().click();
  await page.locator('.result-root-summary .pin-btn').first().click();
  await page.locator('#favoriteTargetCreate').getByText('新規作成').click();
  await page.locator('#textInputField').fill('更新後も保持するリスト');
  await page.locator('#textInputOkBtn').click();
  await expect(page.locator('.result-root-summary')).toContainText('バスタードソード');

  await page.evaluate(previousVersion => {
    sessionStorage.setItem('ff14_update_reload_pending', '1');
    localStorage.setItem('ff14_acknowledged_release_version', previousVersion);
  }, `${publishedAppVersion}-previous`);
  await page.reload();
  await expect(page.locator('#loadStatus')).toHaveText(publishedPatchStatus);
  await expect(page.locator('#loadingOverlay')).not.toHaveClass(/open/);

  const overlay = page.locator('#releaseNoticeOverlay');
  const content = page.locator('#releaseNoticeContent');
  await expect(overlay).toHaveClass(/open/);
  await expect(content).toContainText('アイテム画像はクリック/タップで ✔ を On/Off');
  await expect(content).toContainText(publishedAppVersion);
  await expect(content).not.toContainText('v2.98 リリース');
  await expect(page.locator('.main')).toHaveJSProperty('inert', true);
  await expect(page.locator('#releaseNoticeOkBtn')).toBeFocused();
  await expect(page.locator('#searchBox')).toHaveValue('');
  await expect(page.locator('#countInput')).toHaveValue('1');
  await expect(page.locator('.result-root-summary')).toHaveCount(0);
  await expect(page.locator('#favoriteLists')).not.toHaveClass(/open/);
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('ff14_view_state_v1'))?.selected?.recipe || ''))
    .toBe('');

  await page.keyboard.press('Escape');
  await expect(overlay).toHaveClass(/open/);
  await overlay.click({ position: { x: 5, y: 5 } });
  await expect(overlay).toHaveClass(/open/);

  await page.locator('#releaseNoticeOkBtn').click();
  await expect(overlay).not.toHaveClass(/open/);
  await expect(page.locator('.main')).toHaveJSProperty('inert', false);
  await expect(page.locator('#searchBox')).toBeFocused();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('ff14_acknowledged_release_version')))
    .toBe(publishedAppVersion);
  await page.keyboard.press('Escape');
  await page.locator('#favBtn').click();
  await expect(page.locator('#favoriteLists')).toContainText('更新後も保持するリスト');
});

test('small popup reads the current release heading without a load error', async ({ page }) => {
  await openApp(page);
  await page.evaluate(previousVersion => {
    localStorage.setItem('ff14_acknowledged_release_version', previousVersion);
    sessionStorage.setItem('ff14_update_reload_pending', '1');
  }, `${publishedAppVersion}-previous`);

  const popupPromise = page.waitForEvent('popup');
  await page.locator('#popupBtn').click();
  const popup = await popupPromise;
  await expect.poll(() => popup.evaluate(() => window.innerWidth)).toBe(601);
  await expect(popup.locator('#releaseNoticeOverlay')).toHaveClass(/open/);
  await expect(popup.locator('#releaseNoticeContent')).toContainText(publishedAppVersion);
  await expect(popup.locator('#loadStatus')).toHaveText(publishedPatchStatus);
  await expect(popup.locator('.error-msg')).toHaveCount(0);
  await popup.locator('#releaseNoticeOkBtn').click();
  await expect
    .poll(() => popup.evaluate(() => localStorage.getItem('ff14_acknowledged_release_version')))
    .toBe(publishedAppVersion);
  await popup.close();
});

test('tips treats one newline as a line break and keeps indented text in its list item', async ({ page }) => {
  await page.route('**/data/tips.md', route =>
    route.fulfill({
      contentType: 'text/markdown; charset=utf-8',
      body: '通常行1\n通常行2\n\n- 箇条書き\n  箇条内の改行\n\n![更新画像](./assets/app-icons/favicon.png)'
    })
  );
  await openApp(page);

  await expect(page.locator('#tipsMsg p').first()).toHaveText('通常行1通常行2');
  await expect(page.locator('#tipsMsg p').first().locator('br')).toHaveCount(1);
  await expect(page.locator('#tipsMsg li')).toHaveText('箇条書き箇条内の改行');
  await expect(page.locator('#tipsMsg li br')).toHaveCount(1);
  await expect(page.locator('#tipsMsg li')).toHaveCount(1);
  await expect(page.locator('#tipsMsg img')).toHaveAttribute('alt', '更新画像');
  await expect(page.locator('#tipsMsg img')).toHaveCSS('max-width', '100%');
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
  await openApp(page, 390, 780);
  await expect(page.locator('#popupBtn')).toBeHidden();
  await expect(page.locator('#headerAppFullName')).toBeVisible();
  await expect.poll(() => page.locator('#headerAppFullName').evaluate(element => (
    element.scrollWidth <= element.clientWidth + 0.5
  ))).toBe(true);
});

test('mobile header keeps the left-panel layout and collapse behavior on every panel', async ({ page }) => {
  await openApp(page, 320, 700);
  await expect(page.locator('#settingsBtn')).toHaveText('⚙');
  await expect(page.locator('#settingsBtn')).toHaveAttribute('aria-label', '共有・データ管理などを開く');
  const leftHeaderLayout = await page.evaluate(() => {
    const title = document.querySelector('.header-primary-row').getBoundingClientRect();
    const settings = document.querySelector('#settingsBtn').getBoundingClientRect();
    return {
      sameRow: Math.abs(title.top + title.height / 2 - (settings.top + settings.height / 2)),
      overlap: title.right - settings.left
    };
  });
  expect(leftHeaderLayout.sameRow).toBeLessThan(1);
  expect(leftHeaderLayout.overlap).toBeLessThanOrEqual(0);
  await expect.poll(() => page.evaluate(() => {
    const title = document.querySelector('.app-title').getBoundingClientRect();
    const info = document.querySelector('#headerInfo').getBoundingClientRect();
    return Math.abs(title.top + title.height / 2 - (info.top + info.height / 2));
  })).toBeLessThan(1);
  await searchFor(page, 'ア');
  await page.evaluate(() => {
    window.__mobileHeaderClassMutations = 0;
    new MutationObserver(records => {
      window.__mobileHeaderClassMutations += records.length;
    }).observe(document.querySelector('header'), { attributes: true, attributeFilter: ['class'] });
  });
  await page.locator('#recipeList').evaluate(list => {
    list.scrollTop = 12;
    list.dispatchEvent(new Event('scroll'));
  });
  await expect(page.locator('header')).not.toHaveClass(/mobile-title-hidden/);
  await expect(page.locator('#settingsBtn')).toBeVisible();
  await page.locator('#recipeList').evaluate(list => {
    list.scrollTop = 40;
    list.dispatchEvent(new Event('scroll'));
  });
  await expect(page.locator('header')).toHaveClass(/mobile-title-hidden/);
  await expect(page.locator('#settingsBtn')).toBeHidden();
  await expect(page.locator('#settingsBtn')).toHaveJSProperty('inert', true);
  await expect.poll(() => page.locator('header').evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(1);
  await page.locator('#recipeList').evaluate(list => {
    list.scrollTop = 24;
    list.dispatchEvent(new Event('scroll'));
  });
  await expect.poll(() => page.evaluate(() => window.__mobileHeaderClassMutations)).toBe(1);

  await page.locator('#recipeList').evaluate(list => {
    list.scrollTop = 1;
    list.dispatchEvent(new Event('scroll'));
  });
  await expect(page.locator('header')).toHaveClass(/mobile-title-hidden/);

  await page.locator('#recipeList').evaluate(list => {
    list.scrollTop = 0;
    list.dispatchEvent(new Event('scroll'));
  });
  await expect(page.locator('header')).not.toHaveClass(/mobile-title-hidden/);
  await expect(page.locator('#settingsBtn')).toBeVisible();

  await page.locator('#recipeList').evaluate(list => {
    const shortContent = document.createElement('li');
    shortContent.style.height = `${list.clientHeight + 20}px`;
    shortContent.style.flexShrink = '0';
    list.replaceChildren(shortContent);
    list.scrollTop = 12;
    list.dispatchEvent(new Event('scroll'));
  });
  await expect(page.locator('header')).not.toHaveClass(/mobile-title-hidden/);

  await searchFor(page, 'バスタードソード');
  await page.getByText('バスタードソード', { exact: true }).first().click();
  for (let level = 1; level <= 10; level += 1) {
    await page.locator('html').evaluate((element, selectedLevel) => {
      element.dataset.fontSizeLevel = String(selectedLevel);
    }, level);
    await expect.poll(() => page.evaluate(() => {
      const header = document.querySelector('header').getBoundingClientRect();
      const title = document.querySelector('.app-title').getBoundingClientRect();
      return title.top - header.top;
    })).toBeGreaterThanOrEqual(4);
    await expect.poll(() => page.evaluate(() => {
      const title = document.querySelector('.app-title').getBoundingClientRect();
      const info = document.querySelector('#headerInfo').getBoundingClientRect();
      return Math.abs(title.top + title.height / 2 - (info.top + info.height / 2));
    })).toBeLessThan(1);
    await expect.poll(() => page.evaluate(() => {
      const back = document.querySelector('#mobileBackBtn').getBoundingClientRect();
      const title = document.querySelector('.app-title').getBoundingClientRect();
      const settings = document.querySelector('#settingsBtn').getBoundingClientRect();
      return Math.min(title.left - back.right, settings.left - title.right);
    })).toBeGreaterThanOrEqual(7.5);
  }
  await page.locator('html').evaluate(element => { element.dataset.fontSizeLevel = '3'; });
  await expect(page.locator('#mobileBackBtn')).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const primary = document.querySelector('.header-primary-row').getBoundingClientRect();
    const settings = document.querySelector('#settingsBtn').getBoundingClientRect();
    return Math.abs(primary.top + primary.height / 2 - (settings.top + settings.height / 2));
  })).toBeLessThan(1);
  await page.locator('#usesBtn').click();
  await expect.poll(() => page.evaluate(() => {
    const header = document.querySelector('header').getBoundingClientRect();
    const title = document.querySelector('.app-title').getBoundingClientRect();
    return title.top - header.top;
  })).toBeGreaterThanOrEqual(4);
  await expect.poll(() => page.evaluate(() => {
    const title = document.querySelector('.app-title').getBoundingClientRect();
    const info = document.querySelector('#headerInfo').getBoundingClientRect();
    return Math.abs(title.top + title.height / 2 - (info.top + info.height / 2));
  })).toBeLessThan(1);
  await page.locator('#usesList').evaluate(list => {
    const shortContent = document.createElement('li');
    shortContent.style.height = `${list.clientHeight + 20}px`;
    shortContent.style.flexShrink = '0';
    list.replaceChildren(shortContent);
    list.scrollTop = 12;
    list.dispatchEvent(new Event('scroll'));
  });
  await expect(page.locator('header')).not.toHaveClass(/mobile-title-hidden/);

  await page.locator('#usesList').evaluate(list => {
    const tallContent = document.createElement('li');
    tallContent.style.height = `${list.clientHeight + 100}px`;
    tallContent.style.flexShrink = '0';
    list.replaceChildren(tallContent);
    list.scrollTop = 40;
    list.dispatchEvent(new Event('scroll'));
  });
  await expect(page.locator('header')).toHaveClass(/mobile-title-hidden/);
  await expect(page.locator('header')).toHaveCSS('row-gap', '0px');
  await expect(page.locator('#mobileBackBtn')).toBeHidden();
  await expect(page.locator('#settingsBtn')).toBeHidden();
  await expect(page.locator('#settingsBtn')).toHaveJSProperty('inert', true);
  await expect.poll(() => page.locator('header').evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(1);

  await page.evaluate(() => showMobilePanel('left', { animate: false }));
  await page.getByText('バスタードソード', { exact: true }).first().click();
  await page.locator('#panelRight').evaluate(panel => {
    panel.scrollTop = 40;
    panel.dispatchEvent(new Event('scroll'));
  });
  await expect(page.locator('header')).toHaveClass(/mobile-title-hidden/);
  await expect(page.locator('#mobileBackBtn')).toBeHidden();
  await expect(page.locator('#settingsBtn')).toBeHidden();
  await expect(page.locator('#settingsBtn')).toHaveJSProperty('inert', true);
  await expect(page.locator('header')).toHaveCSS('padding-top', '0px');
  await expect(page.locator('header')).toHaveCSS('row-gap', '0px');
  await expect.poll(() => page.locator('header').evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(1);

  await page.locator('#panelRight').evaluate(panel => {
    panel.scrollTop = 0;
    panel.dispatchEvent(new Event('scroll'));
    const shortContent = document.createElement('div');
    shortContent.style.height = `${panel.clientHeight + 20}px`;
    shortContent.style.flexShrink = '0';
    panel.replaceChildren(shortContent);
    panel.scrollTop = 12;
    panel.dispatchEvent(new Event('scroll'));
  });
  await expect(page.locator('header')).not.toHaveClass(/mobile-title-hidden/);
  await expect(page.locator('#mobileBackBtn')).toBeVisible();
});

test('only narrow PC layouts show the common-header back button at the left edge', async ({ page }) => {
  await openApp(page, 423, 780);
  await expect(page.locator('html')).toHaveAttribute('data-device-type', 'pc');
  await expect(page.locator('#mobileBackBtn')).toBeHidden();
  const initialHeader = await page.evaluate(() => {
    const header = document.querySelector('header').getBoundingClientRect();
    const button = document.querySelector('#mobileBackBtn').getBoundingClientRect();
    const primary = document.querySelector('.header-primary-row').getBoundingClientRect();
    const settings = document.querySelector('#settingsBtn').getBoundingClientRect();
    return {
      headerHeight: header.height,
      buttonLeft: button.left,
      buttonRight: button.right,
      buttonTop: button.top,
      primaryTop: primary.top,
      primaryLeft: primary.left,
      settingsTop: settings.top,
      settingsRight: settings.right
    };
  });
  await searchFor(page, '岩塩');
  await page
    .locator('#recipeList li')
    .filter({ has: page.getByText('岩塩', { exact: true }) })
    .first()
    .locator('.uses-list-btn')
    .click();
  await expect(page.locator('#mobileBackBtn')).toBeVisible();
  await expect(page.locator('#usesBackBtn')).toBeHidden();
  await expect(page.locator('#backBtn')).toBeHidden();
  const middleHeader = await page.evaluate(() => {
    const header = document.querySelector('header').getBoundingClientRect();
    const primary = document.querySelector('.header-primary-row').getBoundingClientRect();
    const settings = document.querySelector('#settingsBtn').getBoundingClientRect();
    const button = document.querySelector('#mobileBackBtn').getBoundingClientRect();
    return {
      headerHeight: header.height,
      buttonOffset: button.left - header.left,
      buttonRight: button.right,
      buttonTop: button.top,
      primaryTop: primary.top,
      primaryLeft: primary.left,
      settingsTop: settings.top,
      settingsRight: settings.right
    };
  });
  expect(middleHeader.buttonOffset).toBeCloseTo(12, 0);
  expect(middleHeader.headerHeight).toBeCloseTo(initialHeader.headerHeight, 0);
  expect(middleHeader.buttonRight).toBeCloseTo(initialHeader.buttonRight, 0);
  expect(middleHeader.buttonTop).toBeCloseTo(initialHeader.buttonTop, 0);
  expect(middleHeader.primaryTop).toBeCloseTo(initialHeader.primaryTop, 0);
  expect(middleHeader.primaryLeft).toBeCloseTo(initialHeader.primaryLeft, 0);
  expect(middleHeader.settingsTop).toBeCloseTo(initialHeader.settingsTop, 0);
  expect(middleHeader.settingsRight).toBeCloseTo(initialHeader.settingsRight, 0);
  expect(middleHeader.primaryLeft).toBeGreaterThanOrEqual(middleHeader.buttonRight + 7.5);

  await page.locator('#mobileBackBtn').click();
  await expect(page.locator('#panelLeft')).toHaveClass(/mobile-visible/);
  await expect(page.locator('#mobileBackBtn')).toBeHidden();

  await page
    .locator('#recipeList li')
    .filter({ has: page.getByText('岩塩', { exact: true }) })
    .first()
    .locator('.uses-list-btn')
    .click();

  await page.locator('#usesList li').first().click();
  await expect(page.locator('#mobileBackBtn')).toBeVisible();
  await page.locator('#mobileBackBtn').click();
  await expect(page.locator('#panelMiddle')).toHaveClass(/mobile-visible/);

  await page.setViewportSize({ width: 601, height: 780 });
  await expect(page.locator('#mobileBackBtn')).toBeHidden();
});

test('narrow non-PC layouts keep the common-header back button hidden', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      get: () =>
        'Mozilla/5.0 (Linux; Android 15; Mobile) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36'
    });
  });
  await openApp(page, 423, 780);
  await expect(page.locator('html')).toHaveAttribute('data-device-type', 'other');
  await searchFor(page, '岩塩');
  await page
    .locator('#recipeList li')
    .filter({ has: page.getByText('岩塩', { exact: true }) })
    .first()
    .locator('.uses-list-btn')
    .click();
  await expect(page.locator('#mobileBackBtn')).toBeHidden();
  await expect(page.locator('#usesBackBtn')).toBeHidden();
  await page.locator('#usesList li').first().click();
  await expect(page.locator('#mobileBackBtn')).toBeHidden();
  await expect(page.locator('#backBtn')).toBeHidden();
});

test('header information keeps both full lines visible and shrinks each only as needed', async ({ page }) => {
  const fullName = 'FinalFantasy XIV® Crafting Assistant XIVca(シヴカ)';
  await openApp(page, 1440, 900);
  await expect(page.locator('#headerAppFullName')).toHaveText(fullName);
  await expect(page.locator('#headerAppFullName')).toBeVisible();
  await expect(page.locator('#loadStatus')).toHaveText(publishedPatchStatus);

  const assertHeaderInformationLayout = async () => {
    const metrics = await page.evaluate(() => {
      const info = document.querySelector('#headerInfo').getBoundingClientRect();
      const name = document.querySelector('#headerAppFullName').getBoundingClientRect();
      const patch = document.querySelector('#loadStatus').getBoundingClientRect();
      const logo = document.querySelector('.app-name-logo').getBoundingClientRect();
      return {
        infoHeight: info.height,
        logoHeight: logo.height,
        nameTop: name.top,
        patchTop: patch.top,
        secondRowTop: info.top + info.height / 2,
        nameClientWidth: document.querySelector('#headerAppFullName').clientWidth,
        nameScrollWidth: document.querySelector('#headerAppFullName').scrollWidth,
        patchClientWidth: document.querySelector('#loadStatus').clientWidth,
        patchScrollWidth: document.querySelector('#loadStatus').scrollWidth
      };
    });
    expect(metrics.infoHeight).toBeLessThanOrEqual(metrics.logoHeight + 0.5);
    expect(metrics.patchTop).toBeGreaterThan(metrics.nameTop);
    expect(metrics.patchTop).toBeGreaterThanOrEqual(metrics.secondRowTop);
    expect(metrics.nameScrollWidth).toBeLessThanOrEqual(metrics.nameClientWidth + 0.5);
    expect(metrics.patchScrollWidth).toBeLessThanOrEqual(metrics.patchClientWidth + 0.5);
  };

  await assertHeaderInformationLayout();
  await page.setViewportSize({ width: 423, height: 780 });
  await expect(page.locator('#headerAppFullName')).toBeVisible();
  await expect(page.locator('#loadStatus')).toBeVisible();
  await assertHeaderInformationLayout();
  const narrowFontSizes = await page.evaluate(() => ({
    name: parseFloat(getComputedStyle(document.querySelector('#headerAppFullName')).fontSize),
    patch: parseFloat(getComputedStyle(document.querySelector('#loadStatus')).fontSize)
  }));
  expect(narrowFontSizes.name).toBeLessThan(narrowFontSizes.patch);

  for (let level = 1; level <= 10; level += 1) {
    await page.locator('html').evaluate((element, selectedLevel) => {
      element.dataset.fontSizeLevel = String(selectedLevel);
    }, level);
    await expect(page.locator('#headerAppFullName')).toBeVisible();
    await expect.poll(() => page.locator('#headerAppFullName').evaluate(element => (
      element.scrollWidth <= element.clientWidth + 0.5
    ))).toBe(true);
    await assertHeaderInformationLayout();
  }
});

test('crossing the responsive breakpoint resets to startup view', async ({ page }) => {
  await openApp(page, 601, 700);
  await searchFor(page, 'バスタードソード');
  await page.getByText('バスタードソード', { exact: true }).first().click();
  await page.locator('#countIncrease5Btn').click();
  await expect(page.locator('.result-root-summary')).toContainText('バスタードソード');

  await page.setViewportSize({ width: 600, height: 700 });
  await expect(page.locator('#panelLeft')).toHaveClass(/mobile-visible/);
  await expect(page.locator('#searchBox')).toHaveValue('');
  await expect(page.locator('#countInput')).toHaveValue('1');
  await expect(page.locator('#resultTitle')).toHaveText('');
  await expect(page.locator('#recipeList')).toBeHidden();
  await expect(page.locator('#recipeList li.tips-li')).toHaveCount(0);
  await expect(page.locator('#mobileTipsMsg')).toBeVisible();
  await expect(page.locator('#mobileTipsMsg .tips-about-btn')).toHaveText('このアプリは何ですか？');
  await expect(page.locator('#mobileTipsMsg .tips-about-description')).toBeVisible();
  await expect(page.locator('#mobileTipsMsg .tips-row')).toBeVisible();
  await expect(page.locator('#mobileTipsMsg')).toHaveCSS('padding', '16px 20px 22px');
  await expect(page.locator('#mobileTipsMsg')).toHaveCSS('background-color', 'rgb(26, 26, 26)');

  await page.locator('#searchBox').fill('山羊乳');
  await expect(page.locator('#mobileTipsMsg')).toBeHidden();
  await expect(page.locator('#recipeList')).toBeVisible();
  await expect(page.locator('#recipeList li').first()).toContainText('山羊乳');

  await page.setViewportSize({ width: 601, height: 700 });
  await expect(page.locator('#panelLeft')).not.toHaveClass(/mobile-visible/);
  await expect(page.locator('#searchBox')).toHaveValue('');
  await expect(page.locator('#countInput')).toHaveValue('1');
  await expect(page.locator('#resultTitle')).toHaveText('');
  await expect(page.locator('#mobileTipsMsg')).toBeHidden();
  await expect(page.locator('#tipsMsg')).toBeVisible();
});

test('mobile panels move by swipe without navigation arrows or position dots', async ({ page }) => {
  await openApp(page, 423, 780);
  await searchFor(page, 'バスタードソード');
  await expect(page.locator('#panelLeft')).toHaveClass(/mobile-visible/);
  await expect(page.locator('.swiper-button-next, .swiper-button-prev, .swiper-pagination')).toHaveCount(0);

  await beginSwipe(page, page.locator('#recipeList'), 0.65, 0.25);
  await endSwipe(page);
  await expect(page.locator('#panelLeft')).toHaveClass(/mobile-visible/);

  await page.getByText('バスタードソード', { exact: true }).first().click();
  await expect(page.locator('#panelRight')).toHaveClass(/mobile-visible/);
  await swipe(page, page.locator('#panelRight'), 0.35, 0.75);
  await expect(page.locator('#panelLeft')).toHaveClass(/mobile-visible/);

  await beginSwipe(page, page.locator('#recipeList'), 0.65, 0.25);
  const trackingLayout = await page.evaluate(() => {
    const viewport = document.querySelector('.main').getBoundingClientRect();
    const left = document.querySelector('#panelLeft').getBoundingClientRect();
    const right = document.querySelector('#panelRight').getBoundingClientRect();
    return {
      leftOffset: left.left - viewport.left,
      rightOffset: right.left - viewport.left,
      width: viewport.width,
      joinedGap: right.left - left.right
    };
  });
  expect(trackingLayout.leftOffset).toBeLessThan(0);
  expect(trackingLayout.leftOffset).toBeGreaterThan(-trackingLayout.width);
  expect(trackingLayout.rightOffset).toBeGreaterThan(0);
  expect(trackingLayout.rightOffset).toBeLessThan(trackingLayout.width);
  expect(Math.abs(trackingLayout.joinedGap)).toBeLessThan(1);
  await endSwipe(page);
  await expect(page.locator('#panelRight')).toHaveClass(/mobile-visible/);
  await expect(page.locator('#panelLeft')).not.toHaveClass(/mobile-visible/);
  await swipe(page, page.locator('#panelRight'), 0.35, 0.75);
  await expect(page.locator('#panelLeft')).toHaveClass(/mobile-visible/);

  await searchFor(page, '岩塩');
  await page.evaluate(() => {
    window.__programmaticPanelSwipeSpeed = null;
    document.querySelector('.main').swiper.on('beforeTransitionStart', (_swiper, speed) => {
      window.__programmaticPanelSwipeSpeed = speed;
    });
  });
  await page
    .locator('#recipeList li')
    .filter({ has: page.getByText('岩塩', { exact: true }) })
    .first()
    .locator('.uses-list-btn')
    .click();
  await expect.poll(() => page.evaluate(() => window.__programmaticPanelSwipeSpeed)).toBe(360);
  await expect(page.locator('#panelMiddle')).toHaveClass(/mobile-visible/);
  await swipe(page, page.locator('#usesList'), 0.65, 0.25);
  await expect(page.locator('#panelRight')).toHaveClass(/mobile-visible/);
  await swipe(page, page.locator('#panelRight'), 0.35, 0.75);
  await expect(page.locator('#panelMiddle')).toHaveClass(/mobile-visible/);
  await swipe(page, page.locator('#usesList'), 0.35, 0.75);
  await expect(page.locator('#panelLeft')).toHaveClass(/mobile-visible/);
  await swipe(page, page.locator('#recipeList'), 0.65, 0.25);
  await expect(page.locator('#panelMiddle')).toHaveClass(/open/);
  await expect(page.locator('#panelMiddle')).toHaveClass(/mobile-visible/);
});

test('mobile swipe removes destination panels when the left panel has no navigation target', async ({ page }) => {
  await openApp(page, 423, 780);
  await searchFor(page, 'バスタードソード');
  await page.getByText('バスタードソード', { exact: true }).first().click();
  await expect(page.locator('#panelRight')).toHaveClass(/mobile-visible/);
  await swipe(page, page.locator('#panelRight'), 0.35, 0.75);
  await expect(page.locator('#panelLeft')).toHaveClass(/mobile-visible/);

  await page.locator('#searchBox').fill('存在しない素材名');
  await expect(page.locator('#recipeList .list-empty')).toBeVisible();
  await expect(page.locator('#panelLeft [data-mobile-panel-target]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (
    [...document.querySelector('.main').swiper.slides].map(slide => slide.dataset.mobilePanel)
  ))).toEqual(['left']);

  await swipe(page, page.locator('#recipeList'), 0.65, 0.25);
  await expect(page.locator('#panelLeft')).toHaveClass(/mobile-visible/);
  await expect(page.locator('#panelMiddle')).not.toHaveClass(/mobile-visible/);
  await expect(page.locator('#panelRight')).not.toHaveClass(/mobile-visible/);
});
