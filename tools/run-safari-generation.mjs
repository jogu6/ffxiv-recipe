import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, extname, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'pipeline/reports/safari-generation');
const page = '<!doctype html><meta charset="utf-8"><title>Generation continuation test</title><script type="module" src="/tests/browser-generation-harness.mjs"></script>';
const limitedPrefix = `globalThis.__xivcaWasmMaximumPages = 511;
globalThis.__xivcaStorageCacheBytes = 256 * 1024;
const OriginalMemory = WebAssembly.Memory;
WebAssembly.Memory = class extends OriginalMemory {
  constructor(options) { super({ ...options, maximum: Math.min(options.maximum ?? 65536, 511) }); }
};\n`;

// This managed runner owns the ephemeral HTTP server, driver and Safari session.
// It never discovers, suspends, or terminates a user's browser processes.
async function main() {
  assert.equal(process.platform, 'darwin', 'Real Safari requires macOS');
  await mkdir(output, { recursive: true });
  const hashes = {};
  for (const kind of ['engine', 'engine-parallel']) hashes[kind] = createHash('sha256')
    .update(await readFile(resolve(root, `macro-app/build/${kind}/xivca_macro_engine_bg.wasm`))).digest('hex');
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    let path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/' || path === '/background') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      return response.end(path === '/' ? page : '<title>Background tab</title>');
    }
    const limited = path.startsWith('/limited/');
    if (limited) path = path.slice('/limited'.length);
    const allowed = path === '/tests/browser-generation-harness.mjs'
      || /^\/macro-app\/(web|build)\/.*\.(js|wasm)$/.test(path);
    const file = resolve(root, '.' + path);
    if (!allowed || !file.startsWith(root + sep)) { response.writeHead(404); return response.end(); }
    try {
      let body = await readFile(file);
      if (path.endsWith('/solver-worker.js')) body = Buffer.from((limited ? limitedPrefix : '') + body.toString()
        .replace('__STAGED_WASM_SHA256__', hashes.engine).replace('__STAGED_PARALLEL_WASM_SHA256__', hashes['engine-parallel']));
      if (limited && path.endsWith('/solver-host.js')) body = Buffer.from('globalThis.__xivcaStorageCacheBytes = 256 * 1024;\n' + body.toString());
      response.setHeader('Content-Type', extname(file) === '.wasm' ? 'application/wasm' : 'text/javascript; charset=utf-8');
      response.end(body);
    } catch (error) { response.writeHead(500); response.end(String(error)); }
  });
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let driver, sessionId, driverError;
  const summary = { platform: process.platform, hashes, tests: [], limitations: [
    'macOS Safari only; this does not test iOS.',
    'Tab backgrounding is tested. Physical display sleep and OS process suspension are not reproduced by this runner.'
  ] };
  let aborted = false;
  const abort = () => { aborted = true; };
  process.once('SIGINT', abort); process.once('SIGTERM', abort);
  let driverPort;
  async function command(method, path, body) {
    const response = await fetch(`http://127.0.0.1:${driverPort}${path}`, { method,
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
    const data = await response.json();
    if (!response.ok || data.value?.error) throw new Error(JSON.stringify(data));
    return data.value;
  }
  const execute = script => command('POST', `/session/${sessionId}/execute/sync`, { script, args: [] });
  async function until(check, timeout = 180000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline && !aborted) {
      if (driverError) throw driverError;
      const result = await check();
      if (result) return result;
      await delay(200);
    }
    throw new Error('Safari generation test interrupted or timed out');
  }
  try {
    const probe = createServer();
    await new Promise((ok, fail) => { probe.once('error', fail); probe.listen(0, '127.0.0.1', ok); });
    driverPort = probe.address().port;
    await new Promise(ok => probe.close(ok));
    driver = spawn('/usr/bin/safaridriver', ['--port', String(driverPort)], { stdio: ['ignore', 'inherit', 'inherit'] });
    driver.on('error', error => { driverError = error; });
    await until(async () => { try { return await command('GET', '/status'); } catch { return false; } }, 20000);
    const session = await command('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } });
    sessionId = session.sessionId;
    summary.capabilities = session.capabilities;
    await command('POST', `/session/${sessionId}/url`, { url: origin });
    await until(() => execute('return typeof startGenerationTest === "function";'));
    for (const scenario of ['normal', 'background', 'small-normal', 'small-limited']) {
      const identity = await execute(`return startGenerationTest(${scenario === 'small-limited'}, ${scenario.startsWith('small-')});`);
      if (scenario === 'background') {
        await until(async () => { const state = await execute('return generationTestState();'); assert.ok(!state.error, JSON.stringify(state.error)); return state.samples > 0; });
        const before = await execute('return generationTestState();');
        assert.equal(before.done, false, 'Generation must still be running before backgrounding');
        const original = await command('GET', `/session/${sessionId}/window`);
        const other = await command('POST', `/session/${sessionId}/window/new`, { type: 'tab' });
        try {
          await command('POST', `/session/${sessionId}/window`, { handle: other.handle });
          await command('POST', `/session/${sessionId}/url`, { url: origin + '/background' });
          await delay(5000); // Test stimulus only; never added to the solver.
        } finally {
          await command('DELETE', `/session/${sessionId}/window`);
          await command('POST', `/session/${sessionId}/window`, { handle: original });
        }
      }
      await until(async () => (await execute('return generationTestState();')).done);
      const result = await execute('return generationTestResult();');
      await writeFile(resolve(output, `${scenario}.json`), JSON.stringify(result, null, 2));
      assert.ok(!result.error, JSON.stringify(result.error));
      assert.equal(result.pageId, identity.pageId); assert.equal(result.requestId, identity.requestId);
      assert.equal(result.samples.at(-1).stage, 'complete');
      assert.equal(result.storage?.metrics.storageBackend, 'opfs');
      assert.equal(result.storage?.metrics.storageReservedBytes, 3 * 1024 ** 3);
      assert.equal(result.result.actions.length, scenario.startsWith('small-') ? 6 : 13);
      if (scenario === 'background') {
        assert.ok(result.visibility.some(event => event.state === 'hidden'), 'Real hidden visibility transition required');
        assert.equal(result.visibility.at(-1)?.state, 'visible');
        assert.deepEqual(result.result, summary.tests[0].result);
      }
      if (scenario === 'small-limited') {
        assert.deepEqual(result.result, summary.tests.find(test => test.scenario === 'small-normal').result);
        assert.ok(result.samples.at(-1).storagePageReads > 0 && result.samples.at(-1).storagePageWrites > 0);
        assert.ok(result.samples.every(sample => sample.wasmMemoryBytes <= 511 * 65536));
      }
      await execute('disposeGenerationTest();');
      await until(async () => (await execute('return generationTestState();')).disposed);
      const files = await command('POST', `/session/${sessionId}/execute/async`, {
        script: 'const done = arguments[arguments.length-1]; generationTestStorageFiles().then(done, error => done({error:String(error)}));', args: [] });
      assert.deepEqual(files, [], 'Temporary search files must be removed');
      const record = { scenario, elapsedMs: result.elapsedMs, result: result.result, final: result.samples.at(-1), passed: true };
      summary.tests.push(record); console.log(JSON.stringify(record));
    }
  } catch (error) { summary.error = String(error.stack || error); throw error; }
  finally {
    await writeFile(resolve(output, 'summary.json'), JSON.stringify(summary, null, 2));
    if (sessionId) await command('DELETE', `/session/${sessionId}`).catch(() => {});
    if (driver && driver.exitCode === null && driver.signalCode === null) {
      driver.kill('SIGTERM');
      for (let i = 0; i < 30 && driver.exitCode === null && driver.signalCode === null; i++) await delay(100);
      if (driver.exitCode === null && driver.signalCode === null) driver.kill('SIGKILL');
    }
    server.closeAllConnections(); await new Promise(ok => server.close(ok));
    process.off('SIGINT', abort); process.off('SIGTERM', abort);
  }
}
await main();
