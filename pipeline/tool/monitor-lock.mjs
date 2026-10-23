import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

// No automatic stale-lock deletion: a missing/reused PID or empty file is not
// proof that it is safe to remove another process's reservation.
export function acquireMonitorLock(lockPath) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  let handle;
  try { handle = fs.openSync(lockPath, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw Object.assign(new Error('監視ロックが存在します。実行中または中断状態を確認してください'), { code: 'MONITOR_LOCKED' });
  }
  const token = randomUUID();
  try {
    fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, hostname: os.hostname(), token, startedAt: new Date().toISOString() }));
    fs.fsyncSync(handle);
  } catch (error) {
    fs.closeSync(handle);
    // Preserve an uncertain reservation for operator inspection.
    throw error;
  }
  fs.closeSync(handle);
  return () => {
    try {
      if (JSON.parse(fs.readFileSync(lockPath, 'utf8')).token === token) fs.unlinkSync(lockPath);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  };
}
