import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractCompleteLodestoneRecipe, extractLodestoneDirectIngredients,
  extractLodestoneMacroRecipe, extractLodestoneRecipeIdentity
} from '../pipeline/lodestone-parser.mjs';

test('Lodestone製作情報からソルバー固有値を取得する', () => {
  const html = `
    <ul class="db-view__recipe__craftdata">
      <li><span>完成個数</span>&nbsp;3</li>
      <li><span>必要工数</span>&nbsp;6,300</li>
      <li><span>耐久</span>&nbsp;80</li>
      <li><span>品質最大値</span>&nbsp;11,400</li>
      <li><span>初期品質値</span>&nbsp;上限50％</li>
    </ul>
    <dl class="db-view__recipe__crafting_conditions">
      <dt>CRAFTING CONDITIONS</dt>
      <dd>製作成功目安：作業精度4,131</dd>
      <dd>製作成功目安：加工精度3,950</dd>
      <dd>高難易度レシピ</dd>
      <dd>HQ製作不可</dd>
    </dl>`;

  assert.deepEqual(extractLodestoneMacroRecipe(html), {
    amountResult: 3, difficulty: 6300, durability: 80, maxQuality: 11400,
    materialQualityPercent: 50, requiredCraftsmanship: 4131, requiredControl: 3950,
    hqAvailable: false, expert: true,
    conditions: ['製作成功目安：作業精度4,131', '製作成功目安：加工精度3,950', '高難易度レシピ', 'HQ製作不可']
  });
});

test('不足したLodestone製作情報を推測で補完しない', () => {
  assert.throws(() => extractLodestoneMacroRecipe('<html></html>'), /製作情報がありません/);
});

test('Lodestoneレシピの識別情報と直接素材を取得する', () => {
  const html = `
    <p class="db-view__item__text__job_name">革細工師</p>
    <span class="db-view__item__text__level__num">58</span>
    <h2 class="db-view__item__text__name txt-rarity_common">寒冷地の名産品部材</h2>
    <img src="https://lds-img.finalfantasyxiv.com/itemicon/86/test.png?n7.55">
    <div class="js__material db-tree" data-num="1" data-key="nested" data-depth="99" data-name="孫素材"></div>
    <div class="js__material db-tree" data-num="2" data-key="direct" data-depth="1" data-name="直接素材"></div>`;

  assert.deepEqual(extractLodestoneRecipeIdentity('/lodestone/playguide/db/recipe/abc123/', html), {
    id: 'abc123', name: '寒冷地の名産品部材', job: '革細工師', level: 58,
    icon: 'https://lds-img.finalfantasyxiv.com/itemicon/86/test.png?n7.55'
  });
  assert.deepEqual(extractLodestoneDirectIngredients(html), [{ id: 'direct', name: '直接素材', amount: 2 }]);
});

test('完全レシピ抽出は識別・製作値・直接素材を統合する', () => {
  const html = `
    <p class="db-view__item__text__job_name">木工師</p>
    <span class="db-view__item__text__level__num">10</span>
    <h2 class="db-view__item__text__name">完成品</h2>
    <ul class="db-view__recipe__craftdata">
      <li><span>完成個数</span>1</li><li><span>必要工数</span>20</li>
      <li><span>耐久</span>40</li><li><span>品質最大値</span>100</li>
      <li><span>初期品質値</span>上限0％</li>
    </ul>
    <div class="js__material db-tree" data-num="1" data-key="m1" data-depth="1" data-name="素材"></div>`;
  const result = extractCompleteLodestoneRecipe('/lodestone/playguide/db/recipe/r1/', html);
  assert.equal(result.id, 'r1');
  assert.equal(result.difficulty, 20);
  assert.deepEqual(result.ingredients, [{ id: 'm1', name: '素材', amount: 1 }]);
});
