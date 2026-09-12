function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function text(value) {
  return decodeHtml(String(value || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function attributes(tag) {
  return Object.fromEntries(
    [...String(tag || '').matchAll(/([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g)]
      .map(([, name, , value]) => [name.toLowerCase(), decodeHtml(value)])
  );
}

function integer(value, label) {
  const digits = String(value ?? '').replace(/[^0-9]/g, '');
  if (!digits) throw new Error(`Lodestoneレシピの${label}を取得できません`);
  const parsed = Number(digits);
  if (!Number.isSafeInteger(parsed)) throw new Error(`Lodestoneレシピの${label}を取得できません`);
  return parsed;
}

export function extractLodestoneCraftingNumbers(html) {
  const source = String(html || '');
  const block = source.match(/<ul\b[^>]*class=["'][^"']*\bdb-view__recipe__craftdata\b[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i)?.[1];
  if (!block) throw new Error('Lodestoneレシピの製作情報がありません');
  const values = new Map();
  for (const match of block.matchAll(/<li\b[^>]*>\s*<span\b[^>]*>([\s\S]*?)<\/span>([\s\S]*?)<\/li>/gi)) {
    values.set(text(match[1]), text(match[2]));
  }
  const initialQualityText = values.get('初期品質値') || '';
  const materialQualityPercent = integer(initialQualityText.match(/上限\s*([0-9,]+)\s*％/)?.[1], '初期品質上限');
  if (materialQualityPercent > 100) throw new Error('Lodestoneレシピの初期品質上限が不正です');
  return {
    amountResult: integer(values.get('完成個数'), '完成個数'),
    difficulty: integer(values.get('必要工数'), '必要工数'),
    durability: integer(values.get('耐久'), '耐久'),
    maxQuality: integer(values.get('品質最大値'), '品質最大値'),
    materialQualityPercent
  };
}

export function extractLodestoneCraftingConditions(html) {
  const block = String(html || '').match(/<dl\b[^>]*class=["'][^"']*\bdb-view__recipe__crafting_conditions\b[^"']*["'][^>]*>([\s\S]*?)<\/dl>/i)?.[1] || '';
  const conditions = [...block.matchAll(/<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)].map(match => text(match[1]));
  const joined = conditions.join(' ');
  const numberAfter = label => {
    const match = joined.match(new RegExp(`${label}[^0-9]*([0-9,]+)`));
    return match ? integer(match[1], label) : 0;
  };
  return {
    requiredCraftsmanship: numberAfter('作業精度'),
    requiredControl: numberAfter('加工精度'),
    hqAvailable: !conditions.some(value => /HQ(?:アイテム)?製作不可/i.test(value)),
    expert: conditions.some(value => /高難易度|エキスパート/.test(value)),
    conditions
  };
}

export function extractLodestoneMacroRecipe(html) {
  return {
    ...extractLodestoneCraftingNumbers(html),
    ...extractLodestoneCraftingConditions(html)
  };
}

export function extractLodestoneRecipeIdentity(recipePath, html) {
  const source = String(html || '');
  const id = String(recipePath || '').match(/\/recipe\/([a-z0-9]+)\//i)?.[1] || '';
  const name = text(source.match(/<h2\b[^>]*class=["'][^"']*\bdb-view__item__text__name\b[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i)?.[1]);
  const job = text(source.match(/<p\b[^>]*class=["'][^"']*\bdb-view__item__text__job_name\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1]);
  const level = integer(text(source.match(/<span\b[^>]*class=["'][^"']*\bdb-view__item__text__level__num\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]), '製作レベル');
  const icon = decodeHtml(source.match(/<img\b[^>]*src=["'](https:\/\/lds-img\.finalfantasyxiv\.com\/itemicon\/[^"']+)["'][^>]*>/i)?.[1] || '');
  if (!id || !name || !/^(木工師|鍛冶師|甲冑師|彫金師|革細工師|裁縫師|錬金術師|調理師)$/.test(job)) {
    throw new Error('Lodestoneレシピの識別情報を取得できません');
  }
  return { id, name, job, level, icon };
}

export function extractLodestoneDirectIngredients(html) {
  const ingredients = [];
  for (const match of String(html || '').matchAll(/<div\b[\s\S]*?>/gi)) {
    const value = attributes(match[0]);
    const classes = String(value.class || '').split(/\s+/);
    if (!classes.includes('js__material') || !classes.includes('db-tree') || Number(value['data-depth']) !== 1) continue;
    const id = String(value['data-key'] || '');
    const name = text(value['data-name']);
    const amount = integer(value['data-num'], '素材数');
    if (!id || !name) throw new Error('Lodestoneレシピの直接素材を取得できません');
    ingredients.push({ id, name, amount });
  }
  if (!ingredients.length) throw new Error('Lodestoneレシピの直接素材がありません');
  return ingredients;
}

export function extractCompleteLodestoneRecipe(recipePath, html) {
  return {
    ...extractLodestoneRecipeIdentity(recipePath, html),
    ...extractLodestoneMacroRecipe(html),
    ingredients: extractLodestoneDirectIngredients(html)
  };
}
