const test = require('node:test');
const assert = require('node:assert/strict');
const {
  addAll,
  clear,
  createState,
  favoriteContext,
  prune,
  recipeContext,
  resetForContext,
  retargetContext,
  serialize,
  setPurchased,
  setPreparedCount,
  syncContext
} = require('../site/material-purchase-state.js');

test('purchase contexts identify recipe variants and stable favorite settings', () => {
  assert.equal(recipeContext('完成品', 'r2', 2), 'recipe:完成品:r2');
  assert.equal(recipeContext('完成品', 'ignored', 1), 'recipe:完成品');
  assert.equal(
    favoriteContext({
      listIds: ['b', 'a'],
      displayedListId: 'ignored',
      calcMode: 'any-one',
      ringCounts: { 指輪B: 2, 指輪A: 1 }
    }),
    'favorite:b,a:any-one:{"指輪A":1,"指輪B":2}'
  );
});

test('context changes clear intermediate and terminal purchases together', () => {
  const state = createState({
    intermediateContext: 'old',
    intermediateNames: ['中間材'],
    preparedCounts: { 準備材: 2 },
    materialContext: 'old',
    materialNames: ['末端素材']
  });

  assert.equal(syncContext(state, 'new'), true);
  assert.deepEqual(serialize(state), {
    purchasedContext: 'new',
    purchasedNames: [],
    preparedCounts: {},
    purchasedMaterialContext: 'new',
    purchasedMaterialNames: []
  });
  assert.equal(syncContext(state, 'new'), false);
});

test('quantity changes can retarget purchases without discarding their selections', () => {
  const state = createState({ intermediateNames: ['中間材'], materialNames: ['末端素材'] });

  retargetContext(state, 'favorite:new-count');
  assert.equal(state.intermediateContext, 'favorite:new-count');
  assert.equal(state.materialContext, 'favorite:new-count');
  assert.deepEqual([...state.intermediateNames], ['中間材']);
  assert.deepEqual([...state.materialNames], ['末端素材']);
});

test('prepared and purchased intermediate states are exclusive while terminal purchases remain independent', () => {
  const state = createState();
  setPurchased(state, 'intermediate', '中間材A', true, 'recipe:a');
  setPreparedCount(state, '中間材A', 2, 'recipe:a');
  assert.deepEqual([...state.intermediateNames], []);
  assert.deepEqual([...state.preparedCounts], [['中間材A', 2]]);
  setPurchased(state, 'intermediate', '中間材A', true, 'recipe:a');
  assert.deepEqual([...state.preparedCounts], []);
  setPreparedCount(state, '中間材B', 3, 'recipe:a');
  setPurchased(state, 'material', '末端素材A', true, 'recipe:a');
  addAll(state, 'intermediate', ['中間材B', '中間材C'], 'recipe:a');
  clear(state, 'material', 'recipe:a');

  assert.deepEqual([...state.intermediateNames], ['中間材A', '中間材C']);
  assert.deepEqual([...state.preparedCounts], [['中間材B', 3]]);
  assert.deepEqual([...state.materialNames], []);
});

test('pruning removes stale purchases and reset targets a new context', () => {
  const state = createState({ intermediateNames: ['有効', '無効'], materialNames: ['素材'] });

  assert.equal(prune(state, 'intermediate', new Set(['有効'])), true);
  assert.equal(prune(state, 'material', new Set(['素材'])), false);
  resetForContext(state, 'recipe:new');
  assert.deepEqual(serialize(state), {
    purchasedContext: 'recipe:new',
    purchasedNames: [],
    preparedCounts: {},
    purchasedMaterialContext: 'recipe:new',
    purchasedMaterialNames: []
  });
});
