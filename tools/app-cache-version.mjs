import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const TEXT_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.md', '.webmanifest']);

function canonicalAssetBytes(relative, bytes) {
  if (!TEXT_EXTENSIONS.has(path.extname(relative).toLowerCase())) return bytes;
  return Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'), 'utf8');
}

export function expectedAppCacheVersion({ siteRoot, serviceWorkerSource }) {
  const current = serviceWorkerSource.match(/const\s+APP_CACHE_VERSION\s*=\s*['"]([^'"]+)['"];/u)?.[1] || '';
  const release = current.match(/v\d+(?:\.\d+)*/iu)?.[0];
  if (!release) throw new Error('APP_CACHE_VERSIONにユーザー確定版がありません。');
  const block = serviceWorkerSource.match(/const\s+PRECACHE_FILES\s*=\s*\[([\s\S]*?)\];/u)?.[1];
  if (!block) throw new Error('PRECACHE_FILESが見つかりません。');
  const files = [...block.matchAll(/['"](\.\/[^'"]+)['"]/gu)].map(match => match[1]);
  const hash = crypto.createHash('sha256');
  files.forEach(relative => {
    const file = path.join(siteRoot, relative.slice(2));
    if (!fs.existsSync(file)) throw new Error(`プリキャッシュ対象がありません: ${relative}`);
    hash.update(relative).update('\0').update(canonicalAssetBytes(relative, fs.readFileSync(file)));
  });
  return `ff14recipe-app-${release}-${hash.digest('hex').slice(0, 12)}`;
}

export function updateAppCacheVersion({ siteRoot, serviceWorkerPath }) {
  const source = fs.readFileSync(serviceWorkerPath, 'utf8');
  const version = expectedAppCacheVersion({ siteRoot, serviceWorkerSource: source });
  const next = source.replace(
    /const\s+APP_CACHE_VERSION\s*=\s*['"][^'"]+['"];/u,
    `const APP_CACHE_VERSION = '${version}';`
  );
  fs.writeFileSync(serviceWorkerPath, next, 'utf8');
  return version;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const repositoryRoot = path.resolve(import.meta.dirname, '..');
  const siteRoot = path.join(repositoryRoot, 'site');
  const version = updateAppCacheVersion({ siteRoot, serviceWorkerPath: path.join(siteRoot, 'sw.js') });
  process.stdout.write(`${version}\n`);
}
