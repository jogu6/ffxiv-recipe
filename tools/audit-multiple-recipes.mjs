import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  extractLodestoneCraftInfo,
  extractLodestoneRecipePaths,
  openLodestoneShopCacheStore,
  readLodestoneShopCacheEntry
} from '../pipeline/tool/pipeline-tool.mjs';

const root = path.resolve(import.meta.dirname, '..');
const items = JSON.parse(fs.readFileSync(path.join(root, 'site/data/Item.json'), 'utf8'));
const itemUrls = JSON.parse(fs.readFileSync(path.join(root, 'pipeline/state/lodestone-item-urls.json'), 'utf8'));
const store = openLodestoneShopCacheStore(path.join(root, 'pipeline/cache/lodestone-shops.sqlite'));

function cacheKey(url) {
  return crypto.createHash('sha256').update(url).digest('hex');
}

function cachedHtml(url) {
  return readLodestoneShopCacheEntry(store, cacheKey(url));
}

function decodeAttribute(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function tagAttributes(tag) {
  return Object.fromEntries(
    [...tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)].map(([, name, , value]) => [
      name.toLowerCase(),
      decodeAttribute(value)
    ])
  );
}

function directIngredients(html) {
  return [...String(html || '').matchAll(/<div\b[^>]*>/gi)]
    .map(match => tagAttributes(match[0]))
    .filter(attributes => {
      const classes = String(attributes.class || '').split(/\s+/);
      return classes.includes('js__material') && classes.includes('db-tree');
    })
    .filter(attributes => Number(attributes['data-depth']) === 1)
    .map(attributes => ({
      key: attributes['data-key'] || '',
      name: attributes['data-name'] || '',
      amount: Number(attributes['data-num']) || 0,
      craftAmount: Number(attributes['data-craft_num']) || 0
    }));
}

function resultAmount(html) {
  const match = String(html || '').match(
    /<span\b[^>]*class=(["'])[^"']*\bjs__complete_craft_count\b[^"']*\1[^>]*>([\s\S]*?)<\/span>/i
  );
  const amount = Number(match?.[2]?.replace(/<[^>]*>/g, '').trim());
  return Number.isInteger(amount) && amount > 0 ? amount : null;
}

function recipeId(recipePath) {
  return recipePath.match(/\/recipe\/([a-z0-9]+)\//)?.[1] || '';
}

function ingredientSignature(ingredients) {
  return ingredients.map(ingredient => `${ingredient.name}:${ingredient.amount}`).join('|');
}

const itemById = new Map(items.map(item => [String(item.ID), item]));
const itemIdByName = new Map(items.map(item => [item.Name, String(item.ID)]));
const itemIdByLodestoneKey = new Map(
  Object.entries(itemUrls)
    .map(([itemId, url]) => [url.match(/\/item\/([a-z0-9]+)\//)?.[1], itemId])
    .filter(([key]) => key)
);
const audit = [];
const missing = [];

try {
  for (const [itemId, itemUrl] of Object.entries(itemUrls)) {
    const item = itemById.get(itemId);
    if (!item) continue;
    const detailHtml = cachedHtml(itemUrl);
    if (!detailHtml) {
      missing.push({ itemId, name: item.Name, kind: 'item', url: itemUrl });
      continue;
    }
    const paths = extractLodestoneRecipePaths(detailHtml);
    if (paths.length <= 1) continue;

    const variants = paths.map(recipePath => {
      const url = `https://jp.finalfantasyxiv.com${recipePath}`;
      const html = cachedHtml(url);
      if (!html) {
        missing.push({ itemId, name: item.Name, kind: 'recipe', url });
        return { recipeId: recipeId(recipePath), url, missing: true };
      }
      const craftInfo = extractLodestoneCraftInfo(html);
      const ingredients = directIngredients(html);
      return {
        recipeId: recipeId(recipePath),
        url,
        ...craftInfo,
        resultAmount: resultAmount(html),
        ingredients,
        ingredientSignature: ingredientSignature(ingredients)
      };
    });
    audit.push({ itemId: Number(itemId), name: item.Name, variants });
  }
} finally {
  store.close();
}

const allVariants = audit.flatMap(entry => entry.variants);
const parsedVariants = allVariants.filter(variant => !variant.missing && variant.job);
const sameJobItems = audit.filter(entry => {
  const jobs = entry.variants.map(variant => variant.job).filter(Boolean);
  return new Set(jobs).size < jobs.length;
});
const differingIngredientItems = audit.filter(entry => {
  const signatures = entry.variants.map(variant => variant.ingredientSignature).filter(Boolean);
  return new Set(signatures).size > 1;
});
const sameIngredientItems = audit.filter(entry => {
  const signatures = entry.variants.map(variant => variant.ingredientSignature).filter(Boolean);
  return signatures.length === entry.variants.length && new Set(signatures).size === 1;
});
const invalidVariants = allVariants.filter(
  variant => variant.missing || !variant.job || !variant.resultAmount || variant.ingredients.length === 0
);
const ingredientReferences = parsedVariants.flatMap(variant => variant.ingredients);
const keyResolvedIngredients = ingredientReferences.filter(ingredient => itemIdByLodestoneKey.has(ingredient.key));
const nameResolvedIngredients = ingredientReferences.filter(ingredient => itemIdByName.has(ingredient.name));
const ingredientResolutionDisagreements = ingredientReferences.filter(ingredient => {
  const byKey = itemIdByLodestoneKey.get(ingredient.key);
  const byName = itemIdByName.get(ingredient.name);
  return byKey && byName && byKey !== byName;
});

const summarize = entry => ({
  itemId: entry.itemId,
  name: entry.name,
  variants: entry.variants.map(variant => ({
    recipeId: variant.recipeId,
    job: variant.job || null,
    level: variant.level || null,
    masterbook: variant.masterbook || null,
    resultAmount: variant.resultAmount || null,
    ingredients:
      variant.ingredients?.map(({ key, name, amount }) => ({
        key,
        itemIdByKey: itemIdByLodestoneKey.get(key) || null,
        itemIdByName: itemIdByName.get(name) || null,
        name,
        amount
      })) || [],
    missing: Boolean(variant.missing)
  }))
});

console.log(
  JSON.stringify(
    {
      summary: {
        itemCount: items.length,
        multiRecipeItemCount: audit.length,
        recipeVariantCount: allVariants.length,
        parsedRecipeVariantCount: parsedVariants.length,
        differingIngredientItemCount: differingIngredientItems.length,
        sameIngredientItemCount: sameIngredientItems.length,
        sameJobDuplicateItemCount: sameJobItems.length,
        invalidRecipeVariantCount: invalidVariants.length,
        missingCacheEntryCount: missing.length,
        ingredientReferenceCount: ingredientReferences.length,
        ingredientKeyResolvedCount: keyResolvedIngredients.length,
        ingredientNameResolvedCount: nameResolvedIngredients.length,
        ingredientResolutionDisagreementCount: ingredientResolutionDisagreements.length
      },
      sameJobItems: sameJobItems.map(summarize),
      invalidItems: audit.filter(entry => entry.variants.some(variant => invalidVariants.includes(variant))).map(summarize),
      samples: [
        ...audit.filter(entry => entry.name === 'ミラージュプリズム'),
        ...differingIngredientItems.filter(entry => entry.name !== 'ミラージュプリズム').slice(0, 2),
        ...sameIngredientItems.slice(0, 2)
      ].map(summarize)
    },
    null,
    2
  )
);
