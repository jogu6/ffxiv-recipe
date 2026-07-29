(function initMaterialPurchaseState(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MaterialPurchaseState = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function createMaterialPurchaseStateModule() {
  'use strict';

  function createState({
    intermediateContext = '',
    intermediateNames = [],
    materialContext = '',
    materialNames = []
  } = {}) {
    return {
      intermediateContext: String(intermediateContext || ''),
      intermediateNames: new Set(intermediateNames),
      materialContext: String(materialContext || ''),
      materialNames: new Set(materialNames)
    };
  }

  function recipeContext(name, recipeId, variantCount) {
    const normalizedName = String(name || '');
    return Number(variantCount) > 1
      ? `recipe:${normalizedName}:${String(recipeId || '')}`
      : `recipe:${normalizedName}`;
  }

  function favoriteContext({ listIds = [], displayedListId = '', calcMode = 'sum', ringCounts = {} }) {
    const ids = listIds.length >= 1 ? listIds : [displayedListId || ''];
    const stableRingCounts = Object.fromEntries(
      Object.entries(ringCounts).sort(([left], [right]) => left.localeCompare(right, 'ja'))
    );
    return `favorite:${ids.join(',')}:${calcMode}:${JSON.stringify(stableRingCounts)}`;
  }

  function syncContext(state, context) {
    let changed = false;
    if (state.intermediateContext !== context) {
      state.intermediateContext = context;
      state.intermediateNames.clear();
      changed = true;
    }
    if (state.materialContext !== context) {
      state.materialContext = context;
      state.materialNames.clear();
      changed = true;
    }
    return changed;
  }

  function resetForContext(state, context) {
    state.intermediateContext = context;
    state.intermediateNames.clear();
    state.materialContext = context;
    state.materialNames.clear();
  }

  function retargetContext(state, context) {
    state.intermediateContext = context;
    state.materialContext = context;
  }

  function namesFor(state, kind) {
    return kind === 'material' ? state.materialNames : state.intermediateNames;
  }

  function setPurchased(state, kind, name, checked, context) {
    const names = namesFor(state, kind);
    if (kind === 'material') state.materialContext = context;
    else state.intermediateContext = context;
    if (checked) names.add(name);
    else names.delete(name);
  }

  function addAll(state, kind, names, context) {
    if (kind === 'material') state.materialContext = context;
    else state.intermediateContext = context;
    const target = namesFor(state, kind);
    names.forEach(name => target.add(name));
  }

  function clear(state, kind, context) {
    if (kind === 'material') state.materialContext = context;
    else state.intermediateContext = context;
    namesFor(state, kind).clear();
  }

  function prune(state, kind, validNames) {
    const names = namesFor(state, kind);
    const valid = validNames instanceof Set ? validNames : new Set(validNames);
    let changed = false;
    [...names].forEach(name => {
      if (valid.has(name)) return;
      names.delete(name);
      changed = true;
    });
    return changed;
  }

  function serialize(state) {
    return {
      purchasedContext: state.intermediateContext,
      purchasedNames: [...state.intermediateNames],
      purchasedMaterialContext: state.materialContext,
      purchasedMaterialNames: [...state.materialNames]
    };
  }

  return Object.freeze({
    addAll,
    clear,
    createState,
    favoriteContext,
    namesFor,
    prune,
    recipeContext,
    resetForContext,
    retargetContext,
    serialize,
    setPurchased,
    syncContext
  });
});
