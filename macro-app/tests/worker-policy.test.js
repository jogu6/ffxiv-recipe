import assert from 'node:assert/strict';
import test from 'node:test';

import { selectSolverWorkerCount } from '../web/worker-policy.js';

test('論理プロセッサ数の半分に1を加え、総数未満に収める', () => {
  for (const [hardwareConcurrency, expected] of [[undefined, 1], [NaN, 1], [Infinity, 1], [-1, 1], [0, 1], [1, 1], [2, 1], [3, 2], [4, 3], [6, 4], [8, 5], [15, 8], [16, 9], [32, 17]]) {
    assert.equal(selectSolverWorkerCount({ hardwareConcurrency }), expected);
  }
});
