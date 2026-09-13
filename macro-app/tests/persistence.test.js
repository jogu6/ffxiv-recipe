import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatJapaneseDateTime, japaneseIsoDateTime, loadDraftSelection, loadRestorableResult,
  saveDraftSelection, saveGeneratedResult, savePanelView, loadPanelView, sameSelection
} from '../web/persistence.js';

function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test('選択の一致はHQ素材の順序に依存せず食事と薬品も比較する', () => {
  const selection = { foodId: 'food', medicineId: null, hqIngredientIds: ['a', 'b'] };
  assert.equal(sameSelection(selection, { ...selection, hqIngredientIds: ['b', 'a'] }), true);
  for (const change of [{ foodId: null }, { medicineId: 'medicine' }, { hqIngredientIds: ['a'] }]) {
    assert.equal(sameSelection(selection, { ...selection, ...change }), false);
  }
  const storage = memoryStorage();
  saveGeneratedResult(storage, { recipeId: 'r', dataVersion: 'd', crafter, selection,
    macro: 'macro', generatedAt: '2026-09-13T00:00:00+09:00' });
  assert.equal(loadRestorableResult(storage, { recipeId: 'r', dataVersion: 'd', crafter,
    selection: { ...selection, foodId: null } }), null);
});

test('パネル表示はレシピ別に保存し破損データを無視する', () => {
  const storage = memoryStorage();
  const view = { job: '木工師', expanded: { macroSection: false }, listScroll: { foodList: 120 } };
  savePanelView(storage, 'r/1', view);
  assert.deepEqual(loadPanelView(storage, 'r/1'), view);
  assert.equal(loadPanelView(storage, 'r/2'), null);
  storage.setItem('xivca.macro.view.v1.r%2F1', '{');
  assert.equal(loadPanelView(storage, 'r/1'), null);
});

const crafter = {
  level: 100, craftsmanship: 5000, control: 4800, cp: 600,
  manipulation: true, heartAndSoul: false, quickInnovation: false
};

test('同じ製作ステータスなら食事・薬品・中間素材HQを含む生成結果を復元する', () => {
  const storage = memoryStorage();
  const result = {
    recipeId: 'recipe-1', dataVersion: 'data-1', engineVersion: 'engine-1', crafter,
    selection: { foodId: 'food-hq', medicineId: null, hqIngredientIds: ['material-2', 'material-1'] },
    macro: '/ac "加工" <wait.3>', generatedAt: '2026-09-03T03:34:56.000Z'
  };
  saveGeneratedResult(storage, result);
  assert.deepEqual(loadRestorableResult(storage, {
    recipeId: 'recipe-1', dataVersion: 'data-1', engineVersion: 'engine-1', crafter
  }), result);
});

test('製作ステータスが変わった生成結果は復元しない', () => {
  const storage = memoryStorage();
  saveGeneratedResult(storage, {
    recipeId: 'recipe-1', dataVersion: 'data-1', engineVersion: 'engine-1', crafter,
    selection: { foodId: null, medicineId: null, hqIngredientIds: [] },
    macro: 'macro', generatedAt: '2026-09-03T03:34:56.000Z'
  });
  assert.equal(loadRestorableResult(storage, {
    recipeId: 'recipe-1', dataVersion: 'data-1', engineVersion: 'engine-1',
    crafter: { ...crafter, cp: 601 }
  }), null);
});

test('エンジン版が変わっても保存済みマクロを復元する', () => {
  const storage = memoryStorage();
  const result = {
    recipeId: 'recipe-1', dataVersion: 'data-1', engineVersion: 'engine-old', crafter,
    selection: { foodId: null, medicineId: null, hqIngredientIds: [] },
    macro: '/ac "加工" <wait.3>', generatedAt: '2026-09-03T03:34:56.000Z'
  };
  saveGeneratedResult(storage, result);
  const context = { recipeId: result.recipeId, dataVersion: result.dataVersion, crafter };
  assert.deepEqual(loadRestorableResult(storage, { ...context, engineVersion: 'engine-new' }), result);
  assert.deepEqual(loadRestorableResult(storage, context), result);
  assert.equal(loadRestorableResult(storage, { ...context, dataVersion: 'data-2' }), null);
  assert.equal(loadRestorableResult(storage, { ...context, recipeId: 'recipe-2' }), null);
});

test('生成前の食事・薬品・中間素材HQ選択を同じデータ版で復元する', () => {
  const storage = memoryStorage();
  saveDraftSelection(storage, {
    recipeId: 'recipe-1', dataVersion: 'data-1',
    selection: { foodId: 'food-hq', medicineId: 'medicine-hq', hqIngredientIds: ['m1'] }
  });
  assert.deepEqual(loadDraftSelection(storage, { recipeId: 'recipe-1', dataVersion: 'data-1' }), {
    foodId: 'food-hq', medicineId: 'medicine-hq', hqIngredientIds: ['m1']
  });
  assert.equal(loadDraftSelection(storage, { recipeId: 'recipe-1', dataVersion: 'data-2' }), null);
});

test('生成日時を日本時間のYYYY/MM/DD hh:mm:ssで表示する', () => {
  assert.equal(formatJapaneseDateTime('2026-09-03T03:34:56.000Z'), '2026/09/03 12:34:56');
});

test('日時保存は日付境界を越えても日本標準時のオフセットを付ける', () => {
  assert.equal(japaneseIsoDateTime('2026-09-11T18:00:00.000Z'), '2026-09-12T03:00:00.000+09:00');
  assert.equal(japaneseIsoDateTime('2026-09-12T03:00:00.000+09:00'), '2026-09-12T03:00:00.000+09:00');
});
