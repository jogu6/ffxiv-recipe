function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function validateRecipe(recipe) {
  return recipe && nonEmptyString(recipe.id) && nonEmptyString(recipe.name)
    && nonEmptyString(recipe.job) && Number.isInteger(recipe.level) && recipe.level > 0
    && Array.isArray(recipe.ingredients)
    && recipe.ingredients.every(item => item && nonEmptyString(item.id) && nonEmptyString(item.name)
      && Number.isInteger(item.amount) && item.amount > 0);
}

function validateConsumable(item) {
  return item && nonEmptyString(item.id) && nonEmptyString(item.name)
    && (item.itemLevel === null || (Number.isInteger(item.itemLevel) && item.itemLevel >= 0))
    && (item.craftLevel === null || (Number.isInteger(item.craftLevel) && item.craftLevel > 0))
    && Number.isInteger(item.sortOrder) && item.sortOrder >= 0
    && typeof item.hq === 'boolean' && item.effects && typeof item.effects === 'object'
    && typeof item.effectsAvailable === 'boolean';
}

export function validateMacroData(data) {
  if (!data || !nonEmptyString(data.dataVersion) || !Array.isArray(data.recipes)
    || !Array.isArray(data.foods) || !Array.isArray(data.medicines)
    || !Number.isInteger(data.maxCrafterLevel) || data.maxCrafterLevel <= 0
    || !data.recipes.every(validateRecipe)
    || !data.foods.every(validateConsumable)
    || !data.medicines.every(validateConsumable)) {
    throw new TypeError('マクロ用Lodestoneデータの形式が不正です');
  }
  return data;
}

function compactEffects(effects = {}) {
  const result = {};
  for (const [source, target] of [
    ['Craftsmanship', 'craftsmanship'],
    ['Control', 'control'],
    ['CP', 'cp']
  ]) {
    const effect = effects[source];
    if (!effect) continue;
    result[`${target}Percent`] = Number(effect.Percent) || 0;
    result[`${target}Cap`] = Number(effect.Max) || 0;
  }
  return result;
}

function consumableCraftLevel(item) {
  const levels = recipeVariants(item)
    .map(recipe => Number(recipe?.CraftInfo?.level))
    .filter(level => Number.isInteger(level) && level > 0);
  return levels.length ? Math.max(...levels) : null;
}

function consumableVariants(item) {
  if (!item?.CraftingEffects) return [];
  const craftLevel = consumableCraftLevel(item);
  const variants = ['HQ', 'NQ'].map(quality => {
    const effects = compactEffects(item.CraftingEffects[quality]);
    return {
      id: `${item.Name}:${quality.toLowerCase()}`,
      name: item.Name,
      itemLevel: Number.isInteger(item.ItemLevel) ? item.ItemLevel : null,
      craftLevel,
      sortOrder: Number(item.SortOrder) || 0,
      hq: quality === 'HQ',
      iconFile: item.IconFile || '',
      effects,
      effectsAvailable: Object.keys(effects).length > 0
    };
  });
  return variants;
}

function recipeVariants(item) {
  const values = [];
  if (item?.Recipe) values.push(item.Recipe);
  for (const recipe of item?.Recipes || []) {
    if (!values.some(value => value?.RecipeKey === recipe?.RecipeKey)) values.push(recipe);
  }
  return values;
}

function hasHqCraftingRecipe(item) {
  return recipeVariants(item).some(recipe => recipe?.CraftInfo?.job
    && recipe?.CraftingData?.HqAvailable !== false);
}

export function consumableListsFromItemDocument(document) {
  if (!document || !Array.isArray(document.Items)) {
    throw new TypeError('Item.jsonの形式が不正です');
  }
  return {
    foods: document.Items.filter(item => item.ItemCategory === '調理品').flatMap(consumableVariants),
    medicines: document.Items.filter(item => item.ItemCategory === '薬品').flatMap(consumableVariants)
  };
}

export function macroDataFromItemDocument(document, preparedConsumables = null) {
  if (!document || !Array.isArray(document.Items) || !nonEmptyString(document.Version)) {
    throw new TypeError('Item.jsonの形式が不正です');
  }
  const items = new Map(document.Items.map(item => [item.Name, item]));
  const recipes = document.Items.flatMap(item => recipeVariants(item).flatMap(recipe => {
    if (!recipe?.RecipeKey || !recipe?.CraftInfo?.job || !Number(recipe.CraftInfo.level)) return [];
    const data = recipe.CraftingData || {};
    const recipeLevel = data.RecipeLevel;
    const ingredients = (recipe.Ingredients || []).flatMap(ingredient => {
      const source = items.get(ingredient.Name);
      if (!source || !hasHqCraftingRecipe(source)) return [];
      return [{
        id: ingredient.Name,
        name: ingredient.Name,
        amount: Number(ingredient.Amount),
        iconFile: source.IconFile || ''
      }];
    });
    return [{
      id: String(recipe.RecipeKey),
      name: item.Name,
      job: recipe.CraftInfo?.job,
      level: Number(recipe.CraftInfo?.level),
      difficulty: Number.isInteger(Number(data.Difficulty)) ? Number(data.Difficulty) : null,
      durability: Number.isInteger(Number(data.Durability)) ? Number(data.Durability) : null,
      maxQuality: Number.isInteger(Number(data.MaxQuality)) ? Number(data.MaxQuality) : null,
      materialQualityPercent: Number.isInteger(Number(data.MaterialQualityPercent)) ? Number(data.MaterialQualityPercent) : null,
      requiredCraftsmanship: Number.isInteger(Number(data.RequiredCraftsmanship)) ? Number(data.RequiredCraftsmanship) : null,
      requiredControl: Number.isInteger(Number(data.RequiredControl)) ? Number(data.RequiredControl) : null,
      hqAvailable: data.HqAvailable !== false,
      expert: data.Expert === true,
      requiredQuality: Number.isInteger(Number(data.RequiredQuality)) ? Number(data.RequiredQuality) : null,
      stellarSteadyHandCharges: Number.isInteger(Number(data.StellarSteadyHandCharges)) ? Number(data.StellarSteadyHandCharges) : null,
      recipeLevel: recipeLevel && {
        jobLevel: Number(recipeLevel.JobLevel),
        progressDivisor: Number(recipeLevel.ProgressDivisor),
        qualityDivisor: Number(recipeLevel.QualityDivisor),
        progressModifier: Number(recipeLevel.ProgressModifier),
        qualityModifier: Number(recipeLevel.QualityModifier)
      },
      iconFile: item.IconFile || '',
      ingredients
    }];
  }));
  const consumables = preparedConsumables || consumableListsFromItemDocument(document);
  const maxCrafterLevel = Math.max(...recipes.map(recipe => recipe.level));
  return validateMacroData({
    dataVersion: `${document.Version}:${document.DataGeneration || 'unversioned'}`,
    recipes,
    foods: consumables.foods,
    medicines: consumables.medicines,
    maxCrafterLevel
  });
}

export async function loadMacroData(url = '../../site/data/Item.json', fetchImpl = fetch) {
  const response = await fetchImpl(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Item.jsonを読み込めません (${response.status})`);
  return macroDataFromItemDocument(await response.json());
}

export function recipeFromLocation(data, locationLike = location) {
  const id = new URLSearchParams(locationLike.search).get('recipe');
  if (!id) return null;
  return data.recipes.find(recipe => String(recipe.id) === id) || null;
}
