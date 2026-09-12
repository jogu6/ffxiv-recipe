import { spawnSync } from 'node:child_process';
const profile = process.argv.includes('--dev') ? '--dev' : '--release';
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: 'inherit', env });
  if (result.status !== 0) process.exit(result.status || 1);
}
run('rustup', ['run', 'nightly-2026-05-10', 'wasm-pack', 'build', 'engine', '--target', 'web', '--out-dir', '../build/engine', profile]);
run(process.execPath, ['tools/prepare-wasm.mjs']);
run('rustup', ['run', 'nightly-2026-05-10', 'wasm-pack', 'build', 'engine', '--target', 'web', '--out-dir', '../build/engine-parallel', profile, '--no-opt', '--features', 'parallel'], {
  ...process.env,
  RUSTFLAGS: '-C target-feature=+atomics,+bulk-memory,+simd128,-reference-types,-multivalue -C link-arg=--max-memory=4294967296 -C link-arg=--import-memory -C link-arg=--shared-memory -C link-arg=--export=__wasm_init_tls -C link-arg=--export=__tls_size -C link-arg=--export=__tls_align -C link-arg=--export=__tls_base'
});
run(process.execPath, ['tools/prepare-parallel-wasm.mjs']);
