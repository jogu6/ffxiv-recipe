import assert from 'node:assert/strict';
import test from 'node:test';

import { selectSolverWorkerCount } from '../web/worker-policy.js';

test('端末や論理プロセッサ数によらずページ退避を所有する1スレッドで実行する', () => {
  for (const hardwareConcurrency of [undefined, 2, 4, 8, 16, 32]) {
    assert.equal(selectSolverWorkerCount({ hardwareConcurrency }), 1);
  }
});
