import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import esbuild from 'esbuild';
import { chromium } from '@playwright/test';

const root = process.cwd();
const siteDir = path.join(root, 'site');
const outputDir = path.join(root, '.agents', 'js-bundle-experiment');
const sourceFiles = [
  'calculation.js',
  'event-wiring.js',
  'floating-window.js',
  'equipment-search-model.js',
  'favorite-store.js',
  'favorite-share-codec.js',
  'favorite-list-file.js',
  'favorite-count-model.js',
  'material-model.js',
  'material-purchase-state.js',
  'navigation-state.js',
  'recipe-data-model.js',
  'recipe-selection-model.js',
  'vendor/marked.umd.js',
  'vendor/purify.min.js',
  'ui-change-policy.js',
  'view-state.js',
  'app.js'
];

await fs.mkdir(outputDir, { recursive: true });
const sources = await Promise.all(
  sourceFiles.map(async file => `;\n/* ${file} */\n${await fs.readFile(path.join(siteDir, file), 'utf8')}`)
);
const joined = sources.join('\n');
const transformed = await esbuild.transform(joined, {
  charset: 'utf8',
  legalComments: 'none',
  loader: 'js',
  minify: true,
  target: ['chrome100', 'firefox100', 'safari15']
});
const bundlePath = path.join(outputDir, 'app.bundle.min.js');
await fs.writeFile(bundlePath, transformed.code, 'utf8');

const originalHtml = await fs.readFile(path.join(siteDir, 'index.html'), 'utf8');
const originalTags = sourceFiles.map(file => `<script src="./${file}"></script>`).join('\r\n');
const lfTags = sourceFiles.map(file => `<script src="./${file}"></script>`).join('\n');
const tags = originalHtml.includes(originalTags) ? originalTags : lfTags;
if (!originalHtml.includes(tags)) throw new Error('index.htmlのスクリプト列を特定できませんでした');
const bundledHtml = originalHtml.replace(tags, '<script src="./app.bundle.min.js"></script>');
await fs.writeFile(path.join(outputDir, 'index.bundle.html'), bundledHtml, 'utf8');

function sizes(buffer) {
  return {
    raw: buffer.length,
    gzip: zlib.gzipSync(buffer, { level: 9 }).length,
    brotli: zlib.brotliCompressSync(buffer).length
  };
}

const fontBuffer = await fs.readFile(path.join(siteDir, 'font-size-settings.js'));
const sourceBuffers = await Promise.all(sourceFiles.map(file => fs.readFile(path.join(siteDir, file))));
const bundleBuffer = await fs.readFile(bundlePath);
const sizeReport = {
  current: {
    requests: sourceFiles.length + 1,
    ...sizes(Buffer.concat([fontBuffer, ...sourceBuffers]))
  },
  bundled: {
    requests: 2,
    ...sizes(Buffer.concat([fontBuffer, bundleBuffer]))
  }
};

const browser = await chromium.launch();
const results = [];

for (const cpuRate of [1, 4]) {
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const variants = iteration % 2 === 0 ? ['current', 'bundled'] : ['bundled', 'current'];
    for (const variant of variants) {
      const context = await browser.newContext({
        serviceWorkers: 'block',
        viewport: { width: cpuRate === 1 ? 1280 : 375, height: 800 }
      });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Performance.enable');
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
      await page.route('https://static.cloudflareinsights.com/**', route => route.abort());
      await page.route('**/*.js', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== 'http://127.0.0.1:4173') {
          await route.abort();
          return;
        }
        const relative = decodeURIComponent(url.pathname.replace(/^\//, ''));
        if (relative === 'app.bundle.min.js') {
          await route.fulfill({ body: bundleBuffer, contentType: 'text/javascript' });
          return;
        }
        const requestedPath = path.resolve(siteDir, relative);
        if (!requestedPath.startsWith(siteDir + path.sep)) {
          await route.abort();
          return;
        }
        await route.fulfill({ body: await fs.readFile(requestedPath), contentType: 'text/javascript' });
      });
      if (variant === 'bundled') {
        await page.route('http://127.0.0.1:4173/', route =>
          route.fulfill({ body: bundledHtml, contentType: 'text/html' })
        );
      }

      await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
      const dclBrowserMetrics = await cdp.send('Performance.getMetrics');
      const dclMetricMap = Object.fromEntries(
        dclBrowserMetrics.metrics.map(metric => [metric.name, metric.value])
      );
      await page.waitForFunction(() => !document.querySelector('#loadingOverlay').classList.contains('open'));
      const browserMetrics = await cdp.send('Performance.getMetrics');
      const metricMap = Object.fromEntries(browserMetrics.metrics.map(metric => [metric.name, metric.value]));
      const timings = await page.evaluate(() => {
        const navigation = performance.getEntriesByType('navigation')[0];
        const setup = performance.getEntriesByName('application-data-setup')[0];
        return {
          appReady: performance.now(),
          dcl: navigation.domContentLoadedEventEnd,
          domInteractive: navigation.domInteractive,
          scriptRequests: performance
            .getEntriesByType('resource')
            .filter(entry => new URL(entry.name).pathname.endsWith('.js')).length,
          setup: setup?.duration ?? null,
          setupEnd: setup ? setup.startTime + setup.duration : null
        };
      });
      results.push({
        variant,
        cpuRate,
        iteration,
        ...timings,
        scriptDurationAtDclMs: dclMetricMap.ScriptDuration * 1000,
        taskDurationAtDclMs: dclMetricMap.TaskDuration * 1000,
        scriptDurationMs: metricMap.ScriptDuration * 1000,
        taskDurationMs: metricMap.TaskDuration * 1000
      });

      if (variant === 'bundled' && iteration === 0) {
        await page.locator('#searchBox').fill('バスタードソード');
        await page.waitForTimeout(250);
        await page.getByText('バスタードソード', { exact: true }).first().click();
        if (!(await page.locator('#treeContainer .result-root-summary').isVisible())) {
          throw new Error('バンドル版の基本操作確認に失敗しました');
        }
      }
      await context.close();
    }
  }
}
await browser.close();

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const summary = [];
for (const cpuRate of [1, 4]) {
  for (const variant of ['current', 'bundled']) {
    const rows = results.filter(row => row.cpuRate === cpuRate && row.variant === variant).slice(1);
    summary.push({
      cpuRate,
      variant,
      samples: rows.length,
      appReadyMs: median(rows.map(row => row.appReady)),
      domInteractiveMs: median(rows.map(row => row.domInteractive)),
      dclMs: median(rows.map(row => row.dcl)),
      setupMs: median(rows.map(row => row.setup)),
      setupEndMs: median(rows.map(row => row.setupEnd)),
      scriptDurationAtDclMs: median(rows.map(row => row.scriptDurationAtDclMs)),
      taskDurationAtDclMs: median(rows.map(row => row.taskDurationAtDclMs)),
      scriptDurationMs: median(rows.map(row => row.scriptDurationMs)),
      taskDurationMs: median(rows.map(row => row.taskDurationMs)),
      scriptRequests: median(rows.map(row => row.scriptRequests))
    });
  }
}

const report = { generatedAt: new Date().toISOString(), sizeReport, summary, samples: results };
await fs.writeFile(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ sizeReport, summary }, null, 2));
