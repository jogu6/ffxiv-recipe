import { spawnSync } from 'node:child_process';

export function resolvePython({ platform = process.platform, run = spawnSync } = {}) {
  const command = platform === 'win32' ? 'py' : 'python3';
  const probe = platform === 'win32'
    ? 'import sys; print(sys.executable)'
    : 'import os, sys; print(os.path.realpath(sys.executable))';
  const result = run(command, ['-c', probe], {
    encoding: 'utf8', windowsHide: true,
  });
  if (result.status !== 0 || !result.stdout?.trim()) {
    throw new Error(`Python実行ファイルを解決できませんでした (${command}): ${result.error?.message || result.stderr?.trim() || '実行に失敗しました'}`);
  }
  return result.stdout.trim();
}
