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

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..');
const pipelineRoot = path.join(repositoryRoot, 'pipeline');
const configPath = path.join(pipelineRoot, 'config', 'lodestone-monitor.local.json');
const legacyConfigPath = path.join(pipelineRoot, 'config', 'xivapi-monitor.local.json');
const statePath = path.join(pipelineRoot, 'state', 'lodestone-monitor.json');
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
    ['ItemCount', 'アイテム総数'],
    ['RecipeCount', 'レシピ総数'],
    ['ItemOrderSignature', 'アイテム順序']
  ]) {
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

export async function readLodestoneMonitorState({ previousState = {}, delayMs = DEFAULT_LODESTONE_DELAY_MS } = {}) {
  const requestSequentially = createSequentialRequestQueue({
    delayMs,
    request: async url => {
      const response = await fetch(url, { headers: { 'user-agent': 'ffxiv-recipe-lodestone-monitor/1.0' } });
      if (!response.ok) throw new Error(`Lodestoneの取得に失敗しました (HTTP ${response.status})`);
      return response.text();
    }
  });
  const itemFirstHtml = await requestSequentially(LODESTONE_ITEM_LIST_URL);
  const recipeFirstHtml = await requestSequentially(LODESTONE_RECIPE_LIST_URL);
  const itemMeta = extractLodestoneListMeta(itemFirstHtml);
  const recipeMeta = extractLodestoneListMeta(recipeFirstHtml);
  const reuseOrder = previousState.Version === itemMeta.version
    && previousState.ItemCount === itemMeta.total
    && typeof previousState.ItemOrderSignature === 'string';
  let itemOrderSignature = previousState.ItemOrderSignature || '';
  if (!reuseOrder) {
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
    ReusedItemOrder: reuseOrder
  };
}

export async function runMonitor() {
  try {
    archivePipelineLogs();
  } catch (error) {
    log(`ログアーカイブエラー: ${String(error.message || error)}`);
  }
  const config = readConfig();
  validateWebhookUrl(config.discordWebhookUrl);
  const previousState = readJson(statePath, { initialized: false, consecutiveFailures: 0 });
  const checkedAt = formatJstTimestamp();
  let current;
  try {
    current = await readLodestoneMonitorState({
      previousState,
      delayMs: Math.max(0, Number(config.delayMs ?? DEFAULT_LODESTONE_DELAY_MS) || 0)
    });
  } catch (error) {
    return notifyMonitorFailure({ config, error });
  }
  const changes = previousState.initialized ? diffLodestoneState(previousState, current) : [];
  if (changes.length) await runAutomaticPublication({ config, current });
  writeAtomic(statePath, `${JSON.stringify({
    initialized: true,
    lastCheckedAt: checkedAt,
    lastChangedAt: changes.length ? checkedAt : previousState.lastChangedAt || null,
    consecutiveFailures: 0,
    ...current
  }, null, 2)}\n`);
  log(previousState.initialized ? (changes.length ? `更新を通知しました: ${changes.map(change => change.label).join('、')}` : '更新はありません') : '初回基準状態を保存しました');
  return { initialized: previousState.initialized, changes, current };
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
