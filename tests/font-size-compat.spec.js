const { expect, test } = require('@playwright/test');
const { publishedPatchStatus } = require('./helpers/app.js');

async function waitForAppLoaded(page) {
  await expect(page.locator('#loadStatus')).toHaveText(publishedPatchStatus, { timeout: 30_000 });
  await expect(page.locator('#loadingOverlay')).not.toHaveClass(/open/, { timeout: 30_000 });
}

async function dispatchSyntheticSwipe(page, fromRatio, toRatio) {
  await page.waitForFunction(() => !document.querySelector('.main')?.swiper?.animating);
  const rect = await page.locator('.main').boundingBox();
  const y = rect.y + rect.height / 2;
  await page.mouse.move(rect.x + rect.width * fromRatio, y);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * toRatio, y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(50);
  await page.waitForFunction(() => !document.querySelector('.main')?.swiper?.animating);
}

test('mobile panel swipe works in every supported browser engine', async ({ page }) => {
  await page.setViewportSize({ width: 423, height: 780 });
  await page.goto('/');
  await waitForAppLoaded(page);
  await expect(page.locator('#panelLeft')).toHaveClass(/mobile-visible/);

  await dispatchSyntheticSwipe(page, 0.8, 0.2);
  await expect(page.locator('#panelLeft')).toHaveClass(/mobile-visible/);

  await page.locator('#searchBox').fill('バスタードソード');
  await page.locator('#panelLeft #recipeList').getByText('バスタードソード', { exact: true }).first().click();
  await expect(page.locator('#panelRight')).toHaveClass(/mobile-visible/);
  await dispatchSyntheticSwipe(page, 0.2, 0.8);
  await expect(page.locator('#panelLeft')).toHaveClass(/mobile-visible/);
  await expect(page.locator('[data-mobile-panel="left-boundary-startup"]')).toHaveCount(0);
  await dispatchSyntheticSwipe(page, 0.2, 0.8);
  await expect(page.locator('#panelLeft')).toHaveClass(/mobile-visible/);
  await expect(page.locator('#panelLeft #searchBox')).toHaveValue('バスタードソード');
});

test('saved level 10 fits the viewport and keeps live changes inside the preview', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ff14_font_size_level_v2', '10'));
  await page.goto('/');
  await waitForAppLoaded(page);

  await expect(page.locator('html')).toHaveAttribute('data-font-size-level', '10');
  await expect
    .poll(() => page.locator('body').evaluate(element => parseFloat(getComputedStyle(element).fontSize)))
    .toBeCloseTo(26.18, 4);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);

  await page.locator('#settingsBtn').click();
  await page.locator('#settingsDisplayTab').click();
  await expect(page.locator('#fontSizeLevelInput')).toHaveValue('10');
  await expect(page.locator('#fontSizeApplyBtn')).toBeDisabled();
  await expect(page.locator('#fontSizePreview .checkable-item-icon')).toHaveCSS('width', '68px');
  await expect.poll(() => page.locator('#fontSizePreview .node-icon').evaluate(image => image.naturalWidth)).toBeGreaterThan(0);

  const expectedWidths = ['32px', '36px', '40px', '44px', '48px', '52px', '56px', '60px', '64px', '68px'];
  for (let level = 1; level <= 10; level += 1) {
    await page.locator('#fontSizeLevelInput').fill(String(level));
    await expect(page.locator('#fontSizePreview .checkable-item-icon')).toHaveCSS(
      'width',
      expectedWidths[level - 1]
    );
  }
  await expect(page.locator('html')).toHaveAttribute('data-font-size-level', '10');
  const dialogBox = await page.locator('#settingsDialog').boundingBox();
  expect(dialogBox.x).toBeGreaterThanOrEqual(0);
  expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth + 0.5));
});

test('level 10 keeps dialog actions inside a compact viewport', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ff14_font_size_level_v2', '10'));
  await page.setViewportSize({ width: 375, height: 600 });
  await page.goto('/');
  await waitForAppLoaded(page);

  await page.locator('#settingsBtn').click();
  const settingsLayout = await page.locator('#settingsDialog').evaluate(dialog => {
    const action = dialog.querySelector('#settingsCloseBtn').getBoundingClientRect();
    const rect = dialog.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, actionTop: action.top, actionBottom: action.bottom };
  });
  expect(settingsLayout.top).toBeGreaterThanOrEqual(0);
  expect(settingsLayout.bottom).toBeLessThanOrEqual(600);
  expect(settingsLayout.actionTop).toBeGreaterThanOrEqual(settingsLayout.top);
  expect(settingsLayout.actionBottom).toBeLessThanOrEqual(settingsLayout.bottom);

  await page.locator('#licenseBtn').click();
  await expect(page.locator('#licenseOverlay')).toHaveClass(/open/);
  const licenseLayout = await page.locator('#licenseDialog').evaluate(dialog => {
    const action = dialog.querySelector('#licenseCloseBtn').getBoundingClientRect();
    const rect = dialog.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, actionTop: action.top, actionBottom: action.bottom };
  });
  expect(licenseLayout.top).toBeGreaterThanOrEqual(0);
  expect(licenseLayout.bottom).toBeLessThanOrEqual(600);
  expect(licenseLayout.actionTop).toBeGreaterThanOrEqual(licenseLayout.top);
  expect(licenseLayout.actionBottom).toBeLessThanOrEqual(licenseLayout.bottom);
});

test('settings button and gathering time labels fit every display size', async ({ page }) => {
  await page.goto('/');
  await waitForAppLoaded(page);
  await page.locator('#searchBox').fill('金鉱');
  await page.locator('#searchBox').blur();
  await page.locator('#recipeList .gathering-timer-btn').first().click();

  for (let level = 1; level <= 10; level += 1) {
    await page.locator('html').evaluate((element, selectedLevel) => {
      element.dataset.fontSizeLevel = String(selectedLevel);
    }, level);
    const measurements = await page.evaluate(() => {
      const measureText = element => {
        const box = element.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(element);
        const text = range.getBoundingClientRect();
        return {
          box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height },
          text: { left: text.left, right: text.right, top: text.top, bottom: text.bottom },
          centerDeltaX: Math.abs((box.left + box.right - text.left - text.right) / 2),
          centerDeltaY: Math.abs((box.top + box.bottom - text.top - text.bottom) / 2)
        };
      };
      return {
        settings: measureText(document.querySelector('#settingsBtn')),
        labels: [...document.querySelectorAll('.gathering-time-et, .gathering-time-lt')].map(measureText)
      };
    });

    expect(Math.abs(measurements.settings.box.width - measurements.settings.box.height)).toBeLessThan(0.5);
    expect(measurements.settings.centerDeltaX).toBeLessThan(1);
    expect(measurements.settings.centerDeltaY).toBeLessThan(1);
    for (const label of measurements.labels) {
      expect(label.text.left).toBeGreaterThanOrEqual(label.box.left - 0.5);
      expect(label.text.right).toBeLessThanOrEqual(label.box.right + 0.5);
      expect(label.text.top).toBeGreaterThanOrEqual(label.box.top - 0.5);
      expect(label.text.bottom).toBeLessThanOrEqual(label.box.bottom + 0.5);
    }
  }

  await expect(page.locator('#settingsBtn')).toHaveCSS('background-color', 'rgb(26, 26, 26)');
  await expect(page.locator('#settingsBtn')).toHaveCSS('color', 'rgb(200, 168, 75)');

  await page.locator('#gatheringCloseBtn').click();
  await page.locator('#settingsBtn').click();
  for (let level = 1; level <= 10; level += 1) {
    await page.locator('html').evaluate((element, selectedLevel) => {
      element.dataset.fontSizeLevel = String(selectedLevel);
    }, level);
    await page.locator('#exportListToggle').click();
    const layout = await page.evaluate(() => {
      const trigger = document.querySelector('#exportListToggle').getBoundingClientRect();
      const list = document.querySelector('#exportListChoices').getBoundingClientRect();
      return { trigger, list, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight };
    });
    expect(layout.list.left).toBeGreaterThanOrEqual(7.5);
    expect(layout.list.right).toBeLessThanOrEqual(layout.viewportWidth - 7.5);
    expect(layout.list.top).toBeGreaterThanOrEqual(7.5);
    expect(layout.list.bottom).toBeLessThanOrEqual(layout.viewportHeight - 7.5);
    expect(Math.abs(layout.list.width - layout.trigger.width)).toBeLessThan(1);
    await page.locator('#exportListToggle').click();
  }
});

test('scaled compact controls remain contained at every display size', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('ff14_search_history', JSON.stringify(Array.from({ length: 30 }, (_, index) => `履歴${index + 1}`)));
  });
  await page.goto('/');
  await expect(page.locator('#loadingOverlay')).not.toHaveClass(/open/);

  const setLevel = level =>
    page.locator('html').evaluate((element, value) => {
      element.dataset.fontSizeLevel = String(value);
      window.dispatchEvent(new Event('resize'));
    }, level);
  const audit = selectors =>
    page.evaluate(items => {
      const failures = [];
      for (const selector of items) {
        document.querySelectorAll(selector).forEach(element => {
          const box = element.getBoundingClientRect();
          if (!box.width || !box.height) return;
          if (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1) {
            failures.push(`${selector}:overflow`);
          }
          if (element.textContent.trim() && !element.matches('input')) {
            const range = document.createRange();
            range.selectNodeContents(element);
            const text = range.getBoundingClientRect();
            if (
              text.left < box.left - 0.75 ||
              text.right > box.right + 0.75 ||
              text.top < box.top - 0.75 ||
              text.bottom > box.bottom + 0.75
            ) {
              failures.push(`${selector}:text`);
            }
          }
          if (element.matches('input')) {
            const fontSize = parseFloat(getComputedStyle(element).fontSize);
            const minimumHeightRatio = element.matches('.count-input') ? 1 : 1.25;
            if (element.clientHeight < fontSize * minimumHeightRatio) failures.push(`${selector}:height`);
          }
        });
      }
      if (document.documentElement.scrollWidth > window.innerWidth + 1) failures.push('viewport:overflow');
      return failures;
    }, selectors);

  await page.locator('#searchBox').click();
  for (let level = 1; level <= 10; level += 1) {
    await setLevel(level);
    const readHistoryLayout = () => page.evaluate(() => {
      const trigger = document.querySelector('#searchBox').getBoundingClientRect();
      const list = document.querySelector('#searchHistory').getBoundingClientRect();
      const firstRow = document.querySelector('#searchHistory li').getBoundingClientRect();
      return {
        trigger,
        list,
        placement: document.querySelector('#searchHistory').dataset.placement,
        visibleRows: Math.floor(list.height / firstRow.height),
        staysWithinViewport: list.top >= 15 && list.bottom <= window.innerHeight - 15
      };
    });
    await expect.poll(async () => (await readHistoryLayout()).visibleRows).toBeGreaterThanOrEqual(10);
    await expect.poll(async () => (await readHistoryLayout()).staysWithinViewport).toBe(true);
    await expect.poll(async () => {
      const layout = await readHistoryLayout();
      return Math.max(
        Math.abs(layout.list.left - layout.trigger.left),
        Math.abs(layout.list.right - layout.trigger.right)
      );
    }).toBeLessThan(1);
    await expect.poll(async () => {
      const layout = await readHistoryLayout();
      return layout.placement === 'below'
        ? Math.abs(layout.list.top - layout.trigger.bottom - 3)
        : Math.abs(layout.trigger.top - layout.list.bottom - 3);
    }, { message: `history gap Level ${level}` }).toBeLessThan(2);
    const historyLayout = await readHistoryLayout();
    expect(Math.abs(historyLayout.list.left - historyLayout.trigger.left), `history left Level ${level}`).toBeLessThan(1);
    expect(Math.abs(historyLayout.list.right - historyLayout.trigger.right), `history right Level ${level}`).toBeLessThan(1);
    if (historyLayout.placement === 'below') {
      expect(
        Math.abs(historyLayout.list.top - historyLayout.trigger.bottom - 3),
        `history below Level ${level}`
      ).toBeLessThan(2);
    } else {
      expect(
        Math.abs(historyLayout.trigger.top - historyLayout.list.bottom - 3),
        `history above Level ${level}`
      ).toBeLessThan(2);
    }
    expect(historyLayout.visibleRows, `history rows Level ${level}`).toBeGreaterThanOrEqual(10);
  }

  await page.locator('#searchBox').fill('金鉱');
  await expect.poll(() => page.locator('#searchHistory').evaluate(list => list.getBoundingClientRect().height)).toBe(0);
  for (let level = 1; level <= 10; level += 1) {
    await setLevel(level);
    expect(await audit(['.search-row', '#searchClearBtn', '#equipmentSearchToggle']), `search Level ${level}`).toEqual(
      []
    );
  }

  await page.locator('#equipmentSearchToggle').click();
  await page.locator('#equipmentLevelInput').fill('100');
  for (let level = 1; level <= 10; level += 1) {
    await setLevel(level);
    expect(
      await audit([
        '#equipmentSearchPanel',
        '#equipmentJobSelect .custom-select-toggle',
        '#equipmentLevelInput',
        '.equipment-level-control button'
      ]),
      `equipment Level ${level}`
    ).toEqual([]);
    const toggle = page.locator('#equipmentJobSelect .custom-select-toggle');
    await toggle.click();
    const dropdownLayout = await page.evaluate(() => {
      const trigger = document.querySelector('#equipmentJobSelect').getBoundingClientRect();
      const list = document.querySelector('#equipmentJobSelect .custom-select-options').getBoundingClientRect();
      return { trigger, list, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight };
    });
    expect(dropdownLayout.list.left, `dropdown left Level ${level}`).toBeGreaterThanOrEqual(7.5);
    expect(dropdownLayout.list.right, `dropdown right Level ${level}`).toBeLessThanOrEqual(dropdownLayout.viewportWidth - 7.5);
    expect(dropdownLayout.list.top, `dropdown top Level ${level}`).toBeGreaterThanOrEqual(7.5);
    expect(dropdownLayout.list.bottom, `dropdown bottom Level ${level}`).toBeLessThanOrEqual(dropdownLayout.viewportHeight - 7.5);
    expect(Math.abs(dropdownLayout.list.width - dropdownLayout.trigger.width), `dropdown width Level ${level}`).toBeLessThan(1);
    await toggle.click();
  }

  await page.locator('#equipmentSearchToggle').click();
  await page.locator('#searchBox').fill('ブラスバスタードソード');
  await page.locator('#searchBox').blur();
  await page.getByText('ブラスバスタードソード', { exact: true }).first().click();
  await page.locator('#countInput').fill('999');
  for (let level = 1; level <= 10; level += 1) {
    await setLevel(level);
    expect(
      await audit(['.count-control', '.count-control .count-btn', '#countInput', '.tree-node .toggle']),
      `result Level ${level}`
    ).toEqual([]);
    const buttonWidths = await page.locator('.result-header .count-control .count-btn').evaluateAll(buttons =>
      buttons.map(button => button.getBoundingClientRect().width)
    );
    expect(Math.max(...buttonWidths) - Math.min(...buttonWidths), `count button widths Level ${level}`).toBeLessThan(0.1);
  }

  await page.locator('#materialsViewBtn').click();
  await page.locator('.intermediate-material-tree-btn').first().click();
  await page.locator('#materialTreeCountInput').fill('999');
  for (let level = 1; level <= 10; level += 1) {
    await setLevel(level);
    expect(
      await audit([
        '.material-tree-count-row',
        '.material-tree-count-row .count-btn',
        '#materialTreeCountInput',
        '.materials-section-toggle'
      ]),
      `material tree Level ${level}`
    ).toEqual([]);
  }

  await page.locator('#materialTreeCloseBtn').click();
  await page.locator('.intermediate-prepared-btn').first().click();
  for (let level = 1; level <= 10; level += 1) {
    await setLevel(level);
    expect(
      await audit([
        '#preparedCountDialog',
        '.prepared-count-control',
        '.prepared-count-control .count-btn',
        '#preparedCountInput',
        '.prepared-count-presets button'
      ]),
      `prepared count Level ${level}`
    ).toEqual([]);
  }
  await page.locator('#preparedCountCloseBtn').click();

  await page.evaluate(() => {
    const fixture = document.createElement('div');
    fixture.id = 'scalingRegressionFixture';
    fixture.style.cssText = 'position:fixed;left:-10000px;top:0;width:355px;visibility:hidden;';
    fixture.innerHTML = `
      <div class="markdown-content"><details open><summary>見出し</summary><p>本文</p></details></div>
      <div class="recipe-method-control"><div class="recipe-method-selector"><button class="recipe-method-summary">製作方法</button></div></div>
      <button class="favorite-material-help-btn">?</button><button class="history-delete">🗑️</button>
      <div style="position:relative;width:355px;height:60px">
        <div class="favorite-list-curtain expanded"><button class="favorite-list-curtain-toggle">▶</button>
          <button class="favorite-list-icon">✏️</button><button class="favorite-list-icon">🗑️</button><button class="reorder-handle">☰</button>
        </div>
      </div>
      <button class="favorite-material-curtain-toggle">▼</button>
      <ul id="scalingFavoriteList"><li class="fav-item-row" style="position:relative;width:355px;height:60px;overflow:hidden">
        <div class="favorite-item-count-curtain expanded"><button class="favorite-item-count-toggle">▶</button>
          <div class="favorite-item-count-controls"><button class="count-btn count-step-unit count-step-decrease" aria-label="1減らす"></button><input class="count-input" type="number" value="999"><button class="count-btn count-step-unit count-step-increase" aria-label="1増やす"></button></div>
        </div>
      </li></ul>
      <div class="checked-favorite-materials-actions visible"><div>拡張機能</div><button>個数指定</button><button>素材リストを表示</button></div>
      <div class="favorite-material-curtain expanded"></div><div class="favorite-material-curtain-actions"><div>拡張機能</div><button>並び替え</button><button>素材リストを表示</button></div>
      <div class="font-size-preview-label">表示例</div>
    `;
    document.body.appendChild(fixture);
  });

  const previewFontSizes = [];
  for (let level = 1; level <= 10; level += 1) {
    await setLevel(level);
    const fixtureAudit = await page.evaluate(() => {
      const root = document.querySelector('#scalingRegressionFixture');
      const selectors = [
        '.favorite-material-help-btn',
        '.history-delete',
        '.favorite-list-curtain.expanded',
        '.favorite-list-curtain-toggle',
        '.favorite-list-icon',
        '.reorder-handle',
        '.favorite-material-curtain-toggle',
        '.favorite-item-count-curtain.expanded',
        '.favorite-item-count-toggle',
        '.favorite-item-count-controls',
        '.favorite-item-count-controls button',
        '.favorite-item-count-controls input',
        '.checked-favorite-materials-actions.visible',
        '.favorite-material-curtain-actions'
      ];
      const failures = [];
      for (const selector of selectors) {
        root.querySelectorAll(selector).forEach(element => {
          const box = element.getBoundingClientRect();
          if (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1) {
            failures.push(`${selector}:overflow`);
          }
          if (element.textContent.trim() && !element.matches('input') && element.children.length === 0) {
            const range = document.createRange();
            range.selectNodeContents(element);
            const text = range.getBoundingClientRect();
            if (
              text.left < box.left - 0.75 ||
              text.right > box.right + 0.75 ||
              text.top < box.top - 0.75 ||
              text.bottom > box.bottom + 0.75
            ) {
              failures.push(`${selector}:text`);
            }
          }
        });
      }
      const summary = root.querySelector('.recipe-method-summary');
      const summaryStyle = getComputedStyle(summary);
      if (parseFloat(summaryStyle.paddingRight) < parseFloat(summaryStyle.fontSize) * 2) {
        failures.push('.recipe-method-summary:padding');
      }
      const markdownArrow = getComputedStyle(root.querySelector('.markdown-content summary'), '::before');
      if (parseFloat(markdownArrow.width) < parseFloat(getComputedStyle(root).fontSize) * 1.3) {
        failures.push('.markdown-content summary::before:width');
      }
      return {
        failures,
        previewFontSize: parseFloat(getComputedStyle(root.querySelector('.font-size-preview-label')).fontSize)
      };
    });
    expect(fixtureAudit.failures, `fixture Level ${level}`).toEqual([]);
    previewFontSizes.push(fixtureAudit.previewFontSize);
  }
  expect(previewFontSizes.at(-1)).toBeGreaterThan(previewFontSizes[0] * 2);
});

test('search history remains aligned and fully usable while a favorite list is displayed', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('ff14_search_history', JSON.stringify(Array.from({ length: 30 }, (_, index) => `履歴${index + 1}`)));
    localStorage.setItem('ff14_favorite_lists_v3', JSON.stringify({
      version: 3,
      selectedListId: 'history-layout-favorite',
      lists: [
        { id: 'SYSTEM_RECENT_ITEMS', name: '検索履歴', itemIds: [], recipeSelections: {} },
        {
          id: 'history-layout-favorite',
          name: '履歴表示確認',
          itemIds: [1602],
          recipeSelections: {},
          equipmentParameterNames: []
        }
      ]
    }));
  });
  await page.goto('/');
  await expect(page.locator('#loadingOverlay')).not.toHaveClass(/open/);
  await page.locator('#favBtn').click();
  await page.locator('#favoriteLists li').filter({ hasText: '履歴表示確認' }).click();
  await expect(page.locator('#favBtn')).toContainText('履歴表示確認');
  if (await page.locator('#confirmOverlay.info.open').isVisible()) {
    await page.locator('#confirmNo').click();
    await expect(page.locator('#confirmOverlay')).not.toHaveClass(/open/);
  }
  await page.locator('#searchBox').click();

  const readLayout = () => page.evaluate(() => {
    const trigger = document.querySelector('#searchBox').getBoundingClientRect();
    const listElement = document.querySelector('#searchHistory');
    const list = listElement.getBoundingClientRect();
    const firstRow = listElement.querySelector('li').getBoundingClientRect();
    const placement = listElement.dataset.placement;
    const gap = placement === 'above'
      ? trigger.top - list.bottom
      : list.top - trigger.bottom;
    return {
      horizontalDifference: Math.max(
        Math.abs(list.left - trigger.left),
        Math.abs(list.right - trigger.right)
      ),
      gapDifference: Math.abs(gap - 3),
      visibleRows: Math.floor(list.height / firstRow.height),
      staysWithinSafeArea: list.top >= 15 && list.bottom <= window.innerHeight - 15
    };
  });

  for (let level = 1; level <= 10; level += 1) {
    await page.locator('html').evaluate((element, value) => {
      element.dataset.fontSizeLevel = String(value);
      window.dispatchEvent(new Event('resize'));
    }, level);
    await expect.poll(async () => (await readLayout()).horizontalDifference).toBeLessThan(1);
    await expect.poll(async () => (await readLayout()).gapDifference).toBeLessThan(2);
    await expect.poll(async () => (await readLayout()).staysWithinSafeArea).toBe(true);
    await expect.poll(async () => (await readLayout()).visibleRows).toBeGreaterThanOrEqual(10);
  }
});
