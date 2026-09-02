import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  completeLodestoneAuditResource,
  completeLodestoneAuditResources,
  createLodestoneAudit,
  abandonLodestoneAudit,
  findResumableLodestoneAudit,
  getLodestoneAuditResource,
  getPromotedLodestoneAudit,
  listLodestoneAuditResources,
  planLodestoneAuditResources,
  promoteCompletedLodestoneAudit
} from './lodestone-audit-store.mjs';
import {
  compareLodestoneAudits,
  lodestoneAuditDataGeneration
} from './lodestone-audit-compare.mjs';
import {
  LODESTONE_BASE_URL,
  LODESTONE_ITEM_LIST_URL,
  LODESTONE_RECIPE_LIST_URL,
  applyDescendingSortOrder,
  createSequentialRequestQueue,
  extractLodestoneItemList,
  extractLodestoneListMeta,
  extractLodestoneRecipeList,
  lodestoneOrderSignature
} from './lodestone-source.mjs';

const MAX_AUDIT_HTML_BYTES = 4 * 1024 * 1024;

function pageUrl(baseUrl, page) {
  if (page === 1) return baseUrl;
  return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}page=${page}`;
}

function artifactRelativePath(auditId, kind, sha256) {
  const auditDirectory = crypto.createHash('sha256').update(String(auditId)).digest('hex');
  return `${auditDirectory}/${kind}/${sha256}.html.gz`;
}

function artifactPath(root, artifactKey) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, String(artifactKey || ''));
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('監査成果物パスが保存先の外を指しています');
  }
  return resolved;
}

export function writeLodestoneAuditArtifact(root, auditId, kind, text) {
  const source = Buffer.from(String(text), 'utf8');
  if (source.length > MAX_AUDIT_HTML_BYTES) {
    throw new Error(`監査HTMLが上限を超えています: ${source.length} > ${MAX_AUDIT_HTML_BYTES}`);
  }
  const contentSha256 = crypto.createHash('sha256').update(source).digest('hex');
  const artifactKey = artifactRelativePath(auditId, kind, contentSha256);
  const target = artifactPath(root, artifactKey);
  let reusable = false;
  if (fs.existsSync(target)) {
    try {
      const existing = zlib.gunzipSync(fs.readFileSync(target), { maxOutputLength: MAX_AUDIT_HTML_BYTES });
      reusable = existing.equals(source);
    } catch {
      reusable = false;
    }
  }
  if (!reusable) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const compressed = zlib.gzipSync(source, { level: 6 });
    if (!zlib.gunzipSync(compressed, { maxOutputLength: MAX_AUDIT_HTML_BYTES }).equals(source)) {
      throw new Error('監査HTMLのgzip検証結果が一致しません');
    }
    const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, compressed);
    if (fs.existsSync(target)) fs.rmSync(target, { force: true });
    fs.renameSync(temporary, target);
  }
  return { artifactKey, contentSha256, rawBytes: source.length };
}

export function readLodestoneAuditArtifact(root, resource) {
  if (!resource?.completed || !resource.artifactKey) throw new Error('完了済みの監査成果物が必要です');
  const compressed = fs.readFileSync(artifactPath(root, resource.artifactKey));
  const source = zlib.gunzipSync(compressed, { maxOutputLength: MAX_AUDIT_HTML_BYTES });
  if (source.length !== resource.rawBytes) throw new Error(`監査成果物の展開サイズが一致しません: ${resource.key}`);
  const sha256 = crypto.createHash('sha256').update(source).digest('hex');
  if (sha256 !== resource.contentSha256) throw new Error(`監査成果物のSHA-256が一致しません: ${resource.key}`);
  return source.toString('utf8');
}

function jstIso(value = Date.now()) {
  const date = new Date(value);
  const shifted = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return `${shifted.toISOString().slice(0, -1)}+09:00`;
}

export function lodestoneRecipeCatalogFingerprint(catalog) {
  const hash = crypto.createHash('sha256');
  hash.update(`${catalog.version}\0${catalog.total}\n`);
  for (const entry of catalog.entries) {
    hash.update(`${entry.RecipeKey}\0${entry.Name}\0${entry.DetailPath}\0${entry.Job}\n`);
  }
  return hash.digest('hex');
}

async function crawlFreshList({ baseUrl, extractEntries, request, onProgress, stage }) {
  const pages = [];
  const firstUrl = pageUrl(baseUrl, 1);
  const firstHtml = await request(firstUrl);
  const meta = extractLodestoneListMeta(firstHtml);
  const entries = extractEntries(firstHtml);
  pages.push(compressAuditPage(1, firstUrl, firstHtml));
  onProgress({ stage, completed: 1, total: meta.pages });
  for (let page = 2; page <= meta.pages; page += 1) {
    const url = pageUrl(baseUrl, page);
    const text = await request(url);
    entries.push(...extractEntries(text));
    pages.push(compressAuditPage(page, url, text));
    onProgress({ stage, completed: page, total: meta.pages });
  }
  if (entries.length !== meta.total) {
    throw new Error(`Lodestone一覧件数が一致しません: 表示 ${meta.total} / 取得 ${entries.length}`);
  }
  return { ...meta, entries, pages };
}

function compressAuditPage(page, url, text) {
  const source = Buffer.from(String(text), 'utf8');
  if (source.length > MAX_AUDIT_HTML_BYTES) {
    throw new Error(`監査一覧HTMLが上限を超えています: ${source.length} > ${MAX_AUDIT_HTML_BYTES}`);
  }
  return {
    page,
    url,
    compressed: zlib.gzipSync(source, { level: 1 }),
  };
}

function auditPageText(page) {
  return zlib.gunzipSync(page.compressed, {
    maxOutputLength: MAX_AUDIT_HTML_BYTES,
  }).toString('utf8');
}

function pageResources(catalog, kind, prefix = '') {
  return catalog.pages.map(page => ({ kind, key: `${prefix}${page.page}`, url: page.url }));
}

function persistHtmlBatch(store, artifactRoot, auditId, planned, pages, now) {
  const resources = planLodestoneAuditResources(store, auditId, planned, { now: now() });
  const pending = resources
    .map((resource, index) => ({ resource, page: pages[index] }))
    .filter(({ resource }) => !resource.completed);
  if (pending.length === 0) return resources;
  const completed = pending.map(({ resource, page }) => ({
    kind: resource.kind,
    key: resource.key,
    ...writeLodestoneAuditArtifact(
      artifactRoot,
      auditId,
      resource.kind,
      auditPageText(page),
    )
  }));
  completeLodestoneAuditResources(store, auditId, completed, { now: now() });
  return planned.map(resource => getLodestoneAuditResource(store, auditId, resource.kind, resource.key));
}

function completedPageCatalog({ store, artifactRoot, auditId, kind, prefix, extractEntries }) {
  const resources = listLodestoneAuditResources(store, auditId, { kind })
    .filter(resource => resource.key.startsWith(prefix));
  if (resources.length === 0) return null;
  if (resources.some(resource => !resource.completed)) throw new Error(`監査一覧の保存が未完了です: ${kind}/${prefix}`);
  const ordered = resources.sort((left, right) =>
    Number(left.key.slice(prefix.length)) - Number(right.key.slice(prefix.length))
  );
  const firstHtml = readLodestoneAuditArtifact(artifactRoot, ordered[0]);
  const meta = extractLodestoneListMeta(firstHtml);
  if (ordered.length !== meta.pages) throw new Error(`監査一覧のページ数が一致しません: ${kind}/${prefix}`);
  const entries = ordered.flatMap(resource => extractEntries(readLodestoneAuditArtifact(artifactRoot, resource)));
  if (entries.length !== meta.total) throw new Error(`監査一覧の件数が一致しません: ${kind}/${prefix}`);
  return { ...meta, entries };
}

function changedRecipeKeys(initialEntries, finalEntries) {
  const initial = new Map(initialEntries.map(entry => [entry.RecipeKey, entry]));
  return new Set(finalEntries
    .filter(entry => {
      const previous = initial.get(entry.RecipeKey);
      return !previous ||
        previous.Name !== entry.Name ||
        previous.DetailPath !== entry.DetailPath ||
        previous.Job !== entry.Job;
    })
    .map(entry => entry.RecipeKey));
}

function validateUnique(entries, key, label) {
  const seen = new Set();
  for (const entry of entries) {
    if (!entry?.[key] || seen.has(entry[key])) throw new Error(`${label}が空または重複しています: ${entry?.[key] || '(空)'}`);
    seen.add(entry[key]);
  }
}

function auditResourceMap(store, auditId) {
  return new Map(
    listLodestoneAuditResources(store, auditId, { kind: 'recipe-detail' })
      .map(resource => [resource.key, resource])
  );
}

export function loadLodestoneAuditSnapshot({ store, artifactRoot, audit }) {
  if (!audit || audit.status !== 'completed') throw new Error('完了済みのLodestone監査が必要です');
  const items = completedPageCatalog({
    store,
    artifactRoot,
    auditId: audit.id,
    kind: 'item-list-page',
    prefix: 'page:',
    extractEntries: extractLodestoneItemList
  });
  const recipes = completedPageCatalog({
    store,
    artifactRoot,
    auditId: audit.id,
    kind: 'recipe-list-page',
    prefix: 'end:',
    extractEntries: extractLodestoneRecipeList
  });
  if (!items || !recipes || items.version !== recipes.version) {
    throw new Error(`昇格済み監査の一覧を復元できません: ${audit.id}`);
  }
  const recipeResources = auditResourceMap(store, audit.id);
  const orderedItems = applyDescendingSortOrder(items.entries, items.total);
  const snapshot = {
    SchemaVersion: 3,
    AuditId: audit.id,
    CheckedAt: jstIso(audit.completedAt),
    Version: items.version,
    ItemCount: items.total,
    RecipeCount: recipes.total,
    ItemOrderSignature: lodestoneOrderSignature(orderedItems),
    Items: orderedItems,
    Recipes: recipes.entries.map(entry => ({
      ...entry,
      AuditResourceKey: recipeResources.has(`recheck:${entry.RecipeKey}`)
        ? `recheck:${entry.RecipeKey}`
        : `recipe:${entry.RecipeKey}`
    }))
  };
  snapshot.DataGeneration = lodestoneAuditDataGeneration(
    snapshot,
    recipeResources,
    resource => readLodestoneAuditArtifact(artifactRoot, resource)
  );
  return snapshot;
}

export async function runLodestoneFullAudit({
  store,
  artifactRoot,
  request,
  delayMs = 100,
  onProgress = () => {},
  now = Date.now,
  createAuditId = crypto.randomUUID,
  createInitialComparison = null,
  beforePromote = () => {}
}) {
  if (!store || typeof request !== 'function') throw new TypeError('監査ストアと取得関数が必要です');
  const previousPromotedAudit = getPromotedLodestoneAudit(store);
  const requestSequentially = createSequentialRequestQueue({ delayMs, request });

  const initialRecipes = await crawlFreshList({
    baseUrl: LODESTONE_RECIPE_LIST_URL,
    extractEntries: extractLodestoneRecipeList,
    request: requestSequentially,
    onProgress,
    stage: 'recipe-list-start'
  });
  validateUnique(initialRecipes.entries, 'RecipeKey', 'Lodestoneレシピキー');
  const catalogFingerprint = lodestoneRecipeCatalogFingerprint(initialRecipes);
  const resumable = findResumableLodestoneAudit(store, catalogFingerprint);
  const audit = resumable || createLodestoneAudit(store, {
    id: createAuditId(),
    catalogFingerprint,
    now: now()
  });

  persistHtmlBatch(
    store,
    artifactRoot,
    audit.id,
    pageResources(initialRecipes, 'recipe-list-page', 'start:'),
    initialRecipes.pages,
    now
  );

  const detailPlans = initialRecipes.entries.map(entry => ({
    kind: 'recipe-detail',
    key: `recipe:${entry.RecipeKey}`,
    url: `${LODESTONE_BASE_URL}${entry.DetailPath}`
  }));
  const detailResources = planLodestoneAuditResources(store, audit.id, detailPlans, { now: now() });
  for (const [index, entry] of initialRecipes.entries.entries()) {
    const resource = detailResources[index];
    if (!resource.completed) {
      const text = await requestSequentially(resource.url);
      completeLodestoneAuditResource(store, audit.id, {
        kind: resource.kind,
        key: resource.key,
        ...writeLodestoneAuditArtifact(artifactRoot, audit.id, resource.kind, text)
      }, { now: now() });
    }
    onProgress({ stage: 'recipe-detail', completed: index + 1, total: initialRecipes.entries.length });
  }

  let items = completedPageCatalog({
    store,
    artifactRoot,
    auditId: audit.id,
    kind: 'item-list-page',
    prefix: 'page:',
    extractEntries: extractLodestoneItemList
  });
  if (!items) {
    items = await crawlFreshList({
      baseUrl: LODESTONE_ITEM_LIST_URL,
      extractEntries: extractLodestoneItemList,
      request: requestSequentially,
      onProgress,
      stage: 'item-list'
    });
    persistHtmlBatch(
      store,
      artifactRoot,
      audit.id,
      pageResources(items, 'item-list-page', 'page:'),
      items.pages,
      now
    );
  }
  validateUnique(items.entries, 'LodestoneKey', 'Lodestoneアイテムキー');

  let finalRecipes = completedPageCatalog({
    store,
    artifactRoot,
    auditId: audit.id,
    kind: 'recipe-list-page',
    prefix: 'end:',
    extractEntries: extractLodestoneRecipeList
  });
  if (!finalRecipes) {
    finalRecipes = await crawlFreshList({
      baseUrl: LODESTONE_RECIPE_LIST_URL,
      extractEntries: extractLodestoneRecipeList,
      request: requestSequentially,
      onProgress,
      stage: 'recipe-list-end'
    });
    persistHtmlBatch(
      store,
      artifactRoot,
      audit.id,
      pageResources(finalRecipes, 'recipe-list-page', 'end:'),
      finalRecipes.pages,
      now
    );
  }
  validateUnique(finalRecipes.entries, 'RecipeKey', 'Lodestoneレシピキー');

  const changedKeys = changedRecipeKeys(initialRecipes.entries, finalRecipes.entries);
  const recheckEntries = finalRecipes.entries.filter(entry => changedKeys.has(entry.RecipeKey));
  if (recheckEntries.length > 0) {
    const recheckPlans = recheckEntries.map(entry => ({
      kind: 'recipe-detail',
      key: `recheck:${entry.RecipeKey}`,
      url: `${LODESTONE_BASE_URL}${entry.DetailPath}`
    }));
    const recheckResources = planLodestoneAuditResources(store, audit.id, recheckPlans, { now: now() });
    for (const [index, resource] of recheckResources.entries()) {
      if (!resource.completed) {
        const text = await requestSequentially(resource.url);
        completeLodestoneAuditResource(store, audit.id, {
          kind: resource.kind,
          key: resource.key,
          ...writeLodestoneAuditArtifact(artifactRoot, audit.id, resource.kind, text)
        }, { now: now() });
      }
      onProgress({ stage: 'recipe-detail-recheck', completed: index + 1, total: recheckResources.length });
    }
  }

  if (items.version !== finalRecipes.version) {
    abandonLodestoneAudit(store, audit.id, { now: now() });
    throw new Error(`LodestoneのVersionが一覧間で一致しません: item=${items.version} recipe=${finalRecipes.version}`);
  }
  const orderedItems = applyDescendingSortOrder(items.entries, items.total);
  validateUnique(orderedItems, 'Name', 'Lodestoneアイテム名');
  const snapshot = {
    SchemaVersion: 3,
    AuditId: audit.id,
    CheckedAt: jstIso(now()),
    Version: items.version,
    ItemCount: items.total,
    RecipeCount: finalRecipes.total,
    ItemOrderSignature: lodestoneOrderSignature(orderedItems),
    Items: orderedItems,
    Recipes: finalRecipes.entries.map(entry => ({
      ...entry,
      AuditResourceKey: `${changedKeys.has(entry.RecipeKey) ? 'recheck' : 'recipe'}:${entry.RecipeKey}`
    }))
  };
  const missingArtifact = listLodestoneAuditResources(store, audit.id)
    .find(resource => !resource.completed || !fs.existsSync(artifactPath(artifactRoot, resource.artifactKey)));
  if (missingArtifact) throw new Error(`監査成果物が完了していません: ${missingArtifact.kind}/${missingArtifact.key}`);
  const currentResources = auditResourceMap(store, audit.id);
  const readArtifact = resource => readLodestoneAuditArtifact(artifactRoot, resource);
  snapshot.DataGeneration = lodestoneAuditDataGeneration(snapshot, currentResources, readArtifact);
  const previousSnapshot = previousPromotedAudit
    ? loadLodestoneAuditSnapshot({ store, artifactRoot, audit: previousPromotedAudit })
    : null;
  const comparison = previousSnapshot
    ? compareLodestoneAudits({
        previousSnapshot,
        currentSnapshot: snapshot,
        previousResources: auditResourceMap(store, previousPromotedAudit.id),
        currentResources,
        readPreviousArtifact: readArtifact
      })
    : typeof createInitialComparison === 'function'
      ? await createInitialComparison({
          currentSnapshot: snapshot,
          currentResources,
          readCurrentArtifact: readArtifact
        })
      : null;
  if (!comparison) throw new Error('初回Lodestone監査の比較基準がないため昇格できません');
  await beforePromote({ auditId: audit.id, snapshot, comparison });
  promoteCompletedLodestoneAudit(store, audit.id, { now: now() });
  return { auditId: audit.id, resumed: Boolean(resumable), snapshot, comparison };
}
