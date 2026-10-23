#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectLodestoneOffline } from '../pipeline/tool/lodestone-monitor-preflight.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..');

export function parseMonitorArgs(args) {
  const options = { root: repositoryRoot, mode: 'offline', legacyRepositoryRoots: [] };
  let modeSeen = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--offline' || arg === '--run' || arg === '--run-local') {
      if (modeSeen) throw new Error('実行モードは一つだけ指定してください');
      modeSeen = true;
      options.mode = arg.slice(2);
    } else if (['--root', '--config', '--token-file', '--legacy-root'].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error('オプションの値がありません');
      if (arg === '--legacy-root') options.legacyRepositoryRoots.push(value);
      else options[{ '--root': 'root', '--config': 'configPath', '--token-file': 'tokenFile' }[arg]] = path.resolve(value);
    } else throw new Error('未対応の起動オプションです');
  }
  return options;
}

function readPrivateFile(file) {
  const info = fs.statSync(file);
  if (!info.isFile() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid()) {
    throw new Error('設定・認証ファイルは実行ユーザー所有、権限600にしてください');
  }
  return fs.readFileSync(file, 'utf8');
}

export async function runUbuntuMonitor(options, {
  platform = process.platform, inspect = inspectLodestoneOffline,
  readPrivate = readPrivateFile,
  env = process.env,
  loadMonitor = () => import('../pipeline/tool/lodestone-update-monitor.mjs'),
} = {}) {
  if (options.mode === 'offline') {
    return inspect({ root: options.root, legacyRepositoryRoots: options.legacyRepositoryRoots });
  }
  if (!['run','run-local'].includes(options.mode) || platform !== 'linux') throw new Error('本ランナーの通常実行はUbuntu/Linux専用です');
  const localOnly=options.mode === 'run-local';
  const configPath = options.configPath || (localOnly
    ? path.join(options.root,'pipeline/config/lodestone-monitor.vps.local.json')
    : path.join(os.homedir(), '.config/ffxiv-recipe/lodestone-monitor.json'));
  const config = JSON.parse(readPrivate(configPath));
  const legacyRepositoryRoots = options.legacyRepositoryRoots.length
    ? options.legacyRepositoryRoots : config.migration?.legacyRepositoryRoots || [];
  config.migration = { ...config.migration, legacyRepositoryRoots };
  const preflight = () => {
    const result = inspect({ root: options.root, legacyRepositoryRoots });
    if (result.publicationLockPresent) throw new Error('公開ロックが存在するため起動しません');
    return result;
  };
  // Run once before loading credentials; repeat inside the monitor-wide lock.
  const result = preflight();
  if (result.lockPresent) throw new Error('監視ロックが存在するため起動しません');
  if (localOnly) {
    const {runLocalGeneration}=await import('../pipeline/tool/local-generation.mjs');
    const {runMonitor}=await loadMonitor();
    return runMonitor({root:options.root,config:{...config,autoPublish:{enabled:false}},preflight,
      notificationsEnabled:false,
      notifyFailure:async({error})=>{throw error},
      publish:({current})=>runLocalGeneration({root:options.root,current,config})});
  }
  const previousToken = env.GH_TOKEN;
  try {
    const token = readPrivate(options.tokenFile || path.join(os.homedir(), '.config/ffxiv-recipe/github-token')).trim();
    if (!token || /\s/.test(token)) throw new Error('GitHub認証ファイルの形式が不正です');
    env.GH_TOKEN = token;
    const { runMonitor } = await loadMonitor();
    return await runMonitor({ root: options.root, config, preflight });
  } finally {
    if (previousToken === undefined) delete env.GH_TOKEN;
    else env.GH_TOKEN = previousToken;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const options = parseMonitorArgs(process.argv.slice(2));
    const result = await runUbuntuMonitor(options);
    console.log(JSON.stringify(result, null, 2));
  } catch {
    // Do not echo configuration, subprocess output, webhook URLs, or token values.
    console.error('Lodestone監視を開始・検証できませんでした。設定・保存データ・ロック・認証を確認してください。');
    process.exitCode = 1;
  }
}
