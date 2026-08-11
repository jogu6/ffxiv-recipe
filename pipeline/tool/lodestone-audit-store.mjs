import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const LODESTONE_AUDIT_STATUS = Object.freeze({
  RUNNING: 'running',
  COMPLETED: 'completed',
  ABANDONED: 'abandoned'
});
export const LODESTONE_AUDIT_SCHEMA_VERSION = 1;

const RESOURCE_KINDS = new Set(['item-list-page', 'recipe-list-page', 'recipe-detail']);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function requiredText(value, label) {
  const text = String(value || '').trim();
  if (!text) throw new TypeError(`${label}が必要です`);
  return text;
}

function optionalText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function timestamp(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new RangeError(`${label}が不正です`);
  return number;
}

function auditRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    catalogFingerprint: row.catalog_fingerprint,
    startedAt: Number(row.started_at),
    updatedAt: Number(row.updated_at),
    completedAt: row.completed_at == null ? null : Number(row.completed_at)
  };
}

function resourceRow(row) {
  if (!row) return null;
  return {
    auditId: row.audit_id,
    kind: row.kind,
    key: row.resource_key,
    url: row.url,
    completed: Boolean(row.completed),
    artifactKey: row.artifact_key,
    contentSha256: row.content_sha256,
    rawBytes: row.raw_bytes == null ? null : Number(row.raw_bytes),
    fetchedAt: row.fetched_at == null ? null : Number(row.fetched_at)
  };
}

function assertResourceKind(value) {
  const kind = requiredText(value, '取得種別');
  if (!RESOURCE_KINDS.has(kind)) throw new RangeError(`未対応の取得種別です: ${kind}`);
  return kind;
}

function assertRunningAudit(store, auditId) {
  const audit = store.statements.getAudit.get(auditId);
  if (!audit) throw new Error(`監査が見つかりません: ${auditId}`);
  if (audit.status !== LODESTONE_AUDIT_STATUS.RUNNING) {
    throw new Error(`実行中ではない監査は変更できません: ${auditId} (${audit.status})`);
  }
  return audit;
}

function transaction(db, action) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function openLodestoneAuditStore(file) {
  const databasePath = path.resolve(requiredText(file, '監査DBパス'));
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  const schemaVersion = Number(db.prepare('PRAGMA user_version').get().user_version);
  if (schemaVersion > LODESTONE_AUDIT_SCHEMA_VERSION) {
    db.close();
    throw new Error(`未対応のLodestone監査DBです: schema ${schemaVersion}`);
  }
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=FULL;
    PRAGMA busy_timeout=5000;
    PRAGMA foreign_keys=ON;
    PRAGMA cell_size_check=ON;
    PRAGMA trusted_schema=OFF;

    CREATE TABLE IF NOT EXISTS audits (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'abandoned')),
      catalog_fingerprint TEXT,
      started_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER
    ) WITHOUT ROWID;

    CREATE TABLE IF NOT EXISTS resources (
      audit_id TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('item-list-page', 'recipe-list-page', 'recipe-detail')),
      resource_key TEXT NOT NULL,
      url TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
      artifact_key TEXT,
      content_sha256 TEXT,
      raw_bytes INTEGER CHECK (raw_bytes IS NULL OR raw_bytes >= 0),
      fetched_at INTEGER,
      PRIMARY KEY (audit_id, kind, resource_key),
      CHECK (
        (completed = 0 AND artifact_key IS NULL AND content_sha256 IS NULL AND raw_bytes IS NULL AND fetched_at IS NULL)
        OR
        (completed = 1 AND artifact_key IS NOT NULL AND content_sha256 IS NOT NULL AND raw_bytes IS NOT NULL AND fetched_at IS NOT NULL)
      )
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS resources_pending
      ON resources(audit_id, completed, kind, resource_key);

    CREATE TABLE IF NOT EXISTS state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) WITHOUT ROWID;

    PRAGMA user_version=1;
  `);

  const statements = {
    createAudit: db.prepare(`
      INSERT INTO audits (id, status, catalog_fingerprint, started_at, updated_at)
      VALUES (?, 'running', ?, ?, ?)
    `),
    getAudit: db.prepare('SELECT * FROM audits WHERE id = ?'),
    findResumable: db.prepare(`
      SELECT * FROM audits
      WHERE status = 'running' AND catalog_fingerprint = ?
      ORDER BY started_at DESC
      LIMIT 1
    `),
    latestRunning: db.prepare(`
      SELECT * FROM audits
      WHERE status = 'running'
      ORDER BY started_at DESC
      LIMIT 1
    `),
    setCatalogFingerprint: db.prepare(`
      UPDATE audits SET catalog_fingerprint = ?, updated_at = ?
      WHERE id = ? AND status = 'running' AND catalog_fingerprint IS NULL
    `),
    touchAudit: db.prepare(`UPDATE audits SET updated_at = ? WHERE id = ? AND status = 'running'`),
    abandonAudit: db.prepare(`
      UPDATE audits SET status = 'abandoned', updated_at = ?
      WHERE id = ? AND status = 'running'
    `),
    planResource: db.prepare(`
      INSERT INTO resources (audit_id, kind, resource_key, url)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(audit_id, kind, resource_key) DO NOTHING
    `),
    getResource: db.prepare(`
      SELECT * FROM resources WHERE audit_id = ? AND kind = ? AND resource_key = ?
    `),
    completeResource: db.prepare(`
      UPDATE resources SET
        completed = 1,
        artifact_key = ?,
        content_sha256 = ?,
        raw_bytes = ?,
        fetched_at = ?
      WHERE audit_id = ? AND kind = ? AND resource_key = ? AND completed = 0
    `),
    listPending: db.prepare(`
      SELECT * FROM resources
      WHERE audit_id = ? AND completed = 0
      ORDER BY kind, resource_key
    `),
    listCompleted: db.prepare(`
      SELECT * FROM resources
      WHERE audit_id = ? AND completed = 1
      ORDER BY kind, resource_key
    `),
    listResources: db.prepare(`
      SELECT * FROM resources
      WHERE audit_id = ?
      ORDER BY kind, resource_key
    `),
    listResourcesByKind: db.prepare(`
      SELECT * FROM resources
      WHERE audit_id = ? AND kind = ?
      ORDER BY resource_key
    `),
    progress: db.prepare(`
      SELECT COUNT(*) AS total, COALESCE(SUM(completed), 0) AS completed
      FROM resources WHERE audit_id = ?
    `),
    completeAudit: db.prepare(`
      UPDATE audits SET status = 'completed', updated_at = ?, completed_at = ?
      WHERE id = ? AND status = 'running'
    `),
    promoteAudit: db.prepare(`
      INSERT INTO state (key, value) VALUES ('promoted_audit_id', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `),
    promotedAudit: db.prepare(`
      SELECT audits.* FROM state
      JOIN audits ON audits.id = state.value
      WHERE state.key = 'promoted_audit_id' AND audits.status = 'completed'
    `)
  };

  return {
    file: databasePath,
    db,
    statements,
    close() {
      try {
        db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      } finally {
        db.close();
      }
    }
  };
}

export function createLodestoneAudit(store, { id = crypto.randomUUID(), catalogFingerprint = null, now = Date.now() } = {}) {
  const auditId = requiredText(id, '監査ID');
  const startedAt = timestamp(now, '開始日時');
  store.statements.createAudit.run(auditId, optionalText(catalogFingerprint), startedAt, startedAt);
  return getLodestoneAudit(store, auditId);
}

export function getLodestoneAudit(store, auditId) {
  return auditRow(store.statements.getAudit.get(requiredText(auditId, '監査ID')));
}

export function findResumableLodestoneAudit(store, catalogFingerprint) {
  return auditRow(store.statements.findResumable.get(requiredText(catalogFingerprint, '一覧フィンガープリント')));
}

export function getLatestRunningLodestoneAudit(store) {
  return auditRow(store.statements.latestRunning.get());
}

export function setLodestoneAuditCatalogFingerprint(store, auditId, catalogFingerprint, { now = Date.now() } = {}) {
  const id = requiredText(auditId, '監査ID');
  const fingerprint = requiredText(catalogFingerprint, '一覧フィンガープリント');
  const existing = assertRunningAudit(store, id);
  if (existing.catalog_fingerprint && existing.catalog_fingerprint !== fingerprint) {
    throw new Error(`一覧フィンガープリントは変更できません: ${id}`);
  }
  if (!existing.catalog_fingerprint) {
    store.statements.setCatalogFingerprint.run(fingerprint, timestamp(now, '更新日時'), id);
  }
  return getLodestoneAudit(store, id);
}

export function planLodestoneAuditResource(store, auditId, { kind, key, url }, { now = Date.now() } = {}) {
  return planLodestoneAuditResources(store, auditId, [{ kind, key, url }], { now })[0];
}

export function planLodestoneAuditResources(store, auditId, resources, { now = Date.now() } = {}) {
  const id = requiredText(auditId, '監査ID');
  if (!Array.isArray(resources) || resources.length === 0) throw new TypeError('取得計画が必要です');
  const normalized = resources.map(({ kind, key, url }) => ({
    kind: assertResourceKind(kind),
    key: requiredText(key, '取得キー'),
    url: requiredText(url, '取得URL')
  }));
  const updatedAt = timestamp(now, '更新日時');
  assertRunningAudit(store, id);
  return transaction(store.db, () => {
    const planned = normalized.map(resource => {
      store.statements.planResource.run(id, resource.kind, resource.key, resource.url);
      const existing = store.statements.getResource.get(id, resource.kind, resource.key);
      if (existing.url !== resource.url) {
        throw new Error(`同じ取得キーへ異なるURLを登録できません: ${resource.kind}/${resource.key}`);
      }
      return resourceRow(existing);
    });
    store.statements.touchAudit.run(updatedAt, id);
    return planned;
  });
}

export function completeLodestoneAuditResource(
  store,
  auditId,
  resource,
  { now = Date.now() } = {}
) {
  return completeLodestoneAuditResources(store, auditId, [resource], { now })[0];
}

export function completeLodestoneAuditResources(store, auditId, resources, { now = Date.now() } = {}) {
  const id = requiredText(auditId, '監査ID');
  if (!Array.isArray(resources) || resources.length === 0) throw new TypeError('完了する取得結果が必要です');
  const normalized = resources.map(({ kind, key, artifactKey, contentSha256, rawBytes }) => {
    const sha256 = requiredText(contentSha256, 'SHA-256').toLowerCase();
    const bytes = Number(rawBytes);
    if (!SHA256_PATTERN.test(sha256)) throw new RangeError('SHA-256は64桁の16進数で指定してください');
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError('取得バイト数が不正です');
    return {
      kind: assertResourceKind(kind),
      key: requiredText(key, '取得キー'),
      artifactKey: requiredText(artifactKey, '成果物キー'),
      contentSha256: sha256,
      rawBytes: bytes
    };
  });
  const fetchedAt = timestamp(now, '取得日時');
  assertRunningAudit(store, id);
  return transaction(store.db, () => {
    const completed = normalized.map(resource => {
      const existing = store.statements.getResource.get(id, resource.kind, resource.key);
      if (!existing) throw new Error(`未計画の取得単位です: ${resource.kind}/${resource.key}`);
      if (existing.completed) {
        if (
          existing.artifact_key !== resource.artifactKey ||
          existing.content_sha256 !== resource.contentSha256 ||
          Number(existing.raw_bytes) !== resource.rawBytes
        ) {
          throw new Error(`完了済みの取得結果は変更できません: ${resource.kind}/${resource.key}`);
        }
        return resourceRow(existing);
      }
      store.statements.completeResource.run(
        resource.artifactKey,
        resource.contentSha256,
        resource.rawBytes,
        fetchedAt,
        id,
        resource.kind,
        resource.key
      );
      return resourceRow(store.statements.getResource.get(id, resource.kind, resource.key));
    });
    store.statements.touchAudit.run(fetchedAt, id);
    return completed;
  });
}

export function getLodestoneAuditProgress(store, auditId) {
  const id = requiredText(auditId, '監査ID');
  if (!store.statements.getAudit.get(id)) throw new Error(`監査が見つかりません: ${id}`);
  const row = store.statements.progress.get(id);
  const total = Number(row.total);
  const completed = Number(row.completed);
  return { total, completed, pending: total - completed };
}

export function listPendingLodestoneAuditResources(store, auditId) {
  const id = requiredText(auditId, '監査ID');
  if (!store.statements.getAudit.get(id)) throw new Error(`監査が見つかりません: ${id}`);
  return store.statements.listPending.all(id).map(resourceRow);
}

export function getLodestoneAuditResource(store, auditId, kind, key) {
  const id = requiredText(auditId, '監査ID');
  return resourceRow(
    store.statements.getResource.get(id, assertResourceKind(kind), requiredText(key, '取得キー'))
  );
}

export function listLodestoneAuditResources(store, auditId, { kind = '' } = {}) {
  const id = requiredText(auditId, '監査ID');
  if (!store.statements.getAudit.get(id)) throw new Error(`監査が見つかりません: ${id}`);
  const rows = kind
    ? store.statements.listResourcesByKind.all(id, assertResourceKind(kind))
    : store.statements.listResources.all(id);
  return rows.map(resourceRow);
}

export function promoteCompletedLodestoneAudit(store, auditId, { now = Date.now() } = {}) {
  const id = requiredText(auditId, '監査ID');
  const completedAt = timestamp(now, '完了日時');
  return transaction(store.db, () => {
    assertRunningAudit(store, id);
    const progress = getLodestoneAuditProgress(store, id);
    if (progress.total === 0) throw new Error('取得計画が空の監査は完了できません');
    if (progress.pending > 0) throw new Error(`未完了の取得が残っています: ${progress.pending}件`);
    store.statements.completeAudit.run(completedAt, completedAt, id);
    store.statements.promoteAudit.run(id);
    return getPromotedLodestoneAudit(store);
  });
}

export function abandonLodestoneAudit(store, auditId, { now = Date.now() } = {}) {
  const id = requiredText(auditId, '監査ID');
  assertRunningAudit(store, id);
  store.statements.abandonAudit.run(timestamp(now, '中止日時'), id);
  return getLodestoneAudit(store, id);
}

export function getPromotedLodestoneAudit(store) {
  return auditRow(store.statements.promotedAudit.get());
}

export function listPromotedLodestoneAuditResources(store) {
  const audit = getPromotedLodestoneAudit(store);
  if (!audit) return [];
  return store.statements.listCompleted.all(audit.id).map(resourceRow);
}
