(function initRecipeDataModel(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RecipeDataModel = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function createRecipeDataModel() {
  'use strict';

  function toNumeric(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function normalizedRecipeVariant(
    rawRecipe,
    { fallbackCraftInfo = null, itemNameForId = () => null } = {}
  ) {
    if (!rawRecipe || rawRecipe.CraftType === undefined || !Array.isArray(rawRecipe.Ingredients)) return null;
    return {
      recipeId: String(rawRecipe.RecipeKey || rawRecipe.RecipeID || ''),
      yield: toNumeric(rawRecipe.AmountResult, 1),
      craftType: String(rawRecipe.CraftType),
      craftInfo: rawRecipe.CraftInfo || fallbackCraftInfo || null,
      ingredients: rawRecipe.Ingredients.map(ingredient => ({
        name: ingredient.Name || itemNameForId(ingredient.ItemID),
        qty: toNumeric(ingredient.Amount, 1),
        itemId: ingredient.Name || ingredient.ItemID
      })).filter(ingredient => ingredient.name)
    };
  }

  function recipeIngredientSignature(recipe) {
    return (recipe?.ingredients || [])
      .map(ingredient => `${ingredient.itemId}:${ingredient.name}:${ingredient.qty}`)
      .join('|');
  }

  function defaultRecipeVariant(variants, legacyRecipe, options = {}) {
    if (variants.length <= 1) return variants[0] || null;
    const legacy = normalizedRecipeVariant(legacyRecipe, options);
    if (!legacy) return variants[0];
    const signature = recipeIngredientSignature(legacy);
    return (
      variants.find(
        variant => variant.craftType === legacy.craftType && recipeIngredientSignature(variant) === signature
      ) ||
      variants.find(variant => recipeIngredientSignature(variant) === signature) ||
      variants.find(variant => variant.craftType === legacy.craftType) ||
      variants[0]
    );
  }

  function* buildRecipeDataSteps(
    rawList,
    {
      craftTypeNames = {},
      crystalExclude = new Set(),
      iconPath = () => '',
      sortRecipeNames = names => [...names].sort()
    } = {}
  ) {
    const source = Array.isArray(rawList) ? { Items: rawList, Version: '' } : (rawList || {});
    rawList = Array.isArray(source.Items) ? source.Items : [];
    const itemMaster = {};
    const recipes = {};
    const recipeVariants = {};
    const activeRecipeIds = {};
    const defaultRecipeIds = {};
    const idToRecipeName = {};
    const idToItemName = {};
    const idToItem = {};
    let maxPatch = 0;

    const phaseProgress = (phase, start, span, index, total) => ({
      phase,
      percent: start + (total > 0 ? ((index + 1) / total) * span : span)
    });

    for (let index = 0; index < rawList.length; index += 1) {
      const item = rawList[index];
      idToItem[item.Name] = item;
      if (item.ID !== undefined) idToItem[item.ID] = item;
      const numericId = toNumeric(item.ID, NaN);
      if (!Number.isNaN(numericId)) idToItemName[numericId] = item.Name;
      idToItemName[item.Name] = item.Name;
      yield phaseProgress('アイテム索引を作成しています', 0, 20, index, rawList.length);
    }
    const itemNameForId = id => idToItemName[id] || idToItemName[parseInt(id, 10)] || null;

    for (let index = 0; index < rawList.length; index += 1) {
      const item = rawList[index];
      const legacyRecipe = item.Recipe;
      const name = item.Name;
      if (legacyRecipe?.PatchNumber) {
        const patchNumber = toNumeric(legacyRecipe.PatchNumber);
        if (patchNumber > maxPatch) maxPatch = patchNumber;
      }

      const variants = (Array.isArray(item.Recipes) && item.Recipes.length > 0 ? item.Recipes : [legacyRecipe])
        .map(rawRecipe => {
          const method = craftTypeNames[rawRecipe?.CraftType] || 'クラフト';
          const fallbackCraftInfo =
            (item.CraftInfo || []).find(info => info.job === method) || item.CraftInfo?.[0] || null;
          return normalizedRecipeVariant(rawRecipe, { fallbackCraftInfo, itemNameForId });
        })
        .filter(Boolean);

      const commonMaster = {
        icon: iconPath(item),
        id: item.Name,
        numericId: toNumeric(item.SortOrder ?? item.ID),
        sortOrder: toNumeric(item.SortOrder ?? item.ID),
        materialSortOrder: toNumeric(item.MaterialSortOrder, Number.MAX_SAFE_INTEGER),
        uiCategory: toNumeric(item.ItemUICategory),
        uiCategoryName: item.ItemCategory || item.ItemUICategoryName || '',
        gatheringTimer: item.GatheringTimer || [],
        shopInfo: item.ShopInfo || null,
        equipmentInfo: item.EquipmentInfo || null,
        isEx: item.IsEx === true
      };

      if (variants.length > 0) {
        const recipe = defaultRecipeVariant(variants, legacyRecipe, { itemNameForId });
        const craftInfo = recipe.craftInfo;
        itemMaster[name] = {
          ...commonMaster,
          method: craftTypeNames[recipe.craftType] || 'クラフト',
          craftType: recipe.craftType,
          craftLevel: toNumeric(craftInfo?.level, 0),
          masterbook: craftInfo?.masterbook || '',
          craftInfo: item.CraftInfo || []
        };
        recipeVariants[name] = variants;
        recipes[name] = recipe;
        activeRecipeIds[name] = recipe.recipeId;
        defaultRecipeIds[name] = recipe.recipeId;
        const numericId = toNumeric(item.ID, NaN);
        if (!Number.isNaN(numericId)) idToRecipeName[numericId] = name;
        idToRecipeName[name] = name;
      } else {
        itemMaster[name] = {
          ...commonMaster,
          method: '',
          craftType: ''
        };
      }
      yield phaseProgress('レシピを関連付けています', 20, 45, index, rawList.length);
    }

    for (let index = 0; index < rawList.length; index += 1) {
      const item = rawList[index];
      const sourceRecipes = Array.isArray(item.Recipes) && item.Recipes.length > 0 ? item.Recipes : [item.Recipe];
      sourceRecipes.flatMap(recipe => recipe?.Ingredients || []).forEach(ingredient => {
        const ingredientName = ingredient.Name || itemNameForId(ingredient.ItemID);
        if (!ingredientName || itemMaster[ingredientName]) return;
        const source = idToItem[ingredient.Name] || idToItem[ingredient.ItemID] || {};
        itemMaster[ingredientName] = {
          method: '',
          icon: iconPath(source),
          craftType: '',
          id: ingredientName,
          numericId: toNumeric(source.SortOrder ?? ingredient.ItemID),
          sortOrder: toNumeric(source.SortOrder ?? ingredient.ItemID),
          materialSortOrder: toNumeric(source.MaterialSortOrder, Number.MAX_SAFE_INTEGER),
          uiCategory: toNumeric(source.ItemUICategory),
          uiCategoryName: source.ItemCategory || source.ItemUICategoryName || '',
          gatheringTimer: source.GatheringTimer || [],
          shopInfo: source.ShopInfo || null,
          equipmentInfo: source.EquipmentInfo || null,
          isEx: source.IsEx === true
        };
      });
      yield phaseProgress('素材情報を関連付けています', 65, 15, index, rawList.length);
    }

    const recipeNames = sortRecipeNames(Object.keys(recipes));
    const usedInSets = {};
    const recipeEntries = Object.entries(recipeVariants);
    for (let index = 0; index < recipeEntries.length; index += 1) {
      const [recipeName, variants] = recipeEntries[index];
      variants.forEach(recipe => {
        recipe.ingredients.forEach(ingredient => {
          if (!usedInSets[ingredient.name]) usedInSets[ingredient.name] = new Set();
          usedInSets[ingredient.name].add(recipeName);
        });
      });
      yield phaseProgress('使用先索引を作成しています', 80, 20, index, recipeEntries.length);
    }
    const usedIn = Object.fromEntries(
      Object.entries(usedInSets).map(([ingredientName, recipeSet]) => [ingredientName, [...recipeSet]])
    );
    const ingredientNames = sortRecipeNames(
      Object.keys(usedIn).filter(name => !recipes[name] && !crystalExclude.has(name))
    );

    return {
      activeRecipeIds,
      defaultRecipeIds,
      idToItemName,
      idToRecipeName,
      ingredientNames,
      itemMaster,
      maxPatch,
      version: String(source.Version || ''),
      recipeNames,
      recipes,
      recipeVariants,
      usedIn
    };
  }

  function buildRecipeData(rawList, options = {}) {
    const steps = buildRecipeDataSteps(rawList, options);
    let step = steps.next();
    while (!step.done) step = steps.next();
    return step.value;
  }

  async function buildRecipeDataAsync(
    rawList,
    options = {},
    {
      chunkSize = 250,
      onProgress = () => {},
      yieldControl = () => new Promise(resolve => setTimeout(resolve, 0))
    } = {}
  ) {
    const steps = buildRecipeDataSteps(rawList, options);
    let processedInChunk = 0;
    let step = steps.next();
    while (!step.done) {
      onProgress(step.value);
      processedInChunk += 1;
      if (processedInChunk >= chunkSize) {
        processedInChunk = 0;
        await yieldControl();
      }
      step = steps.next();
    }
    onProgress({ phase: 'データ構築を完了しています', percent: 100 });
    return step.value;
  }

  return Object.freeze({
    buildRecipeData,
    buildRecipeDataAsync,
    defaultRecipeVariant,
    normalizedRecipeVariant,
    recipeIngredientSignature
  });
});
