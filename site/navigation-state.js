(function initNavigationStateModel(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NavigationStateModel = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function createNavigationStateModel() {
  'use strict';

  const LIST_MODES = Object.freeze(['none', 'search', 'fav', 'equipment']);
  const RESULT_SOURCE_MODES = Object.freeze(['recipe', 'favorite-materials']);
  const RESULT_VIEW_MODES = Object.freeze(['tree', 'materials']);

  function normalizeMode(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
  }

  function normalizeListMode(value) {
    return normalizeMode(value, LIST_MODES, 'none');
  }

  function normalizeResultSourceMode(value) {
    return normalizeMode(value, RESULT_SOURCE_MODES, 'recipe');
  }

  function normalizeResultViewMode(value) {
    return normalizeMode(value, RESULT_VIEW_MODES, 'tree');
  }

  function listModeForSearch(query) {
    return String(query || '').trim() ? 'search' : 'none';
  }

  function resolveRestoredListMode({ requestedMode, search, hasEquipmentResults, hasFavoriteList }) {
    if (requestedMode === 'equipment' && hasEquipmentResults) return 'equipment';
    if (requestedMode === 'fav' && hasFavoriteList) return 'fav';
    return listModeForSearch(search);
  }

  function resultContentIdentity({
    sourceMode,
    viewMode,
    selectedRecipe = '',
    selectedRecipeId = '',
    favoriteListIds = []
  }) {
    const normalizedSource = normalizeResultSourceMode(sourceMode);
    const target =
      normalizedSource === 'favorite-materials'
        ? favoriteListIds.filter(id => typeof id === 'string').join('|')
        : `${selectedRecipe}:${selectedRecipeId}`;
    return `${normalizedSource}/${normalizeResultViewMode(viewMode)}/${target}`;
  }

  return Object.freeze({
    LIST_MODES,
    RESULT_SOURCE_MODES,
    RESULT_VIEW_MODES,
    listModeForSearch,
    normalizeListMode,
    normalizeResultSourceMode,
    normalizeResultViewMode,
    resolveRestoredListMode,
    resultContentIdentity
  });
});
