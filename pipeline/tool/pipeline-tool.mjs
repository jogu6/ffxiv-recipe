#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import zlib from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';

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
export const siteRoot = path.join(repositoryRoot, 'site');
export const itemIconsRoot = path.join(siteRoot, 'assets', 'item-icons');

const sourcesPath = path.join(pipelineRoot, 'sources.json');
const updateStatePath = path.join(stateRoot, 'update-check.json');
const runStatePath = path.join(stateRoot, 'run-state.json');
const iconQualityStatePath = path.join(stateRoot, 'icon-quality.json');
const expectedItemJsonPath = path.join(pipelineRoot, 'reference', 'expected', 'Item.json');
const publicItemJsonPath = path.join(siteRoot, 'data', 'Item.json');
const iconDownloadErrorLog = path.join(logsRoot, 'icon-download-errors.txt');
const tmpPreviewRoot = path.join(siteRoot, '__tmp_icon_quality');
const tmpPreviewManifestPath = path.join(tmpPreviewRoot, 'manifest.json');
const tmpPreviewDataPath = path.join(tmpPreviewRoot, 'preview-data.json');
const remoteCsvNames = ['Item.csv', 'Recipe.csv', 'ItemUICategory.csv', 'ItemSearchCategory.csv'];
const localCsvNames = ['token-items.csv'];
const defaultIconQuality = 60;
const defaultIconDelayMs = 200;
const defaultPreviewSampleCount = 64;

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

function makeDataCacheVersion(itemJsonPath = publicItemJsonPath) {
  const items = readJson(itemJsonPath, []);
  const maxPatch = items.reduce((max, item) => Math.max(max, Number(item?.Recipe?.PatchNumber) || 0), 0);
  return `ff14recipe-data-${formatPatchForCache(maxPatch)}-${sha256File(itemJsonPath).slice(0, 8)}`;
}

function updateServiceWorkerDataCacheVersion(itemJsonPath = publicItemJsonPath) {
  const version = makeDataCacheVersion(itemJsonPath);
  const source = fs.readFileSync(serviceWorkerPath, 'utf8');
  const next = source.replace(
    /const\s+DATA_CACHE_VERSION\s*=\s*['"][^'"]+['"];/,
    `const DATA_CACHE_VERSION = '${version}';`
  );
  if (next === source) throw new Error('DATA_CACHE_VERSION was not found in sw.js');
  writeTextAtomic(serviceWorkerPath, next);
  log(`データキャッシュ版を更新しました ${version}`);
}

function updateAppDataCacheVersion(itemJsonPath = publicItemJsonPath) {
  const version = makeDataCacheVersion(itemJsonPath);
  const source = fs.readFileSync(appScriptPath, 'utf8');
  const next = source.replace(
    /const\s+DATA_CACHE_VERSION\s*=\s*['"][^'"]+['"];/,
    `const DATA_CACHE_VERSION = '${version}';`
  );
  if (next === source) throw new Error('DATA_CACHE_VERSION was not found in app.js');
  writeTextAtomic(appScriptPath, next);
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
  for (const item of publicItems) {
    const name = searchCategoryById.get(String(item.ItemSearchCategory));
    if (name) {
      item.ItemSearchCategoryName = name;
      searchMatches += 1;
    } else {
      searchSkips += 1;
    }
  }
  saveStep('06-public-items', buildOutputs.publicItems, publicItems);
  updateRunState({ status: 'completed', candidateOutput: path.relative(repositoryRoot, buildOutputs.publicItems) });
  log(`検索カテゴリ照合: 一致 ${searchMatches}件、スキップ ${searchSkips}件`);
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

function commandExists(command) {
  const result = spawnSync(command, ['-version'], { stdio: 'ignore' });
  return result.status === 0 || result.status === 1;
}

function findCwebp() {
  if (commandExists('cwebp')) return 'cwebp';
  throw new Error('cwebp が見つかりません。アイコン変換前に libwebp cwebp を導入してください。');
}

function runCwebp(cwebp, pngPath, webpPath, quality) {
  return new Promise((resolve, reject) => {
    ensureDir(path.dirname(webpPath));
    const child = spawn(cwebp, ['-quiet', '-q', String(quality), '-m', '6', pngPath, '-o', webpPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`cwebp failed (${code}): ${stderr.trim()}`));
    });
  });
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

export async function ensureIcons({ quality = defaultIconQuality, delayMs = defaultIconDelayMs } = {}) {
  ensureDir(logsRoot);
  log(`アイコン生成を開始しました quality=${quality}`);
  ensureDir(itemIconsRoot);
  fs.writeFileSync(iconDownloadErrorLog, '', 'utf8');
  const cwebp = findCwebp();
  const items = readJson(publicItemJsonPath, []);
  const uniqueIconFiles = [...new Set(items.map(item => item.IconFile).filter(Boolean))];
  const state = readJson(iconQualityStatePath, {});
  const storedQuality = Number(state.quality);
  const qualityChanged = Number.isFinite(storedQuality) ? storedQuality !== quality : quality !== defaultIconQuality;
  if (qualityChanged) log(`WebP quality変更を検出しました。全登録アイコンを q${quality} で再生成します`);
  let skipped = 0;
  let converted = 0;
  let downloaded = 0;
  let regenerated = 0;
  let failed = 0;
  let lastProgressLog = 0;
  updateRunState({ command: 'icons', status: 'running', startedAt: nowIso(), total: uniqueIconFiles.length });
  log(`アイコン 0/${uniqueIconFiles.length} 開始`);
  for (let i = 0; i < uniqueIconFiles.length; i += 1) {
    const { webpName, pngName, webpPath, pngPath } = iconPaths(uniqueIconFiles[i]);
    let detail = `${webpName} 確認中`;
    let forceProgressLog = false;
    if (fs.existsSync(webpPath) && !qualityChanged) {
      if (fs.existsSync(pngPath)) fs.rmSync(pngPath);
      skipped += 1;
      detail = `${webpName} 既存WebPを使用`;
    } else {
      try {
        if (qualityChanged && fs.existsSync(webpPath)) {
          detail = `${webpName} 再生成用PNG準備中`;
          writeBytesAtomic(pngPath, await getCachedPngBlob(`site/assets/item-icons/${pngName.slice(0, 3)}/${pngName}`, delayMs));
          regenerated += 1;
        } else if (!fs.existsSync(pngPath)) {
          detail = `${pngName} PNG準備中`;
          writeBytesAtomic(pngPath, await getCachedPngBlob(`site/assets/item-icons/${pngName.slice(0, 3)}/${pngName}`, delayMs));
          downloaded += 1;
          detail = `${pngName} PNG準備完了`;
        }
        detail = `${webpName} WebP変換中`;
        await runCwebp(cwebp, pngPath, webpPath, quality);
        fs.rmSync(pngPath);
        converted += 1;
        detail = `${webpName} WebP変換完了`;
      } catch (error) {
        failed += 1;
        detail = `${webpName} 失敗: ${error.message}`;
        forceProgressLog = true;
        fs.appendFileSync(iconDownloadErrorLog, `${webpName}: ${error.message}\n`, 'utf8');
      }
    }
    const now = Date.now();
    if (forceProgressLog || now - lastProgressLog >= 1000 || i + 1 === uniqueIconFiles.length) {
      updateRunState({ command: 'icons', status: 'running', completed: i + 1, total: uniqueIconFiles.length });
      log(`アイコン ${i + 1}/${uniqueIconFiles.length} ${detail}`);
      lastProgressLog = now;
    }
  }
  updateRunState({ command: 'icons', status: failed > 0 ? 'completed-with-errors' : 'completed', completed: uniqueIconFiles.length, total: uniqueIconFiles.length });
  if (failed === 0) writeJsonAtomic(iconQualityStatePath, { quality, itemJsonSha256: sha256File(publicItemJsonPath), updatedAt: nowIso() });
  log(`アイコン生成完了: 既存 ${skipped}件、再生成 ${regenerated}件、変換 ${converted}件、PNG準備 ${downloaded}件、失敗 ${failed}件`);
  return { skipped, regenerated, converted, downloaded, failed };
}

function sampleIconFiles(count) {
  return [...new Set(readJson(publicItemJsonPath, []).map(item => item.IconFile).filter(Boolean))]
    .map(iconFile => iconPaths(iconFile))
    .slice(0, count);
}

function fileSize(file) {
  return fs.existsSync(file) ? fs.statSync(file).size : 0;
}

export async function iconPreview({ qualities = [50, 60, 70, 80], sampleCount = 80 } = {}) {
  const cwebp = findCwebp();
  const reportRoot = path.join(reportsRoot, 'icon-quality');
  const sampleRoot = path.join(reportRoot, 'samples');
  ensureDir(sampleRoot);
  const rows = [];
  for (const sample of sampleIconFiles(sampleCount)) {
    const hadPng = fs.existsSync(sample.pngPath);
    if (!hadPng) {
      try {
        await downloadIconPng(sample.pngName, sample.pngPath, defaultIconDelayMs);
      } catch (error) {
        log(`プレビュー対象をスキップしました ${sample.pngName}: ${error.message}`);
        continue;
      }
    }
    const originalName = `${path.basename(sample.pngName, '.png')}-original.png`;
    const originalPath = path.join(sampleRoot, originalName);
    fs.copyFileSync(sample.pngPath, originalPath);
    const variants = [];
    for (const quality of qualities) {
      const variantName = `${path.basename(sample.pngName, '.png')}-q${quality}.webp`;
      const variantPath = path.join(sampleRoot, variantName);
      await runCwebp(cwebp, sample.pngPath, variantPath, quality);
      variants.push({ quality, file: `samples/${variantName}`, size: fileSize(variantPath) });
    }
    rows.push({ icon: sample.pngName, original: { file: `samples/${originalName}`, size: fileSize(originalPath) }, variants });
    if (!hadPng && fs.existsSync(sample.pngPath)) fs.rmSync(sample.pngPath);
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

export function servePreview({ port = 4174 } = {}) {
  const root = path.join(reportsRoot, 'icon-quality');
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.normalize(path.join(root, requested));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.writeHead(404);
      response.end('見つかりません');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    response.writeHead(200, { 'content-type': ext === '.html' ? 'text/html; charset=utf-8' : ext === '.webp' ? 'image/webp' : 'image/png' });
    fs.createReadStream(file).pipe(response);
  });
  server.listen(port, '0.0.0.0', () => {
    log(`プレビューサーバー: http://localhost:${port}`);
    for (const net of Object.values(os.networkInterfaces())) {
      for (const addr of net || []) if (addr.family === 'IPv4' && !addr.internal) log(`プレビューサーバー: http://${addr.address}:${port}`);
    }
  });
}

function normalizeItemForCompare(item) {
  const clone = JSON.parse(JSON.stringify(item));
  if (typeof clone.IconFile === 'string') clone.IconFile = clone.IconFile.replace(/\.png$/i, '.webp');
  return clone;
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
  target = publicItemJsonPath
} = {}) {
  log('公開反映を開始しました');
  if (!fs.existsSync(candidate)) throw new Error(`Missing publish candidate: ${candidate}`);
  const candidateItems = readJson(candidate, null);
  if (!Array.isArray(candidateItems)) throw new Error(`Candidate is not an item array: ${candidate}`);
  verifyOutput({ expected, actual: candidate });
  writeTextAtomic(target, fs.readFileSync(candidate, 'utf8'));
  updateServiceWorkerDataCacheVersion(target);
  updateAppDataCacheVersion(target);
  updateRunState({ command: 'publish', status: 'completed', finalOutput: path.relative(repositoryRoot, target) });
  log(`公開反映しました ${path.relative(repositoryRoot, candidate)} -> ${path.relative(repositoryRoot, target)}`);
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

async function selectPreviewSamples(sampleCount) {
  const trackedPngFiles = new Set(gitOutput(['ls-files', 'site/assets/item-icons'])
    .split(/\r?\n/)
    .filter(file => file.endsWith('.png')));
  const pngFiles = [...new Set(readJson(publicItemJsonPath, [])
    .map(item => item.IconFile)
    .filter(Boolean)
    .map(iconFileToPngRepoPath))];
  const trackedForSize = pngFiles.filter(file => trackedPngFiles.has(file));
  const pngSizes = gitBatchObjectSizes(trackedForSize.map(file => `HEAD:${file}`));
  const itemGroups = new Map();
  for (const item of readJson(publicItemJsonPath, [])) {
    if (!item.IconFile) continue;
    const pngName = item.IconFile.replace(/\.webp$/i, '.png');
    const file = `site/assets/item-icons/${pngName.slice(0, 3)}/${pngName}`;
    if (!itemGroups.has(file)) itemGroups.set(file, []);
    itemGroups.get(file).push(item);
  }
  const entries = pngFiles.map(file => {
    const webpPath = path.join(repositoryRoot, file.replace(/\.png$/i, '.webp'));
    const pngSize = pngSizes.get(`HEAD:${file}`) || 0;
    const webpSize = fs.existsSync(webpPath) ? fs.statSync(webpPath).size : 0;
    const items = itemGroups.get(file) || [];
    return {
      file,
      pngSize,
      webpSize,
      ratio: pngSize > 0 && webpSize > 0 ? webpSize / pngSize : Number.POSITIVE_INFINITY,
      category: classifyItemCategory(items)
    };
  });
  for (const entry of entries) {
    if (!entry.pngSize && !trackedPngFiles.has(entry.file)) {
      const cachePath = path.join(pngIconCacheRoot, path.basename(entry.file).slice(0, 3), path.basename(entry.file));
      if (fs.existsSync(cachePath)) entry.pngSize = fs.statSync(cachePath).size;
    }
  }
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
      bg = classifyIconBackground(await getCachedPngBlob(entry.file));
    } catch {
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
        entry.pngSize = (await getCachedPngBlob(entry.file)).length;
      } catch {
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
        const blob = await getCachedPngBlob(entry.file);
        entry.pngSize = entry.pngSize || blob.length;
        entry.background = classifyIconBackground(blob);
      } catch {
        entry.background = 'bg-missing';
      }
    }
  }
  return selected.filter(entry => entry.background !== 'bg-missing');
}

export async function tmpQualityPreview({ sampleCount = defaultPreviewSampleCount, force = false } = {}) {
  const cwebp = findCwebp();
  const qualities = [50, 60, 70, 80];
  const previewRoot = tmpPreviewRoot;
  const sampleRoot = path.join(previewRoot, 'samples');
  const manifest = { itemJsonSha256: sha256File(publicItemJsonPath), qualities, sampleCount };
  const previousManifest = readJson(tmpPreviewManifestPath, null);
  const reusable = !force
    && previousManifest
    && fs.existsSync(path.join(previewRoot, 'index.html'))
    && fs.existsSync(tmpPreviewDataPath)
    && previousManifest.itemJsonSha256 === manifest.itemJsonSha256
    && previousManifest.sampleCount === manifest.sampleCount
    && JSON.stringify(previousManifest.qualities) === JSON.stringify(manifest.qualities);
  if (reusable) {
    log(`比較 1/1 既存の比較ページを使用します`);
    log(`作成済み ${path.relative(repositoryRoot, path.join(previewRoot, 'index.html'))}`);
    return { reused: true };
  }
  log(`比較 0/${sampleCount} サンプル選定中`);
  if (fs.existsSync(previewRoot)) fs.rmSync(previewRoot, { recursive: true, force: true });
  ensureDir(sampleRoot);

  const samples = await selectPreviewSamples(sampleCount);
  const rows = [];
  let lastProgressLog = 0;

  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i];
    const pngFile = sample.file;
    const iconName = path.basename(pngFile, '.png');
    const pngOut = path.join(sampleRoot, `${iconName}.png`);
    let pngBytes;
    try {
      pngBytes = await getCachedPngBlob(pngFile);
    } catch (error) {
      log(`比較 ${i + 1}/${samples.length} スキップ ${path.basename(pngFile)}: ${error.message}`);
      continue;
    }
    writeBytesAtomic(pngOut, pngBytes);
    const pngSize = sample.pngSize;
    if (!Number.isFinite(pngSize)) continue;

    const variants = [];
    for (const quality of qualities) {
      const webpOut = path.join(sampleRoot, `${iconName}-q${quality}.webp`);
      await runCwebp(cwebp, pngOut, webpOut, quality);
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
      `<div class="cell"><div class="swatch"><img src="${escapeHtml(row.pngFile)}" alt=""></div><b>PNG</b><span>${formatBytes(row.pngSize)}</span></div>`,
      ...row.variants.map(variant => `<div class="cell"><div class="swatch"><img src="${escapeHtml(variant.file)}" alt=""></div><b>q${variant.quality}</b><span>${formatBytes(variant.size)} / ${Math.round((variant.size / row.pngSize) * 100)}%</span></div>`)
    ].join('');
    return `<section class="row"><h2>${escapeHtml(row.iconName)}</h2><div class="tags"><span>${escapeHtml(row.category)}</span><span>${escapeHtml(row.background)}</span><span>q60/current ${Math.round((row.ratio || 0) * 100)}%</span></div><div class="grid">${cells}</div></section>`;
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
  publish                   検証後 site/data/Item.json をatomicに置換
  icons [--quality 60]      Item WebPアイコン生成とPNG削除
  icon-preview              アイコン画質比較プレビューを生成
  tmp-quality-preview       site/配下に一時PNG/WebP比較を生成
  serve-preview             LAN向けに画質比較を配信
  protect-item-json         現在のItem.jsonを比較元として保存
  verify                    06-public-items.json と Item.json を比較
  smoke-test                実データを変更しない簡易テスト
  run [--skip-icons]        CSV検証、データ生成、必要ならアイコン生成`);
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const command = args._[0] || 'help';
  if (['help', '--help', '-h'].includes(command)) return printHelp();
  if (command === 'validate-csv') return validateCsvFiles();
  if (command === 'check-updates') return checkUpdates();
  if (command === 'download-csv') return downloadCsv({ force: Boolean(args.force) });
  if (command === 'build') {
    validateCsvFiles();
    return buildData();
  }
  if (command === 'icons') return ensureIcons({ quality: Number(args.quality || defaultIconQuality), delayMs: Number(args.delay || defaultIconDelayMs) });
  if (command === 'icon-preview') return iconPreview({ qualities: String(args.qualities || '50,60,70,80').split(',').map(Number).filter(Number.isFinite), sampleCount: Number(args['sample-count'] || 80) });
  if (command === 'tmp-quality-preview') return tmpQualityPreview({ force: Boolean(args.force) });
  if (command === 'serve-preview') return servePreview({ port: Number(args.port || 4174) });
  if (command === 'protect-item-json') return protectItemJson();
  if (command === 'publish') return publishItemJson();
  if (command === 'smoke-test') return smokeTest();
  if (command === 'verify') return verifyOutput({
    expected: args.expected ? path.resolve(String(args.expected)) : (fs.existsSync(expectedItemJsonPath) ? expectedItemJsonPath : publicItemJsonPath),
    actual: args.actual ? path.resolve(String(args.actual)) : buildOutputs.publicItems
  });
  if (command === 'run') {
    validateCsvFiles();
    buildData();
    publishItemJson();
    if (!args['skip-icons']) await ensureIcons({ quality: Number(args.quality || defaultIconQuality), delayMs: Number(args.delay || defaultIconDelayMs) });
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
