const { expect, test } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

async function openPipelineGui(page) {
  await page.setViewportSize({ width: 1040, height: 720 });
  await page.route('**/__pipeline-gui/index.html', route => {
    route.fulfill({
      contentType: 'text/html',
      body: fs.readFileSync(path.resolve('pipeline/gui/index.html'), 'utf8')
    });
  });
  await page.route('**/__pipeline-gui/main.js', route => {
    route.fulfill({
      contentType: 'text/javascript',
      body: fs.readFileSync(path.resolve('pipeline/gui/main.js'), 'utf8')
    });
  });
  await page.route('**/__pipeline-gui/styles.css', route => {
    route.fulfill({
      contentType: 'text/css',
      body: fs.readFileSync(path.resolve('pipeline/gui/styles.css'), 'utf8')
    });
  });
  await page.route('**/__pipeline-gui/assets/favicon.png', route => {
    route.fulfill({
      contentType: 'image/png',
      body: fs.readFileSync(path.resolve('pipeline/gui/assets/favicon.png'))
    });
  });

  await page.addInitScript(() => {
    window.__pipelineGuiTest = { invokes: [], listeners: {} };
    window.__TAURI__ = {
      core: {
        invoke: async (command, payload = {}) => {
          window.__pipelineGuiTest.invokes.push({ command, payload });
          if (command === 'read_update_state') return {};
          if (command === 'read_quality_preview_state') return { available: false };
          if (window.__pipelineGuiTest.holdIcons && command === 'run_pipeline_command' && payload.command === 'icons') {
            return new Promise(resolve => {
              window.__pipelineGuiTest.resolveLongRun = () => resolve('icons ok');
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
        getCurrentWindow: () => ({
          setMinSize: async () => {},
          setSize: async () => {},
          onResized: async () => {}
        }),
        LogicalSize: function LogicalSize(width, height) {
          this.width = width;
          this.height = height;
        }
      }
    };
  });

  await page.goto('/__pipeline-gui/index.html');
  await expect(page.locator('#statusText')).toHaveText('待機中');
  await expect(page).toHaveTitle('FF14レシピ素材ツリー アイテム情報作成');
  await expect(page.locator('.action-item[data-step="publish"]')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => Boolean(window.__pipelineGuiTest.listeners['pipeline-output']))).toBe(true);
}

async function invokes(page) {
  return page.evaluate(() => window.__pipelineGuiTest.invokes);
}

test('pipeline GUI shows operation descriptions without test-only buttons', async ({ page }) => {
  await openPipelineGui(page);

  await expect(page.locator('.action-item', { hasText: '全実行' })).toContainText('CSV検証、候補生成、公開反映、アイコン生成');
  await expect(page.locator('.action-item[data-step="publish"]')).toContainText('比較に通った候補で site/data/Item.json を置き換えます。');
  await expect(page.locator('.log-panel')).toBeVisible();
  await expect(page.locator('.side-panel #resumeBtn')).toHaveCount(0);
  await expect(page.locator('.side-panel #cancelBtn')).toHaveCount(0);
  await expect(page.locator('#progressActions')).toBeHidden();
  await expect(page.locator('#csvBody')).toBeVisible();
  await expect(page.locator('#buildBody')).toBeHidden();
  await expect(page.locator('#iconQualityBody')).toBeHidden();
  await page.locator('#iconQualityToggle').click();
  await expect(page.locator('#csvBody')).toBeHidden();
  await expect(page.locator('#iconQualityBody')).toBeVisible();
  await page.locator('#buildToggle').click();
  await expect(page.locator('#iconQualityBody')).toBeHidden();
  await expect(page.locator('#buildBody')).toBeVisible();
  await expect(page.locator('#steps')).toHaveCount(0);
  await expect(page.locator('button', { hasText: '簡易テスト' })).toHaveCount(0);
});

test('pipeline GUI confirms long operations before invoking Tauri', async ({ page }) => {
  await openPipelineGui(page);

  await page.locator('#buildToggle').click();
  await page.locator('#buildBtn').click();
  await expect(page.locator('#confirmOverlay')).toHaveClass(/open/);
  await page.locator('#confirmCancelBtn').click();
  expect(await invokes(page)).toEqual([
    { command: 'read_update_state', payload: {} },
    { command: 'read_quality_preview_state', payload: {} }
  ]);

  await page.locator('#buildBtn').click();
  await page.locator('#confirmOkBtn').click();
  await expect(page.locator('.action-item[data-step="build"] .action-status')).toHaveText('✓ 完了');
  expect(await invokes(page)).toContainEqual({
    command: 'run_pipeline_command',
    payload: { command: 'build', args: [] }
  });
});

test('pipeline GUI runs the recommended sequence with WebP quality', async ({ page }) => {
  await openPipelineGui(page);

  await page.locator('#buildToggle').click();
  await page.locator('#qualityInput').fill('70');
  await page.locator('#qualityInput').blur();
  await page.locator('#runBtn').click();
  await page.locator('#confirmOkBtn').click();

  await expect(page.locator('#progressPercent')).toHaveText('100%');
  const runCalls = (await invokes(page)).filter(call => call.command === 'run_pipeline_command');
  expect(runCalls.map(call => call.payload)).toEqual([
    { command: 'validate-csv', args: [] },
    { command: 'build', args: [] },
    { command: 'publish', args: [] },
    { command: 'icons', args: ['--quality', '70'] }
  ]);
});

test('pipeline GUI can request cancellation of a running command', async ({ page }) => {
  await openPipelineGui(page);
  await page.evaluate(() => {
    window.__pipelineGuiTest.holdIcons = true;
  });

  await page.locator('#buildToggle').click();
  await page.locator('#iconsBtn').click();
  await page.locator('#confirmOkBtn').click();
  await expect(page.locator('#progressActions')).toBeVisible();
  await expect(page.locator('#cancelBtn')).toBeEnabled();
  await page.evaluate(() => window.__pipelineGuiTest.listeners['pipeline-output']({ payload: 'icons 1/4 smoke' }));
  await expect(page.locator('#log')).toContainText('icons 1/4 smoke');
  await page.locator('#cancelBtn').click();
  await expect(page.locator('#statusText')).toHaveText('中断中');

  await page.evaluate(() => window.__pipelineGuiTest.resolveLongRun());
  await expect(page.locator('.action-item[data-step="icons"] .action-status')).toHaveText('✓ 完了');
  expect(await invokes(page)).toContainEqual({ command: 'cancel_pipeline_command', payload: {} });
});
