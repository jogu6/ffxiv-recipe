import crypto from 'node:crypto';

export const LODESTONE_BASE_URL = 'https://jp.finalfantasyxiv.com';
export const LODESTONE_ITEM_LIST_URL = `${LODESTONE_BASE_URL}/lodestone/playguide/db/item/`;
export const LODESTONE_RECIPE_LIST_URL = `${LODESTONE_BASE_URL}/lodestone/playguide/db/recipe/`;
export const DEFAULT_LODESTONE_DELAY_MS = 100;
export const LODESTONE_PAGE_SIZE = 50;

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

function stripHtml(value) {
  return decodeHtml(String(value || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function ownString(value) {
  return Buffer.from(String(value || ''), 'utf8').toString('utf8');
}

export function normalizeLodestoneName(value) {
  return stripHtml(value).replace(/[\uE000-\uF8FF]/g, '').trim();
}

export function extractLodestoneListMeta(html) {
  const source = String(html || '');
  const version = stripHtml(source.match(/db-content__title--version[^>]*>([\s\S]*?)<\/p>/i)?.[1])
    .replace(/^Version:\s*Patch\s*/i, '');
  const total = Number(stripHtml(source.match(/class=["'][^"']*\btotal\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]));
  if (!version || !Number.isInteger(total) || total < 0) {
    throw new Error('Lodestone一覧からVersionまたは総件数を取得できません');
  }
  return { version, total, pages: Math.ceil(total / LODESTONE_PAGE_SIZE) };
}

function* rowBlocks(html) {
  const pattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  const source = String(html || '');
  let match;
  while ((match = pattern.exec(source)) !== null) yield match[1];
}

export function extractLodestoneItemList(html) {
  const entries = [];
  for (const row of rowBlocks(html)) {
    const match = row.match(
      /<a\b[^>]*href=["'](\/lodestone\/playguide\/db\/item\/([a-z0-9]+)\/)["'][^>]*class=["'][^"']*\bdb-table__txt--detail_link\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i
    );
    if (!match) continue;
    const typeBlock = row.match(/db-table__txt--type[^>]*>([\s\S]*?)<\/span>/i)?.[1] || '';
    const categories = [...typeBlock.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map(category => stripHtml(category[1]));
    const iconUrl = decodeHtml(row.match(/<img\b[^>]*src=["'](https:\/\/lds-img\.finalfantasyxiv\.com\/itemicon\/[^"']+)["']/i)?.[1] || '');
    entries.push({
      Name: ownString(normalizeLodestoneName(match[3])),
      LodestoneKey: ownString(match[2]),
      DetailPath: ownString(match[1]),
      ItemCategory: ownString(categories.at(-1) || categories[0] || ''),
      IconUrl: ownString(iconUrl)
    });
  }
  return entries;
}

export function extractLodestoneRecipeList(html) {
  const entries = [];
  for (const row of rowBlocks(html)) {
    const match = row.match(
      /<a\b[^>]*href=["'](\/lodestone\/playguide\/db\/recipe\/([a-z0-9]+)\/)["'][^>]*class=["'][^"']*\bdb-table__txt--detail_link\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i
    );
    if (!match) continue;
    const job = stripHtml(row.match(/db-table__txt--type[^>]*>([\s\S]*?)<\/span>/i)?.[1]);
    entries.push({
      Name: ownString(normalizeLodestoneName(match[3])),
      RecipeKey: ownString(match[2]),
      DetailPath: ownString(match[1]),
      Job: ownString(job)
    });
  }
  return entries;
}

export function lodestoneOrderSignature(items) {
  const hash = crypto.createHash('sha256');
  for (const item of items || []) hash.update(`${item.LodestoneKey}\0${item.Name}\n`, 'utf8');
  return hash.digest('hex');
}

export function applyDescendingSortOrder(items, total = items.length) {
  if (!Number.isInteger(total) || total < items.length) throw new RangeError('Lodestone総件数が一覧件数より小さいです');
  return items.map((item, index) => ({ ...item, SortOrder: total - index }));
}

export function createSequentialRequestQueue({ delayMs = DEFAULT_LODESTONE_DELAY_MS, request, now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  if (typeof request !== 'function') throw new TypeError('requestが必要です');
  const interval = Math.max(0, Number(delayMs) || 0);
  let tail = Promise.resolve();
  let lastStartedAt = Number.NEGATIVE_INFINITY;
  return function enqueue(...args) {
    const run = async () => {
      const remaining = interval - (now() - lastStartedAt);
      if (remaining > 0) await wait(remaining);
      lastStartedAt = now();
      return request(...args);
    };
    const result = tail.then(run, run);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}

export function exactXivapiItemIcon(payload, expectedName) {
  const matches = (Array.isArray(payload?.results) ? payload.results : [])
    .filter(result => result?.sheet === 'Item' && result?.fields?.Name === expectedName && result?.fields?.Icon?.path)
    .map(result => ({ itemId: result.row_id, path: result.fields.Icon.path }));
  return matches.length === 1 ? matches[0] : null;
}

export function xivapiExactItemSearchUrl(name) {
  const query = encodeURIComponent(`Name@ja="${String(name || '').replace(/["\\]/g, '')}"`);
  return `https://v2.xivapi.com/api/search?sheets=Item&fields=Name,Icon&query=${query}&language=ja&limit=100`;
}

export function xivapiPngAssetUrl(gamePath) {
  return `https://v2.xivapi.com/api/asset?path=${encodeURIComponent(gamePath)}&format=png`;
}

export async function crawlLodestoneList({ baseUrl, extractEntries, fetchText, firstHtml = null, onPage = () => {} }) {
  if (!baseUrl || typeof extractEntries !== 'function' || typeof fetchText !== 'function') {
    throw new TypeError('一覧取得の引数が不足しています');
  }
  const initialHtml = firstHtml ?? await fetchText(baseUrl);
  const meta = extractLodestoneListMeta(initialHtml);
  const entries = extractEntries(initialHtml);
  onPage({ page: 1, pages: meta.pages, entries: entries.length });
  for (let page = 2; page <= meta.pages; page += 1) {
    const separator = baseUrl.includes('?') ? '&' : '?';
    const pageEntries = extractEntries(await fetchText(`${baseUrl}${separator}page=${page}`));
    entries.push(...pageEntries);
    onPage({ page, pages: meta.pages, entries: pageEntries.length });
  }
  if (entries.length !== meta.total) {
    throw new Error(`Lodestone一覧件数が一致しません: 表示 ${meta.total} / 取得 ${entries.length}`);
  }
  return { ...meta, entries };
}
