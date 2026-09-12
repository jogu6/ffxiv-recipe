const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('開発用CPU制限は保存待ち時間を遅延負債へ加えない', async () => {
  let now = 0, listener;
  const sandbox = {
    performance: { now: () => now },
    WebAssembly: { Memory: class { constructor() { this.buffer = new ArrayBuffer(4); } } },
    Atomics: { wait: (_array, _index, _value, delay) => { now += delay; } },
    self: { addEventListener: (_name, callback) => { listener = callback; } }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(require.resolve('../tools/local-mobile-worker.js'), 'utf8'), sandbox);
  listener({ data: { type: 'solve' } });
  let resolve, reject;
  const store = sandbox.__localMobileTrackStore({
    read: () => new Promise(done => { resolve = done; }),
    write: () => new Promise((_done, fail) => { reject = fail; }), close() {}
  });
  now += 10;
  const read = store.read();
  assert.equal(sandbox.__localMobileSleepMs, 30);
  now += 1000;
  sandbox.performance.now();
  assert.equal(sandbox.__localMobileSleepMs, 30);
  resolve(); await read;
  sandbox.performance.now();
  assert.equal(sandbox.__localMobileSleepMs, 30);
  now += 10; sandbox.performance.now();
  assert.equal(sandbox.__localMobileSleepMs, 60);
  const write = store.write();
  now += 1000;
  reject(new Error('保存失敗'));
  await assert.rejects(write, /保存失敗/);
  sandbox.performance.now();
  assert.equal(sandbox.__localMobileSleepMs, 60);
  now += 10; sandbox.performance.now();
  assert.equal(sandbox.__localMobileSleepMs, 90);
});
