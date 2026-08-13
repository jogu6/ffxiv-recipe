(function initViewStateModel(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ViewStateModel = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function createViewStateModel() {
  'use strict';

  const SCROLL_KEYS = Object.freeze(['recipeList', 'usesList', 'treeContainer', 'panelRight']);

  function stringValue(value, fallback = '') {
    return typeof value === 'string' ? value : fallback;
  }

  function stringArray(value) {
    return Array.isArray(value) ? value.filter(entry => typeof entry === 'string') : [];
  }

  function enumValue(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
  }

  function nonNegativeInteger(value) {
    const number = parseInt(value, 10);
    return Number.isFinite(number) ? Math.max(0, number) : 0;
  }

  function normalizeBooleanMap(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(([key, entry]) => typeof key === 'string' && typeof entry === 'boolean')
    );
  }

  function normalizeRingCounts(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const normalized = {};
    Object.entries(value).forEach(([key, countOrMap]) => {
      if ([0, 1, 2].includes(countOrMap)) {
        normalized[key] = countOrMap;
        return;
      }
      if (!countOrMap || typeof countOrMap !== 'object' || Array.isArray(countOrMap)) return;
      const counts = Object.fromEntries(Object.entries(countOrMap).filter(([, count]) => [0, 1, 2].includes(count)));
      if (Object.keys(counts).length > 0) normalized[key] = counts;
    });
    return normalized;
  }

  function normalizeScroll(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return Object.fromEntries(SCROLL_KEYS.map(key => [key, nonNegativeInteger(source[key])]));
  }

  function inspectViewState(value, expectedDataVersion) {
    if (!value || typeof value !== 'object' || value.v !== 1) {
      return Object.freeze({ status: 'unsupported', state: null });
    }
    if (value.dataVersion !== expectedDataVersion) {
      return Object.freeze({ status: 'stale', state: null });
    }

    const input = value.input || {};
    const selected = value.selected || {};
    const view = value.view || {};
    const favoriteMaterials = value.favoriteMaterials || {};
    const materials = value.materials || {};
    const equipmentSearch = value.equipmentSearch || {};
    const state = {
      input: {
        search: stringValue(input.search),
        count: stringValue(input.count, '1'),
        active: enumValue(input.active, ['searchBox', 'countInput'], '')
      },
      selected: {
        recipe: stringValue(selected.recipe),
        recipeId: stringValue(selected.recipeId),
        favoriteListId: stringValue(selected.favoriteListId),
        usesItem: stringValue(selected.usesItem)
      },
      view: {
        listMode: enumValue(view.listMode, ['none', 'search', 'fav', 'equipment'], 'none'),
        sourceMode: enumValue(view.sourceMode, ['recipe', 'favorite-materials'], 'recipe'),
        resultMode: enumValue(view.resultMode, ['tree', 'materials'], 'tree'),
        mobilePanel: enumValue(view.mobilePanel, ['', 'left', 'middle', 'right'], ''),
        favoriteListsOpen:
          view.favoriteListsOpen === undefined
            ? view.sourceMode === 'favorite-materials'
            : view.favoriteListsOpen === true,
        favoriteListActionsId: stringValue(view.favoriteListActionsId)
      },
      favoriteMaterials: {
        listIds: stringArray(favoriteMaterials.listIds),
        ringCounts: normalizeRingCounts(favoriteMaterials.ringCounts),
        calcMode: enumValue(favoriteMaterials.calcMode, ['sum', 'counts', 'any-one'], 'sum'),
        checkedCalcMode: enumValue(favoriteMaterials.checkedCalcMode, ['sum', 'any-one'], 'sum'),
        anyItemProductionExpanded: favoriteMaterials.anyItemProductionExpanded === true,
        anyListProductionExpanded: favoriteMaterials.anyListProductionExpanded === true,
        listProductionExpanded: normalizeBooleanMap(favoriteMaterials.listProductionExpanded)
      },
      materials: {
        sections: normalizeBooleanMap(materials.sections),
        purchasedContext: stringValue(materials.purchasedContext),
        purchasedNames: stringArray(materials.purchasedNames),
        preparedNames: stringArray(materials.preparedNames),
        purchasedMaterialContext: stringValue(materials.purchasedMaterialContext),
        purchasedMaterialNames: stringArray(materials.purchasedMaterialNames),
        imageCheckContext: stringValue(materials.imageCheckContext),
        checkedImageKeys: stringArray(materials.checkedImageKeys)
      },
      equipmentSearch: {
        open: equipmentSearch.open === true,
        job: stringValue(equipmentSearch.job),
        equipLevel: stringValue(equipmentSearch.equipLevel),
        itemLevel: stringValue(equipmentSearch.itemLevel),
        slot: stringValue(equipmentSearch.slot, 'all'),
        results: stringArray(equipmentSearch.results),
        parameterNames: stringArray(equipmentSearch.parameterNames)
      },
      scroll: normalizeScroll(value.scroll)
    };
    return Object.freeze({ status: 'ok', state });
  }

  return Object.freeze({
    SCROLL_KEYS,
    inspectViewState,
    normalizeBooleanMap,
    normalizeRingCounts,
    normalizeScroll
  });
});
