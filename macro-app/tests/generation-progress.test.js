import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createProfiler } from '../web/profiling.js';

const source = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const progressSource = source.slice(source.indexOf('function formatActivityBytes('),
  source.indexOf('async function requestGenerationWakeLock('));

test('原因不明や過去の確保失敗をメモリー不足と決めつけず、日本語で原因を伝える', () => {
  const context = vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('function generationFailureMessage('),
    source.indexOf('function showGenerationMessage(')), context);
  const format = context.generationFailureMessage;
  assert.match(format('NoSolution'), /工数・品質を満たす手順が見つかりません/);
  assert.doesNotMatch(format('NoSolution'), /NoSolution|メモリー/);
  assert.match(format('memory allocation of 4096 bytes failed'), /メモリーを確保できなかった/);
  assert.match(format({ name: 'QuotaExceededError', message: 'Quota exceeded' }), /一時保存領域が不足/);
  const unknown = format({ message: 'unreachable', diagnostics: { memory: { wasmMemoryGrowFailures: 3 } } });
  assert.match(unknown, /原因を特定できなかった/);
  assert.doesNotMatch(unknown, /メモリー不足|ステータス不足/);
  assert.match(format({ message: 'Operation failed', diagnostics: { phase: 'write' } }), /一時保存を処理できなかった/);
  assert.match(format('SearchQueueCapacityExceeded'), /候補数の上限/);
});

for (const development of [false, true]) {
  test(`${development ? '開発' : '本番'}の進捗表示は実使用量を示しI/Oで説明が切り替わらない`, () => {
    let now = 1000;
    const elements = { generationStatus: { textContent: '' }, progress: { removeAttribute() {} }, progressPercent: {} };
    const profiler = createProfiler({ getItem() {}, setItem() {} }, () => now);
    profiler.start({}, {});
    const context = vm.createContext({ elements, profiler, Date: { now: () => now },
      notifyHost() {}, __xivcaDevelopment: development });
    vm.runInContext(`let generationActivity = null, lastEngineWorkUnits = 0, generationController = {};\n${progressSource}`, context);
    const engine = fields => {
      context.snapshot = { stage: 'bestFirstSearch', workUnits: 10000, searchNodes: 10000,
        storageDiskUsedBytes: 1024 ** 3, storageDiskCapacityBytes: 3 * 1024 ** 3, ...fields };
      vm.runInContext('observeEngineTelemetry(snapshot)', context);
    };
    const storage = operation => {
      context.metrics = { operation, storageReservedBytes: 3 * 1024 ** 3,
        storageWrittenBytes: 8 * 1024 ** 3, storageReadBytes: 4 * 1024 ** 3 };
      vm.runInContext('observeStorageProgress(metrics)', context);
    };
    engine();
    storage('write');
    const first = elements.generationStatus.textContent;
    assert.match(first, /確認した候補：10,000件/);
    assert.match(first, /端末への一時保存：1.00GB／3.00GB/);
    assert.doesNotMatch(first, /8.00GB|計算を続けるため/);
    assert.equal(first.includes('一時保存からの読み込み'), development);
    assert.equal(first.includes('最後に処理の進行を確認'), development);
    storage('read');
    assert.equal(elements.generationStatus.textContent, first);
    engine({ storageDiskUsedBytes: 512 * 1024 ** 2 });
    assert.match(elements.generationStatus.textContent, /端末への一時保存：512.0MB／3.00GB/);
    now += 31000;
    storage('read');
    assert.equal(elements.generationStatus.textContent.split('\n')[0], first.split('\n')[0]);
    assert.doesNotMatch(elements.generationStatus.textContent, /進み具合を確認できていません/);
    engine({ searchNodes: 20000, workUnits: 20000, storageDiskUsedBytes: 0 });
    assert.match(elements.generationStatus.textContent, /端末への一時保存：0MB／3.00GB/);
    assert.doesNotMatch(elements.generationStatus.textContent, /進み具合を確認できていません/);
    vm.runInContext('setGenerationProgress(100)', context);
    assert.match(elements.generationStatus.textContent, /探索が完了しました/);
  });
}

test('途中通知は実候補数だけを更新し詳細計測値を作り直さない', () => {
  let now = 1000;
  const elements = { generationStatus: { textContent: '' }, progress: { removeAttribute() {} }, progressPercent: {} };
  const profiler = createProfiler({ getItem() {}, setItem() {} }, () => now);
  profiler.start({}, {});
  const context = vm.createContext({ elements, profiler, Date: { now: () => now }, notifyHost() {} });
  vm.runInContext(`let generationActivity = null, lastEngineWorkUnits = 0, generationController = {};\n${progressSource}`, context);
  vm.runInContext('observeEngineTelemetry({ stage: "bestFirstSearch", searchNodes: 10000, workUnits: 10000, storageDiskUsedBytes: 123, storageDiskCapacityBytes: 999 })', context);
  now += 40000;
  vm.runInContext('observeLiveSearchProgress({ searchNodes: 15000 })', context);
  assert.match(elements.generationStatus.textContent, /確認した候補：15,000件/);
  assert.doesNotMatch(elements.generationStatus.textContent, /進み具合を確認できていません/);
  assert.equal(context.__xivcaMacroEngineStatus.telemetry.searchNodes, 10000);
  assert.equal(context.__xivcaMacroEngineStatus.telemetry.storageDiskUsedBytes, 123);
  assert.equal(profiler.current.samples.length, 0);
  assert.equal(profiler.current.liveProgress.searchNodes, 15000);
  vm.runInContext('observeLiveSearchProgress({ searchNodes: 14000 })', context);
  assert.equal(profiler.current.liveProgress.searchNodes, 15000);
  now += 31000;
  vm.runInContext('observeLiveSearchProgress({ searchNodes: 15000, activityCount: 1 })', context);
  assert.match(elements.generationStatus.textContent, /確認した候補：15,000件/);
  assert.doesNotMatch(elements.generationStatus.textContent, /進み具合を確認できていません/);
  assert.equal(profiler.current.liveProgress.activityCount, 1);
  vm.runInContext('setGenerationProgress(100); observeLiveSearchProgress({ searchNodes: 16000 })', context);
  assert.match(elements.generationStatus.textContent, /探索が完了しました/);
  assert.equal(profiler.current.liveProgress.searchNodes, 15000);
});

test('作業内の割合を表示し、候補数・詳細計測を増やさず古い通知と完了後の通知を無視する', () => {
  let now = 1000;
  let renderCount = 0;
  const elements = { generationStatus: { textContent: '' }, progress: { removeAttribute() {} }, progressPercent: {} };
  const profiler = createProfiler({ getItem() {}, setItem() {} }, () => now);
  profiler.start({}, {});
  const context = vm.createContext({ elements, profiler, Date: { now: () => now }, notifyHost() { renderCount++; } });
  vm.runInContext(`let generationActivity = null, lastEngineWorkUnits = 0, generationController = {};\n${progressSource}`, context);
  vm.runInContext('observeEngineTelemetry({ stage: "bestFirstSearch", searchNodes: 10000 }); observeWorkProgress({ workId: 2, phase: 2, completed: 3500, total: 10000 })', context);
  assert.match(elements.generationStatus.textContent, /今回の作業の進み具合：35%/);
  assert.match(elements.generationStatus.textContent, /確認した候補：10,000件/);
  assert.equal(profiler.current.samples.length, 0);
  now += 1000;
  vm.runInContext('observeWorkProgress({ workId: 1, phase: 2, completed: 9000, total: 10000 }); observeWorkProgress({ workId: 2, phase: 2, completed: 1000, total: 10000 })', context);
  assert.equal(profiler.current.workProgress.completed, 3500);
  const beforePhaseChange = renderCount;
  vm.runInContext('observeWorkProgress({ workId: 3, phase: 3, completed: 3500, total: 10000 })', context);
  assert.equal(renderCount, beforePhaseChange);
  assert.match(elements.generationStatus.textContent, /今回の作業の進み具合：35%/);
  assert.doesNotMatch(elements.generationStatus.textContent, /並べ替え|比較/);
  vm.runInContext('setGenerationProgress(100); observeWorkProgress({ workId: 3, phase: 3, completed: 9000, total: 10000 })', context);
  assert.doesNotMatch(elements.generationStatus.textContent, /今回の作業/);
  assert.equal(profiler.current.workProgress.workId, 3);
});
