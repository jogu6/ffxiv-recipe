(function exposeRecipeCalculation(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.RecipeCalculation = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function createRecipeCalculation() {
  'use strict';

  function requirePositiveInteger(value, label) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`${label} must be a positive safe integer`);
    }
    return value;
  }

  function checkedAdd(left, right, label) {
    const value = left + right;
    if (!Number.isSafeInteger(value)) throw new RangeError(`${label} exceeds the safe integer range`);
    return value;
  }

  function checkedMultiply(left, right, label) {
    const value = left * right;
    if (!Number.isSafeInteger(value)) throw new RangeError(`${label} exceeds the safe integer range`);
    return value;
  }

  function calculateCraft(needed, recipeYield) {
    requirePositiveInteger(needed, 'needed');
    requirePositiveInteger(recipeYield, 'recipe yield');
    const craftTimes = Math.ceil(needed / recipeYield);
    const produced = checkedMultiply(craftTimes, recipeYield, 'produced quantity');
    return { needed, craftTimes, produced, surplus: produced - needed };
  }

  function validateRequestedCount(value, maximum = 999) {
    requirePositiveInteger(maximum, 'maximum requested count');
    requirePositiveInteger(value, 'requested count');
    if (value > maximum) throw new RangeError(`requested count must not exceed ${maximum}`);
    return value;
  }

  function validateRecipe(name, recipe) {
    if (!recipe || typeof recipe !== 'object') throw new TypeError(`Invalid recipe: ${name}`);
    requirePositiveInteger(recipe.yield, `${name} yield`);
    if (!Array.isArray(recipe.ingredients)) throw new TypeError(`${name} ingredients must be an array`);
    recipe.ingredients.forEach((ingredient, index) => {
      if (!ingredient || typeof ingredient.name !== 'string' || ingredient.name.length === 0) {
        throw new TypeError(`${name} ingredient ${index} has no name`);
      }
      requirePositiveInteger(ingredient.qty, `${name} ingredient ${ingredient.name} quantity`);
    });
  }

  function assertAcyclic(recipes, rootNames, exchangeTypes, terminalNames) {
    const visiting = new Set();
    const visited = new Set();

    function visit(name) {
      const recipe = recipes[name];
      if (!recipe || terminalNames.has(name) || exchangeTypes.has(String(recipe.craftType))) return;
      validateRecipe(name, recipe);
      if (visiting.has(name)) throw new Error(`Recipe cycle detected at ${name}`);
      if (visited.has(name)) return;
      visiting.add(name);
      recipe.ingredients.forEach(ingredient => visit(ingredient.name));
      visiting.delete(name);
      visited.add(name);
    }

    rootNames.forEach(visit);
  }

  function calculateRequirements(recipes, roots, options = {}) {
    if (!recipes || typeof recipes !== 'object') throw new TypeError('recipes must be an object');
    if (!Array.isArray(roots)) throw new TypeError('roots must be an array');
    const exchangeTypes = new Set(
      [...(options.exchangeCraftTypes || [])].map(value => String(value))
    );
    const terminalNames = new Set(options.terminalNames || []);
    const rootNames = new Set();
    const demand = new Map();

    roots.forEach((rootItem, index) => {
      if (!rootItem || typeof rootItem.name !== 'string' || rootItem.name.length === 0) {
        throw new TypeError(`root ${index} has no name`);
      }
      const qty = requirePositiveInteger(rootItem.qty, `root ${rootItem.name} quantity`);
      rootNames.add(rootItem.name);
      demand.set(
        rootItem.name,
        checkedAdd(demand.get(rootItem.name) || 0, qty, `${rootItem.name} demand`)
      );
    });

    assertAcyclic(recipes, rootNames, exchangeTypes, terminalNames);

    const craftTimes = new Map();
    const parents = new Map();
    const queue = [...demand.keys()];
    const queued = new Set(queue);

    while (queue.length > 0) {
      const name = queue.shift();
      queued.delete(name);
      const recipe = recipes[name];
      if (!recipe) continue;
      validateRecipe(name, recipe);

      const info = calculateCraft(demand.get(name), recipe.yield);
      const previousCraftTimes = craftTimes.get(name) || 0;
      if (info.craftTimes <= previousCraftTimes) continue;
      craftTimes.set(name, info.craftTimes);
      if (terminalNames.has(name) || exchangeTypes.has(String(recipe.craftType))) continue;

      const addedCraftTimes = info.craftTimes - previousCraftTimes;
      recipe.ingredients.forEach(ingredient => {
        const addedDemand = checkedMultiply(
          ingredient.qty,
          addedCraftTimes,
          `${ingredient.name} demand increment`
        );
        demand.set(
          ingredient.name,
          checkedAdd(demand.get(ingredient.name) || 0, addedDemand, `${ingredient.name} demand`)
        );
        if (!parents.has(ingredient.name)) parents.set(ingredient.name, new Set());
        parents.get(ingredient.name).add(name);
        if (!queued.has(ingredient.name)) {
          queue.push(ingredient.name);
          queued.add(ingredient.name);
        }
      });
    }

    const states = new Map();
    demand.forEach((needed, name) => {
      const recipe = recipes[name];
      const craft = recipe ? calculateCraft(needed, recipe.yield) : null;
      states.set(name, {
        name,
        needed,
        craftTimes: craft?.craftTimes || 0,
        produced: craft?.produced || needed,
        surplus: craft?.surplus || 0,
        recipe: recipe || null,
        isRoot: rootNames.has(name),
        isExchange: Boolean(recipe && exchangeTypes.has(String(recipe.craftType))),
        isTerminal: Boolean(!recipe || terminalNames.has(name) || exchangeTypes.has(String(recipe.craftType))),
        parents: new Set(parents.get(name) || [])
      });
    });

    return { states, roots: rootNames, exchangeTypes };
  }

  function mergeAlternativeRequirements(results) {
    if (!Array.isArray(results)) throw new TypeError('results must be an array');
    const states = new Map();
    const roots = new Set();
    const exchangeTypes = new Set();

    results.forEach((result, resultIndex) => {
      if (!(result?.states instanceof Map) || !(result.roots instanceof Set)) {
        throw new TypeError(`Invalid requirement result: ${resultIndex}`);
      }
      result.roots.forEach(name => roots.add(name));
      result.exchangeTypes?.forEach(type => exchangeTypes.add(type));
      result.states.forEach((state, name) => {
        const current = states.get(name);
        if (current && current.needed > state.needed) return;
        if (current && current.needed === state.needed) {
          current.parents = new Set([...current.parents, ...state.parents]);
          current.isRoot = current.isRoot || state.isRoot;
          return;
        }
        states.set(name, {
          ...state,
          parents: new Set(state.parents)
        });
      });
    });

    const terminalDemand = new Map();
    const terminalParents = new Map();
    const nonRootIntermediateNames = new Set();
    results.forEach(result => {
      result.states.forEach(state => {
        if (!state.isRoot && state.recipe && !state.isTerminal) nonRootIntermediateNames.add(state.name);
      });
    });
    const addTerminalDemand = (name, addedDemand, parentNames = []) => {
      terminalDemand.set(
        name,
        checkedAdd(terminalDemand.get(name) || 0, addedDemand, `${name} alternative demand`)
      );
      if (!terminalParents.has(name)) terminalParents.set(name, new Set());
      parentNames.forEach(parentName => terminalParents.get(name).add(parentName));
    };
    states.forEach(state => {
      if (state.isTerminal && state.isRoot) terminalDemand.set(state.name, state.needed);
    });
    const rootTerminalMaximums = new Map();
    results.forEach(result => {
      const resultDemand = new Map();
      const resultParents = new Map();
      result.roots.forEach(rootName => {
        const parent = result.states.get(rootName);
        if (!parent?.recipe || parent.isTerminal) return;
        parent.recipe.ingredients.forEach(ingredient => {
          const child = result.states.get(ingredient.name);
          if (!child?.isTerminal) return;
          const addedDemand = checkedMultiply(
            ingredient.qty,
            parent.craftTimes,
            `${ingredient.name} alternative root demand increment`
          );
          resultDemand.set(
            ingredient.name,
            checkedAdd(
              resultDemand.get(ingredient.name) || 0,
              addedDemand,
              `${ingredient.name} alternative root demand`
            )
          );
          if (!resultParents.has(ingredient.name)) resultParents.set(ingredient.name, new Set());
          resultParents.get(ingredient.name).add(parent.name);
        });
      });
      resultDemand.forEach((needed, name) => {
        const current = rootTerminalMaximums.get(name);
        if (current && current.needed > needed) return;
        if (current && current.needed === needed) {
          resultParents.get(name)?.forEach(parentName => current.parents.add(parentName));
          return;
        }
        rootTerminalMaximums.set(name, {
          needed,
          parents: new Set(resultParents.get(name) || [])
        });
      });
    });
    rootTerminalMaximums.forEach((entry, name) => {
      addTerminalDemand(name, entry.needed, entry.parents);
    });
    states.forEach(parent => {
      if (!parent.recipe || parent.isTerminal || !nonRootIntermediateNames.has(parent.name)) return;
      parent.recipe.ingredients.forEach(ingredient => {
        const child = states.get(ingredient.name);
        if (!child?.isTerminal) return;
        const addedDemand = checkedMultiply(
          ingredient.qty,
          parent.craftTimes,
          `${ingredient.name} alternative demand increment`
        );
        addTerminalDemand(ingredient.name, addedDemand, [parent.name]);
      });
    });

    terminalDemand.forEach((needed, name) => {
      const state = states.get(name);
      if (!state) return;
      const craft = state.recipe ? calculateCraft(needed, state.recipe.yield) : null;
      states.set(name, {
        ...state,
        needed,
        craftTimes: craft?.craftTimes || 0,
        produced: craft?.produced || needed,
        surplus: craft?.surplus || 0,
        parents: new Set(terminalParents.get(name) || state.parents)
      });
    });

    states.forEach((state, name) => {
      state.isRoot = roots.has(name);
    });
    return { states, roots, exchangeTypes };
  }

  function createIntermediateForest(result, predicate = () => true) {
    const nodes = new Map();
    result.states.forEach(state => {
      if (state.recipe && !state.isRoot && !state.isExchange && predicate(state)) {
        nodes.set(state.name, {
          name: state.name,
          qty: state.needed,
          craftTimes: state.craftTimes,
          produced: state.produced,
          surplus: state.surplus,
          children: []
        });
      }
    });

    const roots = [];
    nodes.forEach((node, name) => {
      const parentNames = [...result.states.get(name).parents];
      if (parentNames.length === 1 && nodes.has(parentNames[0])) nodes.get(parentNames[0]).children.push(node);
      else roots.push(node);
    });
    return roots;
  }

  return {
    calculateCraft,
    calculateRequirements,
    createIntermediateForest,
    mergeAlternativeRequirements,
    validateRequestedCount
  };
});
