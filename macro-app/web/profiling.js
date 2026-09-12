import { japaneseIsoDateTime } from './persistence.js';
export const PROFILE_KEY = 'xivca.macro.profile.v1';
const measuredKeys = ['stage', 'workUnits', 'searchNodes', 'searchGeneratedNodes', 'searchQueuedNodes',
  'searchPoppedNodes', 'searchDroppedNodes', 'searchParetoRejectedNodes', 'visitedCapacityBytes',
  'queuedCapacityBytes', 'replayMs', 'paretoMs', 'expansionMs', 'mergeMs', 'workerElapsedMs',
  'wasmMemoryBytes', 'threadCount', 'wasmSha256', 'storageResidentBytes', 'storageAllocatedBytes',
  'storagePageReads', 'storagePageWrites', 'storagePressureEvents', 'paretoCapacityBytes', 'qualityBoundBytes', 'stepBoundBytes', 'candidateCapacityBytes',
  'storageReadTransactions', 'storageWriteTransactions', 'storageReadMs', 'storageWriteMs', 'localSimulatedSleepMs'];

// WASM bytes are committed linear address space, not OS resident memory or swap.
export function createProfiler(storage, clock = () => performance.now()) {
  let profile = null;
  let started = 0;
  let persistedAt = 0;
  try {
    profile = JSON.parse(storage.getItem(PROFILE_KEY));
    if (profile?.status === 'running') profile.status = 'interrupted';
  } catch { /* Storage may be unavailable. Export still works in memory. */ }
  function persist() {
    if (profile?.status === 'running') {
      profile.elapsedMs = clock() - started;
      profile.lastSampleAgeMs = profile.elapsedMs - (profile.samples.at(-1)?.elapsedMs || 0);
    }
    try { storage.setItem(PROFILE_KEY, JSON.stringify(profile)); }
    catch { if (profile) profile.storageUnavailable = true; }
    persistedAt = clock();
  }
  return {
    get current() { return profile; },
    start(input, metadata) {
      started = clock();
      profile = {
        schemaVersion: 1, startedAt: japaneseIsoDateTime(), status: 'running',
        input, metadata, samples: [], decimatedSamples: 0,
        unavailable: ['OS resident memory', 'OS swap', 'OS page faults', 'CPU temperature'],
        memoryMeaning: 'wasmMemoryBytesはWASM線形メモリー確保量。storageResidentBytesはRAM上のページキャッシュ。visited/queue/Pareto容量は退避済み部分を含む論理容量。境界値は共有前の論理値で、OS物理使用量とは異なります。',
        timingMeaning: '各処理の累積経過時間。並列スレッドの CPU 時間の合計ではありません。コールバック間は未観測です。'
      };
      persist();
    },
    sample(snapshot) {
      if (profile?.status !== 'running') return;
      const previous = profile.samples.at(-1);
      const elapsedMs = clock() - started;
      const intervalMs = previous
        ? (Number.isFinite(snapshot.workerElapsedMs) && Number.isFinite(previous.workerElapsedMs)
          ? snapshot.workerElapsedMs - previous.workerElapsedMs : elapsedMs - previous.elapsedMs) : 0;
      const measured = Object.fromEntries(measuredKeys.filter(key => key in snapshot).map(key => [key, snapshot[key]]));
      profile.samples.push({ ...measured, elapsedMs,
        nodesPerSecond: intervalMs > 0 ? Math.max(0, (snapshot.searchNodes || 0) - (previous.searchNodes || 0)) * 1000 / intervalMs : null });
      // Bounded recording; preserve first and newest samples, retain original timestamps.
      if (profile.samples.length > 2400) {
        const old = profile.samples;
        profile.samples = old.filter((_, index) => index % 2 === 0 || index === old.length - 1);
        profile.decimatedSamples += old.length - profile.samples.length;
      }
      if (clock() - persistedAt >= 5000) persist();
    },
    finish(status, detail = {}) {
      if (profile?.status !== 'running') return;
      Object.assign(profile, { status, elapsedMs: clock() - started, endedAt: japaneseIsoDateTime(), ...detail });
      profile.lastSampleAgeMs = profile.elapsedMs - (profile.samples.at(-1)?.elapsedMs || 0);
      persist();
    },
    persist
  };
}

