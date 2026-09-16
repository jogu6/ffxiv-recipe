import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildMessage, diffLodestoneState, formatJstTimestamp, readLodestoneMonitorState, runMonitor } from '../pipeline/tool/lodestone-update-monitor.mjs';
import { appliedStatePath, recordAppliedLodestoneState, readAppliedLodestoneState } from '../pipeline/tool/lodestone-applied-state.mjs';
import { recipeMonitorCachePath, recipeListPageContent, saveRecipeMonitorBaseline } from '../pipeline/tool/lodestone-recipe-monitor.mjs';
import { writeLodestoneAuditArtifact } from '../pipeline/tool/lodestone-audit.mjs';
import { openLodestoneAuditStore, createLodestoneAudit, planLodestoneAuditResources, completeLodestoneAuditResource, promoteCompletedLodestoneAudit } from '../pipeline/tool/lodestone-audit-store.mjs';
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

function recipePage(page, { total = 120, version = '7.56', change = '', noise = '' } = {}) {
  const start = (page - 1) * 50;
  return `<p class="db-content__title--version">Version:Patch ${version}</p><span class="total">${total}</span>`
    + '<table>' + Array.from({ length: Math.min(50, total - start) }, (_, i) => {
      const key = `r${start + i}`;
      return `<tr><td><span class="db-table__txt--type">木工師</span>`
        + `<a href="/lodestone/playguide/db/recipe/${key}/" class="db-table__txt--detail_link">品${key}${i === 0 ? change : ''}</a>`
        + `<img src="https://lds-img.finalfantasyxiv.com/itemicon/example.png?n7.56"></td><td>10</td><td>20</td></tr>`;
    }).join('') + `</table><aside>${noise}</aside>`;
}

function recipeFixture(t) {
  const fixture = appliedFixture(t, { record: false });
  fixture.recordOptions.snapshot.RecipeCount = 120;
  recordAppliedLodestoneState(fixture.recordOptions);
  saveFixtureAudit(fixture);
  const calls = [];
  const options = { root: fixture.root, delayMs: 0, fetchImpl: async url => {
    calls.push(url);
    const page = Number(new URL(url).searchParams.get('page') || 1);
    return { ok: true, text: async () => recipePage(page, { noise: `ranking-${Date.now()}` }) };
  } };
  return { ...fixture, calls, comparison: options };
}

function saveFixtureAudit(fixture, change = '') {
  const store = openLodestoneAuditStore(path.join(fixture.root, 'pipeline/cache/lodestone-audits.sqlite'));
  const auditId = fixture.recordOptions.snapshot.AuditId;
  createLodestoneAudit(store, { id: auditId });
  for (let page = 1; page <= 3; page += 1) {
    const resource = { kind: 'recipe-list-page', key: `end:${page}`,
      url: `https://jp.finalfantasyxiv.com/lodestone/playguide/db/recipe/${page === 1 ? '' : `?page=${page}`}` };
    planLodestoneAuditResources(store, auditId, [resource]);
    completeLodestoneAuditResource(store, auditId, { ...resource,
      ...writeLodestoneAuditArtifact(path.join(fixture.root, 'pipeline/cache/lodestone-audits'), auditId, resource.kind, recipePage(page, { change })) });
  }
  promoteCompletedLodestoneAudit(store, auditId);
  store.close();
}

test('recipe monitoring seeds HTML from the applied audit and compares every list page only', async t => {
  const f = recipeFixture(t);
  const result = await readLodestoneMonitorState(f.comparison);
  assert.equal(result.RecipeListChanged, false);
  assert.equal(result.CheckedRecipePages, 3);
  assert.equal(f.calls.length, 3);
  assert.ok(f.calls.every(url => url.includes('/db/recipe/')));
  const baseline = JSON.parse(fs.readFileSync(recipeMonitorCachePath(f.root)));
  assert.equal(baseline.auditId, f.recordOptions.snapshot.AuditId);
  assert.equal(baseline.pages.length, 3);
  const bytes = fs.readFileSync(recipeMonitorCachePath(f.root));
  await readLodestoneMonitorState(f.comparison);
  assert.deepEqual(fs.readFileSync(recipeMonitorCachePath(f.root)), bytes);
});

for (const scenario of ['name', 'level', 'order', 'icon', 'key']) {
  test(`recipe monitoring stops on a second-page ${scenario} change, even at identical version/count`, async t => {
    const f = recipeFixture(t);
    saveRecipeMonitorBaseline({ root: f.root });
    const before = fs.readFileSync(recipeMonitorCachePath(f.root));
    const result = await readLodestoneMonitorState({ ...f.comparison, fetchImpl: async url => {
      f.calls.push(url);
      const page = Number(new URL(url).searchParams.get('page') || 1);
      let html = recipePage(page);
      if (page === 2) {
        if (scenario === 'name') html = recipePage(page, { change: '変更' });
        if (scenario === 'level') html = html.replace('<td>10</td>', '<td>11</td>');
        if (scenario === 'key') html = html.replace('/recipe/r50/', '/recipe/replacement/');
        if (scenario === 'icon') html = html.replace('example.png', 'changed.png');
        if (scenario === 'order') {
          const rows = [...html.matchAll(/<tr>[\s\S]*?<\/tr>/g)];
          html = html.replace(rows[0][0] + rows[1][0], rows[1][0] + rows[0][0]);
        }
      }
      return { ok: true, text: async () => html };
    } });
    assert.equal(result.RecipeListChanged, true);
    assert.equal(result.RecipeListChange.page, 2);
    assert.equal(f.calls.length, 2);
    assert.ok(result.RecipeRefreshId);
    assert.deepEqual(fs.readFileSync(recipeMonitorCachePath(f.root)), before);
  });
}

for (const total of [121, 151, 100]) {
  test(`recipe monitoring stops at page one when total becomes ${total}`, async t => {
    const f = recipeFixture(t);
    const result = await readLodestoneMonitorState({ ...f.comparison, fetchImpl: async url => {
      f.calls.push(url);
      return { ok: true, text: async () => recipePage(1, { total }) };
    } });
    assert.equal(result.RecipeListChanged, true);
    assert.equal(result.RecipeCount, total);
    assert.equal(f.calls.length, 1);
  });
}

test('recipe row comparison ignores surrounding HTML, whitespace and icon query strings', () => {
  const original = recipePage(1);
  const changed = original.replaceAll('>10<', '>\n 10 \n<').replaceAll('?n7.56', '?different-cache-tag') + '<p>new ranking</p>';
  assert.deepEqual(recipeListPageContent(changed, 1), recipeListPageContent(original, 1));
});

for (const scenario of ['http', 'truncated', 'missing-count', 'duplicate', 'corrupt-cache']) {
  test(`recipe monitor reports ${scenario} as a failure and preserves its baseline`, async t => {
    const f = recipeFixture(t);
    const baseline = saveRecipeMonitorBaseline({ root: f.root });
    const before = fs.readFileSync(recipeMonitorCachePath(f.root));
    if (scenario === 'corrupt-cache') fs.writeFileSync(path.join(f.root, 'pipeline/cache/lodestone-audits', baseline.pages[0].artifactKey), 'invalid gzip');
    let html = recipePage(1);
    if (scenario === 'truncated') html = html.replace(/<tr>[\s\S]*?<\/tr>/, '');
    if (scenario === 'missing-count') html = html.replace('<span class="total">120</span>', '');
    if (scenario === 'duplicate') html = html.replace('/recipe/r1/', '/recipe/r0/');
    let failures = 0;
    const result = await runMonitor({ ...f.options,
      readCurrent: options => readLodestoneMonitorState({ ...options, fetchImpl: async () => ({ ok: scenario !== 'http', status: 503, text: async () => html }) }),
      notifyFailure: async () => { failures += 1; return { failed: true }; }
    });
    assert.equal(result.failed, true);
    assert.equal(failures, 1);
    assert.deepEqual(fs.readFileSync(recipeMonitorCachePath(f.root)), before);
  });
}

test('a recipe difference bypasses applied metadata; failed/disabled publication never promotes the cache', async t => {
  const f = recipeFixture(t);
  saveRecipeMonitorBaseline({ root: f.root });
  const before = fs.readFileSync(recipeMonitorCachePath(f.root));
  const monitor = { ...f.options, readCurrent: options => readLodestoneMonitorState({ ...options,
    fetchImpl: async () => ({ ok: true, text: async () => recipePage(1, { change: '更新' }) }) }) };
  let attempts = 0;
  await assert.rejects(runMonitor({ ...monitor, publish: async ({ current }) => {
    assert.equal(current.RecipeListChanged, true);
    assert.ok(current.RecipeRefreshId);
    attempts += 1;
    throw new Error('generation failed');
  } }), /generation failed/);
  await runMonitor({ ...monitor, publish: async () => { attempts += 1; return { status: 'disabled' }; } });
  assert.equal(attempts, 2);
  assert.deepEqual(fs.readFileSync(recipeMonitorCachePath(f.root)), before);
});

test('successful publication promotes HTML from the newly applied audit, never from the comparison fetch', async t => {
  const f = recipeFixture(t);
  saveRecipeMonitorBaseline({ root: f.root });
  const before = fs.readFileSync(recipeMonitorCachePath(f.root));
  const result = await runMonitor({ ...f.options,
    readCurrent: options => readLodestoneMonitorState({ ...options,
      fetchImpl: async () => ({ ok: true, text: async () => recipePage(1, { change: '比較時の変更' }) }) }),
    publish: async () => {
      assert.deepEqual(fs.readFileSync(recipeMonitorCachePath(f.root)), before);
      f.recordOptions.snapshot.AuditId = 'new-audit';
      f.recordOptions.candidate.AuditId = 'new-audit';
      saveFixtureAudit(f, '通常処理の取得結果');
      recordAppliedLodestoneState(f.recordOptions);
      return { status: 'published' };
    }
  });
  assert.equal(result.current.RecipeCount, 120);
  assert.equal(JSON.parse(fs.readFileSync(recipeMonitorCachePath(f.root))).auditId, 'new-audit');
  const comparison = await readLodestoneMonitorState({ ...f.comparison, fetchImpl: async url => ({ ok: true,
    text: async () => recipePage(Number(new URL(url).searchParams.get('page') || 1), { change: '通常処理の取得結果' }) }) });
  assert.equal(comparison.RecipeListChanged, false);
});

test('a source check without an applied baseline requests a complete update instead of adopting live HTML', async t => {
  const f = appliedFixture(t, { record: false });
  const result = await readLodestoneMonitorState({ root: f.root, delayMs: 0,
    fetchImpl: async () => ({ ok: true, text: async () => recipePage(1) }) });
  assert.equal(result.RecipeListChanged, true);
  assert.equal(result.RecipeListChange.reason, '比較元なし');
  assert.equal(fs.existsSync(recipeMonitorCachePath(f.root)), false);
});

test('a modified public file during list comparison is reported without advancing the baseline', async t => {
  const f = recipeFixture(t);
  saveRecipeMonitorBaseline({ root: f.root });
  const before = fs.readFileSync(recipeMonitorCachePath(f.root));
  const result = await runMonitor({ ...f.options, readCurrent: async options => {
    const current = await readLodestoneMonitorState({ ...options, fetchImpl: f.comparison.fetchImpl });
    fs.appendFileSync(f.itemJsonPath, ' ');
    return current;
  }, notifyFailure: async () => ({ failed: true }) });
  assert.equal(result.failed, true);
  assert.deepEqual(fs.readFileSync(recipeMonitorCachePath(f.root)), before);
});

for (const status of ['generating', 'committed', 'pushed']) {
  test(`recipe monitoring recovers ${status} before reading the live source`, async t => {
    const f = recipeFixture(t);
    const state = { status, targetVersion: '7.56', targetSource: { Version: '7.56', RecipeVersion: '7.56', RecipeCount: 120 },
      recipeRefreshId: 'saved-refresh', targetKey: 'saved-key' };
    fs.writeFileSync(path.join(f.root, 'pipeline/state/auto-publish.json'), JSON.stringify(state));
    const current = await readLodestoneMonitorState({ ...f.comparison, fetchImpl: async () => { throw new Error('通信禁止'); } });
    assert.equal(current.ResumePublication, true);
    assert.equal(current.RecipeRefreshId, 'saved-refresh');
    assert.equal(fs.existsSync(recipeMonitorCachePath(f.root)), false);
  });
}

for (const status of ['published', 'failed']) {
  test(`recipe change starts every generation stage despite applied metadata and a ${status} journal`, async t => {
    const f = appliedFixture(t);
    const targetKey = ['Version', 'RecipeVersion', 'ItemCount', 'RecipeCount', 'ItemOrderSignature'].map(key => f.current[key]).join('|');
    const statePath = path.join(f.root, 'pipeline/state/auto-publish.json');
    fs.writeFileSync(statePath, JSON.stringify({ status, targetKey, baseCommit: 'base', completedCommands: ['lodestone-audit', 'build-lodestone-candidate'] }));
    const calls = [];
    const result = await runAutomaticPublication({ repositoryRoot: f.root, statePath, config: f.options.config,
      current: { ...f.current, RecipeListChanged: true, RecipeRefreshId: 'new-comparison' },
      logger: { write() {} }, fetchImpl: async () => ({ ok: true }),
      prepareFiles: async () => ({ candidateRoot: f.root, changedFiles: [] }),
      run: async (command, args) => {
        calls.push(args);
        return { stdout: args[0] === 'branch' ? 'main' : args[0] === 'rev-parse' ? 'base' : '' };
      }
    });
    assert.equal(result.status, 'published');
    const audit = calls.find(args => args.includes('lodestone-audit'));
    assert.ok(audit.includes('--fresh'));
    assert.ok(calls.some(args => args.includes('build-lodestone-candidate')));
    assert.ok(calls.some(args => args.includes('publish-lodestone-candidate')));
    assert.equal(JSON.parse(fs.readFileSync(statePath)).recipeRefreshId, 'new-comparison');
  });
}
