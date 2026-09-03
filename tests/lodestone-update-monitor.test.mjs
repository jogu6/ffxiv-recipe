import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildMessage, diffLodestoneState, formatJstTimestamp } from '../pipeline/tool/lodestone-update-monitor.mjs';

test('diffLodestoneState reports only changed Lodestone metadata', () => {
  const previous = { Version: '7.5', ItemCount: 45000, RecipeCount: 12000, ItemOrderSignature: 'a'.repeat(64) };
  const current = { Version: '7.55', ItemCount: 45160, RecipeCount: 12308, ItemOrderSignature: 'b'.repeat(64) };
  assert.deepEqual(diffLodestoneState(previous, current).map(change => change.key), [
    'Version',
    'ItemCount',
    'RecipeCount',
    'ItemOrderSignature'
  ]);
  assert.deepEqual(diffLodestoneState(current, { ...current }), []);
});

test('buildMessage describes Lodestone changes without exposing full signatures', () => {
  const changes = diffLodestoneState(
    { Version: '7.5', ItemCount: 45000, RecipeCount: 12000, ItemOrderSignature: 'a'.repeat(64) },
    { Version: '7.55', ItemCount: 45160, RecipeCount: 12308, ItemOrderSignature: 'b'.repeat(64) }
  );
  const message = buildMessage(changes, '2026-08-08T00:00:00Z');
  assert.match(message, /Lodestoneデータ更新/);
  assert.match(message, /アイテム総数.*45000.*45160/);
  assert.doesNotMatch(message, /b{64}/);
});

test('formatJstTimestamp formats timestamps with the JST offset', () => {
  assert.equal(formatJstTimestamp(new Date('2026-08-08T00:00:00.123Z')), '2026-08-08T09:00:00.123+09:00');
});

test('legacy scheduled-task entry applies background CPU priority', () => {
  const source = fs.readFileSync(path.resolve('pipeline/tool/xivapi-update-monitor.mjs'), 'utf8');
  assert.match(source, /applyBackgroundCpuPriority\(\)/);
});
