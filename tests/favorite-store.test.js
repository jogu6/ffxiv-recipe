const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeFavoriteListName,
  normalizeFavoriteStore,
  normalizeItemIds,
  normalizeStoredRecipeSelections,
  withDuplicateSuffix
} = require('../site/favorite-store.js');

const options = {
  createId: () => 'generated-id',
  fallbackName: 'fallback',
  maxNameLength: 10,
  recentListId: 'recent',
  recentListName: 'history',
  recentListLimit: 3,
  version: 3
};

test('favorite primitives normalize external values without retaining invalid entries', () => {
  assert.deepEqual(normalizeItemIds(['2', 2, -1, 'x', 3.5, 4]), [2, 3, 4]);
  assert.deepEqual(normalizeStoredRecipeSelections({ 2: 'r2', '-1': 'bad', x: 'bad', 4: '', 5: 10 }), {
    2: 'r2'
  });
  assert.equal(normalizeFavoriteListName('  long favorite  ', { fallbackName: 'fallback', maxLength: 10 }), 'long favor');
  assert.equal(withDuplicateSuffix('1234567890', 2, 10), '1234567（2）');
});

test('favorite store normalization restores one bounded recent list and valid selection', () => {
  const normalized = normalizeFavoriteStore(
    {
      selectedListId: 'chosen',
      lists: [
        { id: 'recent', name: 'ignored', itemIds: [1, 2, 3, 4], recipeSelections: { 1: 'ignored' } },
        {
          id: 'chosen',
          name: ' chosen ',
          itemIds: ['7', 7, 8],
          recipeSelections: { 7: 'recipe-7', bad: 'recipe-x' },
          materialSelected: true
        }
      ]
    },
    options
  );

  assert.deepEqual(normalized, {
    version: 3,
    selectedListId: 'chosen',
    lists: [
      { id: 'recent', name: 'history', itemIds: [1, 2, 3], recipeSelections: {} },
      {
        id: 'chosen',
        name: 'chosen',
        itemIds: [7, 8],
        recipeSelections: { 7: 'recipe-7' },
        materialSelected: true
      }
    ]
  });
});

test('favorite store normalization protects the reserved recent-list name', () => {
  const normalized = normalizeFavoriteStore(
    {
      selectedListId: 'missing',
      lists: [
        { id: 'one', name: 'history', itemIds: [] },
        { id: 'two', name: 'history（1）', itemIds: [] },
        { name: '', itemIds: ['9'] }
      ]
    },
    options
  );

  assert.equal(normalized.selectedListId, null);
  assert.deepEqual(
    normalized.lists.map(list => [list.id, list.name]),
    [
      ['recent', 'history'],
      ['one', 'history（2）'],
      ['two', 'history（1）'],
      ['generated-id', 'fallback']
    ]
  );
});
