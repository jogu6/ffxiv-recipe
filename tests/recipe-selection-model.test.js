const test = require('node:test');
const assert = require('node:assert/strict');
const { createRecipeSelectionModel } = require('../site/recipe-selection-model.js');

const variants = {
  完成品: [
    { recipeId: 'root-default', ingredients: [{ name: '中間材' }] },
    { recipeId: 'root-alt', ingredients: [{ name: '直接素材' }] }
  ],
  中間材: [
    { recipeId: 'middle-default', ingredients: [{ name: '原料' }] },
    { recipeId: 'middle-alt', ingredients: [{ name: '完成品' }] }
  ]
};
const ids = { 完成品: 10, 中間材: 20 };
const names = { 10: '完成品', 20: '中間材' };
const defaults = { 完成品: 'root-default', 中間材: 'middle-default' };
const recipes = {
  完成品: variants.完成品[0],
  中間材: variants.中間材[0]
};
const model = createRecipeSelectionModel({
  recipes,
  recipeVariants: variants,
  defaultRecipeIds: defaults,
  defaultRecipeForName: name => variants[name]?.find(recipe => recipe.recipeId === defaults[name]) || null,
  itemNameForId: id => names[id] || null,
  itemIdForName: name => ids[name] || 0,
  normalizeSelections: selections =>
    Object.fromEntries(
      Object.entries(selections || {}).filter(
        ([itemId, recipeId]) => names[itemId] && typeof recipeId === 'string'
      )
    )
});

test('recipe maps apply valid selections without mutating the recipe masters', () => {
  const selections = { 10: 'root-alt', 20: 'missing' };
  const recipeMap = model.recipeMapForSelections(selections);

  assert.equal(recipeMap.完成品.recipeId, 'root-alt');
  assert.equal(recipeMap.中間材.recipeId, 'middle-default');
  assert.equal(variants.完成品[0].recipeId, 'root-default');
});

test('recipe maps share fixed defaults while keeping contextual overrides independent', () => {
  recipes.完成品 = variants.完成品[1];
  const defaultsOnly = model.recipeMapForSelections();
  const rootOverride = model.recipeMapForSelections({ 10: 'root-alt' });
  const middleOverride = model.recipeMapForSelections({ 20: 'middle-alt' });

  assert.equal(defaultsOnly.完成品.recipeId, 'root-default');
  assert.equal(defaultsOnly.中間材.recipeId, 'middle-default');
  assert.equal(rootOverride.完成品.recipeId, 'root-alt');
  assert.equal(rootOverride.中間材.recipeId, 'middle-default');
  assert.equal(middleOverride.完成品.recipeId, 'root-default');
  assert.equal(middleOverride.中間材.recipeId, 'middle-alt');
  assert.equal(Object.hasOwn(defaultsOnly, '完成品'), false);
  assert.equal(Object.hasOwn(rootOverride, '完成品'), true);
  assert.equal(Object.hasOwn(middleOverride, '中間材'), true);
});

test('reachable and unresolved recipes follow the effective graph and stop at cycles', () => {
  assert.deepEqual(model.reachableMultiRecipeNames(['完成品']), ['完成品', '中間材']);
  assert.deepEqual(
    model.unresolvedSelections(['完成品']).map(entry => entry.name),
    ['完成品', '中間材']
  );
  assert.deepEqual(
    model.unresolvedSelections(['完成品'], { 10: 'root-alt' }).map(entry => entry.name),
    []
  );
  assert.deepEqual(model.reachableMultiRecipeNames(['完成品'], { 20: 'middle-alt' }), [
    '完成品',
    '中間材'
  ]);
});

test('effective signatures omit defaults, sort item ids, and retain actual alternatives', () => {
  assert.equal(model.effectiveSelectionSignature({ 20: 'middle-default', 10: 'root-default' }), '[]');
  assert.equal(
    model.effectiveSelectionSignature({ 20: 'middle-alt', 10: 'root-alt' }),
    JSON.stringify([
      ['10', 'root-alt'],
      ['20', 'middle-alt']
    ])
  );
});

test('selected variants fall back to the declared default', () => {
  assert.equal(model.variantForSelection('完成品', { 10: 'root-alt' }).recipeId, 'root-alt');
  assert.equal(model.variantForSelection('完成品', { 10: 'missing' }).recipeId, 'root-default');
  assert.equal(model.variantForSelection('不存在', {}), null);
});
