const { expect, test } = require('@playwright/test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

test.describe.configure({ mode: 'parallel' });

const uiDefinition = JSON.parse(
  execFileSync(process.execPath, [path.resolve('pipeline/tool/pipeline-ui-definition.mjs')], { encoding: 'utf8' })
);

async function openPipelineGui(page, definition = uiDefinition) {
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

  await page.addInitScript(definition => {
    window.__pipelineGuiTest = {
      invokes: [],
      listeners: {},
      oxidizerPreflight: false,
      workflow: {
        inputAvailable: true,
        import: { status: 'none', sourceMatchesInput: false, previewDifferenceCount: 0, preflightComplete: false },
        stages: {
          build: { complete: false },
          lodestone: { complete: false, enabled: false },
          icons: { complete: false, enabled: false, quality: null, size: null },
          publish: { complete: false, enabled: false }
        },
        next: 'build'
      }
    };
    window.__TAURI__ = {
      core: {
        invoke: async (command, payload = {}) => {
          window.__pipelineGuiTest.invokes.push({ command, payload });
          if (command === 'read_pipeline_ui_definition') return definition;
          if (command === 'read_pipeline_workflow_status') return structuredClone(window.__pipelineGuiTest.workflow);
          if (command === 'read_update_state') return {};
          if (command === 'read_quality_preview_state') return { available: false };
          if (command === 'read_equipment_role_summary') return { selected: 0, unselected: 0, total: 0 };
          if (command === 'read_publication_review') return [];
          if (command === 'read_oxidizer_import_preview') {
            const report = {
              status: 'previewed',
              currentCount: 10,
              candidateCount: 11,
              addedCount: 1,
              removedCount: 0,
              changedCount: 1,
              added: [{ ID: '20', Name: '追加品' }],
              removed: [],
              changed: [{
                ID: '10',
                Name: '変更品',
                Fields: [{ field: 'Price', before: 100, after: 120 }]
              }]
            };
            if (window.__pipelineGuiTest.oxidizerPreflight) {
              report.lodestonePreflight = {
                verified: 2,
                notFound: 0,
                dataFailed: 0,
                iconFailed: 0,
                results: [
                  {
                    ID: '20',
                    status: 'verified',
                    info: { shopSales: 0, craftInfo: 1, equipmentInfo: false, isEx: false }
                  },
                  {
                    ID: '10',
                    status: 'verified',
                    info: { shopSales: 1, craftInfo: 0, equipmentInfo: false, isEx: false }
                  }
                ]
              };
            }
            return report;
          }
          if (command === 'select_directory') return 'C:\\selected-folder';
          if (window.__pipelineGuiTest.holdIcons && command === 'run_pipeline_command' && payload.command === 'lodestone-candidate-icons') {
            return new Promise(resolve => {
              window.__pipelineGuiTest.resolveLongRun = () => resolve('lodestone-candidate-icons ok');
            });
          }
          if (command === 'run_pipeline_command' && payload.command === 'oxidizer-lodestone-preview') {
            window.__pipelineGuiTest.oxidizerPreflight = true;
          }
          if (command === 'run_pipeline_command' && payload.command === 'oxidizer-import') {
            window.__pipelineGuiTest.workflow.import = {
              status: 'current',
              sourceMatchesInput: true,
              previewDifferenceCount: 0,
              preflightComplete: true
            };
          }
          if (command === 'run_pipeline_command' && payload.command === 'build') {
            window.__pipelineGuiTest.workflow.stages.build = { complete: true };
            window.__pipelineGuiTest.workflow.stages.lodestone = { complete: false, enabled: true };
            window.__pipelineGuiTest.workflow.next = 'publish-lodestone-info';
          }
          if (command === 'run_pipeline_command' && payload.command === 'publish-lodestone-info') {
            window.__pipelineGuiTest.workflow.stages.lodestone = { complete: true, enabled: true };
            window.__pipelineGuiTest.workflow.stages.icons = { complete: false, enabled: true, quality: null, size: null };
            window.__pipelineGuiTest.workflow.next = 'icons';
          }
          if (command === 'run_pipeline_command' && payload.command === 'icons') {
            const qualityIndex = payload.args.indexOf('--quality');
            const sizeIndex = payload.args.indexOf('--size');
            window.__pipelineGuiTest.workflow.stages.icons = {
              complete: true,
              enabled: true,
              quality: Number(payload.args[qualityIndex + 1]),
              size: Number(payload.args[sizeIndex + 1])
            };
            window.__pipelineGuiTest.workflow.stages.publish = { complete: false, enabled: true };
            window.__pipelineGuiTest.workflow.next = 'publish';
          }
          if (command === 'run_pipeline_command' && payload.command === 'publish') {
            window.__pipelineGuiTest.workflow.stages.publish = { complete: true, enabled: true };
            window.__pipelineGuiTest.workflow.next = 'complete';
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
  }, definition);

  await page.goto('/__pipeline-gui/index.html');
  await expect(page.locator('#statusText')).toHaveText('待機中');
  await expect(page).toHaveTitle('FinalFantasy XIV® Crafting Assistant XIVca(シヴカ) アイテム情報作成');
  await expect(page.locator('.action-item[data-step="publish-lodestone-candidate"]')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => Boolean(window.__pipelineGuiTest.listeners['pipeline-output']))).toBe(true);
}

async function invokes(page) {
  return page.evaluate(() => window.__pipelineGuiTest.invokes);
}

test('pipeline GUI renders action names and descriptions from the mjs definition', async ({ page }) => {
  const definition = structuredClone(uiDefinition);
  const publish = definition.actions.find(action => action.command === 'publish-lodestone-candidate');
  publish.label = '定義からの公開';
  publish.description = 'mjs定義を起動時に反映します。';
  await openPipelineGui(page, definition);

  await expect(page.locator('#publishLodestoneCandidateBtn')).toHaveText('定義からの公開');
  await expect(page.locator('.action-item[data-step="publish-lodestone-candidate"]')).toContainText('mjs定義を起動時に反映します。');
});

test('pipeline GUI keeps known operations available with a newer UI definition', async ({ page }) => {
  const definition = structuredClone(uiDefinition);
  definition.actions.unshift({
    id: 'future-action',
    section: 'data',
    command: 'future-action',
    buttonId: 'futureActionBtn',
    order: '将来',
    label: '将来の操作',
    description: '現在のexeには未搭載です。',
    behavior: 'command',
    args: []
  });
  definition.recommendedSequence.unshift('future-action');
  await openPipelineGui(page, definition);

  await expect(page.locator('#lodestoneSnapshotBtn')).toBeEnabled();
  await expect(page.locator('#log')).toContainText('互換モード: このexeに未搭載の操作を無視しました: 将来の操作');
});

test('pipeline GUI shows operation descriptions without test-only buttons', async ({ page }) => {
  await openPipelineGui(page);

  await expect(page.locator('.action-item', { hasText: '公開工程を続行' })).toContainText('Lodestone一覧取得から名前キーの公開反映');
  await expect(page.locator('.action-item[data-step="publish-lodestone-candidate"]')).toContainText('旧ID互換JSON');
  await expect(page.locator('.log-panel')).toBeVisible();
  await expect(page.locator('.side-panel #resumeBtn')).toHaveCount(0);
  await expect(page.locator('.side-panel #cancelBtn')).toHaveCount(0);
  await expect(page.locator('#progressActions')).toBeHidden();
  await expect(page.locator('#csvBody')).toBeVisible();
  await expect(page.locator('#buildBody')).toBeHidden();
  await expect(page.locator('#iconQualityBody')).toBeHidden();
  await expect(page.locator('#buildToggle')).toBeHidden();
  await expect(page.locator('#iconQualityToggle')).toBeHidden();
  await expect(page.locator('#steps')).toHaveCount(0);
  await expect(page.locator('button', { hasText: '簡易テスト' })).toHaveCount(0);
});

test('pipeline GUI confirms long operations before invoking Tauri', async ({ page }) => {
  await openPipelineGui(page);

  await page.locator('#lodestoneSnapshotBtn').click();
  await expect(page.locator('#confirmOverlay')).toHaveClass(/open/);
  await page.locator('#confirmCancelBtn').click();
  expect(await invokes(page)).toEqual([
    { command: 'read_pipeline_ui_definition', payload: {} },
    { command: 'read_pipeline_workflow_status', payload: {} },
    { command: 'read_update_state', payload: {} },
    { command: 'read_quality_preview_state', payload: {} },
    { command: 'read_equipment_role_summary', payload: {} }
  ]);

  await page.locator('#lodestoneSnapshotBtn').click();
  await page.locator('#confirmOkBtn').click();
  await expect(page.locator('.action-item[data-step="lodestone-snapshot"] .action-status')).toHaveText('✓ 完了');
  expect(await invokes(page)).toContainEqual({
    command: 'run_pipeline_command',
    payload: { command: 'lodestone-snapshot', args: ['--delay', '100'] }
  });
});

test('pipeline GUI keeps obsolete CSV and Oxidizer operations unavailable', async ({ page }) => {
  await openPipelineGui(page);
  for (const id of ['oxidizerEnvironmentBtn', 'downloadCsvBtn', 'validateCsvBtn', 'buildBtn', 'iconsBtn']) {
    await expect(page.locator(`#${id}`)).toBeHidden();
  }
});

test('pipeline GUI runs the recommended sequence with WebP quality', async ({ page }) => {
  await openPipelineGui(page);

  await page.locator('#runBtn').click();
  await page.locator('#confirmOkBtn').click();

  await expect(page.locator('#progressPercent')).toHaveText('100%');
  const runCalls = (await invokes(page)).filter(call => call.command === 'run_pipeline_command');
  expect(runCalls.map(call => call.payload)).toEqual([
    { command: 'lodestone-snapshot', args: ['--delay', '100'] },
    { command: 'build-lodestone-candidate', args: [] },
    { command: 'lodestone-candidate-icons', args: ['--delay', '100', '--quality', '80', '--size', '80'] },
    { command: 'publish-lodestone-candidate', args: [] }
  ]);
});

test('pipeline GUI exposes a configurable 100ms sequential access interval', async ({ page }) => {
  await openPipelineGui(page);
  await expect(page.locator('#lodestoneDelayInput')).toHaveValue('100');
  await page.locator('#lodestoneDelayInput').fill('350');
  await page.locator('#lodestoneDelayInput').blur();
  await page.locator('#lodestoneSnapshotBtn').click();
  await page.locator('#confirmOkBtn').click();
  const runCalls = (await invokes(page)).filter(call => call.command === 'run_pipeline_command');
  expect(runCalls.at(-1).payload).toEqual({
    command: 'lodestone-snapshot',
    args: ['--delay', '350']
  });
});

test('pipeline GUI surfaces cache version updates', async ({ page }) => {
  await openPipelineGui(page);

  await page.evaluate(() => window.__pipelineGuiTest.listeners['pipeline-output']({
    payload: 'データキャッシュ版を更新しました ff14recipe-data-7.50-deadbeef (icons)'
  }));

  await expect(page.locator('#statusText')).toHaveText('キャッシュ版更新済み');
  await expect(page.locator('#progressDetail')).toHaveText('キャッシュ版更新済み: ff14recipe-data-7.50-deadbeef (icons)');
  await expect(page.locator('#log')).toContainText('データキャッシュ版を更新しました ff14recipe-data-7.50-deadbeef (icons)');
});

test('pipeline GUI can request cancellation of a running command', async ({ page }) => {
  await openPipelineGui(page);
  await page.evaluate(() => {
    window.__pipelineGuiTest.holdIcons = true;
  });

  await page.locator('#lodestoneCandidateIconsBtn').click();
  await expect(page.locator('#progressActions')).toBeVisible();
  await expect(page.locator('#cancelBtn')).toBeEnabled();
  await page.evaluate(() => window.__pipelineGuiTest.listeners['pipeline-output']({ payload: '候補画像 1/4 smoke' }));
  await expect(page.locator('#log')).toContainText('候補画像 1/4 smoke');
  await page.locator('#cancelBtn').click();
  await expect(page.locator('#statusText')).toHaveText('中断中');

  await page.evaluate(() => window.__pipelineGuiTest.resolveLongRun());
  await expect(page.locator('.action-item[data-step="lodestone-candidate-icons"] .action-status')).toHaveText('○ 中断済み');
  expect(await invokes(page)).toContainEqual({ command: 'cancel_pipeline_command', payload: {} });
});
