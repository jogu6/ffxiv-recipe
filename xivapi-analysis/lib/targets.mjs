export function buildTargetItems(items) {
  if (!Array.isArray(items))
    throw new TypeError("Item.json must contain an array");

  const byId = new Map(items.map((item) => [String(item.ID), item]));
  const resultIds = new Set();
  const ingredientIds = new Set();

  for (const item of items) {
    if (!item?.Recipe) continue;
    resultIds.add(String(item.ID));
    for (const ingredient of item.Recipe.Ingredients ?? []) {
      const id = String(ingredient?.ItemID ?? "");
      if (id && id !== "0") ingredientIds.add(id);
    }
  }

  const targetIds = new Set([...resultIds, ...ingredientIds]);
  const targetItems = [...targetIds]
    .map((id) => {
      const item = byId.get(id);
      return {
        id,
        name: item?.Name ?? null,
        hasRecipe: resultIds.has(id),
        usedAsIngredient: ingredientIds.has(id),
        presentInItemJson: Boolean(item),
      };
    })
    .sort((left, right) => Number(left.id) - Number(right.id));

  return {
    itemJsonCount: items.length,
    recipeResultCount: resultIds.size,
    ingredientCount: ingredientIds.size,
    ingredientWithoutRecipeCount: [...ingredientIds].filter(
      (id) => !resultIds.has(id),
    ).length,
    targetCount: targetIds.size,
    missingFromItemJsonCount: targetItems.filter(
      (item) => !item.presentInItemJson,
    ).length,
    targetIds,
    targetItems,
  };
}
