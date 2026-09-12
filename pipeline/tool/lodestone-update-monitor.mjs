#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  DEFAULT_LODESTONE_DELAY_MS,
  LODESTONE_ITEM_LIST_URL,
  LODESTONE_RECIPE_LIST_URL,
  applyDescendingSortOrder,
  createSequentialRequestQueue,
  crawlLodestoneList,
  extractLodestoneItemList,
  extractLodestoneListMeta,
  lodestoneOrderSignature
} from './lodestone-source.mjs';
import { archivePipelineLogs } from './log-archive.mjs';
import { applyBackgroundCpuPriority, notifyMonitorFailure, runAutomaticPublication } from './auto-publish.mjs';
import { matchesAppliedSource, readAppliedLodestoneState } from './lodestone-applied-state.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..');
const pipelineRoot = path.join(repositoryRoot, 'pipeline');
const configPath = path.join(pipelineRoot, 'config', 'lodestone-monitor.local.json');
const legacyConfigPath = path.join(pipelineRoot, 'config', 'xivapi-monitor.local.json');
const logPath = path.join(pipelineRoot, 'logs', 'lodestone-monitor.txt');
const discordLimit = 2000;

function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' && fallback !== null) return fallback;
    throw error;
  }
}

function writeAtomic(file, content) {
  ensureDir(path.dirname(file));
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, content, 'utf8');
  fs.renameSync(temporary, file);
}

export function formatJstTimestamp(date = new Date()) {
  const shifted = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return `${shifted.toISOString().slice(0, -1)}+09:00`;
}

function log(message) {
  ensureDir(path.dirname(logPath));
  fs.appendFileSync(logPath, `[${formatJstTimestamp()}] ${message}\n`, 'utf8');
}

export function diffLodestoneState(previous, current) {
  const changes = [];
  for (const [key, label] of [
    ['Version', 'Version'],
    ['RecipeVersion', 'レシピVersion'],
    ['ItemCount', 'アイテム総数'],
    ['RecipeCount', 'レシピ総数'],
    ['ItemOrderSignature', 'アイテム順序']
  ]) {
    if (key === 'ItemOrderSignature' && current?.DeferredItemOrder) continue;
    if (previous?.[key] !== current?.[key]) {
      changes.push({ key, label, before: previous?.[key] ?? '未確認', after: current?.[key] ?? '未確認' });
    }
  }
  return changes;
}

export function buildMessage(changes, checkedAt) {
  const lines = ['**Lodestoneデータ更新を検出しました**', ''];
  for (const change of changes) {
    const before = change.key === 'ItemOrderSignature' ? String(change.before).slice(0, 12) : change.before;
    const after = change.key === 'ItemOrderSignature' ? String(change.after).slice(0, 12) : change.after;
    lines.push(`**${change.label}**: ${before} → ${after}`);
  }
  lines.push('', `確認日時: ${new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Tokyo' }).format(new Date(checkedAt))}`);
  return lines.join('\n').slice(0, discordLimit);
}

async function postDiscord(webhookUrl, content) {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } })
  });
  if (!response.ok) throw new Error(`Discord通知に失敗しました (HTTP ${response.status})`);
}

function validateWebhookUrl(value) {
  if (!/^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/[^/]+\/[^/]+$/.test(value || '')) {
    throw new Error('discordWebhookUrl が未設定または不正です');
  }
}

function readConfig() {
  return fs.existsSync(configPath) ? readJson(configPath) : readJson(legacyConfigPath);
}

export async function readLodestoneMonitorState({ previousState = {}, appliedState = null, delayMs = DEFAULT_LODESTONE_DELAY_MS, fetchImpl = fetch, deferChangedItemOrder = false } = {}) {
  const requestSequentially = createSequentialRequestQueue({
    delayMs,
    request: async url => {
      const response = await fetchImpl(url, { headers: { 'user-agent': 'ffxiv-recipe-lodestone-monitor/1.0' } });
      if (!response.ok) throw new Error(`Lodestoneの取得に失敗しました (HTTP ${response.status})`);
      return response.text();
    }
  });
  const itemFirstHtml = await requestSequentially(LODESTONE_ITEM_LIST_URL);
  const recipeFirstHtml = await requestSequentially(LODESTONE_RECIPE_LIST_URL);
  const itemMeta = extractLodestoneListMeta(itemFirstHtml);
  const recipeMeta = extractLodestoneListMeta(recipeFirstHtml);
  const orderState = [appliedState, previousState].find(state => state?.Version === itemMeta.version
    && state.ItemCount === itemMeta.total
    && /^[a-f0-9]{64}$/.test(state.ItemOrderSignature));
  const reuseOrder = Boolean(orderState);
  // A known metadata change already schedules a full audit. Let that audit
  // obtain the authoritative catalog instead of crawling it twice.
  const deferred = deferChangedItemOrder && !reuseOrder && previousState.initialized === true
    && (previousState.Version !== itemMeta.version || previousState.ItemCount !== itemMeta.total
      || previousState.RecipeVersion !== recipeMeta.version || previousState.RecipeCount !== recipeMeta.total);
  let itemOrderSignature = orderState?.ItemOrderSignature || '';
  if (!reuseOrder && !deferred) {
    const result = await crawlLodestoneList({
      baseUrl: LODESTONE_ITEM_LIST_URL,
      extractEntries: extractLodestoneItemList,
      fetchText: requestSequentially,
      firstHtml: itemFirstHtml
    });
    itemOrderSignature = lodestoneOrderSignature(applyDescendingSortOrder(result.entries, result.total));
  }
  return {
    Version: itemMeta.version,
    RecipeVersion: recipeMeta.version,
    ItemCount: itemMeta.total,
    RecipeCount: recipeMeta.total,
    ItemOrderSignature: itemOrderSignature,
    ReusedItemOrder: reuseOrder,
    ...(deferred ? { DeferredItemOrder: true } : {})
  };
}

export async function runMonitor({
  root = repositoryRoot,
  monitorStatePath = path.join(root, 'pipeline', 'state', 'lodestone-monitor.json'),
  config = readConfig(),
  readCurrent = readLodestoneMonitorState,
  publish = runAutomaticPublication,
  archive = archivePipelineLogs,
  logger = log,
  notifyFailure = notifyMonitorFailure
} = {}) {
  try {
    archive();
  } catch (error) {
    logger(`ログアーカイブエラー: ${String(error.message || error)}`);
  }
  validateWebhookUrl(config.discordWebhookUrl);
  const previousState = readJson(monitorStatePath, { initialized: false, consecutiveFailures: 0 });
  const checkedAt = formatJstTimestamp();
  let current;
  try {
    current = await readCurrent({
      previousState,
      deferChangedItemOrder: true,
      appliedState: readAppliedLodestoneState({ repositoryRoot: root }),
      delayMs: Math.max(0, Number(config.delayMs ?? DEFAULT_LODESTONE_DELAY_MS) || 0)
    });
  } catch (error) {
    return notifyFailure({ config, error });
  }
  const changes = previousState.initialized ? diffLodestoneState(previousState, current) : [];
  // Recheck the actual file after source reads, in case a manual update ran meanwhile.
  const alreadyApplied = matchesAppliedSource(readAppliedLodestoneState({ repositoryRoot: root }), current);
  const publication = readJson(path.join(root, 'pipeline', 'state', 'auto-publish.json'), {});
  const pendingPublication = ['generating', 'committed', 'pushed'].includes(publication.status);
  let outcome = alreadyApplied ? 'already-applied' : 'unchanged';
  if (pendingPublication || (changes.length && !alreadyApplied)) {
    const result = await publish({ config, current, repositoryRoot: root });
    outcome = result.status;
    if (outcome === 'disabled') return { initialized: previousState.initialized, changes, current, outcome };
    if (current.DeferredItemOrder) {
      const applied = readAppliedLodestoneState({ repositoryRoot: root });
      if (applied && ['Version', 'RecipeVersion', 'ItemCount', 'RecipeCount']
        .every(key => applied[key] === current[key])) {
        current.ItemOrderSignature = applied.ItemOrderSignature;
        delete current.DeferredItemOrder;
      }
    }
  }
  writeAtomic(monitorStatePath, `${JSON.stringify({
    initialized: true,
    lastCheckedAt: checkedAt,
    lastChangedAt: changes.length ? checkedAt : previousState.lastChangedAt || null,
    consecutiveFailures: 0,
    ...current,
    lastOutcome: outcome
  }, null, 2)}\n`);
  logger(outcome === 'already-applied'
    ? 'Item.jsonに反映済みのため、全更新を省略して監視基準を同期しました'
    : previousState.initialized ? (changes.length ? `更新を処理しました: ${changes.map(change => change.label).join('、')}` : '更新はありません') : '初回基準状態を保存しました');
  return { initialized: previousState.initialized, changes, current, outcome };
}

export async function testNotification() {
  const config = readConfig();
  validateWebhookUrl(config.discordWebhookUrl);
  const checkedAt = formatJstTimestamp();
  await postDiscord(config.discordWebhookUrl, `**Lodestone更新監視 テスト通知**\n\nDiscord Webhookへの送信に成功しました。\n送信日時: ${checkedAt}`);
  log('Discordテスト通知を送信しました');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  if (!applyBackgroundCpuPriority()) log('警告: 監視処理のCPU優先度を低く設定できませんでした');
  const operation = process.argv.includes('--test-notification') ? testNotification() : runMonitor();
  operation.catch(error => {
    log(`エラー: ${String(error.message || error).replace(/https:\/\/[^\s]+/g, '[URL]')}`);
    process.exitCode = 1;
  });
}
