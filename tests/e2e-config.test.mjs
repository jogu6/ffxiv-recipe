import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { validateE2eArgs } from '../tools/run-e2e.mjs';

const require = createRequire(import.meta.url);
const config = require('../playwright.config.js');

test('Playwright runs E2E sequentially with an owned web server', () => {
  assert.equal(config.fullyParallel, false);
  assert.equal(config.workers, 1);
  assert.equal(config.webServer.reuseExistingServer, false);
  assert.equal(config.webServer.command, 'py -m http.server 4173 --bind 0.0.0.0 --directory site');
  assert.ok(config.webServer.timeout >= 120000);
});

test('E2E runner rejects stability overrides', () => {
  assert.doesNotThrow(() => validateE2eArgs(['--grep', 'shop dialog']));
  assert.throws(() => validateE2eArgs(['--workers=4']), /上書きできません/);
  assert.throws(() => validateE2eArgs(['--config', 'other.config.js']), /上書きできません/);
});
