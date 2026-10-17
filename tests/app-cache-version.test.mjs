import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { expectedAppCacheVersion, updateAppCacheVersion, updateReportBuildIds } from '../tools/app-cache-version.mjs';

test('data cache updates preserve the shell identity without requiring or touching macro artifacts', t => {
  const siteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xivca-data-cache-'));
  t.after(() => fs.rmSync(siteRoot, { recursive: true, force: true }));
  const serviceWorkerPath = path.join(siteRoot, 'sw.js');
  fs.writeFileSync(serviceWorkerPath, "const APP_CACHE_VERSION = 'ff14recipe-app-v4.03-original';\nconst PRECACHE_FILES = ['./app.js', './macro-app/build/engine.wasm'];\n");
  fs.writeFileSync(path.join(siteRoot, 'app.js'), "const REPORT_BUILD_ID = 'old';\nconst DATA_CACHE_VERSION = 'one';\n");
  fs.writeFileSync(path.join(siteRoot, 'item-icon-pack.js'), "const PACK_VERSION = 'one';\n");
  const update = () => updateAppCacheVersion({ siteRoot, serviceWorkerPath, dataOnly: true });
  const first = update();
  assert.match(first, /^ff14recipe-app-v4\.03-original-data-[0-9a-f]{12}$/u);
  assert.equal(update(), first);
  fs.appendFileSync(path.join(siteRoot, 'app.js'), 'const next = true;\n');
  assert.notEqual(update(), first);
  assert.equal(fs.existsSync(path.join(siteRoot, 'macro-app')), false);
  assert.throws(() => updateAppCacheVersion({ siteRoot, serviceWorkerPath }), /プリキャッシュ対象がありません/);
});

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
