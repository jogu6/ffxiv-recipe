import test from 'node:test';
import assert from 'node:assert/strict';
import { createProfiler, PROFILE_KEY } from '../web/profiling.js';

test('計測を中断・再読込しても入力と最後の時系列を復元できる', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  let time = 0;
  const recorder = createProfiler(storage, () => time);
  recorder.start({ cp: 756 }, { threadCount: 1 });
  recorder.sample({ searchNodes: 10_000_000, wasmMemoryBytes: 200_000_000 });
  time = 6000;
  recorder.sample({ searchNodes: 10_600_000, wasmMemoryBytes: 400_000_000 });
  assert.equal(recorder.current.samples[1].nodesPerSecond, 100_000);
  const restored = createProfiler(storage, () => time);
  assert.equal(restored.current.status, 'interrupted');
  assert.deepEqual(restored.current.input, { cp: 756 });
  assert.equal(restored.current.samples[1].wasmMemoryBytes, 400_000_000);
  recorder.finish('completed', { result: ['Reflect'] });
  recorder.finish('cancelled');
  assert.equal(JSON.parse(values.get(PROFILE_KEY)).status, 'completed');
});

test('長い探索でもログ容量を制限し最初と最新の観測を保持する', () => {
  const recorder = createProfiler({ getItem() {}, setItem() {} }, () => 0);
  recorder.start({}, {});
  for (let index = 0; index < 10000; index++) recorder.sample({ searchNodes: index });
  assert.ok(recorder.current.samples.length <= 2400);
  assert.equal(recorder.current.samples[0].searchNodes, 0);
  assert.equal(recorder.current.samples.at(-1).searchNodes, 9999);
  assert.ok(recorder.current.decimatedSamples > 0);
});

test('保存領域が使えなくても計測結果をメモリーに保持する', () => {
  const recorder = createProfiler({ getItem() { throw Error(); }, setItem() { throw Error(); } });
  recorder.start({}, {});
  recorder.sample({ searchNodes: 5 });
  recorder.finish('error', { error: 'out of memory' });
  assert.equal(recorder.current.status, 'error');
  assert.equal(recorder.current.storageUnavailable, true);
  assert.equal(recorder.current.samples.length, 1);
});

test('探索速度はUIへの配信遅延と未実装カウンターの影響を受けない', () => {
  let time = 0;
  const recorder = createProfiler({ getItem() {}, setItem() {} }, () => time);
  recorder.start({}, {});
  recorder.sample({ searchNodes: 100, workerElapsedMs: 1000, finishMemoHits: 0 });
  time = 10000;
  recorder.sample({ searchNodes: 300, workerElapsedMs: 2000 });
  assert.equal(recorder.current.samples[1].nodesPerSecond, 200);
  assert.equal('finishMemoHits' in recorder.current.samples[0], false);
});
