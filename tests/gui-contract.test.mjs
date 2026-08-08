import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  getPipelineUiDefinition,
  validatePipelineUiDefinition
} from '../pipeline/tool/pipeline-ui-definition.mjs';

const guiSource = fs.readFileSync('pipeline/gui/main.js', 'utf8');
const guiHtml = fs.readFileSync('pipeline/gui/index.html', 'utf8');
const rustSource = fs.readFileSync('src-tauri/src/main.rs', 'utf8');
const pipelineSource = fs.readFileSync('pipeline/tool/pipeline-tool.mjs', 'utf8');
const uiDefinition = getPipelineUiDefinition();

test('GUI Tauri invokes are registered by Rust', () => {
  const invokedCommands = new Set(
    [...guiSource.matchAll(/invoke\('([^']+)'/g)].map(match => match[1])
  );
  const handlerMatch = rustSource.match(/generate_handler!\[([^\]]+)\]/s);

  assert.ok(handlerMatch, 'Tauri generate_handler registration was not found');
  const registeredCommands = new Set(
    handlerMatch[1]
      .split(',')
      .map(command => command.trim())
      .filter(Boolean)
  );

  for (const command of invokedCommands) {
    assert.match(rustSource, new RegExp(`fn\\s+${command}\\b`));
    assert.ok(registeredCommands.has(command), `${command} is invoked but not registered`);
  }
});

test('GUI uses the in-app floating confirmation modal', () => {
  assert.equal(guiSource.includes('window.confirm'), false);
  assert.match(guiSource, /confirmOverlay/);
});

test('GUI exposes only the Lodestone name-key publication actions and persistent logs', () => {
  for (const command of [
    'lodestone-snapshot',
    'build-lodestone-candidate',
    'lodestone-candidate-icons',
    'publish-lodestone-candidate'
  ]) {
    assert.ok(uiDefinition.actions.some(action => action.command === command), `missing GUI action: ${command}`);
  }
  assert.deepEqual(uiDefinition.actions.map(action => action.id), [
    'lodestone-snapshot',
    'build-lodestone-candidate',
    'lodestone-candidate-icons',
    'publish-lodestone-candidate',
    'run-all'
  ]);
  assert.match(guiHtml, /id="lodestoneDelayInput"[^>]*value="100"/);
  assert.match(rustSource, /latest\.log/);
  assert.match(rustSource, /fn\s+read_pipeline_workflow_status\b/);
  assert.match(rustSource, /append_run_log/);
});

test('GUI preview does not start a local web server', () => {
  assert.equal(guiSource.includes('start_preview_server'), false);
  assert.equal(guiSource.includes('stop_preview_server'), false);
  assert.equal(rustSource.includes('start_preview_server'), false);
  assert.equal(rustSource.includes('stop_preview_server'), false);
});

test('GUI full run uses only the Lodestone name-key publication sequence', () => {
  assert.deepEqual(uiDefinition.recommendedSequence, [
    'lodestone-snapshot',
    'build-lodestone-candidate',
    'lodestone-candidate-icons',
    'publish-lodestone-candidate'
  ]);
});

test('pipeline mjs is the valid source of GUI actions and copy', () => {
  assert.deepEqual(validatePipelineUiDefinition(uiDefinition), []);
  assert.match(guiSource, /read_pipeline_ui_definition/);
  assert.match(rustSource, /fn\s+read_pipeline_ui_definition\b/);
  assert.equal(guiHtml.includes('候補データを site/data/Item.json に統合します。'), false);
  assert.equal(guiHtml.includes('CSV検証、データ生成、アイコン生成'), false);
  assert.equal(uiDefinition.actions.find(action => action.command === 'publish-lodestone-candidate').buttonId, 'publishLodestoneCandidateBtn');
});

test('Item.json publish applies saved and automatic equipment roles', () => {
  const publishMatch = pipelineSource.match(/export function publishItemJson\([\s\S]*?\n}\n\nexport function publishGatheringTimer/);
  assert.ok(publishMatch, 'publishItemJson was not found');
  assert.match(publishMatch[0], /applyEquipmentRoleOverrides\(candidateItems\)/);
  assert.match(publishMatch[0], /writeJsonAtomic\(candidate, candidateItems\)/);
});

test('Windows release exe and child node process do not open console windows', () => {
  assert.match(rustSource, /windows_subsystem\s*=\s*"windows"/);
  assert.match(rustSource, /CREATE_NO_WINDOW/);
  assert.match(rustSource, /creation_flags\(CREATE_NO_WINDOW\)/);
});

test('GUI close button requests pipeline cancellation', () => {
  assert.match(rustSource, /CloseRequested/);
  assert.match(rustSource, /stop_pipeline_process/);
  assert.match(rustSource, /cancel-requested\.json/);
});
