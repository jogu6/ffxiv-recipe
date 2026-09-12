const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { openApp, searchFor } = require('./helpers/app.js');
const bravePath = 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe';
if (fs.existsSync(bravePath)) test.use({ launchOptions: { executablePath: bravePath } });

const crafter = {
  level: 100, craftsmanship: 5655, control: 5399, cp: 664,
  manipulation: true, heartAndSoul: false, quickInnovation: false
};

const itemDocument = JSON.parse(fs.readFileSync(path.join(__dirname, '../site/data/Item.json'), 'utf8'));
const savedResult = {
  recipeId: 'b5cc569f3e4',
  dataVersion: `${itemDocument.Version}:${itemDocument.DataGeneration}`,
  engineVersion: '0.0.0', crafter,
  selection: { foodId: 'ロネークステーキ:hq', medicineId: null, hqIngredientIds: ['高山食塩', 'ペリラオイル'] },
  generatedAt: '2026-09-09T10:20:30.000Z',
  macro: '/ac "確信" <wait.3>\n/ac "下地作業" <wait.3>'
};

async function restoreSavedMacro(page, result = savedResult) {
  await page.addInitScript(result => {
    localStorage.setItem('xivca.macro.crafter-status.v1', JSON.stringify({ 調理師: result.crafter }));
    localStorage.setItem(`xivca.macro.result.v1.${result.recipeId}`, JSON.stringify(result));
  }, result);
  await page.goto('/macro-app/web/index.html?siteRoot=../..&recipe=b5cc569f3e4');
  await expect(page.locator('#macroOutput')).toHaveValue(result.macro);
}

for (const width of [390, 1280]) {
  test(`マクロ行番号を枠外で折り返しと表示倍率に合わせる（幅${width}）`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    const macro = Array.from({ length: 16 }, () => '/ac "コンテンツアクション2" <wait.2>').join('\n');
    await restoreSavedMacro(page, { ...savedResult, macro });
    const numbers = page.locator('#macroLineNumbers > div');
    await expect(numbers).toHaveText(Array.from({ length: 16 }, (_, index) => String(index + 1)));
    await expect(page.locator('#macroLineNumbers')).toHaveAttribute('aria-hidden', 'true');
    for (const level of [1, 5, 10]) {
      await page.evaluate(level => document.documentElement.setAttribute('data-font-size-level', String(level)), level);
      await expect.poll(() => page.evaluate(() => {
        const output = document.querySelector('#macroOutput');
        const gutter = document.querySelector('#macroLineNumbers');
        const rect = output.getBoundingClientRect();
        const style = getComputedStyle(output);
        const first = gutter.firstElementChild.getBoundingClientRect();
        const last = gutter.lastElementChild.getBoundingClientRect();
        return {
          outside: gutter.getBoundingClientRect().right < rect.left,
          aligned: Math.abs(first.top - rect.top - parseFloat(style.paddingTop) - parseFloat(style.borderTopWidth)) < 1,
          fits: last.bottom <= rect.bottom - parseFloat(style.paddingBottom) + 1,
          noClipping: output.scrollHeight <= output.clientHeight + 1,
          noOverflow: document.querySelector('#macroContent').scrollWidth <= document.querySelector('#macroContent').clientWidth,
        };
      })).toEqual({ outside: true, aligned: true, fits: true, noClipping: true, noOverflow: true });
      await expect(page.locator('#macroOutput')).toHaveValue(macro);
    }
    await page.evaluate(() => {
      const content = document.querySelector('#macroContent');
      content.scrollTop += document.querySelector('#macroSection').getBoundingClientRect().top - content.getBoundingClientRect().top;
    });
    await page.screenshot({ path: testInfo.outputPath('macro-line-numbers.png') });
  });
}

test('分離ヘッダーなしでもマクロWASMを準備できる', async ({ page }) => {
  await page.route('**/*', async route => {
    if (!route.request().isNavigationRequest()) return route.continue();
    const response = await route.fetch();
    const headers = { ...response.headers() };
    delete headers['cross-origin-embedder-policy'];
    delete headers['cross-origin-opener-policy'];
    await route.fulfill({ response, headers });
  });
  await restoreSavedMacro(page);
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);
  const result = await page.evaluate(async () => {
    const worker = new Worker('./solver-worker.js', { type: 'module' });
    let timeout;
    try {
      return await new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('WASM preparation timed out')), 15000);
        worker.addEventListener('error', event => reject(new Error(event.message)));
        worker.addEventListener('message', event => {
          if (event.data.type === 'error') reject(new Error(event.data.message));
          if (event.data.type === 'ready') resolve(event.data);
        });
        worker.postMessage({ type: 'prepare', requestId: 'non-isolated-wasm' });
      });
    } finally {
      clearTimeout(timeout);
      worker.terminate();
    }
  });
  expect(result.threadCount).toBe(1);
  expect(result.threadError).toBe('');
});

for (const outcome of ['success', 'failure', 'error', 'cancel']) {
  test(`マクロ欄を生成結果に応じて開閉する（${outcome}）`, async ({ page }) => {
    await page.addInitScript(outcome => {
      window.Worker = class extends EventTarget {
        postMessage(message) {
          const send = data => queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', {
            data: { requestId: message.requestId, ...data }
          })));
          if (message.type === 'prepare') send({ type: 'ready', threadCount: 1 });
          else if (outcome === 'success') send({ type: 'search-result', result: { actions: ['basicSynthesis'], duration: 3 } });
          else if (outcome === 'failure') send({ type: 'search-result', result: { actions: null } });
          else if (outcome === 'error') send({ type: 'error', message: '試験用エラー' });
        }
        terminate() {}
      };
    }, outcome);
    await restoreSavedMacro(page);
    const toggle = page.locator('#macroSection .accordion-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    if (outcome === 'success') await toggle.click();
    await page.locator('#generateButton').click();
    if (outcome === 'cancel') await page.locator('#cancelButton').click();
    await expect(page.locator('#progressOverlay')).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', outcome === 'success' ? 'true' : 'false');
    if (outcome === 'success') await expect(page.locator('#macroLineNumbers > div')).toHaveText(['1']);
    if (outcome !== 'success') {
      await expect.poll(() => page.locator('#macroSection .accordion-clip').evaluate(el => el.getBoundingClientRect().height)).toBe(0);
    }
  });
}

test('必要作業精度と必要加工精度が不足していれば理由を表示して探索を開始しない', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('xivca.macro.crafter-status.v1', JSON.stringify({
    調理師: { level: 100, craftsmanship: 5000, control: 4500, cp: 664,
      manipulation: true, heartAndSoul: false, quickInnovation: false }
  })));
  await page.goto('/macro-app/web/index.html?siteRoot=../..&recipe=b5cc569f3e4');
  await expect(page.locator('#generateButton')).toBeEnabled({ timeout: 30000 });
  await page.locator('#generateButton').click();
  await expect(page.locator('#generationMessage')).toContainText('作業精度が不足しています（現在 5000 / 必要 5380）');
  await expect(page.locator('#generationMessage')).toContainText('加工精度が不足しています（現在 4500 / 必要 4650）');
  await expect(page.locator('#progressOverlay')).toBeHidden();
  expect(await page.evaluate(() => globalThis.__xivcaMacroEngineStatus?.running === true)).toBe(false);
});

test('保存済みマクロの生成日時と当時の製作ステータスをエンジン準備失敗時も表示する', async ({ page }, testInfo) => {
  await page.route('**/solver-worker.js', route => route.abort());
  await restoreSavedMacro(page);
  await expect(page.locator('#macroSection .accordion-toggle')).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#macroSection .accordion-toggle').click();
  await expect.poll(() => page.locator('#macroSection .accordion-clip').evaluate(el => el.getBoundingClientRect().height)).toBe(0);
  await page.locator('#macroSection .accordion-toggle').click();
  await expect(page.locator('#macroOutput')).toBeVisible();
  await expect(page.locator('#generatedAt')).toHaveText('2026/09/09 19:20:30');
  const section = page.locator('#generatedStatusSection');
  await expect(section).toBeVisible();
  await expect(section.locator('.accordion-toggle')).toHaveText('前回のマクロ生成日時とクラフターステータス');
  await expect(section.locator('.accordion-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#generatedAt')).toBeVisible();
  await expect.poll(() => section.locator('.accordion-clip').evaluate(el => el.getBoundingClientRect().height)).toBe(0);
  await section.locator('.accordion-toggle').click();
  await expect(section.locator('.accordion-toggle')).toHaveAttribute('aria-expanded', 'true');
  for (const text of ['調理師', 'マニピュレーション：あり', '一心不乱：なし',
    'クイックイノベーション：なし', '食事：ロネークステーキ', '薬品：使用しない',
    '加工精度 5496 / CP 756', '高山食塩', 'ペリラオイル']) {
    await expect(section).toContainText(text);
  }
  await expect(section.locator('img.hq-mark[alt="HQ"]')).toHaveCount(3);
  await expect(section.locator('.generated-status-grid dd')).toHaveText(['100', '5655', '5399', '664']);
  for (const width of [390, 900]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await section.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    if (width === 390) await section.screenshot({ path: testInfo.outputPath('generated-status-mobile.png') });
  }
  await section.locator('.accordion-toggle').click();
  await expect(section.locator('.accordion-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#generatedAt')).toBeVisible();
  await section.locator('.accordion-toggle').click();
  await expect(section.locator('.accordion-toggle')).toHaveAttribute('aria-expanded', 'true');
  await page.reload();
  await expect(section).toBeVisible();
  await expect(page.locator('#generatedAt')).toHaveText('2026/09/09 19:20:30');
  await page.locator('#crafterStatusSection .accordion-toggle').click();
  await page.locator('#cp').fill('665');
  await expect(section).toBeHidden();
  await expect(page.locator('#generatedAtSection')).toBeHidden();
  await page.locator('#cp').fill('664');
  await expect(section).toBeVisible();
  await expect(section.locator('img.hq-mark[alt="HQ"]')).toHaveCount(3);
  await expect(section.locator('.generated-status-grid dd')).toHaveText(['100', '5655', '5399', '664']);
});

for (const mode of ['通常', 'APIなし', 'API拒否']) {
  test(`マクロコピーで表示欄を全選択せず全文をコピーする（${mode}）`, async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await restoreSavedMacro(page);
    await expect(page.locator('#macroLineNumbers > div')).toHaveText(['1', '2']);
    await page.evaluate(mode => {
      globalThis.__readClipboard = navigator.clipboard.readText.bind(navigator.clipboard);
      if (mode !== '通常') Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: mode === 'APIなし' ? undefined : { writeText: async () => { throw new Error('denied'); } }
      });
      document.querySelector('#macroOutput').setSelectionRange(3, 7);
    }, mode);
    await page.locator('#copyMacroButton').click();
    await expect(page.locator('#copyMacroButton')).toHaveAttribute('aria-label', 'コピー済み');
    const copied = await page.evaluate(() => globalThis.__readClipboard());
    expect(copied.replaceAll('\r\n', '\n')).toBe(savedResult.macro);
    expect(await page.locator('#macroOutput').evaluate(element => [element.selectionStart, element.selectionEnd])).toEqual([3, 7]);
    await expect(page.locator('#copyMacroButton')).toBeFocused();
    await expect(page.locator('.macro-copy-buffer')).toHaveCount(0);
  });
}

async function generateAripebre({ page, context }, { lan = false } = {}) {
  test.setTimeout(600_000);
  if (lan) {
    await context.route('http://192.0.2.1:4173/**', async route => {
      const url = new URL(route.request().url());
      const root = path.resolve(__dirname, '../site');
      const file = path.resolve(root, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
      if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file)) {
        await route.fulfill({ status: 404, body: '' });
        return;
      }
      const contentType = {
        '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
        '.json': 'application/json', '.wasm': 'application/wasm', '.webp': 'image/webp',
        '.png': 'image/png', '.svg': 'image/svg+xml'
      }[path.extname(file)] || 'application/octet-stream';
      await route.fulfill({ path: file, contentType, headers: {
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Resource-Policy': 'same-origin'
      } });
    });
  }
  await page.addInitScript(status => {
    localStorage.setItem('xivca.macro.crafter-status.v1', JSON.stringify({ 調理師: status }));
  }, crafter);
  if (lan) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('http://192.0.2.1:4173/');
    await expect(page.locator('#loadingOverlay')).not.toHaveClass(/open/, { timeout: 30_000 });
  } else await openApp(page, 1400, 900);
  await searchFor(page, 'アリペブレ');
  await page.locator('#recipeList').getByText('アリペブレ', { exact: true }).first().click();
  await page.locator('.result-root-summary .macro-launch-btn').click();
  const macroFrame = page.frameLocator('#macroFrame');
  await expect(macroFrame.locator('#recipeInfo')).toContainText('アリペブレ');
  await macroFrame.getByRole('button', { name: '食事リスト' }).click();
  await macroFrame.locator('#foodList .choice[data-id="ロネークステーキ:hq"]').click();
  const hqChoices = macroFrame.locator('#ingredientList .hq-quality-choice[aria-label$="すべてHQ"]');
  await expect(hqChoices).toHaveCount(2);
  for (const button of await hqChoices.all()) await button.click();
  await expect(macroFrame.locator('#medicineCurrent')).toHaveText('使用しない');
  console.log(JSON.stringify(await macroFrame.locator('body').evaluate(() => ({
    secureContext: globalThis.isSecureContext, isolated: globalThis.crossOriginIsolated,
    userAgent: navigator.userAgent, runtime: globalThis.__xivcaMacroRuntime
  }))));
  await expect(macroFrame.locator('#generateButton')).toBeEnabled({ timeout: 30_000 });
  await context.setOffline(true);
  const startedAt = Date.now();
  await macroFrame.locator('#generateButton').click();
  let previousStage = '';
  let sawProgress = false;
  let maximumNodes = 0;
  while (await macroFrame.locator('#macroSection').isHidden()) {
    const status = await macroFrame.locator('body').evaluate(() => ({
      runtime: globalThis.__xivcaMacroRuntime,
      stage: globalThis.__xivcaMacroEngineStatus?.stage,
      nodes: globalThis.__xivcaMacroEngineStatus?.workUnits,
      percent: document.querySelector('#progressPercent').textContent,
      error: document.querySelector('#generationMessage').textContent
    }));
    expect(status.error).toBe('');
    if (status.stage !== previousStage) console.log(JSON.stringify(status));
    previousStage = status.stage;
    maximumNodes = Math.max(maximumNodes, status.nodes || 0);
    if (!sawProgress && status.nodes > 0) {
      await expect(page.locator('#macroGenerationStatus')).toContainText('件確認');
      sawProgress = true;
    }
    await page.waitForTimeout(1000);
  }
  const macro = await macroFrame.locator('#macroOutput').inputValue();
  console.log(JSON.stringify({ durationMs: Date.now() - startedAt, maximumNodes, actions: macro.trim().split('\n').length, lan }));
  expect(sawProgress).toBe(true);
  expect(macro.trim().split('\n')).toHaveLength(20);
  const profile = await macroFrame.locator('body').evaluate(() => globalThis.__xivcaMacroProfile);
  expect(profile.status).toBe('completed');
  expect(profile.samples.at(-1).stage).toBe('complete');
  expect(profile.samples.at(-1).wasmSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(profile.samples.at(-1).wasmMemoryBytes).toBeGreaterThan(0);
  expect(profile.samples.at(-1).replayMs).toBeGreaterThan(0);
  expect(profile.samples.at(-1).paretoMs).toBeGreaterThan(0);
  for (const sample of profile.samples.filter(s => s.searchNodes > 0)) {
    expect(sample.searchGeneratedNodes).toBe(sample.searchQueuedNodes + sample.searchPoppedNodes + sample.searchDroppedNodes);
    expect(sample.searchNodes).toBe(sample.searchPoppedNodes - sample.searchParetoRejectedNodes);
  }
  const reports = path.resolve(__dirname, '../pipeline/reports/macro-profiles');
  fs.mkdirSync(reports, { recursive: true });
  const profileFile = path.join(reports, `aripebre-${lan ? 'lan' : 'localhost'}.json`);
  fs.writeFileSync(profileFile, JSON.stringify(profile, null, 2));
  console.log(JSON.stringify({ profileFile, samples: profile.samples.length, final: profile.samples.at(-1) }));
  await expect(page.locator('#macroProgressOverlay')).toBeHidden();
  await expect(macroFrame.locator('#generatedStatus')).toContainText('加工精度 5496 / CP 756');
  const generatedAt = await macroFrame.locator('#generatedAt').textContent();
  await context.setOffline(false);
  await page.reload();
  await expect(macroFrame.locator('#generatedAt')).toHaveText(generatedAt, { timeout: 30_000 });
  await expect(macroFrame.locator('#generatedStatus')).toContainText('マニピュレーション：あり');
}

test('アプリ内でアリペブレをロネークステーキHQと全中間素材HQでオフライン生成する', async ({ page, context }) => {
  await generateAripebre({ page, context });
});

test.describe('BraveのLAN HTTP接続', () => {
  test.skip(!fs.existsSync(bravePath), 'Braveがインストールされている環境で検証する');
  test('LAN HTTPでもアリペブレの探索を完了し保存結果を復元する', async ({ page, context }) => {
    await generateAripebre({ page, context }, { lan: true });
  });
});
