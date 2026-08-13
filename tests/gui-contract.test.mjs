import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { getPipelineUiDefinition, validatePipelineUiDefinition } from '../pipeline/tool/pipeline-ui-definition.mjs';

const guiSource = fs.readFileSync('pipeline/gui/main.js', 'utf8');
const guiHtml = fs.readFileSync('pipeline/gui/index.html', 'utf8');
const rustSource = fs.readFileSync('src-tauri/src/main.rs', 'utf8');
const pipelineSource = fs.readFileSync('pipeline/tool/pipeline-tool.mjs', 'utf8');
const uiDefinition = getPipelineUiDefinition();
const moduleDefinition = uiDefinition.modules[0];

test('GUI Tauri invokes are registered by Rust', () => {
  const invokedCommands = new Set([...guiSource.matchAll(/invoke\((?:command|['"]([^'"]+)['"])/g)].map(match => match[1]).filter(Boolean));
  const handlerMatch = rustSource.match(/generate_handler!\[([^\]]+)\]/s);
  assert.ok(handlerMatch);
  const registered = new Set(handlerMatch[1].split(',').map(value => value.trim()).filter(Boolean));
  for (const command of invokedCommands) {
    assert.match(rustSource, new RegExp(`fn\\s+${command}\\b`));
    assert.ok(registered.has(command), `${command} is not registered`);
  }
});

test('GUI renders settings and actions from the validated mjs definition', () => {
  assert.deepEqual(validatePipelineUiDefinition(uiDefinition), []);
  assert.match(guiSource, /renderSettingNode/);
  assert.match(guiSource, /renderActions/);
  assert.match(guiSource, /read_pipeline_ui_definition/);
  assert.equal(guiHtml.includes('lodestoneDelayInput'), false);
  assert.equal(guiHtml.includes('oxidizerEnvironmentBtn'), false);
  assert.match(guiHtml, /id="settingsRoot"/);
  assert.match(guiHtml, /id="actionsRoot"/);
});

test('GUI exposes autonomous Lodestone and image publication actions', () => {
  assert.deepEqual(moduleDefinition.actions.map(action => action.id), [
    'lodestone-audit',
    'build-lodestone-candidate',
    'item-icon-cache',
    'lodestone-candidate-icons',
    'publish-lodestone-candidate',
    'item-icon-preview',
    'item-icon-pack',
    'share-code-plaza-icons',
    'item-icon-validate',
    'app-cache-version',
    'generate-item-json'
  ]);
  assert.equal(moduleDefinition.actions.some(action => action.id.includes('oxidizer')), false);
  assert.match(rustSource, /latest\.log/);
});

test('GUI one-click publication includes local cache, plaza sync, and final pack validation', () => {
  const complete = moduleDefinition.actions.find(action => action.id === 'generate-item-json');
  assert.deepEqual(complete.sequence, [
    'lodestone-audit',
    'build-lodestone-candidate',
    'item-icon-cache',
    'lodestone-candidate-icons',
    'publish-lodestone-candidate',
    'share-code-plaza-icons',
    'item-icon-validate'
  ]);
});

test('GUI publication refreshes the app cache version after final data files', () => {
  const updateFunction = pipelineSource.match(/function updateDataCacheVersion[\s\S]*?\n}\n\nexport function buildPublicItemIconPack/)?.[0] || '';
  const serviceWorkerUpdate = updateFunction.indexOf('updateServiceWorkerDataCacheVersion(version)');
  const appDataUpdate = updateFunction.indexOf('updateAppDataCacheVersion(version)');
  const appCacheUpdate = updateFunction.indexOf('updateAppCacheVersion({ siteRoot, serviceWorkerPath })');
  assert.ok(serviceWorkerUpdate >= 0);
  assert.ok(appDataUpdate > serviceWorkerUpdate);
  assert.ok(appCacheUpdate > appDataUpdate);
});

test('progress, cancel, and log remain common fixed GUI chrome', () => {
  assert.match(guiHtml, /class="progress-area"/);
  assert.match(guiHtml, /id="cancelBtn"/);
  assert.match(guiHtml, /class="log-panel"/);
  assert.equal(moduleDefinition.settings.some(setting => setting.id === 'progress'), false);
});

test('log rendering preserves manual scroll position without discarding lines', () => {
  assert.match(guiSource, /const wasAtBottom =/);
  assert.match(guiSource, /if \(wasAtBottom\) elements\.log\.scrollTop/);
  assert.equal(/remove(?:Child|\(\))/.test(guiSource.match(/function flushLogs[\s\S]*?\n}/)?.[0] || ''), false);
  assert.match(guiSource, /LOG_FLUSH_INTERVAL_MS/);
});

test('image settings expose an mjs-driven in-GUI preview', () => {
  const action = moduleDefinition.actions.find(candidate => candidate.id === 'item-icon-preview');
  assert.deepEqual(action.settingIds, ['lodestone-delay', 'webp-quality', 'icon-size']);
  assert.equal(action.resultView.type, 'quality-preview');
  assert.match(guiHtml, /id="previewOverlay"/);
  assert.match(guiSource, /read_quality_preview/);
});

test('cancellation requests a safe pipeline boundary without taskkill', () => {
  const command = rustSource.match(/fn cancel_pipeline_command[\s\S]*?\n}/)?.[0] || '';
  assert.match(command, /write_cancel_request/);
  assert.equal(command.includes('stop_pipeline_process'), false);
  assert.match(pipelineSource, /assertNotCancelled\(\)/);
});

test('new recipe details are cached before Item.json candidate generation', () => {
  const refresh = pipelineSource.match(/export async function refreshLodestoneSourceSnapshot[\s\S]*?\n}\n\nexport function extractLodestoneCraftInfo/)?.[0] || '';
  assert.match(refresh, /cacheLodestoneRecipeDetails\(recipes\.entries/);
  assert.match(refresh, /レシピ詳細/);
});

test('persistent run logs use JST timestamps', () => {
  assert.match(rustSource, /fn jst_timestamp/);
  assert.match(rustSource, /\+09:00/);
  assert.match(rustSource, /format!\("\[\{}\] \[\{}\]/);
});

test('Windows release exe and child node process do not open console windows', () => {
  assert.match(rustSource, /windows_subsystem\s*=\s*"windows"/);
  assert.match(rustSource, /CREATE_NO_WINDOW/);
  assert.match(rustSource, /creation_flags\(CREATE_NO_WINDOW\)/);
});

test('GUI close requests pipeline cancellation', () => {
  assert.match(rustSource, /CloseRequested/);
  assert.match(rustSource, /stop_pipeline_process/);
});
