const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  calculateCraft,
  calculateRequirements,
  createIntermediateForest,
  mergeAlternativeRequirements,
  validateRequestedCount
} = require('../site/calculation.js');
const { loverWeapons } = require('./fixtures/favorite-share-codes.js');

const exchangeCraftTypes = new Set(['8', '9']);

function recipe(recipeYield, ingredients = [], craftType = '0') {
  return { yield: recipeYield, ingredients, craftType };
}

function requirements(recipes, roots) {
  return calculateRequirements(recipes, roots, { exchangeCraftTypes });
}

function loadRealRecipeData() {
  const file = path.join(__dirname, '..', 'site', 'data', 'Item.json');
  const items = JSON.parse(fs.readFileSync(file, 'utf8'));
  const recipes = {};
  const itemNamesById = new Map();

  items.forEach(item => {
    itemNamesById.set(Number(item.ID), item.Name);
    if (!item.Recipe || item.Recipe.CraftType === undefined) return;
    recipes[item.Name] = recipe(
      Number(item.Recipe.AmountResult || 1),
      item.Recipe.Ingredients.map(ingredient => ({
        name: ingredient.Name,
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
