const RESULT_PREFIX = 'xivca.macro.result.v1.';
const DRAFT_PREFIX = 'xivca.macro.selection.v1.';
const VIEW_PREFIX = 'xivca.macro.view.v1.';

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
