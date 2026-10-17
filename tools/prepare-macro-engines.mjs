import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const engineSources = [
  'macro-app/engine', 'macro-app/vendor', 'macro-app/.cargo',
  'macro-app/Cargo.toml', 'macro-app/Cargo.lock',
  'macro-app/tools/build-wasm.mjs', 'macro-app/tools/prepare-wasm.mjs',
  'macro-app/tools/prepare-parallel-wasm.mjs', 'macro-app/tools/asyncify-safety.mjs'
];
const defaultRoot = path.resolve(import.meta.dirname, '..');

// Reuse the deployed engine bytes when only data or browser UI changed.
// Network/integrity failures must never silently trigger a replacement build.
export async function prepareMacroEngines({
  repositoryRoot = defaultRoot,
  repository = process.env.GITHUB_REPOSITORY || 'jogu6/ffxiv-recipe',
  siteUrl = 'https://jogu6.github.io/ffxiv-recipe/',
  api = endpoint => JSON.parse(execFileSync('gh', ['api', endpoint], { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true })),
  git = args => execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true }).trim(),
  fetchImpl = fetch
} = {}) {
  const deployments = await api(`repos/${repository}/deployments?environment=github-pages&per_page=100`);
  let deployed;
  for (const deployment of deployments) {
    const statuses = await api(`repos/${repository}/deployments/${deployment.id}/statuses`);
    if (statuses[0]?.state === 'success') { deployed = deployment; break; }
  }
  if (!deployed) throw new Error('公開済みエンジンの配信元コミットを確認できません。自動再ビルドは行いません。');
  if (!/^[0-9a-f]{40}$/u.test(deployed.sha)) throw new Error('公開コミットの形式が不正です。');
  const changed = git(['diff', '--name-only', deployed.sha, 'HEAD', '--', ...engineSources]);
  if (changed) return { build: true, changedSources: changed.split(/\r?\n/u) };
  const read = async relative => {
    const url = new URL(relative, siteUrl);
    url.searchParams.set('engine-source', deployed.sha);
    const response = await fetchImpl(url, { cache: 'no-store', signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`公開済みエンジンを取得できません: ${relative} (HTTP ${response.status})`);
    return Buffer.from(await response.arrayBuffer());
  };
  const sw = (await read('sw.js')).toString('utf8');
  const block = sw.match(/const\s+PRECACHE_FILES\s*=\s*\[([\s\S]*?)\];/u)?.[1];
  if (!block) throw new Error('公開済みエンジンのファイル一覧を確認できません。');
  const files = [...block.matchAll(/['"]\.\/macro-app\/(build\/[^'"]+)['"]/gu)].map(match => match[1]);
  if (new Set(files).size !== files.length || files.some(file =>
    !/^build\/engine(?:-parallel)?\/[A-Za-z0-9_./-]+\.(?:js|wasm)$/u.test(file)
    || file.split('/').some(part => part === '..' || part === '.'))) {
    throw new Error('公開済みエンジンのファイルパスが不正です。');
  }
  const worker = (await read('macro-app/web/solver-worker.js')).toString('utf8');
  const hashes = {
    'build/engine/xivca_macro_engine_bg.wasm': worker.match(/const wasmSha256 = '([0-9a-f]{64})';/u)?.[1],
    'build/engine-parallel/xivca_macro_engine_bg.wasm': worker.match(/const parallelWasmSha256 = '([0-9a-f]{64})';/u)?.[1]
  };
  for (const file of [...Object.keys(hashes), 'build/engine/xivca_macro_engine.js', 'build/engine-parallel/xivca_macro_engine.js']) {
    if (!files.includes(file)) throw new Error(`公開済みエンジンの必須ファイルがありません: ${file}`);
  }
  if (Object.values(hashes).some(hash => !hash)) throw new Error('公開済みWASMの照合値がありません。');
  const downloads = [];
  for (const file of files) {
    const bytes = await read(`macro-app/${file}`);
    if (hashes[file] && crypto.createHash('sha256').update(bytes).digest('hex') !== hashes[file]) {
      throw new Error(`公開済みWASMの内容が照合値と一致しません: ${file}`);
    }
    downloads.push({ file, bytes });
  }
  // No outputs are written until every download and WASM hash has passed.
  for (const { file, bytes } of downloads) {
    const target = path.join(repositoryRoot, 'macro-app', file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
  return { build: false, deployedCommit: deployed.sha, reusedFiles: files.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const result = await prepareMacroEngines();
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `build=${result.build}\n`);
  console.log(JSON.stringify(result));
}
