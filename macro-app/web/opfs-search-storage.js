// WebKit rounds an exact power-of-two capacity up to the NEXT power of two.
// Stay one 4 KiB page below that boundary to avoid charging 6 GiB for 3 GiB.
const SEGMENT_BYTES = 64 * 1024 * 1024 - 4096;
const REPORT_BYTES = 512 * 1024;
const FLUSH_BYTES = 8 * 1024 * 1024;

function capacityError() {
  const error = new Error('端末の一時保存領域が不足しています。空き容量を増やしてから、もう一度お試しください');
  error.name = 'QuotaExceededError';
  return error;
}

function unsupported(error) {
  return ['NotSupportedError', 'NotAllowedError', 'SecurityError', 'UnknownError', 'InvalidStateError']
    .includes(error?.name) || error instanceof TypeError;
}

export async function openOpfsSearchStore({ onActivity = () => {} } = {}) {
  if (!navigator.storage?.getDirectory || globalThis.__xivcaDisableOpfs === true) return null;
  let root;
  try { root = await navigator.storage.getDirectory(); }
  catch (error) {
    if (unsupported(error)) return null;
    throw error;
  }
  const random = crypto.getRandomValues(new Uint8Array(16));
  const prefix = `xivca-search-${Array.from(random, value => value.toString(16).padStart(2, '0')).join('')}`;
  const segments = [];
  async function addSegment() {
    const name = `${prefix}-${String(segments.length).padStart(3, '0')}`;
    const file = await root.getFileHandle(name, { create: true });
    try {
      const access = await file.createSyncAccessHandle();
      const segment = { name, access, size: 0 };
      segments.push(segment);
      return segment;
    } catch (error) {
      await root.removeEntry(name).catch(() => {});
      throw error;
    }
  }
  try { await addSegment(); }
  catch (error) {
    if (unsupported(error)) return null;
    throw error;
  }
  const metrics = {
    storageBackend: 'opfs', storageReadTransactions: 0, storageWriteTransactions: 0,
    storageReadMs: 0, storageWriteMs: 0, storageReadBytes: 0, storageWrittenBytes: 0,
    storageReservedBytes: 0, storageReserveTransactions: 0, storageReserveMs: 0,
    storageSegmentCount: 1, storageQuotaBytes: 0, storageUsageBytes: 0,
    storageAvailableBytes: 0, storagePersistent: false
  };
  if (navigator.storage.estimate) {
    const estimate = await navigator.storage.estimate().catch(() => ({}));
    metrics.storageQuotaBytes = Math.max(0, Number(estimate.quota) || 0);
    metrics.storageUsageBytes = Math.max(0, Number(estimate.usage) || 0);
    metrics.storageAvailableBytes = Math.max(0, metrics.storageQuotaBytes - metrics.storageUsageBytes);
  }
  let reportedReadBytes = 0;
  let reportedWrittenBytes = 0;
  let flushedWrittenBytes = 0;
  const report = operation => {
    const current = operation === 'read' ? metrics.storageReadBytes : metrics.storageWrittenBytes;
    const previous = operation === 'read' ? reportedReadBytes : reportedWrittenBytes;
    if (current - previous < REPORT_BYTES) return;
    if (operation === 'read') reportedReadBytes = current;
    else reportedWrittenBytes = current;
    try { onActivity({ operation, ...metrics }); } catch {}
  };
  if (navigator.storage.persist) {
    try { metrics.storagePersistent = await navigator.storage.persist(); } catch {}
  }
  return {
    databaseName: `opfs:${prefix}`,
    metrics,
    async reserve(requestedBytes) {
      const bytes = Math.max(0, Math.floor(globalThis.__xivcaSearchCapacityBytes ?? requestedBytes));
      if (metrics.storageReservedBytes === bytes) return;
      if (metrics.storageReservedBytes) throw new Error('探索中は一時保存領域を拡張できません');
      const started = performance.now();
      try {
        // estimate().usage can retain already deleted reservations in Safari.
        // Let the real truncate/write operations decide; estimates are telemetry.
        const count = Math.max(1, Math.ceil(bytes / SEGMENT_BYTES));
        while (segments.length < count) await addSegment();
        for (let index = 0; index < count; index++) {
          const size = Math.min(SEGMENT_BYTES, Math.max(0, bytes - index * SEGMENT_BYTES));
          if (size > segments[index].size) {
            await Promise.resolve(segments[index].access.truncate(size));
            // Some browser implementations accept truncate but fail at the
            // first real write. Probe each segment before starting the solver.
            if (size > 0) {
              const written = segments[index].access.write(new Uint8Array([0]), { at: size - 1 });
              if (written !== 1) throw capacityError();
              await Promise.resolve(segments[index].access.flush());
            }
            segments[index].size = size;
          }
        }
        metrics.storageReserveTransactions++;
        metrics.storageReserveMs += performance.now() - started;
        metrics.storageReservedBytes = bytes;
        metrics.storageSegmentCount = segments.length;
        try { onActivity({ operation: 'reserve', ...metrics }); } catch {}
      } catch (error) {
        if (error?.name === 'QuotaExceededError') throw capacityError();
        throw error;
      }
    },
    write(at, bytes) {
      if (at < 0 || at + bytes.byteLength > metrics.storageReservedBytes) throw capacityError();
      const started = performance.now();
      let offset = 0;
      while (offset < bytes.byteLength) {
        const absolute = at + offset;
        const segment = segments[Math.floor(absolute / SEGMENT_BYTES)];
        const segmentOffset = absolute % SEGMENT_BYTES;
        const count = Math.min(bytes.byteLength - offset, SEGMENT_BYTES - segmentOffset);
        const written = segment.access.write(bytes.subarray(offset, offset + count), { at: segmentOffset });
        if (written !== count) throw new Error('途中結果を端末へ保存できませんでした');
        offset += written;
      }
      metrics.storageWriteTransactions++;
      metrics.storageWriteMs += performance.now() - started;
      metrics.storageWrittenBytes += offset;
      if (metrics.storageWrittenBytes - flushedWrittenBytes >= FLUSH_BYTES) {
        segments[Math.floor(at / SEGMENT_BYTES)].access.flush();
        flushedWrittenBytes = metrics.storageWrittenBytes;
      }
      report('write');
    },
    read(at, bytes) {
      if (at < 0 || at + bytes.byteLength > metrics.storageReservedBytes) throw capacityError();
      const started = performance.now();
      let offset = 0;
      while (offset < bytes.byteLength) {
        const absolute = at + offset;
        const segment = segments[Math.floor(absolute / SEGMENT_BYTES)];
        const segmentOffset = absolute % SEGMENT_BYTES;
        const count = Math.min(bytes.byteLength - offset, SEGMENT_BYTES - segmentOffset);
        const read = segment.access.read(bytes.subarray(offset, offset + count), { at: segmentOffset });
        if (read !== count) throw new Error('端末へ保存した途中結果を読み込めませんでした');
        offset += read;
      }
      metrics.storageReadTransactions++;
      metrics.storageReadMs += performance.now() - started;
      metrics.storageReadBytes += offset;
      report('read');
    },
    async close() {
      let failure;
      for (const segment of segments) {
        try {
          await Promise.resolve(segment.access.close());
        } catch (error) { failure ||= error; }
        try { await root.removeEntry(segment.name); }
        catch (error) { if (error?.name !== 'NotFoundError') failure ||= error; }
      }
      segments.length = 0;
      if (failure) throw failure;
    }
  };
}
