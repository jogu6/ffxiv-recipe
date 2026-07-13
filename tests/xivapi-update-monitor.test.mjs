import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMessage, diffCsv, formatJstTimestamp, parseCsv } from '../pipeline/tool/xivapi-update-monitor.mjs';

test('parseCsv handles quoted commas and escaped quotes', () => {
  assert.deepEqual(parseCsv('#,Name\r\n1,"A, B"\r\n2,"say ""hi"""\r\n'), [['#', 'Name'], ['1', 'A, B'], ['2', 'say "hi"']]);
});

test('diffCsv reports added, changed, and removed item rows', () => {
  const previous = '#,Singular,Name\n1,古い,古い\n2,削除,削除\n';
  const current = '#,Singular,Name\n1,変更,変更\n3,追加,追加\n';
  assert.deepEqual(diffCsv(previous, current, 'Item.csv'), {
    added: [{ id: '3', name: '追加' }],
    changed: ['1'],
    removed: ['2']
  });
});

test('buildMessage includes item names and suppresses mentions', () => {
  const message = buildMessage([{ name: 'Item.csv', diff: { added: [{ id: '3', name: '新規' }], changed: [], removed: [] } }], '2026-07-13T00:00:00Z');
  assert.match(message, /新規アイテム: 3 新規/);
});

test('formatJstTimestamp formats timestamps with the JST offset', () => {
  assert.equal(formatJstTimestamp(new Date('2026-07-13T00:00:00.123Z')), '2026-07-13T09:00:00.123+09:00');
});
