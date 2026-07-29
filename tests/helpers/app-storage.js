const assert = require('node:assert/strict');

const STORAGE_KEYS = Object.freeze({
  favoritesV2: 'ff14_favorite_lists_v2',
  favoritesV3: 'ff14_favorite_lists_v3',
  favoriteCounts: 'ff14_favorite_item_counts_v1',
  searchHistory: 'ff14_search_history',
  viewState: 'ff14_view_state_v1'
});

function favoriteList({ id, name, itemIds = [], recipeSelections = {}, materialSelected = false }) {
  assert.equal(typeof id, 'string');
  assert.notEqual(id, '');
  assert.equal(typeof name, 'string');
  assert.notEqual(name, '');
  assert.equal(Array.isArray(itemIds), true);
  return {
    id,
    name,
    itemIds: [...itemIds],
    recipeSelections: { ...recipeSelections },
    materialSelected: Boolean(materialSelected)
  };
}

function favoriteStore({ version = 3, selectedListId = null, lists = [] }) {
  assert.equal(Number.isInteger(version), true);
  assert.equal(Array.isArray(lists), true);
  const ids = lists.map(list => list.id);
  assert.equal(new Set(ids).size, ids.length, 'favorite list ids must be unique');
  if (selectedListId !== null) {
    assert.equal(ids.includes(selectedListId), true, 'selected favorite list must exist');
  }
  return {
    version,
    selectedListId,
    lists: lists.map(list => structuredClone(list))
  };
}

async function seedAppStorage(page, values, { preserveExisting = [] } = {}) {
  const entries = Object.entries(values).map(([name, value]) => {
    const key = STORAGE_KEYS[name];
    assert.ok(key, `unknown app storage fixture: ${name}`);
    assert.notEqual(value, undefined, `storage fixture cannot be undefined: ${name}`);
    return [key, JSON.stringify(value)];
  });
  const preservedKeys = preserveExisting.map(name => {
    const key = STORAGE_KEYS[name];
    assert.ok(key, `unknown preserved storage fixture: ${name}`);
    return key;
  });
  await page.addInitScript(
    ({ seededEntries, skipKeys }) => {
      seededEntries.forEach(([key, value]) => {
        if (skipKeys.includes(key) && localStorage.getItem(key) !== null) return;
        localStorage.setItem(key, value);
      });
    },
    { seededEntries: entries, skipKeys: preservedKeys }
  );
}

module.exports = {
  STORAGE_KEYS,
  favoriteList,
  favoriteStore,
  seedAppStorage
};
