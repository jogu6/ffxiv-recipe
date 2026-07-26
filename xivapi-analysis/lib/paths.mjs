import path from "node:path";
import { fileURLToPath } from "node:url";

export const analysisRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const repositoryRoot = path.resolve(analysisRoot, "..");
export const configPath = path.join(
  analysisRoot,
  "config",
  "analysis-config.json",
);
export const capabilityConfigPath = path.join(
  analysisRoot,
  "config",
  "capabilities.json",
);
export const manualReviewConfigPath = path.join(
  analysisRoot,
  "config",
  "manual-review.json",
);
export const sourceRoot = path.join(analysisRoot, "source");
export const csvRoot = path.join(sourceRoot, "csv", "ja");
export const schemaRoot = path.join(sourceRoot, "schemas");
export const manifestPath = path.join(sourceRoot, "manifest.json");
export const cacheRoot = path.join(analysisRoot, "cache");
export const stateRoot = path.join(analysisRoot, "state");
export const statusPath = path.join(stateRoot, "status.json");
export const downloadStatePath = path.join(stateRoot, "download.json");
export const logsRoot = path.join(analysisRoot, "logs");
export const outputRoot = path.join(analysisRoot, "output");
export const reportsRoot = path.join(analysisRoot, "reports");
export const itemJsonPath = path.join(
  repositoryRoot,
  "site",
  "data",
  "Item.json",
);
