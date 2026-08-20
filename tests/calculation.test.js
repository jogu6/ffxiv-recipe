const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  calculateCraft,
  calculateRequirements,
  compareRequirementResults,
  createIntermediateForest,
  mergeAlternativeRequirements,
  mergeSummedRequirements,
  validateRequestedCount
} = require('../site/calculation.js');
const { loverWeapons } = require('./fixtures/favorite-share-codes.js');

const exchangeCraftTypes = new Set(['8', '9']);

function recipe(recipeYield, ingredients = [], craftType = '0') {
  return { yield: recipeYield, ingredients, craftType };
}

function requirements(recipes, roots, options = {}) {
  return calculateRequirements(recipes, roots, { exchangeCraftTypes, ...options });
}

function loadRealRecipeData() {
  const file = path.join(__dirname, '..', 'site', 'data', 'Item.json');
  const items = JSON.parse(fs.readFileSync(file, 'utf8')).Items;
  const legacy = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'site', 'data', 'legacy-item-ids.json'), 'utf8')).Items;
  const recipes = {};
  const itemNamesById = new Map();

  Object.entries(legacy).forEach(([id, name]) => itemNamesById.set(Number(id), name));
  items.forEach(item => {
    if (!item.Recipe || item.Recipe.CraftType === undefined) return;
    recipes[item.Name] = recipe(
      Number(item.Recipe.AmountResult || 1),
      item.Recipe.Ingredients.map(ingredient => ({
        name: ingredient.Name || itemNamesById.get(Number(ingredient.ItemID)),
        qty: Number(ingredient.Amount || 1)
      })),
      String(item.Recipe.CraftType)
    );
  });

  return { recipes, itemNamesById };
}

test('calculates exact and rounded craft quantities', () => {
  assert.deepEqual(calculateCraft(6, 3), {
    needed: 6,
    craftTimes: 2,
    produced: 6,
    surplus: 0
  });
  assert.deepEqual(calculateCraft(7, 3), {
    needed: 7,
    craftTimes: 3,
    produced: 9,
    surplus: 2
  });
});

test('accepts only requested counts from 1 through 999', () => {
  assert.equal(validateRequestedCount(1), 1);
  assert.equal(validateRequestedCount(999), 999);
  for (const value of [NaN, '1', 0, -1, 1.5, 1000]) {
    assert.throws(() => validateRequestedCount(value));
  }
});

test('propagates integer demand through multiple recipe levels', () => {
  const recipes = {
    Product: recipe(1, [{ name: 'Part', qty: 2 }]),
    Part: recipe(3, [{ name: 'Ore', qty: 4 }])
  };
  const result = requirements(recipes, [{ name: 'Product', qty: 2 }]);

  assert.equal(result.states.get('Part').needed, 4);
  assert.equal(result.states.get('Part').craftTimes, 2);
  assert.equal(result.states.get('Part').surplus, 2);
  assert.equal(result.states.get('Ore').needed, 8);
});

test('uses prepared intermediate quantities once and crafts only the remainder', () => {
  const recipes = {
    Product: recipe(1, [{ name: 'Part', qty: 7 }]),
    Part: recipe(3, [{ name: 'Ore', qty: 4 }])
  };
  const partial = requirements(recipes, [{ name: 'Product', qty: 1 }], {
    availableCounts: new Map([['Part', 2]])
  });
  const part = partial.states.get('Part');

  assert.equal(part.needed, 7);
  assert.equal(part.availableUsed, 2);
  assert.equal(part.craftNeeded, 5);
  assert.equal(part.craftTimes, 2);
  assert.equal(part.produced, 8);
  assert.equal(part.surplus, 1);
  assert.equal(partial.states.get('Ore').needed, 8);

  const complete = requirements(recipes, [{ name: 'Product', qty: 1 }], {
    availableCounts: { Part: 7 }
  });
  assert.equal(complete.states.get('Part').craftTimes, 0);
  assert.equal(complete.states.has('Ore'), false);
});

test('prepared quantities propagate through every lower material and expose exact calculation changes', () => {
  const recipes = {
    Product: recipe(1, [{ name: 'Part', qty: 7 }]),
    Part: recipe(3, [
      { name: 'Ore', qty: 4 },
      { name: 'Crystal', qty: 2 },
      { name: 'ExchangeItem', qty: 1 }
    ]),
    ExchangeItem: recipe(1, [{ name: 'Token', qty: 10 }], '9')
  };
  const before = requirements(recipes, [{ name: 'Product', qty: 1 }]);
  const after = requirements(recipes, [{ name: 'Product', qty: 1 }], {
    availableCounts: { Part: 2 }
  });
  const changes = compareRequirementResults(before, after);

  assert.deepEqual(
    ['Part', 'Ore', 'Crystal', 'ExchangeItem'].map(name => [name, after.states.get(name)?.needed || 0]),
    [['Part', 7], ['Ore', 8], ['Crystal', 4], ['ExchangeItem', 2]]
  );
  assert.deepEqual(
    changes.get('Part'),
    {
      name: 'Part',
      before: { needed: 7, availableUsed: 0, craftNeeded: 7, craftTimes: 3, produced: 9, surplus: 2 },
      after: { needed: 7, availableUsed: 2, craftNeeded: 5, craftTimes: 2, produced: 8, surplus: 1 },
      changedFields: ['availableUsed', 'craftNeeded', 'craftTimes', 'produced', 'surplus']
    }
  );
  for (const name of ['Ore', 'Crystal']) {
    assert.deepEqual(changes.get(name).changedFields, ['needed', 'craftNeeded', 'produced']);
  }
  assert.deepEqual(
    changes.get('ExchangeItem').changedFields,
    ['needed', 'craftNeeded', 'craftTimes', 'produced']
  );
  assert.equal(after.states.has('Token'), false);
});

test('prepared shared intermediates are consumed once after aggregate demand', () => {
  const recipes = {
    ProductA: recipe(1, [{ name: 'Shared', qty: 2 }]),
    ProductB: recipe(1, [{ name: 'Shared', qty: 2 }]),
    Shared: recipe(3, [{ name: 'Ore', qty: 5 }])
  };
  const result = requirements(recipes, [
    { name: 'ProductA', qty: 1 },
    { name: 'ProductB', qty: 1 }
  ], { availableCounts: { Shared: 1 } });

  assert.deepEqual(
    Object.fromEntries(['needed', 'availableUsed', 'craftNeeded', 'craftTimes', 'produced', 'surplus']
      .map(field => [field, result.states.get('Shared')[field]])),
    { needed: 4, availableUsed: 1, craftNeeded: 3, craftTimes: 1, produced: 4, surplus: 0 }
  );
  assert.equal(result.states.get('Ore').needed, 5);
});

test('full preparation removes every lower requirement and records zero-valued results', () => {
  const recipes = {
    Product: recipe(1, [{ name: 'Part', qty: 2 }]),
    Part: recipe(2, [{ name: 'Subpart', qty: 3 }]),
    Subpart: recipe(1, [{ name: 'Ore', qty: 4 }])
  };
  const before = requirements(recipes, [{ name: 'Product', qty: 1 }]);
  const after = requirements(recipes, [{ name: 'Product', qty: 1 }], { availableCounts: { Part: 2 } });
  const changes = compareRequirementResults(before, after);

  assert.equal(after.states.get('Part').craftNeeded, 0);
  assert.equal(after.states.get('Part').craftTimes, 0);
  assert.equal(after.states.has('Subpart'), false);
  assert.equal(after.states.has('Ore'), false);
  assert.equal(changes.get('Subpart').after.needed, 0);
  assert.equal(changes.get('Ore').after.needed, 0);
});

test('calculates contextual recipe overrides inherited from an immutable default map', () => {
  const defaults = Object.freeze({
    Product: recipe(1, [{ name: 'Part', qty: 2 }]),
    Part: recipe(1, [{ name: 'DefaultOre', qty: 3 }])
  });
  const contextualRecipes = Object.create(defaults);
  Object.defineProperty(contextualRecipes, 'Part', {
    enumerable: true,
    value: recipe(2, [{ name: 'SelectedOre', qty: 5 }])
  });
  const result = requirements(contextualRecipes, [{ name: 'Product', qty: 1 }]);

  assert.equal(result.states.get('Part').needed, 2);
  assert.equal(result.states.get('Part').craftTimes, 1);
  assert.equal(result.states.get('SelectedOre').needed, 5);
  assert.equal(result.states.has('DefaultOre'), false);
});

test('aggregates shared intermediate demand before rounding craft counts', () => {
  const recipes = {
    A: recipe(1, [{ name: 'Shared', qty: 1 }]),
    B: recipe(1, [{ name: 'Shared', qty: 1 }]),
    Shared: recipe(3, [{ name: 'Ore', qty: 5 }])
  };
  const result = requirements(recipes, [
    { name: 'A', qty: 1 },
    { name: 'B', qty: 1 }
  ]);

  assert.equal(result.states.get('Shared').needed, 2);
  assert.equal(result.states.get('Shared').craftTimes, 1);
  assert.equal(result.states.get('Ore').needed, 5);
});

test('treats purchased intermediates as terminal without removing other shared demand', () => {
  const recipes = {
    Product: recipe(1, [{ name: 'Purchased', qty: 1 }, { name: 'Other', qty: 1 }]),
    Purchased: recipe(1, [{ name: 'Shared', qty: 2 }, { name: 'OnlyPurchased', qty: 1 }]),
    Other: recipe(1, [{ name: 'Shared', qty: 1 }])
  };
  const result = calculateRequirements(recipes, [{ name: 'Product', qty: 1 }], {
    exchangeCraftTypes,
    terminalNames: ['Purchased']
  });

  assert.equal(result.states.get('Purchased').needed, 1);
  assert.equal(result.states.get('Shared').needed, 1);
  assert.equal(result.states.has('OnlyPurchased'), false);
});

test('aggregates a shared dependency reached through different parents', () => {
  const recipes = {
    Product: recipe(1, [{ name: 'Left', qty: 1 }, { name: 'Right', qty: 1 }]),
    Left: recipe(1, [{ name: 'Shared', qty: 1 }]),
    Right: recipe(1, [{ name: 'Shared', qty: 1 }]),
    Shared: recipe(4, [{ name: 'Ore', qty: 7 }])
  };
  const result = requirements(recipes, [{ name: 'Product', qty: 1 }]);

  assert.equal(result.states.get('Shared').needed, 2);
  assert.equal(result.states.get('Shared').craftTimes, 1);
  assert.equal(result.states.get('Ore').needed, 7);
});

test('treats exchange recipes as terminal requirements', () => {
  const recipes = {
    Product: recipe(1, [{ name: 'ExchangeItem', qty: 3 }]),
    ExchangeItem: recipe(2, [{ name: 'Token', qty: 10 }], '9')
  };
  const result = requirements(recipes, [{ name: 'Product', qty: 1 }]);
  const exchange = result.states.get('ExchangeItem');

  assert.equal(exchange.needed, 3);
  assert.equal(exchange.craftTimes, 2);
  assert.equal(exchange.isExchange, true);
  assert.equal(result.states.has('Token'), false);
});

test('aggregates duplicate root quantities', () => {
  const recipes = { Product: recipe(2, [{ name: 'Ore', qty: 3 }]) };
  const result = requirements(recipes, [
    { name: 'Product', qty: 1 },
    { name: 'Product', qty: 2 }
  ]);

  assert.equal(result.states.get('Product').needed, 3);
  assert.equal(result.states.get('Product').craftTimes, 2);
  assert.equal(result.states.get('Ore').needed, 6);
});

test('alternative requirements sum terminal materials for distinct intermediates', () => {
  const recipes = {
    WeaponA: recipe(1, [{ name: 'PotionA', qty: 2 }]),
    WeaponB: recipe(1, [{ name: 'PotionB', qty: 2 }]),
    PotionA: recipe(3, [
      { name: 'Water', qty: 3 },
      { name: 'HerbA', qty: 1 }
    ]),
    PotionB: recipe(3, [
      { name: 'Water', qty: 3 },
      { name: 'HerbB', qty: 1 }
    ])
  };
  const result = mergeAlternativeRequirements([
    requirements(recipes, [{ name: 'WeaponA', qty: 1 }]),
    requirements(recipes, [{ name: 'WeaponB', qty: 1 }])
  ]);

  assert.equal(result.states.get('PotionA').needed, 2);
  assert.equal(result.states.get('PotionB').needed, 2);
  assert.equal(result.states.get('Water').needed, 6);
  assert.equal(result.states.get('HerbA').needed, 1);
  assert.equal(result.states.get('HerbB').needed, 1);
});

test('alternative requirements count the same intermediate only once', () => {
  const recipes = {
    WeaponA: recipe(1, [{ name: 'Potion', qty: 2 }]),
    WeaponB: recipe(1, [{ name: 'Potion', qty: 2 }]),
    Potion: recipe(3, [{ name: 'Water', qty: 3 }])
  };
  const result = mergeAlternativeRequirements([
    requirements(recipes, [{ name: 'WeaponA', qty: 1 }]),
    requirements(recipes, [{ name: 'WeaponB', qty: 1 }])
  ]);

  assert.equal(result.states.get('Potion').needed, 2);
  assert.equal(result.states.get('Water').needed, 3);
});

test('alternative requirements keep direct terminal materials at the largest candidate demand', () => {
  const recipes = {
    ProductA: recipe(1, [{ name: 'Ore', qty: 10 }]),
    ProductB: recipe(1, [{ name: 'Ore', qty: 6 }])
  };
  const result = mergeAlternativeRequirements([
    requirements(recipes, [{ name: 'ProductA', qty: 1 }]),
    requirements(recipes, [{ name: 'ProductB', qty: 1 }])
  ]);

  assert.equal(result.states.get('Ore').needed, 10);
});

test('alternative list requirements sum direct materials within each list before taking the maximum', () => {
  const recipes = {
    ProductA: recipe(1, [{ name: 'Ore', qty: 10 }]),
    ProductB: recipe(1, [{ name: 'Ore', qty: 6 }]),
    ProductC: recipe(1, [{ name: 'Ore', qty: 20 }])
  };
  const result = mergeAlternativeRequirements([
    requirements(recipes, [
      { name: 'ProductA', qty: 1 },
      { name: 'ProductB', qty: 1 }
    ]),
    requirements(recipes, [{ name: 'ProductC', qty: 1 }])
  ]);

  assert.equal(result.states.get('Ore').needed, 20);
});

test('alternative list requirements retain terminal materials for every distinct intermediate', () => {
  const recipes = {
    WeaponA: recipe(1, [{ name: 'PotionA', qty: 2 }]),
    WeaponB: recipe(1, [{ name: 'PotionB', qty: 2 }]),
    WeaponC: recipe(1, [{ name: 'PotionC', qty: 2 }]),
    PotionA: recipe(3, [{ name: 'Water', qty: 3 }]),
    PotionB: recipe(3, [{ name: 'Water', qty: 3 }]),
    PotionC: recipe(3, [{ name: 'Water', qty: 3 }])
  };
  const result = mergeAlternativeRequirements([
    requirements(recipes, [
      { name: 'WeaponA', qty: 1 },
      { name: 'WeaponB', qty: 1 }
    ]),
    requirements(recipes, [{ name: 'WeaponC', qty: 1 }])
  ]);

  assert.equal(result.states.get('PotionA').needed, 2);
  assert.equal(result.states.get('PotionB').needed, 2);
  assert.equal(result.states.get('PotionC').needed, 2);
  assert.equal(result.states.get('Water').needed, 9);
});

test('alternative requirements propagate through multiple intermediate levels', () => {
  const recipes = {
    WeaponA: recipe(1, [{ name: 'PartA', qty: 1 }]),
    WeaponB: recipe(1, [{ name: 'PartB', qty: 1 }]),
    PartA: recipe(1, [{ name: 'PotionA', qty: 2 }]),
    PartB: recipe(1, [{ name: 'PotionB', qty: 2 }]),
    PotionA: recipe(3, [{ name: 'Water', qty: 3 }]),
    PotionB: recipe(3, [{ name: 'Water', qty: 3 }])
  };
  const result = mergeAlternativeRequirements([
    requirements(recipes, [{ name: 'WeaponA', qty: 1 }]),
    requirements(recipes, [{ name: 'WeaponB', qty: 1 }])
  ]);

  assert.equal(result.states.get('PartA').needed, 1);
  assert.equal(result.states.get('PartB').needed, 1);
  assert.equal(result.states.get('PotionA').needed, 2);
  assert.equal(result.states.get('PotionB').needed, 2);
  assert.equal(result.states.get('Water').needed, 6);
});

test('alternative requirements preserve distinct exchange targets', () => {
  const recipes = {
    ProductA: recipe(1, [{ name: 'ExchangeA', qty: 3 }]),
    ProductB: recipe(1, [{ name: 'ExchangeB', qty: 3 }]),
    ExchangeA: recipe(2, [{ name: 'Token', qty: 10 }], '9'),
    ExchangeB: recipe(2, [{ name: 'Token', qty: 10 }], '9')
  };
  const result = mergeAlternativeRequirements([
    requirements(recipes, [{ name: 'ProductA', qty: 1 }]),
    requirements(recipes, [{ name: 'ProductB', qty: 1 }])
  ]);

  assert.equal(result.states.get('ExchangeA').needed, 3);
  assert.equal(result.states.get('ExchangeA').craftTimes, 2);
  assert.equal(result.states.get('ExchangeB').needed, 3);
  assert.equal(result.states.get('ExchangeB').craftTimes, 2);
  assert.equal(result.states.has('Token'), false);
});

test('alternative requirements keep purchased intermediates terminal', () => {
  const recipes = {
    ProductA: recipe(1, [{ name: 'PurchasedA', qty: 2 }]),
    ProductB: recipe(1, [{ name: 'PurchasedB', qty: 2 }]),
    PurchasedA: recipe(3, [{ name: 'Water', qty: 3 }]),
    PurchasedB: recipe(3, [{ name: 'Water', qty: 3 }])
  };
  const options = {
    exchangeCraftTypes,
    terminalNames: ['PurchasedA', 'PurchasedB']
  };
  const result = mergeAlternativeRequirements([
    calculateRequirements(recipes, [{ name: 'ProductA', qty: 1 }], options),
    calculateRequirements(recipes, [{ name: 'ProductB', qty: 1 }], options)
  ]);

  assert.equal(result.states.get('PurchasedA').needed, 2);
  assert.equal(result.states.get('PurchasedB').needed, 2);
  assert.equal(result.states.has('Water'), false);
});

test('alternative requirements reject unsafe terminal-material totals', () => {
  const recipes = {
    ProductA: recipe(1, [{ name: 'PartA', qty: 1 }]),
    ProductB: recipe(1, [{ name: 'PartB', qty: 1 }]),
    PartA: recipe(1, [{ name: 'Ore', qty: Number.MAX_SAFE_INTEGER }]),
    PartB: recipe(1, [{ name: 'Ore', qty: Number.MAX_SAFE_INTEGER }])
  };
  const results = [
    requirements(recipes, [{ name: 'ProductA', qty: 1 }]),
    requirements(recipes, [{ name: 'ProductB', qty: 1 }])
  ];

  assert.throws(() => mergeAlternativeRequirements(results), /safe integer range/);
});

test('adds requirements calculated with different recipe selections', () => {
  const carpenterRecipes = {
    Product: { ...recipe(1, [{ name: 'Lumber', qty: 2 }]), recipeId: 'carpenter' }
  };
  const alchemistRecipes = {
    Product: { ...recipe(1, [{ name: 'Solution', qty: 3 }], '6'), recipeId: 'alchemist' }
  };
  const result = mergeSummedRequirements([
    requirements(carpenterRecipes, [{ name: 'Product', qty: 1 }]),
    requirements(alchemistRecipes, [{ name: 'Product', qty: 2 }])
  ]);

  assert.equal(result.states.get('Product').needed, 3);
  assert.equal(result.states.get('Product').craftTimes, 3);
  assert.equal(result.states.get('Lumber').needed, 2);
  assert.equal(result.states.get('Solution').needed, 6);
  assert.deepEqual(
    result.states.get('Product').recipeAlternatives.map(entry => entry.recipeId),
    ['carpenter', 'alchemist']
  );
});

test('shared-code fixture keeps enough materials for every displayed G4 potion', () => {
  const { recipes, itemNamesById } = loadRealRecipeData();
  const names = loverWeapons.itemIds.map(id => itemNamesById.get(id));
  assert.equal(names.every(Boolean), true);
  const result = mergeAlternativeRequirements(
    names.map(name => requirements(recipes, [{ name, qty: 1 }]))
  );

  for (const name of ['活力の宝水G4', '剛力の宝水G4', '眼力の宝水G4', '心力の宝水G4', '知力の宝水G4']) {
    assert.equal(result.states.get(name).needed, 2);
  }
  assert.equal(result.states.get('ガーデン・ソフトウォーター').needed, 15);
  assert.equal(result.states.get('ヤクテル天然水').needed, 5);
});

test('builds an unambiguous intermediate hierarchy without duplicates', () => {
  const recipes = {
    Product: recipe(1, [{ name: 'Part', qty: 1 }]),
    Part: recipe(1, [{ name: 'Subpart', qty: 1 }]),
    Subpart: recipe(1, [{ name: 'Ore', qty: 1 }])
  };
  const forest = createIntermediateForest(
    requirements(recipes, [{ name: 'Product', qty: 1 }])
  );

  assert.equal(forest.length, 1);
  assert.equal(forest[0].name, 'Part');
  assert.equal(forest[0].children[0].name, 'Subpart');
});

test('intermediate hierarchy exposes the remaining quantity after prepared stock', () => {
  const recipes = {
    Product: recipe(1, [{ name: 'Part', qty: 1 }]),
    Part: recipe(2, [{ name: 'Ore', qty: 3 }])
  };
  const forest = createIntermediateForest(
    requirements(recipes, [{ name: 'Product', qty: 5 }], {
      availableCounts: { Part: 2 }
    })
  );

  assert.equal(forest[0].qty, 3);
  assert.equal(forest[0].totalNeeded, 5);
  assert.equal(forest[0].availableUsed, 2);
  assert.equal(forest[0].craftTimes, 2);
  assert.equal(forest[0].surplus, 1);
});

test('keeps a shared intermediate at the forest root', () => {
  const recipes = {
    Product: recipe(1, [{ name: 'Part', qty: 1 }, { name: 'Shared', qty: 1 }]),
    Part: recipe(1, [{ name: 'Shared', qty: 1 }]),
    Shared: recipe(2, [{ name: 'Ore', qty: 1 }])
  };
  const forest = createIntermediateForest(
    requirements(recipes, [{ name: 'Product', qty: 1 }])
  );

  assert.deepEqual(forest.map(node => node.name).sort(), ['Part', 'Shared']);
  assert.equal(forest.find(node => node.name === 'Part').children.length, 0);
});

test('rejects invalid quantities, cycles, and unsafe arithmetic', () => {
  assert.throws(() => calculateCraft(0, 1), /positive safe integer/);
  assert.throws(() => calculateCraft(1.5, 1), /positive safe integer/);
  assert.throws(
    () => requirements({ A: recipe(1, [{ name: 'A', qty: 1 }]) }, [{ name: 'A', qty: 1 }]),
    /cycle/i
  );
  assert.throws(
    () => requirements(
      { A: recipe(1, [{ name: 'Ore', qty: Number.MAX_SAFE_INTEGER }]) },
      [{ name: 'A', qty: 2 }]
    ),
    /safe integer range/
  );
});

test('real recipe data satisfies all calculation invariants', () => {
  const { recipes } = loadRealRecipeData();

  const roots = Object.keys(recipes).map(name => ({ name, qty: 1 }));
  const result = requirements(recipes, roots);
  assert.equal(result.states.size >= roots.length, true);

  result.states.forEach(state => {
    assert.equal(Number.isSafeInteger(state.needed), true, `${state.name}: needed`);
    assert.equal(state.needed >= 1, true, `${state.name}: positive demand`);
    if (!state.recipe) return;
    assert.equal(state.produced >= state.needed, true, `${state.name}: enough production`);
    assert.equal(state.produced - state.needed, state.surplus, `${state.name}: surplus`);
    assert.equal(state.produced, state.craftTimes * state.recipe.yield, `${state.name}: production`);
  });
});
