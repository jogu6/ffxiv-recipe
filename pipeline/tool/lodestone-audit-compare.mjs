import crypto from 'node:crypto';

function decodeHtml(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function normalizeText(value) {
  return decodeHtml(String(value || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function tagAttributes(tag) {
  return Object.fromEntries(
    [...String(tag || '').matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)].map(([, name, , value]) => [
      name.toLowerCase(),
      decodeHtml(value)
    ])
  );
}

export function canonicalLodestoneMacroItemContent(html) {
  const source = String(html || '');
  const itemLevelText = normalizeText(source.match(
    /<div\b[^>]*class=["'][^"']*\bdb-view__item_level\b[^"']*["'][^>]*>\s*ITEM\s+LEVEL\s+([0-9,]+)\s*<\/div>/i
  )?.[1]);
  const itemLevel = Number(itemLevelText.replace(/,/g, ''));
  if (!Number.isSafeInteger(itemLevel) || itemLevel < 0) {
    throw new Error('Lodestoneアイテム詳細からITEM LEVELを正規化できません');
  }
  const effectsBlock = source.match(
    /<h3\b[^>]*class=["'][^"']*\bdb-view__sub_title\b[^"']*["'][^>]*>\s*Effects\s*<\/h3>[\s\S]*?<div\b[^>]*class=["'][^"']*\bdb-view__info_text\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
  )?.[1] || '';
  const variant = className => {
    const list = effectsBlock.match(
      new RegExp(`<ul\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/ul>`, 'i')
    )?.[1] || '';
    return [...list.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
      .map(match => normalizeText(match[1]))
      .filter(value => /^(?:作業精度|加工精度|CP)\s*\+/i.test(value));
  };
  return { ItemLevel: itemLevel, NQ: variant('sys_nq_element'), HQ: variant('sys_hq_element') };
}

export function canonicalLodestoneRecipeContent(html) {
  const source = String(html || '');
  const job = normalizeText(source.match(
    /<p\b[^>]*class=(["'])[^"']*\bdb-view__item__text__job_name\b[^"']*\1[^>]*>([\s\S]*?)<\/p>/i
  )?.[2]);
  const level = Number(normalizeText(source.match(
    /<span\b[^>]*class=(["'])[^"']*\bdb-view__item__text__level__num\b[^"']*\1[^>]*>([\s\S]*?)<\/span>/i
  )?.[2]));
  const amount = Number(normalizeText(source.match(
    /<span\b[^>]*class=(["'])[^"']*\bjs__complete_craft_count\b[^"']*\1[^>]*>([\s\S]*?)<\/span>/i
  )?.[2]));
  const masterbook = normalizeText(source.match(
    /<p\b[^>]*class=["'][^"']*\bdb-view__recipe__text__book_name\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i
  )?.[1]);
  const ingredients = [...source.matchAll(/<div\b[^>]*>/gi)]
    .map(match => tagAttributes(match[0]))
    .filter(attributes => String(attributes.class || '').split(/\s+/).includes('js__material'))
    .filter(attributes => String(attributes.class || '').split(/\s+/).includes('db-tree'))
    .filter(attributes => Number(attributes['data-depth']) === 1)
    .map(attributes => ({
      LodestoneKey: String(attributes['data-key'] || ''),
      Name: normalizeText(attributes['data-name']),
      Amount: Number(attributes['data-num'])
    }));
  const craftBlock = source.match(
    /<ul\b[^>]*class=["'][^"']*\bdb-view__recipe__craftdata\b[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i
  )?.[1] || '';
  const craftValues = new Map([...craftBlock.matchAll(
    /<li\b[^>]*>\s*<span\b[^>]*>([\s\S]*?)<\/span>([\s\S]*?)<\/li>/gi
  )].map(match => [normalizeText(match[1]), normalizeText(match[2])]));
  const integer = value => {
    const digits = String(value || '').replace(/[^0-9]/g, '');
    return digits ? Number(digits) : Number.NaN;
  };
  const conditions = [...source.matchAll(
    /<dl\b[^>]*class=["'][^"']*\bdb-view__recipe__crafting_conditions\b[^"']*["'][^>]*>([\s\S]*?)<\/dl>/gi
  )].flatMap(block => [...block[1].matchAll(/<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)].map(match => normalizeText(match[1])));
  const conditionText = conditions.join(' ');
  const optionalCondition = label => integer(conditionText.match(new RegExp(`${label}[^0-9]*([0-9,]+)`))?.[1]) || 0;
  const craftingData = {
    Difficulty: integer(craftValues.get('必要工数')),
    Durability: integer(craftValues.get('耐久')),
    MaxQuality: integer(craftValues.get('品質最大値')),
    MaterialQualityPercent: integer(craftValues.get('初期品質値')?.match(/上限\s*([0-9,]+)\s*％/)?.[1]),
    RequiredCraftsmanship: optionalCondition('作業精度'),
    RequiredControl: optionalCondition('加工精度'),
    HqAvailable: !conditions.some(value => /HQ(?:アイテム)?製作不可/i.test(value)),
    Expert: conditions.some(value => /高難易度|エキスパート/.test(value))
  };
  if (!/^(?:木工師|鍛冶師|甲冑師|彫金師|革細工師|裁縫師|錬金術師|調理師)$/u.test(job) ||
      !Number.isInteger(level) || level <= 0 || !Number.isInteger(amount) || amount <= 0 ||
      ingredients.length === 0 ||
      ingredients.some(ingredient => !ingredient.LodestoneKey || !ingredient.Name ||
        !Number.isInteger(ingredient.Amount) || ingredient.Amount <= 0) ||
      !Number.isInteger(craftingData.Difficulty) || craftingData.Difficulty <= 0 ||
      !Number.isInteger(craftingData.Durability) || craftingData.Durability <= 0 ||
      !Number.isInteger(craftingData.MaxQuality) || craftingData.MaxQuality < 0 ||
      !Number.isInteger(craftingData.MaterialQualityPercent) || craftingData.MaterialQualityPercent < 0 ||
      craftingData.MaterialQualityPercent > 100) {
    throw new Error('Lodestoneレシピ詳細を比較用に正規化できません');
  }
  return {
    Job: job,
    Level: level,
    Masterbook: masterbook,
    AmountResult: amount,
    CraftingData: craftingData,
    Ingredients: ingredients
  };
}

function sha256Json(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function indexBy(entries, key, label) {
  const result = new Map();
  for (const entry of entries || []) {
    const value = entry?.[key];
    if (!value || result.has(value)) throw new Error(`${label}が空または重複しています: ${value || '(空)'}`);
    result.set(value, entry);
  }
  return result;
}

function selectedRecipeResource(resources, recipe) {
  const key = recipe.AuditResourceKey || `recipe:${recipe.RecipeKey}`;
  const resource = resources.get(key);
  if (!resource?.completed) throw new Error(`監査レシピ成果物がありません: ${key}`);
  return resource;
}

function recipeContent(resources, recipe, readArtifact) {
  return canonicalLodestoneRecipeContent(
    readArtifact(selectedRecipeResource(resources, recipe)),
  );
}

function normalizedRecipeContent(content) {
  return {
    Job: content.Job,
    Level: Number(content.Level),
    Masterbook: content.Masterbook || '',
    AmountResult: Number(content.AmountResult),
    Ingredients: (content.Ingredients || []).map(ingredient => ({
      Name: ingredient.Name,
      Amount: Number(ingredient.Amount)
    }))
  };
}

function comparableAuditRecipeContent(content) {
  const normalized = normalizedRecipeContent(content);
  return {
    ...normalized,
    CraftingData: content.CraftingData,
    Ingredients: (content.Ingredients || []).map(ingredient => ({
      LodestoneKey: ingredient.LodestoneKey,
      Amount: Number(ingredient.Amount)
    }))
  };
}

function canonicalPublishedRecipeContent(recipe, ingredients = recipe?.Ingredients) {
  const content = normalizedRecipeContent({
    Job: recipe?.CraftInfo?.job,
    Level: recipe?.CraftInfo?.level,
    Masterbook: recipe?.CraftInfo?.masterbook,
    AmountResult: recipe?.AmountResult,
    Ingredients: ingredients
  });
  if (!content.Job || !Number.isInteger(content.Level) || content.Level <= 0 ||
      !Number.isInteger(content.AmountResult) || content.AmountResult <= 0 ||
      content.Ingredients.length === 0 || content.Ingredients.some(ingredient =>
        !ingredient.Name || !Number.isInteger(ingredient.Amount) || ingredient.Amount <= 0)) {
    throw new Error(`公開Item.jsonのLodestoneレシピを正規化できません: ${recipe?.RecipeKey || '(キーなし)'}`);
  }
  return content;
}

function withoutManualExchangeIngredients(itemName, ingredients, manualExchangeRows) {
  const result = (ingredients || []).map(ingredient => ({ ...ingredient }));
  for (const [targetName, currencyName, amount] of manualExchangeRows || []) {
    if (targetName !== itemName) continue;
    const index = result.findLastIndex(ingredient =>
      ingredient.Name === currencyName && Number(ingredient.Amount) === Number(amount));
    if (index >= 0) result.splice(index, 1);
  }
  return result;
}

function publishedRecipeBaseline(document, manualExchangeRows = []) {
  if (!document || Array.isArray(document) || !document.Version || !Array.isArray(document.Items)) {
    throw new Error('初回監査基準の公開Item.jsonが旧形式または不完全です');
  }
  const recipes = new Map();
  for (const item of document.Items) {
    const variants = [...(item?.Recipe ? [item.Recipe] : []), ...(Array.isArray(item?.Recipes) ? item.Recipes : [])];
    for (const recipe of variants) {
      const key = String(recipe?.RecipeKey || '');
      if (!key || key.startsWith('exchange-')) continue;
      const entry = {
        RecipeKey: key,
        Name: item.Name,
        Content: canonicalPublishedRecipeContent(
          recipe,
          withoutManualExchangeIngredients(item.Name, recipe.Ingredients, manualExchangeRows)
        )
      };
      const existing = recipes.get(key);
      if (existing && sha256Json(existing) !== sha256Json(entry)) {
        throw new Error(`公開Item.jsonのLodestoneレシピキーが競合しています: ${key}`);
      }
      recipes.set(key, entry);
    }
  }
  return recipes;
}

function validateInitialBaseline(snapshot, publishedDocument) {
  if (snapshot?.SchemaVersion !== 1 || snapshot.AuditId || !snapshot.Version ||
      !Array.isArray(snapshot.Items) || !Array.isArray(snapshot.Recipes)) {
    throw new Error('初回監査基準にはSchemaVersion 1のLodestoneスナップショットが必要です');
  }
  if (snapshot.ItemCount !== snapshot.Items.length || snapshot.RecipeCount !== snapshot.Recipes.length) {
    throw new Error('初回監査基準の一覧件数が一致しません');
  }
  if (publishedDocument.Version !== snapshot.Version) {
    throw new Error(`初回監査基準のVersionが一致しません: snapshot=${snapshot.Version} published=${publishedDocument.Version}`);
  }
}

export function compareInitialLodestoneAudit({
  baselineSnapshot,
  publishedDocument,
  manualExchangeRows = [],
  currentSnapshot,
  currentResources,
  readCurrentArtifact
}) {
  validateInitialBaseline(baselineSnapshot, publishedDocument);
  const items = compareEntries(baselineSnapshot.Items, currentSnapshot.Items, 'LodestoneKey', 'アイテム');
  const recipes = compareEntries(baselineSnapshot.Recipes, currentSnapshot.Recipes, 'RecipeKey', 'レシピ');
  const publishedRecipes = publishedRecipeBaseline(publishedDocument, manualExchangeRows);
  const baselineRecipes = indexBy(baselineSnapshot.Recipes, 'RecipeKey', '初回基準レシピキー');
  const baselineItemsByName = indexBy(baselineSnapshot.Items, 'Name', '初回基準アイテム名');
  const missingPublished = [...baselineRecipes.keys()].filter(key => !publishedRecipes.has(key));
  const extraPublished = [...publishedRecipes.keys()].filter(key => !baselineRecipes.has(key));
  if (missingPublished.length || extraPublished.length) {
    throw new Error(
      `初回監査基準と公開Item.jsonのLodestoneレシピが一致しません: ` +
      `不足=${missingPublished.length} 余分=${extraPublished.length}`
    );
  }
  for (const [key, baseline] of baselineRecipes) {
    if (publishedRecipes.get(key).Name !== baseline.Name) {
      throw new Error(`初回監査基準のレシピ名が公開Item.jsonと一致しません: ${key}`);
    }
  }
  const contentChanged = [];
  for (const [recipeKey, currentRecipe] of recipes.current) {
    const previousRecipe = recipes.previous.get(recipeKey);
    if (!previousRecipe) continue;
    const before = publishedRecipes.get(recipeKey).Content;
    const beforeComparable = {
      ...before,
      Ingredients: before.Ingredients.map(ingredient => {
        const baselineItem = baselineItemsByName.get(ingredient.Name);
        if (!baselineItem) {
          throw new Error(`公開Item.jsonのレシピ素材が初回監査基準にありません: ${ingredient.Name}`);
        }
        return { LodestoneKey: baselineItem.LodestoneKey, Amount: ingredient.Amount };
      })
    };
    const current = recipeContent(currentResources, currentRecipe, readCurrentArtifact);
    const afterComparable = {
      ...normalizedRecipeContent(current),
      Ingredients: (current.Ingredients || []).map(ingredient => ({
        LodestoneKey: ingredient.LodestoneKey,
        Amount: Number(ingredient.Amount)
      }))
    };
    if (sha256Json(beforeComparable) === sha256Json(afterComparable)) continue;
    contentChanged.push({
      RecipeKey: recipeKey,
      PreviousName: previousRecipe.Name,
      CurrentName: currentRecipe.Name,
      Previous: before,
      Current: normalizedRecipeContent(current)
    });
  }
  return {
    SchemaVersion: 1,
    PreviousAuditId: null,
    CurrentAuditId: currentSnapshot.AuditId,
    PreviousVersion: baselineSnapshot.Version,
    CurrentVersion: currentSnapshot.Version,
    Baseline: {
      Type: 'schema1-snapshot+published-item-json',
      CheckedAt: baselineSnapshot.CheckedAt
    },
    ItemChanges: { Renamed: items.renamed, Added: items.added, Removed: items.removed },
    RecipeChanges: {
      Renamed: recipes.renamed,
      ContentChanged: contentChanged,
      Added: recipes.added,
      Removed: recipes.removed
    },
    NameAliases: Object.fromEntries(items.renamed.map(entry => [entry.PreviousName, entry.CurrentName]))
  };
}

export function lodestoneAuditDataGeneration(snapshot, resources, readArtifact, itemResources = new Map()) {
  const hash = crypto.createHash('sha256');
  const items = (snapshot.Items || []).map(item => [item.LodestoneKey, item.Name, item.SortOrder]);
  hash.update(`{"Version":${JSON.stringify(snapshot.Version)},"Items":${JSON.stringify(items)},"Recipes":[`);
  for (const [index, recipe] of (snapshot.Recipes || []).entries()) {
    if (index > 0) hash.update(',');
    hash.update(JSON.stringify([
      recipe.RecipeKey,
      recipe.Name,
      recipe.Job,
      recipeContent(resources, recipe, readArtifact),
    ]));
  }
  hash.update('],"MacroItems":[');
  let itemIndex = 0;
  for (const [key, resource] of [...itemResources].sort(([left], [right]) => left.localeCompare(right))) {
    if (itemIndex > 0) hash.update(',');
    hash.update(JSON.stringify([key, canonicalLodestoneMacroItemContent(readArtifact(resource))]));
    itemIndex += 1;
  }
  hash.update(']}');
  return hash.digest('hex');
}

function compareEntries(previousEntries, currentEntries, key, label) {
  const previous = indexBy(previousEntries, key, `旧${label}キー`);
  const current = indexBy(currentEntries, key, `現行${label}キー`);
  return {
    previous,
    current,
    added: [...current].filter(([entryKey]) => !previous.has(entryKey)).map(([, entry]) => entry),
    removed: [...previous].filter(([entryKey]) => !current.has(entryKey)).map(([, entry]) => entry),
    renamed: [...current].flatMap(([entryKey, entry]) => {
      const old = previous.get(entryKey);
      return old && old.Name !== entry.Name
        ? [{ [key]: entryKey, PreviousName: old.Name, CurrentName: entry.Name }]
        : [];
    })
  };
}

export function compareLodestoneAudits({
  previousSnapshot,
  currentSnapshot,
  previousResources,
  currentResources,
  readPreviousArtifact,
  readCurrentArtifact = readPreviousArtifact
}) {
  const items = compareEntries(previousSnapshot.Items, currentSnapshot.Items, 'LodestoneKey', 'アイテム');
  const recipes = compareEntries(previousSnapshot.Recipes, currentSnapshot.Recipes, 'RecipeKey', 'レシピ');
  const contentChanged = [];
  for (const [recipeKey, currentRecipe] of recipes.current) {
    const previousRecipe = recipes.previous.get(recipeKey);
    if (!previousRecipe) continue;
    const before = recipeContent(previousResources, previousRecipe, readPreviousArtifact);
    const after = recipeContent(currentResources, currentRecipe, readCurrentArtifact);
    if (sha256Json(comparableAuditRecipeContent(before)) === sha256Json(comparableAuditRecipeContent(after))) continue;
    contentChanged.push({
      RecipeKey: recipeKey,
      PreviousName: previousRecipe.Name,
      CurrentName: currentRecipe.Name,
      Previous: before,
      Current: after
    });
  }
  return {
    SchemaVersion: 1,
    PreviousAuditId: previousSnapshot.AuditId,
    CurrentAuditId: currentSnapshot.AuditId,
    PreviousVersion: previousSnapshot.Version,
    CurrentVersion: currentSnapshot.Version,
    ItemChanges: { Renamed: items.renamed, Added: items.added, Removed: items.removed },
    RecipeChanges: {
      Renamed: recipes.renamed,
      ContentChanged: contentChanged,
      Added: recipes.added,
      Removed: recipes.removed
    },
    NameAliases: Object.fromEntries(items.renamed.map(entry => [entry.PreviousName, entry.CurrentName]))
  };
}

export function mergeLodestoneNameAliases(existing, comparison, currentNames) {
  const aliases = {
    ...(existing?.Aliases && typeof existing.Aliases === 'object' ? existing.Aliases : {}),
    ...(comparison?.NameAliases || {})
  };
  const resolve = name => {
    const visited = new Set();
    let current = name;
    while (aliases[current] && !visited.has(current)) {
      visited.add(current);
      current = aliases[current];
    }
    return visited.has(current) ? '' : current;
  };
  const current = new Set(currentNames || []);
  return Object.fromEntries(Object.keys(aliases).sort((left, right) => left.localeCompare(right, 'ja')).flatMap(oldName => {
    const currentName = resolve(oldName);
    return currentName && oldName !== currentName && current.has(currentName) ? [[oldName, currentName]] : [];
  }));
}
