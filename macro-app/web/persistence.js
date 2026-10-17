import { buildSearchInput } from './model.js';

const RESULT_PREFIX = 'xivca.macro.result.v1.';
const DRAFT_PREFIX = 'xivca.macro.selection.v1.';
const VIEW_PREFIX = 'xivca.macro.view.v1.';
const RECONCILED_DATA_KEY = 'xivca.macro.reconciled-data.v1';

export function savePanelView(storage, recipeId, view) {
  storage.setItem(`${VIEW_PREFIX}${encodeURIComponent(String(recipeId))}`, JSON.stringify(view));
}

export function loadPanelView(storage, recipeId) {
  try {
    const value = JSON.parse(storage.getItem(`${VIEW_PREFIX}${encodeURIComponent(String(recipeId))}`) || 'null');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

function resultKey(recipeId) {
  return `${RESULT_PREFIX}${encodeURIComponent(String(recipeId))}`;
}

function draftKey(recipeId) {
  return `${DRAFT_PREFIX}${encodeURIComponent(String(recipeId))}`;
}

function normalizedSelection(selection) {
  return {
    foodId: typeof selection?.foodId === 'string' ? selection.foodId : null,
    medicineId: typeof selection?.medicineId === 'string' ? selection.medicineId : null,
    hqIngredientIds: Array.isArray(selection?.hqIngredientIds)
      ? selection.hqIngredientIds.filter(id => typeof id === 'string')
      : []
  };
}

export function saveDraftSelection(storage, context) {
  storage.setItem(draftKey(context.recipeId), JSON.stringify({
    recipeId: String(context.recipeId),
    dataVersion: String(context.dataVersion),
    selection: normalizedSelection(context.selection)
  }));
}

export function loadDraftSelection(storage, context) {
  let draft;
  try {
    draft = JSON.parse(storage.getItem(draftKey(context.recipeId)) || 'null');
  } catch {
    return null;
  }
  if (!draft
    || String(draft.recipeId) !== String(context.recipeId)
    || String(draft.dataVersion) !== String(context.dataVersion)
    || !draft.selection) return null;
  return normalizedSelection(draft.selection);
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function sameSelection(left, right) {
  const canonical = value => {
    const selection = normalizedSelection(value);
    selection.hqIngredientIds = [...new Set(selection.hqIngredientIds)].sort();
    return selection;
  };
  return sameValue(canonical(left), canonical(right));
}

export function saveGeneratedResult(storage, result) {
  storage.setItem(resultKey(result.recipeId), JSON.stringify(result));
}

export function resultCalculationInputs(data, recipeId, crafter, selection) {
  const recipe = data.recipes.find(item => String(item.id) === String(recipeId));
  const food = data.foods.find(item => item.id === selection.foodId) || null;
  const medicine = data.medicines.find(item => item.id === selection.medicineId) || null;
  if (!recipe || !crafter || (selection.foodId && !food) || (selection.medicineId && !medicine)
    || selection.hqIngredientIds.some(id => !recipe.ingredients.some(item => item.id === id))) return null;
  return {
    search: buildSearchInput(recipe, crafter, { food, medicine, hqIngredientIds: selection.hqIngredientIds }),
    job: recipe.job,
    materialQualityPercent: recipe.materialQualityPercent,
    foodEffects: food?.effects || null,
    medicineEffects: medicine?.effects || null
  };
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]));
  }
  return value;
}

// Item updates migrate labels/selections; only changed calculation inputs
// invalidate results. This never invokes or modifies the solver.
export function reconcileSavedMacros(storage, data) {
  if (storage.getItem(RECONCILED_DATA_KEY) === data.dataVersion) return;
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
  const aliases = data.itemNameAliases || {};
  const rename = name => {
    const seen = new Set();
    while (typeof aliases[name] === 'string' && !seen.has(name)) {
      seen.add(name);
      name = aliases[name];
    }
    return name;
  };
  const renameConsumable = id => typeof id === 'string'
    ? id.replace(/^(.*)(:(?:hq|nq))$/u, (_, name, quality) => rename(name) + quality) : null;
  for (const key of keys) {
    if (!key?.startsWith(RESULT_PREFIX) && !key?.startsWith(DRAFT_PREFIX)) continue;
    let value;
    try { value = JSON.parse(storage.getItem(key)); } catch { storage.removeItem(key); continue; }
    const recipe = data.recipes.find(item => String(item.id) === String(value?.recipeId));
    if (!recipe || !value?.selection) { storage.removeItem(key); continue; }
    const oldSelection = normalizedSelection(value.selection);
    const selection = {
      foodId: renameConsumable(oldSelection.foodId),
      medicineId: renameConsumable(oldSelection.medicineId),
      hqIngredientIds: oldSelection.hqIngredientIds.map(rename)
    };
    if (key.startsWith(RESULT_PREFIX)) {
      const inputs = resultCalculationInputs(data, recipe.id, value.crafter, selection);
      if (!inputs || (value.calculationInputs
        ? !sameValue(canonicalValue(value.calculationInputs), canonicalValue(inputs))
        : String(value.dataVersion) !== String(data.dataVersion))) {
        storage.removeItem(key);
        continue;
      }
      value.calculationInputs = inputs;
      value.recipeName = recipe.name;
    }
    value.selection = selection;
    value.dataVersion = data.dataVersion;
    const updated = JSON.stringify(value);
    if (storage.getItem(key) !== updated) storage.setItem(key, updated);
  }
  storage.setItem(RECONCILED_DATA_KEY, data.dataVersion);
}

export function loadRestorableResult(storage, context) {
  let result;
  try {
    result = JSON.parse(storage.getItem(resultKey(context.recipeId)) || 'null');
  } catch {
    return null;
  }
  if (!result
    || String(result.recipeId) !== String(context.recipeId)
    || String(result.dataVersion) !== String(context.dataVersion)
    || !sameValue(result.crafter, context.crafter)
    || !result.selection
    || !Array.isArray(result.selection.hqIngredientIds)
    || (context.selection && !sameSelection(result.selection, context.selection))
    || typeof result.macro !== 'string'
    || !Number.isFinite(Date.parse(result.generatedAt))) {
    return null;
  }
  return result;
}

export function formatJapaneseDateTime(value) {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(value));
  const part = type => parts.find(entry => entry.type === type)?.value;
  return `${part('year')}/${part('month')}/${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`;
}

export function japaneseIsoDateTime(value = Date.now()) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().replace('Z', '+09:00');
}
