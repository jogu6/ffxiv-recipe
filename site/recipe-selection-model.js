(function initRecipeSelectionModel(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RecipeSelectionModel = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function createRecipeSelectionModule() {
  'use strict';

  function createRecipeSelectionModel({
    recipes,
    recipeVariants,
    defaultRecipeIds,
    defaultRecipeForName,
    itemNameForId,
    itemIdForName,
    normalizeSelections
  }) {
    const defaultRecipeMap = Object.assign(Object.create(null), recipes);
    Object.entries(recipeVariants).forEach(([name, variants]) => {
      if (variants.length > 1) defaultRecipeMap[name] = defaultRecipeForName(name);
    });
    Object.freeze(defaultRecipeMap);

    function recipeMapForSelections(recipeSelections = {}) {
      const contextualRecipes = Object.create(defaultRecipeMap);
      Object.entries(normalizeSelections(recipeSelections)).forEach(([itemId, recipeId]) => {
        const name = itemNameForId(itemId);
        const variant = (recipeVariants[name] || []).find(candidate => candidate.recipeId === recipeId);
        if (name && variant) {
          Object.defineProperty(contextualRecipes, name, {
            configurable: true,
            enumerable: true,
            value: variant,
            writable: true
          });
        }
      });
      return contextualRecipes;
    }

    function reachableMultiRecipeNames(rootNames, recipeSelections = {}) {
      const recipeMap = recipeMapForSelections(recipeSelections);
      const reachable = [];
      const visited = new Set();
      const stack = [...rootNames];
      while (stack.length > 0) {
        const name = stack.pop();
        if (!name || visited.has(name)) continue;
        visited.add(name);
        const recipe = recipeMap[name];
        if (!recipe) continue;
        if ((recipeVariants[name] || []).length > 1) reachable.push(name);
        recipe.ingredients.forEach(ingredient => {
          if (recipeMap[ingredient.name]) stack.push(ingredient.name);
        });
      }
      return reachable;
    }

    function effectiveSelectionSignature(recipeSelections = {}) {
      return JSON.stringify(
        Object.entries(normalizeSelections(recipeSelections))
          .filter(([itemId, recipeId]) => {
            const name = itemNameForId(itemId);
            return defaultRecipeIds[name] !== recipeId;
          })
          .sort(([left], [right]) => left.localeCompare(right, 'ja'))
      );
    }

    function unresolvedSelections(rootNames, recipeSelections = {}) {
      const recipeMap = recipeMapForSelections(recipeSelections);
      const selections = normalizeSelections(recipeSelections);
      const unresolved = [];
      const visited = new Set();
      const stack = [...rootNames];
      while (stack.length > 0) {
        const name = stack.pop();
        if (!name || visited.has(name)) continue;
        visited.add(name);
        const recipe = recipeMap[name];
        if (!recipe) continue;
        const variants = recipeVariants[name] || [];
        const itemId = itemIdForName(name);
        if (variants.length > 1 && itemId && !selections[String(itemId)]) {
          unresolved.push({ name, recipe });
        }
        recipe.ingredients.forEach(ingredient => {
          if (recipeMap[ingredient.name]) stack.push(ingredient.name);
        });
      }
      return unresolved.sort((left, right) => left.name.localeCompare(right.name, 'ja'));
    }

    function variantForSelection(name, recipeSelections = {}) {
      const itemId = itemIdForName(name);
      const recipeId = normalizeSelections(recipeSelections)[String(itemId)];
      return (
        (recipeVariants[name] || []).find(variant => variant.recipeId === recipeId) ||
        defaultRecipeForName(name)
      );
    }

    return Object.freeze({
      effectiveSelectionSignature,
      reachableMultiRecipeNames,
      recipeMapForSelections,
      unresolvedSelections,
      variantForSelection
    });
  }

  return Object.freeze({ createRecipeSelectionModel });
});
