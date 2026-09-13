import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, appendFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const files = new Set(['/tests/safari-storage-worker.mjs', '/macro-app/web/opfs-search-storage.js']);
const page = `<!doctype html><meta charset="utf-8"><title>Safari storage experiment</title>
<script>
window.events = [];
window.worker = new Worker('/tests/safari-storage-worker.mjs', { type: 'module' });
worker.onmessage = ({data}) => events.push(data);
worker.onerror = event => events.push({stage:'error', message:event.message});
</script>`;

// This runner owns its server, driver, and automation session. It never discovers
// or stops unrelated processes, and never uses the user's development ports.
async function main() {
  assert.equal(process.platform, 'darwin', 'Apple Safari requires the macOS runner');
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      return response.end(page);
    }
    if (!files.has(path)) { response.writeHead(404); return response.end(); }
    try {
      response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      response.end(await readFile(resolve(root, `.${path}`)));
    } catch { response.writeHead(500); response.end(); }
  });
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
  const url = `http://127.0.0.1:${server.address().port}/`;
  // Reserve a currently unused port without touching existing listeners.
  const probe = createServer();
  await new Promise((ok, fail) => { probe.once('error', fail); probe.listen(0, '127.0.0.1', ok); });
  const driverPort = probe.address().port;
  await new Promise(ok => probe.close(ok));
  const driver = spawn('/usr/bin/safaridriver', ['--port', String(driverPort)], { stdio: ['ignore', 'inherit', 'inherit'] });
  let driverError;
  driver.on('error', error => { driverError = error; });
  let sessionId;
  let aborted = false;
  const abort = () => { aborted = true; };
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  async function command(method, path, body) {
    const response = await fetch(`http://127.0.0.1:${driverPort}${path}`, {
      method, headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30000),
    });
    const result = await response.json();
    if (!response.ok || result.value?.error) throw new Error(JSON.stringify(result));
    return result.value;
  }
  let result;
  try {
    const readyDeadline = Date.now() + 20000;
    while (true) {
      if (aborted) throw new Error('Interrupted');
      if (driverError) throw driverError;
      if (driver.exitCode !== null) throw new Error(`SafariDriver exited: ${driver.exitCode}`);
      try { await command('GET', '/status'); break; }
      catch (error) { if (Date.now() >= readyDeadline) throw error; }
      await delay(250);
    }
    const session = await command('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } });
    sessionId = session.sessionId;
    console.log(JSON.stringify({ capabilities: session.capabilities }));
    await command('POST', `/session/${sessionId}/url`, { url });
    const deadline = Date.now() + 8 * 60 * 1000;
    let done = false;
    while (!done) {
      if (aborted || Date.now() >= deadline) throw new Error('Safari storage experiment interrupted or timed out');
      const events = await command('POST', `/session/${sessionId}/execute/sync`, {
        script: 'return window.events.splice(0);', args: [],
      });
      for (const event of events) {
        console.log(JSON.stringify(event));
        if (event.stage === 'error') throw new Error(event.message);
        if (event.stage === 'complete') { result = { capabilities: session.capabilities, ...event }; done = true; }
      }
      if (!done) await delay(1000);
    }
    if (process.env.GITHUB_STEP_SUMMARY) {
      await appendFile(process.env.GITHUB_STEP_SUMMARY,
        `## Apple Safari OPFS experiment\n\nBoth rounds wrote and verified every byte of 3 GiB, then removed all temporary files.\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n`);
    }
  } finally {
    if (sessionId) await command('DELETE', `/session/${sessionId}`).catch(error => console.error(error.message));
    if (driver.exitCode === null) {
      driver.kill('SIGTERM');
      for (let i = 0; i < 30 && driver.exitCode === null && driver.signalCode === null; i++) await delay(100);
      if (driver.exitCode === null && driver.signalCode === null) driver.kill('SIGKILL');
    }
    server.closeAllConnections();
    await new Promise(ok => server.close(ok));
    process.off('SIGINT', abort);
    process.off('SIGTERM', abort);
  }
}

await main();
