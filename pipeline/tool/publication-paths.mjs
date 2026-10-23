import fs from 'node:fs';
import path from 'node:path';

// Check lexical containment AND existing ancestors (including symbolic links).
export function containedPath(root, relative, { mustExist = true } = {}) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') ||
      relative.includes('\0') || path.posix.isAbsolute(relative) || path.win32.isAbsolute(relative) ||
      relative.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('保存パスは正規化されたリポジトリ相対パスである必要があります');
  }
  const resolvedRoot = fs.realpathSync(root);
  const target = path.resolve(root, ...relative.split('/'));
  let ancestor = target;
  for (;;) {
    try { fs.lstatSync(ancestor); break; }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      ancestor = path.dirname(ancestor);
    }
  }
  const real = fs.realpathSync(ancestor);
  if (real !== resolvedRoot && !real.startsWith(resolvedRoot + path.sep)) {
    throw new Error('保存パスがリポジトリの外を指しています');
  }
  if (mustExist) fs.statSync(target);
  return target;
}

export function portablePath(root, absolute) {
  const relative = path.relative(path.resolve(root), path.resolve(absolute)).split(path.sep).join('/');
  containedPath(root, relative);
  return relative;
}

export function resolvePublicationPath(root, stored, kind, { legacyRepositoryRoots = [], mustExist = true } = {}) {
  if (typeof stored !== 'string' || !stored) throw new Error('保存パスがありません');
  if (stored.split(/[\\/]/).some(part => part === '..' || part === '.')) throw new Error('保存パスの相対移動は許可されません');
  let relative = stored;
  if (path.isAbsolute(stored)) {
    const nativeRelative = path.relative(path.resolve(root), stored).split(path.sep).join('/');
    if (nativeRelative && !nativeRelative.startsWith('../') && !path.isAbsolute(nativeRelative)) relative = nativeRelative;
  }
  if (relative === stored && path.win32.isAbsolute(stored)) {
    const normalized = path.win32.normalize(stored);
    const matches = legacyRepositoryRoots.filter(old =>
      typeof old === 'string' && /^[A-Za-z]:[\\/]/.test(old) &&
      normalized.toLowerCase().startsWith(path.win32.resolve(old).toLowerCase() + '\\'));
    if (matches.length !== 1) throw new Error('Windows保存パスの旧ルートを一意に確認できません');
    relative = path.win32.relative(matches[0], normalized).replaceAll('\\', '/');
  }
  const valid = kind === 'snapshot'
    ? /^pipeline\/state\/auto-publish-files-[A-Za-z0-9_-]+$/.test(relative)
    : kind === 'index' && relative === '.git/index';
  if (!valid) throw new Error('未対応または不明な公開ジャーナル保存パスです');
  return containedPath(root, relative, { mustExist });
}
