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
      recipeId: String(rawRecipe.RecipeID || ''),
      yield: toNumeric(rawRecipe.AmountResult, 1),
      craftType: String(rawRecipe.CraftType),
      craftInfo: rawRecipe.CraftInfo || fallbackCraftInfo || null,
      ingredients: rawRecipe.Ingredients.map(ingredient => ({
        name: ingredient.Name || itemNameForId(ingredient.ItemID),
        qty: toNumeric(ingredient.Amount, 1),
        itemId: ingredient.ItemID
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

  function buildRecipeData(
    rawList,
    {
      craftTypeNames = {},
      crystalExclude = new Set(),
      iconPath = () => '',
      sortRecipeNames = names => [...names].sort()
    } = {}
  ) {
    const itemMaster = {};
    const recipes = {};
    const recipeVariants = {};
    const activeRecipeIds = {};
    const defaultRecipeIds = {};
    const idToRecipeName = {};
    const idToItemName = {};
    const idToItem = {};
    let maxPatch = 0;

    rawList.forEach(item => {
      idToItem[item.ID] = item;
      const numericId = toNumeric(item.ID, NaN);
      if (!Number.isNaN(numericId)) idToItemName[numericId] = item.Name;
    });
    const itemNameForId = id => idToItemName[parseInt(id, 10)] || null;

    rawList.forEach(item => {
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
        id: item.ID,
        numericId: toNumeric(item.ID),
        uiCategory: toNumeric(item.ItemUICategory),
        uiCategoryName: item.ItemUICategoryName || '',
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
      } else {
        itemMaster[name] = {
          ...commonMaster,
          method: '',
          craftType: ''
        };
      }
    });

    rawList.forEach(item => {
      const sourceRecipes = Array.isArray(item.Recipes) && item.Recipes.length > 0 ? item.Recipes : [item.Recipe];
      sourceRecipes.flatMap(recipe => recipe?.Ingredients || []).forEach(ingredient => {
        const ingredientName = ingredient.Name || itemNameForId(ingredient.ItemID);
        if (!ingredientName || itemMaster[ingredientName]) return;
        const source = idToItem[ingredient.ItemID] || {};
        itemMaster[ingredientName] = {
          method: '',
          icon: iconPath(source),
          craftType: '',
          id: ingredient.ItemID,
          numericId: toNumeric(ingredient.ItemID),
          uiCategory: toNumeric(source.ItemUICategory),
          uiCategoryName: source.ItemUICategoryName || '',
          gatheringTimer: source.GatheringTimer || [],
          shopInfo: source.ShopInfo || null,
          equipmentInfo: source.EquipmentInfo || null,
          isEx: source.IsEx === true
        };
      });
    });

    const recipeNames = sortRecipeNames(Object.keys(recipes));
    const usedInSets = {};
    Object.entries(recipeVariants).forEach(([recipeName, variants]) => {
      variants.forEach(recipe => {
        recipe.ingredients.forEach(ingredient => {
          if (!usedInSets[ingredient.name]) usedInSets[ingredient.name] = new Set();
          usedInSets[ingredient.name].add(recipeName);
        });
      });
    });
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
      recipeNames,
      recipes,
      recipeVariants,
      usedIn
    };
  }

  return Object.freeze({
    buildRecipeData,
    defaultRecipeVariant,
    normalizedRecipeVariant,
    recipeIngredientSignature
  });
});
