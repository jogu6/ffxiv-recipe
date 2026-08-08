(function initFavoriteStoreModel(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FavoriteStoreModel = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function createFavoriteStoreModel() {
  'use strict';

  function normalizeItemIds(itemIds) {
    if (!Array.isArray(itemIds)) return [];
    const normalized = itemIds.map(value => {
      if (Number.isInteger(value) && value > 0) return value;
      if (typeof value !== 'string') return null;
      const trimmed = value.trim();
      if (!trimmed || trimmed.length > 100) return null;
      if (/^[+-]?\d+(?:\.\d+)?$/.test(trimmed)) {
        const numeric = Number(trimmed);
        return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
      }
      return trimmed;
    }).filter(value => value !== null);
    return [...new Set(normalized)];
  }

  function normalizeStoredRecipeSelections(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const normalized = {};
    Object.entries(value).forEach(([itemId, recipeId]) => {
      const key = normalizeItemIds([itemId])[0];
      if (key === undefined || typeof recipeId !== 'string' || !recipeId) return;
      normalized[String(key)] = recipeId;
    });
    return normalized;
  }

  function normalizeFavoriteListName(name, { fallbackName, maxLength }) {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    return (trimmed || fallbackName).slice(0, maxLength);
  }

  function withDuplicateSuffix(baseName, suffixNumber, maxLength) {
    if (suffixNumber === 0) return baseName.slice(0, maxLength);
    const suffix = `（${suffixNumber}）`;
    return `${baseName.slice(0, maxLength - suffix.length)}${suffix}`;
  }

  function normalizeFavoriteStore(
    stored,
    {
      createId,
      fallbackName,
      maxNameLength,
      recentListId,
      recentListName,
      recentListLimit,
      version
    }
  ) {
    const isRecent = listOrId => (typeof listOrId === 'string' ? listOrId : listOrId?.id) === recentListId;
    const storedLists = Array.isArray(stored?.lists)
      ? stored.lists.map(list => ({
          id: typeof list.id === 'string' ? list.id : createId(),
          name: normalizeFavoriteListName(list.name, { fallbackName, maxLength: maxNameLength }),
          itemIds: normalizeItemIds(list.itemIds),
          recipeSelections: isRecent(list) ? {} : normalizeStoredRecipeSelections(list.recipeSelections),
          materialSelected: Boolean(list.materialSelected) && !isRecent(list)
        }))
      : [];
    const storedRecent = storedLists.find(isRecent);
    const normalLists = storedLists.filter(list => !isRecent(list));
    normalLists.forEach(list => {
      if (list.name !== recentListName) return;
      const exists = candidate => normalLists.some(other => other !== list && other.name === candidate);
      for (let suffix = 1; suffix < 1000; suffix += 1) {
        const candidate = withDuplicateSuffix(recentListName, suffix, maxNameLength);
        if (!exists(candidate)) {
          list.name = candidate;
          break;
        }
      }
    });
    const recentList = {
      id: recentListId,
      name: recentListName,
      itemIds: normalizeItemIds(storedRecent?.itemIds).slice(0, recentListLimit),
      recipeSelections: {}
    };
    const lists = [recentList, ...normalLists];
    return {
      version,
      selectedListId: lists.some(list => list.id === stored?.selectedListId) ? stored.selectedListId : null,
      lists
    };
  }

  return Object.freeze({
    normalizeFavoriteListName,
    normalizeFavoriteStore,
    normalizeItemIds,
    normalizeStoredRecipeSelections,
    withDuplicateSuffix
  });
});
