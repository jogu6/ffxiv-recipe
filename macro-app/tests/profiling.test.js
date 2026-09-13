import test from 'node:test';
import assert from 'node:assert/strict';
import { createProfiler, createWorkProgressReporter, PROFILE_KEY } from '../web/profiling.js';

test('実作業の通知を間引き、時間だけでは進捗を作らず別の作業を識別する', () => {
  let now = 0;
  const events = [];
  const report = createWorkProgressReporter(event => events.push(event), () => now);
  report(2, 0, 10000);
  now = 100;
  report(2, 4096, 10000);
  assert.equal(events.length, 1);
  now = 600;
  report(2, 8192, 10000);
  assert.deepEqual(events.at(-1), { workId: 1, phase: 2, completed: 8192, total: 10000 });
  now = 1200;
  report(3, 0, 10000);
  assert.equal(events.at(-1).workId, 2);
  now = 10000;
  assert.equal(events.length, 3);
  report(3, 11000, 10000);
  assert.equal(events.length, 3);
});

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

test('退避の実使用量・累計・保存方式・失敗時の情報を区別して保持する', () => {
  const values = new Map();
  let time = 0;
  const recorder = createProfiler({ getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }, () => time);
  recorder.start({}, {});
  recorder.storage({ operation: 'reserve', storageBackend: 'opfs', storageReservationMode: 'opfs-file-size',
    storageReservedBytes: 3 * 1024 ** 3, storagePersistent: false, storageSegmentCount: 49 });
  recorder.sample({ searchNodes: 100, storageDiskUsedBytes: 4096, storageWrittenBytes: 40960 });
  time = 6000;
  recorder.sample({ searchNodes: 200, storageDiskUsedBytes: 0, storageWrittenBytes: 81920 });
  recorder.finish('error', { error: '容量不足', errorName: 'QuotaExceededError',
    errorDetails: { phase: 'write', storage: { storageLastOffsetBytes: 4096 } } });
  const saved = JSON.parse(values.get(PROFILE_KEY));
  assert.equal(saved.storage.storageDiskUsedBytes, 0);
  assert.equal(saved.storage.storageWrittenBytes, 81920);
  assert.equal(saved.samples.at(-1).storageBackend, 'opfs');
  assert.equal(saved.samples.at(-1).storagePersistent, false);
  assert.equal(saved.storageEvents[0].operation, 'reserve');
  assert.equal(saved.errorDetails.phase, 'write');
  assert.match(saved.memoryMeaning, /累計/);
});


test('メモリー拡張の理由を詳細サンプルとは別に最大64件保持する', () => {
  const recorder = createProfiler({ getItem() {}, setItem() {} }, () => 1000);
  recorder.start({}, {});
  for (let sequence = 1; sequence <= 100; sequence++) recorder.sample({
    wasmMemoryMaximumBytes: 1073741824, wasmMemoryLimitAvoided: sequence,
    wasmMemoryEvents: [{ sequence, requestedPages: 100, currentPages: 16380, maximumPages: 16384, outcome: 0, phase: 2 }]
  });
  assert.equal(recorder.current.memoryEvents.length, 64);
  assert.equal(recorder.current.memoryEvents[0].sequence, 37);
  assert.equal(recorder.current.memoryEvents.at(-1).outcome, 0);
  assert.equal(recorder.current.samples.at(-1).wasmMemoryLimitAvoided, 100);
});
