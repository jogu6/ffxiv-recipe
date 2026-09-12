// Served and injected only by serve-local-app.py; never staged into site/.
(() => {
  const token = document.currentScript.dataset.token;
  const limits = () => ({ enabled: window.top.innerWidth <= 600, width: window.top.innerWidth,
    cpuMode: 'cooperative-worker-budget', slowdownTarget: 4, wasmMaximumBytes: 1073741824, threadCount: 1 });
  globalThis.__localMobileLimits = limits;
  const OriginalWorker = globalThis.Worker;
  globalThis.Worker = class extends OriginalWorker {
    constructor(url, options) {
      const resolved = new URL(url, location.href);
      if (resolved.pathname.endsWith('/solver-worker.js')) {
        globalThis.__localMobileApplied = limits();
        globalThis.__localMobileMode = limits().enabled;
        if (globalThis.__localMobileMode) resolved.searchParams.set('localMobile', '1');
      }
      super(resolved, options);
    }
  };
  function showLimits() {
    let label = document.getElementById('localMobileLimits');
    if (!label) {
      label = document.createElement('div'); label.id = 'localMobileLimits';
      label.style.cssText = 'padding:8px;color:#f2cf6b;font-size:12px;';
      document.getElementById('generateButton')?.before(label);
    }
    label.textContent = limits().enabled
      ? '開発試験：次の生成は1スレッド・WASM上限1GiB・探索区間ごとの休止で約4倍の所要時間を目標（実CPU・OSメモリー制限ではありません）'
      : '開発試験：次の生成は通常設定（画面幅600px以下で制限）';
  }
  document.addEventListener('DOMContentLoaded', showLimits);
  window.top.addEventListener('resize', showLimits);
  let run = null;
  let busy = false;
  let lastSample = null;
  let changedAt = performance.now();
  globalThis.__localMacroUpload = { state: 'waiting' };

  async function transmit() {
    const profile = globalThis.__xivcaMacroProfile;
    if (busy || !profile) return;
    if (!run || run.startedAt !== profile.startedAt) {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes); // Available on LAN HTTP too.
      run = { id: Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(''),
        startedAt: profile.startedAt, sequence: 0, acknowledgedTime: -1, done: false };
      lastSample = null;
      changedAt = performance.now();
    }
    if (run.done) return;
    const currentRun = run;
    const newest = profile.samples.at(-1);
    if (newest !== lastSample) { lastSample = newest; changedAt = performance.now(); }
    const { samples, ...header } = profile;
    header.metadata = { ...header.metadata, localResourceTest: {
      ...(profile.metadata.localResourceTest || { enabled: null, unknown: true }), widthAtUpload: window.top.innerWidth
    } };
    header.localResourceMeasurement = {
      simulatedSleepMs: globalThis.__xivcaMacroEngineStatus?.telemetry?.localSimulatedSleepMs ?? 0
    };
    const payload = {
      runId: currentRun.id, sequence: ++currentRun.sequence, profile: header,
      samples: samples.filter(sample => sample.elapsedMs > currentRun.acknowledgedTime),
      heartbeat: { clientTime: new Date().toISOString(), visibility: document.visibilityState,
        lastObservedChangeAgeMs: performance.now() - changedAt,
        runningElapsedMs: Date.now() - Date.parse(profile.startedAt) }
    };
    busy = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
      const response = await fetch('/__local/macro-profile', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Local-Profile-Token': token },
        body: JSON.stringify(payload), signal: controller.signal, cache: 'no-store'
      });
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      currentRun.acknowledgedTime = payload.samples.at(-1)?.elapsedMs ?? currentRun.acknowledgedTime;
      currentRun.done = payload.profile.status !== 'running';
      globalThis.__localMacroUpload = { state: 'received', runId: currentRun.id,
        receivedAt: new Date().toISOString(), sequence: currentRun.sequence };
    } catch (error) {
      globalThis.__localMacroUpload = { state: 'retrying', runId: currentRun.id, error: String(error) };
    } finally {
      clearTimeout(timeout);
      busy = false;
    }
  }
  setInterval(transmit, 5000);
  document.addEventListener('visibilitychange', transmit);
  window.addEventListener('pagehide', transmit);
  void transmit();
})();
