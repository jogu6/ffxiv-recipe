(function initFavoriteCountModel(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FavoriteCountModel = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function createFavoriteCountModule() {
  'use strict';

  const emptyState = () => ({ enabled: false, counts: {}, anyOneTargets: {} });

  function normalizeStore(value, maxCount) {
    const lists = {};
    Object.entries(value?.lists || {}).forEach(([listId, state]) => {
      const counts = {};
      Object.entries(state?.counts || {}).forEach(([itemId, countValue]) => {
        const count = Number(countValue);
        if (Number.isInteger(count) && count >= 0 && count <= maxCount) counts[itemId] = count;
      });
      const anyOneTargets = {};
      Object.entries(state?.anyOneTargets || {}).forEach(([itemId, checked]) => {
        if (typeof checked === 'boolean') anyOneTargets[itemId] = checked;
      });
      lists[listId] = { enabled: false, counts, anyOneTargets };
    });
    return { version: 1, lists };
  }

  function serializeStore(store) {
    const lists = Object.fromEntries(
      Object.entries(store?.lists || {}).map(([listId, state]) => [
        listId,
        {
          counts: state.counts || {},
          anyOneTargets: state.anyOneTargets || {}
        }
      ])
    );
    return { version: 1, lists };
  }

  function ensureListState(store, listId) {
    if (!store.lists[listId]) store.lists[listId] = emptyState();
    return store.lists[listId];
  }

  function itemCount(state, itemId) {
    const value = state?.counts?.[itemId];
    return Number.isInteger(value) ? value : 1;
  }

  function setItemCount(state, itemId, value, maxCount) {
    state.counts[itemId] = Math.max(0, Math.min(maxCount, Number.isInteger(value) ? value : 1));
    return state.counts[itemId];
  }

  function anyOneTarget(state, itemId) {
    if (typeof state?.anyOneTargets?.[itemId] === 'boolean') return state.anyOneTargets[itemId];
    return itemCount(state, itemId) > 0;
  }

  function setAnyOneTarget(state, itemId, checked) {
    state.anyOneTargets ||= {};
    state.anyOneTargets[itemId] = Boolean(checked);
    return state.anyOneTargets[itemId];
  }

  function setAll(state, itemIds, value, { anyOne = false } = {}) {
    itemIds.forEach(itemId => {
      if (anyOne) setAnyOneTarget(state, itemId, value);
      else state.counts[itemId] = value;
    });
  }

  function countsChanged(state) {
    return Boolean(state?.enabled) && Object.values(state.counts || {}).some(value => value !== 1);
  }

  function disableAll(store) {
    Object.values(store?.lists || {}).forEach(state => {
      state.enabled = false;
    });
  }

  return Object.freeze({
    anyOneTarget,
    countsChanged,
    disableAll,
    emptyState,
    ensureListState,
    itemCount,
    normalizeStore,
    serializeStore,
    setAll,
    setAnyOneTarget,
    setItemCount
  });
});
