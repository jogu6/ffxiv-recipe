import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const guiSource = fs.readFileSync('pipeline/gui/main.js', 'utf8');
const rustSource = fs.readFileSync('src-tauri/src/main.rs', 'utf8');

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
