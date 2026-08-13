const test = require('node:test');
const assert = require('node:assert/strict');
const { createProgressController } = require('../site/data-setup-progress.js');

function fixture(enabled = true) {
  const frames = [];
  const timers = [];
  const changes = [];
  const controller = createProgressController({
    enabled,
    onChange: state => changes.push(state),
    setTimer: (callback, delay) => {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: timer => { timer.cleared = true; },
    requestFrame: callback => { frames.push(callback); }
  });
  return { changes, controller, frames, timers };
}

test('即時指定では工程名とプログレスバーを同期して表示する', () => {
  const changes = [];
  createProgressController({
    enabled: true,
    progressDelayMs: 0,
    initialPhase: '画像生成中',
    onChange: state => changes.push(state)
  });
  assert.deepEqual(changes.at(-1), {
    detailVisible: true,
    progressVisible: true,
    percentVisible: false,
    phase: '画像生成中',
    percent: 0
  });
});

test('世代変更処理は2秒で工程と進捗バーを同時に示す', () => {
  const state = fixture();
  state.controller.report('レシピを関連付けています', 42);
  state.timers.find(timer => timer.delay === 2000).callback();
  assert.deepEqual(state.changes.at(-1), {
    detailVisible: true,
    progressVisible: true,
    percentVisible: false,
    phase: 'レシピを関連付けています',
    percent: 42
  });
});

test('7秒で進捗バーの右隣に数値パーセントを追加する', () => {
  const state = fixture();
  state.controller.report('装備索引を作成しています', 86);
  state.timers.find(timer => timer.delay === 2000).callback();
  assert.equal(state.changes.at(-1).percentVisible, false);
  state.timers.find(timer => timer.delay === 7000).callback();
  assert.deepEqual(state.changes.at(-1), {
    detailVisible: true,
    progressVisible: true,
    percentVisible: true,
    phase: '装備索引を作成しています',
    percent: 86
  });
});

test('主スレッド停止でタイマーが遅れても実経過時間から表示段階を復元する', () => {
  let elapsed = 0;
  const changes = [];
  const controller = createProgressController({
    enabled: true,
    now: () => elapsed,
    onChange: state => changes.push(state),
    setTimer: () => 0,
    clearTimer: () => {}
  });
  elapsed = 7100;
  controller.report('画像を検証しています', 65);
  assert.equal(changes.at(-1).progressVisible, true);
  assert.equal(changes.at(-1).percentVisible, true);
  assert.equal(changes.at(-1).percent, 65);
});

test('表示した進捗バーは100%を描画後200ms維持してから閉じる', async () => {
  const state = fixture();
  state.timers.find(timer => timer.delay === 2000).callback();
  state.timers.find(timer => timer.delay === 7000).callback();
  state.controller.report('完了しています', 100);
  const completion = state.controller.complete();
  assert.deepEqual(state.changes.at(-1), {
    detailVisible: true,
    progressVisible: true,
    percentVisible: true,
    phase: '完了しています',
    percent: 100
  });
  assert.equal(state.frames.length, 1);
  state.frames[0]();
  const holdTimer = state.timers.find(timer => timer.delay === 200);
  assert.ok(holdTimer);
  assert.equal(state.changes.at(-1).progressVisible, true);
  holdTimer.callback();
  await completion;
  assert.equal(state.changes.at(-1).detailVisible, false);
  assert.equal(state.changes.at(-1).progressVisible, false);
  assert.equal(state.changes.at(-1).percentVisible, false);
});

test('2秒未満で完了した場合は進捗バーを表示せず待機もしない', async () => {
  const state = fixture();
  await state.controller.complete();
  assert.equal(state.frames.length, 0);
  assert.equal(state.changes.at(-1).progressVisible, false);
  assert.ok(state.timers.every(timer => timer.cleared));
});

test('世代変更でない通常起動では遅延表示を予約しない', async () => {
  const state = fixture(false);
  state.controller.report('索引を作成しています', 50);
  assert.equal(state.timers.length, 0);
  assert.equal(state.changes.length, 0);
  await state.controller.complete();
  assert.equal(state.changes.length, 1);
});

test('エラー終了は表示済みの進捗バーを待機せず閉じる', () => {
  const state = fixture();
  state.timers.find(timer => timer.delay === 2000).callback();
  state.controller.cancel();
  assert.equal(state.frames.length, 0);
  assert.equal(state.changes.at(-1).progressVisible, false);
});
