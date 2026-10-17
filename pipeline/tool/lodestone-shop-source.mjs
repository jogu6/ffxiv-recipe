import { LODESTONE_BASE_URL, extractLodestoneListMeta, normalizeLodestoneName } from './lodestone-source.mjs';

const text = normalizeLodestoneName;
const positive = value => {
  const number = Number(text(value).replaceAll(',', ''));
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error('店舗の価格・交換個数を取得できません');
  return number;
};

export function extractLodestoneShopList(html) {
  return [...String(html).matchAll(/<a\b[^>]*href=["'](\/lodestone\/playguide\/db\/shop\/([a-z0-9]+)\/(?:\?[^"']*)?)["'][^>]*class=["'][^"']*db-table__txt--detail_link[^"']*["'][^>]*>([\s\S]*?)<\/a>/g)]
    .map(match => ({ id: match[2], name: text(match[3]) }));
}

function location(value) {
  const source = text(value);
  const match = source.match(/^(.*?)\s*X:\s*([\d.]+)\s*Y:\s*([\d.]+)/);
  return match ? { area: match[1].trim(), x: Number(match[2]), y: Number(match[3]) } : { area: source };
}

function payments(html) {
  return [...html.matchAll(/<h4\b[^>]*>([\s\S]*?)<\/h4>\s*<span\b[^>]*class=["'][^"']*db-view__data__number[^"']*["'][^>]*>([\s\S]*?)<\/span>/g)]
    .map(match => ({ Name: text(match[1]), Amount: positive(match[2]) }));
}

export function extractLodestoneShopInventory(html, context = null) {
  const name = context?.name || text(html.match(/<h2\b[^>]*class=["'][^"']*db-shop__name[^"']*["'][^>]*>([\s\S]*?)<\/h2>/)?.[1]);
  if (!name) throw new Error('Lodestoneの店舗詳細ページが不正です');
  const place = html.match(/<ul\b[^>]*class=["'][^"']*db-shop__place[^"']*["'][^>]*>([\s\S]*?)<\/ul>/)?.[1] || '';
  const shops = context?.shops || [...place.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map(match => ({ shopName: name, ...location(match[1]) }));
  if (!shops.length) throw new Error(`店舗の場所を取得できません: ${name}`);
  const conditional = html.includes('このショップはプレイヤーの特定条件によって販売されるアイテムが異なります');
  const inventory = [];
  // Ordinary hidden tabs are inline; inclusion-shop categories load separately.
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1].matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/g)];
    if (cells.length !== 2) continue;
    const kind = row[1].match(/\bid=["']item_(gil|currency|cs|sundry_splendors)_/i)?.[1];
    if (!kind) continue;
    const resultCell = cells[0][2];
    if (kind === 'gil') {
      if (conditional) continue;
      const itemName = text(resultCell.match(/<h4\b[^>]*>([\s\S]*?)<\/h4>/)?.[1]);
      if (!itemName) throw new Error(`販売アイテム名を取得できません: ${name}`);
      inventory.push({ Name: itemName, price: positive(cells[1][2]), shops });
    } else if (kind === 'cs') {
      const itemName = text(resultCell.match(/class=["'][^"']*db-view__npc__shop_list__item_name[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|h4)>/)?.[1]);
      const amounts = [...cells[1][2].matchAll(/<span\b[^>]*>\s*([\d,]+)\s*<\/span>/g)];
      const ranks = [...cells[1][2].matchAll(/<img\b[^>]*alt=["']([^"']+)["']/g)];
      const rank = ranks.at(-1)?.[1];
      if (!itemName || !rank || amounts.length !== 1) throw new Error(`軍票交換を取得できません: ${name}`);
      inventory.push({ Name: itemName, resultAmount: 1, ingredients: [{ Name: '軍票', Amount: positive(amounts[0][1]) }], shops: shops.map(shop => ({ ...shop, requiredRank: rank })) });
    } else {
      const results = payments(resultCell);
      const ingredients = payments(cells[1][2]);
      if (!results.length || !ingredients.length) throw new Error(`交換品・必要アイテムを取得できません: ${name}`);
      for (const result of results) inventory.push({ Name: result.Name, resultAmount: result.Amount, ingredients, shops });
    }
  }
  return { name, conditional, shops, inventory };
}

export function extractLodestoneShopCategories(html) {
  const encoded = html.match(/\bdata-shops="([^"]+)"/u)?.[1];
  if (!encoded) return [];
  const groups = JSON.parse(encoded.replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&#39;', "'"));
  const keys = [...new Set(Object.values(groups).flat().map(shop => shop.key))];
  if (keys.some(key => !/^[a-f0-9]{40}$/u.test(key))) throw new Error('交換カテゴリの識別子が不正です');
  return keys;
}

export function mergeGilShopSupplements(index, supplements, excludedShops = new Set()) {
  for (const [name, manual] of supplements) {
    const shops = (manual.shops || []).filter(shop => !shop.requiredRank
      && !excludedShops.has(JSON.stringify([shop.shopName, shop.area || ''])));
    if (!shops.length) continue;
    if (!index.has(name)) index.set(name, {});
    const record = index.get(name);
    record.ShopInfo ||= { price: manual.price, shops: [] };
    for (const shop of shops) {
      if (!record.ShopInfo.shops.some(official => official.shopName === shop.shopName && official.area === shop.area)) {
        record.ShopInfo.shops.push(structuredClone(shop));
      }
    }
  }
  return index;
}

export async function readLodestoneShopIndex({ request, version, supplements = new Map(), onProgress = () => {} }) {
  const first = await request(`${LODESTONE_BASE_URL}/lodestone/playguide/db/shop/`);
  const meta = extractLodestoneListMeta(first);
  if (version && meta.version !== version) throw new Error('店舗一覧のLodestone版が一致しません');
  const shops = new Map();
  const collect = html => {
    const current = extractLodestoneListMeta(html);
    if (current.version !== meta.version || current.total !== meta.total) throw new Error('取得中に店舗一覧が変化しました');
    for (const shop of extractLodestoneShopList(html)) shops.set(shop.id, shop);
  };
  collect(first);
  for (let page = 2; page <= meta.pages; page++) collect(await request(`${LODESTONE_BASE_URL}/lodestone/playguide/db/shop/?page=${page}`));
  if (shops.size !== meta.total) throw new Error(`店舗一覧の件数が一致しません: ${shops.size}/${meta.total}`);
  const index = new Map();
  const excludedShops = new Set();
  const categoryHtml = new Map();
  let categoryRequests = 0;
  let completed = 0;
  for (const shop of shops.values()) {
    const html = await request(`${LODESTONE_BASE_URL}/lodestone/playguide/db/shop/${shop.id}/`);
    const sourceVersion = text(html.match(/db-content__title--version[^>]*>([\s\S]*?)<\/p>/)?.[1]).replace(/^Version:\s*Patch\s*/i, '');
    if (sourceVersion !== meta.version) throw new Error(`店舗詳細のLodestone版が一致しません: ${shop.name}`);
    const parsed = extractLodestoneShopInventory(html);
    const selected = html.match(/class=["'][^"']*js--inclusion_shop_outer[^"']*["'][^>]*data-key=["']([^"']+)/u)?.[1];
    for (const key of extractLodestoneShopCategories(html)) {
      if (key === selected) continue;
      if (!categoryHtml.has(key)) {
        categoryHtml.set(key, await request(`${LODESTONE_BASE_URL}/lodestone/playguide/db/shop/${shop.id}/special_shop_inner?shop=${key}`));
        categoryRequests++;
      }
      const extra = extractLodestoneShopInventory(categoryHtml.get(key), parsed);
      if (!extra.inventory.length) throw new Error(`交換カテゴリが空です: ${shop.name}`);
      parsed.inventory.push(...extra.inventory);
    }
    if (parsed.conditional) for (const vendor of parsed.shops) excludedShops.add(JSON.stringify([vendor.shopName, vendor.area || '']));
    for (const entry of parsed.inventory) {
      if (!index.has(entry.Name)) index.set(entry.Name, {});
      const record = index.get(entry.Name);
      if (entry.price != null) {
        if (record.ShopInfo && record.ShopInfo.price !== entry.price) throw new Error(`店舗間で販売価格が異なります: ${entry.Name}`);
        record.ShopInfo ||= { price: entry.price, shops: [] };
        for (const vendor of entry.shops) if (!record.ShopInfo.shops.some(value => JSON.stringify(value) === JSON.stringify(vendor))) record.ShopInfo.shops.push(vendor);
      } else {
        record.ExchangeInfo ||= [];
        const resultAmount = entry.resultAmount;
        const key = JSON.stringify({ resultAmount, ingredients: [...entry.ingredients].sort((a,b)=>a.Name.localeCompare(b.Name)) });
        let route = record.ExchangeInfo.find(value => value.key === key);
        if (!route) { route = { key, ...(resultAmount !== 1 ? { resultAmount } : {}), ingredients: entry.ingredients, shops: [] }; record.ExchangeInfo.push(route); }
        for (const vendor of entry.shops) if (!route.shops.some(value => JSON.stringify(value) === JSON.stringify(vendor))) route.shops.push(vendor);
      }
    }
    onProgress({ completed: ++completed, total: shops.size, name: shop.name });
  }
  for (const record of index.values()) for (const route of record.ExchangeInfo || []) delete route.key;
  mergeGilShopSupplements(index, supplements, excludedShops);
  return { index, version: meta.version, shops: shops.size, requests: meta.pages + shops.size + categoryRequests };
}
