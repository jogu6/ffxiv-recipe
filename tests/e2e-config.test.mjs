import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePython } from '../tools/python-runtime.mjs';
import { devServerArgs } from '../tools/run-dev-server.mjs';
import {
  createE2eEnvironment,
  assertPortAvailable,
  matchesOwnedServerIdentity,
  queryProcessIdentity,
  stopLinuxOwnedProcess,
  validateE2eArgs,
} from '../tools/run-e2e.mjs';

const require = createRequire(import.meta.url);
const config = require('../playwright.config.js');
const packageJson = require('../package.json');

test('Playwright runs spec files with bounded workers and never starts or reuses an unmanaged server', () => {
  assert.equal(config.testMatch, '**/*.spec.js');
  assert.equal(config.fullyParallel, false);
  assert.ok(config.workers >= 2 && config.workers <= 4);
  assert.equal(config.use.serviceWorkers, 'block');
  assert.equal(config.webServer, undefined);
});

test('E2E runner rejects stability overrides', () => {
  assert.doesNotThrow(() => validateE2eArgs(['--grep', 'shop dialog']));
  assert.throws(() => validateE2eArgs(['--workers=4']), /上書きできません/);
  assert.throws(() => validateE2eArgs(['--config', 'other.config.js']), /上書きできません/);
});

test('E2E runner requires an explicit target or --full', () => {
  assert.throws(() => validateE2eArgs([]), /--full/);
  assert.deepEqual(validateE2eArgs(['--full']), []);
  assert.deepEqual(validateE2eArgs(['tests/app-core.spec.js']), ['tests/app-core.spec.js']);
  assert.deepEqual(validateE2eArgs(['--grep', 'お気に入り']), ['--grep', 'お気に入り']);
});

test('E2E runner does not pass conflicting Node color variables to workers', () => {
  assert.deepEqual(
    createE2eEnvironment({ NO_COLOR: '1', FORCE_COLOR: '', PATH: 'example' }),
    { FORCE_COLOR: '', PATH: 'example', PLAYWRIGHT_MANAGED_SERVER: '1' }
  );
  assert.deepEqual(createE2eEnvironment({ NO_COLOR: '1', PATH: 'example' }), {
    PATH: 'example', PLAYWRIGHT_MANAGED_SERVER: '1'
  });
});

test('E2E server ownership requires pid, executable, and private token to match', () => {
  const state = { pid: 123, executablePath: 'C:\\Python\\python.exe', ownerToken: 'owned-token' };
  assert.equal(matchesOwnedServerIdentity(state, {
    pid: 123,
    executablePath: 'c:\\python\\PYTHON.EXE',
    commandLine: 'python serve-local-app.py --owner-token owned-token',
  }, 'win32'), true);
  assert.equal(matchesOwnedServerIdentity(state, {
    pid: 123,
    executablePath: 'C:\\Python\\python.exe',
    commandLine: 'python serve-local-app.py',
  }, 'win32'), false);
  assert.equal(matchesOwnedServerIdentity(state, {
    pid: 999,
    executablePath: 'C:\\Python\\python.exe',
    commandLine: 'python serve-local-app.py --owner-token owned-token',
  }, 'win32'), false);
});

test('stale ownership recovery can query the exact native process identity', () => {
  const identity = queryProcessIdentity(process.pid);
  assert.ok(identity);
  assert.equal(identity.pid, process.pid);
  assert.equal(realpathSync(identity.executablePath), realpathSync(process.execPath));
  assert.match(identity.commandLine, /e2e-config\.test\.mjs/);
});

test('an occupied port aborts E2E without stopping or reusing its server', async () => {
  const existing = createServer();
  await new Promise((resolve, reject) => {
    existing.once('error', reject);
    existing.listen({ host: '127.0.0.1', port: 0 }, resolve);
  });
  try {
    const { port } = existing.address();
    await assert.rejects(assertPortAvailable(port), /停止・再利用していません/);
    assert.equal(existing.listening, true);
  } finally {
    await new Promise(resolve => existing.close(resolve));
  }
});

test('frequent checks preserve the full gates while offering scoped app E2E', () => {
  assert.match(packageJson.scripts.check, /npm-run-all --parallel/);
  assert.equal(packageJson.scripts['test:e2e'], 'node tools/run-e2e.mjs');
  assert.equal(packageJson.scripts['test:e2e:app'], 'node tools/run-e2e.mjs tests/app-');
  assert.equal(
    packageJson.scripts['test:pipeline:gui'],
    'node tools/run-e2e.mjs tests/pipeline-gui.spec.js'
  );
});

test('process identity rejects invalid and absent PIDs', () => {
  for (const pid of [0, -1, 1.5, NaN, 'invalid', 2147483647]) {
    assert.equal(queryProcessIdentity(pid), null);
  }
});

test('Linux ownership requires exact executable and token argument matches', () => {
  const state = { pid: 123, executablePath: '/usr/bin/python3', ownerToken: 'owned-token' };
  const identity = { pid: 123, executablePath: '/usr/bin/python3', args: ['python3', 'serve-local-app.py', '--owner-token', 'owned-token'] };
  assert.equal(matchesOwnedServerIdentity(state, identity, 'linux'), true);
  for (const changed of [
    { pid: 999 },
    { executablePath: '/usr/bin/Python3' },
    { args: ['python3', '--owner-token', 'owned-token-extra'] },
    { args: ['python3', '--other', 'owned-token'] },
    { args: undefined },
  ]) assert.equal(matchesOwnedServerIdentity(state, { ...identity, ...changed }, 'linux'), false);
  assert.equal(matchesOwnedServerIdentity({ ...state, ownerToken: '' }, identity, 'linux'), false);
});

function ownedLinuxFixture() {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const state = { pid: 123, executablePath: '/usr/bin/python3', ownerToken: 'private-token' };
  const identity = { ...state, startedAt: '12345', args: [
    '/usr/bin/python3', join(root, 'tools', 'serve-local-app.py'),
    '--directory', join(root, 'site'), '--owner-token', state.ownerToken,
  ] };
  return { state, identity };
}

test('Linux termination refuses foreign, unverified, and other-project processes', async () => {
  const { state, identity } = ownedLinuxFixture();
  // Replace the --directory value by position: Windows paths end in \site, not /site.
  const directoryIndex = identity.args.indexOf('--directory') + 1;
  const otherProjectArgs = identity.args.with(directoryIndex, '/other/site');
  assert.notEqual(otherProjectArgs[directoryIndex], identity.args[directoryIndex]);
  for (const candidate of [null, { ...identity, pid: 999 },
    { ...identity, executablePath: '/other/python3' },
    { ...identity, startedAt: undefined },
    { ...identity, args: ['python3', '/other/serve-local-app.py', '--owner-token', state.ownerToken] },
    { ...identity, args: identity.args.map(arg => arg === state.ownerToken ? 'other-token' : arg) },
    { ...identity, args: otherProjectArgs },
  ]) {
    const signals = [];
    assert.equal(await stopLinuxOwnedProcess(state, { query: () => candidate, kill: (...args) => signals.push(args), delay: async () => {}, attempts: 1 }), false);
    assert.deepEqual(signals, []);
  }
});

test('Linux termination sends TERM only to the verified positive PID', async () => {
  const { state, identity } = ownedLinuxFixture();
  const signals = [];
  let running = true;
  assert.equal(await stopLinuxOwnedProcess(state, {
    query: () => running ? identity : null,
    kill: (...args) => { signals.push(args); running = false; },
  }), true);
  assert.deepEqual(signals, [[123, 'SIGTERM']]);
});

test('Linux force termination rechecks ownership and process start time', async () => {
  const { state, identity } = ownedLinuxFixture();
  for (const changed of [null, { ...identity, startedAt: 'new-process' },
    { ...identity, executablePath: '/other/python3' }]) {
    const signals = [];
    let current = identity;
    await stopLinuxOwnedProcess(state, {
      query: () => current, attempts: 1,
      delay: async () => { current = changed; },
      kill: (...args) => signals.push(args),
    });
    assert.deepEqual(signals, [[123, 'SIGTERM']]);
  }
  let current = identity;
  const signals = [];
  await stopLinuxOwnedProcess(state, {
    query: () => current, attempts: 1, delay: async () => {},
    kill: (...args) => { signals.push(args); if (args[1] === 'SIGKILL') current = null; },
  });
  assert.deepEqual(signals, [[123, 'SIGTERM'], [123, 'SIGKILL']]);
});

test('Linux termination reports permission errors and unconfirmed shutdown', async () => {
  const { state, identity } = ownedLinuxFixture();
  await assert.rejects(stopLinuxOwnedProcess(state, {
    query: () => identity, kill: () => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); },
  }), /denied/);
  await assert.rejects(stopLinuxOwnedProcess(state, {
    query: () => identity, kill: () => {}, attempts: 1, delay: async () => {},
  }), /終了を確認できません/);
});

test('Python resolution keeps the Windows launcher and uses python3 on Linux', () => {
  for (const [platform, expected] of [['win32', 'py'], ['linux', 'python3']]) {
    const calls = [];
    assert.equal(resolvePython({ platform, run: (...args) => {
      calls.push(args); return { status: 0, stdout: '/resolved/python\n' };
    } }), '/resolved/python');
    assert.equal(calls[0][0], expected);
    assert.equal(calls[0][1][0], '-c');
    assert.equal(calls[0][2].windowsHide, true);
  }
  for (const result of [{ status: null, error: new Error('ENOENT') },
    { status: 1, stderr: 'failed' }, { status: 0, stdout: '' }]) {
    assert.throws(() => resolvePython({ platform: 'linux', run: () => result }), /Python実行ファイル/);
  }
});

test('development server preserves port, bind address and Python HTTP server', () => {
  assert.equal(packageJson.scripts.dev, 'node tools/run-dev-server.mjs');
  assert.deepEqual(devServerArgs('/project with spaces/site'), [
    '-m', 'http.server', '4173', '--bind', '0.0.0.0', '--directory', '/project with spaces/site',
  ]);
});

test('installed Python resolves to a canonical executable on Linux', { skip: process.platform !== 'linux' }, () => {
  const executable = resolvePython();
  assert.equal(executable, realpathSync(executable));
});
