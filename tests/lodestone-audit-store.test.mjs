import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  abandonLodestoneAudit,
  completeLodestoneAuditResource,
  createLodestoneAudit,
  findResumableLodestoneAudit,
  getLodestoneAudit,
  getLodestoneAuditProgress,
  getPromotedLodestoneAudit,
  listPromotedLodestoneAuditResources,
  listPendingLodestoneAuditResources,
  openLodestoneAuditStore,
  planLodestoneAuditResource,
  promoteCompletedLodestoneAudit,
  setLodestoneAuditCatalogFingerprint
} from '../pipeline/tool/lodestone-audit-store.mjs';

function withStore(action) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ffxiv-recipe-audit-'));
  const databasePath = path.join(root, 'lodestone-audits.sqlite');
  const store = openLodestoneAuditStore(databasePath);
  try {
    return action(store, databasePath);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('schema 1 audit database migrates without losing resources and accepts item details', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ffxiv-recipe-audit-v1-'));
  const databasePath = path.join(root, 'lodestone-audits.sqlite');
  const legacy = new DatabaseSync(databasePath);
  try {
    legacy.exec(`
      PRAGMA user_version=1;
      PRAGMA foreign_keys=ON;
      CREATE TABLE audits (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'abandoned')),
        catalog_fingerprint TEXT, started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        completed_at INTEGER
      ) WITHOUT ROWID;
      CREATE TABLE resources (
        audit_id TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('item-list-page', 'recipe-list-page', 'recipe-detail')),
        resource_key TEXT NOT NULL, url TEXT NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
        artifact_key TEXT, content_sha256 TEXT, raw_bytes INTEGER, fetched_at INTEGER,
        PRIMARY KEY (audit_id, kind, resource_key)
      ) WITHOUT ROWID;
      CREATE INDEX resources_pending ON resources(audit_id, completed, kind, resource_key);
      CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
      INSERT INTO audits VALUES ('audit-1', 'running', 'catalog-a', 100, 100, NULL);
      INSERT INTO resources VALUES (
        'audit-1', 'recipe-detail', 'recipe-a', 'https://example.invalid/recipe/a',
        0, NULL, NULL, NULL, NULL
      );
    `);
  } finally {
    legacy.close();
  }
  const store = openLodestoneAuditStore(databasePath);
  try {
    assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 2);
    assert.deepEqual(listPendingLodestoneAuditResources(store, 'audit-1').map(row => row.key), ['recipe-a']);
    planLodestoneAuditResource(store, 'audit-1', {
      kind: 'item-detail', key: 'item-a', url: 'https://example.invalid/item/a'
    });
    assert.deepEqual(
      listPendingLodestoneAuditResources(store, 'audit-1').map(row => row.key),
      ['item-a', 'recipe-a']
    );
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Lodestone audit persists resumable progress by catalog fingerprint', () => {
  withStore((store, databasePath) => {
    const audit = createLodestoneAudit(store, { id: 'audit-1', now: 100 });
    assert.equal(audit.catalogFingerprint, null);
    setLodestoneAuditCatalogFingerprint(store, audit.id, 'catalog-a', { now: 110 });
    planLodestoneAuditResource(
      store,
      audit.id,
      { kind: 'recipe-list-page', key: '1', url: 'https://example.invalid/recipe?page=1' },
      { now: 120 }
    );
    planLodestoneAuditResource(
      store,
      audit.id,
      { kind: 'recipe-detail', key: 'recipe-a', url: 'https://example.invalid/recipe/a' },
      { now: 130 }
    );
    completeLodestoneAuditResource(
      store,
      audit.id,
      {
        kind: 'recipe-list-page',
        key: '1',
        artifactKey: 'audit-1/recipe-list-page/1',
        contentSha256: 'a'.repeat(64),
        rawBytes: 123
      },
      { now: 140 }
    );

    assert.deepEqual(getLodestoneAuditProgress(store, audit.id), { total: 2, completed: 1, pending: 1 });
    assert.equal(getPromotedLodestoneAudit(store), null);
    const reopened = openLodestoneAuditStore(databasePath);
    try {
      assert.equal(findResumableLodestoneAudit(reopened, 'catalog-a').id, audit.id);
      assert.equal(findResumableLodestoneAudit(reopened, 'catalog-b'), null);
      assert.deepEqual(
        listPendingLodestoneAuditResources(reopened, audit.id).map(resource => resource.key),
        ['recipe-a']
      );
    } finally {
      reopened.close();
    }
  });
});

test('Lodestone audit promotes atomically only after every planned resource completes', () => {
  withStore(store => {
    createLodestoneAudit(store, { id: 'audit-1', catalogFingerprint: 'catalog-a', now: 100 });
    planLodestoneAuditResource(store, 'audit-1', {
      kind: 'item-list-page',
      key: '1',
      url: 'https://example.invalid/item?page=1'
    });
    assert.throws(() => promoteCompletedLodestoneAudit(store, 'audit-1'), /未完了の取得/);
    assert.equal(getPromotedLodestoneAudit(store), null);

    completeLodestoneAuditResource(store, 'audit-1', {
      kind: 'item-list-page',
      key: '1',
      artifactKey: 'audit-1/item-list-page/1',
      contentSha256: 'b'.repeat(64),
      rawBytes: 456
    });
    assert.equal(promoteCompletedLodestoneAudit(store, 'audit-1', { now: 200 }).id, 'audit-1');
    assert.equal(getLodestoneAudit(store, 'audit-1').status, 'completed');
    assert.deepEqual(
      listPromotedLodestoneAuditResources(store).map(resource => resource.artifactKey),
      ['audit-1/item-list-page/1']
    );
    assert.throws(
      () => planLodestoneAuditResource(store, 'audit-1', {
        kind: 'item-list-page',
        key: '2',
        url: 'https://example.invalid/item?page=2'
      }),
      /実行中ではない監査/
    );

    createLodestoneAudit(store, { id: 'audit-2', catalogFingerprint: 'catalog-b', now: 300 });
    assert.equal(getPromotedLodestoneAudit(store).id, 'audit-1');
    assert.equal(listPromotedLodestoneAuditResources(store).length, 1);
  });
});

test('Lodestone audit rejects plan drift and completed resource replacement', () => {
  withStore(store => {
    createLodestoneAudit(store, { id: 'audit-1', catalogFingerprint: 'catalog-a' });
    const resource = {
      kind: 'recipe-detail',
      key: 'recipe-a',
      url: 'https://example.invalid/recipe/a'
    };
    planLodestoneAuditResource(store, 'audit-1', resource);
    planLodestoneAuditResource(store, 'audit-1', resource);
    assert.throws(
      () => planLodestoneAuditResource(store, 'audit-1', { ...resource, url: 'https://example.invalid/recipe/changed' }),
      /異なるURL/
    );

    const result = {
      kind: resource.kind,
      key: resource.key,
      artifactKey: 'audit-1/recipe-detail/recipe-a',
      contentSha256: 'c'.repeat(64),
      rawBytes: 789
    };
    completeLodestoneAuditResource(store, 'audit-1', result);
    completeLodestoneAuditResource(store, 'audit-1', result);
    assert.throws(
      () => completeLodestoneAuditResource(store, 'audit-1', { ...result, contentSha256: 'd'.repeat(64) }),
      /完了済みの取得結果は変更できません/
    );
  });
});

test('abandoned Lodestone audit cannot resume or replace the promoted audit', () => {
  withStore(store => {
    createLodestoneAudit(store, { id: 'audit-1', catalogFingerprint: 'catalog-a', now: 100 });
    assert.equal(abandonLodestoneAudit(store, 'audit-1', { now: 200 }).status, 'abandoned');
    assert.equal(findResumableLodestoneAudit(store, 'catalog-a'), null);
    assert.equal(getPromotedLodestoneAudit(store), null);
  });
});
