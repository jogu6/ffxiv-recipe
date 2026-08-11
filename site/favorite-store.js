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

  function resolveItemName(value, { aliases = {}, hasCurrentName = () => false } = {}) {
    let name = typeof value === 'string' ? value : '';
    if (!name) return null;
    const visited = new Set();
    while (!hasCurrentName(name) && typeof aliases[name] === 'string' && aliases[name] && !visited.has(name)) {
      visited.add(name);
      name = aliases[name];
    }
    return hasCurrentName(name) ? name : null;
  }

  function migrateFavoriteStoreItems(
    store,
    { aliases = {}, hasRecipe = () => false, isRecent = () => false, resolveName = () => null } = {}
  ) {
    const removed = new Set();
    const renamed = new Map();
    const conflicts = new Set();
    let changed = false;
    for (const list of store?.lists || []) {
      const reportRemoved = !isRecent(list);
      const names = [];
      for (const key of normalizeItemIds(list.itemIds)) {
        const name = resolveName(key);
        if (!name || !hasRecipe(name)) {
          if (reportRemoved && (name || typeof key === 'string')) removed.add(name || key);
          changed = true;
          continue;
        }
        names.push(name);
        if (key !== name) {
          changed = true;
          if (typeof key === 'string' && Object.hasOwn(aliases, key)) renamed.set(key, name);
        }
      }
      const normalizedNames = [...new Set(names)];
      if (JSON.stringify(normalizedNames) !== JSON.stringify(list.itemIds)) changed = true;
      list.itemIds = normalizedNames;

      const migratedSelections = {};
      const exactSelections = new Set();
      Object.entries(list.recipeSelections || {}).forEach(([key, recipeId]) => {
        const name = resolveName(key);
        if (name) {
          if (migratedSelections[name] && migratedSelections[name] !== recipeId) conflicts.add(name);
          if (!migratedSelections[name] || key === name || !exactSelections.has(name)) migratedSelections[name] = recipeId;
          if (key === name) exactSelections.add(name);
        }
        if (key !== name) changed = true;
      });
      if (JSON.stringify(migratedSelections) !== JSON.stringify(list.recipeSelections || {})) changed = true;
      list.recipeSelections = migratedSelections;

      const equipmentNames = normalizeItemIds(list.equipmentParameterNames)
        .map(resolveName)
        .filter(name => name && list.itemIds.includes(name));
      const normalizedEquipmentNames = [...new Set(equipmentNames)];
      if (JSON.stringify(normalizedEquipmentNames) !== JSON.stringify(list.equipmentParameterNames || [])) changed = true;
      list.equipmentParameterNames = normalizedEquipmentNames;
    }
    return {
      changed,
      renamed: [...renamed].map(([previousName, currentName]) => ({ previousName, currentName })),
      removed: [...removed],
      conflicts: [...conflicts]
    };
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
          equipmentParameterNames: isRecent(list) ? [] : normalizeItemIds(list.equipmentParameterNames),
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
      recipeSelections: {},
      equipmentParameterNames: []
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
    migrateFavoriteStoreItems,
    resolveItemName,
    withDuplicateSuffix
  });
});
