import assert from 'node:assert/strict';
import test from 'node:test';

import { selectSolverWorkerCount } from '../web/worker-policy.js';

test('Raphaelと同じ論理プロセッサ数の半分、最小2・最大8を選ぶ', () => {
  for (const [hardwareConcurrency, expected] of [[undefined, 2], [NaN, 2], [0, 2], [1, 2], [2, 2], [4, 2], [6, 3], [8, 4], [15, 7], [16, 8], [32, 8]]) {
    assert.equal(selectSolverWorkerCount({ hardwareConcurrency }), expected);
  }
});
