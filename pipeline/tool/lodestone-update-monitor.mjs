#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { DEFAULT_LODESTONE_DELAY_MS } from './lodestone-source.mjs';
import { compareRecipeList, saveRecipeMonitorBaseline } from './lodestone-recipe-monitor.mjs';
import { compareLodestoneAcquisition } from './lodestone-acquisition-monitor.mjs';
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

export async function readLodestoneMonitorState(options = {}) {
  const current = await compareRecipeList(options);
  if (current.RecipeListChanged || current.ResumePublication) return current;
  return { ...current, ...await compareLodestoneAcquisition(options) };
}

export async function runMonitor({
  root = repositoryRoot,
  monitorStatePath = path.join(root, 'pipeline', 'state', 'lodestone-monitor.json'),
  config = readConfig(),
  readCurrent = readLodestoneMonitorState,
  publish = runAutomaticPublication,
  saveBaseline = saveRecipeMonitorBaseline,
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
      root,
      previousState,
      deferChangedItemOrder: true,
      onProgress: ({ page, pages, reason }) => {
        if (reason || page === 1 || page === pages || page % 25 === 0) {
          logger(`製作手帳の比較 ${page}/${pages}${reason ? `: ${reason}の差分を検出` : ''}`);
        }
      },
      onAcquisitionProgress: ({ completed, total, item }) => {
        if (completed === 1 || completed === total || completed % 250 === 0) logger(`入手情報の比較 ${completed}/${total}: ${item}`);
      },
      appliedState: readAppliedLodestoneState({ repositoryRoot: root }),
      delayMs: Math.max(0, Number(config.delayMs ?? DEFAULT_LODESTONE_DELAY_MS) || 0)
    });
  } catch (error) {
    return notifyFailure({ config, error });
  }
  // Recheck the actual file after source reads, in case a manual update ran meanwhile.
  const applied = readAppliedLodestoneState({ repositoryRoot: root });
  if (current.RecipeComparisonMode && !current.RecipeListChanged && !current.ResumePublication && !applied) {
    return notifyFailure({ config, error: new Error('一覧の比較中に反映済みItem.jsonが変更されました。再確認が必要です') });
  }
  const changes = current.RecipeComparisonMode
    ? [
      ...(current.RecipeListChanged ? [{ key: 'RecipeList', label: '製作手帳一覧', before: '比較元', after: current.RecipeListChange || '更新処理を再開' }] : []),
      ...(current.AcquisitionChanged ? [{ key: 'Acquisition', label: '交換条件・採集レベル', before: '公開データ', after: current.AcquisitionChange || '更新処理を再開' }] : [])
    ]
    : previousState.initialized ? diffLodestoneState(previousState, current) : [];
  const alreadyApplied = !current.RecipeListChanged && !current.AcquisitionChanged && matchesAppliedSource(applied, current);
  const publication = readJson(path.join(root, 'pipeline', 'state', 'auto-publish.json'), {});
  const pendingPublication = ['generating', 'committed', 'pushed'].includes(publication.status);
  let outcome = alreadyApplied ? 'already-applied' : 'unchanged';
  if (pendingPublication || (changes.length && !alreadyApplied)) {
    const result = await publish({ config, current, repositoryRoot: root });
    outcome = result.status;
    if (outcome !== 'published' && outcome !== 'already-applied') return { initialized: previousState.initialized, changes, current, outcome };
    if (current.RecipeComparisonMode) {
      const baseline = saveBaseline({ root });
      Object.assign(current, baseline.source);
      delete current.DeferredItemOrder;
    }
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
  logger(current.RecipeComparisonMode && !changes.length && !pendingPublication
    ? `製作手帳一覧の全${current.CheckedRecipePages}ページと入手情報${current.CheckedAcquisitionItems || 0}件が一致しました。更新はありません`
    : outcome === 'already-applied'
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
