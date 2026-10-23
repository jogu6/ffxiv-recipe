import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolvePython } from './python-runtime.mjs';

export function devServerArgs(siteRoot) {
  return ['-m', 'http.server', '4173', '--bind', '0.0.0.0', '--directory', siteRoot];
}

function main() {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const child = spawn(resolvePython(), devServerArgs(join(root, 'site')), { stdio: 'inherit' });
  const forwardSignal = signal => { if (child.exitCode === null && child.signalCode === null) child.kill(signal); };
  const interrupt = () => forwardSignal('SIGINT');
  const terminate = () => forwardSignal('SIGTERM');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  const cleanup = () => {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
  };
  child.once('error', error => {
    cleanup();
    console.error(error.message);
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    cleanup();
    process.exitCode = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
