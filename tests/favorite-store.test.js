const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeFavoriteListName,
  normalizeFavoriteStore,
  migrateFavoriteStoreItems,
  normalizeItemIds,
  normalizeStoredRecipeSelections,
  resolveItemName,
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
  assert.deepEqual(normalizeItemIds(['2', 2, -1, 'x', 3.5, 4]), [2, 'x', 4]);
  assert.deepEqual(normalizeStoredRecipeSelections({ 2: 'r2', '-1': 'bad', x: 'bad', 4: '', 5: 10 }), {
    2: 'r2',
    x: 'bad'
  });
  assert.equal(normalizeFavoriteListName('  long favorite  ', { fallbackName: 'fallback', maxLength: 10 }), 'long favor');
  assert.equal(withDuplicateSuffix('1234567890', 2, 10), '1234567（2）');
});

test('item aliases resolve old names to a current name and reject cycles or deleted targets', () => {
  const current = new Set(['C']);
  const options = {
    aliases: { A: 'B', B: 'C', X: 'Y', Y: 'X', Gone: 'Missing' },
    hasCurrentName: name => current.has(name)
  };
  assert.equal(resolveItemName('A', options), 'C');
  assert.equal(resolveItemName('C', options), 'C');
  assert.equal(resolveItemName('X', options), null);
  assert.equal(resolveItemName('Gone', options), null);
});

test('favorite migration updates items, recipe selections, and equipment targets while reporting conflicts and deletions', () => {
  const current = new Set(['Current', 'Other']);
  const aliases = { Old: 'Current' };
  const resolveName = value => resolveItemName(value, {
    aliases,
    hasCurrentName: name => current.has(name)
  });
  const store = {
    lists: [
      {
        id: 'normal',
        itemIds: ['Old', 'Current', 'Deleted'],
        recipeSelections: { Old: 'old-method', Current: 'current-method' },
        equipmentParameterNames: ['Old', 'Other']
      },
      { id: 'recent', itemIds: ['Deleted'], recipeSelections: {}, equipmentParameterNames: [] }
    ]
  };

  const result = migrateFavoriteStoreItems(store, {
    aliases,
    hasRecipe: name => name === 'Current',
    isRecent: list => list.id === 'recent',
    resolveName
  });

  assert.deepEqual(store.lists[0], {
    id: 'normal',
    itemIds: ['Current'],
    recipeSelections: { Current: 'current-method' },
    equipmentParameterNames: ['Current']
  });
  assert.deepEqual(store.lists[1].itemIds, []);
  assert.deepEqual(result, {
    changed: true,
    renamed: [{ previousName: 'Old', currentName: 'Current' }],
    removed: ['Deleted'],
    conflicts: ['Current']
  });
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
      {
        id: 'recent',
        name: 'history',
        itemIds: [1, 2, 3],
        recipeSelections: {},
        equipmentParameterNames: []
      },
      {
        id: 'chosen',
        name: 'chosen',
        itemIds: [7, 8],
        recipeSelections: { 7: 'recipe-7', bad: 'recipe-x' },
        equipmentParameterNames: [],
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
