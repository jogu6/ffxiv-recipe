import { expect, test } from '@playwright/test';

const data = {
  dataVersion: 'e2e-1',
  recipes: [{
    id: 'recipe-a', name: 'テスト完成品', job: '木工師', level: 1,
    difficulty: 10, durability: 40, maxQuality: 0, materialQualityPercent: 0,
    requiredCraftsmanship: 50, requiredControl: 50,
    hqAvailable: false, requiredQuality: 0, expert: false,
    recipeLevel: { jobLevel: 1, progressDivisor: 100, qualityDivisor: 100, progressModifier: 100, qualityModifier: 100 },
    ingredients: [{ id: 'material-a', name: 'テスト中間素材', amount: 2 }]
  }],
  foods: [
    { id: 'food-high-hq', name: '高IL食事', itemLevel: 20, craftLevel: 15, sortOrder: 20, hq: true, effects: { cpPercent: 10, cpCap: 10 } },
    { id: 'food-high-nq', name: '高IL食事', itemLevel: 20, craftLevel: 15, sortOrder: 20, hq: false, effects: { cpPercent: 8, cpCap: 8 } },
    { id: 'food-low-hq', name: '低IL食事', itemLevel: 10, craftLevel: 5, sortOrder: 10, hq: true, effects: { controlPercent: 5, controlCap: 5 } },
    { id: 'food-low-nq', name: '低IL食事', itemLevel: 10, craftLevel: 5, sortOrder: 10, hq: false, effects: { controlPercent: 4, controlCap: 4 } }
  ],
  medicines: [
    { id: 'medicine-high-hq', name: 'テスト薬品', itemLevel: 20, craftLevel: 15, sortOrder: 20, hq: true, effects: { cpPercent: 6, cpCap: 6 } },
    { id: 'medicine-high-nq', name: 'テスト薬品', itemLevel: 20, craftLevel: 15, sortOrder: 20, hq: false, effects: { cpPercent: 5, cpCap: 5 } }
  ]
};

function itemDocumentFromFixture() {
  const items = data.recipes.map(recipe => ({
    Name: recipe.name,
    Recipe: {
      RecipeKey: recipe.id,
      CraftInfo: { job: recipe.job, level: recipe.level },
      CraftingData: {
        Difficulty: recipe.difficulty,
        Durability: recipe.durability,
        MaxQuality: recipe.maxQuality,
        MaterialQualityPercent: recipe.materialQualityPercent,
        RequiredCraftsmanship: recipe.requiredCraftsmanship,
        RequiredControl: recipe.requiredControl,
        HqAvailable: recipe.hqAvailable,
        Expert: recipe.expert,
        RecipeLevel: {
          JobLevel: recipe.recipeLevel.jobLevel,
          ProgressDivisor: recipe.recipeLevel.progressDivisor,
          QualityDivisor: recipe.recipeLevel.qualityDivisor,
          ProgressModifier: recipe.recipeLevel.progressModifier,
          QualityModifier: recipe.recipeLevel.qualityModifier
        }
      },
      Ingredients: recipe.ingredients.map(ingredient => ({ Name: ingredient.name, Amount: String(ingredient.amount) }))
    }
  }));
  for (const ingredient of data.recipes.flatMap(recipe => recipe.ingredients)) {
    items.push({
      Name: ingredient.name,
      Recipe: {
        RecipeKey: `${ingredient.id}-recipe`,
        CraftInfo: { job: '木工師', level: 1 },
        CraftingData: { HqAvailable: true }
      }
    });
  }
  for (const [category, values] of [['調理品', data.foods], ['薬品', data.medicines]]) {
    const grouped = Map.groupBy(values, item => item.name);
    for (const [name, variants] of grouped) {
      const effects = {};
      for (const variant of variants) {
        const mapped = {};
        for (const [key, source] of [['Craftsmanship', 'craftsmanship'], ['Control', 'control'], ['CP', 'cp']]) {
          if (!variant.effects[`${source}Percent`]) continue;
          mapped[key] = {
            Percent: variant.effects[`${source}Percent`], Max: variant.effects[`${source}Cap`]
          };
        }
        effects[variant.hq ? 'HQ' : 'NQ'] = mapped;
      }
      items.push({
        Name: name,
        ItemCategory: category,
        ItemLevel: variants[0].itemLevel,
        SortOrder: variants[0].sortOrder,
        Recipe: {
          RecipeKey: `${variants[0].id}-recipe`,
          CraftInfo: {
            job: category === '調理品' ? '調理師' : '錬金術師',
            level: variants[0].craftLevel
          },
          Ingredients: []
        },
        CraftingEffects: effects
      });
    }
  }
  return { Version: '7.55', DataGeneration: data.dataVersion, Items: items };
}

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.title.includes('スーパージュラルミン受入条件')
    || testInfo.title.includes('コートリーラヴァー受入条件')
    || testInfo.title.includes('フィルバートブラシ受入条件')) return;
  await page.route('**/site/data/Item.json', route => route.fulfill({ json: itemDocumentFromFixture() }));
});

test('独立画面でステータスを直接編集しオフライン生成まで完結する', async ({ page, context }) => {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      value: undefined,
      configurable: true
    });
    let idleCallback = null;
    globalThis.requestIdleCallback = callback => {
      idleCallback = callback;
      return 1;
    };
    globalThis.cancelIdleCallback = () => { idleCallback = null; };
    globalThis.__runMacroIdleCleanup = () => {
      const callback = idleCallback;
      idleCallback = null;
      callback?.({ didTimeout: false, timeRemaining: () => 50 });
    };
  });
  await page.setViewportSize({ width: 600, height: 800 });
  await page.goto('/macro-app/web/index.html?recipe=recipe-a');

  await expect(page.locator('#recipeInfo')).toContainText('テスト完成品');
  await expect(page.locator('#recipeInfo .recipe-name .hq-mark')).toHaveCount(0);
  const recipeText = await page.locator('#recipeInfo').innerText();
  expect(recipeText.indexOf('工数 10')).toBeLessThan(recipeText.indexOf('品質 0'));
  expect(recipeText.indexOf('品質 0')).toBeLessThan(recipeText.indexOf('耐久 40'));
  await expect(page.locator('#recipeInfo .recipe-requirements .badge')).toHaveText([
    '必要作業精度 50',
    '必要加工精度 50'
  ]);
  await expect(page.locator('#statusDialog')).toHaveCount(0);
  await page.locator('#generateButton').click();
  await expect(page.locator('#statusWarningOverlay')).toBeVisible();
  await expect(page.locator('#statusWarningButton')).toBeFocused();
  await page.locator('#statusWarningButton').click();
  await expect(page.locator('#statusWarningOverlay')).toBeHidden();
  await expect(page.locator('#level')).toBeFocused();
  const statusToggle = page.locator('#crafterStatusSection .accordion-toggle');
  await expect(statusToggle).toHaveAttribute('aria-expanded', 'true');
  expect(await statusToggle.evaluate(element => getComputedStyle(element, '::before').content)).toContain('▼');
  const sectionOrder = await page.locator('#macroContent > section').evaluateAll(sections =>
    sections.map(section => section.id || section.querySelector('h2,.accordion-toggle')?.textContent.trim())
  );
  expect(sectionOrder.indexOf('crafterStatusSection')).toBeGreaterThan(sectionOrder.indexOf('中間素材'));
  expect(sectionOrder.indexOf('crafterStatusSection')).toBeLessThan(sectionOrder.indexOf('食事リスト'));
  await expect(page.locator('#jobToggle')).toContainText('木工師');
  await expect(page.locator('#jobToggle .job-icon')).toBeVisible();
  await page.locator('#jobToggle').click();
  await expect(page.locator('#jobChoices')).toHaveClass(/open/);
  await expect(page.locator('#jobChoices [role="option"]')).toHaveCount(8);
  await expect(page.locator('#jobChoices [role="option"] .job-icon')).toHaveCount(8);
  await page.locator('#jobChoices [data-job="木工師"]').click();
  await page.locator('#level').fill('999');
  await expect(page.locator('#level')).toHaveValue('15');
  await page.locator('#level').fill('1');
  await page.locator('#craftsmanship').fill('100');
  await page.locator('#control').fill('100');
  await page.locator('#cp').fill('10');
  await expect(page.locator('#level')).toHaveCSS('text-align', 'center');
  await expect(page.locator('#manipulation')).toHaveCSS('appearance', 'none');
  await page.locator('#manipulation').click();
  await expect(page.locator('#manipulation')).toBeChecked();
  await page.locator('#heartAndSoul').check();
  await page.locator('#quickInnovation').check();
  await expect(page.locator('#heartAndSoul')).toBeChecked();
  await expect(page.locator('#quickInnovation')).toBeChecked();
  expect(await page.locator('#manipulation').evaluate(element => getComputedStyle(element, '::after').content)).toContain('✓');
  await statusToggle.click();
  await expect(statusToggle).toHaveAttribute('aria-expanded', 'false');
  expect(await statusToggle.evaluate(element => getComputedStyle(element, '::before').content)).toContain('▶');

  await expect(page.locator('#ingredientList')).toContainText('テスト中間素材');
  const hqChoice = page.getByRole('button', { name: 'テスト中間素材はすべてHQ' });
  const nqChoice = page.getByRole('button', { name: 'テスト中間素材はNQ' });
  await expect(hqChoice.locator('.hq-mark')).toHaveAttribute('alt', 'HQ');
  const cornerAlpha = await hqChoice.locator('.hq-mark').evaluate(async image => {
    if (!image.complete) await new Promise(resolve => image.addEventListener('load', resolve, { once: true }));
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, 1, 1).data[3];
  });
  expect(cornerAlpha).toBe(0);
  await expect(hqChoice).toHaveAttribute('aria-pressed', 'false');
  await expect(nqChoice).toHaveAttribute('aria-pressed', 'true');
  await hqChoice.click();
  await expect(hqChoice).toHaveAttribute('aria-pressed', 'true');
  await expect(nqChoice).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#foodList .choice').nth(0)).toHaveText('使用しない');
  await expect(page.getByRole('button', { name: '食事リスト' })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#foodCurrent')).toHaveText('使用しない');
  await page.getByRole('button', { name: '食事リスト' }).click();
  await expect(page.locator('#foodList .choice').nth(1)).toContainText('高IL食事');
  await expect(page.locator('#foodList .choice').nth(1)).toContainText('製作Lv. 15');
  await expect(page.locator('#foodList .choice').nth(1).locator('.hq-mark')).toHaveAttribute('alt', 'HQ');
  const hqSize = await page.locator('#foodList .choice').nth(1).locator('strong').evaluate(element => ({
    fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
    markHeight: element.querySelector('.hq-mark').getBoundingClientRect().height
  }));
  expect(Math.abs(hqSize.fontSize - hqSize.markHeight)).toBeLessThanOrEqual(1);
  await expect(page.locator('#foodList .choice').nth(2)).toHaveText(/高IL食事/);
  await expect(page.locator('#foodList .choice').nth(2)).not.toContainText('NQ');
  await page.locator('#foodList .choice').nth(1).click();
  await expect(page.locator('#foodCurrent')).toContainText('高IL食事');
  await expect(page.locator('#foodCurrent .hq-mark')).toHaveAttribute('alt', 'HQ');
  await expect(page.getByRole('button', { name: '食事リスト' })).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: '薬品リスト' }).click();
  await page.locator('#medicineList .choice').nth(1).click();
  await expect(page.locator('#medicineCurrent')).toContainText('テスト薬品');
  await expect(page.getByRole('button', { name: '薬品リスト' })).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(() => page.locator('.generation-note').evaluate(element =>
    [...element.childNodes].map(node => node.nodeName === 'BR' ? '\n' : node.textContent).join('')
  )).toBe([
    'デバイスの性能により、生成時間は大きく左右され、3 分以上かかる場合もあります。',
    'Android、iOS、iPadOSでは、OS の管理により、他のアプリが休止・終了する場合があります。',
    'マクロ生成中は、デバイスに画面が消灯しないよう要求しますが、ブラウザーや OS の制限により、消灯を防げない場合があります。',
    '画面消灯やアプリ切り替えで計算が一時停止した場合、ページが保持されていれば復帰後に計算を続行します。',
    'ページが破棄または再読み込みされた場合、計算結果は失われます。'
  ].join('\n'));
  await page.reload();
  await expect(page.getByRole('button', { name: 'テスト中間素材はすべてHQ' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#foodCurrent')).toContainText('高IL食事');
  await expect(page.locator('#heartAndSoul')).toBeChecked();
  await expect(page.locator('#quickInnovation')).toBeChecked();
  await page.getByRole('button', { name: '食事リスト' }).click();
  await expect(page.locator('#foodCurrent')).toBeVisible();
  await expect(page.locator('#generateButton')).toBeEnabled();
  await expect(page.locator('.macro-header')).toHaveCount(0);
  await page.setViewportSize({ width: 600, height: 400 });
  await page.locator('#macroContent').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => page.locator('#macroContent').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await page.locator('#macroContent').evaluate(element => { element.scrollTop = 0; });
  await expect.poll(() => page.locator('#macroContent').evaluate(element => element.scrollTop)).toBe(0);
  await page.setViewportSize({ width: 600, height: 800 });

  await context.setOffline(true);
  await page.evaluate(() => {
    const timing = { completedAt: 0, hiddenAt: 0 };
    globalThis.__macroCompletionTiming = timing;
    const percent = document.querySelector('#progressPercent');
    const overlay = document.querySelector('#progressOverlay');
    new MutationObserver(() => {
      if (percent.textContent === '100%' && !timing.completedAt) timing.completedAt = performance.now();
    }).observe(percent, { childList: true, characterData: true, subtree: true });
    new MutationObserver(() => {
      if (overlay.hidden && timing.completedAt && !timing.hiddenAt) timing.hiddenAt = performance.now();
    }).observe(overlay, { attributes: true, attributeFilter: ['hidden'] });
  });
  await page.locator('#generateButton').click();
  await expect(page.locator('#macroSection')).toBeVisible({ timeout: 600_000 });
  await expect.poll(() => page.locator('#macroContent').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect(page.locator('#generateButton')).toBeDisabled();
  await expect(page.locator('#macroOutput')).toHaveValue('/ac "作業" <wait.3>');
  await expect(page.locator('#copyMacroButton')).toHaveAttribute('aria-label', 'マクロをコピー');
  await expect(page.locator('#copyMacroButton svg')).toHaveCount(1);
  await page.locator('#macroOutput').focus();
  await page.keyboard.press('Control+A');
  await expect.poll(() => page.locator('#macroOutput').evaluate(element =>
    element.selectionStart === 0 &&
    element.selectionEnd === element.value.length
  )).toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async text => { globalThis.__copiedMacro = text; } }
    });
  });
  await page.locator('#copyMacroButton').click();
  await expect.poll(() => page.evaluate(() => globalThis.__copiedMacro)).toBe('/ac "作業" <wait.3>');
  await expect(page.locator('#copyMacroButton')).toHaveAttribute('aria-label', 'コピー済み');
  await expect(page.locator('#copyMacroButton')).toContainText('コピー済み');
  await expect(page.locator('#copyMacroButton .macro-copy-success')).toBeVisible();
  await page.evaluate(() => globalThis.__runMacroIdleCleanup());
  await expect(page.locator('#generateButton')).toBeEnabled();
  await expect.poll(() => page.evaluate(() => {
    const timing = globalThis.__macroCompletionTiming;
    return timing.hiddenAt - timing.completedAt;
  })).toBeGreaterThanOrEqual(190);
  await expect(page.locator('#generatedStatusSection')).toBeVisible();
  await expect(page.locator('#generatedStatus')).toContainText('基礎ステータス');
  await expect(page.locator('#generatedAt')).toHaveText(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/);
});

test('スーパージュラルミン受入条件で31アクションのHQ保証マクロを生成する', async ({ page }) => {
  test.setTimeout(600_000);
  await page.addInitScript(() => {
    const counters = { requests: 0, releases: 0 };
    Object.defineProperty(globalThis, '__wakeLockCounters', { value: counters });
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        async request() {
          counters.requests += 1;
          const sentinel = new EventTarget();
          sentinel.released = false;
          sentinel.release = async () => {
            if (sentinel.released) return;
            sentinel.released = true;
            counters.releases += 1;
            sentinel.dispatchEvent(new Event('release'));
          };
          return sentinel;
        }
      }
    });
  });
  await page.goto('/macro-app/web/index.html?recipe=153a4e41ea4');
  expect(await page.evaluate(() => globalThis.crossOriginIsolated)).toBe(true);
  await expect.poll(() => page.evaluate(() => Boolean(globalThis.__xivcaMacroRuntime)), {
    timeout: 30_000
  }).toBe(true);
  const runtime = await page.evaluate(() => globalThis.__xivcaMacroRuntime);
  expect(runtime.threadCount, runtime.threadError).toBeGreaterThan(1);
  await expect(page.locator('#recipeInfo')).toContainText('スーパージュラルミンインゴット');
  await expect(page.locator('#ingredientList')).toHaveText('中間素材はありません');
  await page.locator('#level').fill('100');
  await page.locator('#craftsmanship').fill('5635');
  await page.locator('#control').fill('5379');
  await page.locator('#cp').fill('649');
  await page.locator('#manipulation').check();
  await page.getByRole('button', { name: '食事リスト' }).click();
  await page.locator('#foodList .choice').filter({ hasText: 'アリペブレ' }).filter({ has: page.locator('.hq-mark') }).click();
  await page.getByRole('button', { name: '薬品リスト' }).click();
  await page.locator('#medicineList .choice').filter({ hasText: '魔匠の薬液' }).filter({ has: page.locator('.hq-mark') }).click();

  await page.locator('#generateButton').click();
  await expect(page.locator('#progressOverlay h2')).toHaveText('マクロ生成中');
  await expect(page.locator('#elapsedTime')).toHaveText(/^\d{2}:\d{2}$/);
  await expect(page.locator('#macroSection')).toBeVisible({ timeout: 600_000 });
  const lines = (await page.locator('#macroOutput').inputValue()).trim().split('\n');
  expect(lines).toHaveLength(31);
  expect(lines[0]).toBe('/ac "真価" <wait.3>');
  expect(lines.at(-1)).toBe('/ac "模範作業" <wait.3>');
  await expect.poll(() => page.evaluate(() => globalThis.__wakeLockCounters)).toEqual({ requests: 1, releases: 1 });
});

test('コートリーラヴァー受入条件で全中間素材HQを反映して26アクションを生成する', async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto('/macro-app/web/index.html?recipe=a9ef06ce9fa');
  await expect(page.locator('#recipeInfo')).toContainText('コートリーラヴァー・ディフェンダーサーコート');
  await page.locator('#level').fill('100');
  await page.locator('#craftsmanship').fill('5635');
  await page.locator('#control').fill('5379');
  await page.locator('#cp').fill('649');
  await page.locator('#manipulation').check();

  const hqChoices = page.locator('#ingredientList .hq-quality-choice[aria-label$="すべてHQ"]');
  await expect(hqChoices).toHaveCount(4);
  for (let index = 0; index < 4; index += 1) await hqChoices.nth(index).click();
  await expect(page.locator('#foodCurrent')).toHaveText('使用しない');
  await expect(page.locator('#medicineCurrent')).toHaveText('使用しない');

  await page.locator('#generateButton').click();
  await expect(page.locator('#macroSection')).toBeVisible({ timeout: 600_000 });
  const lines = (await page.locator('#macroOutput').inputValue()).trim().split('\n');
  expect(lines).toHaveLength(26);
  expect(lines[0]).toBe('/ac "真価" <wait.3>');
  expect(lines.at(-1)).toBe('/ac "模範作業" <wait.3>');
});

test('フィルバートブラシ受入条件でRaphaelと同じ25アクションを生成する', async ({ page }) => {
  test.setTimeout(0);
  await page.goto('/macro-app/web/index.html?recipe=f86e48825e8');
  await expect.poll(() => page.evaluate(() => Boolean(globalThis.__xivcaMacroRuntime)), {
    timeout: 30_000
  }).toBe(true);
  console.log(JSON.stringify(await page.evaluate(() => globalThis.__xivcaMacroRuntime)));
  await expect(page.locator('#recipeInfo')).toContainText('コートリーラヴァー・フィルバートブラシ');
  await page.locator('#level').fill('100');
  await page.locator('#craftsmanship').fill('5655');
  await page.locator('#control').fill('5399');
  await page.locator('#cp').fill('664');
  await page.locator('#manipulation').check();
  const hqChoices = page.locator('#ingredientList .hq-quality-choice[aria-label$="すべてHQ"]');
  await expect(hqChoices).toHaveCount(4);
  for (let index = 0; index < 4; index += 1) await hqChoices.nth(index).click();
  await page.locator('#generateButton').click();
  let lastWorkUnits = -1;
  while (await page.locator('#macroSection').isHidden()) {
    const engine = await page.evaluate(() => globalThis.__xivcaMacroEngineStatus);
    if (engine?.workUnits !== lastWorkUnits) {
      lastWorkUnits = engine?.workUnits ?? -1;
      console.log(JSON.stringify({
        stage: engine?.stage,
        workUnits: engine?.workUnits,
        generatedNodes: engine?.telemetry?.searchGeneratedNodes,
        queuedNodes: engine?.telemetry?.searchQueuedNodes,
        threadCount: engine?.threadCount,
        lastAdvanceAt: engine?.lastAdvanceAt
      }));
    }
    await page.waitForTimeout(1_000);
  }
  expect(lastWorkUnits).toBeGreaterThan(0);
  const lines = (await page.locator('#macroOutput').inputValue()).trim().split('\n');
  expect(lines).toHaveLength(25);
  expect(lines).toEqual([
    '/ac "真価" <wait.3>', '/ac "ヴェネレーション" <wait.2>', '/ac "下地作業" <wait.3>',
    '/ac "倹約作業" <wait.3>', '/ac "下地作業" <wait.3>', '/ac "精密作業" <wait.3>',
    '/ac "パーフェクトメンド" <wait.3>', '/ac "精密作業" <wait.3>', '/ac "イノベーション" <wait.2>',
    '/ac "加工" <wait.3>', '/ac "中級加工" <wait.3>', '/ac "上級加工" <wait.3>',
    '/ac "下地加工" <wait.3>', '/ac "パーフェクトメンド" <wait.3>', '/ac "イノベーション" <wait.2>',
    '/ac "加工" <wait.3>', '/ac "中級加工" <wait.3>', '/ac "上級加工" <wait.3>',
    '/ac "ビエルゴの祝福" <wait.3>', '/ac "匠の絶技" <wait.3>', '/ac "ヴェネレーション" <wait.2>',
    '/ac "下地作業" <wait.3>', '/ac "下地作業" <wait.3>', '/ac "倹約作業" <wait.3>',
    '/ac "模範作業" <wait.3>'
  ]);
});

test('スマホ・タブレット相当でも共有WASMを端末性能に応じたスレッド数で初期化する', async ({ browser }) => {
  for (const device of [
    { name: 'smartphone', width: 390, height: 844, logicalProcessors: 4, expectedThreads: 2 },
    { name: 'tablet', width: 820, height: 1180, logicalProcessors: 8, expectedThreads: 4 }
  ]) {
    const context = await browser.newContext({ viewport: { width: device.width, height: device.height } });
    await context.addInitScript(logicalProcessors => {
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        configurable: true,
        value: logicalProcessors
      });
    }, device.logicalProcessors);
    const page = await context.newPage();
    await page.goto('/macro-app/web/index.html?recipe=f86e48825e8');
    await expect.poll(() => page.evaluate(() => globalThis.__xivcaMacroRuntime), {
      timeout: 30_000
    }).toMatchObject({ threadCount: device.expectedThreads, threadError: '' });
    expect(await page.evaluate(() => globalThis.crossOriginIsolated), device.name).toBe(true);
    await context.close();
  }
});
