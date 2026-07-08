#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';

sharp.cache(false);

export const repositoryRoot = path.resolve(import.meta.dirname, '..', '..');
export const pipelineRoot = path.join(repositoryRoot, 'pipeline');
export const inputRoot = path.join(pipelineRoot, 'input');
export const intermediateRoot = path.join(pipelineRoot, 'intermediate');
export const referenceRoot = path.join(pipelineRoot, 'reference', 'csv-headers');
export const logsRoot = path.join(pipelineRoot, 'logs');
export const stateRoot = path.join(pipelineRoot, 'state');
export const reportsRoot = path.join(pipelineRoot, 'reports');
export const cacheRoot = path.join(pipelineRoot, 'cache');
export const pngIconCacheRoot = path.join(cacheRoot, 'item-icons-png');
export const lodestonePngIconCacheRoot = path.join(cacheRoot, 'lodestone-icons-png');
export const lodestoneShopCacheRoot = path.join(cacheRoot, 'lodestone-shops');
export const siteRoot = path.join(repositoryRoot, 'site');
export const itemIconsRoot = path.join(siteRoot, 'assets', 'item-icons');

const sourcesPath = path.join(pipelineRoot, 'sources.json');
const updateStatePath = path.join(stateRoot, 'update-check.json');
const runStatePath = path.join(stateRoot, 'run-state.json');
const cancelRequestPath = path.join(stateRoot, 'cancel-requested.json');
const iconQualityStatePath = path.join(stateRoot, 'icon-quality.json');
const expectedItemJsonPath = path.join(pipelineRoot, 'reference', 'expected', 'Item.json');
const publicItemJsonPath = path.join(siteRoot, 'data', 'Item.json');
const iconDownloadErrorLog = path.join(logsRoot, 'icon-download-errors.txt');
const tmpPreviewRoot = path.join(siteRoot, '__tmp_icon_quality');
const tmpPreviewManifestPath = path.join(tmpPreviewRoot, 'manifest.json');
const tmpPreviewDataPath = path.join(tmpPreviewRoot, 'preview-data.json');
const remoteCsvNames = ['Item.csv', 'Recipe.csv', 'ItemUICategory.csv', 'ItemSearchCategory.csv'];
const localCsvNames = ['token-items.csv'];
const gatheringAreaPath = path.join(inputRoot, 'gathering_area.json');
const gatheringTimerPath = path.join(inputRoot, 'gathering_timer.json');
const housingShopsPath = path.join(inputRoot, 'housing-shops.json');
const defaultIconQuality = 80;
const defaultIconDelayMs = 500;
const defaultLodestoneInfoDelayMs = 100;
let lodestoneEtaStats = null;
let cancellationEnabled = false;
const defaultPreviewSampleCount = 64;
const iconFailureAllowedRate = 0.003;
const lodestoneSearchResultLinkPattern = /<a\b([^>]*)href=["'](\/lodestone\/playguide\/db\/item\/[a-z0-9]+\/)["']([^>]*)>([\s\S]*?)<\/a>/g;
const lodestoneAnchorPattern = /<a\b([^>]*)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
const lodestoneItemIconImgPattern = /<img\b[^>]*\bsrc=["'](https:\/\/lds-img\.finalfantasyxiv\.com\/itemicon\/[^"']+)["'][^>]*>/g;
const lodestoneOgImagePattern = /<meta\s+property=["']og:image["']\s+content=["'](https:\/\/lds-img\.finalfantasyxiv\.com\/itemicon\/[^"']+)["']/i;
const lodestoneOgTitlePattern = /<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i;
const lodestoneConditionalShopText = 'このショップはプレイヤーの特定条件によって販売されるアイテムが異なります';
const lodestonePrimaryStatNames = ['STR', 'DEX', 'VIT', 'INT', 'MND'];
const lodestoneEquipmentJobPattern = [
  '全クラス',
  'ファイター',
  'ソーサラー',
  'クラフター',
  'ギャザラー',
  'ナイト',
  '戦士',
  '暗黒騎士',
  'ガンブレイカー',
  'モンク',
  '竜騎士',
  '忍者',
  '侍',
  'リーパー',
  'ヴァイパー',
  '吟遊詩人',
  '機工士',
  '踊り子',
  '白魔道士',
  '学者',
  '占星術師',
  '賢者',
  '黒魔道士',
  '召喚士',
  '赤魔道士',
  'ピクトマンサー',
  '青魔道士',
  '魔獣使い',
  '木工師',
  '鍛冶師',
  '甲冑師',
  '彫金師',
  '革細工師',
  '裁縫師',
  '錬金術師',
  '調理師',
  '採掘師',
  '園芸師',
  '漁師'
].map(escapeRegExp).join('|');
const iconFlushEvery = 250;

const buildOutputs = {
  base: path.join(intermediateRoot, '01-items-base.json'),
  recipes: path.join(intermediateRoot, '02-items-with-recipes.json'),
  tokenRecipes: path.join(intermediateRoot, '03-items-with-token-recipes.json'),
  uiCategories: path.join(intermediateRoot, '04-items-with-ui-categories.json'),
  filtered: path.join(intermediateRoot, '05-items-filtered.json'),
  publicItems: path.join(intermediateRoot, '06-public-items.json')
};
const publicCandidatePath = buildOutputs.publicItems;
const serviceWorkerPath = path.join(siteRoot, 'sw.js');
const appScriptPath = path.join(siteRoot, 'app.js');

const csvSchemas = {
  'Item.csv': { required: ['#', 'Description', 'Name', 'LevelEquip', 'Icon', 'ItemUICategory', 'ItemSearchCategory'] },
  'Recipe.csv': { required: ['CraftType', 'ItemResult', 'PatchNumber', 'AmountResult', ...Array.from({ length: 8 }, (_, i) => `Ingredient[${i}]`), ...Array.from({ length: 8 }, (_, i) => `AmountIngredient[${i}]`)] },
  'ItemUICategory.csv': { required: ['#', 'Name'] },
  'ItemSearchCategory.csv': { required: ['#', 'Name'] }
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeTextAtomic(file, text) {
  ensureDir(path.dirname(file));
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(temp, text, 'utf8');
  fs.renameSync(temp, file);
}

function writeJsonAtomic(file, value) {
  writeTextAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeBytesAtomic(file, bytes) {
  ensureDir(path.dirname(file));
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(temp, bytes);
  fs.renameSync(temp, file);
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function formatPatchForCache(value) {
  const raw = String(Number(value) || 0).padStart(3, '0');
  return `${Number(raw.slice(0, -2))}.${raw.slice(-2)}`;
}

function makeDataCacheVersion(itemJsonPath = publicItemJsonPath, salt = '') {
  const items = readJson(itemJsonPath, []);
  const maxPatch = items.reduce((max, item) => Math.max(max, Number(item?.Recipe?.PatchNumber) || 0), 0);
  const hash = crypto.createHash('sha256').update(fs.readFileSync(itemJsonPath));
  if (salt) hash.update(String(salt));
  return `ff14recipe-data-${formatPatchForCache(maxPatch)}-${hash.digest('hex').slice(0, 8)}`;
}

function updateServiceWorkerDataCacheVersion(version) {
  const source = fs.readFileSync(serviceWorkerPath, 'utf8');
  const next = source.replace(
    /const\s+DATA_CACHE_VERSION\s*=\s*['"][^'"]+['"];/,
    `const DATA_CACHE_VERSION = '${version}';`
  );
  if (next === source) throw new Error('DATA_CACHE_VERSION was not found in sw.js');
  writeTextAtomic(serviceWorkerPath, next);
}

function updateAppDataCacheVersion(version) {
  const source = fs.readFileSync(appScriptPath, 'utf8');
  const next = source.replace(
    /const\s+DATA_CACHE_VERSION\s*=\s*['"][^'"]+['"];/,
    `const DATA_CACHE_VERSION = '${version}';`
  );
  if (next === source) throw new Error('DATA_CACHE_VERSION was not found in app.js');
  writeTextAtomic(appScriptPath, next);
}

function updateDataCacheVersion({ itemJsonPath = publicItemJsonPath, salt = '', reason = 'data' } = {}) {
  const version = makeDataCacheVersion(itemJsonPath, salt);
  updateServiceWorkerDataCacheVersion(version);
  updateAppDataCacheVersion(version);
  log(`データキャッシュ版を更新しました ${version} (${reason})`);
  return version;
}

function nowIso() {
  return new Date().toISOString();
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      args._.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    if (eq !== -1) {
      args[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char === '\r' && text[i + 1] === '\n' ? '' : char;
      }
      continue;
    }
    if (char === '"') inQuotes = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') field += char;
  }

  if (inQuotes) throw new Error('CSV quote is not closed.');
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function readCsv(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing CSV: ${file}`);
  return parseCsv(fs.readFileSync(file, 'utf8'));
}

function csvRowsWithoutHeader(file) {
  const rows = readCsv(file);
  if (rows.length === 0) throw new Error(`CSV is empty: ${file}`);
  return rows.slice(1);
}

function columnMap(header, requiredNames) {
  const indexes = new Map();
  const duplicates = new Set();
  header.forEach((name, index) => {
    if (indexes.has(name)) duplicates.add(name);
    else indexes.set(name, index);
  });
  const missing = requiredNames.filter(name => !indexes.has(name));
  if (missing.length > 0) throw new Error(`Missing CSV header(s): ${missing.join(', ')}`);
  if (duplicates.size > 0) throw new Error(`Duplicate CSV header(s): ${[...duplicates].join(', ')}`);
  return Object.fromEntries(requiredNames.map(name => [name, indexes.get(name)]));
}

function readCsvWithColumns(name, requiredNames) {
  const rows = readCsv(csvPath(name));
  if (rows.length === 0) throw new Error(`CSV is empty: ${name}`);
  return {
    header: rows[0],
    columns: columnMap(rows[0], requiredNames),
    rows: rows.slice(1)
  };
}

function csvPath(name) {
  return path.join(inputRoot, name);
}

function updateRunState(patch) {
  ensureDir(stateRoot);
  writeJsonAtomic(runStatePath, { ...readJson(runStatePath, {}), ...patch, updatedAt: nowIso() });
}

function exportHeaderReference(name, header) {
  ensureDir(referenceRoot);
  writeTextAtomic(
    path.join(referenceRoot, `${path.basename(name, '.csv')}.txt`),
    `${header.map((column, index) => `${index}: ${column}`).join('\n')}\n`
  );
}

export function validateCsvFiles({ writeHeaders = true } = {}) {
  log('CSV検証を開始しました');
  const results = [];
  for (const name of [...remoteCsvNames, ...localCsvNames]) {
    log(`CSV検証中: ${name}`);
    const file = csvPath(name);
    if (!fs.existsSync(file)) {
      results.push({ name, ok: false, message: 'missing' });
      continue;
    }
    const rows = readCsv(file);
    if (rows.length === 0) {
      results.push({ name, ok: false, message: 'empty' });
      continue;
    }
    if (name === 'token-items.csv') {
      const badRow = rows.findIndex(row => row.length !== 4 || !['8', '9'].includes(row[3]));
      results.push({ name, ok: badRow === -1, message: badRow === -1 ? 'ok' : `invalid row ${badRow + 1}` });
      continue;
    }
    const header = rows[0];
    if (writeHeaders) exportHeaderReference(name, header);
    const errors = [];
    const seen = new Set();
    const duplicates = new Set();
    for (const columnName of header) {
      if (seen.has(columnName)) duplicates.add(columnName);
      seen.add(columnName);
    }
    if (duplicates.size > 0) errors.push(`duplicate header(s): ${[...duplicates].join(', ')}`);
    for (const required of csvSchemas[name].required) {
      if (!seen.has(required)) errors.push(`missing header: ${required}`);
    }
    const positions = csvSchemas[name].required
      .filter(required => seen.has(required))
      .map(required => `${required}@${header.indexOf(required)}`)
      .join(', ');
    results.push({ name, ok: errors.length === 0, message: errors.length === 0 ? 'ok' : errors.join('; ') });
    if (errors.length === 0) log(`ヘッダー確認 ${name}: ${positions}`);
  }
  for (const result of results) log(`${result.ok ? '成功' : '失敗'} ${result.name}: ${result.message}`);
  const failed = results.filter(result => !result.ok);
  if (failed.length > 0) throw new Error(`${failed.length} CSV validation error(s).`);
  return results;
}

function saveStep(name, file, value) {
  writeJsonAtomic(file, value);
  updateRunState({ step: name, status: 'completed', output: path.relative(repositoryRoot, file) });
  log(`作成しました ${path.relative(repositoryRoot, file)} (${Array.isArray(value) ? value.length : 0}件)`);
}

export function buildData() {
  ensureDir(intermediateRoot);
  updateRunState({ command: 'build', status: 'running', startedAt: nowIso() });
  log('データ生成を開始しました');

  const itemCsv = readCsvWithColumns('Item.csv', csvSchemas['Item.csv'].required);
  log(`Item.csvを読み込みました: ${itemCsv.rows.length}行`);
  const itemCol = itemCsv.columns;
  const baseItems = itemCsv.rows
    .filter(data => data[itemCol.Name] !== '')
    .map(data => {
      const iconId = Number.parseInt(data[itemCol.Icon], 10);
      return {
        ID: data[itemCol['#']],
        Name: data[itemCol.Name],
        Description: data[itemCol.Description],
        LevelEquip: data[itemCol.LevelEquip],
        ItemUICategory: data[itemCol.ItemUICategory],
        ItemSearchCategory: data[itemCol.ItemSearchCategory],
        IconFile: `${Number.isFinite(iconId) ? iconId : 0}`.padStart(6, '0') + '.webp'
      };
    });
  saveStep('01-items-base', buildOutputs.base, baseItems);

  const itemById = new Map(baseItems.map(item => [String(item.ID), item]));
  const idToName = new Map(baseItems.map(item => [String(item.ID), item.Name]));
  let recipeMatches = 0;
  let recipeSkips = 0;
  const recipeCsv = readCsvWithColumns('Recipe.csv', csvSchemas['Recipe.csv'].required);
  const recipeCol = recipeCsv.columns;
  for (const data of recipeCsv.rows) {
    const item = itemById.get(String(data[recipeCol.ItemResult]));
    if (!item) {
      recipeSkips += 1;
      continue;
    }
    const ingredients = [];
    for (let j = 0; j < 8; j += 1) {
      const ingId = String(data[recipeCol[`Ingredient[${j}]`]]);
      if (ingId !== '0' && idToName.has(ingId)) {
        ingredients.push({ ItemID: ingId, Name: idToName.get(ingId), Amount: data[recipeCol[`AmountIngredient[${j}]`]] });
      }
    }
    item.Recipe = {
      CraftType: data[recipeCol.CraftType],
      PatchNumber: data[recipeCol.PatchNumber],
      AmountResult: data[recipeCol.AmountResult],
      Ingredients: ingredients
    };
    recipeMatches += 1;
  }
  saveStep('02-items-with-recipes', buildOutputs.recipes, baseItems);
  log(`レシピ照合: 一致 ${recipeMatches}件、スキップ ${recipeSkips}件`);

  const itemsWithTokens = readJson(buildOutputs.recipes, []);
  const itemByName = new Map(itemsWithTokens.map(item => [String(item.Name), item]));
  const nameToId = new Map(itemsWithTokens.map(item => [String(item.Name), String(item.ID)]));
  let tokenMatches = 0;
  let tokenSkips = 0;
  for (const [index, data] of readCsv(csvPath('token-items.csv')).entries()) {
    if (data.length !== 4 || !['8', '9'].includes(data[3])) throw new Error(`Invalid token-items.csv row ${index + 1}.`);
    const [targetItemName, tokenItemName, amount, craftType] = data;
    const item = itemByName.get(targetItemName);
    if (!item) {
      tokenSkips += 1;
      continue;
    }
    const ingredient = { ItemID: tokenItemName === '軍票' ? '0' : nameToId.get(tokenItemName) || '0', Name: tokenItemName, Amount: amount };
    if (item.Recipe) item.Recipe.Ingredients = [...(item.Recipe.Ingredients || []), ingredient];
    else item.Recipe = { CraftType: craftType, AmountResult: '1', Ingredients: [ingredient] };
    tokenMatches += 1;
  }
  saveStep('03-items-with-token-recipes', buildOutputs.tokenRecipes, itemsWithTokens);
  log(`交換レシピ照合: 一致 ${tokenMatches}件、スキップ ${tokenSkips}件`);

  const uiCategoryCsv = readCsvWithColumns('ItemUICategory.csv', csvSchemas['ItemUICategory.csv'].required);
  const uiCategoryById = new Map(uiCategoryCsv.rows.map(row => [row[uiCategoryCsv.columns['#']], row[uiCategoryCsv.columns.Name]]));
  const itemsWithUiCategories = readJson(buildOutputs.tokenRecipes, []);
  let uiMatches = 0;
  for (const item of itemsWithUiCategories) {
    const name = uiCategoryById.get(String(item.ItemUICategory));
    if (name) {
      item.ItemUICategoryName = name;
      uiMatches += 1;
    }
  }
  saveStep('04-items-with-ui-categories', buildOutputs.uiCategories, itemsWithUiCategories);
  log(`UIカテゴリ照合: 一致 ${uiMatches}件`);

  const categoryItems = readJson(buildOutputs.uiCategories, []);
  const usedInRecipeIds = new Set();
  for (const item of categoryItems) {
    for (const ingredient of item.Recipe?.Ingredients || []) {
      const ingId = String(ingredient.ItemID);
      if (ingId !== '0' && ingId !== '') usedInRecipeIds.add(ingId);
    }
  }
  const filteredItems = categoryItems.filter(item => item.Recipe || String(item.ID) === '0' || usedInRecipeIds.has(String(item.ID)));
  saveStep('05-items-filtered', buildOutputs.filtered, filteredItems);
  log(`不要項目の除外: ${categoryItems.length - filteredItems.length}件`);

  const searchCategoryCsv = readCsvWithColumns('ItemSearchCategory.csv', csvSchemas['ItemSearchCategory.csv'].required);
  const searchCategoryById = new Map(searchCategoryCsv.rows.map(row => [row[searchCategoryCsv.columns['#']], row[searchCategoryCsv.columns.Name]]));
  const publicItems = readJson(buildOutputs.filtered, []);
  let searchMatches = 0;
  let searchSkips = 0;
  const gatheringByName = normalizeGatheringTimerEntries();
  let gatheringMatches = 0;
  for (const item of publicItems) {
    const name = searchCategoryById.get(String(item.ItemSearchCategory));
    if (name) {
      item.ItemSearchCategoryName = name;
      searchMatches += 1;
    } else {
      searchSkips += 1;
    }
    const gathering = gatheringByName.get(String(item.Name));
    if (gathering?.length) {
      item.GatheringTimer = gathering;
      gatheringMatches += 1;
    }
  }
  const publicItemNames = new Set(publicItems.map(item => String(item.Name)));
  const gatheringUnmatched = [...gatheringByName.keys()].filter(name => !publicItemNames.has(name));
  for (const name of gatheringUnmatched.slice(0, 20)) {
    log(`採集情報警告: Item.jsonに一致しない item_name: ${name}`);
  }
  if (gatheringUnmatched.length > 20) log(`採集情報警告: 未一致がさらに ${gatheringUnmatched.length - 20}件あります`);
  saveStep('06-public-items', buildOutputs.publicItems, publicItems);
  updateRunState({ status: 'completed', candidateOutput: path.relative(repositoryRoot, buildOutputs.publicItems) });
  log(`検索カテゴリ照合: 一致 ${searchMatches}件、スキップ ${searchSkips}件`);
  log(`採集情報照合: 一致 ${gatheringMatches}件、未一致 ${gatheringUnmatched.length}件`);
  log(`公開候補を作成しました ${path.relative(repositoryRoot, buildOutputs.publicItems)} (${publicItems.length}件)`);
  return publicItems;
}

function sourceConfig() {
  return readJson(sourcesPath, { remoteCsv: {}, localCsv: {} });
}

function getHeaderValue(headers, name) {
  const value = headers.get(name);
  return value && value.length > 0 ? value : null;
}

function statusJa(status) {
  if (status === 'up-to-date') return '最新';
  if (status === 'missing') return '未取得';
  if (status === 'updated') return '更新あり';
  if (status === 'unknown') return '不明';
  if (String(status).startsWith('http-')) return `HTTPエラー ${String(status).slice(5)}`;
  if (String(status).startsWith('error:')) return `エラー:${String(status).slice(6)}`;
  return status;
}

export async function checkUpdates() {
  ensureDir(stateRoot);
  log('更新チェックを開始しました');
  const previous = readJson(updateStatePath, { sources: {} });
  const next = { lastCheckedAt: nowIso(), sources: {} };
  for (const [name, url] of Object.entries(sourceConfig().remoteCsv || {})) {
    const prev = previous.sources?.[name] || {};
    const headers = {};
    if (prev.etag) headers['If-None-Match'] = prev.etag;
    if (prev.lastModified) headers['If-Modified-Since'] = prev.lastModified;
    const localPath = csvPath(name);
    let status = 'unknown';
    let etag = prev.etag || null;
    let lastModified = prev.lastModified || null;
    try {
      const response = await fetch(url, { method: 'HEAD', headers });
      if (response.status === 304) status = fs.existsSync(localPath) ? 'up-to-date' : 'missing';
      else if (response.ok) {
        etag = getHeaderValue(response.headers, 'etag');
        lastModified = getHeaderValue(response.headers, 'last-modified');
        status = !fs.existsSync(localPath) ? 'missing' : ((etag && prev.etag && etag === prev.etag) || (lastModified && prev.lastModified && lastModified === prev.lastModified) ? 'up-to-date' : 'updated');
      } else status = `http-${response.status}`;
    } catch (error) {
      status = `error: ${error.message}`;
    }
    next.sources[name] = { url, etag, lastModified, sha256: fs.existsSync(localPath) ? sha256File(localPath) : null, status };
    log(`${name}: ${statusJa(status)}`);
  }
  writeJsonAtomic(updateStatePath, next);
  return next;
}

export async function downloadCsv({ force = false } = {}) {
  ensureDir(inputRoot);
  log('CSV取得を開始しました');
  const updateState = readJson(updateStatePath, { sources: {} });
  for (const [name, url] of Object.entries(sourceConfig().remoteCsv || {})) {
    const target = csvPath(name);
    if (!force && fs.existsSync(target) && updateState.sources?.[name]?.status === 'up-to-date') {
      log(`${name}: 取得をスキップしました`);
      continue;
    }
    const response = await fetch(url);
  if (!response.ok) throw new Error(`${name} の取得に失敗しました: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    writeBytesAtomic(target, bytes);
    log(`${name}: 取得しました (${bytes.length} bytes)`);
  }
}

function iconPaths(iconFile) {
  const webpName = iconFile.replace(/\.[^.]+$/, '.webp');
  const pngName = iconFile.replace(/\.[^.]+$/, '.png');
  const folder = webpName.slice(0, 3);
  return {
    webpName,
    pngName,
    webpPath: path.join(itemIconsRoot, folder, webpName),
    pngPath: path.join(itemIconsRoot, folder, pngName)
  };
}

function iconDownloadUrl(pngName) {
  const iconId = Number.parseInt(path.basename(pngName, '.png'), 10);
  if (!Number.isFinite(iconId)) throw new Error(`アイコンファイル名が不正です: ${pngName}`);
  return `https://xivapi.com/i/${String(Math.floor(iconId / 1000) * 1000).padStart(6, '0')}/${pngName}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function downloadIconPng(pngName, pngPath, delayMs) {
  await sleep(delayMs);
  const url = iconDownloadUrl(pngName);
  const response = await fetch(url);
  if (!response.ok) {
    fs.appendFileSync(iconDownloadErrorLog, `${url}\n`, 'utf8');
    const notFound = response.status === 404 ? ' 見つかりません' : '';
    throw new Error(`${pngName} の取得に失敗しました: HTTP ${response.status}${notFound}`);
  }
  writeBytesAtomic(pngPath, Buffer.from(await response.arrayBuffer()));
  return { iconUrl: url };
}

function decodeHtml(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function cleanLodestoneUrl(url) {
  return url.replace(/&amp;/g, '&');
}

function normalizeLodestoneItemName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim();
}

function stripHtmlTags(text) {
  return String(text || '').replace(/<[^>]*>/g, '');
}

function normalizeHtmlText(html) {
  return decodeHtml(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanLodestoneTitle(title) {
  const decoded = decodeHtml(title || '').trim();
  const japanese = decoded.match(/エオルゼアデータベース「(.+?)」/);
  if (japanese) return normalizeLodestoneItemName(japanese[1]);
  const english = decoded.match(/Eorzea Database:\s*(.+?)\s*\|/i);
  if (english) return normalizeLodestoneItemName(english[1]);
  return normalizeLodestoneItemName(decoded.split('|')[0]);
}

function clearCancelRequest() {
  try {
    if (fs.existsSync(cancelRequestPath)) fs.rmSync(cancelRequestPath, { force: true });
  } catch {
    // Cancellation cleanup is best-effort.
  }
}

function assertNotCancelled() {
  if (cancellationEnabled && fs.existsSync(cancelRequestPath)) {
    throw new Error('中断要求により停止しました');
  }
}

async function fetchLodestoneText(url, delayMs) {
  assertNotCancelled();
  await sleep(delayMs);
  assertNotCancelled();
  const response = await fetch(url, {
    headers: { 'user-agent': 'ffxiv-recipe-icon-pipeline/1.0' }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  assertNotCancelled();
  return text;
}

async function fetchCachedLodestoneText(url, delayMs) {
  assertNotCancelled();
  ensureDir(lodestoneShopCacheRoot);
  const cacheFile = path.join(lodestoneShopCacheRoot, `${crypto.createHash('sha256').update(url).digest('hex')}.html`);
  if (fs.existsSync(cacheFile)) {
    if (lodestoneEtaStats) lodestoneEtaStats.cache += 1;
    return fs.readFileSync(cacheFile, 'utf8');
  }
  if (lodestoneEtaStats) lodestoneEtaStats.fetch += 1;
  const text = await fetchLodestoneText(url, delayMs);
  writeTextAtomic(cacheFile, text);
  return text;
}

function emitEtaProgress(payload) {
  if (process.env.FFXIV_RECIPE_GUI !== '1') return;
  process.stdout.write(`__ETA__ ${JSON.stringify(payload)}\n`);
}

function lodestoneDetailPaths(searchHtml, itemName) {
  const expectedName = normalizeLodestoneItemName(itemName);
  const exactPaths = [];
  for (const match of searchHtml.matchAll(lodestoneSearchResultLinkPattern)) {
    const attributes = `${match[1]} ${match[3]}`;
    if (!/\bdb-table__txt--detail_link\b/.test(attributes)) continue;
    const label = normalizeLodestoneItemName(decodeHtml(stripHtmlTags(match[4])));
    if (label === expectedName) exactPaths.push(match[2]);
  }
  return [...new Set(exactPaths)];
}

function normalizeLodestoneSearchUrl(href, baseUrl) {
  try {
    const url = new URL(decodeHtml(href), baseUrl);
    if (url.origin !== 'https://jp.finalfantasyxiv.com') return '';
    if (url.pathname !== '/lodestone/playguide/db/item/') return '';
    return url.href;
  } catch {
    return '';
  }
}

export function nextLodestoneSearchUrl(searchHtml, currentUrl, visited = new Set()) {
  const fallback = [];
  for (const match of String(searchHtml || '').matchAll(lodestoneAnchorPattern)) {
    const attrs = `${match[1]} ${match[3]}`;
    const text = normalizeHtmlText(match[4]);
    const url = normalizeLodestoneSearchUrl(match[2], currentUrl);
    if (!url || visited.has(url)) continue;
    if (/\brel=["']?next\b/i.test(attrs) || /\bnext\b/i.test(attrs) || /次|Next|＞|>|»|›/.test(text)) return url;
    if (/\bpager|pagination|page/i.test(attrs) || /^[0-9]+$/.test(text)) fallback.push(url);
  }
  return fallback[0] || '';
}

function extractLodestoneNqIconUrl(detailHtml) {
  for (const match of detailHtml.matchAll(lodestoneItemIconImgPattern)) {
    if (/\bsys_nq_element\b/.test(match[0])) return cleanLodestoneUrl(match[1]);
  }
  const ogImage = detailHtml.match(lodestoneOgImagePattern)?.[1];
  return ogImage ? cleanLodestoneUrl(ogImage) : '';
}

function extractLodestoneDetailItemName(detailHtml) {
  const ogTitle = detailHtml.match(lodestoneOgTitlePattern)?.[1];
  if (ogTitle) return cleanLodestoneTitle(ogTitle);
  const title = detailHtml.match(/<title>([^<]+)<\/title>/i)?.[1];
  return title ? cleanLodestoneTitle(title) : '';
}

function extractTableCells(rowHtml) {
  return [...String(rowHtml || '').matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
    .map(match => normalizeHtmlText(match[1]))
    .filter(Boolean);
}

function parseLodestoneLocation(text) {
  const match = String(text || '').match(/^(.+?)\s+X:([0-9]+(?:\.[0-9]+)?)\s+Y:([0-9]+(?:\.[0-9]+)?)/);
  if (!match) return null;
  return {
    area: match[1].trim(),
    x: Number(match[2]),
    y: Number(match[3])
  };
}

function extractLodestoneShopPrice(detailHtml) {
  const text = normalizeHtmlText(detailHtml);
  const match = text.match(/SHOP販売価格:\s*([0-9,]+)/);
  if (!match) return null;
  const price = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(price)) return null;
  return price;
}

export function extractLodestoneShopInfo(detailHtml) {
  const price = extractLodestoneShopPrice(detailHtml);
  if (price == null) return null;

  const shops = [];
  const seen = new Set();
  for (const rowMatch of String(detailHtml || '').matchAll(/<tr\b[\s\S]*?<\/tr>/gi)) {
    const rowHtml = rowMatch[0];
    const shopPath = rowHtml.match(/href=["'](\/lodestone\/playguide\/db\/shop\/([a-z0-9]+)\/\?item=[^"']*type=gil[^"']*)["']/i);
    if (!shopPath) continue;
    const cells = extractTableCells(rowHtml);
    if (cells.length < 2) continue;
    const location = parseLodestoneLocation(cells[1]);
    if (!location) continue;
    const shopName = cells[0].trim();
    const shopId = shopPath[2];
    const key = `${shopId}:${shopName}:${location.area}:${location.x}:${location.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    shops.push({
      shopId,
      shopName,
      area: location.area,
      x: location.x,
      y: location.y
    });
  }
  if (!shops.length) return null;
  return { price, shops };
}

export function isConditionalLodestoneShop(shopHtml) {
  return normalizeHtmlText(shopHtml).includes(lodestoneConditionalShopText);
}

export function extractLodestoneEquipmentInfo(detailHtml) {
  const text = normalizeHtmlText(detailHtml);
  const itemLevelMatch = text.match(/ITEM LEVEL\s+([0-9]+)/);
  if (!itemLevelMatch) return null;

  const specText = text.slice(itemLevelMatch.index, Math.min(text.length, itemLevelMatch.index + 2000));
  const equipSpecText = specText.split(/\s+Bonuses\s+/)[0];
  const equipLevelMatch = equipSpecText.match(/\s+Lv\s*([0-9]+)～/);
  if (!equipLevelMatch) return null;
  const jobText = equipSpecText.slice(0, equipLevelMatch.index);
  const jobs = [...jobText.matchAll(new RegExp(lodestoneEquipmentJobPattern, 'g'))]
    .map(match => match[0]);
  if (!jobs.length) return null;
  const info = { itemLevel: Number(itemLevelMatch[1]) };
  info.jobs = [...new Set(jobs)];
  info.equipLevel = Number(equipLevelMatch[1]);
  const stats = Object.fromEntries(lodestonePrimaryStatNames.map(name => [name, 0]));
  for (const stat of lodestonePrimaryStatNames) {
    const statMatch = specText.match(new RegExp(`(?:^|\\s)${stat}\\s*\\+\\s*([0-9]+)(?=\\s|$)`));
    if (statMatch) stats[stat] = Number(statMatch[1]);
  }
  info.stats = stats;
  return info;
}

export function extractLodestoneRecipePaths(detailHtml) {
  const source = String(detailHtml || '');
  const start = source.indexOf('このアイテムの製作手帳');
  if (start < 0) return [];
  const endCandidates = ['関連製作手帳', 'コメント（', '画像（']
    .map(pattern => source.indexOf(pattern, start + 1))
    .filter(index => index > start);
  const end = endCandidates.length ? Math.min(...endCandidates) : Math.min(source.length, start + 20000);
  return [...source.slice(start, end).matchAll(/\/lodestone\/playguide\/db\/recipe\/[a-z0-9]+\//g)]
    .map(match => match[0])
    .filter((value, index, values) => values.indexOf(value) === index);
}

export function extractLodestoneCraftInfo(recipeHtml) {
  const text = normalizeHtmlText(recipeHtml);
  const jobMatch = text.match(/(木工師|鍛冶師|甲冑師|彫金師|革細工師|裁縫師|錬金術師|調理師)\s+Lv\s*([0-9]+)/);
  if (!jobMatch) return null;
  const info = {
    job: jobMatch[1],
    level: Number(jobMatch[2])
  };
  const itemName = extractLodestoneDetailItemName(recipeHtml);
  if (itemName) {
    const masterbookMatch = text.match(new RegExp(`${jobMatch[1]}\\s+秘伝書\\s+(秘伝書:第[0-9]+巻)\\s+${escapeRegExp(itemName)}`));
    if (masterbookMatch) info.masterbook = masterbookMatch[1];
  }
  return info;
}

export async function resolveLodestoneItemDetail(item, delayMs, { cache = false, fetchText: fetchTextOverride = null } = {}) {
  const expectedName = normalizeLodestoneItemName(item.Name);
  const fetchText = fetchTextOverride || (cache ? fetchCachedLodestoneText : fetchLodestoneText);
  let searchUrl = `https://jp.finalfantasyxiv.com/lodestone/playguide/db/item/?q=${encodeURIComponent(item.Name)}`;
  const visited = new Set();
  const mismatches = [];
  while (searchUrl && !visited.has(searchUrl)) {
    visited.add(searchUrl);
    const searchHtml = await fetchText(searchUrl, delayMs);
    const detailPaths = lodestoneDetailPaths(searchHtml, item.Name);
    for (const detailPath of detailPaths) {
      const detailUrl = `https://jp.finalfantasyxiv.com${detailPath}`;
      const detailHtml = decodeHtml(await fetchText(detailUrl, delayMs));
      const detailItemName = extractLodestoneDetailItemName(detailHtml);
      if (normalizeLodestoneItemName(detailItemName) !== expectedName) {
        mismatches.push(`${detailItemName || '名称取得不可'} @ ${detailPath}`);
        continue;
      }
      return { detailUrl, detailHtml, detailItemName };
    }
    searchUrl = nextLodestoneSearchUrl(searchHtml, searchUrl, visited);
  }
  const suffix = mismatches.length ? ` 詳細ページ名不一致: ${mismatches.slice(0, 5).join(' / ')}` : '';
  throw new Error(`Lodestone検索結果全ページから詳細ページを見つけられませんでした (${visited.size}ページ確認)${suffix}`);
}

async function resolveLodestoneIconUrl(item, delayMs) {
  const { detailUrl, detailHtml, detailItemName } = await resolveLodestoneItemDetail(item, delayMs);
  const iconUrl = extractLodestoneNqIconUrl(detailHtml);
  if (!iconUrl) throw new Error(`Lodestone詳細ページからNQアイコンURLを取得できませんでした: ${detailItemName}`);
  return { detailUrl, iconUrl, detailItemName };
}

async function downloadLodestoneIconPng(item, cachePath, delayMs) {
  const { detailUrl, iconUrl, detailItemName } = await resolveLodestoneIconUrl(item, delayMs);
  await sleep(delayMs);
  const response = await fetch(iconUrl, {
    headers: { 'user-agent': 'ffxiv-recipe-icon-pipeline/1.0' }
  });
  if (!response.ok) throw new Error(`Lodestone画像取得に失敗しました: HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('image/png')) throw new Error(`Lodestone画像がPNGではありません: ${contentType || 'content-typeなし'}`);
  writeBytesAtomic(cachePath, Buffer.from(await response.arrayBuffer()));
  return { detailUrl, iconUrl, detailItemName };
}

function iconCacheMetaPath(cachePath) {
  return cachePath.replace(/\.png$/i, '.json');
}

function readVerifiedLodestoneIconCache(item, cachePath) {
  if (!fs.existsSync(cachePath)) return null;
  const meta = readJson(iconCacheMetaPath(cachePath), null);
  if (!meta || meta.itemId !== String(item.ID) || meta.itemName !== String(item.Name)) return null;
  if (meta.source !== 'lodestone' && meta.source !== 'lodestone-reuse') return null;
  if (!meta.detailUrl || !meta.iconUrl || !meta.detailItemName) return null;
  return { path: cachePath, ...meta, cachedSource: meta.source, source: 'cache' };
}

function writeIconCacheMeta(cachePath, meta) {
  writeJsonAtomic(iconCacheMetaPath(cachePath), {
    version: 2,
    ...meta,
    updatedAt: nowIso()
  });
}

function flushIconMemory() {
  sharp.cache(false);
  if (global.gc) global.gc();
}

async function getProductionIconPng(item, pngName, delayMs, alternatives = []) {
  const cachePath = path.join(lodestonePngIconCacheRoot, `${item.ID}.png`);
  const verifiedCache = readVerifiedLodestoneIconCache(item, cachePath);
  if (verifiedCache) return verifiedCache;
  ensureDir(lodestonePngIconCacheRoot);
  const lodestoneErrors = [];
  for (const candidate of [item, ...alternatives]) {
    try {
      const lodestone = await downloadLodestoneIconPng(candidate, cachePath, delayMs);
      const meta = {
        itemId: String(item.ID),
        itemName: String(item.Name),
        source: candidate.ID === item.ID ? 'lodestone' : 'lodestone-reuse',
        reusedFromItemId: candidate.ID === item.ID ? '' : String(candidate.ID),
        reusedFromName: candidate.ID === item.ID ? '' : candidate.Name,
        detailUrl: lodestone.detailUrl,
        detailItemName: lodestone.detailItemName,
        iconUrl: lodestone.iconUrl
      };
      writeIconCacheMeta(cachePath, meta);
      return {
        path: cachePath,
        ...meta
      };
    } catch (error) {
      lodestoneErrors.push(`${candidate.ID} ${candidate.Name}: ${error.message}`);
    }
  }
  try {
    const xivapi = await downloadIconPng(pngName, cachePath, delayMs);
    writeIconCacheMeta(cachePath, {
      itemId: String(item.ID),
      itemName: String(item.Name),
      source: 'xivapi',
      reusedFromItemId: '',
      reusedFromName: '',
      detailUrl: '',
      detailItemName: '',
      iconUrl: xivapi.iconUrl,
      lodestoneError: lodestoneErrors.join(' / ')
    });
    fs.appendFileSync(iconDownloadErrorLog, `${item.ID} ${item.Name}: Lodestone検索と同一IconFile流用に失敗したためXIVAPI PNGから取得しました (${lodestoneErrors.join(' / ')})\n`, 'utf8');
    return { path: cachePath, source: 'xivapi', lodestoneError: lodestoneErrors.join(' / '), iconUrl: xivapi.iconUrl };
  } catch (xivapiError) {
    throw new Error(`Lodestone失敗: ${lodestoneErrors.join(' / ')} / XIVAPI失敗: ${xivapiError.message}`);
  }
}

async function writeWebpFromPng(pngPath, webpPath, quality, size = 80) {
  ensureDir(path.dirname(webpPath));
  const temp = path.join(path.dirname(webpPath), `.${path.basename(webpPath)}.${process.pid}.tmp`);
  await sharp(pngPath)
    .resize(size, size, {
      fit: 'contain',
      kernel: sharp.kernel.lanczos3,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .webp({ quality })
    .toFile(temp);
  fs.renameSync(temp, webpPath);
}

async function getCachedPngBlob(pngFile, delayMs = defaultIconDelayMs) {
  const pngName = path.basename(pngFile);
  const folder = pngName.slice(0, 3);
  const cachePath = path.join(pngIconCacheRoot, folder, pngName);
  if (fs.existsSync(cachePath)) return fs.readFileSync(cachePath);
  try {
    const blob = pngBlob(pngFile);
    writeBytesAtomic(cachePath, blob);
    return blob;
  } catch {
    await downloadIconPng(pngName, cachePath, delayMs);
    return fs.readFileSync(cachePath);
  }
}

function iconFileToPngRepoPath(iconFile) {
  const pngName = iconFile.replace(/\.[^.]+$/, '.png');
  return `site/assets/item-icons/${pngName.slice(0, 3)}/${pngName}`;
}

function hashIconFiles(iconFiles) {
  const hash = crypto.createHash('sha256');
  for (const iconFile of [...new Set(iconFiles)].sort()) {
    const { webpPath } = iconPaths(iconFile);
    if (!fs.existsSync(webpPath)) continue;
    hash.update(iconFile);
    hash.update('\0');
    hash.update(fs.readFileSync(webpPath));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function iconGroupsByIconFile(items) {
  const groups = new Map();
  for (const item of items.filter(item => item?.ID && item?.Name && item?.IconFile)) {
    if (!groups.has(item.IconFile)) groups.set(item.IconFile, []);
    groups.get(item.IconFile).push(item);
  }
  return groups;
}

function sameIconAlternatives(item, iconGroups) {
  return (iconGroups.get(item.IconFile) || []).filter(candidate => candidate.ID !== item.ID);
}

export async function ensureIcons({ quality = defaultIconQuality, delayMs = defaultIconDelayMs, size = 80 } = {}) {
  return ensureIconsForItemJson({ quality, delayMs, size, itemJsonPath: publicItemJsonPath });
}

export async function ensureIconsForItemJson({ quality = defaultIconQuality, delayMs = defaultIconDelayMs, size = 80, itemJsonPath = publicItemJsonPath } = {}) {
  const iconSize = Number.isFinite(size) && size > 0 ? Math.floor(size) : 80;
  const sourceItemJsonPath = path.resolve(repositoryRoot, itemJsonPath);
  const isPublicItemJson = sourceItemJsonPath === publicItemJsonPath;
  ensureDir(logsRoot);
  log(`アイコン生成を開始しました source=Lodestone(NQ) fallback=XIVAPI size=${iconSize}x${iconSize} quality=${quality} delay=${delayMs}ms itemJson=${path.relative(repositoryRoot, sourceItemJsonPath)}`);
  ensureDir(itemIconsRoot);
  fs.writeFileSync(iconDownloadErrorLog, '', 'utf8');
  const items = readJson(sourceItemJsonPath, []);
  const iconItems = items.filter(item => item?.ID && item?.Name && item?.IconFile);
  const progressTotal = iconItems.length + 3;
  const iconGroups = iconGroupsByIconFile(iconItems);
  const generatedIconFiles = new Set();
  let duplicate = 0;
  let converted = 0;
  let downloaded = 0;
  let cached = 0;
  let xivapiFallback = 0;
  let failed = 0;
  let lastProgressLog = 0;
  updateRunState({ command: 'icons', status: 'running', startedAt: nowIso(), total: progressTotal });
  log(`アイコン 0/${progressTotal} 開始`);
  for (let i = 0; i < iconItems.length; i += 1) {
    const item = iconItems[i];
    const { webpName, pngName, webpPath } = iconPaths(item.IconFile);
    let detail = `${item.ID} ${item.Name} ${webpName} 確認中`;
    let forceProgressLog = false;
    if (generatedIconFiles.has(item.IconFile)) {
      duplicate += 1;
      detail = `${item.ID} ${item.Name} ${webpName} 同一IconFileのためスキップ`;
    } else {
      try {
        const png = await getProductionIconPng(item, pngName, delayMs, sameIconAlternatives(item, iconGroups));
        if (png.source === 'cache') cached += 1;
        else if (png.source === 'xivapi') {
          downloaded += 1;
          xivapiFallback += 1;
        } else downloaded += 1;
        const reuseText = png.reusedFromItemId ? ` reuse=${png.reusedFromItemId}` : '';
        detail = `${item.ID} ${item.Name} ${webpName} WebP変換中 source=${png.source}${reuseText}`;
        await writeWebpFromPng(png.path, webpPath, quality, iconSize);
        generatedIconFiles.add(item.IconFile);
        converted += 1;
        detail = `${item.ID} ${item.Name} ${webpName} WebP変換完了 source=${png.source}${reuseText}`;
      } catch (error) {
        failed += 1;
        detail = `${item.ID} ${item.Name} ${webpName} 失敗: ${error.message}`;
        forceProgressLog = true;
        fs.appendFileSync(iconDownloadErrorLog, `${item.ID} ${item.Name} ${webpName}: ${error.message}\n`, 'utf8');
      }
    }
    const now = Date.now();
    if (forceProgressLog || now - lastProgressLog >= 1000 || i + 1 === iconItems.length) {
      updateRunState({ command: 'icons', status: 'running', completed: i + 1, total: progressTotal });
      log(`アイコン ${i + 1}/${progressTotal} ${detail}`);
      lastProgressLog = now;
    }
    if ((i + 1) % iconFlushEvery === 0) flushIconMemory();
  }
  let progressDone = iconItems.length;
  updateRunState({ command: 'icons', status: 'running', completed: ++progressDone, total: progressTotal });
  log(`アイコン ${progressDone}/${progressTotal} 生成結果を確認中`);
  if (converted > 0) {
    const iconHash = hashIconFiles(iconItems.map(item => item.IconFile));
    if (isPublicItemJson) updateDataCacheVersion({ itemJsonPath: publicItemJsonPath, salt: iconHash, reason: 'icons' });
  }
  updateRunState({ command: 'icons', status: 'running', completed: ++progressDone, total: progressTotal });
  log(`アイコン ${progressDone}/${progressTotal} 品質状態を保存中`);
  if (failed === 0) writeJsonAtomic(iconQualityStatePath, { quality, width: iconSize, height: iconSize, source: 'lodestone-nq', itemJsonSha256: sha256File(sourceItemJsonPath), iconFilesSha256: hashIconFiles(iconItems.map(item => item.IconFile)), updatedAt: nowIso() });
  updateRunState({ command: 'icons', status: failed > 0 ? 'completed-with-errors' : 'completed', completed: progressTotal, total: progressTotal });
  log(`アイコン ${progressTotal}/${progressTotal} 完了処理終了`);
  log(`アイコン生成完了: キャッシュ ${cached}件、取得 ${downloaded}件、XIVAPI代替 ${xivapiFallback}件、変換 ${converted}件、同一IconFile ${duplicate}件、失敗 ${failed}件`);
  const failedRate = iconItems.length > 0 ? failed / iconItems.length : 0;
  const allowedFailures = Math.floor(iconItems.length * iconFailureAllowedRate);
  if (failedRate > iconFailureAllowedRate) {
    log(`ICON_FAILURE_CONFIRM_REQUIRED ${failed}/${iconItems.length} ${(failedRate * 100).toFixed(3)}% allowed=${allowedFailures}`);
    log(`アイコン失敗率が許容範囲を超えました。許容範囲は0.3%まで (${allowedFailures}件まで) です。公開反映へ進む前に、エラー扱いで止めるか確認してください。`);
  }
  return { cached, downloaded, xivapiFallback, converted, duplicate, failed };
}

function sampleIconItems(count) {
  const seen = new Set();
  const samples = [];
  for (const item of readJson(publicItemJsonPath, [])) {
    if (!item?.ID || !item?.Name || !item?.IconFile || seen.has(item.IconFile)) continue;
    seen.add(item.IconFile);
    samples.push({ item, ...iconPaths(item.IconFile) });
    if (samples.length >= count) break;
  }
  return samples;
}

function fileSize(file) {
  return fs.existsSync(file) ? fs.statSync(file).size : 0;
}

export async function iconPreview({ qualities = [50, 60, 70, 80], sampleCount = 80, size = 80 } = {}) {
  const iconSize = Number.isFinite(size) && size > 0 ? Math.floor(size) : 80;
  const iconGroups = iconGroupsByIconFile(readJson(publicItemJsonPath, []));
  const reportRoot = path.join(reportsRoot, 'icon-quality');
  const sampleRoot = path.join(reportRoot, 'samples');
  ensureDir(sampleRoot);
  const rows = [];
  for (const sample of sampleIconItems(sampleCount)) {
    let png;
    try {
      png = await getProductionIconPng(sample.item, sample.pngName, defaultIconDelayMs, sameIconAlternatives(sample.item, iconGroups));
    } catch (error) {
      log(`プレビュー対象をスキップしました ${sample.pngName}: ${error.message}`);
      continue;
    }
    const originalName = `${path.basename(sample.pngName, '.png')}-original.png`;
    const originalPath = path.join(sampleRoot, originalName);
    fs.copyFileSync(png.path, originalPath);
    const variants = [];
    for (const quality of qualities) {
      const variantName = `${path.basename(sample.pngName, '.png')}-q${quality}.webp`;
      const variantPath = path.join(sampleRoot, variantName);
      await writeWebpFromPng(png.path, variantPath, quality, iconSize);
      variants.push({ quality, file: `samples/${variantName}`, size: fileSize(variantPath) });
    }
    rows.push({ icon: sample.pngName, original: { file: `samples/${originalName}`, size: fileSize(originalPath) }, variants });
  }
  writeTextAtomic(path.join(reportRoot, 'index.html'), renderIconPreviewHtml(rows));
  log(`作成しました ${path.relative(repositoryRoot, path.join(reportRoot, 'index.html'))}`);
}

function renderIconPreviewHtml(rows) {
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Icon Quality Preview</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;background:#f5f5f5;color:#1d1d1d}header{position:sticky;top:0;background:#fff;border-bottom:1px solid #ddd;padding:12px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}button{min-height:36px;padding:0 12px;border:1px solid #bbb;background:#fff;border-radius:6px}button.active{background:#222;color:#fff;border-color:#222}main{padding:12px;display:grid;gap:12px}.row{background:#fff;border:1px solid #ddd;border-radius:8px;padding:12px;display:grid;gap:10px}.icons{display:flex;gap:14px;flex-wrap:wrap}.cell{display:grid;gap:6px;justify-items:center;font-size:12px;min-width:72px}.swatch{width:56px;height:56px;display:grid;place-items:center;background:var(--bg,#fff);border:1px solid #ddd}.dark .swatch{--bg:#2a2a2a}img{width:40px;height:40px}.x2 img{width:80px;height:80px}.x3 img{width:120px;height:120px}.x2 .swatch{width:96px;height:96px}.x3 .swatch{width:136px;height:136px}@media(max-width:600px){main{padding:8px}.icons{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.cell{min-width:0}.row{border-radius:0;margin:0 -8px;border-left:0;border-right:0}}
</style></head><body><header><strong>Icon Quality Preview</strong><button id="scale1" class="active">40</button><button id="scale2">2x</button><button id="scale3">3x</button><button id="theme">dark</button></header><main id="app"></main>
<script>
const rows=${JSON.stringify(rows).replace(/</g, '\\u003c')};const app=document.getElementById('app');
function cell(label,file,size,base){const el=document.createElement('div');el.className='cell';const sw=document.createElement('div');sw.className='swatch';const img=document.createElement('img');img.src=file;img.alt='';sw.append(img);const text=document.createElement('span');text.textContent=base?label+' '+size+'B '+Math.round(size/base*100)+'%':label+' '+size+'B';el.append(sw,text);return el}
function render(){app.textContent='';for(const row of rows){const wrap=document.createElement('section');wrap.className='row';const title=document.createElement('strong');title.textContent=row.icon;wrap.append(title);const icons=document.createElement('div');icons.className='icons';icons.append(cell('PNG',row.original.file,row.original.size,null));for(const v of row.variants)icons.append(cell('q'+v.quality,v.file,v.size,row.original.size));wrap.append(icons);app.append(wrap)}}for(const n of [1,2,3])document.getElementById('scale'+n).onclick=()=>{document.body.classList.remove('x2','x3');if(n>1)document.body.classList.add('x'+n);for(const b of document.querySelectorAll('header button'))b.classList.remove('active');document.getElementById('scale'+n).classList.add('active')};document.getElementById('theme').onclick=()=>document.body.classList.toggle('dark');render();
</script></body></html>
`;
}

function normalizeItemForCompare(item) {
  const clone = JSON.parse(JSON.stringify(item));
  if (typeof clone.IconFile === 'string') clone.IconFile = clone.IconFile.replace(/\.png$/i, '.webp');
  return clone;
}

const lodestoneInfoKeys = ['ShopInfo', 'CraftInfo', 'EquipmentInfo', 'LodestoneInfoCheckedAt'];

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function isFullPublishCandidate(item) {
  return item && typeof item.Name === 'string' && (
    Object.hasOwn(item, 'IconFile')
    || Object.hasOwn(item, 'Recipe')
    || Object.hasOwn(item, 'ItemUICategory')
    || Object.hasOwn(item, 'ItemSearchCategory')
  );
}

export function mergePublishItems(baseItems, candidateItems) {
  const baseById = new Map(baseItems.map(item => [String(item.ID), item]));
  const candidateById = new Map(candidateItems.map(item => [String(item.ID), item]));
  const merged = baseItems.map(baseItem => {
    const candidateItem = candidateById.get(String(baseItem.ID));
    if (!candidateItem) return baseItem;
    if (isFullPublishCandidate(candidateItem)) return candidateItem;
    const nextItem = cloneJson(baseItem);
    for (const key of lodestoneInfoKeys) {
      if (!Object.hasOwn(candidateItem, key)) continue;
      if (candidateItem[key] == null) delete nextItem[key];
      else nextItem[key] = candidateItem[key];
    }
    return nextItem;
  });
  for (const candidateItem of candidateItems) {
    if (baseById.has(String(candidateItem.ID))) continue;
    if (isFullPublishCandidate(candidateItem)) merged.push(candidateItem);
  }
  return merged;
}

export function verifyPublishMerge({ baseItems, candidateItems, mergedItems } = {}) {
  const errors = [];
  const candidateIds = new Set(candidateItems.map(item => String(item.ID)));
  const mergedById = new Map(mergedItems.map(item => [String(item.ID), item]));
  for (const baseItem of baseItems) {
    const id = String(baseItem.ID);
    const mergedItem = mergedById.get(id);
    if (!mergedItem) {
      errors.push(`missing existing item ${baseItem.ID} ${baseItem.Name}`);
      continue;
    }
    if (!candidateIds.has(id) && JSON.stringify(baseItem) !== JSON.stringify(mergedItem)) {
      errors.push(`untouched item changed ${baseItem.ID} ${baseItem.Name}`);
    }
  }
  if (errors.length > 0) {
    errors.slice(0, 50).forEach(error => log(`不一致 ${error}`));
    throw new Error(`${errors.length} publish merge verification error(s).`);
  }
  log(`公開統合確認成功: 既存${baseItems.length}件 候補${candidateItems.length}件 公開${mergedItems.length}件`);
  return { errors, actualCount: mergedItems.length };
}

export function verifyOutput({ expected = publicItemJsonPath, actual = buildOutputs.publicItems } = {}) {
  log(`Item.json比較を開始しました 比較元=${path.relative(repositoryRoot, expected)} 候補=${path.relative(repositoryRoot, actual)}`);
  const expectedItems = readJson(expected, []).map(normalizeItemForCompare);
  const actualItems = readJson(actual, []).map(normalizeItemForCompare);
  const errors = [];
  if (expectedItems.length !== actualItems.length) errors.push(`item count ${expectedItems.length} != ${actualItems.length}`);
  const actualById = new Map(actualItems.map(item => [String(item.ID), item]));
  for (const expectedItem of expectedItems) {
    const actualItem = actualById.get(String(expectedItem.ID));
    if (!actualItem) {
      errors.push(`missing item ${expectedItem.ID} ${expectedItem.Name}`);
      continue;
    }
    for (const key of ['Name', 'Description', 'LevelEquip', 'ItemUICategory', 'ItemSearchCategory', 'IconFile', 'ItemUICategoryName', 'ItemSearchCategoryName']) {
      if ((expectedItem[key] ?? '') !== (actualItem[key] ?? '')) errors.push(`${expectedItem.ID} ${key} differs`);
    }
    const expectedRecipe = expectedItem.Recipe || null;
    const actualRecipe = actualItem.Recipe || null;
    if (Boolean(expectedRecipe) !== Boolean(actualRecipe)) {
      errors.push(`${expectedItem.ID} recipe presence differs`);
      continue;
    }
    if (!expectedRecipe) continue;
    for (const key of ['CraftType', 'PatchNumber', 'AmountResult']) if ((expectedRecipe[key] ?? '') !== (actualRecipe[key] ?? '')) errors.push(`${expectedItem.ID} Recipe.${key} differs`);
    const expectedIngredients = expectedRecipe.Ingredients || [];
    const actualIngredients = actualRecipe.Ingredients || [];
    if (expectedIngredients.length !== actualIngredients.length) {
      errors.push(`${expectedItem.ID} ingredient count differs`);
      continue;
    }
    for (let i = 0; i < expectedIngredients.length; i += 1) {
      for (const key of ['ItemID', 'Name', 'Amount']) if ((expectedIngredients[i][key] ?? '') !== (actualIngredients[i][key] ?? '')) errors.push(`${expectedItem.ID} ingredient ${i} ${key} differs`);
    }
  }
  if (errors.length > 0) {
    errors.slice(0, 50).forEach(error => log(`不一致 ${error}`));
    throw new Error(`${errors.length} verification error(s).`);
  }
  log(`比較成功: ${actualItems.length}件`);
  return { errors, actualCount: actualItems.length };
}

export function protectItemJson({ source = publicItemJsonPath, target = expectedItemJsonPath } = {}) {
  log('Item.json保護を開始しました');
  if (!fs.existsSync(source)) throw new Error(`Missing Item.json to protect: ${source}`);
  ensureDir(path.dirname(target));
  writeTextAtomic(target, fs.readFileSync(source, 'utf8'));
  log(`Item.jsonを保護しました ${path.relative(repositoryRoot, source)} -> ${path.relative(repositoryRoot, target)}`);
}

export function publishItemJson({
  candidate = publicCandidatePath,
  expected = fs.existsSync(expectedItemJsonPath) ? expectedItemJsonPath : publicItemJsonPath,
  target = publicItemJsonPath,
  acceptDiff = false
} = {}) {
  log('公開反映を開始しました');
  if (!fs.existsSync(candidate)) throw new Error(`Missing publish candidate: ${candidate}`);
  const candidateItems = readJson(candidate, null);
  if (!Array.isArray(candidateItems)) throw new Error(`Candidate is not an item array: ${candidate}`);
  const targetItems = fs.existsSync(target) ? readJson(target, null) : [];
  if (!Array.isArray(targetItems)) throw new Error(`Target Item.json is not an item array: ${target}`);
  const publishItems = targetItems.length ? mergePublishItems(targetItems, candidateItems) : candidateItems;
  try {
    if (targetItems.length) verifyPublishMerge({ baseItems: targetItems, candidateItems, mergedItems: publishItems });
    else verifyOutput({ expected, actual: candidate });
  } catch (error) {
    if (!acceptDiff) throw error;
    log(`確認済み差分として続行します: ${error.message}`);
  }
  protectItemJson({ source: target, target: expectedItemJsonPath });
  writeJsonAtomic(target, publishItems);
  updateDataCacheVersion({ itemJsonPath: target, salt: hashIconFiles(publishItems.map(item => item.IconFile).filter(Boolean)), reason: 'publish' });
  updateRunState({ command: 'publish', status: 'completed', finalOutput: path.relative(repositoryRoot, target) });
  log(`公開反映しました ${path.relative(repositoryRoot, candidate)} -> ${path.relative(repositoryRoot, target)}`);
}

export function publishGatheringTimer({ target = publicItemJsonPath } = {}) {
  log('採集情報の公開反映を開始しました');
  const items = readJson(target, null);
  if (!Array.isArray(items)) throw new Error(`Item.json is not an item array: ${target}`);
  const gatheringByName = normalizeGatheringTimerEntries();
  const publicItemNames = new Set(items.map(item => String(item.Name || '')));
  let matched = 0;
  let removed = 0;
  for (const item of items) {
    const gathering = gatheringByName.get(String(item.Name || ''));
    if (gathering?.length) {
      item.GatheringTimer = gathering;
      matched += 1;
    } else if (Object.hasOwn(item, 'GatheringTimer')) {
      delete item.GatheringTimer;
      removed += 1;
    }
  }
  const unmatched = [...gatheringByName.keys()].filter(name => !publicItemNames.has(name));
  unmatched.slice(0, 20).forEach(name => log(`採集情報警告: Item.jsonに一致しない item_name: ${name}`));
  writeJsonAtomic(target, items);
  updateDataCacheVersion({ itemJsonPath: target, salt: `gathering-${matched}-${unmatched.length}`, reason: 'gathering' });
  updateRunState({ command: 'publish-gathering', status: 'completed', finalOutput: path.relative(repositoryRoot, target) });
  log(`採集情報を公開反映しました 一致 ${matched}件、未一致 ${unmatched.length}件、削除 ${removed}件`);
}

async function extractLodestoneCraftInfosForItem(item, detailHtml, delayMs) {
  const expectedName = normalizeLodestoneItemName(item.Name);
  const craftInfos = [];
  const seen = new Set();
  for (const recipePath of extractLodestoneRecipePaths(detailHtml)) {
    assertNotCancelled();
    const recipeUrl = `https://jp.finalfantasyxiv.com${recipePath}`;
    const recipeHtml = decodeHtml(await fetchCachedLodestoneText(recipeUrl, delayMs));
    const recipeItemName = extractLodestoneDetailItemName(recipeHtml);
    if (normalizeLodestoneItemName(recipeItemName) !== expectedName) continue;
    const craftInfo = extractLodestoneCraftInfo(recipeHtml);
    if (!craftInfo) continue;
    const key = `${craftInfo.job}:${craftInfo.level}:${craftInfo.masterbook || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    craftInfos.push(craftInfo);
  }
  return craftInfos;
}

async function filterUnconditionalShops(shops, delayMs) {
  const filtered = [];
  for (const shop of shops) {
    assertNotCancelled();
    const shopHtml = await fetchCachedLodestoneText(`https://jp.finalfantasyxiv.com/lodestone/playguide/db/shop/${shop.shopId}/`, delayMs);
    if (isConditionalLodestoneShop(shopHtml)) continue;
    filtered.push({
      shopName: shop.shopName,
      area: shop.area,
      x: shop.x,
      y: shop.y
    });
  }
  return filtered;
}

async function applyLodestoneInfoToItem(item, delayMs) {
  assertNotCancelled();
  const { detailHtml } = await resolveLodestoneItemDetail(item, delayMs, { cache: true });

  const shopInfo = extractLodestoneShopInfo(detailHtml);
  const shops = shopInfo ? await filterUnconditionalShops(shopInfo.shops, delayMs) : [];
  delete item.ShopSales;
  if (shopInfo && shops.length) item.ShopInfo = { price: shopInfo.price, shops };
  else delete item.ShopInfo;

  const craftInfo = await extractLodestoneCraftInfosForItem(item, detailHtml, delayMs);
  if (craftInfo.length) item.CraftInfo = craftInfo;
  else delete item.CraftInfo;

  const equipmentInfo = extractLodestoneEquipmentInfo(detailHtml);
  if (equipmentInfo) item.EquipmentInfo = equipmentInfo;
  else delete item.EquipmentInfo;
  item.LodestoneInfoCheckedAt = nowIso();

  return {
    shopSales: shops.length,
    craftInfo: craftInfo.length,
    equipmentInfo: Boolean(equipmentInfo),
    equipmentStats: Boolean(equipmentInfo?.stats && Object.values(equipmentInfo.stats).some(value => Number(value) > 0))
  };
}

function hasExistingLodestoneInfo(item) {
  if (item?.EquipmentInfo && !item.EquipmentInfo.stats) return false;
  return Boolean(item?.LodestoneInfoCheckedAt || item?.ShopInfo || item?.CraftInfo || item?.EquipmentInfo);
}

export function mergeHousingShopInfo(items, housingShops = readJson(housingShopsPath, {})) {
  const byName = new Map(items.map(item => [String(item.Name || ''), item]));
  let matched = 0;
  let shopAdded = 0;
  let priceMismatch = 0;
  let unmatched = 0;
  for (const [name, info] of Object.entries(housingShops || {})) {
    const item = byName.get(name);
    if (!item) {
      unmatched += 1;
      continue;
    }
    const shops = Array.isArray(info?.shops) ? info.shops : [];
    if (!shops.length) continue;
    matched += 1;
    item.ShopInfo ||= { price: info.price, shops: [] };
    const currentPrice = Number(item.ShopInfo.price);
    const nextPrice = Number(info.price);
    if (!Number.isFinite(currentPrice) && Number.isFinite(nextPrice)) item.ShopInfo.price = nextPrice;
    else if (Number.isFinite(currentPrice) && Number.isFinite(nextPrice) && currentPrice !== nextPrice) {
      priceMismatch += 1;
      log(`ハウジングショップ価格警告: ${name} 既存=${currentPrice} 追加=${nextPrice}`);
    }
    if (!Array.isArray(item.ShopInfo.shops)) item.ShopInfo.shops = [];
    for (const shop of shops) {
      const normalized = {
        shopName: String(shop.shopName || '').trim(),
        area: String(shop.area || '').trim()
      };
      if (!normalized.shopName || !normalized.area) continue;
      const exists = item.ShopInfo.shops.some(existing =>
        String(existing.shopName || '') === normalized.shopName
        && String(existing.area || '') === normalized.area
      );
      if (exists) continue;
      item.ShopInfo.shops.push(normalized);
      shopAdded += 1;
    }
  }
  log(`ハウジングショップ情報: 一致 ${matched}件、店舗追加 ${shopAdded}件、未一致 ${unmatched}件、価格差 ${priceMismatch}件`);
  return { matched, shopAdded, unmatched, priceMismatch };
}

export async function publishLodestoneInfo({
  target = publicCandidatePath,
  delayMs = defaultLodestoneInfoDelayMs,
  limit = Number.POSITIVE_INFINITY,
  name = '',
  force = false
} = {}) {
  log('Lodestone情報の候補反映を開始しました');
  const items = readJson(target, null);
  if (!Array.isArray(items)) throw new Error(`Item JSON is not an item array: ${target}`);

  const targetName = normalizeLodestoneItemName(name);
  const targetItems = items.filter(item => !targetName || normalizeLodestoneItemName(item.Name) === targetName);
  const limitedItems = Number.isFinite(limit) ? targetItems.slice(0, Math.max(0, limit)) : targetItems;
  log(`Lodestone情報対象: ${limitedItems.length}件 delay=${delayMs}ms${targetName ? ` name=${targetName}` : ''}`);

  let processed = 0;
  let shopMatched = 0;
  let craftMatched = 0;
  let equipmentMatched = 0;
  let equipmentStatsMatched = 0;
  let failed = 0;
  let skipped = 0;
  lodestoneEtaStats = { fetch: 0, cache: 0 };
  cancellationEnabled = true;
  try {
    for (const item of limitedItems) {
      assertNotCancelled();
      processed += 1;
      const itemStartedAt = Date.now();
      const fetchBefore = lodestoneEtaStats.fetch;
      const cacheBefore = lodestoneEtaStats.cache;
      let didSkip = false;
      try {
        if (!force && hasExistingLodestoneInfo(item)) {
          didSkip = true;
          skipped += 1;
          log(`Lodestone ${processed}/${limitedItems.length}: ${item.ID} ${item.Name} 取得済みのためスキップ`);
          continue;
        }
        const result = await applyLodestoneInfoToItem(item, delayMs);
        if (result.shopSales > 0) shopMatched += 1;
        if (result.craftInfo > 0) craftMatched += 1;
        if (result.equipmentInfo) equipmentMatched += 1;
        if (result.equipmentStats) equipmentStatsMatched += 1;
        log(`Lodestone ${processed}/${limitedItems.length}: ${item.ID} ${item.Name} 店${result.shopSales} 製作${result.craftInfo} 装備${result.equipmentInfo ? 1 : 0} ステータス${result.equipmentStats ? 1 : 0}`);
      } catch (error) {
        failed += 1;
        log(`Lodestone警告 ${processed}/${limitedItems.length}: ${item.ID} ${item.Name}: ${error.message}`);
      } finally {
        emitEtaProgress({
          command: 'publish-lodestone-info',
          completed: processed,
          total: limitedItems.length,
          elapsedMs: Date.now() - itemStartedAt,
          fetches: lodestoneEtaStats.fetch - fetchBefore,
          caches: lodestoneEtaStats.cache - cacheBefore,
          skipped: didSkip ? 1 : 0
        });
      }
    }
  } finally {
    cancellationEnabled = false;
  }
  lodestoneEtaStats = null;

  const housingResult = fs.existsSync(housingShopsPath)
    ? mergeHousingShopInfo(items)
    : { matched: 0, shopAdded: 0, unmatched: 0, priceMismatch: 0 };
  if (!fs.existsSync(housingShopsPath)) log('ハウジングショップ情報: housing-shops.json が無いためスキップしました');
  writeJsonAtomic(target, items);
  if (path.resolve(target) === publicItemJsonPath) {
    updateDataCacheVersion({ itemJsonPath: target, salt: `lodestone-info-${processed}-${shopMatched}-${craftMatched}-${equipmentMatched}-${equipmentStatsMatched}-${failed}-${housingResult.shopAdded}`, reason: 'lodestone-info' });
  } else {
    log('公開Item.json以外が対象のため、データキャッシュ版の更新をスキップしました');
  }
  updateRunState({ command: 'publish-lodestone-info', status: 'completed', finalOutput: path.relative(repositoryRoot, target) });
  log(`Lodestone情報を候補反映しました 処理 ${processed}件、スキップ ${skipped}件、店 ${shopMatched}件、製作 ${craftMatched}件、装備 ${equipmentMatched}件、ステータス ${equipmentStatsMatched}件、失敗 ${failed}件`);
}

export function smokeTest({ root = fs.mkdtempSync(path.join(os.tmpdir(), 'ffxiv-pipeline-smoke-')) } = {}) {
  const publicItemHashBefore = fs.existsSync(publicItemJsonPath) ? sha256File(publicItemJsonPath) : null;
  const publicItemMtimeBefore = fs.existsSync(publicItemJsonPath) ? fs.statSync(publicItemJsonPath).mtimeMs : null;
  ensureDir(root);

  const sampleCsv = [
    'Extra,Name,#,Icon,Description,LevelEquip,ItemSearchCategory,ItemUICategory',
    'ignored,"銅鉱, 試験",1,020001,"説明に',
    '改行と ""引用符""",0,2,3'
  ].join('\n');
  const rows = parseCsv(sampleCsv);
  const columns = columnMap(rows[0], csvSchemas['Item.csv'].required);
  if (rows[1][columns.Name] !== '銅鉱, 試験') throw new Error('簡易テスト: CSVの引用符内カンマを解析できません');
  if (!rows[1][columns.Description].includes('\n')) throw new Error('簡易テスト: CSVの引用符内改行を解析できません');
  if (columns['#'] !== 2 || columns.Name !== 1) throw new Error('簡易テスト: CSVヘッダー参照に失敗しました');

  const expected = path.join(root, 'expected.json');
  const actual = path.join(root, 'actual.json');
  const item = {
    ID: '1',
    Name: '銅鉱, 試験',
    Icon: 'assets/item-icons/020/020001.webp',
    Recipe: { AmountResult: '1', Ingredients: [{ ItemID: '2', Name: '素材', Amount: '3' }] }
  };
  writeJsonAtomic(expected, [item]);
  writeJsonAtomic(actual, [item]);
  verifyOutput({ expected, actual });

  for (let i = 1; i <= 4; i += 1) log(`アイコン ${i}/4 簡易テスト`);

  const publicItemHashAfter = fs.existsSync(publicItemJsonPath) ? sha256File(publicItemJsonPath) : null;
  const publicItemMtimeAfter = fs.existsSync(publicItemJsonPath) ? fs.statSync(publicItemJsonPath).mtimeMs : null;
  if (publicItemHashBefore !== publicItemHashAfter || publicItemMtimeBefore !== publicItemMtimeAfter) {
    throw new Error('簡易テストが site/data/Item.json を変更しました');
  }
  log(`簡易テスト成功 ${root}`);
}

function gitOutput(args, options = {}) {
  const result = spawnSync('git', args, { cwd: repositoryRoot, encoding: options.encoding ?? 'utf8', maxBuffer: options.maxBuffer ?? 1024 * 1024 * 10 });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(' ')} に失敗しました`);
  return result.stdout;
}

function gitBatchObjectSizes(revisions) {
  const result = spawnSync('git', ['cat-file', '--batch-check=%(objectsize)'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    input: `${revisions.join('\n')}\n`,
    maxBuffer: 1024 * 1024 * 10
  });
  if (result.status !== 0) throw new Error(result.stderr.trim() || 'git cat-file --batch-check に失敗しました');
  const sizes = new Map();
  const lines = result.stdout.split(/\r?\n/).filter(Boolean);
  for (let i = 0; i < revisions.length; i += 1) {
    const size = Number(lines[i]);
    if (Number.isFinite(size)) sizes.set(revisions[i], size);
  }
  return sizes;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatImagePixels(width, height) {
  return Number.isFinite(width) && Number.isFinite(height) ? `${width}x${height}px` : '-';
}

function parseGatheringStartMinutes(timeRange) {
  const match = String(timeRange).match(/^(\d{2}):(\d{2})-/);
  if (!match) return Number.POSITIVE_INFINITY;
  return Number(match[1]) * 60 + Number(match[2]);
}

function buildGatheringMapOrder(areas) {
  const order = new Map();
  areas.forEach((area, areaIndex) => {
    (area.maps || []).forEach((mapName, mapIndex) => {
      order.set(mapName, { areaName: area.region_name, areaIndex, mapIndex });
    });
  });
  return order;
}

function normalizeGatheringTimerEntries() {
  const areas = readJson(gatheringAreaPath, {}).gathering_area || [];
  const timers = readJson(gatheringTimerPath, {}).gathering_timer || [];
  const mapOrder = buildGatheringMapOrder(areas);
  const methodOrder = new Map([['採掘', 0], ['砕岩', 1], ['伐採', 2], ['草刈', 3]]);
  const byName = new Map();

  for (const entry of timers) {
    const itemName = String(entry.item_name || '');
    if (!itemName) continue;
    for (const [mapName, times] of Object.entries(entry.location || {})) {
      const order = mapOrder.get(mapName) || { areaName: '', areaIndex: 9999, mapIndex: 9999 };
      const normalized = {
        Area: order.areaName,
        Map: mapName,
        Method: entry.method,
        Type: entry.type,
        Times: [...(Array.isArray(times) ? times : [])].sort((a, b) => parseGatheringStartMinutes(a) - parseGatheringStartMinutes(b))
      };
      if (entry.chronicle) normalized.Chronicle = entry.chronicle;
      if (Number.isFinite(Number(entry.required_technical))) normalized.RequiredTechnical = Number(entry.required_technical);
      normalized._areaIndex = order.areaIndex;
      normalized._mapIndex = order.mapIndex;
      if (!byName.has(itemName)) byName.set(itemName, []);
      byName.get(itemName).push(normalized);
    }
  }

  for (const entries of byName.values()) {
    entries.sort((a, b) =>
      a._areaIndex - b._areaIndex
      || a._mapIndex - b._mapIndex
      || (methodOrder.get(a.Method) ?? 99) - (methodOrder.get(b.Method) ?? 99)
      || parseGatheringStartMinutes(a.Times[0]) - parseGatheringStartMinutes(b.Times[0])
    );
    entries.forEach(entry => {
      delete entry._areaIndex;
      delete entry._mapIndex;
    });
  }
  return byName;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function pngBlob(file) {
  return gitOutput(['show', `HEAD:${file}`], { encoding: 'buffer', maxBuffer: 1024 * 1024 * 2 });
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function decodePngRgba(buffer) {
  if (buffer.toString('ascii', 1, 4) !== 'PNG') throw new Error('PNGではありません');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let palette = null;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;
  }
  if (bitDepth !== 8) throw new Error(`未対応のPNGビット深度です: ${bitDepth}`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 3 ? 1 : 0;
  if (!channels) throw new Error(`未対応のPNGカラー形式です: ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rgba = Buffer.alloc(width * height * 4);
  let rawOffset = 0;
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[rawOffset];
    rawOffset += 1;
    const scanline = Buffer.from(raw.subarray(rawOffset, rawOffset + stride));
    rawOffset += stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? scanline[x - channels] : 0;
      const up = previous[x] || 0;
      const upLeft = x >= channels ? previous[x - channels] || 0 : 0;
      if (filter === 1) scanline[x] = (scanline[x] + left) & 255;
      else if (filter === 2) scanline[x] = (scanline[x] + up) & 255;
      else if (filter === 3) scanline[x] = (scanline[x] + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) scanline[x] = (scanline[x] + paeth(left, up, upLeft)) & 255;
    }
    for (let x = 0; x < width; x += 1) {
      const src = x * channels;
      const dst = (y * width + x) * 4;
      if (colorType === 3) {
        const p = scanline[src] * 3;
        rgba[dst] = palette?.[p] ?? 0;
        rgba[dst + 1] = palette?.[p + 1] ?? 0;
        rgba[dst + 2] = palette?.[p + 2] ?? 0;
        rgba[dst + 3] = 255;
      } else {
        rgba[dst] = scanline[src];
        rgba[dst + 1] = scanline[src + 1];
        rgba[dst + 2] = scanline[src + 2];
        rgba[dst + 3] = colorType === 6 ? scanline[src + 3] : 255;
      }
    }
    previous = scanline;
  }
  return { width, height, rgba };
}

function classifyIconBackground(buffer) {
  try {
    const { width, height, rgba } = decodePngRgba(buffer);
    const samples = [];
    for (let y = 2; y < height - 2; y += 1) {
      for (let x = 2; x < width - 2; x += 1) {
        if (x >= 10 && x <= 29 && y >= 10 && y <= 29) continue;
        if (!(x < 9 || x > 30 || y < 9 || y > 30)) continue;
        const i = (y * width + x) * 4;
        if (rgba[i + 3] < 200) continue;
        samples.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
      }
    }
    if (samples.length === 0) return 'unknown';
    const [r, g, b] = samples.reduce((acc, sample) => [acc[0] + sample[0], acc[1] + sample[1], acc[2] + sample[2]], [0, 0, 0]).map(value => value / samples.length);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    const value = max / 255;
    if (value < 0.28) return 'bg-dark';
    if (value > 0.78 && saturation < 0.25) return 'bg-bright';
    if (saturation < 0.22) return 'bg-neutral';
    if (r > 175 && g > 135 && b < 95) return 'bg-gold';
    if (r > 145 && b > 145 && g < 130) return 'bg-purple';
    if (b > r + 25 && b > g + 15) return 'bg-blue';
    if (g > r + 20 && g > b + 15) return 'bg-green';
    if (r > 150 && g < 120 && b < 130) return 'bg-red';
    return 'bg-other';
  } catch {
    return 'bg-unknown';
  }
}

function classifyItemCategory(items) {
  const text = items.map(item => `${item.Name} ${item.ItemUICategoryName || ''} ${item.ItemSearchCategoryName || ''}`).join(' ');
  if (/(シャード|クリスタル|クラスター)/.test(text)) return 'category-crystal';
  if (/(貨幣|通貨|軍票|スクリップ|トークン|証書|交換|霊砂)/.test(text)) return 'category-currency';
  if (/(主道具|副道具|武器|盾|頭防具|胴防具|手防具|脚防具|足防具|耳飾り|首飾り|腕輪|指輪|防具|アクセサリ)/.test(text)) return 'category-equipment';
  if (/(石材|木材|布材|皮革材|骨材|錬金術材|食材|水産物|素材|染料|部品|金属材)/.test(text)) return 'category-material';
  return 'category-other';
}

function pickFromBucket(picked, bucket, count) {
  for (const entry of bucket) {
    if (picked.size >= count) break;
    picked.add(entry.file);
  }
}

function deterministicShuffle(items, seed = 8675309) {
  let state = seed >>> 0;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function selectPreviewSamples(sampleCount, iconGroups = iconGroupsByIconFile(readJson(publicItemJsonPath, []))) {
  const representativeItems = new Map();
  const itemGroups = new Map();
  for (const item of readJson(publicItemJsonPath, [])) {
    if (!item.ID || !item.Name || !item.IconFile) continue;
    const pngName = item.IconFile.replace(/\.webp$/i, '.png');
    const file = `site/assets/item-icons/${pngName.slice(0, 3)}/${pngName}`;
    if (!representativeItems.has(file)) representativeItems.set(file, item);
    if (!itemGroups.has(file)) itemGroups.set(file, []);
    itemGroups.get(file).push(item);
  }
  const entries = [...representativeItems.entries()].map(([file, item]) => {
    const webpPath = path.join(repositoryRoot, file.replace(/\.png$/i, '.webp'));
    const pngName = path.basename(file);
    const lodestoneCachePath = path.join(lodestonePngIconCacheRoot, `${item.ID}.png`);
    const legacyCachePath = path.join(pngIconCacheRoot, pngName.slice(0, 3), pngName);
    const pngSize = fs.existsSync(lodestoneCachePath)
      ? fs.statSync(lodestoneCachePath).size
      : fs.existsSync(legacyCachePath)
        ? fs.statSync(legacyCachePath).size
        : 0;
    const webpSize = fs.existsSync(webpPath) ? fs.statSync(webpPath).size : 0;
    const items = itemGroups.get(file) || [];
    return {
      file,
      item,
      pngName,
      pngSize,
      webpSize,
      ratio: pngSize > 0 && webpSize > 0 ? webpSize / pngSize : Number.POSITIVE_INFINITY,
      category: classifyItemCategory(items)
    };
  });
  const picked = new Set();
  const quota = Math.max(4, Math.ceil(sampleCount / 16));
  const sizedEntries = entries.filter(entry => entry.pngSize > 0);
  pickFromBucket(picked, [...sizedEntries].sort((a, b) => b.pngSize - a.pngSize), Math.ceil(sampleCount * 0.15));
  pickFromBucket(picked, [...sizedEntries].sort((a, b) => a.pngSize - b.pngSize), Math.ceil(sampleCount * 0.3));
  pickFromBucket(picked, [...entries].sort((a, b) => a.ratio - b.ratio), Math.ceil(sampleCount * 0.45));
  pickFromBucket(picked, [...entries].sort((a, b) => b.ratio - a.ratio), Math.ceil(sampleCount * 0.55));
  for (const category of ['category-crystal', 'category-material', 'category-equipment', 'category-currency']) {
    pickFromBucket(picked, entries.filter(entry => entry.category === category), picked.size + quota);
  }
  const shuffled = deterministicShuffle(entries);
  const backgroundTargets = new Set(['bg-dark', 'bg-green', 'bg-blue', 'bg-purple', 'bg-red', 'bg-gold', 'bg-bright', 'bg-neutral']);
  const backgroundCounts = new Map();
  const backgroundPool = deterministicShuffle([...picked].map(file => entries.find(entry => entry.file === file)).filter(Boolean)
    .concat(shuffled.slice(0, sampleCount * 4)));
  let lastProgressLog = 0;
  for (const entry of backgroundPool) {
    if (picked.size >= sampleCount) break;
    let bg = 'bg-missing';
    try {
      bg = classifyIconBackground(await getPreviewPngBlob(entry, iconGroups));
    } catch (error) {
      log(`比較 ${Math.min(picked.size, sampleCount)}/${sampleCount} サンプル候補 ${entry.item.ID} ${entry.item.Name} スキップ: ${error.message}`);
      continue;
    }
    entry.background = bg;
    if (!backgroundTargets.has(bg)) continue;
    const count = backgroundCounts.get(bg) || 0;
    if (count < 3) {
      picked.add(entry.file);
        backgroundCounts.set(bg, count + 1);
    }
    const now = Date.now();
    if (now - lastProgressLog >= 1000) {
      log(`比較 ${Math.min(picked.size, sampleCount)}/${sampleCount} サンプル選定中`);
      lastProgressLog = now;
    }
  }
  for (const entry of shuffled) {
    if (picked.size >= sampleCount) break;
    if (!entry.pngSize) {
      try {
        entry.pngSize = (await getPreviewPngBlob(entry, iconGroups)).length;
      } catch (error) {
        log(`比較 ${Math.min(picked.size, sampleCount)}/${sampleCount} サンプル候補 ${entry.item.ID} ${entry.item.Name} スキップ: ${error.message}`);
        continue;
      }
    }
    picked.add(entry.file);
    const now = Date.now();
    if (now - lastProgressLog >= 1000) {
      log(`比較 ${Math.min(picked.size, sampleCount)}/${sampleCount} サンプル選定中`);
      lastProgressLog = now;
    }
  }
  const selected = [...picked].slice(0, sampleCount).map(file => {
    const entry = entries.find(candidate => candidate.file === file);
    return entry;
  });
  for (const entry of selected) {
    if (!entry.background) {
      try {
        const blob = await getPreviewPngBlob(entry, iconGroups);
        entry.pngSize = entry.pngSize || blob.length;
        entry.background = classifyIconBackground(blob);
      } catch (error) {
        log(`比較 ${Math.min(picked.size, sampleCount)}/${sampleCount} サンプル候補 ${entry.item.ID} ${entry.item.Name} スキップ: ${error.message}`);
        entry.background = 'bg-missing';
      }
    }
  }
  return selected.filter(entry => entry.background !== 'bg-missing');
}

async function getPreviewPngBlob(entry, iconGroups = iconGroupsByIconFile(readJson(publicItemJsonPath, []))) {
  log(`比較 サンプル候補 ${entry.item.ID} ${entry.item.Name} ${entry.pngName}: PNG確認中`);
  const png = await getProductionIconPng(entry.item, entry.pngName, defaultIconDelayMs, sameIconAlternatives(entry.item, iconGroups));
  log(`比較 サンプル候補 ${entry.item.ID} ${entry.item.Name} ${entry.pngName}: PNG確認完了 source=${png.source}`);
  return fs.readFileSync(png.path);
}

export async function tmpQualityPreview({ sampleCount = defaultPreviewSampleCount, force = false, size = 80 } = {}) {
  const iconSize = Number.isFinite(size) && size > 0 ? Math.floor(size) : 80;
  const iconGroups = iconGroupsByIconFile(readJson(publicItemJsonPath, []));
  const qualities = [50, 60, 70, 80];
  const previewRoot = tmpPreviewRoot;
  const sampleRoot = path.join(previewRoot, 'samples');
  const manifest = { generator: 'lodestone-sharp-preview-v3', itemJsonSha256: sha256File(publicItemJsonPath), qualities, sampleCount, size: iconSize };
  const previousManifest = readJson(tmpPreviewManifestPath, null);
  const reusable = !force
    && previousManifest
    && fs.existsSync(path.join(previewRoot, 'index.html'))
    && fs.existsSync(tmpPreviewDataPath)
    && previousManifest.generator === manifest.generator
    && previousManifest.itemJsonSha256 === manifest.itemJsonSha256
    && previousManifest.sampleCount === manifest.sampleCount
    && previousManifest.size === manifest.size
    && JSON.stringify(previousManifest.qualities) === JSON.stringify(manifest.qualities);
  if (reusable) {
    log(`比較 1/1 既存の比較ページを使用します`);
    log(`作成済み ${path.relative(repositoryRoot, path.join(previewRoot, 'index.html'))}`);
    return { reused: true };
  }
  log(`比較 0/${sampleCount} サンプル選定中`);
  if (fs.existsSync(previewRoot)) fs.rmSync(previewRoot, { recursive: true, force: true });
  ensureDir(sampleRoot);

  const samples = await selectPreviewSamples(sampleCount, iconGroups);
  const rows = [];
  let lastProgressLog = 0;

  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i];
    const pngFile = sample.file;
    const iconName = path.basename(pngFile, '.png');
    const pngOut = path.join(sampleRoot, `${iconName}.png`);
    let pngBytes;
    try {
      pngBytes = await getPreviewPngBlob(sample, iconGroups);
    } catch (error) {
      log(`比較 ${i + 1}/${samples.length} スキップ ${path.basename(pngFile)}: ${error.message}`);
      continue;
    }
    writeBytesAtomic(pngOut, pngBytes);
    const pngMeta = await sharp(pngOut).metadata();
    const pngSize = pngBytes.length;
    if (!Number.isFinite(pngSize)) continue;

    const variants = [];
    for (const quality of qualities) {
      const webpOut = path.join(sampleRoot, `${iconName}-q${quality}.webp`);
      await writeWebpFromPng(pngOut, webpOut, quality, iconSize);
      variants.push({
        quality,
        file: `samples/${iconName}-q${quality}.webp`,
        size: fs.statSync(webpOut).size
      });
    }
    const now = Date.now();
    if (now - lastProgressLog >= 1000 || i + 1 === samples.length) {
      log(`比較 ${i + 1}/${samples.length} ${iconName} 変換完了`);
      lastProgressLog = now;
    }
    rows.push({
      iconName,
      pngFile: `samples/${iconName}.png`,
      pngSize,
      pngWidth: pngMeta.width,
      pngHeight: pngMeta.height,
      variants,
      category: sample.category,
      background: sample.background,
      ratio: sample.ratio
    });
  }

  writeTextAtomic(path.join(previewRoot, 'index.html'), renderTmpQualityPreviewHtml(rows));
  writeJsonAtomic(tmpPreviewDataPath, rows);
  writeJsonAtomic(tmpPreviewManifestPath, { ...manifest, generatedAt: nowIso() });
  log(`作成しました ${path.relative(repositoryRoot, path.join(previewRoot, 'index.html'))}`);
  return { reused: false };
}

function renderTmpQualityPreviewHtml(rows) {
  const tableRows = rows.map(row => {
    const cells = [
      `<div class="cell"><div class="swatch"><img src="${escapeHtml(row.pngFile)}" alt=""></div><b>PNG</b><span>元画像 ${escapeHtml(formatImagePixels(row.pngWidth, row.pngHeight))}</span><span>${formatBytes(row.pngSize)}</span></div>`,
      ...row.variants.map(variant => `<div class="cell"><div class="swatch"><img src="${escapeHtml(variant.file)}" alt=""></div><b>q${variant.quality}</b><span>${formatBytes(variant.size)} / ${Math.round((variant.size / row.pngSize) * 100)}%</span></div>`)
    ].join('');
    return `<section class="row"><h2>${escapeHtml(row.iconName)}</h2><div class="tags"><span>${escapeHtml(row.category)}</span><span>${escapeHtml(row.background)}</span></div><div class="grid">${cells}</div></section>`;
  }).join('\n');
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Item Icon Quality Preview</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;color:#e0e0e0;background:#1a1a1a}
header{position:sticky;top:0;background:#252525;border-bottom:1px solid #3a3a3a;padding:12px 16px;z-index:1;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
h1{font-size:18px;margin:0 8px 0 0;color:#c8a84b}button{min-height:36px;padding:0 12px;border:1px solid #3a3a3a;background:#1a1a1a;color:#e0e0e0;border-radius:6px}button.active{background:#c8a84b;color:#1a1a1a;border-color:#c8a84b}
main{padding:12px;display:grid;gap:12px}.row{background:#252525;border:1px solid #3a3a3a;border-radius:8px;padding:12px}.row h2{font-size:14px;margin:0 0 6px}.tags{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}.tags span{font-size:11px;color:#b8b8b8;border:1px solid #3a3a3a;border-radius:999px;padding:2px 7px;background:#1a1a1a}.grid{display:flex;gap:12px;flex-wrap:wrap}.cell{display:grid;gap:5px;justify-items:center;font-size:12px;min-width:72px;color:#b8b8b8}.cell b{color:#e0e0e0}.swatch{width:56px;height:56px;display:grid;place-items:center;background:var(--swatch,#282828);border:1px solid #3a3a3a}.light .swatch{--swatch:#f0f0f0}img{width:40px;height:40px}.x2 img{width:80px;height:80px}.x3 img{width:120px;height:120px}.x2 .swatch{width:96px;height:96px}.x3 .swatch{width:136px;height:136px}
@media(max-width:700px){main{padding:8px}.row{border-radius:0;margin:0 -8px;border-left:0;border-right:0}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.cell{min-width:0}}
</style>
</head>
<body>
<header>
  <h1>Item Icon Quality Preview</h1>
  <button id="scale1" class="active">40</button>
  <button id="scale2">2x</button>
  <button id="scale3">3x</button>
  <button id="theme">light</button>
</header>
<main>${tableRows}</main>
<script>
for (const n of [1, 2, 3]) document.getElementById('scale' + n).onclick = () => {
  document.body.classList.remove('x2', 'x3');
  if (n > 1) document.body.classList.add('x' + n);
  for (const button of document.querySelectorAll('header button')) button.classList.remove('active');
  document.getElementById('scale' + n).classList.add('active');
};
document.getElementById('theme').onclick = () => document.body.classList.toggle('light');
</script>
</body>
</html>
`;
}

function printHelp() {
  log(`使い方: node pipeline/tool/pipeline-tool.mjs <command>

コマンド:
  validate-csv              ローカルCSVを検証しヘッダー参照を出力
  check-updates             公式CSVの更新有無と前回チェック日時を保存
  download-csv [--force]    公式CSVを取得
  build                     中間JSONと公開候補を生成
  publish [--accept-diff]   検証後 site/data/Item.json をatomicに置換
  publish-gathering         既存Item.jsonへ採集情報だけを反映
  publish-lodestone-info [--name アイテム名] [--limit 件数] [--delay 100] [--target path] [--force]
                            Lodestone由来の店/製作/装備情報を公開候補JSONへ反映
  icons [--quality 80] [--size 80] [--delay 500] [--item-json path]
                            Lodestone NQ PNGキャッシュから指定Item.jsonのWebPアイコン生成
  icon-preview [--size 80] アイコン画質比較プレビューを生成
  tmp-quality-preview [--size 80]
                            site/配下に一時PNG/WebP比較を生成
  protect-item-json         現在のItem.jsonを比較元として保存
  verify                    06-public-items.json と Item.json を比較
  smoke-test                実データを変更しない簡易テスト
  run [--skip-icons] [--skip-lodestone-info]
                            CSV検証、データ生成、アイコン生成、Lodestone情報反映、公開反映`);
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const command = args._[0] || 'help';
  if (['help', '--help', '-h'].includes(command)) return printHelp();
  clearCancelRequest();
  if (command === 'validate-csv') return validateCsvFiles();
  if (command === 'check-updates') return checkUpdates();
  if (command === 'download-csv') return downloadCsv({ force: Boolean(args.force) });
  if (command === 'build') {
    validateCsvFiles();
    return buildData();
  }
  if (command === 'icons') return ensureIconsForItemJson({
    quality: Number(args.quality || defaultIconQuality),
    delayMs: Number(args.delay || defaultIconDelayMs),
    size: Number(args.size || 80),
    itemJsonPath: args['item-json'] ? String(args['item-json']) : publicItemJsonPath
  });
  if (command === 'icon-preview') return iconPreview({ qualities: String(args.qualities || '50,60,70,80').split(',').map(Number).filter(Number.isFinite), sampleCount: Number(args['sample-count'] || 80), size: Number(args.size || 80) });
  if (command === 'tmp-quality-preview') return tmpQualityPreview({ force: Boolean(args.force), size: Number(args.size || 80) });
  if (command === 'protect-item-json') return protectItemJson();
  if (command === 'publish') return publishItemJson({ acceptDiff: Boolean(args['accept-diff']) });
  if (command === 'publish-gathering') return publishGatheringTimer();
  if (command === 'publish-lodestone-info') return publishLodestoneInfo({
    target: args.target ? path.resolve(String(args.target)) : publicCandidatePath,
    delayMs: Number(args.delay || defaultLodestoneInfoDelayMs),
    limit: args.limit ? Number(args.limit) : Number.POSITIVE_INFINITY,
    name: args.name ? String(args.name) : '',
    force: Boolean(args.force)
  });
  if (command === 'smoke-test') return smokeTest();
  if (command === 'verify') return verifyOutput({
    expected: args.expected ? path.resolve(String(args.expected)) : (fs.existsSync(expectedItemJsonPath) ? expectedItemJsonPath : publicItemJsonPath),
    actual: args.actual ? path.resolve(String(args.actual)) : buildOutputs.publicItems
  });
  if (command === 'run') {
    validateCsvFiles();
    buildData();
    if (!args['skip-icons']) await ensureIconsForItemJson({
      quality: Number(args.quality || defaultIconQuality),
      delayMs: Number(args.delay || defaultIconDelayMs),
      size: Number(args.size || 80),
      itemJsonPath: publicCandidatePath
    });
    if (!args['skip-lodestone-info']) await publishLodestoneInfo({
      delayMs: Number(args['lodestone-delay'] || args.delay || defaultLodestoneInfoDelayMs),
      force: Boolean(args.force)
    });
    publishItemJson();
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
