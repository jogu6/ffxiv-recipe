import fs from 'node:fs';
import { inspectIndirectStoragePaths } from './asyncify-safety.mjs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const dir = fileURLToPath(new URL('../build/engine/', import.meta.url));
const file = path.join(dir, 'xivca_macro_engine.js');
let source = fs.readFileSync(file, 'utf8');
function replaceOnce(before, after) {
  if (source.split(before).length !== 2) throw new Error(`WASM glue contract changed: ${before}`);
  source = source.replace(before, after);
}
const imports = [...source.matchAll(/(__wbg_(?:read|write)_[0-9a-f]+): function/g)].map(match => './xivca_macro_engine_bg.js.' + match[1]);
if (imports.length !== 2) throw new Error('Expected exactly two storage imports');
const candidates = [process.env.WASM_OPT, 'wasm-opt'];
for (const root of [path.join(process.env.LOCALAPPDATA || os.homedir(), '.wasm-pack'), path.join(os.homedir(), '.cache/.wasm-pack'), path.join(os.homedir(), '.wasm-pack')]) {
  if (fs.existsSync(root)) for (const name of fs.readdirSync(root)) {
    if (name.startsWith('wasm-opt-')) candidates.push(path.join(root, name, 'bin', process.platform === 'win32' ? 'wasm-opt.exe' : 'wasm-opt'));
  }
}
const executable = candidates.find(candidate => candidate && spawnSync(candidate, ['--version']).status === 0);
if (!executable) throw new Error('wasm-opt is required for portable asynchronous storage');
const binary = path.join(dir, 'xivca_macro_engine_bg.wasm');
const output = path.join(dir, 'xivca_macro_engine_async.wasm');
const analysisFile = path.join(dir, 'asyncify-input.wat');
const analyzed = spawnSync(executable, [binary, '--all-features', '--emit-text', '-o', analysisFile], { encoding: 'utf8' });
if (analyzed.status !== 0) throw new Error('Cannot inspect the WASM call graph: ' + analyzed.stderr);
const proof = inspectIndirectStoragePaths(fs.readFileSync(analysisFile, 'utf8'), source);
fs.writeFileSync(path.join(dir, 'asyncify-proof.json'), JSON.stringify(proof, null, 2));
console.log('Asyncify call graph:', proof);
const converted = spawnSync(executable, [binary, '--asyncify', '-O2', '--all-features',
  ...(proof.safe ? ['--pass-arg=asyncify-ignore-indirect'] : []),
  '--pass-arg=asyncify-imports@' + imports.join(','), '-o', output], { stdio: 'inherit' });
if (converted.status !== 0) throw new Error('Asyncify transformation failed');
replaceOnce('export function solve_exact_observed_json(value, observer) {', 'export async function solve_exact_observed_json(value, observer) {');
replaceOnce('* @returns {string}\n */\nexport async function solve_exact_observed_json', '* @returns {Promise<string>}\n */\nexport async function solve_exact_observed_json');
replaceOnce('wasm.solve_exact_observed_json(retptr, ptr0, len0, addBorrowedObject(observer));', 'await runStoredSolve(wasm.solve_exact_observed_json, [retptr, ptr0, len0, addBorrowedObject(observer)]);');
replaceOnce('wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);', 'if (deferred3_0 !== undefined) wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);');
for (const method of ['read', 'write']) replaceOnce(`globalThis.__xivcaSearchStore.${method}(arg0, getArrayU8FromWasm0(arg1, arg2));`, `return storageImport(() => globalThis.__xivcaSearchStore.${method}(arg0, getArrayU8FromWasm0(arg1, arg2)));`);
source += `
// Asyncify is used on every origin and browser; no JSPI dependency.
let asyncifyData = 0, asyncifyPending, asyncifyFailure, asyncifyFailed = false;
function storageImport(operation) {
  if (wasm.asyncify_get_state() === 2) {
    wasm.asyncify_stop_rewind();
    if (asyncifyFailed) throw asyncifyFailure;
    return;
  }
  const result = operation();
  if (result && typeof result.then === 'function') {
    asyncifyFailure = undefined;
    asyncifyFailed = false;
    asyncifyPending = Promise.resolve(result).catch(error => { asyncifyFailed = true; asyncifyFailure = error; });
    wasm.asyncify_start_unwind(asyncifyData);
  }
}
async function runStoredSolve(solve, args) {
  const bytes = 1024 * 1024 + 8;
  const data = wasm.__wbindgen_malloc(bytes, 4);
  asyncifyData = data;
  const memory = new DataView(wasm.memory.buffer);
  memory.setUint32(data, data + 8, true);
  memory.setUint32(data + 4, data + bytes, true);
  try {
    let result = solve(...args);
    while (wasm.asyncify_get_state() === 1) {
      wasm.asyncify_stop_unwind();
      await asyncifyPending;
      wasm.asyncify_start_rewind(data);
      result = solve(...args);
    }
    return result;
  } finally {
    const state = wasm.asyncify_get_state();
    if (state === 1) wasm.asyncify_stop_unwind();
    if (state === 2) wasm.asyncify_stop_rewind();
    wasm.__wbindgen_free(data, bytes, 4);
    asyncifyData = 0;
    asyncifyPending = undefined;
  }
}
`;
fs.renameSync(output, binary);
fs.writeFileSync(file, source);
