import fs from "node:fs";
import path from "node:path";
import { readJson, writeTextAtomic } from "./files.mjs";
import {
  cacheRoot,
  csvRoot,
  manifestPath,
  manualReviewConfigPath,
  outputRoot,
  reportsRoot,
  schemaRoot,
} from "./paths.mjs";

function wildcardPattern(pattern) {
  const escaped = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll("\\[\\*\\]", "\\[\\d+\\]");
  return new RegExp(`^${escaped}$`);
}

function countFiles(directory, extension) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension)).length;
}

export function runValidation(reporter) {
  reporter.setStage("解析結果を検証", 12);
  const manifest = readJson(manifestPath);
  const result = readJson(path.join(outputRoot, "analysis-result.json"));
  const inventory = readJson(
    path.join(cacheRoot, "csv-inventory.json"),
  ).inventories;
  const reviewDefinitions = readJson(manualReviewConfigPath);
  const checks = [];

  function check(name, passed, detail) {
    checks.push({ name, passed, detail });
    reporter.update({ completed: checks.length, current: name });
  }

  check(
    "CSV取得件数",
    countFiles(csvRoot, ".csv") === manifest.fileCount,
    `${countFiles(csvRoot, ".csv")} / ${manifest.fileCount}`,
  );
  check(
    "EXDSchema取得件数",
    countFiles(schemaRoot, ".yml") === manifest.schemas.fileCount,
    `${countFiles(schemaRoot, ".yml")} / ${manifest.schemas.fileCount}`,
  );
  check(
    "CSVコミット一致",
    result.source.commit === manifest.commit,
    result.source.commit,
  );
  check(
    "EXDSchemaコミット一致",
    result.source.schemaCommit === manifest.schemas.commit,
    result.source.schemaCommit,
  );
  check(
    "対象Item欠落なし",
    result.targets.missingFromItemJsonCount === 0,
    `${result.targets.missingFromItemJsonCount}件`,
  );
  check(
    "通常レシピと交換レシピの内訳",
    result.targets.xivapiRecipeResultCount +
      result.targets.appOnlyRecipeResultCount ===
      result.targets.recipeResultCount,
    `${result.targets.xivapiRecipeResultCount}+${result.targets.appOnlyRecipeResultCount}=${result.targets.recipeResultCount}`,
  );
  check(
    "全CSVにSchemaあり",
    inventory.every((sheet) => sheet.schemaFile),
    `${inventory.filter((sheet) => !sheet.schemaFile).length}件欠落`,
  );
  check(
    "CSV列とSchema一致",
    inventory.every((sheet) => sheet.columnsWithoutSchema.length === 0),
    `${inventory.reduce((sum, sheet) => sum + sheet.columnsWithoutSchema.length, 0)}列不一致`,
  );
  check(
    "CSV行崩れなし",
    inventory.every((sheet) => sheet.malformedRowCount === 0),
    `${inventory.reduce((sum, sheet) => sum + sheet.malformedRowCount, 0)}行`,
  );
  check(
    "能力表のCSV欠落なし",
    result.capabilities.every(
      (capability) => capability.missingCsv.length === 0,
    ),
    `${result.capabilities.flatMap((capability) => capability.missingCsv).length}件`,
  );
  const missingExplanations = result.capabilities.filter(
    (capability) =>
      !capability.title?.trim() || !capability.explanation?.trim(),
  );
  check(
    "利用者向け説明の欠落なし",
    missingExplanations.length === 0,
    `${result.capabilities.length - missingExplanations.length}/${result.capabilities.length}件`,
  );

  const unresolved = inventory.flatMap((sheet) =>
    sheet.unresolvedItemCandidates.map((column) => ({
      sheet: sheet.sheet,
      column: column.column,
    })),
  );
  const reviewed = unresolved.filter((candidate) =>
    reviewDefinitions.some(
      (definition) =>
        definition.sheet === candidate.sheet &&
        wildcardPattern(definition.column).test(candidate.column),
    ),
  );
  const recipeLookup = result.manualReviews.find(
    (review) => review.sheet === "RecipeLookup" && review.column === "#",
  );
  check(
    "未定義候補を全件分類・RecipeLookup整合",
    reviewed.length === unresolved.length &&
      recipeLookup?.validation?.passed === true,
    `${reviewed.length}/${unresolved.length}列分類、RecipeLookup不一致=${recipeLookup?.validation?.mismatches ?? "不明"}`,
  );

  const failed = checks.filter((item) => !item.passed);
  const lines = [
    "# 解析結果検証",
    "",
    `- 実行日時: ${new Date().toISOString()}`,
    `- 結果: ${failed.length === 0 ? "成功" : "失敗"}`,
    "",
    "| 検証 | 結果 | 詳細 |",
    "| --- | --- | --- |",
    ...checks.map(
      (item) =>
        `| ${item.name} | ${item.passed ? "OK" : "NG"} | ${item.detail} |`,
    ),
    "",
  ];
  writeTextAtomic(
    path.join(reportsRoot, "validation.md"),
    `${lines.join("\n")}\n`,
  );
  if (failed.length > 0)
    throw new Error(`解析結果の検証に${failed.length}件失敗しました`);
  reporter.finish({
    completed: checks.length,
    total: checks.length,
    failedChecks: 0,
  });
  return checks;
}
