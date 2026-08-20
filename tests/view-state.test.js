const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SCROLL_KEYS,
  inspectViewState,
  normalizeBooleanMap,
  normalizeRingCounts,
  normalizeScroll
} = require('../site/view-state.js');

test('view state rejects unsupported and stale payloads before restoration', () => {
  assert.deepEqual(inspectViewState(null, 'current'), { status: 'unsupported', state: null });
  assert.deepEqual(inspectViewState({ v: 2, dataVersion: 'current' }, 'current'), {
    status: 'unsupported',
    state: null
  });
  assert.deepEqual(inspectViewState({ v: 1, dataVersion: 'old' }, 'current'), {
    status: 'stale',
    state: null
  });
});

test('view state normalizes every persisted section with bounded enums', () => {
  const result = inspectViewState(
    {
      v: 1,
      dataVersion: 'current',
      input: { search: '検索', count: '4', active: 'countInput' },
      selected: { recipe: '完成品', recipeId: 'r1', favoriteListId: 'f1', usesItem: '素材' },
      view: {
        listMode: 'fav',
        sourceMode: 'favorite-materials',
        resultMode: 'materials',
        mobilePanel: 'right',
        favoriteListsOpen: false,
        favoriteListActionsId: 'f1'
      },
      favoriteMaterials: {
        listIds: ['f1', 2],
        ringCounts: { 指輪: 2, f1: { 指輪: 1, invalid: 3 } },
        calcMode: 'counts',
        checkedCalcMode: 'any-one',
        anyItemProductionExpanded: true,
        listProductionExpanded: { f1: true, bad: 'yes' }
      },
      materials: {
        sections: { normal: false, bad: 1 },
        purchasedNames: ['A', null],
        preparedNames: ['P', null],
        preparedCounts: { Q: 3, zero: 0, invalid: '2' },
        purchasedMaterialNames: ['B'],
        checkedImageKeys: ['C', 1]
      },
      equipmentSearch: { open: true, slot: 'head', results: ['A', 1], parameterNames: ['A'] },
      scroll: { recipeList: '12', usesList: -4, treeContainer: 'bad', panelRight: 5.8 }
    },
    'current'
  );

  assert.equal(result.status, 'ok');
  assert.deepEqual(result.state.favoriteMaterials.listIds, ['f1']);
  assert.deepEqual(result.state.favoriteMaterials.ringCounts, { 指輪: 2, f1: { 指輪: 1 } });
  assert.deepEqual(result.state.favoriteMaterials.listProductionExpanded, { f1: true });
  assert.equal(result.state.view.favoriteListsOpen, false);
  assert.equal(result.state.view.favoriteListActionsId, 'f1');
  assert.deepEqual(result.state.materials.sections, { normal: false });
  assert.deepEqual(result.state.materials.purchasedNames, ['A']);
  assert.deepEqual(result.state.materials.preparedNames, ['P']);
  assert.deepEqual(result.state.materials.preparedCounts, { Q: 3 });
  assert.deepEqual(result.state.scroll, { recipeList: 12, usesList: 0, treeContainer: 0, panelRight: 5 });
});

test('view state supplies stable defaults for missing or invalid optional values', () => {
  const { state } = inspectViewState(
    {
      v: 1,
      dataVersion: 'current',
      input: { count: 10, active: 'other' },
      view: { listMode: 'bad', sourceMode: 'bad', resultMode: 'bad', mobilePanel: 'bad' }
    },
    'current'
  );
  assert.deepEqual(state.input, { search: '', count: '1', active: '' });
  assert.deepEqual(state.view, {
    listMode: 'none',
    sourceMode: 'recipe',
    resultMode: 'tree',
    mobilePanel: '',
    favoriteListsOpen: false,
    favoriteListActionsId: ''
  });
  assert.deepEqual(Object.keys(state.scroll), [...SCROLL_KEYS]);
});

test('view state helpers ignore arrays and invalid nested values', () => {
  assert.deepEqual(normalizeBooleanMap([]), {});
  assert.deepEqual(normalizeBooleanMap({ a: true, b: false, c: 0 }), { a: true, b: false });
  assert.deepEqual(normalizeRingCounts({ a: 0, b: 3, c: { x: 2, y: -1 }, d: [] }), {
    a: 0,
    c: { x: 2 }
  });
  assert.deepEqual(normalizeScroll({ recipeList: Infinity, panelRight: '9' }), {
    recipeList: 0,
    usesList: 0,
    treeContainer: 0,
    panelRight: 9
  });
});
