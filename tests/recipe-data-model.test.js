const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildRecipeData,
  buildRecipeDataAsync,
  defaultRecipeVariant,
  normalizedRecipeVariant
} = require('../site/recipe-data-model.js');

test('recipe variants normalize numeric fields and resolve ingredient names by id', () => {
  const variant = normalizedRecipeVariant(
    {
      RecipeID: 42,
      CraftType: 0,
      AmountResult: '3',
      Ingredients: [{ ItemID: '200', Amount: '2' }]
    },
    { fallbackCraftInfo: { job: '木工師' }, itemNameForId: id => (id === '200' ? '素材' : null) }
  );

  assert.deepEqual(variant, {
    recipeId: '42',
    yield: 3,
    craftType: '0',
    craftInfo: { job: '木工師' },
    ingredients: [{ name: '素材', qty: 2, itemId: '200' }]
  });
});

test('legacy recipe identity selects the matching default variant', () => {
  const variants = [
    normalizedRecipeVariant({
      RecipeID: 'first',
      CraftType: 0,
      Ingredients: [{ ItemID: 1, Name: '甲', Amount: 1 }]
    }),
    normalizedRecipeVariant({
      RecipeID: 'second',
      CraftType: 1,
      Ingredients: [{ ItemID: 2, Name: '乙', Amount: 2 }]
    })
  ];
  const selected = defaultRecipeVariant(variants, {
    CraftType: 1,
    Ingredients: [{ ItemID: 2, Name: '乙', Amount: 2 }]
  });

  assert.equal(selected.recipeId, 'second');
});

test('application recipe data builds stable masters, reverse indexes, and exclusions', () => {
  const raw = [
    {
      ID: '100',
      Name: '完成品',
      ItemUICategory: '9',
      ItemUICategoryName: '薬品',
      CraftInfo: [
        { job: '木工師', level: '10', masterbook: '' },
        { job: '鍛冶師', level: '12', masterbook: '秘伝書' }
      ],
      Recipe: {
        RecipeID: 'legacy',
        CraftType: 1,
        PatchNumber: '750',
        AmountResult: 1,
        Ingredients: [{ ItemID: '200', Name: '素材', Amount: 2 }]
      },
      Recipes: [
        {
          RecipeID: 'wood',
          CraftType: 0,
          AmountResult: 1,
          Ingredients: [{ ItemID: '201', Name: '別素材', Amount: 1 }]
        },
        {
          RecipeID: 'metal',
          CraftType: 1,
          AmountResult: 1,
          Ingredients: [{ ItemID: '200', Name: '素材', Amount: 2 }]
        }
      ]
    },
    { ID: '200', Name: '素材', ItemUICategory: 1 },
    { ID: '201', Name: '別素材', ItemUICategory: 1 },
    {
      ID: '300',
      Name: 'クリスタル',
      Recipe: {
        RecipeID: 'crystal-recipe',
        CraftType: 0,
        Ingredients: [{ ItemID: '400', Name: '除外素材', Amount: 1 }]
      }
    }
  ];

  const result = buildRecipeData(raw, {
    craftTypeNames: { 0: '木工師', 1: '鍛冶師' },
    crystalExclude: new Set(['除外素材']),
    iconPath: item => `icon:${item.ID}`,
    sortRecipeNames: names => [...names].sort((left, right) => left.localeCompare(right, 'ja'))
  });

  assert.equal(result.maxPatch, 750);
  assert.equal(result.recipes['完成品'].recipeId, 'metal');
  assert.equal(result.itemMaster['完成品'].method, '鍛冶師');
  assert.equal(result.itemMaster['完成品'].craftLevel, 12);
  assert.equal(result.idToItemName[200], '素材');
  assert.equal(result.idToRecipeName[100], '完成品');
  assert.deepEqual(new Set(result.usedIn['素材']), new Set(['完成品']));
  assert.deepEqual(new Set(result.usedIn['別素材']), new Set(['完成品']));
  assert.ok(!result.ingredientNames.includes('除外素材'));
});

test('name-key Lodestone data uses names for identity and SortOrder only for sorting', () => {
  const result = buildRecipeData({
    Version: '7.55',
    Items: [
      {
        Name: '完成品', SortOrder: 45000, ItemCategory: '木材',
        Recipe: { RecipeKey: 'abc', CraftType: '0', AmountResult: '1', Ingredients: [{ Name: '素材', Amount: '2' }] }
      },
      { Name: '素材', SortOrder: 123, MaterialSortOrder: 7, ItemCategory: '石材' }
    ]
  }, { craftTypeNames: { 0: '木工師' } });
  assert.equal(result.version, '7.55');
  assert.equal(result.itemMaster['完成品'].id, '完成品');
  assert.equal(result.itemMaster['完成品'].sortOrder, 45000);
  assert.equal(result.itemMaster['素材'].uiCategoryName, '石材');
  assert.equal(result.itemMaster['素材'].materialSortOrder, 7);
  assert.equal(result.recipes['完成品'].recipeId, 'abc');
  assert.deepEqual(result.recipes['完成品'].ingredients, [{ name: '素材', qty: 2, itemId: '素材' }]);
});

test('incremental build matches synchronous output and reports real work progress', async () => {
  const raw = {
    Version: '7.55',
    Items: [
      {
        Name: '完成品',
        Recipe: { RecipeKey: 'recipe', CraftType: '0', Ingredients: [{ Name: '素材', Amount: 2 }] },
      },
      { Name: '素材' },
    ],
  };
  const options = { craftTypeNames: { 0: '木工師' }, sortRecipeNames: names => [...names].sort() };
  const progress = [];
  let yields = 0;
  const incremental = await buildRecipeDataAsync(raw, options, {
    chunkSize: 1,
    onProgress: value => progress.push(value),
    yieldControl: async () => { yields += 1; },
  });

  assert.deepEqual(incremental, buildRecipeData(raw, options));
  assert.ok(progress.some(value => value.phase === 'レシピを関連付けています'));
  assert.equal(progress.at(-1).percent, 100);
  assert.ok(yields > 0);
});
