export function selectSolverWorkerCount() {
  // ページ退避時の一時停止・再開は同じWorkerが所有する。
  return 1;
}
