const test = require('node:test');
const assert = require('node:assert/strict');
const { favoriteList, favoriteStore } = require('./helpers/app-storage.js');

test('favorite storage fixtures clone caller-owned arrays and objects', () => {
  const itemIds = ['1'];
  const recipeSelections = { 1: 'recipe-a' };
  const list = favoriteList({
    id: 'list-a',
    name: 'リストA',
    itemIds,
    recipeSelections,
    materialSelected: true
  });
  const store = favoriteStore({ selectedListId: list.id, lists: [list] });

  itemIds.push('2');
  recipeSelections[2] = 'recipe-b';
  list.itemIds.push('3');

  assert.deepEqual(store, {
    version: 3,
    selectedListId: 'list-a',
    lists: [
      {
        id: 'list-a',
        name: 'リストA',
        itemIds: ['1'],
        recipeSelections: { 1: 'recipe-a' },
        materialSelected: true
      }
    ]
  });
});

test('favorite storage fixtures reject ambiguous selected and duplicate list ids', () => {
  const list = favoriteList({ id: 'list-a', name: 'リストA' });
  assert.throws(() => favoriteStore({ selectedListId: 'missing', lists: [list] }), /must exist/);
  assert.throws(() => favoriteStore({ lists: [list, list] }), /must be unique/);
});
