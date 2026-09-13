export function selectSolverWorkerCount(device = globalThis.navigator) {
  // Use half plus one, while leaving at least one logical processor available.
  const logicalProcessors = Math.floor(Number(device?.hardwareConcurrency));
  if (!Number.isFinite(logicalProcessors) || logicalProcessors <= 1) return 1;
  return Math.min(Math.floor(logicalProcessors / 2) + 1, logicalProcessors - 1);
}
