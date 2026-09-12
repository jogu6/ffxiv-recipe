import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildMessage, diffLodestoneState, formatJstTimestamp, readLodestoneMonitorState, runMonitor } from '../pipeline/tool/lodestone-update-monitor.mjs';
import { appliedStatePath, recordAppliedLodestoneState, readAppliedLodestoneState } from '../pipeline/tool/lodestone-applied-state.mjs';
import { runAutomaticPublication } from '../pipeline/tool/auto-publish.mjs';

test('diffLodestoneState reports only changed Lodestone metadata', () => {
  const previous = { Version: '7.5', ItemCount: 45000, RecipeCount: 12000, ItemOrderSignature: 'a'.repeat(64) };
  const current = { Version: '7.55', ItemCount: 45160, RecipeCount: 12308, ItemOrderSignature: 'b'.repeat(64) };
  assert.deepEqual(diffLodestoneState(previous, current).map(change => change.key), [
    'Version',
    'ItemCount',
    'RecipeCount',
    'ItemOrderSignature'
  ]);
  assert.deepEqual(diffLodestoneState(current, { ...current }), []);
});

test('buildMessage describes Lodestone changes without exposing full signatures', () => {
  const changes = diffLodestoneState(
    { Version: '7.5', ItemCount: 45000, RecipeCount: 12000, ItemOrderSignature: 'a'.repeat(64) },
    { Version: '7.55', ItemCount: 45160, RecipeCount: 12308, ItemOrderSignature: 'b'.repeat(64) }
  );
  const message = buildMessage(changes, '2026-08-08T00:00:00Z');
  assert.match(message, /Lodestoneデータ更新/);
  assert.match(message, /アイテム総数.*45000.*45160/);
  assert.doesNotMatch(message, /b{64}/);
});

test('formatJstTimestamp formats timestamps with the JST offset', () => {
  assert.equal(formatJstTimestamp(new Date('2026-08-08T00:00:00.123Z')), '2026-08-08T09:00:00.123+09:00');
});

test('a definite update defers the full item catalog to the audit, without inventing its signature', async () => {
  const calls = [];
  const previous = { initialized: true, Version: '7.55', RecipeVersion: '7.55', ItemCount: 100,
    RecipeCount: 1, ItemOrderSignature: 'a'.repeat(64) };
  const result = await readLodestoneMonitorState({ previousState: previous, delayMs: 0,
    deferChangedItemOrder: true, fetchImpl: async url => {
      calls.push(url);
      return { ok: true, text: async () => '<p class="db-content__title--version">Version:Patch 7.56</p>'
        + `<span class="total">${url.includes('/item/') ? 45245 : 12308}</span>` };
    } });
  assert.equal(calls.length, 2);
  assert.equal(result.DeferredItemOrder, true);
  assert.equal(result.ItemOrderSignature, '');
  assert.ok(!diffLodestoneState(previous, result).some(change => change.key === 'ItemOrderSignature'));
  assert.ok(diffLodestoneState(previous, result).some(change => change.key === 'Version'));
});

test('deferred item order is replaced only by the verified publication receipt', async t => {
  const fixture = appliedFixture(t, { record: false });
  const result = await runMonitor({ ...fixture.options,
    readCurrent: async options => {
      assert.equal(options.deferChangedItemOrder, true);
      return { ...fixture.current, ItemOrderSignature: '', DeferredItemOrder: true };
    },
    publish: async () => { recordAppliedLodestoneState(fixture.recordOptions); return { status: 'published' }; }
  });
  assert.equal(result.current.ItemOrderSignature, fixture.current.ItemOrderSignature);
  assert.equal(result.current.DeferredItemOrder, undefined);
  assert.equal(JSON.parse(fs.readFileSync(fixture.monitorStatePath)).ItemOrderSignature, fixture.current.ItemOrderSignature);
});

test('legacy scheduled-task entry applies background CPU priority', () => {
  const source = fs.readFileSync(path.resolve('pipeline/tool/xivapi-update-monitor.mjs'), 'utf8');
  assert.match(source, /applyBackgroundCpuPriority\(\)/);
});

function appliedFixture(t, { record = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ffxiv-applied-monitor-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stateDirectory = path.join(root, 'pipeline', 'state');
  fs.mkdirSync(stateDirectory, { recursive: true });
  const itemJsonPath = path.join(root, 'site', 'data', 'Item.json');
  fs.mkdirSync(path.dirname(itemJsonPath), { recursive: true });
  const snapshot = {
    SchemaVersion: 3, AuditId: 'audit-756', DataGeneration: 'a'.repeat(64),
    Version: '7.56', ItemCount: 45245, RecipeCount: 12308, ItemOrderSignature: 'b'.repeat(64)
  };
  const candidate = {
    SchemaVersion: 3, AuditId: snapshot.AuditId, AuditDataGeneration: snapshot.DataGeneration,
    Version: snapshot.Version, DataGeneration: 'c'.repeat(64), Items: [{ Name: 'テスト素材' }]
  };
  fs.writeFileSync(itemJsonPath, JSON.stringify({
    Version: candidate.Version, DataGeneration: candidate.DataGeneration, Items: candidate.Items
  }));
  const recordOptions = { snapshot, candidate, itemJsonPath, statePath: appliedStatePath(root) };
  if (record) recordAppliedLodestoneState(recordOptions);
  const previous = {
    initialized: true, Version: '7.55', RecipeVersion: '7.55', ItemCount: 45160,
    RecipeCount: 12308, ItemOrderSignature: 'd'.repeat(64)
  };
  const monitorStatePath = path.join(stateDirectory, 'lodestone-monitor.json');
  fs.writeFileSync(monitorStatePath, JSON.stringify(previous));
  const current = { ...snapshot, RecipeVersion: snapshot.Version };
  const logs = [];
  const options = {
    root, config: { discordWebhookUrl: 'https://discord.com/api/webhooks/1/test', delayMs: 0 },
    archive() {}, logger: message => logs.push(message),
    readCurrent: async () => current,
    publish: async () => { throw new Error('反映済みデータの自動公開は禁止'); }
  };
  return { root, itemJsonPath, recordOptions, previous, current, monitorStatePath, options, logs };
}

test('manual publication synchronizes the monitor without publication or changing Item.json', async t => {
  const fixture = appliedFixture(t);
  const before = fs.readFileSync(fixture.itemJsonPath);
  const result = await runMonitor(fixture.options);
  assert.equal(result.outcome, 'already-applied');
  assert.equal(JSON.parse(fs.readFileSync(fixture.monitorStatePath)).Version, '7.56');
  assert.deepEqual(fs.readFileSync(fixture.itemJsonPath), before);
  assert.match(fixture.logs.join('\n'), /全更新を省略/);
  assert.equal(fs.existsSync(path.join(fixture.root, 'pipeline/state/auto-publish.json')), false);
  assert.equal((await runMonitor(fixture.options)).outcome, 'already-applied');
});

test('applied source avoids a full item-list crawl even when the monitor baseline is old', async t => {
  const fixture = appliedFixture(t);
  const calls = [];
  const result = await readLodestoneMonitorState({
    previousState: fixture.previous,
    appliedState: readAppliedLodestoneState({ repositoryRoot: fixture.root }),
    delayMs: 0,
    fetchImpl: async url => {
      calls.push(url);
      assert.ok(calls.length <= 2, '一覧全取得を開始しない');
      const count = calls.length === 1 ? 45245 : 12308;
      return { ok: true, text: async () => `<p class="db-content__title--version">Version:Patch 7.56</p><span class="total">${count}</span>` };
    }
  });
  assert.equal(calls.length, 2);
  assert.equal(result.ReusedItemOrder, true);
  assert.equal(result.ItemOrderSignature, fixture.current.ItemOrderSignature);
});

test('a genuinely new source still crawls the item list instead of reusing applied order', async t => {
  const fixture = appliedFixture(t);
  const result = await readLodestoneMonitorState({
    previousState: fixture.previous,
    appliedState: readAppliedLodestoneState({ repositoryRoot: fixture.root }), delayMs: 0,
    fetchImpl: async () => ({ ok: true, text: async () =>
      '<p class="db-content__title--version">Version:Patch 7.57</p><span class="total">1</span>'
      + '<tr><a href="/lodestone/playguide/db/item/abc123/" class="db-table__txt--detail_link">新素材</a></tr>' })
  });
  assert.equal(result.ReusedItemOrder, false);
  assert.notEqual(result.ItemOrderSignature, fixture.current.ItemOrderSignature);
});

for (const scenario of ['candidate-only', 'modified-item', 'invalid-record', 'new-source', 'recipe-version']) {
  test(`monitor does not skip an update for ${scenario}`, async t => {
    const fixture = appliedFixture(t, { record: scenario !== 'candidate-only' });
    if (scenario === 'modified-item') fs.appendFileSync(fixture.itemJsonPath, ' ');
    if (scenario === 'invalid-record') fs.writeFileSync(appliedStatePath(fixture.root), '{');
    if (scenario === 'new-source') fixture.current.ItemCount += 1;
    if (scenario === 'recipe-version') fixture.current.RecipeVersion = '7.57';
    let publications = 0;
    const result = await runMonitor({ ...fixture.options, publish: async () => {
      publications += 1;
      return { status: 'published' };
    } });
    assert.equal(publications, 1);
    assert.equal(result.outcome, 'published');
  });
}

test('an incomplete or mismatched candidate cannot create an applied receipt', t => {
  const fixture = appliedFixture(t, { record: false });
  const options = fixture.recordOptions;
  assert.throws(() => recordAppliedLodestoneState({ ...options,
    candidate: { ...options.candidate, AuditId: 'other-audit' }
  }), /監査・候補/);
  assert.throws(() => recordAppliedLodestoneState({ ...options,
    candidate: { ...options.candidate, Items: [{ Name: '未反映素材' }] }
  }), /Item.json/);
  assert.equal(fs.existsSync(appliedStatePath(fixture.root)), false);
});

for (const status of ['committed', 'pushed', 'generating']) {
  test(`pending ${status} publication is resumed even for applied data and an unchanged baseline`, async t => {
    const fixture = appliedFixture(t);
    fs.writeFileSync(fixture.monitorStatePath, JSON.stringify({ initialized: true, ...fixture.current }));
    fs.writeFileSync(path.join(fixture.root, 'pipeline/state/auto-publish.json'), JSON.stringify({ status }));
    let called = false;
    const result = await runMonitor({ ...fixture.options, publish: async () => {
      called = true;
      return { status: 'published' };
    } });
    assert.equal(called, true);
    assert.equal(result.outcome, 'published');
  });
}

test('failed or disabled publication keeps the old baseline for retry', async t => {
  const fixture = appliedFixture(t, { record: false });
  const baseline = fs.readFileSync(fixture.monitorStatePath, 'utf8');
  await assert.rejects(runMonitor({ ...fixture.options, publish: async () => { throw new Error('失敗'); } }), /失敗/);
  assert.equal(fs.readFileSync(fixture.monitorStatePath, 'utf8'), baseline);
  await runMonitor({ ...fixture.options, publish: async () => ({ status: 'disabled' }) });
  assert.equal(fs.readFileSync(fixture.monitorStatePath, 'utf8'), baseline);
});

test('automatic publication independently skips applied data before Git preflight', async t => {
  const fixture = appliedFixture(t);
  const statePath = path.join(fixture.root, 'pipeline/state/auto-publish.json');
  const failedState = JSON.stringify({ status: 'failed', targetVersion: '7.55' });
  fs.writeFileSync(statePath, failedState);
  const result = await runAutomaticPublication({
    config: fixture.options.config, current: fixture.current, repositoryRoot: fixture.root, statePath,
    logger: { write() {} },
    run: async () => { throw new Error('Git・生成コマンドは禁止'); },
    fetchImpl: async () => { throw new Error('通知は禁止'); }
  });
  assert.equal(result.status, 'already-applied');
  assert.equal(fs.readFileSync(statePath, 'utf8'), failedState);
});

test('recipe version changes are detected even when all other source metadata is unchanged', () => {
  const previous = { Version: '7.56', RecipeVersion: '7.56' };
  assert.deepEqual(diffLodestoneState(previous, { ...previous, RecipeVersion: '7.57' }).map(change => change.key), ['RecipeVersion']);
});

for (const status of ['committed', 'pushed']) {
  test(`applied data does not bypass actual ${status} deployment recovery`, async t => {
    const fixture = appliedFixture(t);
    const statePath = path.join(fixture.root, 'pipeline/state/auto-publish.json');
    const targetKey = ['Version', 'RecipeVersion', 'ItemCount', 'RecipeCount', 'ItemOrderSignature']
      .map(key => fixture.current[key]).join('|');
    fs.writeFileSync(statePath, JSON.stringify({ status, targetKey, commitSha: 'pending-sha' }));
    const calls = [];
    const result = await runAutomaticPublication({
      config: fixture.options.config, current: fixture.current, repositoryRoot: fixture.root, statePath,
      logger: { write() {} }, fetchImpl: async () => ({ ok: true }),
      run: async (command, args) => {
        calls.push(args[0]);
        assert.ok(args[0] === 'push' || (args[0] === 'run' && args[1] === 'list'));
        return { stdout: args[0] === 'push' ? '' : JSON.stringify([{
          headSha: 'pending-sha', status: 'completed', conclusion: 'success', url: 'https://example.test/deploy'
        }]) };
      }
    });
    assert.equal(result.status, 'published');
    assert.equal(calls.filter(command => command === 'push').length, status === 'committed' ? 1 : 0);
    assert.ok(calls.includes('run'));
  });
}

test('a manual file change during the source check invalidates the skip decision', async t => {
  const fixture = appliedFixture(t);
  let publications = 0;
  await runMonitor({ ...fixture.options,
    readCurrent: async ({ appliedState }) => {
      assert.ok(appliedState);
      fs.appendFileSync(fixture.itemJsonPath, ' ');
      return fixture.current;
    },
    publish: async () => { publications += 1; return { status: 'published' }; }
  });
  assert.equal(publications, 1);
});

test('a resolved order signature does not block recovery of a deferred committed update', async t => {
  const fixture = appliedFixture(t);
  const statePath = path.join(fixture.root, 'pipeline/state/auto-publish.json');
  const targetSource = Object.fromEntries(['Version', 'RecipeVersion', 'ItemCount', 'RecipeCount']
    .map(key => [key, fixture.current[key]]));
  fs.writeFileSync(statePath, JSON.stringify({ status: 'committed', deferredItemOrder: true,
    targetSource, targetVersion: fixture.current.Version, targetKey: Object.values(targetSource).join('|') + '|',
    commitSha: 'saved-commit' }));
  const calls = [];
  const result = await runAutomaticPublication({ config: fixture.options.config, current: fixture.current,
    repositoryRoot: fixture.root, statePath, logger: { write() {} }, fetchImpl: async () => ({ ok: true }),
    run: async (command, args) => {
      calls.push(args);
      if (args[0] === 'push') return { stdout: '' };
      assert.deepEqual(args.slice(0, 2), ['run', 'list']);
      return { stdout: JSON.stringify([{ headSha: 'saved-commit', status: 'completed', conclusion: 'success' }]) };
    }
  });
  assert.equal(result.status, 'published');
  assert.deepEqual(calls[0], ['push', 'origin', 'saved-commit:refs/heads/main']);
});
