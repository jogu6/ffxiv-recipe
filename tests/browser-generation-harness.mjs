// Test page only. The production solver and storage modules are not modified.
export const input = {
  crafterLevel: 100, craftsmanship: 5655, control: 5399, maxCp: 400,
  maxDurability: 70, maxProgress: 4000, maxQuality: 7000, targetQuality: 7000,
  recipeLevel: { jobLevel: 100, progressDivisor: 170, qualityDivisor: 150, progressModifier: 90, qualityModifier: 75 },
  materialQualityPercent: 0, ingredients: [], manipulationAvailable: true,
  heartAndSoulAvailable: false, quickInnovationAvailable: false, trainedEyeAvailable: false,
  adversarial: true, stellarSteadyHandCharges: 0
};
const pageId = crypto.randomUUID();
const visibility = [];
document.addEventListener('visibilitychange', () => visibility.push({ state: document.visibilityState, at: performance.now() }));
const lifecycle = [];
for (const name of ['freeze', 'resume', 'pagehide', 'pageshow']) document.addEventListener(name,
  event => lifecycle.push({ name, persisted: event.persisted ?? null, at: performance.now() }), true);
const small = { ...input, maxCp: 200, maxDurability: 40, maxProgress: 500, maxQuality: 3000, targetQuality: 3000 };
let worker, run;
globalThis.startGenerationTest = (limited = false, smallInput = false) => {
  if (worker) throw new Error('Previous test worker has not been disposed');
  visibility.length = 0; lifecycle.length = 0;
  run = { pageId, requestId: crypto.randomUUID(), started: performance.now(), samples: [], storageEvents: [], visibility, lifecycle,
    input: smallInput ? small : input, limited, userAgent: navigator.userAgent, crossOriginIsolated };
  worker = new Worker(`${limited ? '/limited' : ''}/macro-app/web/solver-host.js`, { type: 'module' });
  worker.onerror = event => { run.error = event.message; run.done = true; };
  worker.onmessage = ({ data }) => {
    if (data.type === 'telemetry') run.samples.push({ ...data.snapshot, receivedMs: performance.now() - run.started });
    if (data.type === 'storage-progress') run.storageEvents.push(data.metrics);
    if (data.type === 'storage-open') run.storage = data;
    if (data.type === 'search-result' || data.type === 'error') {
      run[data.type === 'error' ? 'error' : 'result'] = data.type === 'error' ? data : data.result;
      run.elapsedMs = performance.now() - run.started;
      run.done = true;
    }
    if (data.type === 'disposed') { worker.terminate(); worker = null; run.disposed = true; }
  };
  worker.postMessage({ type: 'solve', requestId: run.requestId, input: run.input });
  return { pageId, requestId: run.requestId };
};
globalThis.generationTestState = () => ({ pageId, requestId: run?.requestId, done: !!run?.done,
  error: run?.error, samples: run?.samples.length || 0, final: run?.samples.at(-1), visibility: [...visibility], lifecycle: [...lifecycle], disposed: run?.disposed });
globalThis.generationTestResult = () => run;
globalThis.disposeGenerationTest = () => worker?.postMessage({ type: 'dispose' });
globalThis.generationTestStorageFiles = async () => {
  const root = await navigator.storage.getDirectory();
  const files = [];
  for await (const name of root.keys()) if (name.startsWith('xivca-search-')) files.push(name);
  return files;
};
