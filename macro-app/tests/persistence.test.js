import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatJapaneseDateTime, japaneseIsoDateTime, loadDraftSelection, loadRestorableResult,
  saveDraftSelection, saveGeneratedResult, savePanelView, loadPanelView, sameSelection,
  reconcileSavedMacros, resultCalculationInputs
} from '../web/persistence.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key), key: index => [...values.keys()][index] ?? null,
    get length() { return values.size; }
  };
}

function updateFixture() {
  const data = {
    dataVersion: 'old', recipes: [{ id: 'r', name: '完成品', level: 100, difficulty: 500,
      durability: 70, maxQuality: 1000, recipeLevel: { jobLevel: 100 },
      ingredients: [{ id: '旧素材', name: '旧素材', amount: 2 }] }],
    foods: [{ id: '旧食事:hq', name: '旧食事', effects: { cpPercent: 10, cpCap: 20 } }],
    medicines: [{ id: '旧薬品:nq', name: '旧薬品', effects: { controlPercent: 5, controlCap: 10 } }]
  };
  const selection = { foodId: '旧食事:hq', medicineId: '旧薬品:nq', hqIngredientIds: ['旧素材'] };
  const result = { recipeId: 'r', dataVersion: 'old', crafter,
    selection, macro: 'unchanged macro', generatedAt: '2026-10-17T00:00:00+09:00',
    calculationInputs: resultCalculationInputs(data, 'r', crafter, selection) };
  const storage = memoryStorage();
  saveGeneratedResult(storage, result);
  saveDraftSelection(storage, result);
  return { data, result, storage };
}

test('名称だけの更新は食事・薬品・HQ素材の選択を移行して保存マクロを保持する', () => {
  const { data, storage } = updateFixture();
  data.dataVersion = 'new';
  data.itemNameAliases = { 旧食事: '新食事', 旧薬品: '新薬品', 旧素材: '新素材' };
  data.recipes[0].name = '新完成品';
  data.recipes[0].ingredients[0].id = '新素材';
  data.foods[0].id = '新食事:hq';
  data.medicines[0].id = '新薬品:nq';
  reconcileSavedMacros(storage, data);
  const context = { recipeId: 'r', dataVersion: 'new', crafter };
  const restored = loadRestorableResult(storage, context);
  assert.equal(restored.macro, 'unchanged macro');
  assert.equal(restored.recipeName, '新完成品');
  assert.deepEqual(restored.selection, { foodId: '新食事:hq', medicineId: '新薬品:nq', hqIngredientIds: ['新素材'] });
  assert.deepEqual(loadDraftSelection(storage, context), restored.selection);
});

test('効果・上限・製作条件・必要素材数の変更は該当する保存マクロを実際に削除する', () => {
  for (const change of [
    data => { data.foods[0].effects.cpPercent += 1; },
    data => { data.medicines[0].effects.controlCap += 1; },
    data => { data.recipes[0].difficulty += 1; },
    data => { data.recipes[0].ingredients[0].amount += 1; },
    data => { data.foods = []; },
    data => { data.recipes = []; }
  ]) {
    const { data, storage } = updateFixture();
    data.dataVersion = 'changed';
    change(data);
    reconcileSavedMacros(storage, data);
    assert.equal(loadRestorableResult(storage, { recipeId: 'r', dataVersion: 'old', crafter }), null);
    assert.equal(storage.getItem('xivca.macro.result.v1.r'), null);
  }
});

test('無関係な追加・表示順・画像の更新では保存マクロを初期化しない', () => {
  const { data, storage } = updateFixture();
  data.dataVersion = 'new';
  data.foods.push({ id: '無関係:hq', effects: { cpCap: 100 } });
  data.foods[0].iconFile = 'new.webp';
  data.foods[0].sortOrder = 99;
  reconcileSavedMacros(storage, data);
  assert.equal(loadRestorableResult(storage, { recipeId: 'r', dataVersion: 'new', crafter }).macro, 'unchanged macro');
});

test('同じデータ版での再表示では保存マクロの全件比較と再保存を繰り返さない', () => {
  const { data, storage } = updateFixture();
  reconcileSavedMacros(storage, data);
  storage.key = () => { throw new Error('must not scan results again'); };
  storage.setItem = () => { throw new Error('must not write results again'); };
  reconcileSavedMacros(storage, data);
});

test('旧形式は同じデータ版で比較条件を補い、比較できない更新済みデータでは削除する', () => {
  for (const sameVersion of [true, false]) {
    const { data, result, storage } = updateFixture();
    delete result.calculationInputs;
    saveGeneratedResult(storage, result);
    if (!sameVersion) data.dataVersion = 'new';
    reconcileSavedMacros(storage, data);
    const restored = loadRestorableResult(storage, { recipeId: 'r', dataVersion: data.dataVersion, crafter });
    if (sameVersion) assert.ok(restored.calculationInputs);
    else assert.equal(restored, null);
  }
});

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
