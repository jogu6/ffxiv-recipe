import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { expectedAppCacheVersion, updateReportBuildIds } from '../tools/app-cache-version.mjs';

test('report build ID is stable across repeated builds and changes with the executing source', () => {
  const siteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xivca-report-id-'));
  const file = path.join(siteRoot, 'app.js');
  try {
    fs.writeFileSync(file, "const REPORT_BUILD_ID = '__REPORT_BUILD_ID__';\nconst value = 1;\n");
    updateReportBuildIds({ siteRoot });
    const first = fs.readFileSync(file, 'utf8');
    assert.match(first, /sha256:[0-9a-f]{64}/);
    updateReportBuildIds({ siteRoot });
    assert.equal(fs.readFileSync(file, 'utf8'), first);
    fs.writeFileSync(file, first.replace('value = 1', 'value = 2'));
    updateReportBuildIds({ siteRoot });
    assert.notEqual(fs.readFileSync(file, 'utf8'), first);
  } finally { fs.rmSync(siteRoot, { recursive: true, force: true }); }
});

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
