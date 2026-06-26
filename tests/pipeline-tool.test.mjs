import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../pipeline/tool/pipeline-tool.mjs';

test('parseCsv handles commas, escaped quotes, and newlines in quoted fields', () => {
  const rows = parseCsv('A,B,C\r\n1,"two, too","line1\r\nline2"\r\n2,"say ""hi""",3\r\n');
  assert.deepEqual(rows, [
    ['A', 'B', 'C'],
    ['1', 'two, too', 'line1\nline2'],
    ['2', 'say "hi"', '3']
  ]);
});

test('parseCsv keeps empty trailing fields', () => {
  const rows = parseCsv('A,B,C\n1,2,\n');
  assert.deepEqual(rows, [
    ['A', 'B', 'C'],
    ['1', '2', '']
  ]);
});
