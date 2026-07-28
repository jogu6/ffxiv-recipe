import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { validateE2eArgs } from '../tools/run-e2e.mjs';

const require = createRequire(import.meta.url);
const config = require('../playwright.config.js');

test('Playwright runs spec files with bounded file-level workers and allows reusing the test server', () => {
  assert.equal(config.testMatch, '**/*.spec.js');
  assert.equal(config.fullyParallel, false);
  assert.ok(config.workers >= 2 && config.workers <= 4);
  assert.equal(config.webServer.reuseExistingServer, true);
  assert.equal(config.webServer.command, 'py -m http.server 4173 --bind 0.0.0.0 --directory site');
  assert.ok(config.webServer.timeout >= 120000);
});

test('E2E runner rejects stability overrides', () => {
  assert.doesNotThrow(() => validateE2eArgs(['--grep', 'shop dialog']));
  assert.throws(() => validateE2eArgs(['--workers=4']), /上書きできません/);
  assert.throws(() => validateE2eArgs(['--config', 'other.config.js']), /上書きできません/);
});
