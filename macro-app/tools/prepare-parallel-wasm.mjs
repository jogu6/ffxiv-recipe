import fs from 'node:fs';
import path from 'node:path';
const dir = path.resolve(import.meta.dirname, '../build/engine-parallel');
const glue = fs.readFileSync(path.join(dir, 'xivca_macro_engine.js'), 'utf8');
if (!/new WebAssembly\.Memory\(\{[^}]*shared:\s*true/.test(glue)) throw new Error('The parallel engine must import shared WASM memory');
const helpers = fs.readdirSync(path.join(dir, 'snippets'), { recursive: true }).filter(name => name.endsWith('workerHelpers.no-bundler.js'));
if (helpers.length !== 1) throw new Error('Expected one Rayon worker helper');
const file = path.join(dir, 'snippets', helpers[0]);
let source = fs.readFileSync(file, 'utf8');
function replaceOnce(before, after) {
  if (source.split(before).length !== 2) throw new Error(`Rayon worker contract changed: ${before}`);
  source = source.replace(before, after);
}
replaceOnce('  const pkg = await import(data.mainJS);', `  const failures = new BroadcastChannel(data.storage.failureChannel);
  self.addEventListener('error', event => failures.postMessage({ message: event.message }));
  self.addEventListener('unhandledrejection', event => failures.postMessage({ message: String(event.reason?.message || event.reason) }));
  const { createSharedSearchStore } = await import(data.storage.module);
  globalThis.__xivcaSearchStore = createSharedSearchStore(data.storage.buffer);
  const pkg = await import(data.mainJS);`);
replaceOnce('    mainJS: builder.mainJS()', '    mainJS: builder.mainJS(),\n    storage: globalThis.__xivcaThreadStorage');
// A failed child must reach the responsive supervisor even while the search
// worker is blocked in Rayon. The dedicated port does not share its event loop.
replaceOnce('      worker.postMessage(workerInit);', `      worker.addEventListener('error', event => {
        globalThis.__xivcaThreadFailurePort.postMessage({ message: event.message });
      });
      worker.postMessage(workerInit);`);
fs.writeFileSync(file, source);
