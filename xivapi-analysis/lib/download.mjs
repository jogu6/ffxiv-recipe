import crypto from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { ensureDirectory, readJson, writeJsonAtomic } from "./files.mjs";
import {
  csvRoot,
  downloadStatePath,
  manifestPath,
  schemaRoot,
  sourceRoot,
} from "./paths.mjs";

const USER_AGENT = "ffxiv-recipe-xivapi-analysis";

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function request(url, config, reporter, attempt = 0) {
  const controller = new AbortController();
  const timeout =
    config.requestTimeoutMs > 0
      ? setTimeout(
          () =>
            controller.abort(
              new Error(`request timeout: ${config.requestTimeoutMs}ms`),
            ),
          config.requestTimeoutMs,
        )
      : null;
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": USER_AGENT,
      },
      signal: controller.signal,
    });
    if (!response.ok)
      throw new Error(`${response.status} ${response.statusText}: ${url}`);
    return response;
  } catch (error) {
    if (attempt >= config.downloadRetries) throw error;
    const retries = reporter.status.retries + 1;
    reporter.update({ retries }, true);
    const waitMs = Math.min(60_000, 1_000 * 2 ** attempt);
    reporter.log(
      `再試行 ${attempt + 1}/${config.downloadRetries}: ${url} wait=${waitMs} error=${error.message}`,
    );
    await delay(waitMs);
    return request(url, config, reporter, attempt + 1);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function requestJson(url, config, reporter) {
  return (await request(url, config, reporter)).json();
}

async function findDirectoryTree(
  repository,
  treeSha,
  segments,
  config,
  reporter,
) {
  let currentTree = treeSha;
  for (const segment of segments) {
    const data = await requestJson(
      `https://api.github.com/repos/${repository}/git/trees/${currentTree}`,
      config,
      reporter,
    );
    const entry = data.tree?.find(
      (candidate) => candidate.type === "tree" && candidate.path === segment,
    );
    if (!entry)
      throw new Error(`Git tree directory not found: ${segments.join("/")}`);
    currentTree = entry.sha;
  }
  return requestJson(
    `https://api.github.com/repos/${repository}/git/trees/${currentTree}`,
    config,
    reporter,
  );
}

async function fetchDirectoryManifest(
  repository,
  branchName,
  segments,
  extension,
  config,
  reporter,
) {
  const branch = await requestJson(
    `https://api.github.com/repos/${repository}/branches/${encodeURIComponent(branchName)}`,
    config,
    reporter,
  );
  const commit = branch.commit?.sha;
  const treeSha = branch.commit?.commit?.tree?.sha;
  if (!commit || !treeSha)
    throw new Error("GitHub branch response did not contain commit/tree SHA");
  const directoryTree = await findDirectoryTree(
    repository,
    treeSha,
    segments,
    config,
    reporter,
  );
  if (directoryTree.truncated)
    throw new Error(
      `GitHub tree response was truncated: ${repository}/${segments.join("/")}`,
    );
  const files = directoryTree.tree
    .filter((entry) => entry.type === "blob" && entry.path.endsWith(extension))
    .map((entry) => ({ name: entry.path, sha: entry.sha, size: entry.size }))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  return {
    repository,
    branch: branchName,
    directory: segments.join("/"),
    commit,
    treeSha: directoryTree.sha,
    fetchedAt: new Date().toISOString(),
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
    files,
  };
}

async function fetchManifest(config, reporter) {
  reporter.setStage("取得一覧を確認", 2);
  const csv = await fetchDirectoryManifest(
    config.repository,
    config.branch,
    ["csv", config.language],
    ".csv",
    config,
    reporter,
  );
  reporter.update({ completed: 1, current: `${csv.fileCount} CSV` }, true);
  const schemas = await fetchDirectoryManifest(
    config.schemaRepository,
    config.schemaBranch,
    [],
    ".yml",
    config,
    reporter,
  );
  reporter.update(
    { completed: 2, current: `${schemas.fileCount} schemas` },
    true,
  );
  return {
    ...csv,
    language: config.language,
    schemas,
  };
}

async function verifyGitBlob(filePath, expectedSha, expectedSize) {
  const stat = await fsPromises.stat(filePath).catch(() => null);
  if (!stat || stat.size !== expectedSize) return false;
  const hash = crypto.createHash("sha1");
  hash.update(`blob ${expectedSize}\0`);
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex") === expectedSha;
}

async function downloadFile(file, source, destinationRoot, config, reporter) {
  const destination = path.join(destinationRoot, file.name);
  ensureDirectory(path.dirname(destination));
  if (await verifyGitBlob(destination, file.sha, file.size))
    return { skipped: true };

  const temporary = `${destination}.part`;
  const encodedName = file.name.split("/").map(encodeURIComponent).join("/");
  const relativePath = [source.directory, encodedName]
    .filter(Boolean)
    .join("/");
  const url = `https://raw.githubusercontent.com/${source.repository}/${source.commit}/${relativePath}`;
  const response = await request(url, config, reporter);
  const handle = await fsPromises.open(temporary, "w");
  const hash = crypto.createHash("sha1");
  hash.update(`blob ${file.size}\0`);
  let received = 0;
  try {
    for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk);
      await handle.write(bytes);
      hash.update(bytes);
      received += bytes.length;
    }
  } finally {
    await handle.close();
  }
  if (received !== file.size || hash.digest("hex") !== file.sha) {
    await fsPromises.rm(temporary, { force: true });
    throw new Error(`Downloaded blob verification failed: ${file.name}`);
  }
  await fsPromises.rename(temporary, destination);
  return { skipped: false };
}

export async function runDownload(config, reporter) {
  ensureDirectory(sourceRoot);
  ensureDirectory(csvRoot);
  ensureDirectory(schemaRoot);
  const manifest = await fetchManifest(config, reporter);
  writeJsonAtomic(manifestPath, manifest);

  const previousState = readJson(downloadStatePath, {
    commit: null,
    completed: {},
  });
  const state =
    previousState.commit === manifest.commit &&
    previousState.schemaCommit === manifest.schemas.commit
      ? previousState
      : {
          commit: manifest.commit,
          schemaCommit: manifest.schemas.commit,
          completed: {},
          startedAt: new Date().toISOString(),
        };

  const sources = [
    ...manifest.files.map((file) => ({
      key: `csv/${file.name}`,
      file,
      source: manifest,
      destinationRoot: csvRoot,
    })),
    ...manifest.schemas.files.map((file) => ({
      key: `schema/${file.name}`,
      file,
      source: manifest.schemas,
      destinationRoot: schemaRoot,
    })),
  ];

  let completed = 0;
  let downloadedBytes = 0;
  const failures = [];
  reporter.setStage("CSVと参照型定義を取得", sources.length);

  let nextIndex = 0;
  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= sources.length) return;
      const entry = sources[index];
      const { file } = entry;
      reporter.update({ current: entry.key });
      try {
        const result = await downloadFile(
          file,
          entry.source,
          entry.destinationRoot,
          config,
          reporter,
        );
        if (!result.skipped) downloadedBytes += file.size;
        state.completed[entry.key] = file.sha;
      } catch (error) {
        failures.push({ file: entry.key, error: error.message });
        reporter.warning(`${entry.key}: ${error.message}`);
      }
      completed += 1;
      state.updatedAt = new Date().toISOString();
      state.failures = failures;
      writeJsonAtomic(downloadStatePath, state);
      reporter.update({
        completed,
        failures: failures.length,
        downloadedBytes,
      });
    }
  }

  await Promise.all(
    Array.from({ length: config.downloadConcurrency }, () => worker()),
  );
  if (failures.length > 0) {
    throw new Error(
      `${failures.length} CSVの取得に失敗しました。再実行すると未完了分を再試行します。`,
    );
  }
  reporter.finish({
    completed: sources.length,
    total: sources.length,
    downloadedBytes,
  });
  return manifest;
}
