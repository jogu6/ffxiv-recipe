const test = require('node:test');
const assert = require('node:assert/strict');
const {
  anyOneTarget,
  countsChanged,
  disableAll,
  ensureListState,
  itemCount,
  normalizeStore,
  serializeStore,
  setAll,
  setAnyOneTarget,
  setItemCount
} = require('../site/favorite-count-model.js');

test('favorite count storage keeps valid values and never restores transient enabled state', () => {
  const store = normalizeStore(
    {
      lists: {
        a: {
          enabled: true,
          counts: { 1: 0, 2: '3', 3: -1, 4: 1000, 5: 1.5 },
          anyOneTargets: { 1: false, 2: true, 3: 'true' }
        }
      }
    },
    999
  );

  assert.deepEqual(store.lists.a, {
    enabled: false,
    counts: { 1: 0, 2: 3 },
    anyOneTargets: { 1: false, 2: true }
  });
  store.lists.a.enabled = true;
  assert.deepEqual(serializeStore(store), {
    version: 1,
    lists: { a: { counts: { 1: 0, 2: 3 }, anyOneTargets: { 1: false, 2: true } } }
  });
});

test('favorite item counts default to one and clamp explicit updates', () => {
  const state = ensureListState({ version: 1, lists: {} }, 'a');

  assert.equal(itemCount(state, 10), 1);
  assert.equal(setItemCount(state, 10, -3, 999), 0);
  assert.equal(setItemCount(state, 10, 1200, 999), 999);
  assert.equal(setItemCount(state, 10, 2.5, 999), 1);
});

test('any-one targets inherit count inclusion until explicitly changed', () => {
  const state = { enabled: true, counts: { 1: 0, 2: 4 }, anyOneTargets: {} };

  assert.equal(anyOneTarget(state, 1), false);
  assert.equal(anyOneTarget(state, 2), true);
  setAnyOneTarget(state, 1, true);
  assert.equal(anyOneTarget(state, 1), true);
});

test('bulk changes and disabling preserve saved values while clearing transient modes', () => {
  const store = { version: 1, lists: { a: { enabled: true, counts: {}, anyOneTargets: {} } } };
  const state = store.lists.a;

  setAll(state, [1, 2], 0);
  assert.equal(countsChanged(state), true);
  setAll(state, [1, 2], 1, { anyOne: true });
  assert.deepEqual(state.anyOneTargets, { 1: true, 2: true });
  disableAll(store);
  assert.equal(state.enabled, false);
  assert.equal(countsChanged(state), false);
  assert.deepEqual(state.counts, { 1: 0, 2: 0 });
});
