import fs from 'node:fs';
import path from 'node:path';
import { updateAppCacheVersion } from '../../tools/app-cache-version.mjs';

export const AUTO_PUBLISH_FILES = Object.freeze([
  'site/app.js', 'site/data/Item.json', 'site/data/item-icons.pack.gz',
  'site/data/legacy-item-ids.json', 'site/item-icon-pack.js', 'site/sw.js',
]);
const constants = {
  'site/app.js': ['DATA_CACHE_VERSION'],
  'site/item-icon-pack.js': ['PACK_VERSION'],
  'site/sw.js': ['DATA_CACHE_VERSION'],
};

function copy(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function transferConstants(source, generated, names) {
  for (const name of names) {
    const pattern = new RegExp(`const\\s+${name}\\s*=\\s*(['"])[^'"]+\\1;`, 'g');
    const replacements = [...generated.matchAll(pattern)];
    if (replacements.length !== 1 || [...source.matchAll(pattern)].length !== 1) {
      throw new Error(`公開用の定数を一意に確認できません: ${name}`);
    }
    source = source.replace(pattern, () => replacements[0][0]);
  }
  return source;
}

export function snapshotPublicFiles(repositoryRoot, snapshotRoot) {
  fs.mkdirSync(snapshotRoot, { recursive: true });
  const present = AUTO_PUBLISH_FILES.filter(file => fs.existsSync(path.join(repositoryRoot, file)));
  for (const file of present) copy(path.join(repositoryRoot, file), path.join(snapshotRoot, 'before', file));
  fs.writeFileSync(path.join(snapshotRoot, 'files.json'), JSON.stringify(present));
}

export function restorePublicFiles(repositoryRoot, snapshotRoot) {
  const present = JSON.parse(fs.readFileSync(path.join(snapshotRoot, 'files.json'), 'utf8'));
  for (const file of AUTO_PUBLISH_FILES) {
    const target = path.join(repositoryRoot, file);
    if (present.includes(file) && constants[file] && fs.existsSync(target)) {
      const names = file === 'site/sw.js' ? [...constants[file], 'APP_CACHE_VERSION'] : constants[file];
      fs.writeFileSync(target, transferConstants(fs.readFileSync(target, 'utf8'),
        fs.readFileSync(path.join(snapshotRoot, 'before', file), 'utf8'), names));
    } else if (present.includes(file)) copy(path.join(snapshotRoot, 'before', file), target);
    else fs.rmSync(target, { force: true });
  }
}

// Build the commit from HEAD in a separate index. Only generated data and named
// constants cross from the working tree; staged edits never enter this index.
export async function preparePublicationFiles({ repositoryRoot, snapshotRoot, baseCommit, run, logger }) {
  const candidateRoot = path.join(snapshotRoot, 'candidate');
  const candidateIndex = path.join(snapshotRoot, 'candidate.index');
  fs.mkdirSync(candidateRoot, { recursive: true });
  const env = { GIT_INDEX_FILE: candidateIndex, GIT_WORK_TREE: candidateRoot };
  const options = { cwd: repositoryRoot, logger, env };
  await run('git', ['read-tree', baseCommit], options);
  await run('git', ['checkout-index', '--all', '--force', `--prefix=${candidateRoot.replaceAll('\\', '/')}/`], options);
  for (const file of AUTO_PUBLISH_FILES) {
    const generated = path.join(repositoryRoot, file);
    const target = path.join(candidateRoot, file);
    if (constants[file]) {
      fs.writeFileSync(target, transferConstants(fs.readFileSync(target, 'utf8'),
        fs.readFileSync(generated, 'utf8'), constants[file]));
    } else copy(generated, target);
  }
  updateAppCacheVersion({ siteRoot: path.join(candidateRoot, 'site'), serviceWorkerPath: path.join(candidateRoot, 'site/sw.js') });
  await run('git', ['add', '--', ...AUTO_PUBLISH_FILES], options);
  await run('git', ['diff', '--cached', '--check'], options);
  const changedFiles = (await run('git', ['diff', '--cached', '--name-only'], options)).stdout.trim().split(/\r?\n/).filter(Boolean);
  return { candidateRoot, candidateIndex, env, changedFiles };
}

export async function commitPublicationFiles({ repositoryRoot, snapshotRoot, baseCommit, branch, prepared, message, run, logger }) {
  const options = { cwd: repositoryRoot, logger };
  const indexPath = path.resolve(repositoryRoot, (await run('git', ['rev-parse', '--git-path', 'index'], options)).stdout.trim());
  const originalIndex = fs.readFileSync(indexPath);
  const indexLock = `${indexPath}.lock`;
  const lock = fs.openSync(indexLock, 'wx');
  let lockOwned = true;
  let lockOpen = true;
  try {
    // Refuse concurrent edits rather than replacing an index changed during preparation.
    if (!fs.readFileSync(indexPath).equals(originalIndex)) throw new Error('ステージ内容が変更されました。次回再試行します。');
    const currentBranch = (await run('git', ['branch', '--show-current'], options)).stdout.trim();
    if (currentBranch !== branch) throw new Error('公開処理中にブランチが変更されました。');
    const reconciledIndex = path.join(snapshotRoot, 'reconciled.index');
    const stagedRoot = path.join(snapshotRoot, 'staged');
    fs.mkdirSync(stagedRoot, { recursive: true });
    fs.writeFileSync(reconciledIndex, originalIndex);
    const stagedOptions = { ...options, env: { GIT_INDEX_FILE: reconciledIndex, GIT_WORK_TREE: stagedRoot } };
    await run('git', ['checkout-index', '--force', `--prefix=${stagedRoot.replaceAll('\\', '/')}/`, '--', ...prepared.changedFiles], stagedOptions);
    for (const file of prepared.changedFiles) {
      const target = path.join(stagedRoot, file);
      const candidate = path.join(prepared.candidateRoot, file);
      if (constants[file]) {
        const names = file === 'site/sw.js' ? [...constants[file], 'APP_CACHE_VERSION'] : constants[file];
        fs.writeFileSync(target, transferConstants(fs.readFileSync(target, 'utf8'), fs.readFileSync(candidate, 'utf8'), names));
      } else copy(candidate, target);
    }
    await run('git', ['add', '--', ...prepared.changedFiles], stagedOptions);
    const commitOptions = { ...options, env: prepared.env };
    const tree = (await run('git', ['write-tree'], commitOptions)).stdout.trim();
    const commitSha = (await run('git', ['commit-tree', tree, '-p', baseCommit, '-m', message], commitOptions)).stdout.trim();
    // Durable journal also covers interruption between the ref and index updates.
    fs.writeFileSync(path.join(snapshotRoot, 'original.index'), originalIndex);
    fs.writeFileSync(path.join(snapshotRoot, 'commit.json'), JSON.stringify({ commitSha, baseCommit, branch, indexPath }));
    await run('git', ['update-ref', '-m', message, `refs/heads/${branch}`, commitSha, baseCommit], options);
    fs.writeFileSync(lock, fs.readFileSync(reconciledIndex));
    fs.closeSync(lock);
    lockOpen = false;
    fs.renameSync(indexLock, indexPath);
    lockOwned = false;
    return commitSha;
  } finally {
    if (lockOpen) fs.closeSync(lock);
    if (lockOwned) fs.rmSync(indexLock, { force: true });
  }
}

export async function recoverPublicationCommit({ repositoryRoot, snapshotRoot, run, logger }) {
  const journalPath = path.join(snapshotRoot, 'commit.json');
  if (!fs.existsSync(journalPath)) return null;
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  const head = (await run('git', ['rev-parse', `refs/heads/${journal.branch}`], { cwd: repositoryRoot, logger })).stdout.trim();
  if (head !== journal.commitSha) return null;
  const index = fs.readFileSync(journal.indexPath);
  const original = fs.readFileSync(path.join(snapshotRoot, 'original.index'));
  const reconciled = fs.readFileSync(path.join(snapshotRoot, 'reconciled.index'));
  if (index.equals(original)) {
    const lockPath = `${journal.indexPath}.lock`;
    const lock = fs.openSync(lockPath, 'wx');
    let lockOwned = true;
    let lockOpen = true;
    try {
      if (!fs.readFileSync(journal.indexPath).equals(original)) throw new Error('公開復旧中にステージ内容が変更されました。');
      fs.writeFileSync(lock, reconciled);
      fs.closeSync(lock);
      lockOpen = false;
      fs.renameSync(lockPath, journal.indexPath);
      lockOwned = false;
    } finally {
      if (lockOpen) fs.closeSync(lock);
      if (lockOwned) fs.rmSync(lockPath, { force: true });
    }
  } else if (!index.equals(reconciled)) {
    // Later user staging is authoritative; never overwrite it during recovery.
    logger?.write('公開コミット後のステージ変更を保持しました');
  }
  return journal.commitSha;
}
