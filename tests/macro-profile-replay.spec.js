const { test: base, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const runFile = promisify(execFile);
const bravePath = 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe';
// The default isolated context keeps IndexedDB in RAM. Use a real profile so
// this measures disk-backed storage, like the user's normal Brave window.
const test = base.extend({
  context: async ({ playwright, contextOptions, launchOptions, baseURL, viewport }, use, testInfo) => {
    const profileDirectory = testInfo.outputPath('browser-profile');
    const context = await playwright.chromium.launchPersistentContext(profileDirectory, {
      ...launchOptions, ...contextOptions, baseURL, viewport, serviceWorkers: 'block', headless: true
    });
    context.profileDirectory = profileDirectory;
    try { await use(context); } finally { await context.close(); }
  }
});
if (fs.existsSync(bravePath)) test.use({ launchOptions: { executablePath: bravePath } });

test('保存した入力を再探索しブラウザーとOSの実測値を保存する', async ({ page, context }) => {
  test.skip(!process.env.MACRO_PROFILE_INPUT, 'MACRO_PROFILE_INPUT に計測ログのパスを指定する');
  const source = JSON.parse(fs.readFileSync(process.env.MACRO_PROFILE_INPUT, 'utf8'));
  const input = structuredClone(source.input);
  const stress = process.env.MACRO_PROFILE_STRESS || '';
  if (stress === 'all-nq') for (const ingredient of input.ingredients) ingredient.hq = false;
  if (stress === 'no-food') {
    input.craftsmanship = source.metadata.crafter.craftsmanship;
    input.control = source.metadata.crafter.control;
    input.maxCp = source.metadata.crafter.cp;
  }
  if (!['', 'all-nq', 'no-food'].includes(stress)) throw new Error('未対応の負荷条件です');
  const limitMs = Number(process.env.MACRO_PROFILE_LIMIT_MS || 180000);
  const targetNodes = Number(process.env.MACRO_PROFILE_TARGET_NODES || Infinity);
  const wasmLimit = Number(process.env.MACRO_PROFILE_WASM_MIB || 0);
  const cacheLimit = Number(process.env.MACRO_PROFILE_CACHE_MIB || 0);
  const mobile = process.env.MACRO_PROFILE_MOBILE === '1';
  const jspi = process.env.MACRO_PROFILE_JSPI === '1';
  const jspiBinary = jspi ? fs.readFileSync('pipeline/reports/macro-profiles/jspi-experiment.wasm') : null;
  const jspiHash = jspi ? require('node:crypto').createHash('sha256').update(jspiBinary).digest('hex') : null;
  test.setTimeout(limitMs + 60000);
  let hostEnvironment;
  if (process.platform === 'win32') {
    const { stdout } = await runFile('powershell.exe', ['-NoProfile', '-Command',
      '$cpu=Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed; $computer=Get-CimInstance Win32_ComputerSystem | Select-Object TotalPhysicalMemory; $memory=Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory | Select-Object AvailableMBytes,CommittedBytes; @{cpu=@($cpu);computer=$computer;memoryAtStart=$memory;powerScheme=(powercfg /getactivescheme | Out-String).Trim()} | ConvertTo-Json -Depth 4 -Compress'],
      { windowsHide: true, timeout: 15000 });
    hostEnvironment = JSON.parse(stdout);
    hostEnvironment.powerSchemeGuid = hostEnvironment.powerScheme?.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i)?.[0];
    delete hostEnvironment.powerScheme;
  }
  if (jspi) {
    await page.route('**/xivca_macro_engine_bg.wasm', route => route.fulfill({ contentType: 'application/wasm', body: jspiBinary }));
    await page.route('**/xivca_macro_engine.js', async route => {
      const response = await route.fetch();
      let body = await response.text();
      body = body.replace('function storageImport(operation) {', 'function storageImport(operation) { return operation();');
      body = body.replace('async function runStoredSolve(solve, args) {', 'async function runStoredSolve(solve, args) { return WebAssembly.promising(solve)(...args);');
      body = body.replace('    return {\n        __proto__: null,\n        "./xivca_macro_engine_bg.js": import0,',
        `    for (const key of Object.keys(import0)) if (/^__wbg_(read|write)_/.test(key)) import0[key] = new WebAssembly.Suspending(import0[key]);
    return {
        __proto__: null,
        "./xivca_macro_engine_bg.js": import0,`);
      await route.fulfill({ response, body });
    });
  }
  if (wasmLimit || cacheLimit || jspi) {
    await page.route('**/solver-worker.js*', async route => {
      const response = await route.fetch();
      const prefix = `${cacheLimit ? `globalThis.__xivcaStorageCacheBytes = ${cacheLimit} * 1024 * 1024;` : ''}
        ${wasmLimit ? `const OriginalMemory = WebAssembly.Memory;
        WebAssembly.Memory = class extends OriginalMemory {
          constructor(options) { super({ ...options, maximum: Math.min(options.maximum ?? 65536, ${wasmLimit} * 16) }); }
        };` : ''}`;
      let body = await response.text();
      if (jspi) body = body.replace(/const wasmSha256 = '[^']+';/, `const wasmSha256 = '${jspiHash}';`);
      await route.fulfill({ response, body: prefix + '\n' + body });
    });
  }
  await page.route('**/profile-runner.html', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>マクロ計測</title>', headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Opener-Policy': 'same-origin'
    }
  }));
  await page.goto('/profile-runner.html');
  await page.evaluate(async ({ input, metadata, mobile }) => {
    const { createProfiler } = await import('/macro-app/web/profiling.js');
    const recorder = createProfiler(localStorage);
    const worker = new Worker('/macro-app/web/solver-worker.js' + (mobile ? '?localMobile=1' : ''), { type: 'module' });
    globalThis.profileRecorder = recorder;
    globalThis.profileWorker = worker;
    globalThis.profileReady = false;
    worker.onmessage = ({ data }) => {
      if (data.type === 'ready') {
        recorder.start(input, { ...metadata, userAgent: navigator.userAgent,
          secureContext: isSecureContext, crossOriginIsolated, runtime: { threadCount: data.threadCount } });
        globalThis.profileReady = true;
        worker.postMessage({ type: 'solve', requestId: 'measured-solve', input });
      } else if (data.type === 'telemetry') recorder.sample(data.snapshot);
      else if (data.type === 'search-result') recorder.finish('completed', { result: data.result });
      else if (data.type === 'error') recorder.finish('error', { error: data.message, errorStack: data.errorStack });
    };
    worker.postMessage({ type: 'prepare', requestId: 'prepare', threadCount: 1 });
  }, { input, mobile, metadata: { wasmWaiting: jspi ? 'jspi-experiment' : 'asyncify', hostEnvironment, browserVersion: context.browser().version(), headless: true,
    viewport: page.viewportSize(), cpuThrottling: 'none', artificialSleep: mobile ? 'cooperative-4x-target' : 'none',
    developmentWasmLimitMiB: mobile ? 1024 : 0, osSampling: true,
    browserProfile: 'persistent-on-disk', wasmLimitMiB: wasmLimit, cacheLimitMiB: cacheLimit, source: source.metadata, workload: stress === 'all-nq' ? '全中間素材NQに変更した負荷試験'
    : stress === 'no-food' ? '食事・薬品補正を外した負荷試験（全中間素材HQ）' : '保存した入力そのまま' } });
  await expect.poll(() => page.evaluate(() => profileReady), { timeout: 30000 }).toBe(true);
  const cdp = await context.browser().newBrowserCDPSession();
  const osSamples = [];
  const started = Date.now();
  let previousNodes = -1;
  let previousStage;
  const directory = path.resolve(__dirname, '../pipeline/reports/macro-profiles');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `replay-${stress || 'exact'}-${Date.now()}.json`);
  console.log(JSON.stringify({ profileFile: file, wasmLimit, cacheLimit }));
  let profile;
  let stopReason = '計測時間または件数の上限';
  try {
    while (Date.now() - started < limitMs) {
      profile = await page.evaluate(() => profileRecorder.current);
      const latest = profile.samples.at(-1);
      if (latest?.searchNodes !== previousNodes || latest?.stage !== previousStage) {
        console.log(JSON.stringify({ elapsedMs: Date.now() - started, stage: latest?.stage,
          nodes: latest?.searchNodes, wasmBytes: latest?.wasmMemoryBytes,
          cacheBytes: latest?.storageResidentBytes, pressureEvents: latest?.storagePressureEvents, reads: latest?.storagePageReads, writes: latest?.storagePageWrites }));
        previousNodes = latest?.searchNodes; previousStage = latest?.stage;
      }
      fs.writeFileSync(file, JSON.stringify(profile));
      fs.writeFileSync(`${file}.os.json`, JSON.stringify({ samples: osSamples }));
      if (fs.existsSync(`${file}.stop`)) {
        stopReason = fs.readFileSync(`${file}.stop`, 'utf8').trim();
        break;
      }
      if (profile.status !== 'running' || latest?.searchNodes >= targetNodes) break;
      const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
      const databaseRoot = path.join(context.profileDirectory, 'Default', 'IndexedDB');
      const databaseFiles = fs.existsSync(databaseRoot)
        ? fs.readdirSync(databaseRoot, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile())
          .map(entry => { const filePath = path.join(entry.parentPath, entry.name);
            try { return { name: path.relative(databaseRoot, filePath), bytes: fs.statSync(filePath).size }; }
            catch { return null; } }).filter(Boolean) : [];
      const sample = { elapsedMs: Date.now() - started, processes: processInfo,
        databaseFiles, databaseFileBytes: databaseFiles.reduce((sum, file) => sum + file.bytes, 0) };
      if (process.platform === 'win32') {
        // Numeric PIDs come from this test's owned browser. Read-only OS counters.
        const ids = processInfo.map(p => Number(p.id)).filter(Number.isSafeInteger).join(',');
        try {
          const { stdout } = await runFile('powershell.exe', ['-NoProfile', '-Command',
            `$profileIds=@(${ids}); $processStats=Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $profileIds -contains [int]$_.IDProcess } | Select-Object IDProcess,WorkingSet,WorkingSetPrivate,PrivateBytes,PageFaultsPersec; $memoryStats=Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory | Select-Object AvailableMBytes,CommittedBytes,PagesInputPersec,PageReadsPersec; @{processes=@($processStats);systemMemory=$memoryStats} | ConvertTo-Json -Depth 4 -Compress`],
          { windowsHide: true, timeout: 10000 });
          sample.windows = JSON.parse(stdout);
        } catch (error) { sample.osCounterError = { message: error.message, stderr: error.stderr, killed: error.killed }; }
      }
      osSamples.push(sample);
      await page.waitForTimeout(5000);
    }
  } finally {
    profile = await page.evaluate(stopReason => {
      profileRecorder.finish('cancelled', { stopReason });
      profileWorker.terminate();
      return profileRecorder.current;
    }, stopReason);
    await cdp.detach();
    fs.writeFileSync(file, JSON.stringify(profile, null, 2));
    fs.writeFileSync(`${file}.os.json`, JSON.stringify({
      notes: 'PageFaultsPersec はソフトフォールトを含む。systemMemory はOS全体の値で、このブラウザーだけに帰属させない。CPU time は各プロセスの累積秒。',
      samples: osSamples
    }, null, 2));
    console.log(JSON.stringify({ profileFile: file, status: profile.status, last: profile.samples.at(-1) }));
  }
  expect(profile.samples.length).toBeGreaterThan(0);
  expect(profile.status).not.toBe('error');
  expect(osSamples.some(sample => sample.databaseFileBytes > 0)).toBe(true);
  if (process.env.MACRO_PROFILE_REQUIRE_COMPLETE === '1') expect(profile.status).toBe('completed');
  if (process.env.MACRO_PROFILE_REQUIRE_PRESSURE === '1') expect(profile.samples.some(sample => sample.storagePressureEvents > 0)).toBe(true);
  if (wasmLimit) expect(Math.max(...profile.samples.map(sample => sample.wasmMemoryBytes || 0))).toBeLessThanOrEqual(wasmLimit * 1024 * 1024);
  if (!stress && profile.status === 'completed' && source.result?.actions) {
    expect(profile.result.duration).toBe(source.result.duration);
    expect(profile.result.actions.length).toBe(source.result.actions.length);
  }
});
