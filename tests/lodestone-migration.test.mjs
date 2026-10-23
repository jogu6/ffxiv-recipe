import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { containedPath, portablePath, resolvePublicationPath } from '../pipeline/tool/publication-paths.mjs';
import { acquireMonitorLock } from '../pipeline/tool/monitor-lock.mjs';
import { inspectLodestoneOffline, validatePublicationJournal } from '../pipeline/tool/lodestone-monitor-preflight.mjs';
import { writeLodestoneAuditArtifact } from '../pipeline/tool/lodestone-audit.mjs';
import { saveRecipeMonitorBaseline } from '../pipeline/tool/lodestone-recipe-monitor.mjs';
import { runMonitor } from '../pipeline/tool/lodestone-update-monitor.mjs';
import { recoverPublicationCommit } from '../pipeline/tool/auto-publish-files.mjs';
import { parseMonitorArgs, runUbuntuMonitor } from '../tools/run-lodestone-monitor.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ffxiv-migration-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (relative, value) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value));
    return file;
  };
  return { root, write };
}

function snapshot(t) {
  const f = fixture(t);
  f.snapshotRelative = 'pipeline/state/auto-publish-files-example';
  f.write(`${f.snapshotRelative}/files.json`, ['site/data/Item.json']);
  f.write(`${f.snapshotRelative}/before/site/data/Item.json`, '{}');
  f.write('.git/index', 'original');
  return f;
}

function offlineFixture(t) {
  const f = fixture(t);
  const bytes = Buffer.from('{"Items":[]}');
  f.write('site/data/Item.json', bytes);
  const applied = { schemaVersion: 1, Version: '7.56', RecipeVersion: '7.56', ItemCount: 1,
    RecipeCount: 1, ItemOrderSignature: 'a'.repeat(64), AuditId: 'test-audit',
    AuditDataGeneration: 'b'.repeat(64), DataGeneration: 'c'.repeat(64),
    itemJsonSha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  f.write('pipeline/state/lodestone-applied.json', applied);
  f.write('pipeline/state/auto-publish.json', { status: 'published', snapshotRoot: 'Z:\\unknown\\old-backup' });
  const resource = { kind: 'recipe-list-page', key: 'end:1', completed: true,
    url: 'https://jp.finalfantasyxiv.com/lodestone/playguide/db/recipe/',
    ...writeLodestoneAuditArtifact(path.join(f.root, 'pipeline/cache/lodestone-audits'), applied.AuditId, 'recipe-list-page',
      '<p class="db-content__title--version">Version:Patch 7.56</p><span class="total">1</span>' +
      '<table><tr><td><span class="db-table__txt--type">木工師</span>' +
      '<a href="/lodestone/playguide/db/recipe/abc/" class="db-table__txt--detail_link">素材</a></td><td>10</td></tr></table>') };
  const db = new DatabaseSync(f.write('pipeline/cache/lodestone-audits.sqlite', ''));
  db.exec('CREATE TABLE audits (id TEXT, status TEXT); CREATE TABLE resources (audit_id TEXT, kind TEXT, resource_key TEXT, url TEXT, completed INTEGER, artifact_key TEXT, content_sha256 TEXT, raw_bytes INTEGER)');
  db.prepare('INSERT INTO audits VALUES (?, ?)').run(applied.AuditId, 'completed');
  db.prepare('INSERT INTO resources VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(applied.AuditId, resource.kind, resource.key, resource.url, 1, resource.artifactKey, resource.contentSha256, resource.rawBytes);
  db.close();
  saveRecipeMonitorBaseline({ root: f.root });
  return { ...f, resource };
}

function hashes(root) {
  const result = {};
  const visit = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else result[path.relative(root, file)] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    }
  };
  visit(root);
  return result;
}

test('portable and native snapshot paths resolve on the current OS; legacy Windows paths require an explicit root', t => {
  const f = snapshot(t);
  const native = path.join(f.root, f.snapshotRelative);
  assert.equal(portablePath(f.root, native), f.snapshotRelative);
  assert.equal(resolvePublicationPath(f.root, f.snapshotRelative, 'snapshot'), native);
  assert.equal(resolvePublicationPath(f.root, native, 'snapshot'), native);
  for (const old of ['C:\\Old Repo', 'D:\\移行元']) {
    const stored = path.win32.join(old, f.snapshotRelative);
    assert.throws(() => resolvePublicationPath(f.root, stored, 'snapshot'));
    assert.equal(resolvePublicationPath(f.root, stored, 'snapshot', { legacyRepositoryRoots: [old] }), native);
    assert.equal(resolvePublicationPath(f.root, path.win32.join(old, '.git/index'), 'index', { legacyRepositoryRoots: [old] }), path.join(f.root, '.git/index'));
  }
});

test('unknown, missing, traversal and escaping symlink paths fail closed', t => {
  const f = snapshot(t);
  for (const stored of ['../outside', '/outside', 'C:\\unknown\\pipeline\\state\\auto-publish-files-example',
    'pipeline/state/../auto-publish-files-example', 'pipeline/state/unrecognized', 'pipeline/state/auto-publish-files-missing']) {
    assert.throws(() => resolvePublicationPath(f.root, stored, 'snapshot'));
  }
  const outside = fixture(t);
  // Directory junctions also exercise the containment check on Windows.
  fs.symlinkSync(outside.root, path.join(f.root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => containedPath(f.root, 'escape/no-file', { mustExist: false }));
});

test('published journals ignore obsolete recovery paths without calling Git', t => {
  const { root } = fixture(t);
  assert.deepEqual(validatePublicationJournal({ root, publication: { status: 'published', snapshotRoot: 'invalid' },
    git: () => assert.fail('Git/recovery forbidden') }), { pending: false, recovery: false });
});

test('generating journals validate backups and exact legacy Git index before recovery', async t => {
  const f = snapshot(t);
  const sha = 'a'.repeat(40);
  f.write(`${f.snapshotRelative}/commit.json`, { indexPath: 'C:\\Old\\.git\\index', branch: 'main', baseCommit: 'b'.repeat(40), commitSha: sha });
  f.write(`${f.snapshotRelative}/original.index`, 'original');
  f.write(`${f.snapshotRelative}/reconciled.index`, 'reconciled');
  const calls = [];
  const git = args => { calls.push(args); return args.includes('--git-path') ? '.git/index' : sha; };
  assert.equal(validatePublicationJournal({ root: f.root, publication: { status: 'generating', snapshotRoot: 'C:\\Old\\pipeline\\state\\auto-publish-files-example' },
    legacyRepositoryRoots: ['C:\\Old'], git }).recovery, true);
  await recoverPublicationCommit({ repositoryRoot: f.root, snapshotRoot: path.join(f.root, f.snapshotRelative), legacyRepositoryRoots: ['C:\\Old'],
    run: async (_command, args) => ({ stdout: git(args) }), logger: { write() {} } });
  assert.equal(fs.readFileSync(path.join(f.root, '.git/index'), 'utf8'), 'reconciled');
  assert.ok(calls.every(args => ['cat-file', 'rev-parse'].includes(args[0])));
});

test('monitor lock refuses live, empty and stale reservations and never deletes a replaced lock', t => {
  const f = fixture(t);
  const lock = path.join(f.root, 'pipeline/state/lodestone-monitor.lock');
  const release = acquireMonitorLock(lock);
  assert.throws(() => acquireMonitorLock(lock), { code: 'MONITOR_LOCKED' });
  release();
  for (const value of ['', JSON.stringify({ pid: 2147483647 }), JSON.stringify({ pid: process.pid })]) {
    fs.writeFileSync(lock, value);
    assert.throws(() => acquireMonitorLock(lock), { code: 'MONITOR_LOCKED' });
    assert.equal(fs.readFileSync(lock, 'utf8'), value);
  }
  fs.unlinkSync(lock);
  const releaseNew = acquireMonitorLock(lock);
  fs.writeFileSync(lock, JSON.stringify({ token: 'different-owner' }));
  releaseNew();
  assert.equal(fs.existsSync(lock), true);
});

test('monitor-wide lock covers preflight, archiving, source reads and publication', async t => {
  const f = fixture(t);
  let unblock;
  const waiting = new Promise(resolve => { unblock = resolve; });
  const events = [];
  const options = { root: f.root, config: { discordWebhookUrl: 'https://discord.com/api/webhooks/1/test' },
    preflight: () => events.push('preflight'), archive: () => events.push('archive'), logger() {},
    readCurrent: async () => { events.push('source'); await waiting; return { Version: '7.56' }; },
    publish: () => assert.fail('publication forbidden'), notifyFailure: () => assert.fail('notification forbidden') };
  const first = runMonitor(options);
  assert.deepEqual(events, ['preflight', 'archive', 'source']);
  await assert.rejects(runMonitor(options), { code: 'MONITOR_LOCKED' });
  assert.deepEqual(events, ['preflight', 'archive', 'source']);
  unblock();
  await first;
  assert.equal(fs.existsSync(path.join(f.root, 'pipeline/state/lodestone-monitor.lock')), false);
  await assert.rejects(runMonitor({ ...options, preflight: () => { throw new Error('offline failure'); } }), /offline failure/);
  assert.equal(fs.existsSync(path.join(f.root, 'pipeline/state/lodestone-monitor.lock')), false);
});

test('offline inspection validates isolated SQLite and all baseline HTML without changing source files', t => {
  const f = offlineFixture(t);
  t.mock.method(globalThis, 'fetch', () => assert.fail('network forbidden'));
  const before = hashes(f.root);
  assert.deepEqual(inspectLodestoneOffline({ root: f.root }), { ok: true, status: 'published', pending: false, recovery: false,
    pages: 1, lockPresent: false, publicationLockPresent: false });
  assert.deepEqual(hashes(f.root), before);
});

test('offline inspection refuses corrupt data and preserves it', t => {
  for (const corrupt of ['item', 'artifact', 'sqlite', 'baseline']) {
    const f = offlineFixture(t);
    if (corrupt === 'item') f.write('site/data/Item.json', '{"changed":true}');
    if (corrupt === 'artifact') f.write(`pipeline/cache/lodestone-audits/${f.resource.artifactKey}`, 'invalid gzip');
    if (corrupt === 'sqlite') f.write('pipeline/cache/lodestone-audits.sqlite', 'invalid sqlite');
    if (corrupt === 'baseline') f.write('pipeline/cache/lodestone-recipe-monitor.json', { schemaVersion: 1, pages: [] });
    const before = hashes(f.root);
    assert.throws(() => inspectLodestoneOffline({ root: f.root }));
    assert.deepEqual(hashes(f.root), before);
  }
});

test('offline Ubuntu runner never loads monitor/config/credentials and rejects ambiguous CLI modes', async () => {
  const options = parseMonitorArgs(['--offline', '--root', '/fixture']);
  let checks = 0;
  await runUbuntuMonitor(options, { platform: 'win32', inspect: () => { checks++; return { ok: true }; },
    loadMonitor: () => assert.fail('monitor load forbidden') });
  assert.equal(checks, 1);
  assert.equal(parseMonitorArgs([]).mode, 'offline');
  for (const args of [['--run', '--offline'], ['--root'], ['--test-notification']]) assert.throws(() => parseMonitorArgs(args));
  await assert.rejects(runUbuntuMonitor({ ...options, mode: 'run' }, { platform: 'win32' }), /専用/);
});

test('Ubuntu online wiring checks readiness before credentials, rechecks under lock, and restores token environment', async () => {
  const events = [];
  const env = { GH_TOKEN: 'previous-fixture' };
  const options = { mode: 'run', root: '/fixture', configPath: '/fixture/config', tokenFile: '/fixture/token', legacyRepositoryRoots: [] };
  const config = { migration: { legacyRepositoryRoots: ['C:\\Old'] } };
  const dependencies = {
    platform: 'linux', env,
    readPrivate: file => { events.push(file.endsWith('config') ? 'config' : 'token'); return file.endsWith('config') ? JSON.stringify(config) : 'fixture-token'; },
    inspect: value => { events.push('inspect'); assert.deepEqual(value.legacyRepositoryRoots, ['C:\\Old']); return {}; },
    loadMonitor: async () => ({ runMonitor: async ({ preflight }) => {
      assert.equal(env.GH_TOKEN, 'fixture-token');
      preflight();
      throw new Error('simulated monitor failure');
    } }),
  };
  await assert.rejects(runUbuntuMonitor(options, dependencies), /simulated/);
  assert.equal(env.GH_TOKEN, 'previous-fixture');
  assert.deepEqual(events, ['config', 'inspect', 'token', 'inspect']);
  for (const lockName of ['lockPresent', 'publicationLockPresent']) {
    events.length = 0;
    await assert.rejects(runUbuntuMonitor(options, { ...dependencies, inspect: () => ({ [lockName]: true }) }), /ロック/);
    assert.deepEqual(events, ['config']);
    assert.equal(env.GH_TOKEN, 'previous-fixture');
  }
});

test('pending saved commits are verified locally and invalid recovery paths do not start Git', t => {
  const f = snapshot(t);
  for (const status of ['committed', 'pushed']) {
    const calls = [];
    const result = validatePublicationJournal({ root: f.root,
      publication: { status, commitSha: 'a'.repeat(40), baseCommit: 'b'.repeat(40), snapshotRoot: 'Z:\\unused' },
      git: args => { calls.push(args); return ''; } });
    assert.equal(result.pending, true);
    assert.equal(result.recovery, false);
    assert.ok(calls.length === 2 && calls.every(args => args[0] === 'cat-file'));
  }
  assert.throws(() => validatePublicationJournal({ root: f.root,
    publication: { status: 'generating', snapshotRoot: 'Q:\\unknown\\backup' },
    git: () => assert.fail('Git forbidden for unknown paths') }));
  assert.throws(() => validatePublicationJournal({ root: f.root,
    publication: { status: 'committed', commitSha: '--invalid' }, git: () => assert.fail('invalid SHA must be rejected') }));
});

test('offline checks preserve the old comparison baseline while a new applied audit awaits deployment', t => {
  for (const status of ['committed', 'pushed']) {
    const f = offlineFixture(t);
    const appliedFile = path.join(f.root, 'pipeline/state/lodestone-applied.json');
    const applied = JSON.parse(fs.readFileSync(appliedFile, 'utf8'));
    const db = new DatabaseSync(path.join(f.root, 'pipeline/cache/lodestone-audits.sqlite'));
    db.prepare('INSERT INTO audits VALUES (?, ?)').run('new-audit', 'completed');
    db.exec("INSERT INTO resources SELECT 'new-audit', kind, resource_key, url, completed, artifact_key, content_sha256, raw_bytes FROM resources WHERE audit_id = 'test-audit'");
    db.close();
    f.write('pipeline/state/lodestone-applied.json', { ...applied, AuditId: 'new-audit' });
    f.write('pipeline/state/auto-publish.json', { status, commitSha: 'a'.repeat(40) });
    const before = hashes(f.root);
    const result = inspectLodestoneOffline({ root: f.root, git: args => { assert.equal(args[0], 'cat-file'); return ''; } });
    assert.equal(result.pending, true);
    assert.deepEqual(hashes(f.root), before);
  }
});

test('offline generating validation uses a verified backup when generation changed Item.json', t => {
  const f = offlineFixture(t);
  const item = fs.readFileSync(path.join(f.root, 'site/data/Item.json'));
  const relative = 'pipeline/state/auto-publish-files-interrupted';
  f.write(`${relative}/files.json`, ['site/data/Item.json']);
  f.write(`${relative}/before/site/data/Item.json`, item);
  f.write('pipeline/state/auto-publish.json', { status: 'generating', snapshotRoot: relative });
  f.write('site/data/Item.json', '{"incomplete":true}');
  const before = hashes(f.root);
  const result = inspectLodestoneOffline({ root: f.root });
  assert.equal(result.recovery, true);
  assert.deepEqual(hashes(f.root), before);
});
