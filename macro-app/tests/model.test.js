import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSearchInput, effectiveCrafterStats, formatMacro, generationFingerprint, isCompleteCrafterStatus, recipeStartFailure, sortConsumables } from '../web/model.js';

test('必須の製作ステータスを判定する', () => {
  assert.equal(isCompleteCrafterStatus({ level: 100, craftsmanship: 5000, control: 4800, cp: 600, manipulation: true, heartAndSoul: false, quickInnovation: false }, 100), true);
  assert.equal(isCompleteCrafterStatus({ level: 101, craftsmanship: 5000, control: 4800, cp: 600, manipulation: true, heartAndSoul: false, quickInnovation: false }, 100), false);
  assert.equal(isCompleteCrafterStatus({ level: 100, craftsmanship: 0, control: 4800, cp: 600, manipulation: true, heartAndSoul: false, quickInnovation: false }, 100), false);
});

test('食事と薬品を製作レベル降順にする', () => {
  const sorted = sortConsumables([
    { name: '製作低', craftLevel: 10, itemLevel: 30, hq: false },
    { name: '製作高', craftLevel: 20, itemLevel: 20, hq: false },
    { name: '製作高', craftLevel: 20, itemLevel: 20, hq: true }
  ]);
  assert.deepEqual(sorted.map(item => [item.name, item.hq]), [
    ['製作高', true], ['製作高', false], ['製作低', false]
  ]);
});

test('アイテムレベルがない薬品はLodestone掲載順にする', () => {
  const sorted = sortConsumables([
    { name: '旧', itemLevel: null, sortOrder: 10, hq: true },
    { name: '新', itemLevel: null, sortOrder: 20, hq: false },
    { name: '新', itemLevel: null, sortOrder: 20, hq: true }
  ]);
  assert.deepEqual(sorted.map(item => [item.name, item.hq]), [['新', true], ['新', false], ['旧', true]]);
});

test('中間素材HQの並び順は保存結果の一致判定へ影響しない', () => {
  const base = { recipeId: 'r1', dataVersion: 'd1', engineVersion: 'e1', crafter: { level: 100 }, food: null, medicine: null };
  assert.equal(
    generationFingerprint({ ...base, hqIngredientIds: ['2', '1'] }),
    generationFingerprint({ ...base, hqIngredientIds: ['1', '2'] })
  );
});

test('エンジン版は生成条件の一致判定へ影響しない', () => {
  const input = { recipeId: 'r1', dataVersion: 'd1', crafter: { level: 100 } };
  assert.equal(
    generationFingerprint({ ...input, engineVersion: 'old' }),
    generationFingerprint({ ...input, engineVersion: 'new' })
  );
  assert.notEqual(generationFingerprint(input), generationFingerprint({ ...input, dataVersion: 'd2' }));
});

test('マクロ文字列化はJavaScript側で製作アクション行だけを出力する', () => {
  const macro = formatMacro(['muscleMemory', 'veneration', 'stellarSteadyHand', 'daringTouch']);
  assert.equal(macro, [
    '/ac "確信" <wait.3>',
    '/ac "ヴェネレーション" <wait.2>',
    '/ac "コンテンツアクション2" <wait.2>',
    '/ac "ヘイスティタッチ" <wait.3>'
  ].join('\n'));
  assert.equal(macro.includes('/macrolock'), false);
  assert.equal(macro.includes('/echo'), false);
});

test('食事と薬品の補正は未補正ステータスを基準に上限を適用する', () => {
  const result = effectiveCrafterStats(
    { craftsmanship: 5000, control: 4800, cp: 600 },
    [
      { effects: { craftsmanshipPercent: 5, craftsmanshipCap: 150, cpPercent: 10, cpCap: 40 } },
      { effects: { craftsmanshipPercent: 3, craftsmanshipCap: 80, controlPercent: 2, controlCap: 50 } }
    ]
  );
  assert.deepEqual(result, { craftsmanship: 5230, control: 4850, cp: 640 });
});

test('スーパージュラルミン条件は基礎値へ食事と薬品を別途加算する', () => {
  const status = {
    level: 100, craftsmanship: 5635, control: 5379, cp: 649,
    manipulation: true, heartAndSoul: false, quickInnovation: false
  };
  const food = {
    effects: {
      controlPercent: 5, controlCap: 115,
      cpPercent: 26, cpCap: 100
    }
  };
  const medicine = { effects: { cpPercent: 6, cpCap: 27 } };

  assert.deepEqual(effectiveCrafterStats(status, [food, medicine]), {
    craftsmanship: 5635,
    control: 5494,
    cp: 776
  });
});

test('選択状態からWASM探索に必要な値だけを組み立てる', () => {
  const recipe = {
    level: 90, durability: 70, difficulty: 1000, maxQuality: 10000, hqAvailable: true,
    requiredCraftsmanship: 4900, requiredControl: 4700,
    materialQualityPercent: 75, expert: false, stellarSteadyHandCharges: 0,
    recipeLevel: { jobLevel: 90, progressDivisor: 100, qualityDivisor: 100, progressModifier: 100, qualityModifier: 100 },
    ingredients: [{ id: 'a', amount: 2 }, { id: 'b', amount: 1 }]
  };
  const status = { level: 100, craftsmanship: 5000, control: 4800, cp: 600, manipulation: true, heartAndSoul: false, quickInnovation: true };

  const input = buildSearchInput(recipe, status, { hqIngredientIds: ['a'] });

  assert.equal(input.trainedEyeAvailable, true);
  assert.equal(input.adversarial, true);
  assert.equal(input.materialQualityPercent, 50);
  assert.equal(input.requiredCraftsmanship, 4900);
  assert.equal(input.requiredControl, 4700);
  assert.equal(input.heartAndSoulAvailable, false);
  assert.equal(input.quickInnovationAvailable, true);
  assert.deepEqual(input.ingredients, [
    { amount: 2, hq: true },
    { amount: 1, hq: false }
  ]);
});

test('開始条件を満たさないレシピは探索前に作れないと判定する', () => {
  const recipe = {
    level: 100, difficulty: 1000, durability: 70, maxQuality: 10000,
    materialQualityPercent: 50, requiredCraftsmanship: 5100, requiredControl: 4900,
    recipeLevel: {
      jobLevel: 100, progressDivisor: 100, qualityDivisor: 100,
      progressModifier: 100, qualityModifier: 100
    }
  };
  const status = { level: 100, craftsmanship: 5000, control: 4800, cp: 600 };
  assert.match(recipeStartFailure(recipe, status), /作業精度/);
  assert.equal(recipeStartFailure(recipe, status),
    '作業精度が不足しています（現在 5000 / 必要 5100）。加工精度が不足しています（現在 4800 / 必要 4900）');
  assert.equal(recipeStartFailure(recipe, { ...status, craftsmanship: 5100 }),
    '加工精度が不足しています（現在 4800 / 必要 4900）');
  assert.equal(recipeStartFailure(recipe, { ...status, craftsmanship: 5100, control: 4900 }), '');
  assert.equal(recipeStartFailure({ ...recipe, requiredCraftsmanship: 0, requiredControl: 0 }, status), '');
  assert.equal(recipeStartFailure(recipe, status, {
    food: { effects: { craftsmanshipPercent: 5, craftsmanshipCap: 100 }, effectsAvailable: true },
    medicine: { effects: { controlPercent: 3, controlCap: 100 }, effectsAvailable: true }
  }), '');
  assert.match(recipeStartFailure({ ...recipe, level: 101 }, status), /ジョブレベル/);
});

test('製作パラメーター不足は表示処理ではなく生成開始時に失敗させる', () => {
  const status = {
    level: 100, craftsmanship: 5000, control: 4800, cp: 600,
    manipulation: true, heartAndSoul: false, quickInnovation: false
  };
  assert.match(recipeStartFailure({ level: 100, recipeLevel: null }, status), /製作パラメーター/);
});
