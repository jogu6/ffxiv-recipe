import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runLodestoneFullAudit, readLodestoneAuditArtifact } from '../pipeline/tool/lodestone-audit.mjs';
import {
  getPromotedLodestoneAudit,
  getLodestoneAudit,
  listLodestoneAuditResources,
  openLodestoneAuditStore
} from '../pipeline/tool/lodestone-audit-store.mjs';

const RECIPE_LIST_URL = 'https://jp.finalfantasyxiv.com/lodestone/playguide/db/recipe/';
const ITEM_LIST_URL = 'https://jp.finalfantasyxiv.com/lodestone/playguide/db/item/';
const RECIPE_DETAIL_URL = `${RECIPE_LIST_URL}aaa/`;

function listHtml(rows, total = rows.length, version = '7.55') {
  return `
    <p class="db-content__title--version">Version: Patch ${version}</p>
    <span class="total">${total}</span>
    <table>${rows.join('')}</table>
  `;
}

function recipeRow(name, key = 'aaa') {
  return `<tr><span class="db-table__txt--type">鍛冶師</span><a href="/lodestone/playguide/db/recipe/${key}/" class="db-table__txt--detail_link">${name}</a></tr>`;
}

function itemRow(name, key = 'itema') {
  return `<tr><span class="db-table__txt--type"><a>素材</a></span><a href="/lodestone/playguide/db/item/${key}/" class="db-table__txt--detail_link">${name}</a></tr>`;
}

function recipeDetailHtml({ amount = 1, ingredient = '素材', ingredientKey = 'material', ingredientAmount = 2 } = {}) {
  return `
    <main>鍛冶師 Lv 100
      <span class="js__complete_craft_count">${amount}</span>
      <p class="db-view__recipe__text__book_name">鍛冶秘伝書:第12巻</p>
      <div class="js__material db-tree" data-depth="1" data-key="${ingredientKey}" data-name="${ingredient}" data-num="${ingredientAmount}"></div>
    </main>`;
}

async function withAudit(action) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ffxiv-recipe-full-audit-'));
  const store = openLodestoneAuditStore(path.join(root, 'audit.sqlite'));
  try {
    await action({ store, artifactRoot: path.join(root, 'artifacts') });
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function initialComparison({ currentSnapshot }) {
  return {
    SchemaVersion: 1,
    PreviousAuditId: null,
    CurrentAuditId: currentSnapshot.AuditId,
    ItemChanges: { Renamed: [], Added: [], Removed: [] },
    RecipeChanges: { Renamed: [], ContentChanged: [], Added: [], Removed: [] },
    NameAliases: {}
  };
}

function runAudit(options) {
  return runLodestoneFullAudit({ createInitialComparison: initialComparison, ...options });
}

test('full Lodestone audit fetches every source fresh in one sequential queue and promotes it', async () => {
  await withAudit(async ({ store, artifactRoot }) => {
    const calls = [];
    let active = 0;
    let maxActive = 0;
    const recipeList = listHtml([recipeRow('完成品')]);
    const itemList = listHtml([itemRow('完成品')]);
    const request = async url => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      calls.push(url);
      await Promise.resolve();
      active -= 1;
      if (url === RECIPE_LIST_URL) return recipeList;
      if (url === ITEM_LIST_URL) return itemList;
      if (url === RECIPE_DETAIL_URL) return recipeDetailHtml();
      throw new Error(`unexpected URL: ${url}`);
    };

    const result = await runAudit({
      store,
      artifactRoot,
      request,
      delayMs: 0,
      createAuditId: () => 'audit-1',
      now: () => 100
    });

    assert.equal(maxActive, 1);
    assert.deepEqual(calls, [RECIPE_LIST_URL, RECIPE_DETAIL_URL, ITEM_LIST_URL, RECIPE_LIST_URL]);
    assert.equal(result.resumed, false);
    assert.equal(result.snapshot.AuditId, 'audit-1');
    assert.equal(result.snapshot.CheckedAt, '1970-01-01T09:00:00.100+09:00');
    assert.equal(result.snapshot.Items[0].Name, '完成品');
    assert.equal(result.snapshot.Recipes[0].AuditResourceKey, 'recipe:aaa');
    assert.equal(getPromotedLodestoneAudit(store).id, 'audit-1');
    const resources = listLodestoneAuditResources(store, 'audit-1');
    assert.equal(resources.length, 4);
    assert.ok(resources.every(resource => resource.completed));
    assert.match(readLodestoneAuditArtifact(artifactRoot, resources.find(resource => resource.kind === 'recipe-detail')), /素材/);
  });
});

test('first audit without an explicit baseline comparison cannot be promoted', async () => {
  await withAudit(async ({ store, artifactRoot }) => {
    const recipeList = listHtml([recipeRow('完成品')]);
    const itemList = listHtml([itemRow('完成品')]);
    const request = async url => {
      if (url === RECIPE_LIST_URL) return recipeList;
      if (url === ITEM_LIST_URL) return itemList;
      if (url === RECIPE_DETAIL_URL) return recipeDetailHtml();
      throw new Error(`unexpected URL: ${url}`);
    };

    await assert.rejects(
      () => runLodestoneFullAudit({
        store,
        artifactRoot,
        request,
        delayMs: 0,
        createAuditId: () => 'audit-no-baseline',
        now: () => 150
      }),
      /比較基準がないため昇格できません/
    );
    assert.equal(getPromotedLodestoneAudit(store), null);
    assert.equal(getLodestoneAudit(store, 'audit-no-baseline').status, 'running');
  });
});

test('full Lodestone audit resumes completed resources after a failed detail request', async () => {
  await withAudit(async ({ store, artifactRoot }) => {
    const recipeList = listHtml([recipeRow('完成品')]);
    const itemList = listHtml([itemRow('完成品')]);
    let failDetail = true;
    const calls = [];
    const request = async url => {
      calls.push(url);
      if (url === RECIPE_LIST_URL) return recipeList;
      if (url === ITEM_LIST_URL) return itemList;
      if (url === RECIPE_DETAIL_URL && failDetail) {
        failDetail = false;
        throw new Error('temporary failure');
      }
      if (url === RECIPE_DETAIL_URL) return recipeDetailHtml();
      throw new Error(`unexpected URL: ${url}`);
    };
    const options = {
      store,
      artifactRoot,
      request,
      delayMs: 0,
      createAuditId: () => 'audit-resume',
      now: () => 200
    };

    await assert.rejects(() => runAudit(options), /temporary failure/);
    assert.equal(getPromotedLodestoneAudit(store), null);
    assert.deepEqual(
      listLodestoneAuditResources(store, 'audit-resume').map(resource => [resource.key, resource.completed]),
      [['recipe:aaa', false], ['start:1', true]]
    );

    const resumed = await runAudit(options);
    assert.equal(resumed.resumed, true);
    assert.equal(resumed.auditId, 'audit-resume');
    assert.equal(getPromotedLodestoneAudit(store).id, 'audit-resume');
    assert.deepEqual(calls, [
      RECIPE_LIST_URL,
      RECIPE_DETAIL_URL,
      RECIPE_LIST_URL,
      RECIPE_DETAIL_URL,
      ITEM_LIST_URL,
      RECIPE_LIST_URL
    ]);
  });
});

test('end-of-audit recipe changes receive a fresh replacement detail before promotion', async () => {
  await withAudit(async ({ store, artifactRoot }) => {
    const startList = listHtml([recipeRow('旧完成品')]);
    const endList = listHtml([recipeRow('新完成品')]);
    const itemList = listHtml([itemRow('新完成品')]);
    let recipeListCalls = 0;
    let detailCalls = 0;
    const request = async url => {
      if (url === RECIPE_LIST_URL) {
        recipeListCalls += 1;
        return recipeListCalls === 1 ? startList : endList;
      }
      if (url === ITEM_LIST_URL) return itemList;
      if (url === RECIPE_DETAIL_URL) {
        detailCalls += 1;
        return recipeDetailHtml({ ingredientAmount: detailCalls });
      }
      throw new Error(`unexpected URL: ${url}`);
    };

    const result = await runAudit({
      store,
      artifactRoot,
      request,
      delayMs: 0,
      createAuditId: () => 'audit-recheck',
      now: () => 300
    });

    assert.equal(detailCalls, 2);
    assert.equal(result.snapshot.Recipes[0].Name, '新完成品');
    assert.equal(result.snapshot.Recipes[0].AuditResourceKey, 'recheck:aaa');
    assert.ok(listLodestoneAuditResources(store, 'audit-recheck').some(resource => resource.key === 'recheck:aaa'));
    assert.equal(getPromotedLodestoneAudit(store).id, 'audit-recheck');
  });
});

test('version drift abandons the inconsistent audit without promotion', async () => {
  await withAudit(async ({ store, artifactRoot }) => {
    const recipeList = listHtml([recipeRow('完成品')]);
    const itemList = listHtml([itemRow('完成品')], 1, '7.56');
    const request = async url => {
      if (url === RECIPE_LIST_URL) return recipeList;
      if (url === ITEM_LIST_URL) return itemList;
      if (url === RECIPE_DETAIL_URL) return recipeDetailHtml();
      throw new Error(`unexpected URL: ${url}`);
    };

    await assert.rejects(
      () => runAudit({
        store,
        artifactRoot,
        request,
        delayMs: 0,
        createAuditId: () => 'audit-drift',
        now: () => 400
      }),
      /Versionが一覧間で一致しません/
    );
    assert.equal(getLodestoneAudit(store, 'audit-drift').status, 'abandoned');
    assert.equal(getPromotedLodestoneAudit(store), null);
  });
});

test('a newly promoted audit compares against the previously promoted audit', async () => {
  await withAudit(async ({ store, artifactRoot }) => {
    let generation = 'old';
    const request = async url => {
      if (url === RECIPE_LIST_URL) return listHtml([recipeRow(generation === 'old' ? '旧完成品' : '現行完成品')]);
      if (url === ITEM_LIST_URL) return listHtml([itemRow(generation === 'old' ? '旧完成品' : '現行完成品')]);
      if (url === RECIPE_DETAIL_URL) return recipeDetailHtml({ ingredientAmount: generation === 'old' ? 2 : 3 });
      throw new Error(`unexpected URL: ${url}`);
    };

    const first = await runAudit({
      store,
      artifactRoot,
      request,
      delayMs: 0,
      createAuditId: () => 'audit-old',
      now: () => 500
    });
    generation = 'current';
    const second = await runAudit({
      store,
      artifactRoot,
      request,
      delayMs: 0,
      createAuditId: () => 'audit-current',
      now: () => 600
    });

    assert.equal(first.comparison.CurrentAuditId, 'audit-old');
    assert.notEqual(first.snapshot.DataGeneration, second.snapshot.DataGeneration);
    assert.deepEqual(second.comparison.NameAliases, { 旧完成品: '現行完成品' });
    assert.deepEqual(second.comparison.RecipeChanges.ContentChanged.map(entry => entry.RecipeKey), ['aaa']);
    assert.equal(getPromotedLodestoneAudit(store).id, 'audit-current');
  });
});

test('comparison outputs must finish before a completed audit is promoted', async () => {
  await withAudit(async ({ store, artifactRoot }) => {
    const request = async url => {
      if (url === RECIPE_LIST_URL) return listHtml([recipeRow('完成品')]);
      if (url === ITEM_LIST_URL) return listHtml([itemRow('完成品')]);
      if (url === RECIPE_DETAIL_URL) return recipeDetailHtml();
      throw new Error(`unexpected URL: ${url}`);
    };

    await assert.rejects(() => runAudit({
      store,
      artifactRoot,
      request,
      delayMs: 0,
      createAuditId: () => 'audit-output-failure',
      now: () => 700,
      beforePromote: () => {
        throw new Error('report write failed');
      }
    }), /report write failed/);

    assert.equal(getPromotedLodestoneAudit(store), null);
    assert.equal(getLodestoneAudit(store, 'audit-output-failure').status, 'running');
  });
});
