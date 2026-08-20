import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const blockedOptions = new Set(['--config', '--fully-parallel', '--workers', '-c', '-j']);

export function validateE2eArgs(args) {
  for (const arg of args) {
    const option = arg.split('=', 1)[0];
    if (blockedOptions.has(option)) {
      throw new Error(`E2Eの安定実行設定は上書きできません: ${arg}`);
    }
  }
}

export function createE2eEnvironment(source = process.env) {
  const env = { ...source };
  delete env.NO_COLOR;
  return env;
}

async function main() {
  const args = process.argv.slice(2);
  validateE2eArgs(args);
  const cli = require.resolve('@playwright/test/cli');
  const child = spawn(process.execPath, [cli, 'test', ...args], {
    stdio: 'inherit',
    env: createE2eEnvironment()
  });
  child.on('error', error => {
    console.error(error);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    process.exitCode = signal ? 1 : (code ?? 1);
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
