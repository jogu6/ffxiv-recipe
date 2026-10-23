import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readlinkSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resolvePython } from './python-runtime.mjs';

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

export function matchesOwnedServerIdentity(state, processInfo, platform = process.platform) {
  if (!state || !processInfo) return false;
  if (platform === 'linux') {
    const tokenIndex = processInfo.args?.indexOf('--owner-token') ?? -1;
    return Number.isSafeInteger(state.pid) && state.pid > 0 &&
      state.pid === processInfo.pid &&
      typeof state.executablePath === 'string' && state.executablePath.length > 0 &&
      state.executablePath === processInfo.executablePath &&
      typeof state.ownerToken === 'string' && state.ownerToken.length > 0 &&
      tokenIndex >= 0 && processInfo.args[tokenIndex + 1] === state.ownerToken;
  }
  return Number(state.pid) === Number(processInfo.pid) &&
    String(state.executablePath).toLowerCase() === String(processInfo.executablePath).toLowerCase() &&
    String(processInfo.commandLine).includes('--owner-token') &&
    String(processInfo.commandLine).includes(String(state.ownerToken));
}

export function queryProcessIdentity(pid) {
  const targetPid = Number(pid);
  if (!Number.isSafeInteger(targetPid) || targetPid <= 0) return null;
  if (process.platform === 'linux') {
    try {
      const executablePath = readlinkSync(`/proc/${targetPid}/exe`);
      const args = readFileSync(`/proc/${targetPid}/cmdline`, 'utf8').split('\0').slice(0, -1);
      if (!executablePath || !args.length) return null;
      const stat = readFileSync(`/proc/${targetPid}/stat`, 'utf8');
      const startedAt = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
      if (!startedAt) return null;
      return { pid: targetPid, executablePath, commandLine: args.join(' '), args, startedAt };
    } catch {
      // Missing processes and inaccessible identities cannot establish ownership.
      return null;
    }
  }
  if (process.platform !== 'win32') return null;
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

async function recoverStaleOwnedServer() {
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
    if (process.platform === 'linux') await stopLinuxOwnedProcess(state);
    else spawnSync('taskkill.exe', ['/PID', String(state.pid), '/T', '/F'], { windowsHide: true });
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

async function waitForServer(child, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`E2E用サーバーが起動前に終了しました: ${child.exitCode}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${managedPort}/`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
    } catch {
      // 起動完了まで短時間だけ再試行する。
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('E2E用サーバーが15秒以内に起動しませんでした。');
}

// Only positive, individually verified PIDs are signalled. Never signal a process group.
export async function stopLinuxOwnedProcess(state, {
  query = queryProcessIdentity,
  kill = process.kill,
  delay = ms => new Promise(resolve => setTimeout(resolve, ms)),
  attempts = 30,
} = {}) {
  const original = query(state?.pid);
  if (!matchesOwnedServerIdentity(state, original, 'linux')) return false;
  const script = join(projectRoot, 'tools', 'serve-local-app.py');
  const directoryIndex = original.args.indexOf('--directory');
  if (!original.args.includes(script) || directoryIndex < 0 ||
      original.args[directoryIndex + 1] !== join(projectRoot, 'site') || !original.startedAt) return false;
  const stillOwned = () => {
    const current = query(state.pid);
    return matchesOwnedServerIdentity(state, current, 'linux') &&
      current.startedAt === original.startedAt &&
      JSON.stringify(current.args) === JSON.stringify(original.args);
  };
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    if (!stillOwned()) return true;
    try { kill(state.pid, signal); }
    catch (error) { if (error.code === 'ESRCH') return true; throw error; }
    for (let i = 0; i < attempts; i++) {
      if (!stillOwned()) return true;
      await delay(100);
    }
  }
  throw new Error('所有するE2Eサーバーの終了を確認できませんでした。');
}

async function stopOwnedProcess(child, state) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'linux') {
    await stopLinuxOwnedProcess(state);
    return;
  }
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
  await recoverStaleOwnedServer();
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
  const state = { pid: server.pid, executablePath: pythonPath, ownerToken };
  // Linux cleanup always passes through the same ownership checks, including signals.
  const forwardSignal = () => {
    if (process.platform !== 'linux') { server.kill('SIGTERM'); return; }
    void stopOwnedProcess(server, state).catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', forwardSignal);
  process.once('SIGTERM', forwardSignal);
  try {
    await new Promise((resolve, reject) => {
      server.once('spawn', resolve);
      server.once('error', reject);
    });
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
    await stopOwnedProcess(server, state);
    removeOwnedServerState(ownerToken);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
