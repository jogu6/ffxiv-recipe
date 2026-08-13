import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { expectedAppCacheVersion } from '../tools/app-cache-version.mjs';

test('app cache version is independent of text file line endings', () => {
  const siteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xivca-app-cache-'));
  const serviceWorkerSource = `
const APP_CACHE_VERSION = 'ff14recipe-app-v3.2-current';
const PRECACHE_FILES = ['./app.js', './icon.png'];
`;
  try {
    fs.writeFileSync(path.join(siteRoot, 'app.js'), 'const value = 1;\r\n');
    fs.writeFileSync(path.join(siteRoot, 'icon.png'), Buffer.from([0, 13, 10, 255]));
    const windowsVersion = expectedAppCacheVersion({ siteRoot, serviceWorkerSource });
    fs.writeFileSync(path.join(siteRoot, 'app.js'), 'const value = 1;\n');
    const unixVersion = expectedAppCacheVersion({ siteRoot, serviceWorkerSource });
    assert.equal(windowsVersion, unixVersion);
  } finally {
    fs.rmSync(siteRoot, { recursive: true, force: true });
  }
});
