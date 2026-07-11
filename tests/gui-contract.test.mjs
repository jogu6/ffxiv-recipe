import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const guiSource = fs.readFileSync('pipeline/gui/main.js', 'utf8');
const guiHtml = fs.readFileSync('pipeline/gui/index.html', 'utf8');
const rustSource = fs.readFileSync('src-tauri/src/main.rs', 'utf8');
const pipelineSource = fs.readFileSync('pipeline/tool/pipeline-tool.mjs', 'utf8');

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

test('GUI preview does not start a local web server', () => {
  assert.equal(guiSource.includes('start_preview_server'), false);
  assert.equal(guiSource.includes('stop_preview_server'), false);
  assert.equal(rustSource.includes('start_preview_server'), false);
  assert.equal(rustSource.includes('stop_preview_server'), false);
});

test('GUI full run applies Lodestone info before publishing Item.json', () => {
  const sequenceMatch = guiSource.match(/const recommendedSequence = \[([\s\S]*?)\];/);
  assert.ok(sequenceMatch, 'recommendedSequence was not found');
  const commands = [...sequenceMatch[1].matchAll(/command: '([^']+)'/g)].map(match => match[1]);
  assert.deepEqual(commands, ['validate-csv', 'build', 'icons', 'publish-lodestone-info', 'publish']);
});

test('Item.json publish applies saved and automatic equipment roles', () => {
  const publishMatch = pipelineSource.match(/export function publishItemJson\([\s\S]*?\n}\n\nexport function publishGatheringTimer/);
  assert.ok(publishMatch, 'publishItemJson was not found');
  assert.match(publishMatch[0], /applyEquipmentRoleOverrides\(candidateItems\)/);
  assert.match(publishMatch[0], /writeJsonAtomic\(candidate, candidateItems\)/);
});

test('GUI shows last checked time directly after update check', () => {
  const checkIndex = guiHtml.indexOf('data-step="check-updates"');
  const lastCheckedIndex = guiHtml.indexOf('id="lastChecked"');
  const downloadIndex = guiHtml.indexOf('data-step="download-csv"');
  assert.ok(checkIndex >= 0, 'update check action was not found');
  assert.ok(lastCheckedIndex > checkIndex, 'last checked time must follow update check');
  assert.ok(lastCheckedIndex < downloadIndex, 'last checked time must be before CSV download');
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
