const { expect, test } = require('@playwright/test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

test.describe.configure({ mode: 'parallel' });

const uiDefinition = JSON.parse(execFileSync(process.execPath, [path.resolve('pipeline/tool/pipeline-ui-definition.mjs')], { encoding: 'utf8' }));

async function openPipelineGui(page, definition = uiDefinition) {
  await page.setViewportSize({ width: 1040, height: 720 });
  for (const [url, file, contentType] of [
    ['**/__pipeline-gui/index.html', 'pipeline/gui/index.html', 'text/html'],
    ['**/__pipeline-gui/main.js', 'pipeline/gui/main.js', 'text/javascript'],
    ['**/__pipeline-gui/styles.css', 'pipeline/gui/styles.css', 'text/css'],
  ]) {
    await page.route(url, route => route.fulfill({ contentType, body: fs.readFileSync(path.resolve(file), 'utf8') }));
  }
  await page.route('**/__pipeline-gui/assets/favicon.png', route => route.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.resolve('pipeline/gui/assets/favicon.png')) }));
  await page.addInitScript(definition => {
    window.__pipelineGuiTest = { invokes: [], listeners: {}, held: false };
    window.__TAURI__ = {
      core: {
        invoke: async (command, payload = {}) => {
          window.__pipelineGuiTest.invokes.push({ command, payload });
          if (command === 'read_pipeline_ui_definition') return definition;
          if (command === 'read_quality_preview') return [{
            iconName: 'テスト画像', pngFile: 'data:image/png;base64,AA==', pngSize: 100,
            pngWidth: 80, pngHeight: 80, category: '素材', background: 'dark',
            variants: [{ quality: 75, file: 'data:image/webp;base64,AA==', size: 50, selected: true }]
          }];
          if (command === 'run_pipeline_command' && window.__pipelineGuiTest.failCommandOnce === payload.command) {
            window.__pipelineGuiTest.failCommandOnce = '';
            throw new Error(`${payload.command} failed once`);
          }
          if (command === 'run_pipeline_command' && window.__pipelineGuiTest.holdCommand === payload.command) {
            return new Promise((resolve, reject) => {
              window.__pipelineGuiTest.finishHeld = value => value instanceof Error ? reject(value.message) : resolve(value || 'ok');
            });
          }
          return `${payload.command || command} ok`;
        }
      },
      event: {
        listen: async (event, callback) => {
          window.__pipelineGuiTest.listeners[event] = callback;
          return () => {};
        }
      },
      window: {
        getCurrentWindow: () => ({ setMinSize: async () => {}, setSize: async () => {}, onResized: async () => {} }),
        LogicalSize: function LogicalSize(width, height) { this.width = width; this.height = height; }
      }
    };
  }, definition);
  await page.goto('/__pipeline-gui/index.html');
  await expect(page.locator('#statusText')).toHaveText('待機中');
  await expect.poll(() => page.evaluate(() => Boolean(window.__pipelineGuiTest.listeners['pipeline-output']))).toBe(true);
}

async function invokes(page, command = null) {
  const values = await page.evaluate(() => window.__pipelineGuiTest.invokes);
  return command ? values.filter(value => value.command === command) : values;
}

test('GUI creates only declared settings, accordions, and actions', async ({ page }) => {
  await openPipelineGui(page);
  await expect(page.locator('[data-setting-id="lodestone-delay"] input')).toHaveValue('100');
  await expect(page.locator('[data-setting-id="webp-quality"] input')).toHaveValue('80');
  await expect(page.locator('[data-setting-id="icon-size"] input')).toHaveValue('80');
  await expect(page.locator('.action-item')).toHaveCount(6);
  await expect(page.getByRole('button', { name: '最新Item.jsonを一括生成' })).toBeVisible();
  await expect(page.getByText('Oxidizer')).toHaveCount(0);
  await expect(page.locator('.section-toggle')).toHaveCount(2);
  await expect(page.locator('.section-toggle').first()).toHaveAttribute('aria-expanded', 'true');
});

test('image settings drive a generated preview shown inside the GUI', async ({ page }) => {
  await openPipelineGui(page);
  await page.locator('[data-setting-id="webp-quality"] input').fill('75');
  await page.locator('[data-setting-id="icon-size"] input').fill('96');
  await page.getByRole('button', { name: '画像設定をプレビュー' }).click();
  await page.locator('#confirmOkBtn').click();
  await expect(page.locator('#previewOverlay')).toHaveClass(/open/);
  await expect(page.locator('#previewContent')).toContainText('q75（設定値）');
  const call = (await invokes(page, 'run_pipeline_command')).at(-1);
  expect(call.payload).toEqual({ command: 'tmp-quality-preview', args: ['--delay', '100', '--quality', '75', '--size', '96'] });
});

test('logs keep every line and follow only while the user is at the bottom', async ({ page }) => {
  await openPipelineGui(page);
  await page.evaluate(() => {
    for (let index = 1; index <= 200; index += 1) {
      window.__pipelineGuiTest.listeners['pipeline-output']({ payload: `ログ ${index}` });
    }
  });
  await expect(page.locator('.log-line')).toHaveCount(200, { timeout: 2500 });
  const log = page.locator('#log');
  await log.evaluate(node => { node.scrollTop = 0; });
  await page.waitForTimeout(1100);
  await page.evaluate(() => window.__pipelineGuiTest.listeners['pipeline-output']({ payload: '上位置を維持' }));
  await expect(page.locator('.log-line')).toHaveCount(201);
  expect(await log.evaluate(node => node.scrollTop)).toBe(0);
  await log.evaluate(node => { node.scrollTop = node.scrollHeight; });
  await page.waitForTimeout(1100);
  await page.evaluate(() => window.__pipelineGuiTest.listeners['pipeline-output']({ payload: '末尾へ追従' }));
  await expect(page.locator('.log-line')).toHaveCount(202);
  expect(await log.evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight)).toBeLessThanOrEqual(4);
});

test('accordions open independently with state marks and persistence', async ({ page }) => {
  await openPipelineGui(page);
  const first = page.locator('.section-toggle').first();
  const second = page.locator('.section-toggle').nth(1);
  await first.click();
  await expect(first).toHaveAttribute('aria-expanded', 'false');
  await expect(first.locator('.section-toggle-mark')).toHaveText('▶');
  await expect(second).toHaveAttribute('aria-expanded', 'true');
  await page.reload();
  await expect(first).toHaveAttribute('aria-expanded', 'false');
  await expect(second).toHaveAttribute('aria-expanded', 'true');
});

test('valid settings persist and invalid settings disable only dependent actions', async ({ page }) => {
  await openPipelineGui(page);
  const delay = page.locator('[data-setting-id="lodestone-delay"] input');
  await delay.fill('350');
  await expect(page.getByRole('button', { name: '1. Lodestone完全監査' })).toBeEnabled();
  await delay.fill('10');
  await expect(page.getByRole('button', { name: '1. Lodestone完全監査' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '4. Item.json公開反映' })).toBeEnabled();
  await page.reload();
  await expect(delay).toHaveValue('350');
});

test('one click runs all four autonomous Item.json commands with declared values', async ({ page }) => {
  await openPipelineGui(page);
  await page.locator('[data-setting-id="lodestone-delay"] input').fill('300');
  await page.getByRole('button', { name: '最新Item.jsonを一括生成' }).click();
  await page.locator('#confirmOkBtn').click();
  await expect(page.locator('#progressPercent')).toHaveText('100%');
  await expect(page.locator('#etaText')).toContainText('0:00');
  const calls = await invokes(page, 'run_pipeline_command');
  expect(calls.map(call => call.payload)).toEqual([
    { command: 'lodestone-audit', args: ['--delay', '300'] },
    { command: 'build-lodestone-candidate', args: ['--delay', '300'] },
    { command: 'lodestone-candidate-icons', args: ['--delay', '300', '--quality', '80', '--size', '80'] },
    { command: 'publish-lodestone-candidate', args: [] },
  ]);
});

test('resume skips completed audit and continues from the failed downstream step', async ({ page }) => {
  await openPipelineGui(page);
  await page.evaluate(() => { window.__pipelineGuiTest.failCommandOnce = 'build-lodestone-candidate'; });
  await page.getByRole('button', { name: '最新Item.jsonを一括生成' }).click();
  await page.locator('#confirmOkBtn').click();
  await expect(page.locator('#statusText')).toHaveText('失敗');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ffxiv-pipeline-interrupted-run-v2')));
  expect(saved.completedStepIds).toEqual(['lodestone-audit']);
  expect(saved.currentStepId).toBe('build-lodestone-candidate');

  await page.locator('#resumeBtn').click();
  await page.locator('#confirmOkBtn').click();
  await expect(page.locator('#progressPercent')).toHaveText('100%');
  const calls = await invokes(page, 'run_pipeline_command');
  expect(calls.map(call => call.payload.command)).toEqual([
    'lodestone-audit',
    'build-lodestone-candidate',
    'build-lodestone-candidate',
    'lodestone-candidate-icons',
    'publish-lodestone-candidate',
  ]);
});

test('running locks settings and all actions while preserving common progress, cancel, and log layout', async ({ page }) => {
  await openPipelineGui(page);
  await page.evaluate(() => { window.__pipelineGuiTest.holdCommand = 'lodestone-candidate-icons'; });
  await page.getByRole('button', { name: '3. 画像整備・生成' }).click();
  await expect(page.locator('#cancelBtn')).toBeVisible();
  await expect(page.locator('[data-setting-id="webp-quality"] input')).toBeDisabled();
  await expect(page.locator('.action-item button').first()).toBeDisabled();
  await expect(page.locator('.progress-area')).toBeVisible();
  await expect(page.locator('.log-panel')).toBeVisible();
  await page.evaluate(() => window.__pipelineGuiTest.listeners['pipeline-output']({ payload: '候補画像 1/4 smoke' }));
  await expect(page.locator('#progressPercent')).toHaveText('25%');
  await page.locator('#cancelBtn').click();
  expect(await invokes(page, 'cancel_pipeline_command')).toHaveLength(1);
  await page.evaluate(() => window.__pipelineGuiTest.finishHeld(new Error('中断要求により停止しました')));
  await expect(page.locator('#statusText')).toHaveText('中断');
  await expect(page.locator('#resumeBtn')).toBeVisible();
});

test('high-frequency progress is throttled but completion forces 100 percent', async ({ page }) => {
  await openPipelineGui(page);
  await page.evaluate(() => { window.__pipelineGuiTest.holdCommand = 'lodestone-audit'; });
  await page.getByRole('button', { name: '1. Lodestone完全監査' }).click();
  await page.locator('#confirmOkBtn').click();
  await page.evaluate(() => {
    for (let index = 1; index <= 30; index += 1) {
      window.__pipelineGuiTest.listeners['pipeline-output']({ payload: `レシピ詳細 ${index}/30` });
    }
  });
  await page.evaluate(() => window.__pipelineGuiTest.finishHeld('done'));
  await expect(page.locator('#progressPercent')).toHaveText('100%');
});
