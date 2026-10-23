import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import { readAppliedLodestoneState, matchesAppliedSource } from './lodestone-applied-state.mjs';
import { buildRecipeMonitorBaseline } from './lodestone-recipe-monitor.mjs';
import { containedPath, resolvePublicationPath } from './publication-paths.mjs';
import { AUTO_PUBLISH_FILES } from './auto-publish-files.mjs';

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

export function validatePublicationJournal({ root, publication, legacyRepositoryRoots = [], git = args =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim() }) {
  if (!['idle', 'published', 'failed', 'generating', 'committed', 'pushed'].includes(publication.status)) {
    throw new Error('公開ジャーナルの状態が不明です');
  }
  const pending = ['generating', 'committed', 'pushed'].includes(publication.status);
  if (pending) {
    for (const sha of [publication.baseCommit, publication.commitSha].filter(Boolean)) {
      if (!/^[a-f0-9]{40,64}$/.test(sha)) throw new Error('保存コミットIDが不正です');
      git(['cat-file', '-e', `${sha}^{commit}`]);
    }
    if (['committed', 'pushed'].includes(publication.status) && !publication.commitSha) throw new Error('再開するコミットIDがありません');
  }
  if (publication.status !== 'generating') return { pending, recovery: false };
  const snapshot = resolvePublicationPath(root, publication.snapshotRoot, 'snapshot', { legacyRepositoryRoots });
  const files = readJson(path.join(snapshot, 'files.json'));
  if (!Array.isArray(files) || files.some(file => !AUTO_PUBLISH_FILES.includes(file))) throw new Error('復旧バックアップ一覧が不正です');
  for (const file of files) containedPath(root, path.relative(root, path.join(snapshot, 'before', file)).split(path.sep).join('/'));
  const journalFile = path.join(snapshot, 'commit.json');
  if (fs.existsSync(journalFile)) {
    const journal = readJson(journalFile);
    const index = resolvePublicationPath(root, journal.indexPath, 'index', { legacyRepositoryRoots });
    const actual = path.resolve(root, git(['rev-parse', '--git-path', 'index']));
    if (fs.realpathSync(index) !== fs.realpathSync(actual)) throw new Error('復旧対象のGit indexが一致しません');
    for (const name of ['original.index', 'reconciled.index']) {
      containedPath(root, path.relative(root, path.join(snapshot, name)).split(path.sep).join('/'));
    }
    for (const sha of [journal.baseCommit, journal.commitSha]) {
      if (!/^[a-f0-9]{40,64}$/.test(sha || '')) throw new Error('復旧ジャーナルのコミットIDが不正です');
      git(['cat-file', '-e', `${sha}^{commit}`]);
    }
  }
  return { pending, recovery: true };
}

// No monitor invocation, network, logger, baseline promotion, or source SQLite open.
// SQLite is opened only after copying the database AND any WAL/SHM to scratch.
export function inspectLodestoneOffline({ root, legacyRepositoryRoots = [], git }) {
  root = path.resolve(root);
  const publicationFile = containedPath(root, 'pipeline/state/auto-publish.json');
  const publication = readJson(publicationFile);
  const journal = validatePublicationJournal({ root, publication, legacyRepositoryRoots, git });
  let applied = readAppliedLodestoneState({ repositoryRoot: root });
  if (!applied && publication.status === 'generating') {
    const snapshot = resolvePublicationPath(root, publication.snapshotRoot, 'snapshot', { legacyRepositoryRoots });
    const backupItem = containedPath(root, path.relative(root, path.join(snapshot, 'before/site/data/Item.json')).split(path.sep).join('/'));
    applied = readAppliedLodestoneState({ repositoryRoot: root, itemJsonPath: backupItem });
  }
  if (!applied) throw new Error('反映済み記録とItem.jsonの整合性を確認できません');
  const baseline = readJson(containedPath(root, 'pipeline/cache/lodestone-recipe-monitor.json'));
  if (baseline.schemaVersion !== 1 || !baseline.auditId || !Array.isArray(baseline.pages) ||
      !matchesAppliedSource(baseline.source, baseline.source)) throw new Error('比較基準のメタデータが不正です');
  // A pending update intentionally keeps the previous completed baseline until
  // deployment succeeds. Validate both lineages; do not require premature promotion.
  const baselineApplied = journal.pending ? { ...baseline.source, AuditId: baseline.auditId } : applied;
  for (const resource of baseline.pages) {
    containedPath(root, `pipeline/cache/lodestone-audits/${resource.artifactKey}`);
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ffxiv-monitor-offline-'));
  try {
    const source = containedPath(root, 'pipeline/cache/lodestone-audits.sqlite');
    const copied = path.join(temporary, 'audits.sqlite');
    const fingerprints = () => ['', '-wal', '-shm'].map(suffix => {
      if (!fs.existsSync(source + suffix)) return null;
      containedPath(root, 'pipeline/cache/lodestone-audits.sqlite' + suffix);
      const stat = fs.statSync(source + suffix);
      return [stat.size, stat.mtimeMs];
    });
    const before = fingerprints();
    for (const suffix of ['', '-wal', '-shm']) {
      if (fs.existsSync(source + suffix)) fs.copyFileSync(source + suffix, copied + suffix);
    }
    const db = new DatabaseSync(copied, { readOnly: true });
    let expected;
    try {
      const checks = db.prepare('PRAGMA quick_check').all();
      if (checks.length !== 1 || Object.values(checks[0])[0] !== 'ok') throw new Error('監査DBの整合性検査に失敗しました');
      const resources = db.prepare("SELECT artifact_key FROM resources WHERE audit_id IN (?, ?) AND kind = 'recipe-list-page' AND resource_key LIKE 'end:%'").all(baselineApplied.AuditId, applied.AuditId);
      for (const resource of resources) containedPath(root, `pipeline/cache/lodestone-audits/${resource.artifact_key}`);
      expected = buildRecipeMonitorBaseline({ root, applied: baselineApplied, databasePath: copied });
      if (journal.pending && applied.AuditId !== baseline.auditId) {
        buildRecipeMonitorBaseline({ root, applied, databasePath: copied });
      }
    } finally { db.close(); }
    const after = fingerprints();
    if (!isDeepStrictEqual(before, after)) throw new Error('検証中に監査DBが変更されました');
    if (!isDeepStrictEqual(expected, baseline)) throw new Error('比較基準と反映済み監査が一致しません');
    return { ok: true, status: publication.status, ...journal, pages: baseline.pages.length,
      lockPresent: fs.existsSync(path.join(root, 'pipeline/state/lodestone-monitor.lock')),
      publicationLockPresent: fs.existsSync(path.join(root, 'pipeline/state/auto-publish.lock')) };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
