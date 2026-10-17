import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { updateAppCacheVersion } from '../tools/app-cache-version.mjs';
import {
  createItemIconPack, JOB_ICON_PACK_NAMES,
  extractItemIconPack,
  parseItemIconPack,
  validateItemIconPack
} from '../pipeline/tool/item-icon-pack.mjs';

function webp(label) {
  const payload = Buffer.from(label);
  const bytes = Buffer.alloc(12 + payload.length);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(payload.length + 4, 4);
  bytes.write('WEBP', 8, 'ascii');
  payload.copy(bytes, 12);
  return bytes;
}

function iconFile(name, bytes) {
  const nameHash = crypto.createHash('sha256').update(name, 'utf8').digest('hex').slice(0, 20);
  const contentHash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  return `${nameHash}-${contentHash}.webp`;
}

test('data-only site validation needs no macro runtime and rejects broken references and icon packs', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xivca-data-validation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const siteRoot = path.join(root, 'site');
  fs.mkdirSync(path.join(siteRoot, 'data'), { recursive: true });
  fs.copyFileSync(path.resolve(import.meta.dirname, '../site/pwa-update.js'), path.join(siteRoot, 'pwa-update.js'));
  const jobPath = path.join(root, 'job.webp');
  fs.writeFileSync(jobPath, webp('job'));
  const document = { Version: '7.57', Items: [{ Name: '素材' }] };
  const pack = createItemIconPack({ document, iconsRoot: root,
    additionalFiles: JOB_ICON_PACK_NAMES.map(file => ({ key: `job-icons/${file}`, source: jobPath })) });
  const itemPath = path.join(siteRoot, 'data/Item.json');
  const packPath = path.join(siteRoot, 'data/item-icons.pack.gz');
  fs.writeFileSync(itemPath, JSON.stringify(document));
  fs.writeFileSync(packPath, zlib.gzipSync(pack.bytes));
  fs.writeFileSync(path.join(siteRoot, 'data/legacy-item-ids.json'), '{"Items":{}}');
  fs.writeFileSync(path.join(siteRoot, 'app.js'), "const DATA_CACHE_VERSION = 'test';\n");
  const packHash = parseItemIconPack({ document, bytes: pack.bytes,
    additionalKeys: JOB_ICON_PACK_NAMES.map(file => `job-icons/${file}`) }).bodyHash;
  fs.writeFileSync(path.join(siteRoot, 'item-icon-pack.js'), `const PACK_VERSION = '${packHash}';\n`);
  fs.writeFileSync(path.join(siteRoot, 'sw.js'), "const APP_CACHE_VERSION = 'ff14recipe-app-v4.03-base';\nconst DATA_CACHE_VERSION = 'test';\nconst PRECACHE_FILES = ['./macro-app/build/engine.wasm'];\n");
  updateAppCacheVersion({ siteRoot, serviceWorkerPath: path.join(siteRoot, 'sw.js'), dataOnly: true });
  const validate = () => execFileSync(process.execPath,
    [path.resolve(import.meta.dirname, '../tools/validate-site.mjs'), '--root', root, '--data-only'],
    { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.match(validate(), /Validated 1 name-key items/);
  assert.equal(fs.existsSync(path.join(siteRoot, 'macro-app')), false);
  document.Items[0].Recipe = { Ingredients: [{ Name: '存在しない素材', Amount: 1 }] };
  fs.writeFileSync(itemPath, JSON.stringify(document));
  assert.throws(validate, error => /Invalid public Item.json projection/.test(String(error.stderr)));
  delete document.Items[0].Recipe;
  fs.writeFileSync(itemPath, JSON.stringify(document));
  fs.writeFileSync(packPath, Buffer.from('broken gzip'));
  assert.throws(validate);
});

test('item icon pack validates deterministic names and extracts only item images', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xivca-icon-pack-'));
  const source = path.join(root, 'source');
  const output = path.join(root, 'output');
  const itemBytes = webp('item');
  const jobBytes = webp('job');
  const file = iconFile('テスト素材', itemBytes);
  const itemPath = path.join(source, file.slice(0, 3), file);
  const jobPath = path.join(root, 'job.webp');
  fs.mkdirSync(path.dirname(itemPath), { recursive: true });
  fs.writeFileSync(itemPath, itemBytes);
  fs.writeFileSync(jobPath, jobBytes);
  const document = { Items: [{ Name: 'テスト素材', IconFile: file }] };
  const pack = createItemIconPack({
    document,
    iconsRoot: source,
    additionalFiles: [{ key: 'job-icons/test.webp', source: jobPath }]
  });

  assert.deepEqual(parseItemIconPack({ document, bytes: pack.bytes, additionalKeys: ['job-icons/test.webp'] }).files, [
    file,
    'job-icons/test.webp'
  ]);
  assert.equal(validateItemIconPack({ document, bytes: pack.bytes, additionalKeys: ['job-icons/test.webp'] }).icons, 1);
  assert.deepEqual(extractItemIconPack({
    document,
    bytes: pack.bytes,
    iconsRoot: output,
    additionalKeys: ['job-icons/test.webp']
  }), {
    bodyHash: pack.bytes.subarray(16, 48).toString('hex'),
    icons: 1,
    reused: 0,
    written: 1
  });
  assert.deepEqual(fs.readFileSync(path.join(output, file.slice(0, 3), file)), itemBytes);
  assert.equal(fs.existsSync(path.join(output, 'job-icons', 'test.webp')), false);
});

test('item icon pack rejects body corruption before extraction', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xivca-icon-pack-corrupt-'));
  const bytes = webp('item');
  const file = iconFile('破損試験', bytes);
  const itemPath = path.join(root, file.slice(0, 3), file);
  fs.mkdirSync(path.dirname(itemPath), { recursive: true });
  fs.writeFileSync(itemPath, bytes);
  const document = { Items: [{ Name: '破損試験', IconFile: file }] };
  const pack = createItemIconPack({ document, iconsRoot: root });
  pack.bytes[pack.bytes.length - 1] ^= 0xff;
  assert.throws(() => validateItemIconPack({ document, bytes: pack.bytes }), /body hash mismatch/);
});
