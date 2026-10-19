import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createLodestoneHtmlReader, extractLodestoneRecipeCraftingData, LODESTONE_ACQUISITION_CACHE_MAX_AGE_MS } from './pipeline-tool.mjs';
import { readLodestoneAuditArtifact } from './lodestone-audit.mjs';
import { LODESTONE_BASE_URL } from './lodestone-source.mjs';

export const QUALITY_SCAN_BATCH_SIZE = 128;

// Published values are the baseline. The cursor only schedules reads; it never
// acknowledges a change, including after disabled/failed publication.
export async function compareLodestoneQuality({ root = path.resolve(import.meta.dirname, '../..'),
  delayMs = 100, fetchImpl = fetch, maxAgeMs = LODESTONE_ACQUISITION_CACHE_MAX_AGE_MS,
  qualityBatchSize = QUALITY_SCAN_BATCH_SIZE, now = Date.now, onQualityProgress = () => {} } = {}) {
  const document = JSON.parse(fs.readFileSync(path.join(root, 'site/data/Item.json'), 'utf8'));
  const recipes = new Map();
  for (const item of document.Items || []) for (const recipe of [item.Recipe, ...(item.Recipes || [])]) {
    if (recipe?.CraftingData?.HqAvailable !== false) continue;
    if (!/^[a-z0-9]+$/u.test(recipe.RecipeKey)) throw new Error('必要品質のレシピ識別子が不正です');
    recipes.set(recipe.RecipeKey, { ...recipe, Name: item.Name });
  }
  if (!recipes.size) return { CheckedQualityRecipes: 0, QualityScanRemaining: 0 };
  const file = path.join(root, 'pipeline/state/lodestone-quality-scan.json');
  const saved = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const state = saved.version === document.Version ? saved : {};
  const budget = Math.max(2, Math.min(1024, Math.floor(Number(qualityBatchSize) || QUALITY_SCAN_BATCH_SIZE)));
  const selected = new Map();
  for (const key of state.pending || []) if (recipes.has(key) && selected.size < budget) selected.set(key, recipes.get(key));
  const positive = [...recipes.values()].filter(r => r.CraftingData.RequiredQuality > 0).sort((a,b) => a.RecipeKey.localeCompare(b.RecipeKey));
  const ordinary = [...recipes.values()].filter(r => !(r.CraftingData.RequiredQuality > 0)).sort((a,b) => a.RecipeKey.localeCompare(b.RecipeKey));
  const pick = (rows, cursor, count) => {
    let visited = 0;
    cursor = Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;
    while (visited < rows.length && selected.size < budget && count > 0) {
      const row = rows[(cursor + visited++) % rows.length];
      if (!selected.has(row.RecipeKey)) { selected.set(row.RecipeKey, row); count--; }
    }
    return rows.length ? (cursor + visited) % rows.length : 0;
  };
  const positiveCursor = pick(positive, state.positiveCursor, Math.ceil(budget / 2));
  const ordinaryCursor = pick(ordinary, state.ordinaryCursor, budget - selected.size);
  const reader = createLodestoneHtmlReader({ root, version: document.Version, delayMs, fetchImpl, maxAgeMs, now });
  const databasePath = path.join(root, 'pipeline/cache/lodestone-audits.sqlite');
  let db;
  const changes = [];
  let fullAudit = false;
  try {
    // Seed recent immutable audit HTML without resetting its original age.
    const snapshotPath = path.join(root, 'pipeline/state/lodestone-source-snapshot.json');
    const snapshot = fs.existsSync(snapshotPath) ? JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) : null;
    if (snapshot?.Version === document.Version && fs.existsSync(databasePath)) db = new DatabaseSync(databasePath, { readOnly: true });
    const byKey = new Map((snapshot?.Recipes || []).map(r => [r.RecipeKey, r]));
    let completed = 0;
    for (const [key, recipe] of selected) {
      const url = `${LODESTONE_BASE_URL}/lodestone/playguide/db/recipe/${key}/`;
      if (!reader.read(url) && db) {
        const source = byKey.get(key);
        const row = source && db.prepare("SELECT * FROM resources WHERE audit_id=? AND kind='recipe-detail' AND resource_key=?")
          .get(snapshot.AuditId, source.AuditResourceKey);
        if (row?.completed && now() - row.fetched_at >= 0 && now() - row.fetched_at < maxAgeMs) {
          const html = readLodestoneAuditArtifact(path.join(root, 'pipeline/cache/lodestone-audits'), {
            completed: true, artifactKey: row.artifact_key, contentSha256: row.content_sha256, rawBytes: row.raw_bytes });
          reader.seed(url, html, row.fetched_at);
        }
      }
      const values = extractLodestoneRecipeCraftingData(await reader.request(url));
      if (values.RequiredQuality !== recipe.CraftingData.RequiredQuality) {
        changes.push({ key, name: recipe.Name, before: recipe.CraftingData.RequiredQuality ?? null, after: values.RequiredQuality });
        if (Object.entries(values).some(([field,value]) => field !== 'RequiredQuality' && recipe.CraftingData[field] !== value)) fullAudit = true;
      }
      onQualityProgress({ completed: ++completed, total: selected.size, item: recipe.Name });
    }
    const pending = new Set((state.pending || []).filter(key => recipes.has(key) && !selected.has(key)));
    for (const change of changes) pending.add(change.key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ version: document.Version, positiveCursor, ordinaryCursor, pending: [...pending] }) + '\n');
    fs.renameSync(temporary, file);
    const result = { CheckedQualityRecipes: selected.size, QualityScanRemaining: ordinaryCursor ? ordinary.length - ordinaryCursor : 0, QualityScanTotal: recipes.size };
    if (!changes.length) return result;
    if (fullAudit) return { ...result, RecipeListChanged: true, RecipeRefreshId: crypto.randomUUID(),
      RecipeListChange: { reason: '必要品質と製作パラメーター', recipes: changes } };
    return { ...result, AcquisitionChanged: true, AcquisitionRefreshId: crypto.randomUUID(),
      AcquisitionChange: '完成に必要な品質', QualityRecipeKeys: changes.map(change => change.key), QualityChanges: changes };
  } finally { db?.close(); reader.close(); }
}
