import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import { readLodestoneAuditArtifact } from './lodestone-audit.mjs';
import { readAppliedLodestoneState } from './lodestone-applied-state.mjs';
import {
  LODESTONE_PAGE_SIZE, LODESTONE_RECIPE_LIST_URL, createSequentialRequestQueue,
  extractLodestoneListMeta, extractLodestoneRecipeList, normalizeLodestoneName
} from './lodestone-source.mjs';

const defaultRoot = path.resolve(import.meta.dirname, '..', '..');
const sourceKeys = ['Version', 'RecipeVersion', 'ItemCount', 'RecipeCount', 'ItemOrderSignature'];

export function recipeMonitorCachePath(root = defaultRoot) {
  return path.join(root, 'pipeline/cache/lodestone-recipe-monitor.json');
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function pageUrl(page) {
  return page === 1 ? LODESTONE_RECIPE_LIST_URL : `${LODESTONE_RECIPE_LIST_URL}?page=${page}`;
}

// Compare actual list content, not the full HTML or a content hash. The audit's
// hashes below verify stored gzip integrity only; they never decide an update.
export function recipeListPageContent(html, page) {
  if (!/class=["'][^"']*\btotal\b[^"']*["'][^>]*>\s*\d+\s*<\/span>/i.test(html)) {
    throw new Error(`製作手帳${page}ページの総件数を取得できません`);
  }
  const meta = extractLodestoneListMeta(html);
  const rows = [];
  for (const match of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = match[1];
    const entries = extractLodestoneRecipeList(match[0]);
    if (!entries.length) continue;
    if (entries.length !== 1) throw new Error('製作手帳の一覧行が不正です');
    rows.push({
      ...entries[0],
      cells: [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
        .map(cell => normalizeLodestoneName(cell[1]).replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()),
      icons: [...row.matchAll(/<img\b[^>]*src=["']([^"']+)["']/gi)]
        .map(icon => new URL(icon[1], LODESTONE_RECIPE_LIST_URL).pathname)
    });
  }
  const expected = Math.min(LODESTONE_PAGE_SIZE, meta.total - (page - 1) * LODESTONE_PAGE_SIZE);
  if (meta.total <= 0 || expected <= 0 || rows.length !== expected
      || new Set(rows.map(row => row.RecipeKey)).size !== rows.length) {
    throw new Error(`製作手帳${page}ページの一覧が不完全です`);
  }
  return { ...meta, rows };
}

function readPage(root, resource, page) {
  if (resource?.kind !== 'recipe-list-page' || resource.key !== `end:${page}` || resource.url !== pageUrl(page)) {
    throw new Error(`比較用キャッシュの${page}ページが不正です`);
  }
  return recipeListPageContent(readLodestoneAuditArtifact(path.join(root, 'pipeline/cache/lodestone-audits'), resource), page);
}

// Keep references to immutable, page-by-page HTML already saved by the full
// audit. Only this small manifest is replaced, after successful publication.
export function saveRecipeMonitorBaseline({ root = defaultRoot, applied = readAppliedLodestoneState({ repositoryRoot: root }) } = {}) {
  if (!applied) throw new Error('比較元の作成には検証済みの反映完了記録が必要です');
  const db = new DatabaseSync(path.join(root, 'pipeline/cache/lodestone-audits.sqlite'), { readOnly: true });
  let resources;
  try {
    const audit = db.prepare('SELECT status FROM audits WHERE id = ?').get(applied.AuditId);
    if (audit?.status !== 'completed') throw new Error('比較元の完全監査が完了していません');
    resources = db.prepare("SELECT * FROM resources WHERE audit_id = ? AND kind = 'recipe-list-page' AND resource_key LIKE 'end:%'")
      .all(applied.AuditId)
      .sort((a, b) => Number(a.resource_key.slice(4)) - Number(b.resource_key.slice(4)))
      .map(row => ({ kind: row.kind, key: row.resource_key, url: row.url, completed: Boolean(row.completed),
        artifactKey: row.artifact_key, contentSha256: row.content_sha256, rawBytes: row.raw_bytes }));
  } finally { db.close(); }
  const pages = Math.ceil(applied.RecipeCount / LODESTONE_PAGE_SIZE);
  if (resources.length !== pages) throw new Error('比較元の製作手帳ページが不足しています');
  const keys = new Set();
  for (const [index, resource] of resources.entries()) {
    const content = readPage(root, resource, index + 1);
    if (content.version !== applied.RecipeVersion || content.total !== applied.RecipeCount) {
      throw new Error('比較元HTMLと反映完了記録が一致しません');
    }
    for (const row of content.rows) {
      if (keys.has(row.RecipeKey)) throw new Error('比較元HTMLに重複レシピがあります');
      keys.add(row.RecipeKey);
    }
  }
  const baseline = { schemaVersion: 1, auditId: applied.AuditId,
    source: Object.fromEntries(sourceKeys.map(key => [key, applied[key]])), pages: resources };
  const file = recipeMonitorCachePath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(baseline, null, 2)}\n`);
  fs.renameSync(temporary, file);
  return baseline;
}

export async function compareRecipeList({ root = defaultRoot, appliedState = readAppliedLodestoneState({ repositoryRoot: root }),
  delayMs = 100, fetchImpl = fetch, onProgress = () => {} } = {}) {
  const publication = readJson(path.join(root, 'pipeline/state/auto-publish.json')) || {};
  // Finish a saved commit/deployment before checking for another update. Never
  // replace an older comparison baseline with an incomplete run's artifacts.
  if (['generating', 'committed', 'pushed'].includes(publication.status)) {
    return { ...publication.targetSource, Version: publication.targetVersion,
      ItemOrderSignature: publication.targetItemOrderSignature || '',
      DeferredItemOrder: Boolean(publication.deferredItemOrder),
      RecipeComparisonMode: true, ResumePublication: true,
      RecipeRefreshId: publication.recipeRefreshId || undefined,
      RecipeListChanged: Boolean(publication.recipeRefreshId),
      AcquisitionRefreshId: publication.acquisitionRefreshId || undefined,
      QualityRecipeKeys: publication.qualityRecipeKeys || undefined,
      AcquisitionChanged: Boolean(publication.acquisitionRefreshId) };
  }
  let baseline = readJson(recipeMonitorCachePath(root));
  if (!baseline && appliedState && !(publication.status === 'failed' && publication.recipeRefreshId)) {
    baseline = saveRecipeMonitorBaseline({ root, applied: appliedState });
  }
  if (baseline && (baseline.schemaVersion !== 1 || !baseline.auditId || !baseline.source
      || typeof baseline.source.RecipeVersion !== 'string' || !baseline.source.RecipeVersion
      || !Number.isSafeInteger(baseline.source.RecipeCount) || baseline.source.RecipeCount <= 0
      || !Array.isArray(baseline.pages) || baseline.pages.length !== Math.ceil(baseline.source.RecipeCount / LODESTONE_PAGE_SIZE))) {
    throw new Error('製作手帳の比較用キャッシュが不正です');
  }
  const request = createSequentialRequestQueue({ delayMs, request: async url => {
    const response = await fetchImpl(url, { headers: { 'user-agent': 'ffxiv-recipe-lodestone-monitor/1.0' },
      signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Lodestoneの取得に失敗しました (HTTP ${response.status})`);
    return response.text();
  } });
  let first;
  const seen = new Set();
  for (let page = 1; page <= (first?.pages || 1); page += 1) {
    const current = recipeListPageContent(await request(pageUrl(page)), page);
    first ||= current;
    const source = baseline?.source || appliedState || {};
    let reason = !baseline ? '比較元なし' : '';
    if (baseline) {
      if (current.pages !== baseline.pages.length || current.total !== source.RecipeCount) reason = 'ページ数・総件数';
      else if (current.version !== source.RecipeVersion) reason = 'レシピVersion';
      else if (!isDeepStrictEqual(current, readPage(root, baseline.pages[page - 1], page))) reason = '一覧内容';
    }
    if (!reason && !appliedState) reason = '反映完了記録の不一致';
    onProgress({ page, pages: current.pages, reason });
    if (reason) return {
      ...Object.fromEntries(sourceKeys.map(key => [key, source[key]])),
      Version: current.version, RecipeVersion: current.version, RecipeCount: current.total,
      ItemOrderSignature: '', DeferredItemOrder: true, RecipeComparisonMode: true,
      RecipeListChanged: true, RecipeRefreshId: crypto.randomUUID(),
      RecipeListChange: { page, reason }
    };
    for (const row of current.rows) {
      if (seen.has(row.RecipeKey)) throw new Error('製作手帳の取得結果に重複レシピがあります');
      seen.add(row.RecipeKey);
    }
  }
  return { ...baseline.source, RecipeComparisonMode: true, RecipeListChanged: false, CheckedRecipePages: first.pages };
}
