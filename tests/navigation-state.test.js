const test = require('node:test');
const assert = require('node:assert/strict');
const {
  listModeForSearch,
  normalizeListMode,
  normalizeResultSourceMode,
  normalizeResultViewMode,
  resolveRestoredListMode,
  resultContentIdentity
} = require('../site/navigation-state.js');

test('navigation modes reject unknown state values', () => {
  assert.equal(normalizeListMode('missing'), 'none');
  assert.equal(normalizeResultSourceMode('missing'), 'recipe');
  assert.equal(normalizeResultViewMode('missing'), 'tree');
});

test('search mode depends only on a non-empty normalized query', () => {
  assert.equal(listModeForSearch('  '), 'none');
  assert.equal(listModeForSearch(' 木材 '), 'search');
});

test('restoration uses equipment and favorite modes only when their target still exists', () => {
  assert.equal(
    resolveRestoredListMode({
      requestedMode: 'equipment',
      search: 'ignored',
      hasEquipmentResults: true,
      hasFavoriteList: false
    }),
    'equipment'
  );
  assert.equal(
    resolveRestoredListMode({
      requestedMode: 'fav',
      search: '',
      hasEquipmentResults: false,
      hasFavoriteList: true
    }),
    'fav'
  );
  assert.equal(
    resolveRestoredListMode({
      requestedMode: 'fav',
      search: 'fallback',
      hasEquipmentResults: false,
      hasFavoriteList: false
    }),
    'search'
  );
});

test('result identity changes when the displayed target or complete view changes', () => {
  const recipe = resultContentIdentity({
    sourceMode: 'recipe',
    viewMode: 'tree',
    selectedRecipe: '完成品',
    selectedRecipeId: 'r1'
  });
  assert.notEqual(
    recipe,
    resultContentIdentity({
      sourceMode: 'recipe',
      viewMode: 'tree',
      selectedRecipe: '別の完成品',
      selectedRecipeId: 'r1'
    })
  );
  assert.notEqual(
    recipe,
    resultContentIdentity({
      sourceMode: 'recipe',
      viewMode: 'materials',
      selectedRecipe: '完成品',
      selectedRecipeId: 'r1'
    })
  );
  assert.notEqual(
    recipe,
    resultContentIdentity({
      sourceMode: 'favorite-materials',
      viewMode: 'materials',
      favoriteListIds: ['f1']
    })
  );
});
