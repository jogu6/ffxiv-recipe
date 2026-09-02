import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { archivePipelineLogs } from "../pipeline/tool/log-archive.mjs";

function createLogsRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ffxiv-log-archive-"));
  fs.mkdirSync(path.join(root, "runs"), { recursive: true });
  return root;
}

function runName(iso, command) {
  return `${new Date(iso).getTime()}-${command}.log`;
}

test("archives completed months, keeps the current month, and rebuilds latest.log", (t) => {
  const root = createLogsRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const july = runName("2026-07-31T14:59:59Z", "july");
  const august = runName("2026-08-01T00:00:00Z", "august");
  const september = runName("2026-09-01T00:00:00Z", "september");
  fs.writeFileSync(path.join(root, "runs", july), "july\n");
  fs.writeFileSync(path.join(root, "runs", august), "august\n");
  fs.writeFileSync(path.join(root, "runs", september), "september\n");
  fs.writeFileSync(path.join(root, "latest.log"), "july\naugust\nseptember\n");
  fs.writeFileSync(
    path.join(root, "lodestone-monitor.txt"),
    [
      "[2026-07-31T05:00:00+09:00] july\n",
      "[2026-08-31T05:00:00+09:00] august\n",
      "[2026-09-01T05:00:00+09:00] september\n",
    ].join(""),
  );

  const result = archivePipelineLogs({
    logsRoot: root,
    now: new Date("2026-09-02T00:00:00Z"),
  });

  assert.deepEqual(result.monthlyArchives, [
    "archive\\monthly\\2026-07.zip",
    "archive\\monthly\\2026-08.zip",
  ]);
  assert.equal(result.archivedRunFiles, 2);
  assert.equal(result.archivedMonitorLines, 2);
  assert.deepEqual(fs.readdirSync(path.join(root, "runs")), [september]);
  assert.equal(
    fs.readFileSync(path.join(root, "latest.log"), "utf8"),
    "september\n",
  );
  assert.equal(
    fs.readFileSync(path.join(root, "lodestone-monitor.txt"), "utf8"),
    "[2026-09-01T05:00:00+09:00] september\n",
  );
});

test("is idempotent after completed logs have been removed", (t) => {
  const root = createLogsRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const august = runName("2026-08-01T00:00:00Z", "build");
  fs.writeFileSync(path.join(root, "runs", august), "build\n");
  fs.writeFileSync(path.join(root, "latest.log"), "build\n");
  fs.writeFileSync(
    path.join(root, "lodestone-monitor.txt"),
    "[2026-08-01T05:00:00+09:00] ok\n",
  );
  const now = new Date("2026-09-02T00:00:00Z");

  archivePipelineLogs({ logsRoot: root, now });
  const archive = fs.readFileSync(
    path.join(root, "archive", "monthly", "2026-08.zip"),
  );
  const second = archivePipelineLogs({ logsRoot: root, now });

  assert.deepEqual(second.monthlyArchives, []);
  assert.deepEqual(
    fs.readFileSync(path.join(root, "archive", "monthly", "2026-08.zip")),
    archive,
  );
});

test("collects completed-year monthly archives into one yearly archive", (t) => {
  const root = createLogsRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const december = runName("2025-12-01T00:00:00Z", "build");
  fs.writeFileSync(path.join(root, "runs", december), "old\n");

  const result = archivePipelineLogs({
    logsRoot: root,
    now: new Date("2026-01-02T00:00:00Z"),
  });

  assert.deepEqual(result.yearlyArchives, ["archive\\yearly\\2025.zip"]);
  assert.equal(
    fs.existsSync(path.join(root, "archive", "monthly", "2025-12.zip")),
    false,
  );
  assert.equal(
    fs.existsSync(path.join(root, "archive", "yearly", "2025.zip")),
    true,
  );
});
