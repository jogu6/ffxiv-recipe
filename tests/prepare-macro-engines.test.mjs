import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';
import { prepareMacroEngines } from '../tools/prepare-macro-engines.mjs';

test('CI builds and Rust toolchain installation require an actual engine-source change', () => {
  for (const file of ['deploy-pages.yml', 'validate.yml']) {
    const workflow = parse(fs.readFileSync(path.resolve(import.meta.dirname, '../.github/workflows', file), 'utf8'));
    for (const job of Object.values(workflow.jobs)) {
      const buildSteps = job.steps.filter(step => step.run?.includes('build:wasm') || /rust-toolchain|install-action@wasm-pack/u.test(step.uses || ''));
      if (!buildSteps.length) continue;
      assert.ok(job.steps.some(step => step.id === 'engines' && step.run === 'node tools/prepare-macro-engines.mjs'));
      for (const step of buildSteps) assert.equal(step.if, "steps.engines.outputs.build == 'true'");
    }
  }
});

function fixture(t) {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xivca-published-engine-'));
  t.after(() => fs.rmSync(repositoryRoot, { recursive: true, force: true }));
  const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
  const hash = crypto.createHash('sha256').update(wasm).digest('hex');
  const files = [
    'build/engine/xivca_macro_engine.js', 'build/engine/xivca_macro_engine_bg.wasm',
    'build/engine-parallel/xivca_macro_engine.js', 'build/engine-parallel/xivca_macro_engine_bg.wasm',
    'build/engine-parallel/snippets/rayon/workerHelpers.no-bundler.js'
  ];
  const sources = new Map([
    ['/ffxiv-recipe/sw.js', Buffer.from(`const PRECACHE_FILES = [${files.map(file => `'./macro-app/${file}'`).join(',')}];`)],
    ['/ffxiv-recipe/macro-app/web/solver-worker.js', Buffer.from(`const wasmSha256 = '${hash}';\nconst parallelWasmSha256 = '${hash}';`)],
    ...files.map(file => [`/ffxiv-recipe/macro-app/${file}`, file.endsWith('.wasm') ? wasm : Buffer.from('// existing deployed JS')])
  ]);
  const requests = [];
  const options = {
    repositoryRoot,
    api: async endpoint => endpoint.endsWith('/statuses') ? [{ state: 'success' }] : [{ id: 1, sha: 'a'.repeat(40) }],
    git: args => { assert.ok(args.includes('macro-app/engine')); return ''; },
    fetchImpl: async url => {
      requests.push(url.pathname);
      const bytes = sources.get(url.pathname);
      return { ok: Boolean(bytes), status: bytes ? 200 : 404, arrayBuffer: async () => bytes };
    }
  };
  return { repositoryRoot, wasm, sources, requests, options };
}

test('unchanged engine sources reuse the exact deployed WASM and glue bytes without invoking a builder', async t => {
  const f = fixture(t);
  const result = await prepareMacroEngines(f.options);
  assert.equal(result.build, false);
  assert.equal(result.reusedFiles, 5);
  for (const engine of ['engine', 'engine-parallel']) {
    assert.deepEqual(fs.readFileSync(path.join(f.repositoryRoot, `macro-app/build/${engine}/xivca_macro_engine_bg.wasm`)), f.wasm);
  }
});

test('only actual engine-source differences request a build', async t => {
  const f = fixture(t);
  const result = await prepareMacroEngines({ ...f.options, git: () => 'macro-app/engine/src/lib.rs' });
  assert.equal(result.build, true);
  assert.equal(f.requests.length, 0);
  assert.equal(fs.existsSync(path.join(f.repositoryRoot, 'macro-app/build')), false);
});

for (const failure of ['download', 'hash', 'path', 'deployment']) {
  test(`published-engine ${failure} failure stops without a build or partial replacement`, async t => {
    const f = fixture(t);
    if (failure === 'download') f.sources.delete('/ffxiv-recipe/macro-app/build/engine/xivca_macro_engine.js');
    if (failure === 'hash') f.sources.set('/ffxiv-recipe/macro-app/build/engine/xivca_macro_engine_bg.wasm', Buffer.from('corrupt'));
    if (failure === 'path') f.sources.set('/ffxiv-recipe/sw.js', Buffer.from("const PRECACHE_FILES = ['./macro-app/build/../escape.js'];"));
    if (failure === 'deployment') f.options.api = async () => [];
    await assert.rejects(prepareMacroEngines(f.options));
    assert.equal(fs.existsSync(path.join(f.repositoryRoot, 'macro-app/build')), false);
  });
}
