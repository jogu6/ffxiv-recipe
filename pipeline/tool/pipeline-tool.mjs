#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import {
  LODESTONE_BASE_URL,
  LODESTONE_ITEM_LIST_URL,
  LODESTONE_RECIPE_LIST_URL,
  applyDescendingSortOrder,
  crawlLodestoneList,
  createSequentialRequestQueue,
  exactXivapiItemIcon,
  extractLodestoneItemList,
  extractLodestoneListMeta,
  extractLodestoneRecipeList,
  lodestoneOrderSignature,
  xivapiExactItemSearchUrl,
  xivapiPngAssetUrl
} from './lodestone-source.mjs';

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
export const lodestoneShopCacheDatabasePath = path.join(cacheRoot, 'lodestone-shops.sqlite');
export const manualItemIconsRoot = path.join(inputRoot, 'manual-item-icons');
export const siteRoot = path.join(repositoryRoot, 'site');
export const itemIconsRoot = path.join(siteRoot, 'assets', 'item-icons');

const sourcesPath = path.join(pipelineRoot, 'sources.json');
const updateStatePath = path.join(stateRoot, 'update-check.json');
const oxidizerStatePath = path.join(stateRoot, 'oxidizer.json');
const oxidizerImportStatePath = path.join(stateRoot, 'oxidizer-import.json');
const pipelineWorkflowStatePath = path.join(stateRoot, 'pipeline-workflow.json');
const publicationGateStatePath = path.join(stateRoot, 'publication-gate.json');
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
const oxidizerRepositoryUrl = 'https://github.com/skyborn-industries/xiv-data-oxidizer';
const gatheringAreaPath = path.join(inputRoot, 'gathering_area.json');
const gatheringTimerPath = path.join(inputRoot, 'gathering_timer.json');
const housingShopsPath = path.join(inputRoot, 'housing-shops.json');
const friendlyTribeShopsPath = path.join(inputRoot, 'friendly-tribe-shops.json');
const equipmentRoleOverridesPath = path.join(inputRoot, 'equipment-role-overrides.json');
const publicationDecisionsPath = path.join(inputRoot, 'publication-decisions.json');
const craftJobsPath = path.join(inputRoot, 'web-app', 'craft-jobs.json');
const lodestoneItemUrlsPath = path.join(stateRoot, 'lodestone-item-urls.json');
const lodestoneSourceSnapshotPath = path.join(stateRoot, 'lodestone-source-snapshot.json');
const defaultIconQuality = 80;
const defaultIconDelayMs = 500;
const defaultLodestoneInfoDelayMs = 100;
const lodestoneHtmlMaxBytes = 4 * 1024 * 1024;
const lodestoneShopConditionCacheMaxEntries = 4096;
let lodestoneEtaStats = null;
let lodestoneShopConditionCache = null;
let lodestoneShopCacheStore = null;
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
const lodestoneRoleStatNames = ['不屈', '信仰', 'スキルスピード', 'スペルスピード'];
const lodestoneEquipmentStatNames = [...lodestonePrimaryStatNames, ...lodestoneRoleStatNames];
const lodestoneEquipmentStatsVersion = 2;
const lodestoneInfoVersion = 2;
const equipmentRoleCodes = ['tank', 'healer', 'striker_slayer', 'scout_ranger', 'caster'];
const equipmentAggregateRoleCodes = ['fighter', 'sorcerer'];
const equipmentOverrideRoleCodes = [...equipmentRoleCodes, ...equipmentAggregateRoleCodes];
const equipmentRoleByStat = {
  VIT: 'tank',
  MND: 'healer',
  STR: 'striker_slayer',
  DEX: 'scout_ranger',
  INT: 'caster'
};
const equipmentBroadJobRoles = {
  全クラス: equipmentRoleCodes,
  ファイター: ['tank', 'striker_slayer', 'scout_ranger'],
  ソーサラー: ['healer', 'caster']
};
const equipmentNameRoleRules = [
  { role: 'tank', pattern: /(ディフェンダー|ディフェンス)/ },
  { role: 'healer', pattern: /(ヒーラー|ヒール)/ },
  { role: 'caster', pattern: /(キャスター|キャスト)/ },
  { role: 'striker_slayer', pattern: /(ストライカー|ストライク|スレイヤー|スレイ|アタッカー|アタック)/ },
  { role: 'scout_ranger', pattern: /(レンジャー|レンジ|スカウト|スカウティング)/ }
];
const lodestoneEquipmentJobPattern = [
  '全クラス',
  'ファイター',
  'ソーサラー',
  'クラフター',
  'ギャザラー',
  '剣術士',
  '斧術士',
  '格闘士',
  '槍術士',
  '双剣士',
  '弓術士',
  '幻術士',
  '呪術士',
  '巴術士',
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
const legacyItemIdCandidatePath = path.join(intermediateRoot, 'legacy-item-ids.json');
const manualUnmatchedReportPath = path.join(reportsRoot, 'lodestone-manual-unmatched.json');
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

function compactNumericMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const compact = Object.fromEntries(
    Object.entries(value).filter(([, entry]) => typeof entry !== 'number' || entry !== 0)
  );
  return Object.keys(compact).length > 0 ? compact : undefined;
}

function compactPublicRecipe(recipe, itemIds) {
  if (!recipe || typeof recipe !== 'object') return;
  for (const ingredient of recipe.Ingredients || []) {
    if (itemIds.has(String(ingredient.ItemID))) delete ingredient.Name;
  }
}

export function projectPublicItems(items) {
  if (!Array.isArray(items)) throw new TypeError('Public Item.json source must be an item array.');
  const projected = cloneJson(items);
  const itemIds = new Set(projected.map(item => String(item.ID)));
  for (const item of projected) {
    for (const key of [
      'Description',
      'LevelEquip',
      'ItemSearchCategory',
      'ItemSearchCategoryName',
      'LodestoneInfoCheckedAt',
      'LodestoneInfoVersion'
    ]) delete item[key];
    if (item.IsEx === false) delete item.IsEx;
    compactPublicRecipe(item.Recipe, itemIds);
    for (const recipe of item.Recipes || []) compactPublicRecipe(recipe, itemIds);
    if (item.EquipmentInfo) {
      delete item.EquipmentInfo.statsVersion;
      const stats = compactNumericMap(item.EquipmentInfo.stats);
      const performance = compactNumericMap(item.EquipmentInfo.performance);
      if (stats) item.EquipmentInfo.stats = stats;
      else delete item.EquipmentInfo.stats;
      if (performance) item.EquipmentInfo.performance = performance;
      else delete item.EquipmentInfo.performance;
    }
  }
  return projected;
}

function writePublicItemsAtomic(file, items) {
  writeTextAtomic(file, `${JSON.stringify(projectPublicItems(items))}\n`);
}

function writeBytesAtomic(file, bytes) {
  ensureDir(path.dirname(file));
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(temp, bytes);
  fs.renameSync(temp, file);
}

function commandExists(command) {
  const probe = process.platform === 'win32' ? 'where.exe' : 'which';
  return spawnSync(probe, [command], {
    encoding: 'utf8',
    windowsHide: true
  }).status === 0;
}

function runExternal(command, args, {
  cwd = repositoryRoot,
  allowFailure = false,
  capture = false
} = {}) {
  log(`外部コマンド: ${command} ${args.map(value => JSON.stringify(String(value))).join(' ')}`);
  const result = spawnSync(command, args.map(String), {
    cwd,
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    const detail = capture ? `${result.stdout || ''}${result.stderr || ''}`.trim() : '';
    throw new Error(`${command} が終了コード ${result.status} で失敗しました${detail ? `: ${detail}` : ''}`);
  }
  return result;
}

function oxidizerGitOutput(args, cwd = repositoryRoot, { allowFailure = false } = {}) {
  const result = runExternal('git', args, { cwd, allowFailure, capture: true });
  return {
    ok: result.status === 0,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
    status: result.status
  };
}

function resolveOxidizerCsvRoot(source = '') {
  const configured = String(source || '').trim();
  const state = readJson(oxidizerStatePath, {});
  const candidates = [
    configured,
    state.latestOutputRoot,
    state.latestRepositoryRoot
  ].filter(Boolean).map(value => path.resolve(String(value)));
  for (const candidate of candidates) {
    const roots = [
      candidate,
      path.join(candidate, 'output', 'ja'),
      path.join(candidate, 'ja')
    ];
    for (const root of roots) {
      if (remoteCsvNames.every(name => fs.existsSync(path.join(root, name)))) return root;
    }
  }
  throw new Error('Oxidizer CSVフォルダーを特定できません。output\\ja または4つのCSVがあるフォルダーを指定してください。');
}

function oxidizerCsvManifest(csvRoot) {
  return {
    sourceRoot: path.resolve(csvRoot),
    files: Object.fromEntries(remoteCsvNames.map(name => {
      const file = path.join(csvRoot, name);
      const stat = fs.statSync(file);
      return [name, {
        bytes: stat.size,
        sha256: sha256File(file)
      }];
    }))
  };
}

function manifestsMatch(left, right) {
  return remoteCsvNames.every(name =>
    left?.files?.[name]?.sha256 &&
    left.files[name].sha256 === right?.files?.[name]?.sha256
  );
}

function manifestFingerprint(manifest) {
  const hashes = remoteCsvNames.map(name => `${name}:${manifest?.files?.[name]?.sha256 || ''}`);
  return crypto.createHash('sha256').update(hashes.join('\n')).digest('hex');
}

function currentInputManifest() {
  try {
    return oxidizerCsvManifest(inputRoot);
  } catch {
    return null;
  }
}

function recordWorkflowStage(stage, values = {}) {
  const order = ['build', 'lodestone', 'icons', 'publish'];
  const current = readJson(pipelineWorkflowStatePath, { version: 1 });
  const next = { ...current, version: 1 };
  const stageIndex = order.indexOf(stage);
  if (stageIndex >= 0) {
    for (const later of order.slice(stageIndex + 1)) delete next[later];
  }
  next[stage] = { completedAt: nowIso(), ...values };
  writeJsonAtomic(pipelineWorkflowStatePath, next);
  return next;
}

function invalidateWorkflowAfterImport(manifest) {
  writeJsonAtomic(pipelineWorkflowStatePath, {
    version: 1,
    imported: {
      completedAt: nowIso(),
      inputFingerprint: manifestFingerprint(manifest)
    }
  });
}

export function pipelineWorkflowStatus() {
  const inputManifest = currentInputManifest();
  const inputFingerprint = inputManifest ? manifestFingerprint(inputManifest) : '';
  const workflow = readJson(pipelineWorkflowStatePath, { version: 1 });
  const importState = readJson(oxidizerImportStatePath, null);
  const sourceMatchesInput = Boolean(
    inputManifest
    && importState?.manifest
    && manifestsMatch(importState.manifest, inputManifest)
  );
  const previewDifferenceCount =
    Number(importState?.addedCount || 0)
    + Number(importState?.removedCount || 0)
    + Number(importState?.changedCount || 0);
  const candidateExists = fs.existsSync(publicCandidatePath);
  const candidateSha256 = candidateExists ? sha256File(publicCandidatePath) : '';
  const publicExists = fs.existsSync(publicItemJsonPath);
  const publicSha256 = publicExists ? sha256File(publicItemJsonPath) : '';
  const buildComplete = Boolean(
    inputFingerprint
    && workflow.build?.inputFingerprint === inputFingerprint
    && candidateExists
  );
  const lodestoneComplete = Boolean(
    buildComplete
    && workflow.lodestone?.inputFingerprint === inputFingerprint
    && workflow.lodestone?.candidateSha256 === candidateSha256
  );
  const iconsComplete = Boolean(
    lodestoneComplete
    && workflow.icons?.candidateSha256 === candidateSha256
  );
  const publishComplete = Boolean(
    iconsComplete
    && workflow.publish?.candidateSha256 === candidateSha256
    && workflow.publish?.publicSha256 === publicSha256
  );
  const next = !buildComplete
    ? 'build'
    : !lodestoneComplete
      ? 'publish-lodestone-info'
      : !iconsComplete
        ? 'icons'
        : !publishComplete
          ? 'publish'
          : 'complete';
  return {
    inputAvailable: Boolean(inputManifest),
    inputFingerprint,
    import: {
      status: sourceMatchesInput ? 'current' : String(importState?.status || 'none'),
      sourceMatchesInput,
      previewDifferenceCount,
      preflightComplete: Boolean(importState?.lodestonePreflight)
    },
    stages: {
      build: { complete: buildComplete },
      lodestone: { complete: lodestoneComplete, enabled: buildComplete },
      icons: {
        complete: iconsComplete,
        enabled: lodestoneComplete,
        quality: workflow.icons?.quality ?? null,
        size: workflow.icons?.size ?? null
      },
      publish: { complete: publishComplete, enabled: iconsComplete }
    },
    next
  };
}

function timestampForPath(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function compressLodestoneHtml(text, { maxOutputLength = lodestoneHtmlMaxBytes } = {}) {
  const source = Buffer.from(String(text), 'utf8');
  if (source.length > maxOutputLength) {
    throw new Error(`展開後HTMLが上限を超えています: ${source.length} > ${maxOutputLength}`);
  }
  const compressed = zlib.gzipSync(source, { level: 6 });
  const verified = zlib.gunzipSync(compressed, { maxOutputLength });
  if (!verified.equals(source)) throw new Error('gzip検証結果が元HTMLと一致しません');
  return {
    body: compressed,
    rawBytes: source.length,
    sha256: crypto.createHash('sha256').update(source).digest()
  };
}

export function decompressLodestoneHtml(entry, { maxOutputLength = lodestoneHtmlMaxBytes } = {}) {
  if (!entry) return null;
  const source = zlib.gunzipSync(Buffer.from(entry.body), { maxOutputLength });
  if (source.length !== Number(entry.raw_bytes)) throw new Error('Lodestoneキャッシュの展開サイズが一致しません');
  const expectedHash = Buffer.from(entry.sha256);
  const actualHash = crypto.createHash('sha256').update(source).digest();
  if (!actualHash.equals(expectedHash)) throw new Error('LodestoneキャッシュのSHA-256が一致しません');
  return source.toString('utf8');
}

export function openLodestoneShopCacheStore(file = lodestoneShopCacheDatabasePath) {
  ensureDir(path.dirname(file));
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=FULL;
    PRAGMA busy_timeout=5000;
    PRAGMA cell_size_check=ON;
    PRAGMA trusted_schema=OFF;
    CREATE TABLE IF NOT EXISTS cache (
      key TEXT PRIMARY KEY,
      url TEXT,
      body BLOB NOT NULL,
      raw_bytes INTEGER NOT NULL,
      sha256 BLOB NOT NULL,
      updated_at INTEGER NOT NULL
    ) WITHOUT ROWID;
  `);
  const columns = db.prepare('PRAGMA table_info(cache)').all().map(column => column.name);
  if (!columns.includes('url')) db.exec('ALTER TABLE cache ADD COLUMN url TEXT');
  return {
    file,
    db,
    get: db.prepare('SELECT body, raw_bytes, sha256 FROM cache WHERE key = ?'),
    put: db.prepare(`
      INSERT INTO cache (key, url, body, raw_bytes, sha256, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        url = COALESCE(excluded.url, cache.url),
        body = excluded.body,
        raw_bytes = excluded.raw_bytes,
        sha256 = excluded.sha256,
        updated_at = excluded.updated_at
    `),
    remove: db.prepare('DELETE FROM cache WHERE key = ?'),
    count: db.prepare('SELECT COUNT(*) AS count FROM cache'),
    close() {
      try {
        db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      } finally {
        db.close();
      }
    }
  };
}

export function readLodestoneShopCacheEntry(store, key) {
  return decompressLodestoneHtml(store.get.get(key));
}

export function writeLodestoneShopCacheEntry(store, key, text, { url = null } = {}) {
  const entry = compressLodestoneHtml(text);
  store.db.exec('BEGIN IMMEDIATE');
  try {
    store.put.run(key, url, entry.body, entry.rawBytes, entry.sha256, Date.now());
    store.db.exec('COMMIT');
  } catch (error) {
    store.db.exec('ROLLBACK');
    throw error;
  }
  return { sourceBytes: entry.rawBytes, compressedBytes: entry.body.length };
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function formatPatchForCache(value) {
  const raw = String(Number(value) || 0).padStart(3, '0');
  return `${Number(raw.slice(0, -2))}.${raw.slice(-2)}`;
}

function makeDataCacheVersion(itemJsonPath = publicItemJsonPath, salt = '') {
  const source = readJson(itemJsonPath, []);
  const items = Array.isArray(source) ? source : source.Items || [];
  const maxPatch = items.reduce((max, item) => Math.max(max, Number(item?.Recipe?.PatchNumber) || 0), 0);
  const version = String(Array.isArray(source) ? formatPatchForCache(maxPatch) : source.Version || '0');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(itemJsonPath));
  if (salt) hash.update(String(salt));
  return `ff14recipe-data-${version}-${hash.digest('hex').slice(0, 8)}`;
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
  const inputManifest = currentInputManifest();
  if (inputManifest) {
    recordWorkflowStage('build', {
      inputFingerprint: manifestFingerprint(inputManifest),
      candidateSha256: sha256File(buildOutputs.publicItems)
    });
  }
  return publicItems;
}

export function validateOxidizerCsvRoot({ source = '' } = {}) {
  const csvRoot = resolveOxidizerCsvRoot(source);
  log(`Oxidizer CSV検証を開始しました: ${csvRoot}`);
  const results = [];
  for (const name of remoteCsvNames) {
    const file = path.join(csvRoot, name);
    const rows = readCsv(file);
    if (rows.length < 2) throw new Error(`${name} にデータ行がありません`);
    const header = rows[0];
    columnMap(header, csvSchemas[name].required);
    const width = header.length;
    const malformed = rows.findIndex((row, index) => index > 0 && row.length !== width);
    if (malformed >= 0) {
      throw new Error(`${name} の行 ${malformed + 1} は列数が不正です (${rows[malformed].length}/${width})`);
    }
    results.push({ name, rows: rows.length - 1, columns: width });
    log(`${name}: ${rows.length - 1}行 ${width}列`);
  }
  return {
    csvRoot,
    manifest: oxidizerCsvManifest(csvRoot),
    results
  };
}

function compareItemCollections(beforeItems, afterItems) {
  const before = new Map(beforeItems.map(item => [String(item.ID), item]));
  const after = new Map(afterItems.map(item => [String(item.ID), item]));
  const added = [...after].filter(([id]) => !before.has(id)).map(([, item]) => item);
  const removed = [...before].filter(([id]) => !after.has(id)).map(([, item]) => item);
  const changed = [...after].flatMap(([id, item]) => {
    const previous = before.get(id);
    if (!previous || JSON.stringify(previous) === JSON.stringify(item)) return [];
    const fields = [...new Set([...Object.keys(previous), ...Object.keys(item)])]
      .filter(field => JSON.stringify(previous[field]) !== JSON.stringify(item[field]))
      .map(field => ({
        field,
        before: previous[field] ?? null,
        after: item[field] ?? null
      }));
    return [{ before: previous, after: item, fields }];
  });
  return { added, removed, changed };
}

function makeOxidizerImportPreview({ csvRoot, manifest }) {
  const previewRoot = path.join(cacheRoot, 'oxidizer-import-preview', `${timestampForPath()}-${process.pid}`);
  const previewRepositoryRoot = path.join(previewRoot, 'repository');
  const previewPipelineRoot = path.join(previewRepositoryRoot, 'pipeline');
  const previewToolRoot = path.join(previewPipelineRoot, 'tool');
  const previewInputRoot = path.join(previewPipelineRoot, 'input');
  ensureDir(previewToolRoot);
  fs.cpSync(inputRoot, previewInputRoot, { recursive: true });
  fs.copyFileSync(import.meta.filename, path.join(previewToolRoot, 'pipeline-tool.mjs'));
  try {
    runExternal(process.execPath, [
      path.join(previewToolRoot, 'pipeline-tool.mjs'),
      'build'
    ], { cwd: previewRepositoryRoot });
    const current = readJson(path.join(previewPipelineRoot, 'intermediate', '06-public-items.json'), null);
    if (!Array.isArray(current)) throw new Error('現行CSVから比較候補を生成できませんでした');
    for (const name of remoteCsvNames) {
      fs.copyFileSync(path.join(csvRoot, name), path.join(previewInputRoot, name));
    }
    runExternal(process.execPath, [
      path.join(previewToolRoot, 'pipeline-tool.mjs'),
      'build'
    ], { cwd: previewRepositoryRoot });
    const generated = readJson(path.join(previewPipelineRoot, 'intermediate', '06-public-items.json'), null);
    if (!Array.isArray(generated)) throw new Error('Oxidizer CSVから公開候補を生成できませんでした');
    const difference = compareItemCollections(current, generated);
    const candidateItems = [
      ...difference.added,
      ...difference.changed.map(entry => entry.after)
    ];
    return {
      checkedAt: nowIso(),
      manifest,
      currentCount: current.length,
      candidateCount: generated.length,
      addedCount: difference.added.length,
      removedCount: difference.removed.length,
      changedCount: difference.changed.length,
      added: difference.added.map(item => ({ ID: item.ID, Name: item.Name })),
      removed: difference.removed.map(item => ({ ID: item.ID, Name: item.Name })),
      changed: difference.changed.map(({ before, after, fields }) => ({
        ID: after.ID,
        Name: after.Name,
        BeforeName: before.Name,
        Fields: fields
      })),
      candidateItems,
      lodestonePreflight: null
    };
  } finally {
    fs.rmSync(previewRoot, { recursive: true, force: true });
  }
}

export function previewOxidizerImport({ source = '' } = {}) {
  const validation = validateOxidizerCsvRoot({ source });
  const report = makeOxidizerImportPreview(validation);
  const noDifference = report.addedCount === 0 && report.removedCount === 0 && report.changedCount === 0;
  writeJsonAtomic(oxidizerImportStatePath, {
    status: noDifference ? 'current' : 'previewed',
    ...report,
    lodestonePreflight: noDifference ? {
      checkedAt: nowIso(),
      manifest: report.manifest,
      total: 0,
      verified: 0,
      notFound: 0,
      dataFailed: 0,
      iconFailed: 0,
      results: []
    } : null
  });
  log(
    `Oxidizer CSV差分: 現行 ${report.currentCount}件、候補 ${report.candidateCount}件、` +
    `追加 ${report.addedCount}件、削除 ${report.removedCount}件、変更 ${report.changedCount}件`
  );
  log('実入力は変更していません。内容を確認後にOxidizer CSV反映を実行してください。');
  return report;
}

export async function verifyOxidizerLodestonePreview({
  source = '',
  delayMs = defaultLodestoneInfoDelayMs
} = {}) {
  const validation = validateOxidizerCsvRoot({ source });
  const preview = readJson(oxidizerImportStatePath, null);
  if (!preview || preview.status !== 'previewed' || !manifestsMatch(preview.manifest, validation.manifest)) {
    throw new Error('同じCSVに対する差分確認がありません。先にOxidizer CSV取り込み確認を実行してください。');
  }
  if (!Array.isArray(preview.candidateItems)) {
    throw new Error('Lodestone事前確認に必要な一時候補がありません。Oxidizer CSV取り込み確認をやり直してください。');
  }

  const items = preview.candidateItems.map(cloneJson);
  const itemUrls = readJson(lodestoneItemUrlsPath, {});
  const results = items.map(item => ({
    ID: String(item.ID),
    Name: String(item.Name || ''),
    status: 'unverified',
    pageVerified: false,
    dataVerified: false,
    iconVerified: false,
    detailUrl: '',
    iconUrl: '',
    info: null,
    error: ''
  }));
  lodestoneEtaStats = { fetch: 0, cache: 0, memory: 0 };
  lodestoneShopConditionCache = new Map();
  cancellationEnabled = true;
  log(`Oxidizer候補のLodestone事前確認を開始しました: ${items.length}件 delay=${delayMs}ms`);
  try {
    for (let index = 0; index < items.length; index += 1) {
      assertNotCancelled();
      const item = items[index];
      const row = results[index];
      try {
        const detail = await resolveLodestoneItemDetail(item, delayMs, { cache: true });
        row.pageVerified = true;
        row.detailUrl = detail.detailUrl;
        row.iconUrl = extractLodestoneNqIconUrl(detail.detailHtml);
        itemUrls[row.ID] = detail.detailUrl;
        log(`Lodestoneページ確認 ${index + 1}/${items.length}: ${row.ID} ${row.Name} found`);
      } catch (error) {
        row.status = String(error.message).includes('見つけられませんでした') ? 'not-found' : 'data-failed';
        row.error = error.message;
        log(`Lodestoneページ確認 ${index + 1}/${items.length}: ${row.ID} ${row.Name} ${row.status}: ${row.error}`);
      }
    }

    const recipeLookupMaps = lodestoneRecipeLookupMaps(itemUrls);
    for (let index = 0; index < items.length; index += 1) {
      assertNotCancelled();
      const item = items[index];
      const row = results[index];
      if (!row.pageVerified) continue;
      try {
        const info = await applyLodestoneInfoToItem(item, delayMs, recipeLookupMaps);
        row.dataVerified = true;
        row.detailUrl = info.detailUrl;
        row.iconUrl = info.iconUrl;
        row.info = {
          isEx: info.isEx,
          shopSales: info.shopSales,
          craftInfo: info.craftInfo,
          equipmentInfo: info.equipmentInfo,
          equipmentStats: info.equipmentStats,
          equipmentPerformance: info.equipmentPerformance
        };
      } catch (error) {
        row.status = 'data-failed';
        row.error = error.message;
      }

      try {
        if (!row.iconUrl) throw new Error('Lodestone詳細ページにNQアイコン画像がありません');
        const cachePath = path.join(lodestonePngIconCacheRoot, `${row.ID}.png`);
        const cached = readVerifiedLodestoneIconCache(item, cachePath);
        if (!cached) {
          ensureDir(lodestonePngIconCacheRoot);
          await sleep(delayMs);
          const response = await fetch(row.iconUrl, {
            headers: { 'user-agent': 'ffxiv-recipe-icon-pipeline/1.0' }
          });
          if (!response.ok) throw new Error(`Lodestone画像取得に失敗しました: HTTP ${response.status}`);
          const contentType = response.headers.get('content-type') || '';
          if (!contentType.includes('image/png')) {
            throw new Error(`Lodestone画像がPNGではありません: ${contentType || 'content-typeなし'}`);
          }
          writeBytesAtomic(cachePath, Buffer.from(await response.arrayBuffer()));
          writeIconCacheMeta(cachePath, {
            itemId: row.ID,
            itemName: row.Name,
            source: 'lodestone',
            reusedFromItemId: '',
            reusedFromName: '',
            detailUrl: row.detailUrl,
            detailItemName: row.Name,
            iconUrl: row.iconUrl,
            lodestoneError: ''
          });
        }
        row.iconVerified = true;
      } catch (error) {
        if (!row.error) row.error = error.message;
      }
      row.status = row.dataVerified
        ? (row.iconVerified ? 'verified' : 'icon-failed')
        : 'data-failed';
      log(`Lodestone事前確認 ${index + 1}/${items.length}: ${row.ID} ${row.Name} ${row.status}${row.error ? `: ${row.error}` : ''}`);
    }
  } finally {
    cancellationEnabled = false;
    lodestoneShopConditionCache?.clear();
    lodestoneShopConditionCache = null;
    if (lodestoneShopCacheStore) {
      try {
        lodestoneShopCacheStore.close();
      } finally {
        lodestoneShopCacheStore = null;
      }
    }
    lodestoneEtaStats = null;
  }

  writeJsonAtomic(lodestoneItemUrlsPath, itemUrls);
  const lodestonePreflight = {
    checkedAt: nowIso(),
    manifest: validation.manifest,
    total: results.length,
    verified: results.filter(row => row.status === 'verified').length,
    notFound: results.filter(row => row.status === 'not-found').length,
    dataFailed: results.filter(row => row.status === 'data-failed').length,
    iconFailed: results.filter(row => row.status === 'icon-failed').length,
    results
  };
  writeJsonAtomic(oxidizerImportStatePath, { ...preview, lodestonePreflight });
  log(
    `Lodestone事前確認完了: 確認済み ${lodestonePreflight.verified}件、` +
    `未掲載 ${lodestonePreflight.notFound}件、情報失敗 ${lodestonePreflight.dataFailed}件、` +
    `アイコン失敗 ${lodestonePreflight.iconFailed}件`
  );
  return lodestonePreflight;
}

export function importOxidizerCsv({ source = '' } = {}) {
  const validation = validateOxidizerCsvRoot({ source });
  const preview = readJson(oxidizerImportStatePath, null);
  const inputManifest = currentInputManifest();
  if (inputManifest && manifestsMatch(validation.manifest, inputManifest)) {
    writeJsonAtomic(oxidizerImportStatePath, {
      ...(preview || {}),
      status: 'imported',
      manifest: validation.manifest,
      importedAt: preview?.importedAt || nowIso(),
      alreadyCurrent: true
    });
    log('Oxidizer CSVは既にローカル入力へ反映済みです。再反映をスキップしました。');
    return { imported: [], alreadyCurrent: true, manifest: validation.manifest };
  }
  if (!preview || preview.status !== 'previewed' || !manifestsMatch(preview.manifest, validation.manifest)) {
    throw new Error('同じCSVに対する取り込み確認がありません。先にOxidizer CSV取り込み確認を実行してください。');
  }
  if (
    !preview.lodestonePreflight
    || !manifestsMatch(preview.lodestonePreflight.manifest, validation.manifest)
    || preview.lodestonePreflight.total !== preview.candidateItems?.length
  ) {
    throw new Error('同じCSVに対するLodestone事前確認がありません。差分画面でLodestone事前確認を実行してください。');
  }
  const backupRoot = path.join(cacheRoot, 'oxidizer-import-backups', `${timestampForPath()}-${process.pid}`);
  ensureDir(backupRoot);
  const applied = [];
  try {
    for (const name of remoteCsvNames) {
      const target = csvPath(name);
      if (fs.existsSync(target)) fs.copyFileSync(target, path.join(backupRoot, name));
      writeBytesAtomic(target, fs.readFileSync(path.join(validation.csvRoot, name)));
      applied.push(name);
    }
  } catch (error) {
    for (const name of applied) {
      const backup = path.join(backupRoot, name);
      if (fs.existsSync(backup)) writeBytesAtomic(csvPath(name), fs.readFileSync(backup));
    }
    throw error;
  }
  writeJsonAtomic(oxidizerImportStatePath, {
    ...preview,
    status: 'imported',
    importedAt: nowIso(),
    backupRoot: path.relative(repositoryRoot, backupRoot)
  });
  invalidateWorkflowAfterImport(validation.manifest);
  log(`Oxidizer CSVを反映しました: ${remoteCsvNames.join(', ')}`);
  log(`反映前CSVを保護しました: ${path.relative(repositoryRoot, backupRoot)}`);
  return { imported: remoteCsvNames, backupRoot, manifest: validation.manifest };
}

function readOxidizerRepositoryInfo(repository) {
  if (!repository || !fs.existsSync(repository)) return null;
  const rootResult = oxidizerGitOutput(['-C', repository, 'rev-parse', '--show-toplevel'], repository, { allowFailure: true });
  if (!rootResult.ok) return null;
  const root = rootResult.stdout;
  const commit = oxidizerGitOutput(['-C', root, 'rev-parse', 'HEAD'], root).stdout;
  const schemas = oxidizerGitOutput(['-C', root, 'submodule', 'status', '--', 'schemas'], root, { allowFailure: true });
  return {
    root,
    commit,
    schemas: schemas.ok ? schemas.stdout.replace(/^[+\- U]?/, '').split(/\s+/)[0] || '' : '',
    dirty: Boolean(oxidizerGitOutput(['-C', root, 'status', '--porcelain'], root).stdout)
  };
}

export function checkOxidizerEnvironment({ source = '', gamePath = '' } = {}) {
  const checks = {
    git: commandExists('git'),
    cargo: commandExists('cargo'),
    gamePath: Boolean(gamePath && fs.existsSync(path.resolve(gamePath))),
    source: null
  };
  if (source) checks.source = readOxidizerRepositoryInfo(path.resolve(source));
  log(`Git: ${checks.git ? '利用可能' : '見つかりません'}`);
  log(`Cargo: ${checks.cargo ? '利用可能' : '見つかりません'}`);
  log(`FF14インストール先: ${checks.gamePath ? '確認済み' : '未確認'}`);
  if (source) log(`Oxidizer: ${checks.source ? checks.source.root : 'Gitリポジトリではありません'}`);
  return checks;
}

export function checkOxidizerUpdates() {
  if (!commandExists('git')) throw new Error('Gitが見つかりません');
  const state = readJson(oxidizerStatePath, {});
  const result = oxidizerGitOutput(['ls-remote', oxidizerRepositoryUrl, 'HEAD']);
  const remoteCommit = result.stdout.split(/\s+/)[0] || '';
  if (!/^[0-9a-f]{40}$/i.test(remoteCommit)) throw new Error('Oxidizerの最新コミットを確認できませんでした');
  const updateAvailable = !state.oxidizerCommit || state.oxidizerCommit !== remoteCommit;
  const next = {
    ...state,
    checkedAt: nowIso(),
    remoteCommit,
    updateAvailable
  };
  writeJsonAtomic(oxidizerStatePath, next);
  log(`Oxidizer更新: ${updateAvailable ? '更新あり' : '更新なし'} remote=${remoteCommit.slice(0, 12)} current=${String(state.oxidizerCommit || '未生成').slice(0, 12)}`);
  return next;
}

export function refreshOxidizerData({ gamePath = '', force = false } = {}) {
  if (!commandExists('git')) throw new Error('Gitが見つかりません');
  if (!commandExists('cargo')) throw new Error('Cargoが見つかりません');
  const resolvedGamePath = path.resolve(String(gamePath || ''));
  if (!gamePath || !fs.existsSync(resolvedGamePath)) throw new Error('FF14インストール先が見つかりません');
  const update = checkOxidizerUpdates();
  const state = readJson(oxidizerStatePath, {});
  if (!force && !update.updateAvailable && state.latestOutputRoot && fs.existsSync(state.latestOutputRoot)) {
    log('Oxidizerに更新がなく、生成済みCSVがあるため再生成を省略しました');
    return { ...state, skipped: true };
  }
  const runRoot = path.join(cacheRoot, 'oxidizer-managed', `${timestampForPath()}-${process.pid}`);
  const checkoutRoot = path.join(runRoot, 'repository');
  ensureDir(runRoot);
  runExternal('git', ['clone', '--recurse-submodules', oxidizerRepositoryUrl, checkoutRoot]);
  const info = readOxidizerRepositoryInfo(checkoutRoot);
  if (!info) throw new Error('取得したOxidizerリポジトリを確認できません');
  runExternal('cargo', ['run', '--release', '--', resolvedGamePath], { cwd: checkoutRoot });
  const csvRoot = resolveOxidizerCsvRoot(path.join(checkoutRoot, 'output', 'ja'));
  const validation = validateOxidizerCsvRoot({ source: csvRoot });
  const next = {
    checkedAt: update.checkedAt,
    generatedAt: nowIso(),
    repositoryUrl: oxidizerRepositoryUrl,
    oxidizerCommit: info.commit,
    schemasCommit: info.schemas,
    latestRepositoryRoot: checkoutRoot,
    latestOutputRoot: csvRoot,
    manifest: validation.manifest,
    updateAvailable: false
  };
  writeJsonAtomic(oxidizerStatePath, next);
  log(`OXIDIZER_OUTPUT_ROOT ${csvRoot}`);
  log(`Oxidizer全CSV再生成が完了しました: ${csvRoot}`);
  return next;
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

export function itemIconNameHash(itemName) {
  const name = String(itemName || '');
  if (!name) throw new Error('アイテム画像の命名にはアイテム名が必要です');
  return crypto.createHash('sha256').update(name, 'utf8').digest('hex').slice(0, 20);
}

export function itemIconFileName(itemName, webpBytes) {
  const bytes = Buffer.isBuffer(webpBytes) ? webpBytes : Buffer.from(webpBytes || []);
  if (bytes.length === 0) throw new Error(`アイテム画像が空です: ${itemName}`);
  const contentHash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  return `${itemIconNameHash(itemName)}-${contentHash}.webp`;
}

export function validateItemIconFileName(itemName, iconFile, webpBytes) {
  if (!/^[0-9a-f]{20}-[0-9a-f]{12}\.webp$/.test(String(iconFile || ''))) return false;
  return itemIconFileName(itemName, webpBytes) === iconFile;
}

function manualItemIconPath(itemName, root = manualItemIconsRoot) {
  return path.join(root, `${itemIconNameHash(itemName)}.webp`);
}

function iconPaths(iconFile, root = itemIconsRoot) {
  const webpName = iconFile.replace(/\.[^.]+$/, '.webp');
  const pngName = iconFile.replace(/\.[^.]+$/, '.png');
  const folder = webpName.slice(0, 3);
  return {
    webpName,
    pngName,
    webpPath: path.join(root, folder, webpName),
    pngPath: path.join(root, folder, pngName)
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

function lodestoneCacheKey(url) {
  return crypto.createHash('sha256').update(url).digest('hex');
}

function getLodestoneShopCacheStore() {
  if (!lodestoneShopCacheStore) lodestoneShopCacheStore = openLodestoneShopCacheStore();
  return lodestoneShopCacheStore;
}

async function fetchCachedLodestoneText(url, delayMs) {
  assertNotCancelled();
  const key = lodestoneCacheKey(url);
  const store = getLodestoneShopCacheStore();
  const legacy = path.join(lodestoneShopCacheRoot, `${key}.html`);
  const cached = store.get.get(key);
  if (cached) {
    try {
      const text = decompressLodestoneHtml(cached);
      if (lodestoneEtaStats) lodestoneEtaStats.cache += 1;
      return text;
    } catch (error) {
      log(`Lodestone SQLiteキャッシュ破損: ${key}: ${error.message}`);
      store.remove.run(key);
    }
  }
  if (fs.existsSync(legacy)) {
    if (lodestoneEtaStats) lodestoneEtaStats.cache += 1;
    return fs.readFileSync(legacy, 'utf8');
  }
  if (lodestoneEtaStats) lodestoneEtaStats.fetch += 1;
  const text = await fetchLodestoneText(url, delayMs);
  try {
    writeLodestoneShopCacheEntry(store, key, text, { url });
  } catch (error) {
    log(`Lodestone SQLiteキャッシュ保存をスキップしました: ${error.message}`);
  }
  return text;
}

export function migrateLodestoneShopCache({
  root = lodestoneShopCacheRoot,
  databasePath = lodestoneShopCacheDatabasePath,
  dryRun = false,
  keepHtml = false,
  limit = Number.POSITIVE_INFINITY,
  batchSize = 100
} = {}) {
  ensureDir(root);
  const legacyFiles = fs.readdirSync(root)
    .filter(name => /^[a-f0-9]{64}\.html$/.test(name))
    .sort()
    .slice(0, Number.isFinite(limit) ? Math.max(0, limit) : undefined);
  const result = {
    candidates: legacyFiles.length,
    converted: 0,
    reused: 0,
    removed: 0,
    failed: 0,
    legacyBytes: 0,
    databaseBytes: 0,
    databaseRows: 0,
    quickCheck: '',
    errors: []
  };
  if (dryRun) {
    for (const name of legacyFiles) result.legacyBytes += fs.statSync(path.join(root, name)).size;
    return result;
  }
  const store = openLodestoneShopCacheStore(databasePath);
  try {
    const size = Math.max(1, Number(batchSize) || 1);
    for (let offset = 0; offset < legacyFiles.length; offset += size) {
      assertNotCancelled();
      const batch = [];
      for (const name of legacyFiles.slice(offset, offset + size)) {
        const legacy = path.join(root, name);
        const source = fs.readFileSync(legacy);
        result.legacyBytes += source.length;
        try {
          const key = name.slice(0, 64);
          let reusable = false;
          try {
            reusable = Buffer.from(readLodestoneShopCacheEntry(store, key) || '', 'utf8').equals(source);
          } catch {
            reusable = false;
          }
          const entry = reusable ? null : compressLodestoneHtml(source.toString('utf8'));
          batch.push({ name, legacy, key, source, entry });
          if (reusable) result.reused += 1;
        } catch (error) {
          result.failed += 1;
          if (result.errors.length < 20) result.errors.push(`${name}: ${error.message}`);
        }
      }
      const writes = batch.filter(row => row.entry);
      if (writes.length) {
        store.db.exec('BEGIN IMMEDIATE');
        try {
          for (const row of writes) {
            store.put.run(row.key, null, row.entry.body, row.entry.rawBytes, row.entry.sha256, Date.now());
          }
          store.db.exec('COMMIT');
          result.converted += writes.length;
        } catch (error) {
          store.db.exec('ROLLBACK');
          throw error;
        }
      }
      for (const row of batch) {
        try {
          const verified = Buffer.from(readLodestoneShopCacheEntry(store, row.key), 'utf8');
          if (!verified.equals(row.source)) throw new Error('DB格納後のHTMLが元ファイルと一致しません');
          if (!keepHtml) {
            fs.rmSync(row.legacy);
            result.removed += 1;
          }
        } catch (error) {
          result.failed += 1;
          if (result.errors.length < 20) result.errors.push(`${row.name}: ${error.message}`);
        }
      }
      const completed = Math.min(offset + size, legacyFiles.length);
      if (legacyFiles.length >= 1000 && (completed % 1000 === 0 || completed === legacyFiles.length)) {
        log(`Lodestoneキャッシュ移行中: ${completed}/${legacyFiles.length}件`);
      }
    }
    result.databaseRows = Number(store.count.get().count);
    result.quickCheck = String(store.db.prepare('PRAGMA quick_check').get().quick_check || '');
    if (result.quickCheck !== 'ok') throw new Error(`SQLite quick_checkに失敗しました: ${result.quickCheck}`);
  } finally {
    store.close();
  }
  if (fs.existsSync(databasePath)) result.databaseBytes = fs.statSync(databasePath).size;
  if (!keepHtml && fs.existsSync(root) && fs.readdirSync(root).length === 0) fs.rmdirSync(root);
  return result;
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

export function extractLodestoneIsEx(detailHtml) {
  const source = String(detailHtml || '');
  const headerMatch = source.match(
    /<div\b[^>]*class=["'][^"']*\bdb-view__item__header\b[^"']*["'][^>]*>/i
  );
  if (!headerMatch || headerMatch.index == null) return null;
  const headerStart = headerMatch.index;
  const nameEnd = source.indexOf('</h2>', headerStart + headerMatch[0].length);
  if (nameEnd < 0) return null;
  const headerEnd = nameEnd + '</h2>'.length;
  const headerHtml = source.slice(headerStart, headerEnd);
  return /<span\b[^>]*class=["'][^"']*\bex_bind\b[^"']*["'][^>]*>\s*EX\s*<\/span>/i.test(headerHtml);
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

export async function resolveLodestoneShopCondition(
  shopId,
  loadHtml,
  { cache = null, maxEntries = lodestoneShopConditionCacheMaxEntries } = {}
) {
  if (cache?.has(shopId)) {
    return { conditional: cache.get(shopId), memoryHit: true, cacheError: false };
  }
  const conditional = isConditionalLodestoneShop(await loadHtml());
  let cacheError = false;
  if (cache && cache.size < maxEntries) {
    try {
      cache.set(shopId, conditional);
    } catch {
      cacheError = true;
    }
  }
  return { conditional, memoryHit: false, cacheError };
}

const lodestoneEquipmentPerformanceLabels = {
  '物理基本性能': 'physicalDamage',
  '魔法基本性能': 'magicalDamage',
  '物理防御力': 'physicalDefense',
  '魔法防御力': 'magicalDefense'
};

function extractLodestoneEquipmentPerformance(detailHtml) {
  const performance = Object.fromEntries(
    Object.values(lodestoneEquipmentPerformanceLabels).map(name => [name, 0])
  );
  const html = String(detailHtml || '');
  const specIndex = html.indexOf('db-view__item_spec');
  const nqIndex = specIndex >= 0 ? html.indexOf('sys_nq_element', specIndex) : -1;
  if (specIndex < 0 || nqIndex < 0) return performance;

  const hqIndex = html.indexOf('sys_hq_element', nqIndex);
  const valueEnd = hqIndex >= 0 ? hqIndex : Math.min(html.length, nqIndex + 4000);
  const labels = [...html.slice(specIndex, nqIndex).matchAll(
    /<div\b[^>]*class=["'][^"']*db-view__item_spec__name[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi
  )].map(match => normalizeHtmlText(match[1]));
  const values = [...html.slice(nqIndex, valueEnd).matchAll(/<strong\b[^>]*>([0-9,]+)<\/strong>/gi)]
    .map(match => Number(match[1].replace(/,/g, '')));

  labels.forEach((label, index) => {
    const key = lodestoneEquipmentPerformanceLabels[label];
    if (key && Number.isFinite(values[index])) performance[key] = values[index];
  });
  return performance;
}

function extractLodestoneEquipmentStats(detailHtml, specText) {
  const stats = Object.fromEntries(lodestoneEquipmentStatNames.map(name => [name, 0]));
  const html = String(detailHtml || '');
  const bonusListMatch = html.match(
    /<h3\b[^>]*>\s*Bonuses\s*<\/h3>[\s\S]*?<ul\b[^>]*class=["'][^"']*db-view__basic_bonus[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i
  );
  if (bonusListMatch) {
    for (const match of bonusListMatch[1].matchAll(
      /<li\b[^>]*>\s*<span\b[^>]*>([\s\S]*?)<\/span>\s*\+\s*([0-9,]+)/gi
    )) {
      const name = normalizeHtmlText(match[1]);
      const value = Number(match[2].replace(/,/g, ''));
      if (name && Number.isSafeInteger(value)) stats[name] = value;
    }
    return stats;
  }

  const bonusText = String(specText || '').split(/\s+Bonuses\s+/)[1]?.split(
    /\s+(?:Materia|Craft & Repair|修理レベル|マテリア|SHOP販売:)/
  )[0] || '';
  for (const match of bonusText.matchAll(/(?:^|\s)([^\d+]+?)\s*\+\s*([0-9,]+)/gu)) {
    const name = match[1].trim();
    const value = Number(match[2].replace(/,/g, ''));
    if (name && Number.isSafeInteger(value)) stats[name] = value;
  }
  return stats;
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
  info.statsVersion = lodestoneEquipmentStatsVersion;
  info.stats = extractLodestoneEquipmentStats(detailHtml, specText);
  info.performance = extractLodestoneEquipmentPerformance(detailHtml);
  return info;
}

function equipmentPrimaryStats(equipmentInfo = {}) {
  const stats = equipmentInfo.stats || {};
  return lodestonePrimaryStatNames.map(stat => ({
    stat,
    value: Number(stats[stat] || 0)
  }));
}

function uniqueRoleCodes(roles) {
  const roleSet = new Set(roles);
  return equipmentRoleCodes.filter(role => roleSet.has(role));
}

function equipmentBroadRoleCandidates(equipmentInfo = {}) {
  const jobs = Array.isArray(equipmentInfo.jobs) ? equipmentInfo.jobs : [];
  return uniqueRoleCodes(jobs.flatMap(job => equipmentBroadJobRoles[job] || []));
}

function equipmentRoleByName(name, candidates = equipmentRoleCodes) {
  const text = String(name || '');
  for (const rule of equipmentNameRoleRules) {
    if (candidates.includes(rule.role) && rule.pattern.test(text)) return rule.role;
  }
  return '';
}

function equipmentAggregateRoleByStats(equipmentInfo = {}, candidates = equipmentRoleCodes) {
  const stats = equipmentInfo.stats || {};
  const vit = Number(stats.VIT || 0);
  const physical = ['STR', 'DEX'].map(stat => Number(stats[stat] || 0)).filter(value => value > 0);
  const magical = ['INT', 'MND'].map(stat => Number(stats[stat] || 0)).filter(value => value > 0);
  const physicalMatches = vit > 0
    ? physical.length > 0 && physical.every(value => value === vit)
    : physical.length === 2 && physical[0] === physical[1];
  const magicalMatches = vit > 0
    ? magical.length > 0 && magical.every(value => value === vit)
    : magical.length === 2 && magical[0] === magical[1];
  if (physicalMatches && !magical.length
    && candidates.some(role => ['tank', 'striker_slayer', 'scout_ranger'].includes(role))) return 'fighter';
  if (magicalMatches && !physical.length
    && candidates.some(role => ['healer', 'caster'].includes(role))) return 'sorcerer';
  return '';
}

function statRolesWithinCandidates(stats, candidates) {
  return uniqueRoleCodes(stats
    .filter(entry => entry.value > 0)
    .map(entry => equipmentRoleByStat[entry.stat])
    .filter(role => candidates.includes(role)));
}

function equipmentRoleCandidatesByStats(equipmentInfo = {}, candidates = equipmentRoleCodes) {
  const stats = equipmentPrimaryStats(equipmentInfo);
  const positive = stats.filter(entry => entry.value > 0);
  if (!positive.length) return [];

  const maxValue = Math.max(...positive.map(entry => entry.value));
  const topStats = positive.filter(entry => entry.value === maxValue);
  const topRoles = statRolesWithinCandidates(topStats, candidates);
  if (topRoles.length === 1 && topRoles[0] !== 'tank') return topRoles;
  if (topRoles.length > 1 && !topRoles.includes('tank')) return topRoles;

  const lowerValues = [...new Set(positive.map(entry => entry.value).filter(value => value < maxValue))]
    .sort((a, b) => b - a);
  if (topRoles.includes('tank') && lowerValues.length) {
    const secondStats = positive.filter(entry => entry.value === lowerValues[0]);
    const secondRoles = statRolesWithinCandidates(secondStats, candidates)
      .filter(role => role !== 'tank');
    if (secondRoles.length) {
      const keepTank = secondRoles.includes('striker_slayer');
      return uniqueRoleCodes([...(keepTank ? ['tank'] : []), ...secondRoles]);
    }
  }
  return topRoles;
}

export function equipmentRoleDecision(item) {
  const equipmentInfo = item?.EquipmentInfo;
  if (!equipmentInfo) return { status: 'excluded', candidates: [], reason: 'no-equipment-info' };

  let candidates = equipmentBroadRoleCandidates(equipmentInfo);
  if (!candidates.length) return { status: 'excluded', candidates: [], reason: 'not-broad-equipment' };

  const roleStatCandidates = [];
  if (Number(equipmentInfo?.stats?.['不屈'] || 0) > 0 && candidates.includes('tank')) roleStatCandidates.push('tank');
  if (Number(equipmentInfo?.stats?.['信仰'] || 0) > 0 && candidates.includes('healer')) roleStatCandidates.push('healer');
  if (roleStatCandidates.length === 1) {
    return { status: 'resolved', role: roleStatCandidates[0], candidates: roleStatCandidates, reason: 'role-stat' };
  }
  if (roleStatCandidates.length > 1) {
    return { status: 'unresolved', candidates: uniqueRoleCodes(roleStatCandidates), reason: 'role-stat' };
  }

  const speedCandidates = [];
  let speedRestricted = false;
  if (Number(equipmentInfo?.stats?.['スキルスピード'] || 0) > 0) {
    speedCandidates.push('tank', 'striker_slayer', 'scout_ranger');
  }
  if (Number(equipmentInfo?.stats?.['スペルスピード'] || 0) > 0) {
    speedCandidates.push('healer', 'caster');
  }
  if (speedCandidates.length) {
    candidates = candidates.filter(role => speedCandidates.includes(role));
    speedRestricted = true;
    if (candidates.length === 1) {
      return { status: 'resolved', role: candidates[0], candidates, reason: 'speed-stat' };
    }
  }

  const stats = equipmentPrimaryStats(equipmentInfo);
  if (!stats.some(entry => entry.value > 0)) {
    return { status: 'excluded', candidates: [], reason: 'no-primary-stats' };
  }

  const nameRole = equipmentRoleByName(item?.Name, candidates);
  if (nameRole) return { status: 'resolved', role: nameRole, candidates, reason: 'name' };

  const aggregateRole = equipmentAggregateRoleByStats(equipmentInfo, candidates);
  if (aggregateRole) return { status: 'resolved', role: aggregateRole, candidates, reason: 'aggregate-stats' };

  const statCandidates = equipmentRoleCandidatesByStats(equipmentInfo, candidates);
  if (statCandidates.length === 1) {
    return { status: 'resolved', role: statCandidates[0], candidates: statCandidates, reason: 'stats' };
  }
  if (statCandidates.length > 1) {
    return { status: 'unresolved', candidates: statCandidates, reason: 'stats' };
  }
  return { status: 'unresolved', candidates, reason: speedRestricted ? 'speed-stat' : 'unknown' };
}

function equipmentCommonToken(name) {
  const text = String(name || '').trim();
  const parenthesized = text.match(/^(.+?)[（(]([^）)]+)[）)]$/u);
  if (parenthesized) return `${parenthesized[1]}(${parenthesized[2]})`;
  const withoutSuffix = text
    .replace(/・オブ・.+$/u, '')
    .replace(/・(リング|チョーカー|ネックレス|ブレスレット|バングル|イヤリング|ピアス|リストレット|リストバンド|アルミラ|ゴルゲット|イヤーカフス|イヤースクリュー)$/u, '')
    .replace(/(リング|チョーカー|ネックレス|ブレスレット|バングル|イヤリング|ピアス|リストレット|リストバンド|アルミラ|ゴルゲット|イヤーカフス|イヤースクリュー)$/u, '');
  return withoutSuffix || text;
}

function equipmentStatSignature(equipmentInfo = {}) {
  const stats = equipmentInfo.stats || {};
  const knownOrder = new Map(lodestoneEquipmentStatNames.map((name, index) => [name, index]));
  return Object.entries(stats)
    .filter(([, value]) => Number(value) > 0)
    .sort(([a], [b]) => (knownOrder.get(a) ?? 999) - (knownOrder.get(b) ?? 999) || a.localeCompare(b, 'ja'))
    .map(([name, value]) => `${name}=${Number(value)}`)
    .join(',');
}

function equipmentSelectableRoles(candidates) {
  const roles = uniqueRoleCodes(candidates);
  const selectable = [...roles];
  if (roles.filter(role => ['tank', 'striker_slayer', 'scout_ranger'].includes(role)).length >= 2) {
    selectable.push('fighter');
  }
  if (roles.filter(role => ['healer', 'caster'].includes(role)).length >= 2) {
    selectable.push('sorcerer');
  }
  return equipmentOverrideRoleCodes.filter(role => selectable.includes(role));
}

export function findUnresolvedEquipmentRoleGroups(items) {
  const groups = new Map();
  for (const item of items || []) {
    const decision = equipmentRoleDecision(item);
    if (decision.status !== 'unresolved') continue;
    const equipLevel = Number(item?.EquipmentInfo?.equipLevel || 0);
    const itemLevel = Number(item?.EquipmentInfo?.itemLevel || 0);
    const commonToken = equipmentCommonToken(item?.Name);
    const statSignature = equipmentStatSignature(item?.EquipmentInfo);
    const key = `${equipLevel}:${itemLevel}:${commonToken}:${statSignature}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        equipLevel,
        itemLevel,
        commonToken,
        statSignature,
        candidates: [...decision.candidates],
        items: []
      });
    } else {
      groups.get(key).candidates = groups.get(key).candidates.filter(role => decision.candidates.includes(role));
    }
    groups.get(key).items.push({
      id: item.ID,
      name: item.Name,
      category: item.ItemUICategoryName || '',
      iconFile: item.IconFile || '',
      stats: { ...(item?.EquipmentInfo?.stats || {}) },
      candidates: [...decision.candidates]
    });
  }
  for (const group of groups.values()) {
    if (group.items.length === 1) {
      group.commonToken = group.items[0].name;
      group.key = `${group.equipLevel}:${group.itemLevel}:${group.commonToken}:${group.statSignature}`;
    }
    group.candidates = equipmentSelectableRoles(group.candidates);
  }
  return [...groups.values()].filter(group => group.candidates.length).sort((a, b) =>
    a.equipLevel - b.equipLevel
    || a.itemLevel - b.itemLevel
    || a.commonToken.localeCompare(b.commonToken, 'ja')
    || a.key.localeCompare(b.key)
  );
}

export function applyEquipmentRoleOverrides(items, overrides = readJson(equipmentRoleOverridesPath, {})) {
  const groups = findUnresolvedEquipmentRoleGroups(items);
  const byId = new Map((items || []).map(item => [String(item.ID), item]));
  let automatic = 0;
  let applied = 0;
  let missing = 0;
  for (const item of items || []) {
    if (!item?.EquipmentInfo) continue;
    const decision = equipmentRoleDecision(item);
    if (decision.status === 'resolved') {
      item.EquipmentInfo.recommendedRole = decision.role;
      automatic += 1;
    } else {
      delete item.EquipmentInfo.recommendedRole;
    }
  }
  for (const group of groups) {
    const role = String(overrides?.[group.key] || '');
    if (!equipmentOverrideRoleCodes.includes(role) || !group.candidates.includes(role)) {
      missing += 1;
      continue;
    }
    for (const entry of group.items) {
      const item = byId.get(String(entry.id));
      if (!item?.EquipmentInfo) continue;
      item.EquipmentInfo.recommendedRole = role;
      applied += 1;
    }
  }
  return { groups: groups.length, automatic, applied, missing };
}

export function equipmentRoleGroupsForGui({
  itemJsonPath = publicCandidatePath,
  overrides = readJson(equipmentRoleOverridesPath, {}),
  urls = readJson(lodestoneItemUrlsPath, {})
} = {}) {
  const items = readJson(itemJsonPath, []);
  return findUnresolvedEquipmentRoleGroups(items).map(group => ({
    ...group,
    selectedRole: equipmentOverrideRoleCodes.includes(overrides?.[group.key]) ? overrides[group.key] : '',
    items: group.items.map(item => ({
      ...item,
      lodestoneUrl: urls?.[String(item.id)] || ''
    }))
  }));
}

export function equipmentRoleSummary({
  itemJsonPath = publicCandidatePath,
  overrides = readJson(equipmentRoleOverridesPath, {})
} = {}) {
  const groups = findUnresolvedEquipmentRoleGroups(readJson(itemJsonPath, []));
  const selected = groups.filter(group => equipmentOverrideRoleCodes.includes(overrides?.[group.key])).length;
  return { total: groups.length, selected, unselected: groups.length - selected };
}

export async function cacheLodestoneRecipeDetails(recipes, {
  fetchText = (url, delayMs) => fetchCachedLodestoneText(url, delayMs),
  delayMs = defaultLodestoneInfoDelayMs,
  onProgress = () => {}
} = {}) {
  if (!Array.isArray(recipes)) throw new TypeError('Lodestoneレシピ詳細取得にはレシピ配列が必要です');
  for (const [index, recipe] of recipes.entries()) {
    assertNotCancelled();
    if (!recipe?.DetailPath) throw new Error(`Lodestoneレシピ詳細パスがありません: ${index + 1}`);
    await fetchText(`${LODESTONE_BASE_URL}${recipe.DetailPath}`, delayMs);
    onProgress({ completed: index + 1, total: recipes.length, recipe });
  }
  return { total: recipes.length };
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

export async function refreshLodestoneSourceSnapshot({
  delayMs = defaultLodestoneInfoDelayMs,
  target = lodestoneSourceSnapshotPath
} = {}) {
  clearCancelRequest();
  cancellationEnabled = true;
  try {
  const delay = Math.max(0, Number(delayMs) || 0);
  const requestSequentially = createSequentialRequestQueue({
    delayMs: delay,
    request: ({ url, fresh = false }) => fresh ? fetchLodestoneText(url, 0) : fetchCachedLodestoneText(url, 0)
  });
  const fetchSequentially = url => requestSequentially({ url });
  const previous = readJson(target, null);
  log(`Lodestone全一覧の逐次取得を開始します: 間隔 ${delay}ms`);
  const firstItemHtml = await requestSequentially({ url: LODESTONE_ITEM_LIST_URL, fresh: true });
  const itemMeta = extractLodestoneListMeta(firstItemHtml);
  const canReuseItemOrder = previous?.Version === itemMeta.version
    && previous?.ItemCount === itemMeta.total
    && Array.isArray(previous?.Items)
    && previous.Items.length === itemMeta.total
    && typeof previous?.ItemOrderSignature === 'string'
    && previous.ItemOrderSignature.length === 64;
  const items = canReuseItemOrder
    ? { ...itemMeta, entries: previous.Items }
    : await crawlLodestoneList({
        baseUrl: LODESTONE_ITEM_LIST_URL,
        extractEntries: extractLodestoneItemList,
        fetchText: fetchSequentially,
        firstHtml: firstItemHtml,
        onPage: ({ page, pages }) => {
          if (page === 1 || page === pages || page % 25 === 0) log(`アイテム一覧 ${page}/${pages}`);
        }
      });
  if (canReuseItemOrder) log(`アイテム並び順キャッシュを再利用します: Version=${itemMeta.version} item=${itemMeta.total}`);
  else log('Versionまたは総アイテム数が変化したため、アイテム並び順を全ページから更新しました');
  const firstRecipeHtml = await requestSequentially({ url: LODESTONE_RECIPE_LIST_URL, fresh: true });
  const recipes = await crawlLodestoneList({
    baseUrl: LODESTONE_RECIPE_LIST_URL,
    extractEntries: extractLodestoneRecipeList,
    fetchText: fetchSequentially,
    firstHtml: firstRecipeHtml,
    onPage: ({ page, pages }) => {
      if (page === 1 || page === pages || page % 25 === 0) log(`製作手帳一覧 ${page}/${pages}`);
    }
  });
  log(`Lodestoneレシピ詳細を確認します: ${recipes.entries.length}件`);
  await cacheLodestoneRecipeDetails(recipes.entries, {
    delayMs: delay,
    onProgress: ({ completed, total }) => {
      if (completed % 100 === 0 || completed === total) log(`レシピ詳細 ${completed}/${total}`);
    }
  });
  if (items.version !== recipes.version) {
    throw new Error(`LodestoneのVersionが一覧間で一致しません: item=${items.version} recipe=${recipes.version}`);
  }
  const orderedItems = canReuseItemOrder ? items.entries : applyDescendingSortOrder(items.entries, items.total);
  const duplicateNames = [...orderedItems.reduce((counts, item) => counts.set(item.Name, (counts.get(item.Name) || 0) + 1), new Map())]
    .filter(([, count]) => count > 1)
    .map(([name, count]) => ({ name, count }));
  if (duplicateNames.length > 0) {
    throw new Error(`Lodestoneアイテム名が一意ではありません: ${duplicateNames.slice(0, 10).map(row => `${row.name}(${row.count})`).join('、')}`);
  }
  const snapshot = {
    SchemaVersion: 1,
    CheckedAt: nowIso(),
    Version: items.version,
    ItemCount: items.total,
    RecipeCount: recipes.total,
    ItemOrderSignature: canReuseItemOrder ? previous.ItemOrderSignature : lodestoneOrderSignature(orderedItems),
    Items: orderedItems,
    Recipes: recipes.entries
  };
  writeJsonAtomic(target, snapshot);
  log(`Lodestone全一覧を保存しました: item=${snapshot.ItemCount} recipe=${snapshot.RecipeCount} Version=${snapshot.Version}`);
  return snapshot;
  } finally {
    cancellationEnabled = false;
    if (lodestoneShopCacheStore) {
      try {
        lodestoneShopCacheStore.close();
      } finally {
        lodestoneShopCacheStore = null;
      }
    }
  }
}

export function extractLodestoneCraftInfo(recipeHtml) {
  const text = normalizeHtmlText(recipeHtml);
  const jobMatch = text.match(/(木工師|鍛冶師|甲冑師|彫金師|革細工師|裁縫師|錬金術師|調理師)\s+Lv\s*([0-9]+)/);
  if (!jobMatch) return null;
  const info = {
    job: jobMatch[1],
    level: Number(jobMatch[2])
  };
  const masterbookMatch = String(recipeHtml || '').match(
    /<p\b[^>]*class=["'][^"']*\bdb-view__recipe__text__book_name\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i
  );
  if (masterbookMatch) info.masterbook = normalizeHtmlText(masterbookMatch[1]);
  return info;
}

function htmlTagAttributes(tag) {
  return Object.fromEntries(
    [...String(tag || '').matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)].map(([, name, , value]) => [
      name.toLowerCase(),
      decodeHtml(value)
    ])
  );
}

export function extractLodestoneRecipeData(
  recipePath,
  recipeHtml,
  { craftTypeByJob = new Map(), itemIdByLodestoneKey = new Map() } = {}
) {
  const recipeId = String(recipePath || '').match(/\/recipe\/([a-z0-9]+)\//)?.[1] || '';
  if (!recipeId) throw new Error('LodestoneレシピURLからRecipeIDを取得できません');

  const craftInfo = extractLodestoneCraftInfo(recipeHtml);
  if (!craftInfo) throw new Error(`Lodestoneレシピ ${recipeId} から製作ジョブとレベルを取得できません`);
  const craftType = craftTypeByJob.get(craftInfo.job);
  if (craftType === undefined) throw new Error(`Lodestoneレシピ ${recipeId} の製作ジョブが固定マスターにありません: ${craftInfo.job}`);

  const amountMatch = String(recipeHtml || '').match(
    /<span\b[^>]*class=(["'])[^"']*\bjs__complete_craft_count\b[^"']*\1[^>]*>([\s\S]*?)<\/span>/i
  );
  const amountResult = Number(normalizeHtmlText(amountMatch?.[2]));
  if (!Number.isInteger(amountResult) || amountResult <= 0) {
    throw new Error(`Lodestoneレシピ ${recipeId} から完成個数を取得できません`);
  }

  const materialTags = [...String(recipeHtml || '').matchAll(/<div\b[^>]*>/gi)];
  const ingredients = materialTags
    .map(match => htmlTagAttributes(match[0]))
    .filter(attributes => {
      const classes = String(attributes.class || '').split(/\s+/);
      return classes.includes('js__material') && classes.includes('db-tree');
    })
    .filter(attributes => Number(attributes['data-depth']) === 1)
    .map(attributes => {
      const lodestoneKey = attributes['data-key'] || '';
      const itemId = itemIdByLodestoneKey.get(lodestoneKey);
      const name = normalizeLodestoneItemName(attributes['data-name']);
      const amount = Number(attributes['data-num']);
      if (!name || !Number.isInteger(amount) || amount <= 0) {
        throw new Error(`Lodestoneレシピ ${recipeId} の素材情報が不正です: ${name || lodestoneKey}`);
      }
      return {
        ...(itemId ? { ItemID: String(itemId) } : {}),
        Name: name,
        Amount: String(amount)
      };
    });
  if (ingredients.length === 0) throw new Error(`Lodestoneレシピ ${recipeId} から直接素材を取得できません`);

  return {
    RecipeID: recipeId,
    CraftType: String(craftType),
    CraftInfo: craftInfo,
    AmountResult: String(amountResult),
    Ingredients: ingredients
  };
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

async function getProductionIconPng(item, pngName, delayMs, alternatives = [], {
  allowXivapi = true,
  preferredSource = 'lodestone'
} = {}) {
  const cachePath = path.join(lodestonePngIconCacheRoot, `${item.ID}.png`);
  const verifiedCache = readVerifiedLodestoneIconCache(item, cachePath);
  if (verifiedCache) return verifiedCache;
  ensureDir(lodestonePngIconCacheRoot);
  const lodestoneErrors = [];
  if (preferredSource === 'xivapi') {
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
      lodestoneError: '公開例外マスターでXIVAPIを指定'
    });
    return { path: cachePath, source: 'xivapi', lodestoneError: '', iconUrl: xivapi.iconUrl };
  }
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
  if (!allowXivapi) {
    throw new Error(`Lodestone失敗: ${lodestoneErrors.join(' / ')} / XIVAPI代替は公開判定で許可されていません`);
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

async function webpBytesFromPng(pngPath, quality, size = 80) {
  return sharp(pngPath)
    .resize(size, size, {
      fit: 'contain',
      kernel: sharp.kernel.lanczos3,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .webp({ quality })
    .toBuffer();
}

async function writeWebpFromPng(pngPath, webpPath, quality, size = 80) {
  ensureDir(path.dirname(webpPath));
  writeBytesAtomic(webpPath, await webpBytesFromPng(pngPath, quality, size));
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
  const decisions = normalizePublicationDecisions();
  const currentPublicIds = new Set(readJson(publicItemJsonPath, []).map(item => String(item.ID)));
  const appliesPublicationGate = sourceItemJsonPath === publicCandidatePath;
  const iconCandidates = items.filter(item => item?.ID && item?.Name && item?.IconFile);
  const iconItems = iconCandidates.filter(item => {
    if (!appliesPublicationGate) return true;
    const decision = decisions.items[String(item.ID)];
    if (decision?.decision === 'exclude' || decision?.decision === 'hold') return false;
    return currentPublicIds.has(String(item.ID))
      || decision?.decision === 'keep'
      || hasExistingLodestoneInfo(item);
  });
  if (appliesPublicationGate && iconItems.length !== iconCandidates.length) {
    log(`公式未確認のためアイコン生成を保留しました: ${iconCandidates.length - iconItems.length}件`);
  }
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
        const decision = decisions.items[String(item.ID)];
        const png = await getProductionIconPng(
          item,
          pngName,
          delayMs,
          sameIconAlternatives(item, iconGroups),
          {
            allowXivapi: currentPublicIds.has(String(item.ID)) || decision?.iconSource === 'xivapi',
            preferredSource: decision?.iconSource === 'xivapi' ? 'xivapi' : 'lodestone'
          }
        );
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
  if (failed === 0 && sourceItemJsonPath === path.resolve(publicCandidatePath)) {
    const inputManifest = currentInputManifest();
    if (inputManifest) {
      recordWorkflowStage('icons', {
        inputFingerprint: manifestFingerprint(inputManifest),
        candidateSha256: sha256File(sourceItemJsonPath),
        quality,
        size: iconSize
      });
    }
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

const lodestoneInfoKeys = [
  'ShopInfo',
  'CraftInfo',
  'Recipes',
  'EquipmentInfo',
  'IsEx',
  'LodestoneInfoVersion',
  'LodestoneInfoCheckedAt'
];

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

function normalizePublicationDecisions(value = readJson(publicationDecisionsPath, {})) {
  const items = value?.items && typeof value.items === 'object' && !Array.isArray(value.items)
    ? value.items
    : {};
  return {
    version: 1,
    items: Object.fromEntries(Object.entries(items).map(([id, entry]) => [
      String(id),
      {
        decision: ['keep', 'exclude', 'hold'].includes(entry?.decision) ? entry.decision : 'hold',
        reason: String(entry?.reason || ''),
        iconSource: ['lodestone', 'xivapi', 'none'].includes(entry?.iconSource) ? entry.iconSource : 'none'
      }
    ]))
  };
}

function itemChanged(left, right) {
  const normalize = item => {
    const value = cloneJson(item);
    for (const recipe of [value.Recipe, ...(value.Recipes || [])]) {
      for (const ingredient of recipe?.Ingredients || []) delete ingredient.Name;
    }
    return Object.fromEntries(
      ['Name', 'ItemUICategory', 'IconFile', 'ItemUICategoryName', 'Recipe', 'Recipes', 'GatheringTimer']
        .filter(key => Object.hasOwn(value, key))
        .map(key => [key, value[key]])
    );
  };
  return JSON.stringify(normalize(left)) !== JSON.stringify(normalize(right));
}

export function publicationReviewItems({
  baseItems = readJson(publicItemJsonPath, []),
  candidateItems = readJson(publicCandidatePath, []),
  decisions = readJson(publicationDecisionsPath, {})
} = {}) {
  const normalized = normalizePublicationDecisions(decisions);
  const baseById = new Map(baseItems.map(item => [String(item.ID), item]));
  const rows = [];
  for (const item of candidateItems) {
    const id = String(item.ID);
    const base = baseById.get(id);
    const decision = normalized.items[id] || null;
    const lodestoneConfirmed = hasExistingLodestoneInfo(item);
    const changed = Boolean(base && itemChanged(base, item));
    if (base && !changed && lodestoneConfirmed && !decision) continue;
    if (!base || !lodestoneConfirmed || decision) {
      rows.push({
        id,
        name: String(item.Name || ''),
        status: decision?.decision || (
          lodestoneConfirmed
            ? 'lodestone'
            : (base && !changed ? 'legacy-unverified' : 'unreviewed')
        ),
        reason: decision?.reason || '',
        iconSource: decision?.iconSource || 'none',
        lodestoneConfirmed,
        existing: Boolean(base),
        changed,
        recipeReferences: 0,
        iconFile: String(item.IconFile || '')
      });
    }
  }
  const referenceCounts = new Map();
  for (const item of candidateItems) {
    for (const ingredient of item.Recipe?.Ingredients || []) {
      const id = String(ingredient.ItemID);
      referenceCounts.set(id, (referenceCounts.get(id) || 0) + 1);
    }
  }
  for (const row of rows) row.recipeReferences = referenceCounts.get(row.id) || 0;
  return rows.sort((left, right) =>
    Number(left.existing) - Number(right.existing) ||
    Number(left.id) - Number(right.id)
  );
}

export function applyPublicationPolicy({
  baseItems,
  candidateItems,
  decisions = readJson(publicationDecisionsPath, {})
}) {
  const normalized = normalizePublicationDecisions(decisions);
  const baseById = new Map(baseItems.map(item => [String(item.ID), item]));
  const candidateById = new Map(candidateItems.map(item => [String(item.ID), item]));
  const published = [];
  const withheld = [];
  const excluded = [];

  for (const base of baseItems) {
    const id = String(base.ID);
    const candidate = candidateById.get(id);
    const decision = normalized.items[id];
    if (decision?.decision === 'exclude') {
      excluded.push({ ID: base.ID, Name: base.Name, reason: decision.reason });
      continue;
    }
    if (!candidate) {
      published.push(base);
      continue;
    }
    if (decision?.decision === 'hold') {
      published.push(base);
      withheld.push({ ID: candidate.ID, Name: candidate.Name, reason: decision.reason || 'manual-hold' });
      continue;
    }
    if (decision?.decision === 'keep' || hasExistingLodestoneInfo(candidate)) {
      published.push(candidate);
      continue;
    }
    published.push(base);
    withheld.push({ ID: candidate.ID, Name: candidate.Name, reason: 'lodestone-unconfirmed-existing-change' });
  }

  for (const candidate of candidateItems) {
    const id = String(candidate.ID);
    if (baseById.has(id)) continue;
    const decision = normalized.items[id];
    if (decision?.decision === 'exclude') {
      excluded.push({ ID: candidate.ID, Name: candidate.Name, reason: decision.reason });
      continue;
    }
    if (decision?.decision === 'keep' || hasExistingLodestoneInfo(candidate)) {
      published.push(candidate);
      continue;
    }
    withheld.push({
      ID: candidate.ID,
      Name: candidate.Name,
      reason: decision?.reason || (decision?.decision === 'hold' ? 'manual-hold' : 'lodestone-unconfirmed-new-item')
    });
  }
  return { published, withheld, excluded };
}

export function printPublicationReview() {
  process.stdout.write(`${JSON.stringify(publicationReviewItems())}\n`);
}

export function verifyOutput({ expected = publicItemJsonPath, actual = buildOutputs.publicItems } = {}) {
  log(`Item.json比較を開始しました 比較元=${path.relative(repositoryRoot, expected)} 候補=${path.relative(repositoryRoot, actual)}`);
  const expectedItems = projectPublicItems(readJson(expected, [])).map(normalizeItemForCompare);
  const actualItems = projectPublicItems(readJson(actual, [])).map(normalizeItemForCompare);
  const errors = [];
  if (expectedItems.length !== actualItems.length) errors.push(`item count ${expectedItems.length} != ${actualItems.length}`);
  const actualById = new Map(actualItems.map(item => [String(item.ID), item]));
  for (const expectedItem of expectedItems) {
    const actualItem = actualById.get(String(expectedItem.ID));
    if (!actualItem) {
      errors.push(`missing item ${expectedItem.ID} ${expectedItem.Name}`);
      continue;
    }
    for (const key of ['Name', 'ItemUICategory', 'IconFile', 'ItemUICategoryName']) {
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
      for (const key of ['ItemID', 'Amount']) if ((expectedIngredients[i][key] ?? '') !== (actualIngredients[i][key] ?? '')) errors.push(`${expectedItem.ID} ingredient ${i} ${key} differs`);
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
  const roleResult = applyEquipmentRoleOverrides(candidateItems);
  log(`公開候補の装備推奨ロール情報: 自動 ${roleResult.automatic}件、手動反映 ${roleResult.applied}件、未指定 ${roleResult.missing}グループ`);
  const targetItems = fs.existsSync(target) ? readJson(target, null) : [];
  if (!Array.isArray(targetItems)) throw new Error(`Target Item.json is not an item array: ${target}`);
  const policy = targetItems.length
    ? applyPublicationPolicy({ baseItems: targetItems, candidateItems })
    : { published: candidateItems, withheld: [], excluded: [] };
  const publishItems = policy.published;
  writeJsonAtomic(publicationGateStatePath, {
    checkedAt: nowIso(),
    publishedCount: publishItems.length,
    withheldCount: policy.withheld.length,
    excludedCount: policy.excluded.length,
    withheld: policy.withheld,
    excluded: policy.excluded
  });
  log(`公式公開判定: 公開 ${publishItems.length}件、保留 ${policy.withheld.length}件、除外 ${policy.excluded.length}件`);
  try {
    if (targetItems.length) {
      const excludedIds = new Set(policy.excluded.map(item => String(item.ID)));
      const publishById = new Map(publishItems.map(item => [String(item.ID), item]));
      const missing = targetItems.filter(item => !excludedIds.has(String(item.ID)) && !publishById.has(String(item.ID)));
      if (missing.length) throw new Error(`${missing.length} existing item(s) disappeared outside publication exclusions.`);
      log(`公開統合確認成功: 既存${targetItems.length}件 候補${candidateItems.length}件 公開${publishItems.length}件`);
    }
    else verifyOutput({ expected, actual: candidate });
  } catch (error) {
    if (!acceptDiff) throw error;
    log(`確認済み差分として続行します: ${error.message}`);
  }
  protectItemJson({ source: target, target: expectedItemJsonPath });
  writeJsonAtomic(candidate, candidateItems);
  writePublicItemsAtomic(target, publishItems);
  updateDataCacheVersion({ itemJsonPath: target, salt: hashIconFiles(publishItems.map(item => item.IconFile).filter(Boolean)), reason: 'publish' });
  updateRunState({ command: 'publish', status: 'completed', finalOutput: path.relative(repositoryRoot, target) });
  if (
    path.resolve(candidate) === path.resolve(publicCandidatePath)
    && path.resolve(target) === path.resolve(publicItemJsonPath)
  ) {
    const inputManifest = currentInputManifest();
    if (inputManifest) {
      recordWorkflowStage('publish', {
        inputFingerprint: manifestFingerprint(inputManifest),
        candidateSha256: sha256File(candidate),
        publicSha256: sha256File(target)
      });
    }
  }
  log(`公開反映しました ${path.relative(repositoryRoot, candidate)} -> ${path.relative(repositoryRoot, target)}`);
}

export function compactPublicItemJson({
  source = publicItemJsonPath,
  target = publicItemJsonPath
} = {}) {
  const items = readJson(source, null);
  if (!Array.isArray(items)) throw new Error(`Item JSON is not an item array: ${source}`);
  const beforeBytes = fs.statSync(source).size;
  writePublicItemsAtomic(target, items);
  const afterBytes = fs.statSync(target).size;
  updateDataCacheVersion({
    itemJsonPath: target,
    salt: hashIconFiles(items.map(item => item.IconFile).filter(Boolean)),
    reason: 'compact-public'
  });
  log(`公開Item.jsonを軽量化しました ${formatBytes(beforeBytes)} -> ${formatBytes(afterBytes)}`);
  return { itemCount: items.length, beforeBytes, afterBytes };
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
  writePublicItemsAtomic(target, items);
  updateDataCacheVersion({ itemJsonPath: target, salt: `gathering-${matched}-${unmatched.length}`, reason: 'gathering' });
  updateRunState({ command: 'publish-gathering', status: 'completed', finalOutput: path.relative(repositoryRoot, target) });
  log(`採集情報を公開反映しました 一致 ${matched}件、未一致 ${unmatched.length}件、削除 ${removed}件`);
}

function lodestoneRecipeLookupMaps(itemUrls) {
  const craftJobs = readJson(craftJobsPath, null)?.jobs;
  if (!Array.isArray(craftJobs) || craftJobs.length === 0) {
    throw new Error(`クラフタージョブ固定マスターを読み込めません: ${craftJobsPath}`);
  }
  const craftTypeByJob = new Map(craftJobs.map(job => [job.name, String(job.craftType)]));
  const itemIdByLodestoneKey = new Map(
    Object.entries(itemUrls)
      .map(([itemId, url]) => [String(url || '').match(/\/item\/([a-z0-9]+)\//)?.[1], String(itemId)])
      .filter(([key]) => key)
  );
  return { craftTypeByJob, itemIdByLodestoneKey };
}

async function extractLodestoneRecipesForItem(item, detailHtml, delayMs, lookupMaps) {
  const expectedName = normalizeLodestoneItemName(item.Name);
  const craftInfos = [];
  const recipes = [];
  const seenRecipeIds = new Set();
  for (const recipePath of extractLodestoneRecipePaths(detailHtml)) {
    assertNotCancelled();
    const recipeUrl = `https://jp.finalfantasyxiv.com${recipePath}`;
    const recipeHtml = decodeHtml(await fetchCachedLodestoneText(recipeUrl, delayMs));
    const recipeItemName = extractLodestoneDetailItemName(recipeHtml);
    if (normalizeLodestoneItemName(recipeItemName) !== expectedName) {
      throw new Error(`Lodestoneレシピの完成品名が一致しません: ${recipeItemName || '名称取得不可'} @ ${recipePath}`);
    }
    const recipe = extractLodestoneRecipeData(recipePath, recipeHtml, lookupMaps);
    if (seenRecipeIds.has(recipe.RecipeID)) throw new Error(`Lodestone RecipeIDが重複しています: ${recipe.RecipeID}`);
    seenRecipeIds.add(recipe.RecipeID);
    recipes.push(recipe);
    craftInfos.push(recipe.CraftInfo);
  }
  return { craftInfos, recipes };
}

async function filterUnconditionalShops(shops, delayMs) {
  const filtered = [];
  for (const shop of shops) {
    assertNotCancelled();
    const condition = await resolveLodestoneShopCondition(
      shop.shopId,
      () => fetchCachedLodestoneText(`https://jp.finalfantasyxiv.com/lodestone/playguide/db/shop/${shop.shopId}/`, delayMs),
      { cache: lodestoneShopConditionCache }
    );
    if (condition.memoryHit) {
      if (lodestoneEtaStats) lodestoneEtaStats.memory += 1;
    }
    if (condition.cacheError) {
      lodestoneShopConditionCache?.clear();
      lodestoneShopConditionCache = null;
    }
    if (condition.conditional) continue;
    filtered.push({
      shopName: shop.shopName,
      area: shop.area,
      x: shop.x,
      y: shop.y
    });
  }
  return filtered;
}

async function applyLodestoneInfoToItem(item, delayMs, recipeLookupMaps) {
  assertNotCancelled();
  const { detailUrl, detailHtml } = await resolveLodestoneItemDetail(item, delayMs, { cache: true });
  const iconUrl = extractLodestoneNqIconUrl(detailHtml);
  const isEx = extractLodestoneIsEx(detailHtml);
  if (isEx == null) throw new Error('Lodestoneアイテム見出しからEX情報を取得できません');

  const shopInfo = extractLodestoneShopInfo(detailHtml);
  const shops = shopInfo ? await filterUnconditionalShops(shopInfo.shops, delayMs) : [];
  delete item.ShopSales;
  if (shopInfo && shops.length) item.ShopInfo = { price: shopInfo.price, shops };
  else delete item.ShopInfo;

  const { craftInfos, recipes } = await extractLodestoneRecipesForItem(item, detailHtml, delayMs, recipeLookupMaps);
  if (craftInfos.length) item.CraftInfo = craftInfos;
  else delete item.CraftInfo;
  if (recipes.length > 1) item.Recipes = recipes;
  else delete item.Recipes;

  const equipmentInfo = extractLodestoneEquipmentInfo(detailHtml);
  if (equipmentInfo) item.EquipmentInfo = equipmentInfo;
  else delete item.EquipmentInfo;
  item.IsEx = isEx;
  item.LodestoneInfoVersion = lodestoneInfoVersion;
  item.LodestoneInfoCheckedAt = nowIso();

  return {
    detailUrl,
    iconUrl,
    isEx,
    shopSales: shops.length,
    craftInfo: craftInfos.length,
    equipmentInfo: Boolean(equipmentInfo),
    equipmentStats: Boolean(equipmentInfo?.stats && Object.values(equipmentInfo.stats).some(value => Number(value) > 0)),
    equipmentPerformance: Boolean(equipmentInfo?.performance && Object.values(equipmentInfo.performance).some(value => Number(value) > 0))
  };
}

export function hasExistingLodestoneInfo(item) {
  if (item?.LodestoneInfoVersion !== lodestoneInfoVersion) return false;
  if (typeof item?.IsEx !== 'boolean') return false;
  if (
    Array.isArray(item?.CraftInfo) &&
    item.CraftInfo.length > 1 &&
    (!Array.isArray(item?.Recipes) || item.Recipes.length !== item.CraftInfo.length)
  ) {
    return false;
  }
  if (item?.EquipmentInfo && !item.EquipmentInfo.stats) return false;
  if (item?.EquipmentInfo && item.EquipmentInfo.statsVersion !== lodestoneEquipmentStatsVersion) return false;
  if (item?.EquipmentInfo?.stats
    && lodestoneEquipmentStatNames.some(stat => !Object.hasOwn(item.EquipmentInfo.stats, stat))) return false;
  if (item?.EquipmentInfo && !item.EquipmentInfo.performance) return false;
  if (item?.EquipmentInfo?.performance
    && Object.values(lodestoneEquipmentPerformanceLabels)
      .some(name => !Object.hasOwn(item.EquipmentInfo.performance, name))) return false;
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

export function mergeFriendlyTribeShopInfo(items, friendlyTribeShops = readJson(friendlyTribeShopsPath, {})) {
  const byName = new Map(items.map(item => [String(item.Name || ''), item]));
  let matched = 0;
  let shopAdded = 0;
  let priceMismatch = 0;
  let unmatched = 0;
  for (const [name, info] of Object.entries(friendlyTribeShops || {})) {
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
      log(`友好部族ショップ価格警告: ${name} 既存=${currentPrice} 追加=${nextPrice}`);
    }
    if (!Array.isArray(item.ShopInfo.shops)) item.ShopInfo.shops = [];
    for (const shop of shops) {
      const normalized = {
        shopName: String(shop.shopName || '').trim(),
        area: String(shop.area || '').trim(),
        requiredRank: String(shop.requiredRank || '').trim()
      };
      if (!normalized.shopName || !normalized.area || !normalized.requiredRank) continue;
      const exists = item.ShopInfo.shops.some(existing =>
        String(existing.shopName || '') === normalized.shopName
        && String(existing.area || '') === normalized.area
        && String(existing.requiredRank || '') === normalized.requiredRank
      );
      if (exists) continue;
      item.ShopInfo.shops.push(normalized);
      shopAdded += 1;
    }
  }
  log(`友好部族ショップ情報: 一致 ${matched}件、店舗追加 ${shopAdded}件、未一致 ${unmatched}件、価格差 ${priceMismatch}件`);
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
  let equipmentPerformanceMatched = 0;
  let exMatched = 0;
  let failed = 0;
  let skipped = 0;
  const itemUrls = readJson(lodestoneItemUrlsPath, {});
  const recipeLookupMaps = lodestoneRecipeLookupMaps(itemUrls);
  lodestoneEtaStats = { fetch: 0, cache: 0, memory: 0 };
  lodestoneShopConditionCache = new Map();
  cancellationEnabled = true;
  try {
    for (const item of limitedItems) {
      assertNotCancelled();
      processed += 1;
      const itemStartedAt = Date.now();
      const fetchBefore = lodestoneEtaStats.fetch;
      const cacheBefore = lodestoneEtaStats.cache;
      const memoryBefore = lodestoneEtaStats.memory;
      let didSkip = false;
      try {
        if (!force && hasExistingLodestoneInfo(item)) {
          didSkip = true;
          skipped += 1;
          log(`Lodestone ${processed}/${limitedItems.length}: ${item.ID} ${item.Name} 取得済みのためスキップ`);
          continue;
        }
        const result = await applyLodestoneInfoToItem(item, delayMs, recipeLookupMaps);
        if (result.detailUrl) itemUrls[String(item.ID)] = result.detailUrl;
        if (result.shopSales > 0) shopMatched += 1;
        if (result.craftInfo > 0) craftMatched += 1;
        if (result.equipmentInfo) equipmentMatched += 1;
        if (result.equipmentStats) equipmentStatsMatched += 1;
        if (result.equipmentPerformance) equipmentPerformanceMatched += 1;
        if (result.isEx) exMatched += 1;
        log(`Lodestone ${processed}/${limitedItems.length}: ${item.ID} ${item.Name} 店${result.shopSales} 製作${result.craftInfo} 装備${result.equipmentInfo ? 1 : 0} ステータス${result.equipmentStats ? 1 : 0} 基本性能${result.equipmentPerformance ? 1 : 0} EX${result.isEx ? 1 : 0}`);
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
          memoryCaches: lodestoneEtaStats.memory - memoryBefore,
          skipped: didSkip ? 1 : 0
        });
      }
    }
  } finally {
    cancellationEnabled = false;
    lodestoneShopConditionCache?.clear();
    lodestoneShopConditionCache = null;
    if (lodestoneShopCacheStore) {
      try {
        lodestoneShopCacheStore.close();
      } finally {
        lodestoneShopCacheStore = null;
      }
    }
  }
  lodestoneEtaStats = null;

  const housingResult = fs.existsSync(housingShopsPath)
    ? mergeHousingShopInfo(items)
    : { matched: 0, shopAdded: 0, unmatched: 0, priceMismatch: 0 };
  if (!fs.existsSync(housingShopsPath)) log('ハウジングショップ情報: housing-shops.json が無いためスキップしました');
  const friendlyTribeResult = fs.existsSync(friendlyTribeShopsPath)
    ? mergeFriendlyTribeShopInfo(items)
    : { matched: 0, shopAdded: 0, unmatched: 0, priceMismatch: 0 };
  if (!fs.existsSync(friendlyTribeShopsPath)) log('友好部族ショップ情報: friendly-tribe-shops.json が無いためスキップしました');
  writeJsonAtomic(lodestoneItemUrlsPath, itemUrls);
  const roleResult = applyEquipmentRoleOverrides(items);
  log(`装備推奨ロール情報: 自動 ${roleResult.automatic}件、手動対象 ${roleResult.groups}グループ、手動反映 ${roleResult.applied}件、未指定 ${roleResult.missing}グループ`);
  if (path.resolve(target) === publicItemJsonPath) writePublicItemsAtomic(target, items);
  else writeJsonAtomic(target, items);
  if (path.resolve(target) === publicItemJsonPath) {
    updateDataCacheVersion({ itemJsonPath: target, salt: `lodestone-info-${processed}-${shopMatched}-${craftMatched}-${equipmentMatched}-${equipmentStatsMatched}-${exMatched}-${failed}-${housingResult.shopAdded}-${friendlyTribeResult.shopAdded}`, reason: 'lodestone-info' });
  } else {
    log('公開Item.json以外が対象のため、データキャッシュ版の更新をスキップしました');
  }
  updateRunState({ command: 'publish-lodestone-info', status: 'completed', finalOutput: path.relative(repositoryRoot, target) });
  if (path.resolve(target) === path.resolve(publicCandidatePath)) {
    const inputManifest = currentInputManifest();
    if (inputManifest) {
      recordWorkflowStage('lodestone', {
        inputFingerprint: manifestFingerprint(inputManifest),
        candidateSha256: sha256File(target)
      });
    }
  }
  log(`Lodestone情報を候補反映しました 処理 ${processed}件、スキップ ${skipped}件、店 ${shopMatched}件、製作 ${craftMatched}件、装備 ${equipmentMatched}件、ステータス ${equipmentStatsMatched}件、基本性能 ${equipmentPerformanceMatched}件、EX ${exMatched}件、失敗 ${failed}件`);
}

export function publishLodestoneRecipesFromCache({ target = publicCandidatePath } = {}) {
  log('Lodestoneキャッシュからレシピ候補の生成を開始しました');
  const items = readJson(target, null);
  if (!Array.isArray(items)) throw new Error(`Item JSON is not an item array: ${target}`);
  const itemUrls = readJson(lodestoneItemUrlsPath, {});
  const lookupMaps = lodestoneRecipeLookupMaps(itemUrls);
  const itemNameById = new Map(items.map(item => [String(item.ID), normalizeLodestoneItemName(item.Name)]));
  const store = openLodestoneShopCacheStore();
  const globalRecipeIds = new Set();
  let recipeItems = 0;
  let multiRecipeItems = 0;
  let recipeVariants = 0;

  const readCached = url => {
    const html = readLodestoneShopCacheEntry(store, lodestoneCacheKey(url));
    if (!html) throw new Error(`Lodestoneキャッシュがありません: ${url}`);
    return decodeHtml(html);
  };

  try {
    for (const item of items) {
      const itemUrl = itemUrls[String(item.ID)];
      if (!itemUrl) continue;
      const detailHtml = readCached(itemUrl);
      const recipePaths = extractLodestoneRecipePaths(detailHtml);
      if (recipePaths.length === 0) {
        delete item.Recipes;
        continue;
      }

      const expectedName = normalizeLodestoneItemName(item.Name);
      const recipes = recipePaths.map(recipePath => {
        const recipeHtml = readCached(`https://jp.finalfantasyxiv.com${recipePath}`);
        const resultName = normalizeLodestoneItemName(extractLodestoneDetailItemName(recipeHtml));
        if (resultName !== expectedName) {
          throw new Error(
            `${item.ID} ${item.Name}: Lodestoneレシピの完成品名が一致しません: ${resultName || '名称取得不可'}`
          );
        }
        const recipe = extractLodestoneRecipeData(recipePath, recipeHtml, lookupMaps);
        if (globalRecipeIds.has(recipe.RecipeID)) {
          throw new Error(`RecipeIDがアイテム間で重複しています: ${recipe.RecipeID}`);
        }
        globalRecipeIds.add(recipe.RecipeID);
        for (const ingredient of recipe.Ingredients) {
          const actualName = itemNameById.get(String(ingredient.ItemID));
          if (actualName !== normalizeLodestoneItemName(ingredient.Name)) {
            throw new Error(
              `${item.ID} ${item.Name}: 素材のLodestoneキーと名称が一致しません: ${ingredient.ItemID} ${ingredient.Name}`
            );
          }
        }
        return recipe;
      });

      item.CraftInfo = recipes.map(recipe => recipe.CraftInfo);
      if (recipes.length > 1) item.Recipes = recipes;
      else delete item.Recipes;
      recipeItems += 1;
      recipeVariants += recipes.length;
      if (recipes.length > 1) multiRecipeItems += 1;
    }
  } finally {
    store.close();
  }

  if (path.resolve(target) === publicItemJsonPath) writePublicItemsAtomic(target, items);
  else writeJsonAtomic(target, items);
  log(
    `Lodestoneレシピ候補を作成しました 対象 ${recipeItems}件、複数 ${multiRecipeItems}件、レシピ ${recipeVariants}件`
  );
  return { itemCount: items.length, recipeItems, multiRecipeItems, recipeVariants };
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

export async function tmpQualityPreview({
  sampleCount = defaultPreviewSampleCount,
  force = false,
  size = 80,
  quality = defaultIconQuality,
  delayMs = defaultLodestoneInfoDelayMs,
  itemJsonPath = publicItemJsonPath,
  snapshotPath = lodestoneSourceSnapshotPath,
  previewRoot = tmpPreviewRoot,
  request = url => fetch(url, { headers: { 'user-agent': 'ffxiv-recipe-icon-preview/1.0' } })
} = {}) {
  const iconSize = Number.isFinite(size) && size > 0 ? Math.floor(size) : 80;
  const selectedQuality = Number.isFinite(quality) && quality >= 1 && quality <= 100 ? Math.floor(quality) : defaultIconQuality;
  const qualities = [...new Set([50, 60, 70, 80, selectedQuality])].sort((left, right) => left - right);
  const sampleRoot = path.join(previewRoot, 'samples');
  const previewDataPath = path.join(previewRoot, 'preview-data.json');
  const previewManifestPath = path.join(previewRoot, 'manifest.json');
  const document = readJson(itemJsonPath, null);
  const snapshot = readJson(snapshotPath, null);
  if (!Array.isArray(document?.Items)) throw new Error('公開Item.jsonを読み込めません');
  if (!Array.isArray(snapshot?.Items)) throw new Error('Lodestoneスナップショットがありません。先に全データ取得を実行してください');
  const sourceByName = new Map(snapshot.Items.map(item => [item.Name, item]));
  const eligible = document.Items.filter(item => item?.Name && item?.IconFile && sourceByName.get(item.Name)?.IconUrl);
  if (!eligible.length) throw new Error('プレビュー可能なLodestone画像がありません');
  const samples = deterministicShuffle(eligible).slice(0, Math.min(sampleCount, eligible.length));
  const manifest = {
    generator: 'lodestone-name-preview-v1',
    itemJsonSha256: sha256File(itemJsonPath),
    qualities,
    selectedQuality,
    sampleCount: samples.length,
    size: iconSize
  };
  const previousManifest = readJson(previewManifestPath, null);
  const reusable = !force
    && previousManifest
    && fs.existsSync(path.join(previewRoot, 'index.html'))
    && fs.existsSync(previewDataPath)
    && previousManifest.generator === manifest.generator
    && previousManifest.itemJsonSha256 === manifest.itemJsonSha256
    && previousManifest.sampleCount === manifest.sampleCount
    && previousManifest.size === manifest.size
    && previousManifest.selectedQuality === manifest.selectedQuality
    && JSON.stringify(previousManifest.qualities) === JSON.stringify(manifest.qualities);
  if (reusable) {
    log(`比較 1/1 既存の比較ページを使用します`);
    log(`作成済み ${path.relative(repositoryRoot, path.join(previewRoot, 'index.html'))}`);
    return { reused: true };
  }
  log(`比較 0/${samples.length} Lodestone画像を準備中`);
  if (fs.existsSync(previewRoot)) fs.rmSync(previewRoot, { recursive: true, force: true });
  ensureDir(sampleRoot);
  const requestSequentially = createSequentialRequestQueue({ delayMs, request });
  const rows = [];
  let lastProgressLog = 0;

  for (let i = 0; i < samples.length; i += 1) {
    const item = samples[i];
    const source = sourceByName.get(item.Name);
    const iconName = itemIconNameHash(item.Name);
    const pngOut = path.join(sampleRoot, `${iconName}.png`);
    const cachePath = path.join(lodestonePngIconCacheRoot, `${source.LodestoneKey}.png`);
    if (!fs.existsSync(cachePath)) {
      const response = await requestSequentially(source.IconUrl);
      if (!response.ok) throw new Error(`Lodestone画像取得に失敗しました: ${item.Name} HTTP ${response.status}`);
      if (!(response.headers.get('content-type') || '').includes('image/png')) throw new Error(`Lodestone画像がPNGではありません: ${item.Name}`);
      ensureDir(lodestonePngIconCacheRoot);
      writeBytesAtomic(cachePath, Buffer.from(await response.arrayBuffer()));
    }
    const pngBytes = fs.readFileSync(cachePath);
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
        size: fs.statSync(webpOut).size,
        selected: quality === selectedQuality
      });
    }
    const now = Date.now();
    if (now - lastProgressLog >= 1000 || i + 1 === samples.length) {
      log(`比較 ${i + 1}/${samples.length} ${iconName} 変換完了`);
      lastProgressLog = now;
    }
    rows.push({
      iconName,
      itemName: item.Name,
      pngFile: `samples/${iconName}.png`,
      pngSize,
      pngWidth: pngMeta.width,
      pngHeight: pngMeta.height,
      variants,
      category: classifyItemCategory([item]),
      background: await classifyIconBackground(pngBytes)
    });
  }

  writeTextAtomic(path.join(previewRoot, 'index.html'), renderTmpQualityPreviewHtml(rows));
  writeJsonAtomic(previewDataPath, rows);
  writeJsonAtomic(previewManifestPath, { ...manifest, generatedAt: nowIso() });
  log(`作成しました ${path.relative(repositoryRoot, path.join(previewRoot, 'index.html'))}`);
  return { reused: false };
}

function renderTmpQualityPreviewHtml(rows) {
  const tableRows = rows.map(row => {
    const cells = [
      `<div class="cell"><div class="swatch"><img src="${escapeHtml(row.pngFile)}" alt=""></div><b>PNG</b><span>元画像 ${escapeHtml(formatImagePixels(row.pngWidth, row.pngHeight))}</span><span>${formatBytes(row.pngSize)}</span></div>`,
      ...row.variants.map(variant => `<div class="cell"><div class="swatch"><img src="${escapeHtml(variant.file)}" alt=""></div><b>q${variant.quality}</b><span>${formatBytes(variant.size)} / ${Math.round((variant.size / row.pngSize) * 100)}%</span></div>`)
    ].join('');
    return `<section class="row"><h2>${escapeHtml(row.itemName || row.iconName)}</h2><div class="tags"><span>${escapeHtml(row.category)}</span><span>${escapeHtml(row.background)}</span></div><div class="grid">${cells}</div></section>`;
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

function levenshteinDistance(left, right) {
  const a = [...String(left || '')];
  const b = [...String(right || '')];
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[b.length];
}

function similarLodestoneNames(name, allNames, limit = 5) {
  return allNames
    .map(candidate => ({ name: candidate, distance: levenshteinDistance(name, candidate) }))
    .sort((left, right) => left.distance - right.distance || left.name.localeCompare(right.name, 'ja'))
    .slice(0, limit);
}

function runtimeFieldsFromExistingItem(item) {
  const result = {};
  for (const key of ['GatheringTimer', 'ShopInfo', 'EquipmentInfo', 'IsEx']) {
    if (item?.[key] !== undefined) result[key] = cloneJson(item[key]);
  }
  return result;
}

function readCachedLodestoneRecipeHtml(recipePath) {
  const url = `${LODESTONE_BASE_URL}${recipePath}`;
  const key = crypto.createHash('sha256').update(url).digest('hex');
  const html = readLodestoneShopCacheEntry(getLodestoneShopCacheStore(), key);
  if (!html) throw new Error(`Lodestoneレシピキャッシュがありません: ${recipePath}`);
  return html;
}

export async function enrichNewLodestoneCandidateItem(item, source, {
  delayMs = defaultLodestoneInfoDelayMs,
  fetchText = fetchCachedLodestoneText,
  filterShops = filterUnconditionalShops
} = {}) {
  const detailHtml = decodeHtml(await fetchText(`${LODESTONE_BASE_URL}${source.DetailPath}`, delayMs));
  const detailName = extractLodestoneDetailItemName(detailHtml);
  if (normalizeLodestoneItemName(detailName) !== normalizeLodestoneItemName(item.Name)) {
    throw new Error(`Lodestone詳細名が一致しません: ${item.Name} / ${detailName || '取得不可'}`);
  }
  const isEx = extractLodestoneIsEx(detailHtml);
  if (isEx == null) throw new Error(`Lodestoneアイテム見出しからEX情報を取得できません: ${item.Name}`);
  item.IsEx = isEx;
  const equipmentInfo = extractLodestoneEquipmentInfo(detailHtml);
  if (equipmentInfo) item.EquipmentInfo = equipmentInfo;
  const shopInfo = extractLodestoneShopInfo(detailHtml);
  if (shopInfo) {
    const shops = await filterShops(shopInfo.shops, delayMs);
    if (shops.length > 0) item.ShopInfo = { price: shopInfo.price, shops };
  }
  return item;
}

export async function buildLodestoneCandidate({
  snapshotPath = lodestoneSourceSnapshotPath,
  target = publicCandidatePath,
  legacyTarget = legacyItemIdCandidatePath,
  delayMs = defaultLodestoneInfoDelayMs
} = {}) {
  clearCancelRequest();
  cancellationEnabled = true;
  try {
  const snapshot = readJson(snapshotPath, null);
  if (!snapshot || !Array.isArray(snapshot.Items) || !Array.isArray(snapshot.Recipes)) {
    throw new Error('Lodestoneスナップショットがありません。先に lodestone-snapshot を実行してください');
  }
  const listedByName = new Map(snapshot.Items.map(item => [item.Name, item]));
  const allNames = [...listedByName.keys()];
  const existingDocument = readJson(publicItemJsonPath, []);
  const existingItems = Array.isArray(existingDocument) ? existingDocument : existingDocument.Items || [];
  const existingByName = new Map(existingItems.map(item => [item.Name, item]));
  const previousItemUrls = readJson(lodestoneItemUrlsPath, {});
  const existingByLodestoneKey = new Map();
  for (const item of existingItems) {
    const key = String(previousItemUrls[String(item.ID)] || '').match(/\/item\/([a-z0-9]+)\//)?.[1];
    if (key) existingByLodestoneKey.set(key, item);
  }
  const tokenRows = readCsv(csvPath('token-items.csv'));
  const unmatched = [];
  for (const [index, row] of tokenRows.entries()) {
    if (row.length !== 4 || !['8', '9'].includes(row[3])) throw new Error(`Invalid token-items.csv row ${index + 1}.`);
    if (!listedByName.has(row[0])) {
      const ordinalCorrection = row[0].replace(/([一二三四])時/g, '$1次');
      if (ordinalCorrection !== row[0] && listedByName.has(ordinalCorrection)) {
        log(`手動データ名を自動修正します: ${row[0]} → ${ordinalCorrection}`);
        row[0] = ordinalCorrection;
      }
    }
    if (!listedByName.has(row[0])) {
      unmatched.push({ source: 'token-items.csv', row: index + 1, name: row[0], candidates: similarLodestoneNames(row[0], allNames) });
    }
  }
  ensureDir(reportsRoot);
  writeJsonAtomic(manualUnmatchedReportPath, { checkedAt: nowIso(), unmatched });
  if (unmatched.length > 0) {
    const batch = unmatched.slice(0, 10).map(entry =>
      `${entry.name} (${entry.source}:${entry.row}) 候補: ${entry.candidates.map(row => row.name).join('、')}`
    );
    throw new Error(`手動データ名をLodestoneで確認できません（先頭${batch.length}/${unmatched.length}件）:\n${batch.join('\n')}`);
  }

  const craftTypeByJob = new Map(readJson(craftJobsPath, { jobs: [] }).jobs.map(job => [job.name, String(job.craftType)]));
  const recipeVariants = new Map();
  const usedNames = new Set();
  log(`Lodestoneレシピキャッシュから候補を生成します: ${snapshot.Recipes.length}件`);
  for (const [index, entry] of snapshot.Recipes.entries()) {
    assertNotCancelled();
    if (!listedByName.has(entry.Name)) throw new Error(`製作手帳の完成品がアイテム一覧にありません: ${entry.Name}`);
    const parsed = extractLodestoneRecipeData(entry.DetailPath, readCachedLodestoneRecipeHtml(entry.DetailPath), { craftTypeByJob });
    const recipe = {
      RecipeKey: parsed.RecipeID,
      CraftType: parsed.CraftType,
      CraftInfo: parsed.CraftInfo,
      AmountResult: parsed.AmountResult,
      Ingredients: parsed.Ingredients.map(ingredient => ({ Name: ingredient.Name, Amount: ingredient.Amount }))
    };
    for (const ingredient of recipe.Ingredients) {
      if (!listedByName.has(ingredient.Name)) throw new Error(`レシピ素材がLodestoneアイテム一覧にありません: ${entry.Name} -> ${ingredient.Name}`);
      usedNames.add(ingredient.Name);
    }
    if (!recipeVariants.has(entry.Name)) recipeVariants.set(entry.Name, []);
    recipeVariants.get(entry.Name).push(recipe);
    if ((index + 1) % 1000 === 0 || index + 1 === snapshot.Recipes.length) log(`レシピ変換 ${index + 1}/${snapshot.Recipes.length}`);
  }

  for (const [index, [targetName, currencyName, amount, craftType]] of tokenRows.entries()) {
    const variants = recipeVariants.get(targetName) || [];
    const ingredient = { Name: currencyName, Amount: amount };
    if (variants.length > 0) variants[0].Ingredients.push(ingredient);
    else variants.push({ RecipeKey: `exchange-${index + 1}`, CraftType: craftType, AmountResult: '1', Ingredients: [ingredient] });
    recipeVariants.set(targetName, variants);
  }

  const targetNames = new Set([...recipeVariants.keys(), ...usedNames]);
  const items = snapshot.Items
    .filter(item => targetNames.has(item.Name))
    .map(source => {
      const existing = existingByName.get(source.Name) || existingByLodestoneKey.get(source.LodestoneKey);
      const variants = recipeVariants.get(source.Name) || [];
      const item = {
        Name: source.Name,
        SortOrder: source.SortOrder,
        ItemCategory: source.ItemCategory,
        ...runtimeFieldsFromExistingItem(existing)
      };
      if (existing?.IconFile) item.IconFile = existing.IconFile;
      if (variants.length > 0) {
        item.Recipe = variants[0];
        if (variants.length > 1) item.Recipes = variants;
      }
      return item;
    });

  const regularNames = new Set(items.map(item => item.Name));
  const newItems = items.filter(item => !existingByName.has(item.Name) && listedByName.has(item.Name));
  if (newItems.length > 0) log(`新規アイテムのLodestone詳細情報を取得します: ${newItems.length}件`);
  for (const [index, item] of newItems.entries()) {
    assertNotCancelled();
    const source = listedByName.get(item.Name);
    await enrichNewLodestoneCandidateItem(item, source, { delayMs });
    if ((index + 1) % 25 === 0 || index + 1 === newItems.length) {
      log(`新規アイテム詳細 ${index + 1}/${newItems.length}: ${item.Name}`);
    }
  }
  for (const currencyName of new Set(tokenRows.map(row => row[1]))) {
    if (regularNames.has(currencyName)) continue;
    const existing = existingByName.get(currencyName);
    if (existing?.IconFile) items.push({ Name: currencyName, IconFile: existing.IconFile });
    else items.push({ Name: currencyName });
  }
  const currentNameByLodestoneKey = new Map(snapshot.Items.map(item => [item.LodestoneKey, item.Name]));
  const publishedLegacy = readJson(path.join(siteRoot, 'data', 'legacy-item-ids.json'), { Items: {} });
  const legacyIds = {
    ...(publishedLegacy?.Items && typeof publishedLegacy.Items === 'object' ? publishedLegacy.Items : {}),
    ...Object.fromEntries(existingItems
    .filter(item => item.ID && item.Name)
    .map(item => {
      const key = String(previousItemUrls[String(item.ID)] || '').match(/\/item\/([a-z0-9]+)\//)?.[1];
      return [String(item.ID), currentNameByLodestoneKey.get(key) || item.Name];
    }))
  };
  writeJsonAtomic(target, { Version: snapshot.Version, Items: items });
  writeJsonAtomic(legacyTarget, { SchemaVersion: 1, Items: legacyIds });
  log(`Lodestone候補を保存しました: 通常 ${regularNames.size}件、補助 ${items.length - regularNames.size}件、旧ID ${Object.keys(legacyIds).length}件`);
  return { version: snapshot.Version, items: items.length, regularItems: regularNames.size, legacyIds: Object.keys(legacyIds).length };
  } finally {
    cancellationEnabled = false;
    if (lodestoneShopCacheStore) {
      try {
        lodestoneShopCacheStore.close();
      } finally {
        lodestoneShopCacheStore = null;
      }
    }
  }
}

export async function ensureLodestoneCandidateIcons({
  candidatePath = publicCandidatePath,
  snapshotPath = lodestoneSourceSnapshotPath,
  delayMs = defaultLodestoneInfoDelayMs,
  quality = defaultIconQuality,
  size = 80,
  iconsRoot = itemIconsRoot,
  manualIconsRoot = manualItemIconsRoot,
  pngCacheRoot = lodestonePngIconCacheRoot,
  existingItemJsonPath = publicItemJsonPath,
  request = url => fetch(url, { headers: { 'user-agent': 'ffxiv-recipe-icon-pipeline/1.0' } })
} = {}) {
  clearCancelRequest();
  cancellationEnabled = true;
  try {
  const candidate = readJson(candidatePath, null);
  const snapshot = readJson(snapshotPath, null);
  if (!Array.isArray(candidate?.Items) || !Array.isArray(snapshot?.Items)) throw new Error('名前キー候補またはLodestoneスナップショットがありません');
  const sourceByName = new Map(snapshot.Items.map(item => [item.Name, item]));
  const existingDocument = readJson(existingItemJsonPath, []);
  const existingItems = Array.isArray(existingDocument) ? existingDocument : existingDocument?.Items || [];
  const existingByName = new Map(existingItems.map(item => [item.Name, item]));
  const requestSequentially = createSequentialRequestQueue({
    delayMs,
    request
  });
  const nameHashOwners = new Map();
  const iconFileOwners = new Map();
  let generated = 0;
  let reused = 0;
  let downloaded = 0;
  let manualProtected = 0;
  let withoutImage = 0;
  ensureDir(iconsRoot);
  log(`Lodestone候補の画像を名前・内容ハッシュ形式へ整備します: ${candidate.Items.length}件 delay=${delayMs}ms`);
  for (const [index, item] of candidate.Items.entries()) {
    assertNotCancelled();
    if (!item?.Name) throw new Error(`候補アイテム名がありません: ${index + 1}`);
    const nameHash = itemIconNameHash(item.Name);
    const hashOwner = nameHashOwners.get(nameHash);
    if (hashOwner && hashOwner !== item.Name) throw new Error(`アイテム名ハッシュが衝突しました: ${hashOwner} / ${item.Name}`);
    nameHashOwners.set(nameHash, item.Name);
    const source = sourceByName.get(item.Name);
    const existing = existingByName.get(item.Name);
    const currentFiles = [...new Set([item.IconFile, existing?.IconFile].filter(Boolean))];
    let webpBytes = null;
    for (const iconFile of currentFiles) {
      const currentPath = iconPaths(iconFile, iconsRoot).webpPath;
      if (!fs.existsSync(currentPath)) continue;
      webpBytes = fs.readFileSync(currentPath);
      break;
    }

    let imageSource = webpBytes ? 'existing' : '';
    if (!source) {
      const manualPath = manualItemIconPath(item.Name, manualIconsRoot);
      if (fs.existsSync(manualPath)) {
        webpBytes = fs.readFileSync(manualPath);
        imageSource = 'manual';
      } else if (webpBytes) {
        writeBytesAtomic(manualPath, webpBytes);
        manualProtected += 1;
        imageSource = 'manual-protected';
      }
    } else if (!webpBytes) {
      let iconUrl = source.IconUrl || '';
      imageSource = 'lodestone';
      if (!iconUrl) {
        log(`Lodestone画像未確認: ${item.Name}`);
        delete item.IconFile;
        withoutImage += 1;
        continue;
      }
      const cachePath = path.join(pngCacheRoot, `${source.LodestoneKey}.png`);
      if (!fs.existsSync(cachePath)) {
        ensureDir(pngCacheRoot);
        const imageResponse = await requestSequentially(iconUrl);
        if (!imageResponse.ok) throw new Error(`${imageSource}画像取得に失敗しました: ${item.Name} HTTP ${imageResponse.status}`);
        const contentType = imageResponse.headers.get('content-type') || '';
        if (!contentType.includes('image/png')) throw new Error(`${imageSource}画像がPNGではありません: ${item.Name}`);
        writeBytesAtomic(cachePath, Buffer.from(await imageResponse.arrayBuffer()));
        downloaded += 1;
      }
      webpBytes = await webpBytesFromPng(cachePath, quality, size);
    }

    if (!webpBytes) {
      delete item.IconFile;
      withoutImage += 1;
      continue;
    }
    const iconFile = itemIconFileName(item.Name, webpBytes);
    const fileOwner = iconFileOwners.get(iconFile);
    if (fileOwner && fileOwner !== item.Name) throw new Error(`アイテム画像ファイル名が衝突しました: ${fileOwner} / ${item.Name}`);
    iconFileOwners.set(iconFile, item.Name);
    const targetPath = iconPaths(iconFile, iconsRoot).webpPath;
    if (fs.existsSync(targetPath)) {
      if (!fs.readFileSync(targetPath).equals(webpBytes)) throw new Error(`画像内容ハッシュが衝突しました: ${iconFile}`);
      reused += 1;
    } else {
      writeBytesAtomic(targetPath, webpBytes);
      generated += 1;
    }
    item.IconFile = iconFile;
    if ((index + 1) % 250 === 0 || index + 1 === candidate.Items.length) {
      log(`候補画像 ${index + 1}/${candidate.Items.length}: ${item.Name} ${iconFile} source=${imageSource}`);
    }
  }
  validateItemIconAssets(candidate.Items, { iconsRoot });
  writeJsonAtomic(candidatePath, candidate);
  log(`候補画像の整備が完了しました: 新規 ${generated}件、再利用 ${reused}件、取得 ${downloaded}件、手動保護 ${manualProtected}件、画像なし ${withoutImage}件`);
  return { generated, reused, downloaded, manualProtected, withoutImage };
  } finally {
    cancellationEnabled = false;
  }
}

export function validateItemIconAssets(items, { iconsRoot = itemIconsRoot } = {}) {
  if (!Array.isArray(items)) throw new TypeError('アイテム画像検証にはアイテム配列が必要です');
  const names = new Set();
  const nameHashOwners = new Map();
  const iconFileOwners = new Map();
  for (const item of items) {
    if (!item?.Name || names.has(item.Name)) throw new Error(`アイテム名が空または重複しています: ${item?.Name || '(空)'}`);
    names.add(item.Name);
    const nameHash = itemIconNameHash(item.Name);
    const hashOwner = nameHashOwners.get(nameHash);
    if (hashOwner && hashOwner !== item.Name) throw new Error(`アイテム名ハッシュが衝突しました: ${hashOwner} / ${item.Name}`);
    nameHashOwners.set(nameHash, item.Name);
    if (!item.IconFile) continue;
    const iconPath = iconPaths(item.IconFile, iconsRoot).webpPath;
    if (!fs.existsSync(iconPath)) throw new Error(`アイテム画像がありません: ${item.Name} ${item.IconFile}`);
    const bytes = fs.readFileSync(iconPath);
    if (!validateItemIconFileName(item.Name, item.IconFile, bytes)) throw new Error(`アイテム画像ファイル名が命名規則と一致しません: ${item.Name} ${item.IconFile}`);
    const owner = iconFileOwners.get(item.IconFile);
    if (owner && owner !== item.Name) throw new Error(`アイテム画像ファイル名が重複しています: ${owner} / ${item.Name}`);
    iconFileOwners.set(item.IconFile, item.Name);
  }
  return { items: items.length, icons: iconFileOwners.size };
}

export function cleanupItemIconAssets({ items, iconsRoot = itemIconsRoot, dryRun = false } = {}) {
  const validation = validateItemIconAssets(items, { iconsRoot });
  const referenced = new Set(items.map(item => item.IconFile).filter(Boolean));
  const removed = [];
  if (!fs.existsSync(iconsRoot)) return { ...validation, removed };
  for (const directoryEntry of fs.readdirSync(iconsRoot, { recursive: true, withFileTypes: true })) {
    if (!directoryEntry.isFile() || !directoryEntry.name.endsWith('.webp')) continue;
    const parentPath = directoryEntry.parentPath || directoryEntry.path;
    const filePath = path.join(parentPath, directoryEntry.name);
    if (referenced.has(directoryEntry.name)) continue;
    removed.push(path.relative(iconsRoot, filePath).replaceAll('\\', '/'));
    if (!dryRun) fs.rmSync(filePath);
  }
  if (!dryRun) {
    const directories = fs.readdirSync(iconsRoot, { recursive: true, withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(entry.parentPath || entry.path, entry.name))
      .sort((left, right) => right.length - left.length);
    for (const directory of directories) {
      if (fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
    }
  }
  return { ...validation, removed };
}

export function publishLodestoneCandidate({
  candidatePath = publicCandidatePath,
  legacyPath = legacyItemIdCandidatePath,
  target = publicItemJsonPath,
  legacyTarget = path.join(siteRoot, 'data', 'legacy-item-ids.json')
} = {}) {
  const candidate = readJson(candidatePath, null);
  const legacy = readJson(legacyPath, null);
  if (!Array.isArray(candidate?.Items) || !candidate.Version) throw new Error('検証済みの名前キー候補がありません');
  if (!legacy?.Items || typeof legacy.Items !== 'object') throw new Error('旧ID互換候補がありません');
  const names = new Set(candidate.Items.map(item => item.Name));
  if (names.size !== candidate.Items.length) throw new Error('名前キー候補に重複名があります');
  validateItemIconAssets(candidate.Items);
  if (fs.existsSync(target)) protectItemJson({ source: target, target: expectedItemJsonPath });
  writeTextAtomic(target, `${JSON.stringify(candidate)}\n`);
  writeTextAtomic(legacyTarget, `${JSON.stringify(legacy)}\n`);
  updateDataCacheVersion({
    itemJsonPath: target,
    salt: hashIconFiles(candidate.Items.map(item => item.IconFile).filter(Boolean)),
    reason: 'lodestone-name-publish'
  });
  const cleanup = cleanupItemIconAssets({ items: candidate.Items });
  log(`名前キー候補を公開データへ反映しました: ${candidate.Items.length}件、旧ID ${Object.keys(legacy.Items).length}件、旧画像整理 ${cleanup.removed.length}件`);
  return { items: candidate.Items.length, legacyIds: Object.keys(legacy.Items).length, removedIcons: cleanup.removed.length };
}

function printHelp() {
  log(`使い方: node pipeline/tool/pipeline-tool.mjs <command>

コマンド:
  workflow-status           GUI互換用の工程状態をJSON表示
  lodestone-snapshot [--delay 100]
                             アイテム・製作手帳の全一覧を直列取得し、版・件数・順序署名を保存
  build-lodestone-candidate  Lodestoneキャッシュと手動データから名前キーの公開候補を生成
  lodestone-candidate-icons [--delay 100] [--quality 80] [--size 80]
                             名前キー候補の不足画像をLodestone優先で逐次取得・生成
  tmp-quality-preview [--delay 100] [--quality 80] [--size 80]
                             指定した画像設定を含む比較プレビューを生成
  publish-lodestone-candidate
                             検証済み名前キー候補と旧ID互換JSONを公開データへ反映`);
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const command = args._[0] || 'help';
  if (['help', '--help', '-h'].includes(command)) return printHelp();
  clearCancelRequest();
  if (command === 'workflow-status') {
    process.stdout.write(`${JSON.stringify(pipelineWorkflowStatus())}\n`);
    return;
  }
  if (command === 'lodestone-snapshot') {
    return refreshLodestoneSourceSnapshot({
      delayMs: Number(args.delay || defaultLodestoneInfoDelayMs),
      target: args.target ? path.resolve(String(args.target)) : lodestoneSourceSnapshotPath
    });
  }
  if (command === 'build-lodestone-candidate') {
    return buildLodestoneCandidate({
      snapshotPath: args.snapshot ? path.resolve(String(args.snapshot)) : lodestoneSourceSnapshotPath,
      target: args.target ? path.resolve(String(args.target)) : publicCandidatePath,
      legacyTarget: args['legacy-target'] ? path.resolve(String(args['legacy-target'])) : legacyItemIdCandidatePath,
      delayMs: Number(args.delay || defaultLodestoneInfoDelayMs)
    });
  }
  if (command === 'lodestone-candidate-icons') {
    return ensureLodestoneCandidateIcons({
      candidatePath: args.target ? path.resolve(String(args.target)) : publicCandidatePath,
      snapshotPath: args.snapshot ? path.resolve(String(args.snapshot)) : lodestoneSourceSnapshotPath,
      delayMs: Number(args.delay || defaultLodestoneInfoDelayMs),
      quality: Number(args.quality || defaultIconQuality),
      size: Number(args.size || 80)
    });
  }
  if (command === 'tmp-quality-preview') {
    return tmpQualityPreview({
      delayMs: Number(args.delay || defaultLodestoneInfoDelayMs),
      quality: Number(args.quality || defaultIconQuality),
      size: Number(args.size || 80)
    });
  }
  if (command === 'publish-lodestone-candidate') return publishLodestoneCandidate();
  throw new Error(`Unknown command: ${command}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
