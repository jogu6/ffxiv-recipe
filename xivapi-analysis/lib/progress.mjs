import fs from "node:fs";
import path from "node:path";
import { ensureDirectory, writeJsonAtomic } from "./files.mjs";
import { logsRoot, statusPath } from "./paths.mjs";

function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "--:--";
  const seconds = Math.round(milliseconds / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export class ProgressReporter {
  constructor(command, config) {
    this.command = command;
    this.config = config;
    this.startedAt = Date.now();
    this.lastStatusWrite = 0;
    this.lastConsoleWrite = 0;
    this.lastLineLength = 0;
    ensureDirectory(logsRoot);
    const stamp = new Date().toISOString().replaceAll(":", "-");
    this.logPath = path.join(logsRoot, `${command}-${stamp}.log`);
    this.status = {
      command,
      stage: "starting",
      state: "running",
      completed: 0,
      total: 0,
      current: "",
      retries: 0,
      failures: 0,
      startedAt: new Date(this.startedAt).toISOString(),
      updatedAt: new Date(this.startedAt).toISOString(),
      logPath: path
        .relative(path.dirname(statusPath), this.logPath)
        .replaceAll("\\", "/"),
    };
    this.log(`開始: ${command}`);
    this.persist(true);
  }

  log(message) {
    fs.appendFileSync(
      this.logPath,
      `${new Date().toISOString()} ${message}\n`,
      "utf8",
    );
  }

  setStage(stage, total = 0) {
    if (process.stdout.isTTY && this.lastLineLength > 0)
      process.stdout.write("\n");
    this.lastLineLength = 0;
    this.status = { ...this.status, stage, completed: 0, total, current: "" };
    this.log(`段階: ${stage} total=${total}`);
    process.stdout.write(`\n[${stage}]\n`);
    this.persist(true);
  }

  update(patch = {}, force = false) {
    this.status = { ...this.status, ...patch };
    this.persist(force);
    this.render(force);
  }

  warning(message) {
    if (process.stdout.isTTY && this.lastLineLength > 0)
      process.stdout.write("\n");
    this.lastLineLength = 0;
    process.stdout.write(`警告: ${message}\n`);
    this.log(`警告: ${message}`);
    this.persist(true);
  }

  finish(summary = {}) {
    this.update(
      {
        ...summary,
        state: "completed",
        current: "",
        finishedAt: new Date().toISOString(),
      },
      true,
    );
    if (process.stdout.isTTY && this.lastLineLength > 0)
      process.stdout.write("\n");
    this.lastLineLength = 0;
    this.log("完了");
  }

  fail(error) {
    this.status = {
      ...this.status,
      state: "failed",
      error: error instanceof Error ? error.message : String(error),
      updatedAt: new Date().toISOString(),
    };
    this.persist(true);
    if (process.stdout.isTTY && this.lastLineLength > 0)
      process.stdout.write("\n");
    this.lastLineLength = 0;
    this.log(`失敗: ${this.status.error}`);
  }

  persist(force = false) {
    const now = Date.now();
    if (
      !force &&
      now - this.lastStatusWrite < this.config.statusWriteIntervalMs
    )
      return;
    const elapsedMs = now - this.startedAt;
    const rate =
      this.status.completed > 0 ? elapsedMs / this.status.completed : 0;
    const remaining = Math.max(0, this.status.total - this.status.completed);
    this.status = {
      ...this.status,
      elapsedMs,
      estimatedRemainingMs: rate > 0 ? Math.round(rate * remaining) : null,
      updatedAt: new Date(now).toISOString(),
    };
    writeJsonAtomic(statusPath, this.status);
    this.lastStatusWrite = now;
  }

  render(force = false) {
    const now = Date.now();
    const interval = process.stdout.isTTY
      ? 100
      : this.config.nonInteractiveProgressIntervalMs;
    if (!force && now - this.lastConsoleWrite < interval) return;
    const {
      completed,
      total,
      current,
      retries,
      failures,
      elapsedMs,
      estimatedRemainingMs,
    } = this.status;
    const percent =
      total > 0 ? `${((completed / total) * 100).toFixed(1)}%` : "--";
    const line = `${percent} ${completed}/${total} | ${current || "-"} | 経過 ${formatDuration(elapsedMs)} | 残り ${formatDuration(estimatedRemainingMs)} | 再試行 ${retries} | 失敗 ${failures}`;
    if (process.stdout.isTTY) {
      process.stdout.write(`\r${line.padEnd(this.lastLineLength, " ")}`);
      this.lastLineLength = Math.max(this.lastLineLength, line.length);
    } else {
      process.stdout.write(`${line}\n`);
    }
    this.lastConsoleWrite = now;
  }
}
