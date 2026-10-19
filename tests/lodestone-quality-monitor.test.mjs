import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compareLodestoneQuality } from '../pipeline/tool/lodestone-quality-monitor.mjs';
import { buildLodestoneQualityCandidate, extractLodestoneRecipeCraftingData, createLodestoneHtmlReader, resolveLodestoneRequiredQuality, openLodestoneShopCacheStore } from '../pipeline/tool/pipeline-tool.mjs';
import { createLodestoneAudit, openLodestoneAuditStore, planLodestoneAuditResources, completeLodestoneAuditResource, promoteCompletedLodestoneAudit } from '../pipeline/tool/lodestone-audit-store.mjs';
import { writeLodestoneAuditArtifact } from '../pipeline/tool/lodestone-audit.mjs';
import { publicLodestoneDocument } from '../pipeline/tool/lodestone-preservation.mjs';

function html(quality = 0, version = '7.57', difficulty = 10) {
  return `<p class="db-content__title--version">Version:Patch ${version}</p><h2 class="db-view__item__text__name">素材</h2>` +
    `<ul class="db-view__recipe__craftdata"><li><span>必要工数</span>${difficulty}</li><li><span>耐久</span>40</li><li><span>品質最大値</span>100</li><li><span>初期品質値</span>上限0％</li></ul>` +
    `<dl class="db-view__recipe__crafting_conditions"><dd>HQ製作不可</dd>${quality ? `<dd>完成に必要な品質：${quality}以上</dd>` : ''}</dl>`;
}

function fixture(t, qualities = [10], age = 7200000) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-monitor-'));
  t.after(() => fs.rmSync(root, { recursive: true }));
  for (const dir of ['site/data','pipeline/state']) fs.mkdirSync(path.join(root, dir), { recursive: true });
  const items = qualities.map((q,i) => ({ Name: `素材${i}`, Extension: { keep: true }, Recipe: {
    RecipeKey: `r${i}`, CraftInfo: { job: '鍛冶師', level: 100 }, Ingredients: [],
    CraftingData: extractLodestoneRecipeCraftingData(html(q)) } }));
  const document = { Version: '7.57', DataGeneration: 'old', Items: items };
  const file = path.join(root, 'site/data/Item.json');
  const save = () => fs.writeFileSync(file, JSON.stringify(document)); save();
  fs.writeFileSync(path.join(root, 'site/data/legacy-item-ids.json'), JSON.stringify({ SchemaVersion: 1, Items: { 1: '素材0' } }));
  const store = openLodestoneAuditStore(path.join(root, 'pipeline/cache/lodestone-audits.sqlite'));
  createLodestoneAudit(store, { id: 'audit' });
  const recipes = items.map(item => ({ Name: item.Name, RecipeKey: item.Recipe.RecipeKey, AuditResourceKey: `recipe:${item.Recipe.RecipeKey}` }));
  for (const [index,recipe] of recipes.entries()) {
    const resource = { kind: 'recipe-detail', key: recipe.AuditResourceKey, url: `https://jp.finalfantasyxiv.com/lodestone/playguide/db/recipe/${recipe.RecipeKey}/` };
    planLodestoneAuditResources(store, 'audit', [resource]);
    completeLodestoneAuditResource(store, 'audit', { ...resource, ...writeLodestoneAuditArtifact(path.join(root,'pipeline/cache/lodestone-audits'), 'audit', resource.kind, html(qualities[index])) }, { now: Date.now() - age });
  }
  promoteCompletedLodestoneAudit(store, 'audit'); store.close();
  fs.writeFileSync(path.join(root, 'pipeline/state/lodestone-source-snapshot.json'), JSON.stringify({ SchemaVersion: 3, AuditId: 'audit', DataGeneration: 'audit-generation', Version: '7.57', Items: [], Recipes: recipes }));
  let calls = 0;
  const current = [...qualities];
  const options = { root, delayMs: 0, fetchImpl: async url => { calls++; return { ok: true, text: async () => html(current[Number(url.match(/\/r(\d+)\//u)[1])]) }; } };
  return { root, file, document, save, current, options, calls: () => calls };
}

test('quality-only changes, removal and failed-publication retries use the published baseline and reuse HTML for generation', async t => {
  const f = fixture(t);
  f.current[0] = 20;
  const first = await compareLodestoneQuality(f.options);
  assert.deepEqual(first.QualityRecipeKeys, ['r0']); assert.equal(f.calls(), 1);
  assert.equal((await compareLodestoneQuality(f.options)).AcquisitionChanged, true);
  assert.equal(f.calls(), 1); // failed/disabled publication did not consume the change
  await buildLodestoneQualityCandidate({ ...f.options, recipeKeys: first.QualityRecipeKeys });
  assert.equal(f.calls(), 1); // generation reads the same HTML, not the network
  const candidate = JSON.parse(fs.readFileSync(path.join(f.root,'pipeline/intermediate/06-public-items.json')));
  assert.equal(candidate.Items[0].Recipe.CraftingData.RequiredQuality, 20);
  assert.deepEqual(candidate.Items[0].Extension, { keep: true });
  assert.notEqual(candidate.DataGeneration, 'old');
  fs.writeFileSync(f.file, JSON.stringify(publicLodestoneDocument(candidate)));
  assert.equal((await compareLodestoneQuality(f.options)).AcquisitionChanged, undefined);
  f.current[0] = 0;
  assert.equal((await compareLodestoneQuality({ ...f.options, maxAgeMs: 0 })).QualityChanges[0].after, 0);
});

test('ordinary NQ recipes rotate within a bounded batch and detect a newly introduced quality condition', async t => {
  const f = fixture(t, [10,0,0,0,0]); f.current[4] = 30;
  const options = { ...f.options, qualityBatchSize: 2 };
  let detected;
  for (let i=0;i<4;i++) { const result=await compareLodestoneQuality(options); assert.ok(result.CheckedQualityRecipes<=2); if(result.QualityRecipeKeys) detected=result; }
  assert.deepEqual(detected.QualityRecipeKeys, ['r4']);
  assert.equal((await compareLodestoneQuality(options)).AcquisitionChanged, true); // pending remains prioritized
  assert.equal(f.calls(), 5);
});

test('recent audit HTML seeds the shared cache with its original age and expired HTML is refreshed', async t => {
  const f = fixture(t, [10], 500);
  await compareLodestoneQuality(f.options); assert.equal(f.calls(),0);
  f.current[0]=20;
  const result=await compareLodestoneQuality({ ...f.options, maxAgeMs: 100 });
  assert.equal(result.AcquisitionChanged,true); assert.equal(f.calls(),1);
});

for (const scenario of ['http','maintenance','malformed','version']) test(`quality ${scenario} failure preserves public data and scan position`, async t => {
  const f=fixture(t); await compareLodestoneQuality(f.options);
  const cursor=fs.readFileSync(path.join(f.root,'pipeline/state/lodestone-quality-scan.json'),'utf8'); const before=fs.readFileSync(f.file);
  await assert.rejects(compareLodestoneQuality({ ...f.options, maxAgeMs:0, fetchImpl:async()=>({ok:scenario!=='http',status:503,text:async()=>scenario==='maintenance'?'<html>maintenance</html>':scenario==='version'?html(20,'7.58'):html(20).replace('20以上','不明')}) }));
  assert.equal(fs.readFileSync(path.join(f.root,'pipeline/state/lodestone-quality-scan.json'),'utf8'),cursor);
  assert.deepEqual(fs.readFileSync(f.file),before);
});

test('other simultaneous crafting changes require the full audit instead of a quality-only publication', async t => {
  const f=fixture(t);
  const result=await compareLodestoneQuality({ ...f.options,fetchImpl:async()=>({ok:true,text:async()=>html(20,'7.57',11)}) });
  assert.equal(result.RecipeListChanged,true); assert.ok(result.RecipeRefreshId); assert.equal(result.QualityRecipeKeys,undefined);
  await assert.rejects(buildLodestoneQualityCandidate({ ...f.options,recipeKeys:['r0'] }),/完全監査/);
});

test('later candidate generation keeps refreshed quality, refreshes expired HTML and prefers a newer audit', async t=>{
  const f=fixture(t);f.current[0]=20;await compareLodestoneQuality(f.options);
  const reader=createLodestoneHtmlReader({...f.options,version:'7.57'});
  try {
    const args={reader,url:'https://jp.finalfantasyxiv.com/lodestone/playguide/db/recipe/r0/',auditedValue:10,auditedFetchedAt:Date.now()-7200000,publishedValue:20};
    assert.equal(await resolveLodestoneRequiredQuality(args),20);assert.equal(f.calls(),1);
    const store=openLodestoneShopCacheStore(path.join(f.root,'pipeline/cache/lodestone-shops.sqlite'));
    store.db.exec('UPDATE cache SET updated_at=0');store.close();f.current[0]=25;
    assert.equal(await resolveLodestoneRequiredQuality(args),25);assert.equal(f.calls(),2);
    const auditTime=Date.now()+100;
    assert.equal(await resolveLodestoneRequiredQuality({...args,auditedValue:30,auditedFetchedAt:auditTime,now:()=>auditTime+10}),30);
  }finally{reader.close();}
});
