(function initMaterialPurchaseState(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MaterialPurchaseState = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function createMaterialPurchaseStateModule() {
  'use strict';

  function createState({
    intermediateContext = '',
    intermediateNames = [],
    preparedCounts = {},
    preparedNames = [],
    materialContext = '',
    materialNames = []
  } = {}) {
    return {
      intermediateContext: String(intermediateContext || ''),
      intermediateNames: new Set(intermediateNames),
      preparedCounts: new Map([
        ...Object.entries(preparedCounts || {}).map(([name, count]) => [name, Number(count)]),
        ...preparedNames.map(name => [name, Number.MAX_SAFE_INTEGER])
      ].filter(([, count]) => Number.isSafeInteger(count) && count > 0)),
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
      state.preparedCounts.clear();
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
    state.preparedCounts.clear();
    state.materialContext = context;
    state.materialNames.clear();
  }

  function retargetContext(state, context) {
    state.intermediateContext = context;
    state.materialContext = context;
  }

  function namesFor(state, kind) {
    if (kind === 'material') return state.materialNames;
    if (kind === 'prepared') return state.preparedCounts;
    return state.intermediateNames;
  }

  function setPurchased(state, kind, name, checked, context) {
    const names = namesFor(state, kind);
    if (kind === 'material') state.materialContext = context;
    else state.intermediateContext = context;
    if (checked) {
      names.add(name);
      if (kind === 'intermediate') state.preparedCounts.delete(name);
    }
    else names.delete(name);
  }

  function setPreparedCount(state, name, count, context) {
    state.intermediateContext = context;
    const normalizedCount = Number(count);
    if (Number.isSafeInteger(normalizedCount) && normalizedCount > 0) {
      state.preparedCounts.set(name, normalizedCount);
      state.intermediateNames.delete(name);
    } else {
      state.preparedCounts.delete(name);
    }
  }

  function addAll(state, kind, names, context) {
    if (kind === 'material') state.materialContext = context;
    else state.intermediateContext = context;
    const target = namesFor(state, kind);
    names.forEach(name => {
      if (kind === 'intermediate' && state.preparedCounts.has(name)) return;
      target.add(name);
    });
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
    const entries = names instanceof Map ? [...names.keys()] : [...names];
    entries.forEach(name => {
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
      preparedCounts: Object.fromEntries(state.preparedCounts),
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
    setPreparedCount,
    syncContext
  });
});
