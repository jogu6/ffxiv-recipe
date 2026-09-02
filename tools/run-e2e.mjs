import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const blockedOptions = new Set(['--config', '--fully-parallel', '--workers', '-c', '-j']);
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const managedPort = 4173;
const ownedServerStatePath = join(tmpdir(), 'ffxiv-recipe-e2e-server.json');

export function validateE2eArgs(args) {
  for (const arg of args) {
    const option = arg.split('=', 1)[0];
    if (blockedOptions.has(option)) {
      throw new Error(`E2Eの安定実行設定は上書きできません: ${arg}`);
    }
  }
  const fullRun = args.includes('--full');
  const hasTarget = args.some(arg => !arg.startsWith('-')) ||
    args.some(arg => arg === '--grep' || arg.startsWith('--grep='));
  if (!fullRun && !hasTarget) {
    throw new Error('全E2Eには明示指定 --full が必要です。通常は対象specまたは--grepを指定してください。');
  }
  return args.filter(arg => arg !== '--full');
}

export function createE2eEnvironment(source = process.env) {
  const env = { ...source, PLAYWRIGHT_MANAGED_SERVER: '1' };
  delete env.NO_COLOR;
  return env;
}

export async function assertPortAvailable(port = managedPort, host = '127.0.0.1') {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once('error', error => reject(new Error(
      `${port}番ポートが使用中のためE2Eを実行しません。既存サーバーは停止・再利用していません: ${error.code}`
    )));
    probe.listen({ port, host, exclusive: true }, () => probe.close(resolve));
  });
}

export function matchesOwnedServerIdentity(state, processInfo) {
  if (!state || !processInfo) return false;
  return Number(state.pid) === Number(processInfo.pid) &&
    String(state.executablePath).toLowerCase() === String(processInfo.executablePath).toLowerCase() &&
    String(processInfo.commandLine).includes('--owner-token') &&
    String(processInfo.commandLine).includes(String(state.ownerToken));
}

export function queryProcessIdentity(pid) {
  const targetPid = Number(pid);
  if (!Number.isSafeInteger(targetPid) || targetPid <= 0) return null;
  const script = [
    `$process = Get-CimInstance Win32_Process -Filter 'ProcessId = ${targetPid}' -ErrorAction SilentlyContinue`,
    'if ($null -eq $process) { exit 4 }',
    '[pscustomobject]@{ pid = $process.ProcessId; executablePath = $process.ExecutablePath; commandLine = $process.CommandLine } | ConvertTo-Json -Compress',
  ].join('; ');
  const result = spawnSync('pwsh.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script,
  ], { cwd: projectRoot, encoding: 'utf8', windowsHide: true, timeout: 5_000 });
  if (result.status !== 0 || !result.stdout.trim()) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

function removeOwnedServerState(ownerToken = null) {
  if (!existsSync(ownedServerStatePath)) return;
  if (ownerToken) {
    try {
      const current = JSON.parse(readFileSync(ownedServerStatePath, 'utf8'));
      if (current.ownerToken !== ownerToken) return;
    } catch {
      return;
    }
  }
  rmSync(ownedServerStatePath, { force: true });
}

function recoverStaleOwnedServer() {
  if (!existsSync(ownedServerStatePath)) return;
  let state;
  try {
    state = JSON.parse(readFileSync(ownedServerStatePath, 'utf8'));
  } catch {
    removeOwnedServerState();
    return;
  }
  const processInfo = queryProcessIdentity(state.pid);
  if (matchesOwnedServerIdentity(state, processInfo)) {
    spawnSync('taskkill.exe', ['/PID', String(state.pid), '/T', '/F'], { windowsHide: true });
  }
  removeOwnedServerState(state.ownerToken);
}

function writeOwnedServerState(server, executablePath, ownerToken) {
  const temporaryPath = `${ownedServerStatePath}.${process.pid}.${ownerToken}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify({
    schemaVersion: 1,
    pid: server.pid,
    executablePath,
    ownerToken,
    port: managedPort,
  })}\n`, 'utf8');
  renameSync(temporaryPath, ownedServerStatePath);
}

function resolvePython() {
  const result = spawnSync('py', ['-c', 'import sys; print(sys.executable)'], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error(`Python実行ファイルを解決できませんでした: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

async function waitForServer(child, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`E2E用サーバーが起動前に終了しました: ${child.exitCode}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${managedPort}/`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // 起動完了まで短時間だけ再試行する。
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('E2E用サーバーが15秒以内に起動しませんでした。');
}

async function stopOwnedProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  const exited = await Promise.race([
    new Promise(resolve => child.once('exit', () => resolve(true))),
    new Promise(resolve => setTimeout(() => resolve(false), 3_000)),
  ]);
  if (!exited && child.exitCode === null) {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  }
}

async function main() {
  const args = validateE2eArgs(process.argv.slice(2));
  recoverStaleOwnedServer();
  await assertPortAvailable();
  const pythonPath = resolvePython();
  const ownerToken = randomUUID();
  const server = spawn(pythonPath, [
    join(projectRoot, 'tools', 'serve-local-app.py'),
    '--port', String(managedPort),
    '--bind', '127.0.0.1',
    '--directory', join(projectRoot, 'site'),
    '--owner-token', ownerToken,
  ], {
    cwd: projectRoot,
    stdio: 'ignore',
    windowsHide: true,
  });
  const forwardSignal = () => server.kill('SIGTERM');
  process.once('SIGINT', forwardSignal);
  process.once('SIGTERM', forwardSignal);
  try {
    writeOwnedServerState(server, pythonPath, ownerToken);
    await waitForServer(server);
    const cli = require.resolve('@playwright/test/cli');
    const child = spawn(process.execPath, [cli, 'test', ...args], {
      cwd: projectRoot,
      stdio: 'inherit',
      env: createE2eEnvironment(),
    });
    const exit = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    process.exitCode = exit.signal ? 1 : (exit.code ?? 1);
  } finally {
    process.off('SIGINT', forwardSignal);
    process.off('SIGTERM', forwardSignal);
    await stopOwnedProcess(server);
    removeOwnedServerState(ownerToken);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
