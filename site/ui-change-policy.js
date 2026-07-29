(function initUiChangePolicy(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UiChangePolicy = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function createUiChangePolicy() {
  'use strict';

  const UI_CHANGE = Object.freeze({
    SEARCH_CHANGED: 'search-changed',
    FAVORITE_CONTENT_UPDATED: 'favorite-content-updated',
    MATERIAL_TREE_CLOSED: 'material-tree-closed',
    EXCHANGE_TREE_TOGGLED: 'exchange-tree-toggled',
    RESULT_QUANTITY_CHANGED: 'result-quantity-changed',
    PURCHASE_STATUS_CHANGED: 'purchase-status-changed',
    RECIPE_METHOD_CHANGED: 'recipe-method-changed',
    RESULT_VIEW_CHANGED: 'result-view-changed'
  });

  const CONDITIONS = new Set(['always', 'favorite-materials', 'recipe-materials']);
  const TARGETS = new Set(['recipeList', 'result']);
  const SCROLL_POLICIES = new Set(['preserve', 'reset']);
  const PERSIST_TARGETS = new Set(['view', 'favorites', 'favorite-counts']);

  const definitions = {
    [UI_CHANGE.SEARCH_CHANGED]: {
      render: [
        { target: 'recipeList', when: 'always', scroll: 'reset' },
        { target: 'result', when: 'always', scroll: 'preserve' }
      ],
      persist: ['view']
    },
    [UI_CHANGE.FAVORITE_CONTENT_UPDATED]: {
      render: [
        { target: 'recipeList', when: 'always', scroll: 'preserve' },
        { target: 'result', when: 'favorite-materials', scroll: 'preserve' }
      ],
      persist: ['view', 'favorites', 'favorite-counts']
    },
    [UI_CHANGE.MATERIAL_TREE_CLOSED]: {
      render: [{ target: 'result', when: 'always', scroll: 'preserve' }],
      persist: ['view']
    },
    [UI_CHANGE.EXCHANGE_TREE_TOGGLED]: {
      render: [{ target: 'result', when: 'recipe-materials', scroll: 'preserve' }],
      persist: ['view']
    },
    [UI_CHANGE.RESULT_QUANTITY_CHANGED]: {
      render: [{ target: 'result', when: 'always', scroll: 'preserve' }],
      persist: ['view']
    },
    [UI_CHANGE.PURCHASE_STATUS_CHANGED]: {
      render: [{ target: 'result', when: 'always', scroll: 'preserve' }],
      persist: ['view']
    },
    [UI_CHANGE.RECIPE_METHOD_CHANGED]: {
      render: [
        { target: 'recipeList', when: 'always', scroll: 'preserve' },
        { target: 'result', when: 'always', scroll: 'preserve' }
      ],
      persist: ['view', 'favorites']
    },
    [UI_CHANGE.RESULT_VIEW_CHANGED]: {
      render: [{ target: 'result', when: 'always', scroll: 'reset' }],
      persist: ['view']
    }
  };

  function matchesCondition(condition, context) {
    if (condition === 'always') return true;
    if (condition === 'favorite-materials') return context.resultSourceMode === 'favorite-materials';
    if (condition === 'recipe-materials') {
      return context.resultSourceMode === 'recipe' && context.resultViewMode === 'materials';
    }
    return false;
  }

  function validateDefinitions(value) {
    const actionNames = new Set(Object.values(UI_CHANGE));
    const definitionNames = new Set(Object.keys(value));
    if (actionNames.size !== definitionNames.size || [...actionNames].some(name => !definitionNames.has(name))) {
      throw new Error('UI change definitions must cover every action exactly once');
    }

    Object.entries(value).forEach(([action, definition]) => {
      if (!Array.isArray(definition.render) || !Array.isArray(definition.persist)) {
        throw new Error(`Invalid UI change definition: ${action}`);
      }
      const renderedTargets = new Set();
      definition.render.forEach(effect => {
        if (
          !TARGETS.has(effect.target) ||
          !CONDITIONS.has(effect.when) ||
          !SCROLL_POLICIES.has(effect.scroll) ||
          renderedTargets.has(effect.target)
        ) {
          throw new Error(`Invalid render effect for UI change: ${action}`);
        }
        renderedTargets.add(effect.target);
      });
      if (definition.persist.some(target => !PERSIST_TARGETS.has(target))) {
        throw new Error(`Invalid persistence effect for UI change: ${action}`);
      }
    });
  }

  validateDefinitions(definitions);
  Object.values(definitions).forEach(definition => {
    definition.render.forEach(Object.freeze);
    Object.freeze(definition.render);
    Object.freeze(definition.persist);
    Object.freeze(definition);
  });
  Object.freeze(definitions);

  function resolveUiChangePolicy(action, context = {}) {
    const definition = definitions[action];
    if (!definition) throw new Error(`Unknown UI change: ${action}`);
    return Object.freeze({
      action,
      render: Object.freeze(
        definition.render
          .filter(effect => matchesCondition(effect.when, context))
          .map(effect =>
            Object.freeze({
              target: effect.target,
              preserveScroll: effect.scroll === 'preserve'
            })
          )
      ),
      persist: definition.persist
    });
  }

  return Object.freeze({
    UI_CHANGE,
    resolveUiChangePolicy
  });
});
