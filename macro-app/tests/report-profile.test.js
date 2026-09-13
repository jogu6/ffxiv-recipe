import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { profileForReport } from '../web/bug-report.js';

test('出力時に全履歴を集計し、先頭の時間・最大値を末尾10件から失わない', () => {
  const profile = { samples: Array.from({ length: 2400 }, (_, i) => ({
    stage: i < 10 ? 'resourceQualityBound' : i === 2399 ? 'complete' : 'bestFirstSearch',
    elapsedMs: i * 100, searchNodes: i, wasmMemoryBytes: i === 5 ? 123456 : 100,
    wasmEngineKind: 'parallel', storagePageWrites: 0
  })), storage: {}, storageEvents: [], decimatedSamples: 1200 };
  const before = JSON.stringify(profile);
  const started = performance.now();
  const result = profileForReport(profile);
  console.log(JSON.stringify({ reportExportMs: performance.now() - started, bytes: JSON.stringify(result).length }));
  assert.equal(result.samples.length, 10);
  assert.equal(result.summary.全期間の推移.length, 32);
  assert.equal(result.summary.全期間の推移[0].経過時間ms, 0);
  assert.equal(result.summary.全期間の推移.at(-1).経過時間ms, 239900);
  assert.equal(result.summary.観測値の最大.wasmMemoryBytes.値, 123456);
  assert.equal(result.summary.段階別[0].初回観測から次段階までms, 1000);
  assert.match(result.summary.最長間隔の注意, /復元できません/);
  assert.match(result.summary.作業進捗の取得状態, /対象外/);
  assert.equal(JSON.stringify(profile), before, 'Export must not mutate recording state');
});

test('未更新の探索側0を容量推計に使わず、予約前のバックエンド記録を区別する', () => {
  const result = profileForReport({ samples: [{ stage: 'complete', elapsedMs: 500,
    storageQuotaBytes: 0, storageUsageBytes: 0, storagePageReads: 0 }],
    storage: { storageQuotaBytes: 0, storageDiskUsedBytes: 0 },
    storageEvents: [{ operation: 'reserve', elapsedMs: 20, storageQuotaBytes: 2 * 1024 ** 3,
      storageUsageBytes: 5 * 1024 ** 3, storageAvailableBytes: 0, storageReservedBytes: 3 * 1024 ** 3 }] });
  assert.equal('storageQuotaBytes' in result.samples[0], false);
  assert.equal(result.samples[0].storagePageReads, 0);
  assert.equal(result.storage.storageDiskUsedBytes, 0);
  assert.equal(result.estimates[0].storageQuotaBytes, 2 * 1024 ** 3);
  assert.match(result.estimates[0].整合性, /超過/);
  assert.match(result.estimates[0].容量推計の取得時点, /予約前/);
  assert.equal(result.storageEvents[0].storageReservedBytes, 3 * 1024 ** 3);
});

test('記録なしと未取得容量を0として断定しない', () => {
  assert.equal(profileForReport(null).summary, '未記録');
  const result = profileForReport({ storageEvents: [{ storageQuotaBytes: 0, storageUsageBytes: 0 }] });
  assert.equal(result.summary.初回計測ms, null);
  assert.equal(result.summary.保存済み計測間の最長間隔, null);
  assert.equal(result.estimates[0].storageUsageBytes, '取得不可・未取得');
});

test('初期段階の長い間隔を保持し、停止時間とは扱わない', () => {
  const result = profileForReport({ samples: [
    { stage: 'preparing', elapsedMs: 100 },
    { stage: 'resourceQualityBound', elapsedMs: 20100 },
    { stage: 'complete', elapsedMs: 20200 }
  ] });
  assert.equal(result.summary.保存済み計測間の最長間隔.間隔ms, 20000);
  assert.match(result.summary.最長間隔の注意, /停止の証拠ではありません/);
});

test('開発専用の古い待機計測は本番共通の計測と分離する', () => {
  const result = profileForReport({ metadata: { localResourceTest: { enabled: true } },
    samples: [{ elapsedMs: 100, localSimulatedSleepMs: 20 }] });
  assert.equal('localSimulatedSleepMs' in result.samples[0], false);
  assert.equal(result.development.過去の試験用待機計測[0].localSimulatedSleepMs, 20);
  assert.equal(profileForReport({ samples: [] }).development, null);
});
