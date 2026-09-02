import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  createE2eEnvironment,
  assertPortAvailable,
  matchesOwnedServerIdentity,
  queryProcessIdentity,
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
  }), true);
  assert.equal(matchesOwnedServerIdentity(state, {
    pid: 123,
    executablePath: 'C:\\Python\\python.exe',
    commandLine: 'python serve-local-app.py',
  }), false);
  assert.equal(matchesOwnedServerIdentity(state, {
    pid: 999,
    executablePath: 'C:\\Python\\python.exe',
    commandLine: 'python serve-local-app.py --owner-token owned-token',
  }), false);
});

test('stale ownership recovery can query the exact Windows process identity', () => {
  const identity = queryProcessIdentity(process.pid);
  assert.equal(identity.pid, process.pid);
  assert.match(identity.executablePath, /node\.exe$/i);
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
