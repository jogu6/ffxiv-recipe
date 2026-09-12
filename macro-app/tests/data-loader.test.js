import assert from 'node:assert/strict';
import test from 'node:test';
import {
  consumableListsFromItemDocument, loadMacroData, macroDataFromItemDocument,
  recipeFromLocation, validateMacroData
} from '../web/data-loader.js';

const fixture = {
  dataVersion: '7.55-test',
  maxCrafterLevel: 100,
  recipes: [{
    id: 'recipe-a', name: 'テスト完成品', job: '木工師', level: 100, difficulty: 100,
    durability: 70, maxQuality: 1000, materialQualityPercent: 50,
    recipeLevel: { jobLevel: 100, progressDivisor: 170, qualityDivisor: 150, progressModifier: 90, qualityModifier: 75 },
    ingredients: []
  }],
  foods: [{ id: 'food-a-hq', name: 'テスト食事', itemLevel: 10, craftLevel: 5, sortOrder: 1, hq: true, effects: { cpPercent: 10, cpCap: 20 }, effectsAvailable: true }],
  medicines: []
};

test('Lodestone専用成果物の必須構造を検証する', () => {
  assert.equal(validateMacroData(fixture), fixture);
  assert.throws(() => validateMacroData({ ...fixture, dataVersion: '' }), /形式が不正/);
});

test('URLのレシピIDだけで対象レシピを選ぶ', () => {
  assert.equal(recipeFromLocation(fixture, { search: '?recipe=recipe-a' })?.name, 'テスト完成品');
  assert.equal(recipeFromLocation(fixture, { search: '?recipe=unknown' }), null);
});

test('データ取得失敗を成功扱いにしない', async () => {
  await assert.rejects(
    loadMacroData('/data.json', async () => ({ ok: false, status: 404 })),
    /読み込めません/
  );
});

test('GUI生成Item.jsonをレシピ・中間素材・食事薬品へ変換する', () => {
  const recipeLevel = {
    JobLevel: 100, ProgressDivisor: 170, QualityDivisor: 150,
    ProgressModifier: 90, QualityModifier: 75
  };
  const result = macroDataFromItemDocument({
    Version: '7.55',
    DataGeneration: 'generation-a',
    Items: [{
      Name: '完成品', ItemCategory: '雑貨', IconFile: 'result.webp',
      Recipe: {
        RecipeKey: 'recipe-a', CraftInfo: { job: '木工師', level: 100 },
        CraftingData: {
          Difficulty: 100, Durability: 70, MaxQuality: 1000, MaterialQualityPercent: 50,
          RequiredCraftsmanship: 10, RequiredControl: 20, HqAvailable: true, Expert: false,
          RecipeLevel: recipeLevel
        },
        Ingredients: [
          { Name: '中間素材', Amount: '2' },
          { Name: '原料', Amount: '3' },
          { Name: '交換素材', Amount: '1' }
        ]
      }
    }, {
      Name: '中間素材', ItemCategory: '木材', IconFile: 'material.webp',
      Recipe: {
        RecipeKey: 'material-recipe', CraftInfo: { job: '木工師', level: 90 },
        CraftingData: { HqAvailable: true }
      }
    }, {
      Name: '原料', ItemCategory: '木材'
    }, {
      Name: '交換素材', ItemCategory: '木材',
      Recipe: { RecipeKey: 'exchange-1', CraftType: '8', Ingredients: [] }
    }, {
      Name: '食事', ItemCategory: '調理品', ItemLevel: 10, SortOrder: 20, IconFile: 'food.webp',
      Recipe: { RecipeKey: 'food-recipe', CraftInfo: { job: '調理師', level: 80 }, Ingredients: [] },
      CraftingEffects: {
        NQ: { CP: { Percent: 10, Max: 20 } },
        HQ: { CP: { Percent: 12, Max: 25 }, Control: { Percent: 4, Max: 8 } }
      }
    }, {
      Name: '薬品', ItemCategory: '薬品', SortOrder: 21,
      Recipe: { RecipeKey: 'medicine-recipe', CraftInfo: { job: '錬金術師', level: 70 }, Ingredients: [] },
      CraftingEffects: {
        NQ: { Craftsmanship: { Percent: 3, Max: 7 } },
        HQ: { Craftsmanship: { Percent: 4, Max: 9 } }
      }
    }]
  });
  assert.equal(result.dataVersion, '7.55:generation-a');
  assert.equal(result.maxCrafterLevel, 100);
  assert.deepEqual(result.recipes[0].ingredients, [{
    id: '中間素材', name: '中間素材', amount: 2, iconFile: 'material.webp'
  }]);
  assert.deepEqual(result.foods.map(item => [item.id, item.effects]), [
    ['食事:hq', { cpPercent: 12, cpCap: 25, controlPercent: 4, controlCap: 8 }],
    ['食事:nq', { cpPercent: 10, cpCap: 20 }]
  ]);
  assert.equal(result.foods[0].craftLevel, 80);
  assert.equal(result.medicines[0].effects.craftsmanshipPercent, 4);
  assert.equal(result.medicines[0].craftLevel, 70);
  assert.equal(result.medicines[0].itemLevel, null);
  assert.equal(result.medicines[0].sortOrder, 21);
});

test('製作効果が不足した消費アイテムも表示用のHQとNQを残す', () => {
  const result = macroDataFromItemDocument({
    Version: '7.55',
    Items: [{
      Name: '完成品', Recipe: {
        RecipeKey: 'recipe-a', CraftInfo: { job: '木工師', level: 1 }, Ingredients: []
      }
    }, {
      Name: '不完全な食事', ItemCategory: '調理品', ItemLevel: 1, SortOrder: 1,
      CraftingEffects: { HQ: { CP: { Percent: 1, Max: 1 } }, NQ: {} }
    }]
  });
  assert.equal(result.recipes[0].difficulty, null);
  assert.deepEqual(result.foods.map(item => [item.hq, item.effectsAvailable]), [[true, true], [false, false]]);
});

test('Item.jsonが同じ場合は保存済みの食事・薬品リストをそのまま使う', () => {
  const document = {
    Version: '7.55',
    DataGeneration: 'generation-a',
    Items: [{
      Name: '完成品',
      Recipe: { RecipeKey: 'recipe-a', CraftInfo: { job: '木工師', level: 1 }, Ingredients: [] }
    }]
  };
  const savedLists = {
    foods: [{
      id: 'saved-food-hq', name: '保存済み食事', itemLevel: 1, craftLevel: 1, sortOrder: 1,
      hq: true, effects: {}, effectsAvailable: false
    }],
    medicines: []
  };
  assert.equal(macroDataFromItemDocument(document, savedLists).foods, savedLists.foods);
  assert.deepEqual(consumableListsFromItemDocument({ ...document, Items: [] }), {
    foods: [], medicines: []
  });
});

test('loadMacroData reads Item.json instead of a dedicated macro JSON', async () => {
  const recipe = fixture.recipes[0];
  const itemDocument = {
    Version: '7.55',
    Items: [{
      Name: recipe.name,
      Recipe: {
        RecipeKey: recipe.id,
        CraftInfo: { job: recipe.job, level: recipe.level },
        CraftingData: {
          Difficulty: recipe.difficulty,
          Durability: recipe.durability,
          MaxQuality: recipe.maxQuality,
          MaterialQualityPercent: recipe.materialQualityPercent,
          RecipeLevel: {
            JobLevel: recipe.recipeLevel.jobLevel,
            ProgressDivisor: recipe.recipeLevel.progressDivisor,
            QualityDivisor: recipe.recipeLevel.qualityDivisor,
            ProgressModifier: recipe.recipeLevel.progressModifier,
            QualityModifier: recipe.recipeLevel.qualityModifier
          }
        },
        Ingredients: []
      }
    }]
  };
  let requestedUrl = '';
  const loaded = await loadMacroData('/site/data/Item.json', async url => {
    requestedUrl = url;
    return { ok: true, json: async () => itemDocument };
  });
  assert.equal(requestedUrl, '/site/data/Item.json');
  assert.equal(loaded.recipes[0].id, 'recipe-a');
});
