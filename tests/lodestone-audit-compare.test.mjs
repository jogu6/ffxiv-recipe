import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalLodestoneRecipeContent,
  compareInitialLodestoneAudit,
  compareLodestoneAudits,
  mergeLodestoneNameAliases
} from '../pipeline/tool/lodestone-audit-compare.mjs';

function detail({ amount = 1, ingredient = '素材A', ingredientKey = 'item-a', ingredientAmount = 2 } = {}) {
  return `
    <aside>監査対象外の共通表示</aside>
    <main>鍛冶師 Lv 90
      <span class="js__complete_craft_count">${amount}</span>
      <p class="db-view__recipe__text__book_name">鍛冶秘伝書:第10巻</p>
      <div data-num="${ingredientAmount}" data-name="${ingredient}" class="db-tree js__material" data-key="${ingredientKey}" data-depth="1"></div>
    </main>`;
}

function publishedRecipe({ name = '旧名', key = 'same-recipe', ingredientAmount = 2 } = {}) {
  return {
    Version: '7.55',
    Items: [{
      Name: name,
      Recipe: {
        RecipeKey: key,
        CraftInfo: { job: '鍛冶師', level: 90, masterbook: '鍛冶秘伝書:第10巻' },
        AmountResult: '1',
        Ingredients: [{ Name: '素材A', Amount: String(ingredientAmount) }]
      }
    }, {
      Name: '手動交換品',
      Recipe: {
        RecipeKey: 'exchange-1',
        CraftInfo: { job: '交換', level: 1 },
        AmountResult: '1',
        Ingredients: [{ Name: '通貨', Amount: '1' }]
      }
    }]
  };
}

function resource(key, html) {
  return { key, completed: true, html };
}

test('recipe comparison canonicalizes craft content and ignores unrelated page text', () => {
  assert.deepEqual(
    canonicalLodestoneRecipeContent(detail().replace('監査対象外の共通表示', '変更された共通表示')),
    canonicalLodestoneRecipeContent(detail())
  );
  assert.notDeepEqual(
    canonicalLodestoneRecipeContent(detail({ ingredientAmount: 3 })),
    canonicalLodestoneRecipeContent(detail())
  );
});

test('promoted audit comparison detects key-based renames, recipe changes, additions, and deletions', () => {
  const previousSnapshot = {
    AuditId: 'old',
    Version: '7.55',
    Items: [
      { LodestoneKey: 'same', Name: '旧名' },
      { LodestoneKey: 'removed-item', Name: '削除品' }
    ],
    Recipes: [
      { RecipeKey: 'same-recipe', Name: '旧名', AuditResourceKey: 'recipe:same-recipe' },
      { RecipeKey: 'removed-recipe', Name: '削除品', AuditResourceKey: 'recipe:removed-recipe' }
    ]
  };
  const currentSnapshot = {
    AuditId: 'new',
    Version: '7.56',
    Items: [
      { LodestoneKey: 'same', Name: '現行名' },
      { LodestoneKey: 'added-item', Name: '追加品' }
    ],
    Recipes: [
      { RecipeKey: 'same-recipe', Name: '現行名', AuditResourceKey: 'recipe:same-recipe' },
      { RecipeKey: 'added-recipe', Name: '追加品', AuditResourceKey: 'recipe:added-recipe' }
    ]
  };
  const previousResources = new Map([
    ['recipe:same-recipe', resource('recipe:same-recipe', detail())],
    ['recipe:removed-recipe', resource('recipe:removed-recipe', detail())]
  ]);
  const currentResources = new Map([
    ['recipe:same-recipe', resource('recipe:same-recipe', detail({ ingredientAmount: 3 }))],
    ['recipe:added-recipe', resource('recipe:added-recipe', detail())]
  ]);
  const comparison = compareLodestoneAudits({
    previousSnapshot,
    currentSnapshot,
    previousResources,
    currentResources,
    readPreviousArtifact: value => value.html
  });

  assert.deepEqual(comparison.NameAliases, { 旧名: '現行名' });
  assert.deepEqual(comparison.ItemChanges.Renamed, [
    { LodestoneKey: 'same', PreviousName: '旧名', CurrentName: '現行名' }
  ]);
  assert.deepEqual(comparison.ItemChanges.Added.map(item => item.Name), ['追加品']);
  assert.deepEqual(comparison.ItemChanges.Removed.map(item => item.Name), ['削除品']);
  assert.deepEqual(comparison.RecipeChanges.ContentChanged.map(recipe => recipe.RecipeKey), ['same-recipe']);
  assert.deepEqual(comparison.RecipeChanges.Added.map(recipe => recipe.RecipeKey), ['added-recipe']);
  assert.deepEqual(comparison.RecipeChanges.Removed.map(recipe => recipe.RecipeKey), ['removed-recipe']);
});

test('initial audit compares schema 1 names and published Lodestone recipe content while excluding exchanges', () => {
  const baselineSnapshot = {
    SchemaVersion: 1,
    CheckedAt: '2026-08-09T04:29:28.369Z',
    Version: '7.55',
    ItemCount: 3,
    RecipeCount: 1,
    Items: [
      { LodestoneKey: 'same', Name: '旧名' },
      { LodestoneKey: 'removed', Name: '削除品' },
      { LodestoneKey: 'item-a', Name: '素材A' }
    ],
    Recipes: [{ RecipeKey: 'same-recipe', Name: '旧名' }]
  };
  const currentSnapshot = {
    AuditId: 'first-audit',
    Version: '7.56',
    Items: [
      { LodestoneKey: 'same', Name: '現行名' },
      { LodestoneKey: 'added', Name: '追加品' },
      { LodestoneKey: 'item-a', Name: '素材A' }
    ],
    Recipes: [{ RecipeKey: 'same-recipe', Name: '現行名', AuditResourceKey: 'recipe:same-recipe' }]
  };
  const comparison = compareInitialLodestoneAudit({
    baselineSnapshot,
    publishedDocument: publishedRecipe(),
    currentSnapshot,
    currentResources: new Map([['recipe:same-recipe', resource('recipe:same-recipe', detail({ ingredientAmount: 3 }))]]),
    readCurrentArtifact: value => value.html
  });

  assert.equal(comparison.PreviousAuditId, null);
  assert.equal(comparison.Baseline.Type, 'schema1-snapshot+published-item-json');
  assert.deepEqual(comparison.NameAliases, { 旧名: '現行名' });
  assert.deepEqual(comparison.ItemChanges.Added.map(item => item.Name), ['追加品']);
  assert.deepEqual(comparison.ItemChanges.Removed.map(item => item.Name), ['削除品']);
  assert.deepEqual(comparison.RecipeChanges.ContentChanged.map(entry => entry.RecipeKey), ['same-recipe']);
});

test('initial audit rejects missing or inconsistent baseline data', () => {
  const currentSnapshot = {
    AuditId: 'first-audit',
    Version: '7.56',
    Items: [{ LodestoneKey: 'same', Name: '現行名' }],
    Recipes: [{ RecipeKey: 'same-recipe', Name: '現行名', AuditResourceKey: 'recipe:same-recipe' }]
  };
  const options = {
    baselineSnapshot: {
      SchemaVersion: 1,
      Version: '7.55',
      ItemCount: 1,
      RecipeCount: 1,
      Items: [{ LodestoneKey: 'same', Name: '旧名' }],
      Recipes: [{ RecipeKey: 'same-recipe', Name: '旧名' }]
    },
    publishedDocument: { ...publishedRecipe(), Version: '7.54' },
    currentSnapshot,
    currentResources: new Map([['recipe:same-recipe', resource('recipe:same-recipe', detail())]]),
    readCurrentArtifact: value => value.html
  };
  assert.throws(() => compareInitialLodestoneAudit(options), /Versionが一致しません/);
  assert.throws(
    () => compareInitialLodestoneAudit({
      ...options,
      publishedDocument: { Version: '7.55', Items: [] }
    }),
    /Lodestoneレシピが一致しません/
  );
});

test('initial recipe comparison ignores renamed material labels and manual exchange ingredients', () => {
  const published = publishedRecipe();
  published.Items[0].Recipe.Ingredients.push({ Name: '交換通貨', Amount: '5' });
  const comparison = compareInitialLodestoneAudit({
    baselineSnapshot: {
      SchemaVersion: 1,
      Version: '7.55',
      ItemCount: 2,
      RecipeCount: 1,
      Items: [
        { LodestoneKey: 'output', Name: '旧名' },
        { LodestoneKey: 'item-a', Name: '素材A' }
      ],
      Recipes: [{ RecipeKey: 'same-recipe', Name: '旧名' }]
    },
    publishedDocument: published,
    manualExchangeRows: [['旧名', '交換通貨', '5', '8']],
    currentSnapshot: {
      AuditId: 'first-audit',
      Version: '7.56',
      Items: [
        { LodestoneKey: 'output', Name: '旧名' },
        { LodestoneKey: 'item-a', Name: '新素材名' }
      ],
      Recipes: [{ RecipeKey: 'same-recipe', Name: '旧名', AuditResourceKey: 'recipe:same-recipe' }]
    },
    currentResources: new Map([[
      'recipe:same-recipe',
      resource('recipe:same-recipe', detail({ ingredient: '新素材名', ingredientKey: 'item-a' }))
    ]]),
    readCurrentArtifact: value => value.html
  });

  assert.deepEqual(comparison.RecipeChanges.ContentChanged, []);
  assert.deepEqual(comparison.NameAliases, { 素材A: '新素材名' });
});

test('alias merge collapses chains and drops aliases without a current target', () => {
  assert.deepEqual(
    mergeLodestoneNameAliases(
      { Aliases: { A: 'B', Gone: 'Missing' } },
      { NameAliases: { B: 'C' } },
      ['C']
    ),
    { A: 'C', B: 'C' }
  );
});
