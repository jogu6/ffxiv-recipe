export const CRAFTER_JOBS = Object.freeze([
  '木工師', '鍛冶師', '甲冑師', '彫金師', '革細工師', '裁縫師', '錬金術師', '調理師'
]);

const ACTION_MACRO = Object.freeze({
  muscleMemory: ['確信', 3], basicSynthesis: ['作業', 3], carefulSynthesis: ['模範作業', 3],
  groundwork: ['下地作業', 3], delicateSynthesis: ['精密作業', 3], intensiveSynthesis: ['集中作業', 3],
  prudentSynthesis: ['倹約作業', 3], rapidSynthesis: ['突貫作業', 3], basicTouch: ['加工', 3],
  standardTouch: ['中級加工', 3], advancedTouch: ['上級加工', 3], byregotsBlessing: ['ビエルゴの祝福', 3],
  preciseTouch: ['集中加工', 3], prudentTouch: ['倹約加工', 3], reflect: ['真価', 3],
  preparatoryTouch: ['下地加工', 3], trainedEye: ['匠の早業', 3], trainedFinesse: ['匠の神業', 3],
  // Raphael v0.28.6のmacro_nameと同じく、変化後アクションは実際に押す元アクション名を出力する。
  refinedTouch: ['洗練加工', 3], hastyTouch: ['ヘイスティタッチ', 3], daringTouch: ['ヘイスティタッチ', 3],
  mastersMend: ['マスターズメンド', 3], immaculateMend: ['パーフェクトメンド', 3], manipulation: ['マニピュレーション', 2],
  wasteNot: ['倹約', 2], wasteNotTwo: ['長期倹約', 2], veneration: ['ヴェネレーション', 2],
  innovation: ['イノベーション', 2], quickInnovation: ['クイックイノベーション', 3], greatStrides: ['グレートストライド', 2],
  observe: ['経過観察', 3], tricksOfTheTrade: ['秘訣', 3], heartAndSoul: ['一心不乱', 3],
  trainedPerfection: ['匠の絶技', 3], stellarSteadyHand: ['コンテンツアクション2', 2]
});

export function formatMacro(actions) {
  return actions.map(action => {
    const definition = ACTION_MACRO[action];
    if (!definition) throw new TypeError(`不明な製作アクションです: ${action}`);
    return `/ac "${definition[0]}" <wait.${definition[1]}>`;
  }).join('\n');
}

function cappedBonus(base, percent = 0, cap = 0) {
  return Math.min(Math.floor(base * percent / 100), cap);
}

export function effectiveCrafterStats(status, consumables = []) {
  const result = {
    craftsmanship: status.craftsmanship,
    control: status.control,
    cp: status.cp
  };
  for (const item of consumables.filter(Boolean)) {
    const effects = item.effects || {};
    result.craftsmanship += cappedBonus(status.craftsmanship, effects.craftsmanshipPercent, effects.craftsmanshipCap);
    result.control += cappedBonus(status.control, effects.controlPercent, effects.controlCap);
    result.cp += cappedBonus(status.cp, effects.cpPercent, effects.cpCap);
  }
  return result;
}

export function buildSearchInput(recipe, status, selection = {}) {
  const stats = effectiveCrafterStats(status, [selection.food, selection.medicine]);
  const hqIds = new Set((selection.hqIngredientIds || []).map(String));
  return {
    crafterLevel: status.level,
    craftsmanship: stats.craftsmanship,
    control: stats.control,
    maxCp: stats.cp,
    maxDurability: recipe.durability,
    maxProgress: recipe.difficulty,
    maxQuality: recipe.maxQuality,
    requiredCraftsmanship: recipe.requiredCraftsmanship || 0,
    requiredControl: recipe.requiredControl || 0,
    recipeLevel: recipe.recipeLevel,
    materialQualityPercent: recipe.ingredients.length > 0 ? 50 : 0,
    ingredients: recipe.ingredients.map(item => ({
      amount: item.amount,
      hq: hqIds.has(String(item.id))
    })),
    targetQuality: recipe.hqAvailable === false ? (recipe.requiredQuality || 0) : recipe.maxQuality,
    manipulationAvailable: status.manipulation,
    heartAndSoulAvailable: status.heartAndSoul,
    quickInnovationAvailable: status.quickInnovation,
    trainedEyeAvailable: !recipe.expert && status.level >= recipe.level + 10,
    adversarial: true,
    stellarSteadyHandCharges: recipe.stellarSteadyHandCharges || 0
  };
}

export function recipeParameterFailure(recipe, selection = {}) {
  const recipeLevel = recipe?.recipeLevel;
  if (
    !Number.isInteger(recipe?.difficulty) || recipe.difficulty <= 0
    || !Number.isInteger(recipe?.durability) || recipe.durability <= 0
    || !Number.isInteger(recipe?.maxQuality) || recipe.maxQuality < 0
    || !Number.isInteger(recipe?.materialQualityPercent)
    || recipe.materialQualityPercent < 0 || recipe.materialQualityPercent > 100
    || !recipeLevel || !Number.isInteger(recipeLevel.jobLevel)
    || !Number.isInteger(recipeLevel.progressDivisor) || recipeLevel.progressDivisor <= 0
    || !Number.isInteger(recipeLevel.qualityDivisor) || recipeLevel.qualityDivisor <= 0
    || !Number.isInteger(recipeLevel.progressModifier)
    || !Number.isInteger(recipeLevel.qualityModifier)
  ) return 'レシピの製作パラメーターが不足しています';
  if ([selection.food, selection.medicine].some(item => item && item.effectsAvailable !== true)) {
    return '選択した食事または薬品の製作パラメーターが不足しています';
  }
  return '';
}

export function crafterStatusFailure(recipe, status, selection = {}) {
  const stats = effectiveCrafterStats(status, [selection.food, selection.medicine]);
  if (status.level < recipe.level) return `ジョブレベルが不足しています（必要 ${recipe.level}）`;
  const failures = [];
  if (stats.craftsmanship < (recipe.requiredCraftsmanship || 0)) {
    failures.push(`作業精度が不足しています（現在 ${stats.craftsmanship} / 必要 ${recipe.requiredCraftsmanship}）`);
  }
  if (stats.control < (recipe.requiredControl || 0)) {
    failures.push(`加工精度が不足しています（現在 ${stats.control} / 必要 ${recipe.requiredControl}）`);
  }
  return failures.join('。');
}

export function recipeStartFailure(recipe, status, selection = {}) {
  return recipeParameterFailure(recipe, selection)
    || crafterStatusFailure(recipe, status, selection);
}

export function isCompleteCrafterStatus(status, maximumLevel) {
  return Boolean(status)
    && Number.isInteger(maximumLevel) && maximumLevel > 0
    && Number.isInteger(status.level) && status.level > 0 && status.level <= maximumLevel
    && Number.isInteger(status.craftsmanship) && status.craftsmanship > 0
    && Number.isInteger(status.control) && status.control > 0
    && Number.isInteger(status.cp) && status.cp > 0
    && typeof status.manipulation === 'boolean'
    && typeof status.heartAndSoul === 'boolean'
    && typeof status.quickInnovation === 'boolean';
}

export function sortConsumables(items) {
  return [...items].sort((left, right) =>
    Number(right.craftLevel || 0) - Number(left.craftLevel || 0)
    || Number(right.itemLevel ?? right.sortOrder) - Number(left.itemLevel ?? left.sortOrder)
    || String(left.name).localeCompare(String(right.name), 'ja')
    || Number(right.hq) - Number(left.hq)
  );
}

export function generationFingerprint(input) {
  const normalized = {
    recipeId: String(input.recipeId),
    dataVersion: String(input.dataVersion),
    crafter: input.crafter,
    food: input.food || null,
    medicine: input.medicine || null,
    hqIngredientIds: [...(input.hqIngredientIds || [])].map(String).sort()
  };
  return JSON.stringify(normalized);
}
