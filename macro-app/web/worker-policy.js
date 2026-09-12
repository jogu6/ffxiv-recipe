export function selectSolverWorkerCount(device = globalThis.navigator) {
  // Raphael v0.28.6 default_thread_count (src/thread_pool.rs).
  const logicalProcessors = Math.floor(Number(device?.hardwareConcurrency));
  return Math.min(8, Math.max(2, Number.isFinite(logicalProcessors) ? Math.floor(logicalProcessors / 2) : 2));
}
