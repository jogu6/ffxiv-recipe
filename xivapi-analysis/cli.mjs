#!/usr/bin/env node
import fs from "node:fs";
import { runAnalysis } from "./lib/analyze.mjs";
import { runDownload } from "./lib/download.mjs";
import { readJson } from "./lib/files.mjs";
import { configPath, statusPath } from "./lib/paths.mjs";
import { ProgressReporter } from "./lib/progress.mjs";
import { runValidation } from "./lib/validate.mjs";

function printUsage() {
  console.log(`使用方法:
  node xivapi-analysis/cli.mjs download
  node xivapi-analysis/cli.mjs analyze
  node xivapi-analysis/cli.mjs validate
  node xivapi-analysis/cli.mjs all
  node xivapi-analysis/cli.mjs status`);
}

function printStatus() {
  if (!fs.existsSync(statusPath)) {
    console.log("進捗情報はまだありません。");
    return;
  }
  const status = readJson(statusPath);
  const percent =
    status.total > 0
      ? `${((status.completed / status.total) * 100).toFixed(1)}%`
      : "--";
  console.log(`状態: ${status.state}
コマンド: ${status.command}
段階: ${status.stage}
進捗: ${status.completed} / ${status.total} (${percent})
現在: ${status.current || "-"}
再試行: ${status.retries}
失敗: ${status.failures}
開始: ${status.startedAt}
更新: ${status.updatedAt}
ログ: ${status.logPath}`);
  if (status.error) console.log(`エラー: ${status.error}`);
}

async function main() {
  const command = process.argv[2];
  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return;
  }
  if (command === "status") {
    printStatus();
    return;
  }
  if (!["download", "analyze", "validate", "all"].includes(command)) {
    printUsage();
    process.exitCode = 2;
    return;
  }

  const config = readJson(configPath);
  const reporter = new ProgressReporter(command, config);
  let activeReporter = reporter;
  try {
    if (command === "download" || command === "all")
      await runDownload(config, reporter);
    if (command === "analyze" || command === "all") {
      const analysisReporter =
        command === "all" ? new ProgressReporter("analyze", config) : reporter;
      activeReporter = analysisReporter;
      await runAnalysis(config, analysisReporter);
    }
    if (command === "validate" || command === "all") {
      const validationReporter =
        command === "all" ? new ProgressReporter("validate", config) : reporter;
      activeReporter = validationReporter;
      runValidation(validationReporter);
    }
  } catch (error) {
    activeReporter.fail(error);
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  }
}

await main();
