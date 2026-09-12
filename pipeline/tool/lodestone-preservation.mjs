import { isDeepStrictEqual } from 'node:util';

const generatedItemFields = new Set(['ID', 'Name', 'SortOrder', 'ItemCategory', 'Recipe', 'Recipes',
  'MaterialSortOrder', 'ItemLevel', 'CraftingEffects', 'IconFile', 'ShopInfo']);

export function publicItemMetadata(document) {
  if (!document || Array.isArray(document)) return {};
  return structuredClone(Object.fromEntries(Object.entries(document)
    .filter(([key]) => !['Version', 'DataGeneration', 'ItemNameAliases', 'Items'].includes(key))));
}

export function publicLodestoneDocument(candidate) {
  return {
    ...publicItemMetadata(candidate.PublicMetadata),
    Version: candidate.Version,
    DataGeneration: candidate.DataGeneration,
    ...(candidate.ItemNameAliases ? { ItemNameAliases: candidate.ItemNameAliases } : {}),
    Items: candidate.Items
  };
}

// Prevent partial candidate generation from silently deleting existing data.
// Source-owned values may change; opaque fields must survive unchanged.
export function assertLodestoneItemPreservation(existingDocument, candidateItems, aliases = {}, retiredNames = []) {
  const existing = Array.isArray(existingDocument) ? existingDocument : existingDocument?.Items || [];
  const byName = new Map(candidateItems.map(item => [item.Name, item]));
  const retired = new Set(retiredNames);
  const problems = [];
  for (const before of existing) {
    const after = byName.get(aliases[before.Name] || before.Name);
    if (!after) {
      if (!retired.has(before.Name)) problems.push(`${before.Name}: アイテム欠落`);
      continue;
    }
    for (const [key, value] of Object.entries(before)) {
      if (key === 'ID' || key === 'Recipe' || key === 'Recipes') continue;
      if (!Object.hasOwn(after, key)) problems.push(`${before.Name}.${key}: フィールド欠落`);
      else if (!generatedItemFields.has(key) && !isDeepStrictEqual(value, after[key])) {
        problems.push(`${before.Name}.${key}: 引き継ぎ内容不一致`);
      }
    }
    if (before.ShopInfo) {
      // Prices can be refreshed in bulk. Keep vendor locations, ranks, and
      // custom vendor fields, which are not all available on shop pages.
      for (const [key, value] of Object.entries(before.ShopInfo)) {
        if (key !== 'price' && !isDeepStrictEqual(value, after.ShopInfo?.[key])) {
          problems.push(`${before.Name}.ShopInfo.${key}: 引き継ぎ内容不一致`);
        }
      }
    }
  }
  if (problems.length) throw new Error(`既存アイテム情報を保全できません (${problems.length}件):\n${problems.slice(0, 20).join('\n')}`);
}
