#!/usr/bin/env node
// 既存のWindowsタスク用互換入口。監視対象はLodestoneへ移行済みです。
import path from 'node:path';
import process from 'node:process';
import { applyBackgroundCpuPriority } from './auto-publish.mjs';
import { runMonitor, testNotification } from './lodestone-update-monitor.mjs';

export { runMonitor, testNotification } from './lodestone-update-monitor.mjs';

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  applyBackgroundCpuPriority();
  const operation = process.argv.includes('--test-notification') ? testNotification() : runMonitor();
  operation.catch(error => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
