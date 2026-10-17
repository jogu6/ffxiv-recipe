import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { applyLodestoneShopIndex, createLodestoneAcquisitionReader, createLodestoneHtmlReader, readGatheringSupplements, readGilShopSupplements } from './pipeline-tool.mjs';
import { readLodestoneShopIndex } from './lodestone-shop-source.mjs';
import { LODESTONE_BASE_URL } from './lodestone-source.mjs';

function content(item) {
  return {
    shops: item.ShopInfo || null,
    locations: item.GatheringTimer || [],
    costs: [item.Recipe, ...(item.Recipes || [])].filter(recipe => recipe && ['8', '9'].includes(String(recipe.CraftType)))
      .map(recipe => recipe.Ingredients.map(entry => ({ Name: entry.Name, Amount: Number(entry.Amount) }))),
    gathering: [...(item.GatheringLevels || [])].sort((a, b) => a.method.localeCompare(b.method) || a.level - b.level),
    exchanges: (item.ExchangeInfo || []).map(route => ({
      resultAmount: route.resultAmount || 1,
      ingredients: [...route.ingredients].sort((a, b) => a.Name.localeCompare(b.Name)),
      shops: [...(route.shops || [])].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  };
}

// Compare against published values, so a failed publication never advances the baseline.
export async function compareLodestoneAcquisition({ root = path.resolve(import.meta.dirname, '../..'), delayMs = 100, fetchImpl = fetch, maxAgeMs, onAcquisitionProgress = () => {} } = {}) {
  const document = JSON.parse(fs.readFileSync(path.join(root, 'site/data/Item.json'), 'utf8'));
  const items = document.Items || document;
  const supplements = readGatheringSupplements(root);
  const gilSupplements = readGilShopSupplements(root);
  const targets = items.filter(item => item.GatheringLevels?.length || item.GatheringTimer?.length || supplements.has(item.Name));
  if (!items.some(item => item.MaterialSortOrder || item.ShopInfo || item.ExchangeInfo?.length || item.GatheringLevels?.length
    || item.GatheringTimer?.length || supplements.has(item.Name) || gilSupplements.has(item.Name) || ['8','9'].includes(String(item.Recipe?.CraftType)))) return { AcquisitionChanged: false, CheckedAcquisitionItems: 0 };
  const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'pipeline/state/lodestone-source-snapshot.json'), 'utf8'));
  const byName = new Map(snapshot.Items.map(item => [item.Name, item]));
  const htmlReader = createLodestoneHtmlReader({ root, version: document.Version, delayMs, fetchImpl, maxAgeMs });
  const request = url => htmlReader.request(url);
  try {
  const exchangeCurrencies = new Set(items.filter(item => ['8', '9'].includes(String(item.Recipe?.CraftType)))
    .flatMap(item => item.Recipe.Ingredients.map(ingredient => ingredient.Name)));
  const shopSource = await readLodestoneShopIndex({ request, version: document.Version, supplements: gilSupplements,
    onProgress: progress => onAcquisitionProgress({ ...progress, kind: 'shop' }) });
  for (const [index, item] of items.entries()) {
    const current = structuredClone(item);
    applyLodestoneShopIndex(current, shopSource.index, exchangeCurrencies);
    if (!isDeepStrictEqual(content(item), content(current))) return {
      AcquisitionChanged: true, AcquisitionRefreshId: crypto.randomUUID(),
      AcquisitionChange: item.Name, CheckedAcquisitionItems: index + 1, CheckedShops: shopSource.shops
    };
  }
  const readAcquisition = createLodestoneAcquisitionReader({ request, supplements });
  for (const [index, item] of targets.entries()) {
    const source = byName.get(item.Name);
    if (!source?.DetailPath) throw new Error(`入手情報の詳細URLがありません: ${item.Name}`);
    const html = await request(`${LODESTONE_BASE_URL}${source.DetailPath}`);
    // A maintenance/login page must never erase published acquisition data.
    if (!html.includes('db-view__item__text__name')) throw new Error(`入手情報のアイテム詳細ページが不正です: ${item.Name}`);
    const current = structuredClone(item);
    await readAcquisition(current, html);
    onAcquisitionProgress({ item: item.Name, completed: index + 1, total: targets.length });
    if (!isDeepStrictEqual(content(item), content(current))) return {
      AcquisitionChanged: true, AcquisitionRefreshId: crypto.randomUUID(),
      AcquisitionChange: item.Name, CheckedAcquisitionItems: index + 1
    };
  }
  return { AcquisitionChanged: false, CheckedAcquisitionItems: targets.length };
  } finally { htmlReader.close(); }
}
