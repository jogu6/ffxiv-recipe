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
  await page.addInitScript(() => {
    sessionStorage.setItem('ff14_update_reload_pending', '1');
    localStorage.setItem('ff14_acknowledged_release_version', 'v2.97');
  });
  await openApp(page);

  const overlay = page.locator('#releaseNoticeOverlay');
  const content = page.locator('#releaseNoticeContent');
  await expect(overlay).toHaveClass(/open/);
  await expect(content).toContainText('アイテム画像はクリック/タップで ✔ を On/Off');
  await expect(content).toContainText('v3.0 リリース');
  await expect(content).not.toContainText('v2.98 リリース');
  await expect(page.locator('.main')).toHaveJSProperty('inert', true);
  await expect(page.locator('#releaseNoticeOkBtn')).toBeFocused();

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
    .toBe('v3.0');
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
  await openApp(page);
  await expect(page.locator('#popupBtn')).toBeHidden();
});

test('mobile header combines and hides left controls while preserving right-panel navigation', async ({ page }) => {
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
  const navigationHeaderVerticalBudget = await page.evaluate(() => {
    const header = document.querySelector('header');
    const style = getComputedStyle(header);
    return parseFloat(style.rowGap) + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  });
  expect(navigationHeaderVerticalBudget).toBeCloseTo(22, 4);
  await expect.poll(() => page.evaluate(() => {
    const primary = document.querySelector('.header-primary-row').getBoundingClientRect();
    const back = document.querySelector('#mobileBackBtn').getBoundingClientRect();
    return back.top - primary.bottom;
  })).toBeGreaterThanOrEqual(9.5);
  await page.locator('#usesBtn').click();
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
  await expect.poll(() => page.locator('header').evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(48);
  await expect.poll(() => page.evaluate(() => {
    const header = document.querySelector('header').getBoundingClientRect();
    const back = document.querySelector('#mobileBackBtn').getBoundingClientRect();
    return back.top - header.top;
  })).toBeLessThanOrEqual(5);

  await page.locator('#mobileBackBtn').click();
  await page.getByText('バスタードソード', { exact: true }).first().click();
  await page.locator('#panelRight').evaluate(panel => {
    panel.scrollTop = 40;
    panel.dispatchEvent(new Event('scroll'));
  });
  await expect(page.locator('header')).toHaveClass(/mobile-title-hidden/);
  await expect(page.locator('#mobileBackBtn')).toBeVisible();
  await expect(page.locator('#settingsBtn')).toBeVisible();
  await expect(page.locator('header')).toHaveCSS('padding-top', '3px');
  await expect(page.locator('header')).toHaveCSS('row-gap', '0px');
  await expect.poll(() => page.locator('header').evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(48);
  await expect.poll(() => page.evaluate(() => {
    const header = document.querySelector('header').getBoundingClientRect();
    const back = document.querySelector('#mobileBackBtn').getBoundingClientRect();
    return back.top - header.top;
  })).toBeLessThanOrEqual(5);

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
