import fs from 'node:fs';
const file = process.argv[2];
if (!file) throw new Error('使い方: node macro-app/tools/analyze-profile.mjs 計測ログ.json');
const profile = JSON.parse(fs.readFileSync(file, 'utf8'));
if (profile.schemaVersion !== 1 || !Array.isArray(profile.samples)) throw new Error('未対応の計測ログです');
const samples = profile.samples;
const first = samples[0];
const last = samples.at(-1);
const columns = ['elapsedMs', 'workerElapsedMs', 'stage', 'searchNodes', 'searchQueuedNodes', 'nodesPerSecond',
  'wasmMemoryBytes', 'visitedCapacityBytes', 'queuedCapacityBytes', 'replayMs', 'paretoMs', 'expansionMs', 'mergeMs',
  'storageResidentBytes', 'storageAllocatedBytes', 'storagePageReads', 'storagePageWrites',
  'storageReadTransactions', 'storageWriteTransactions', 'storageReadMs', 'storageWriteMs',
  'paretoCapacityBytes', 'qualityBoundBytes', 'stepBoundBytes', 'candidateCapacityBytes', 'localSimulatedSleepMs'];
const csv = [columns.join(','), ...samples.map(sample => columns.map(key => JSON.stringify(sample[key] ?? '')).join(','))].join('\n');
fs.writeFileSync(`${file}.csv`, csv);
const intervals = [];
let start = samples.find(sample => sample.stage === 'bestFirstSearch') || first;
for (const sample of samples) {
  if (sample.workerElapsedMs < start?.workerElapsedMs) continue;
  if (!start || sample.searchNodes - (start.searchNodes || 0) < 1_000_000) continue;
  const durationMs = sample.workerElapsedMs - start.workerElapsedMs;
  intervals.push({ fromNodes: start.searchNodes || 0, toNodes: sample.searchNodes,
    durationMs, nodesPerSecond: (sample.searchNodes - (start.searchNodes || 0)) * 1000 / durationMs,
    wasmMiB: sample.wasmMemoryBytes / 1048576,
    ...Object.fromEntries(['replayMs', 'paretoMs', 'expansionMs', 'mergeMs', 'storageReadMs', 'storageWriteMs']
      .filter(key => key in sample).map(key => [key, sample[key] - (start[key] || 0)])) });
  start = sample;
}
const summary = { status: profile.status, metadata: profile.metadata, elapsedMs: profile.elapsedMs,
  samples: samples.length, maximumNodes: Math.max(0, ...samples.map(s => s.searchNodes || 0)),
  peakWasmMiB: Math.max(0, ...samples.map(s => s.wasmMemoryBytes || 0)) / 1048576,
  last, intervals, unavailable: profile.unavailable };
if (fs.existsSync(`${file}.os.json`)) {
  const operatingSystem = JSON.parse(fs.readFileSync(`${file}.os.json`, 'utf8'));
  const osSamples = operatingSystem.samples || [];
  summary.operatingSystem = {
    samples: osSamples.length,
    counterFailures: osSamples.filter(sample => sample.osCounterError).length,
    peakDatabaseFileMiB: Math.max(0, ...osSamples.map(sample => sample.databaseFileBytes || 0)) / 1048576,
    peakPrivateWorkingSetSumMiB: Math.max(0, ...osSamples.map(sample =>
      (sample.windows?.processes || []).reduce((sum, process) => sum + Number(process.WorkingSetPrivate || 0), 0))) / 1048576,
    meaning: '専用ブラウザーの全プロセスについて、同じ観測時点の専有物理メモリーを合計した最大値。共有ページと他アプリの使用量は含まない。',
    notes: operatingSystem.notes
  };
}
fs.writeFileSync(`${file}.summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
