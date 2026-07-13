#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..');
const pipelineRoot = path.join(repositoryRoot, 'pipeline');
const sourcesPath = path.join(pipelineRoot, 'sources.json');
const configPath = path.join(pipelineRoot, 'config', 'xivapi-monitor.local.json');
const statePath = path.join(pipelineRoot, 'state', 'xivapi-monitor.json');
const cacheRoot = path.join(pipelineRoot, 'cache', 'xivapi-monitor');
const logPath = path.join(pipelineRoot, 'logs', 'xivapi-monitor.txt');
const itemSourceName = 'Item.csv';
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

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else field += character;
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

export function diffCsv(previousText, currentText, sourceName) {
  const previousRows = parseCsv(previousText);
  const currentRows = parseCsv(currentText);
  const headers = currentRows[0] || [];
  const nameIndex = sourceName === itemSourceName
    ? Math.max(headers.indexOf('Name'), headers.indexOf('Singular'))
    : -1;
  const toMap = rows => new Map(rows.slice(1).filter(row => /^\d+$/.test(row[0] || '')).map(row => [row[0], row]));
  const previous = toMap(previousRows);
  const current = toMap(currentRows);
  const added = [];
  const changed = [];
  const removed = [];
  for (const [id, row] of current) {
    if (!previous.has(id)) added.push({ id, name: nameIndex >= 0 ? row[nameIndex] || '' : '' });
    else if (JSON.stringify(previous.get(id)) !== JSON.stringify(row)) changed.push(id);
  }
  for (const id of previous.keys()) if (!current.has(id)) removed.push(id);
  return { added, changed, removed };
}

export function buildMessage(changes, checkedAt) {
  const lines = ['**XIVAPIデータ更新を検出しました**', ''];
  for (const change of changes) {
    const { added, changed, removed } = change.diff;
    lines.push(`**${change.name}**: 追加 ${added.length} / 変更 ${changed.length} / 削除 ${removed.length}`);
    if (change.name === itemSourceName && added.length) {
      const names = added.slice(0, 20).map(item => `${item.id} ${item.name || '(名称なし)'}`);
      lines.push(`新規アイテム: ${names.join('、')}${added.length > names.length ? `、ほか${added.length - names.length}件` : ''}`);
    }
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

export async function runMonitor() {
  const config = readJson(configPath);
  validateWebhookUrl(config.discordWebhookUrl);
  const sources = readJson(sourcesPath).remoteCsv || {};
  const previousState = readJson(statePath, { initialized: false, consecutiveFailures: 0 });
  const checkedAt = new Date().toISOString();
  const downloads = [];
  for (const [name, url] of Object.entries(sources)) {
    const response = await fetch(url, { headers: { 'user-agent': 'ffxiv-recipe-xivapi-monitor/1.0' } });
    if (!response.ok) throw new Error(`${name} の取得に失敗しました (HTTP ${response.status})`);
    const text = await response.text();
    downloads.push({ name, url, text, hash: sha256(text), cachePath: path.join(cacheRoot, name) });
  }
  const changes = [];
  if (previousState.initialized) {
    for (const download of downloads) {
      if (previousState.sources?.[download.name]?.sha256 === download.hash) continue;
      if (!fs.existsSync(download.cachePath)) throw new Error(`${download.name} の前回キャッシュがありません`);
      changes.push({ name: download.name, diff: diffCsv(fs.readFileSync(download.cachePath, 'utf8'), download.text, download.name) });
    }
  }
  if (changes.length) await postDiscord(config.discordWebhookUrl, buildMessage(changes, checkedAt));
  for (const download of downloads) writeAtomic(download.cachePath, download.text);
  writeAtomic(statePath, `${JSON.stringify({
    initialized: true,
    lastCheckedAt: checkedAt,
    lastChangedAt: changes.length ? checkedAt : previousState.lastChangedAt || null,
    consecutiveFailures: 0,
    sources: Object.fromEntries(downloads.map(download => [download.name, { url: download.url, sha256: download.hash }]))
  }, null, 2)}\n`);
  log(previousState.initialized ? (changes.length ? `更新を通知しました: ${changes.map(change => change.name).join(', ')}` : '更新はありません') : '初回基準状態を保存しました');
  return { initialized: previousState.initialized, changes };
}

export async function testNotification() {
  const config = readJson(configPath);
  validateWebhookUrl(config.discordWebhookUrl);
  const checkedAt = formatJstTimestamp();
  await postDiscord(config.discordWebhookUrl, `**XIVAPI更新監視 テスト通知**\n\nDiscord Webhookへの送信に成功しました。\n送信日時: ${checkedAt}`);
  log('Discordテスト通知を送信しました');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const operation = process.argv.includes('--test-notification') ? testNotification() : runMonitor();
  operation.catch(error => {
    log(`エラー: ${String(error.message || error).replace(/https:\/\/[^\s]+/g, '[URL]')}`);
    process.exitCode = 1;
  });
}
