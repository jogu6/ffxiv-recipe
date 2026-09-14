import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateLicensePages } from './license-pages.mjs';

export const workerModificationNotice = '// Modified by XIVca: added shared search storage and worker failure reporting.';

export function licenseFileHash(file) {
  const bytes = fs.readFileSync(file);
  return createHash('sha256').update(bytes.toString('utf8').replaceAll('\r\n', '\n')).digest('hex');
}

export function validateLicenses({ repositoryRoot = path.resolve(import.meta.dirname, '..'), checkArtifacts = true } = {}) {
  validateLicensePages(repositoryRoot);
  const manifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'tools/license-inventory.json'), 'utf8'));
  const read = relative => fs.readFileSync(path.join(repositoryRoot, relative), 'utf8').replaceAll('\r\n', '\n');
  for (const entry of [...manifest.inputs, ...manifest.files]) {
    const file = path.join(repositoryRoot, entry.file);
    if (!fs.existsSync(file) || licenseFileHash(file) !== entry.sha256) {
      throw new Error(`ライセンスの照合が必要です: ${entry.file}（配布元・バージョン・原文を再確認してください）`);
    }
  }
  const lock = JSON.parse(read('package-lock.json'));
  for (const entry of manifest.npm) {
    if (lock.packages[`node_modules/${entry.name}`]?.version !== entry.version) {
      throw new Error(`同梱ライブラリの版がライセンス一覧と一致しません: ${entry.name}`);
    }
  }
  const notices = read('site/vendor/licenses/third-party-NOTICES.txt');
  for (const entry of manifest.packages) {
    if (!notices.includes(`${entry.name} ${entry.version}\n`) || !entry.notices.every(id => notices.includes(`\n${id}\n`))) {
      throw new Error(`第三者通知の項目が不足しています: ${entry.name} ${entry.version}`);
    }
  }
  for (const file of manifest.modifiedSources) {
    if (!/^\/\/ (?:Modified|Added) by XIVca:/mu.test(read(file))) {
      throw new Error(`改変表示がありません: ${file}`);
    }
  }
  for (const document of ['site/docs/license-notice.md', 'NOTICE.md']) {
    const content = read(document);
    for (const name of [document === 'NOTICE.md' ? 'third-party-NOTICES.txt' : 'third-party-NOTICES.html', 'rust-COPYRIGHT-library.html']) {
      if (!content.includes(name)) throw new Error(`ライセンス文書へのリンクがありません: ${document}: ${name}`);
    }
    for (const [, target] of content.matchAll(/\]\(([^)]+)\)/gu)) {
      if (/^https?:\/\//u.test(target)) continue;
      const file = path.resolve(repositoryRoot, path.dirname(document), target);
      if (!fs.existsSync(file)) throw new Error(`ライセンスリンク先がありません: ${document}: ${target}`);
    }
  }
  const sw = read('site/sw.js');
  for (const entry of manifest.files.filter(entry => entry.file.startsWith('site/vendor/licenses/'))) {
    if (!sw.includes(`'./${entry.file.slice(5)}'`)) throw new Error(`ライセンス文書がキャッシュ対象にありません: ${entry.file}`);
  }
  if (checkArtifacts) {
    const dir = path.join(repositoryRoot, 'site/macro-app/build/engine-parallel/snippets');
    const helpers = fs.readdirSync(dir, { recursive: true }).filter(file => file.endsWith('workerHelpers.no-bundler.js'));
    if (helpers.length !== 1) throw new Error('公開する並列ワーカーヘルパーを特定できません。');
    const helper = fs.readFileSync(path.join(dir, helpers[0]), 'utf8');
    if (!helper.startsWith(workerModificationNotice + '\n') || !helper.includes('Copyright 2022 Google Inc.')) {
      throw new Error('公開する並列ワーカーヘルパーの権利表示が不足しています。');
    }
  }
  return { packages: manifest.packages.length, licenseFiles: manifest.files.filter(entry => entry.file.startsWith('site/vendor/licenses/')).length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const result = validateLicenses({ checkArtifacts: !process.argv.includes('--source-only') });
  console.log(`第三者通知${result.packages}項目とライセンス文書${result.licenseFiles}件を照合しました。`);
}
