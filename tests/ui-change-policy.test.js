const test = require('node:test');
const assert = require('node:assert/strict');
const { UI_CHANGE, resolveUiChangePolicy } = require('../site/ui-change-policy.js');

test('every declared UI change resolves to an immutable policy', () => {
  Object.values(UI_CHANGE).forEach(action => {
    const policy = resolveUiChangePolicy(action, {
      resultSourceMode: 'favorite-materials',
      resultViewMode: 'materials'
    });
    assert.equal(policy.action, action);
    assert.equal(Object.isFrozen(policy), true);
    assert.equal(Object.isFrozen(policy.render), true);
    assert.equal(Object.isFrozen(policy.persist), true);
    policy.render.forEach(effect => assert.equal(Object.isFrozen(effect), true));
  });
});

test('search resets only its result list and preserves the selected result view', () => {
  assert.deepEqual(resolveUiChangePolicy(UI_CHANGE.SEARCH_CHANGED), {
    action: UI_CHANGE.SEARCH_CHANGED,
    render: [
      { target: 'recipeList', preserveScroll: false },
      { target: 'result', preserveScroll: true }
    ],
    persist: ['view']
  });
});

test('favorite updates redraw the result only while favorite materials are active', () => {
  assert.deepEqual(resolveUiChangePolicy(UI_CHANGE.FAVORITE_CONTENT_UPDATED), {
    action: UI_CHANGE.FAVORITE_CONTENT_UPDATED,
    render: [{ target: 'recipeList', preserveScroll: true }],
    persist: ['view', 'favorites', 'favorite-counts']
  });
  assert.deepEqual(
    resolveUiChangePolicy(UI_CHANGE.FAVORITE_CONTENT_UPDATED, {
      resultSourceMode: 'favorite-materials'
    }).render,
    [
      { target: 'recipeList', preserveScroll: true },
      { target: 'result', preserveScroll: true }
    ]
  );
});

test('exchange tree redraws only the recipe materials result and always preserves scroll', () => {
  assert.deepEqual(
    resolveUiChangePolicy(UI_CHANGE.EXCHANGE_TREE_TOGGLED, {
      resultSourceMode: 'recipe',
      resultViewMode: 'tree'
    }).render,
    []
  );
  assert.deepEqual(
    resolveUiChangePolicy(UI_CHANGE.EXCHANGE_TREE_TOGGLED, {
      resultSourceMode: 'recipe',
      resultViewMode: 'materials'
    }).render,
    [{ target: 'result', preserveScroll: true }]
  );
});

test('in-place result changes preserve scroll', () => {
  [UI_CHANGE.RESULT_QUANTITY_CHANGED, UI_CHANGE.PURCHASE_STATUS_CHANGED].forEach(action => {
    assert.deepEqual(resolveUiChangePolicy(action).render, [{ target: 'result', preserveScroll: true }]);
  });
});

test('recipe method changes preserve both list and result scroll positions', () => {
  assert.deepEqual(resolveUiChangePolicy(UI_CHANGE.RECIPE_METHOD_CHANGED).render, [
    { target: 'recipeList', preserveScroll: true },
    { target: 'result', preserveScroll: true }
  ]);
});

test('explicit result view changes start the selected view at the top', () => {
  assert.deepEqual(resolveUiChangePolicy(UI_CHANGE.RESULT_VIEW_CHANGED).render, [
    { target: 'result', preserveScroll: false }
  ]);
});

test('unknown UI changes fail before applying side effects', () => {
  assert.throws(() => resolveUiChangePolicy('missing-change'), /Unknown UI change/);
});
