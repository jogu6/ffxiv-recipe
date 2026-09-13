const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

// Optional CPU sampling remains inside the managed browser test. Dedicated
// workers create further Rayon workers, so attach recursively before they run.
async function observeCpu(context, page, testInfo) {
  const root = await context.newCDPSession(page);
  const sessions = new Map();
  let sequence = 0;
  async function attached(parent, info) {
    const pending = new Map();
    const client = {
      info, active: false,
      send(method, params = {}) {
        const id = ++sequence;
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CPU profile command timed out: ${method}`)); }, 5000);
          pending.set(id, { resolve, reject, timer });
          parent.send('Target.sendMessageToTarget', { sessionId: info.sessionId, message: JSON.stringify({ id, method, params }) })
            .catch(error => { clearTimeout(timer); pending.delete(id); reject(error); });
        });
      },
      received(message) {
        if (message.id && pending.has(message.id)) {
          const request = pending.get(message.id); pending.delete(message.id); clearTimeout(request.timer);
          if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
        } else if (message.method === 'Target.attachedToTarget') void attached(client, message.params);
        else if (message.method === 'Target.receivedMessageFromTarget') received(message.params);
      }
    };
    sessions.set(info.sessionId, client);
    try {
      await client.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: false }).catch(() => {});
      await client.send('Profiler.enable');
      await client.send('Profiler.setSamplingInterval', { interval: 5000 });
      await client.send('Profiler.start');
      client.active = true;
    } catch (error) { console.log('CPU profile setup:', error.message); }
    finally { await client.send('Runtime.runIfWaitingForDebugger').catch(() => {}); }
  }
  function received(info) { sessions.get(info.sessionId)?.received(JSON.parse(info.message)); }
  root.on('Target.attachedToTarget', info => void attached(root, info));
  root.on('Target.receivedMessageFromTarget', received);
  await root.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: false });
  return async () => {
    await Promise.allSettled([...sessions.values()].filter(client => client.active).map(async (client, index) => {
      const { profile } = await client.send('Profiler.stop');
      fs.writeFileSync(testInfo.outputPath(`cpu-${index}.json`), JSON.stringify({ target: client.info.targetInfo, profile }));
    }));
    await root.detach();
  };
}

// Opt-in: replay an existing local report without publishing its contents.
test('保存済みレポートの製作条件を同じ並列数で最後まで確認する', async ({ playwright }, testInfo) => {
  test.skip(!process.env.MACRO_TEST_REPORT, '保存済みレポートを指定した場合だけ実行する');
  test.setTimeout(1800000);
  const report = JSON.parse(fs.readFileSync(process.env.MACRO_TEST_REPORT, 'utf8'));
  const logicalProcessors = report.metadata.runtime.logicalProcessors;
  const limited = report.metadata.localResourceTest?.enabled === true;
  const context = await playwright.chromium.launchPersistentContext(testInfo.outputPath('profile'), {
    executablePath: process.env.MACRO_TEST_BROWSER || undefined,
    baseURL: 'http://127.0.0.1:4173', headless: true, serviceWorkers: 'block',
    viewport: { width: limited ? report.metadata.localResourceTest.width : 1495, height: 718 }
  });
  const page = await context.newPage();
  let latest, latestWork;
  const stopCpu = process.env.MACRO_TEST_CPU_PROFILE ? await observeCpu(context, page, testInfo) : null;
  if (stopCpu) await page.exposeFunction('stopCpuProfiles', stopCpu);
  const tick = setInterval(() => {
    if (latest) console.log(JSON.stringify({ stage: latest.stage, nodes: latest.searchNodes,
      elapsedMs: latest.workerElapsedMs, writes: latest.storagePageWrites,
      memoryBytes: latest.wasmMemoryBytes, work: latestWork }));
  }, 30000);
  try {
    const assetRoot = process.env.MACRO_TEST_ASSET_ROOT;
    if (assetRoot) await page.route('**/macro-app/**', route => {
      const relative = new URL(route.request().url()).pathname.split('/macro-app/')[1];
      return route.fulfill({ body: fs.readFileSync(path.join(assetRoot, relative)),
        contentType: relative.endsWith('.wasm') ? 'application/wasm' : 'text/javascript',
        headers: { 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin' } });
    });
    await page.exposeFunction('recordSample', sample => {
      latest = sample;
      fs.appendFileSync(testInfo.outputPath('samples.jsonl'), JSON.stringify(sample) + '\n');
    });
    await page.exposeFunction('recordWork', work => {
      latestWork = work;
      fs.appendFileSync(testInfo.outputPath('work-progress.jsonl'), JSON.stringify(work) + '\n');
    });
    await page.route('**/report-runner.html', route => route.fulfill({
      contentType: 'text/html', body: '<!doctype html><title>保存済み入力の検証</title>',
      headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }
    }));
    await page.route('**/solver-host.js*', async route => {
      if (assetRoot) return route.fulfill({ contentType: 'text/javascript',
        headers: { 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin' },
        body: `Object.defineProperty(navigator, 'hardwareConcurrency', { value: ${logicalProcessors} });\n`
          + fs.readFileSync(path.join(assetRoot, 'web/solver-host.js'), 'utf8') });
      const response = await route.fetch();
      await route.fulfill({ response, body: `Object.defineProperty(navigator, 'hardwareConcurrency', { value: ${logicalProcessors} });\n` + await response.text() });
    });
    await page.goto('/report-runner.html');
    const result = await page.evaluate(async ({ input, limited }) => {
      const worker = new Worker('/macro-app/web/solver-host.js' + (limited ? '?localMobile=1' : ''), { type: 'module' });
      const output = { storageEvents: [], liveProgress: [], workProgress: [], userAgent: navigator.userAgent };
      const started = performance.now();
      try {
        return await new Promise((resolve, reject) => {
          worker.onerror = event => reject(new Error(event.message));
          worker.onmessage = async ({ data }) => {
            if (data.type === 'ready') output.ready = data;
            if (data.type === 'storage-open') output.storage = data;
            if (data.type === 'storage-progress') output.storageEvents.push(data.metrics);
            if (data.type === 'telemetry') { output.final = data.snapshot; void window.recordSample({ ...data.snapshot, receivedElapsedMs: performance.now() - started }); }
            if (data.type === 'search-progress') output.liveProgress.push({ searchNodes: data.searchNodes, activityCount: data.activityCount, elapsedMs: performance.now() - started });
            if (data.type === 'work-progress') {
              const work = { ...data, elapsedMs: performance.now() - started };
              output.workProgress.push(work);
              void window.recordWork(work);
            }
            if (data.type === 'error') { output.error = data; resolve(output); }
            if (data.type === 'search-result') { output.result = data.result; output.elapsedMs = performance.now() - started; if (window.stopCpuProfiles) await window.stopCpuProfiles().catch(error => { output.cpuProfileError = String(error); }); resolve(output); }
          };
          worker.postMessage({ type: 'solve', requestId: 'saved-report', input });
        });
      } finally {
        await new Promise(resolve => {
          const timeout = setTimeout(resolve, 4000);
          worker.onmessage = ({ data }) => { if (data.type === 'disposed') { clearTimeout(timeout); resolve(); } };
          worker.postMessage({ type: 'dispose' });
        });
        worker.terminate();
      }
    }, { input: report.input, limited });
    const progressGaps = result.liveProgress.slice(1).map((progress, index) => progress.elapsedMs - result.liveProgress[index].elapsedMs);
    result.maxLiveProgressGapMs = Math.max(0, ...progressGaps);
    const activityTimes = [...result.liveProgress, ...result.workProgress].map(value => value.elapsedMs).sort((a, b) => a - b);
    if (activityTimes.length && result.elapsedMs) activityTimes.push(result.elapsedMs);
    result.maxActivityGapMs = Math.max(0, ...activityTimes.slice(1).map((time, index) => time - activityTimes[index]));
    fs.writeFileSync(testInfo.outputPath('comparison.json'), JSON.stringify({
      sourceStartedAt: report.startedAt, input: report.input,
      before: { elapsedMs: report.elapsedMs, result: report.result, final: report.samples.at(-1) },
      after: result
    }, null, 2));
    expect(result.error).toBeUndefined();
    expect(result.final.threadCount).toBe(report.metadata.runtime.threadCount);
    expect(result.result).toEqual(report.result);
    expect(result.final.stage).toBe('complete');
    expect(result.final.searchQueuedNodes).toBe(0);
    if (limited) {
      expect(result.final.wasmMemoryMaximumBytes).toBe(1073741824);
      expect(result.final.wasmMemoryGrowFailures).toBe(0);
      expect(result.final.wasmMemoryBytes).toBeLessThanOrEqual(1073741824);
    }
    expect(result.liveProgress.length).toBeGreaterThan(0);
    if (limited) {
      expect(result.workProgress.some(work => work.phase === 2 && work.completed > 0 && work.completed < work.total)).toBe(true);
      expect(result.maxActivityGapMs).toBeLessThan(5000);
      expect(result.workProgress.every(work => work.completed >= 0 && work.completed <= work.total)).toBe(true);
      expect(result.final.storageSolverWaitMs).toBeGreaterThanOrEqual(0);
    } else expect(result.maxLiveProgressGapMs).toBeLessThan(30000);
    expect(result.liveProgress.every((progress, index) => progress.searchNodes <= result.final.searchNodes
      && (index === 0 || progress.searchNodes >= result.liveProgress[index - 1].searchNodes))).toBe(true);
    console.log(JSON.stringify({ savedReportComparison: { ...result,
      storageEvents: { count: result.storageEvents.length, last: result.storageEvents.at(-1) },
      workProgress: { count: result.workProgress.length, last: result.workProgress.at(-1) },
      liveProgress: { count: result.liveProgress.length, last: result.liveProgress.at(-1) } } }));
  } finally {
    clearInterval(tick);
    await context.close();
  }
});
