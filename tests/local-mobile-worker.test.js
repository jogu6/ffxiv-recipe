const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('開発用制限はWASMとキャッシュの上限だけを設定し、人工的に待たせない', () => {
  const now = () => 123;
  const sandbox = {
    performance: { now },
    WebAssembly: { Memory: class { constructor(options) { this.options = options; } } },
    Atomics: { wait() { assert.fail('人工的な休止は禁止'); } },
    self: { addEventListener() { assert.fail('休止用のイベント登録は禁止'); } }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(require.resolve('../tools/local-mobile-worker.js'), 'utf8'), sandbox);
  assert.equal(sandbox.__xivcaStorageCacheBytes, 512 * 1024 * 1024);
  assert.equal(sandbox.performance.now, now);
  assert.equal(sandbox.performance.now(), 123);
  assert.equal(new sandbox.WebAssembly.Memory({ initial: 8, maximum: 65536 }).options.maximum, 16384);
  assert.equal(new sandbox.WebAssembly.Memory({ initial: 8, maximum: 512 }).options.maximum, 512);
  assert.equal(new sandbox.WebAssembly.Memory({ initial: 8 }).options.maximum, 16384);
  const store = { read() {}, write() {}, reserve() {}, close() {} };
  assert.equal(sandbox.__localMobileTrackStore(store), store);
});
