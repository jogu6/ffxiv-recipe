import { japaneseIsoDateTime } from './persistence.js';
export const PROFILE_KEY = 'xivca.macro.profile.v1';
const measuredKeys = ['wasmMemoryMaximumBytes', 'wasmMemoryLimitAvoided', 'wasmMemoryEventCount', 'wasmMemoryGrowCalls', 'wasmMemoryGrowFailures', 'wasmMemoryGrownBytes', 'paretoGroupingMs', 'paretoComparisonMs', 'boundQueryCacheHits', 'boundQueryCacheMisses', 'stage', 'workUnits', 'searchNodes', 'searchGeneratedNodes', 'searchQueuedNodes',
  'searchPoppedNodes', 'searchDroppedNodes', 'searchParetoRejectedNodes', 'visitedCapacityBytes',
  'queuedCapacityBytes', 'replayMs', 'paretoMs', 'expansionMs', 'mergeMs', 'workerElapsedMs',
  'wasmMemoryBytes', 'threadCount', 'wasmSha256', 'wasmEngineKind', 'storageResidentBytes', 'storageAllocatedBytes',
  'storagePageReads', 'storagePageWrites', 'storagePressureEvents', 'paretoCapacityBytes', 'qualityBoundBytes', 'stepBoundBytes', 'candidateCapacityBytes',
  'storageReadTransactions', 'storageWriteTransactions', 'storageReadMs', 'storageWriteMs', 'localSimulatedSleepMs',
  'storageFlushMs', 'storageFlushCount', 'storageSolverWaitMs', 'storageSolverWaitCount', 'storageSolverMaxWaitMs',
  'storageBackend', 'storageReservationMode', 'storageRequestedBytes', 'storageReservedBytes',
  'storageDiskUsedBytes', 'storageDiskHighWaterBytes', 'storageDiskCapacityBytes',
  'storageReadBytes', 'storageWrittenBytes', 'storageReserveTransactions', 'storageReserveMs',
  'storageSegmentCount', 'storageQuotaBytes', 'storageUsageBytes', 'storageAvailableBytes',
  'storagePersistent', 'storageClosed', 'storageLastOperation', 'storageLastOffsetBytes', 'storageLastLengthBytes'];

export function measuredSnapshot(snapshot) {
  return Object.fromEntries(measuredKeys.filter(key => key in snapshot).map(key => [key, snapshot[key]]));
}

// Called by completed solver work, never by a timer. No WASM calls or waits:
// the solver may still hold a page-store lock when it reports progress.
export function createWorkProgressReporter(emit, clock = () => performance.now()) {
  let workId = 0, previousPhase = 0, previousTotal = 0, previousCompleted = 0, lastSent = -Infinity;
  return (phase, completed, total) => {
    if (!Number.isSafeInteger(completed) || !Number.isSafeInteger(total)
      || total <= 0 || completed < 0 || completed > total) return;
    if (completed === 0 || phase !== previousPhase || total !== previousTotal || completed < previousCompleted) workId++;
    previousPhase = phase;
    previousTotal = total;
    previousCompleted = completed;
    const now = clock();
    if (now - lastSent < 500) return;
    lastSent = now;
    emit({ workId, phase, completed, total });
  };
}

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
        input, metadata, samples: [], decimatedSamples: 0, storage: {}, storageEvents: [], memoryEvents: [],
        unavailable: ['OS resident memory', 'OS swap', 'OS page faults', 'CPU temperature'],
        memoryMeaning: 'wasmMemoryBytesはWASM線形メモリー確保量。storageResidentBytesはRAM上のページキャッシュ。storageAllocatedBytesは解放後に再利用できるページを含む管理領域の最大規模。storageDiskUsedBytesは現在有効な退避データ量、storageDiskHighWaterBytesは退避位置の最大到達量。storageReservedBytesはOPFSの準備済みファイル容量、IndexedDBでは論理上限であり物理的な事前確保ではありません。storageWrittenBytes/storageReadBytesは再利用・再読込を含む累計I/O量。storageUsageBytesはオリジン全体のブラウザー推計で更新が遅れる場合があり、退避データ量ではありません。visited/queue/Pareto容量は退避済み部分を含む論理容量で、OS物理使用量とは異なります。',
        timingMeaning: '各処理の累積経過時間。並列スレッドの CPU 時間の合計ではありません。詳細な時間・メモリーはコールバック間には未観測です。liveProgressは計算スレッドが処理した候補数の途中通知で、詳細計測値の更新ではありません。activityCountは比較・展開の進行確認用で、候補数には加算しません。'
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
      const measured = measuredSnapshot({ ...profile.storage, ...snapshot });
      if (Array.isArray(snapshot.wasmMemoryEvents)) {
        profile.memoryEvents.push(...snapshot.wasmMemoryEvents);
        if (profile.memoryEvents.length > 64) profile.memoryEvents.splice(0, profile.memoryEvents.length - 64);
      }
      Object.assign(profile.storage, Object.fromEntries(Object.entries(measured).filter(([key]) => key.startsWith('storage'))));
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
    workProgress(work) {
      if (profile?.status !== 'running') return;
      profile.workProgress = { ...work, elapsedMs: clock() - started };
      if (clock() - persistedAt >= 5000) persist();
    },
    liveProgress({ searchNodes, activityCount = 0 }) {
      if (profile?.status !== 'running' || !Number.isSafeInteger(searchNodes)
        || (searchNodes <= (profile.liveProgress?.searchNodes || 0)
          && activityCount <= (profile.liveProgress?.activityCount || 0))) return;
      profile.liveProgress = { searchNodes, activityCount, elapsedMs: clock() - started };
      // Keep this separately: the full memory/timing snapshot has not been
      // refreshed just because an expansion counter changed.
      if (clock() - persistedAt >= 5000) persist();
    },
    storage(metrics) {
      if (profile?.status !== 'running') return;
      const measured = Object.fromEntries(Object.entries(measuredSnapshot(metrics)).filter(([key]) => key.startsWith('storage')));
      Object.assign(profile.storage, measured, { lastOperation: metrics.operation || 'unknown', elapsedMs: clock() - started });
      if (metrics.operation && !['read', 'write'].includes(metrics.operation)) {
        profile.storageEvents.push({ ...measured, operation: metrics.operation, elapsedMs: clock() - started });
        profile.storageEvents = profile.storageEvents.slice(-24);
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

