import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AUTO_PUBLISH_FILES,
  buildFailureNotification,
  explainAutomationFailure,
  normalizeSettings,
  notifySafely,
  parseChangedFiles,
  runAutomaticPublication,
  selectDeploymentRun,
} from "../pipeline/tool/auto-publish.mjs";

function temporaryRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ffxiv-auto-publish-"));
  fs.mkdirSync(path.join(root, "pipeline", "state"), { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function response(stdout = "") {
  return { stdout, stderr: "", exitCode: 0 };
}

test("auto publish settings are enabled with safe repository defaults", () => {
  assert.deepEqual(normalizeSettings({}), {
    enabled: true,
    remote: "origin",
    branch: "main",
    deployWorkflow: "deploy-pages.yml",
    deployTimeoutMinutes: 20,
    deployPollSeconds: 15,
    iconQuality: 80,
    iconSize: 80,
    nodeHeapMb: 8192,
  });
});

test("authentication failures include fixed Japanese reauthentication advice", () => {
  const explanation = explainAutomationFailure(
    { detail: "HTTP 401 Bad credentials" },
    "push",
  );
  assert.match(explanation.reason, /認証情報/);
  assert.match(explanation.advice, /gh auth login/);
  assert.match(explanation.advice, /gh auth setup-git/);
  const notification = buildFailureNotification({
    error: { detail: "HTTP 401" },
    phase: "push",
    version: "7.6",
    logPath:
      "C:\\FF14_RecipeTree\\ffxiv-recipe\\pipeline\\logs\\runs\\test.log",
  });
  assert.match(notification, /対象Lodestone版: 7\.6/);
  assert.match(
    notification,
    /確認ログ: C:\\FF14_RecipeTree\\ffxiv-recipe\\pipeline\\logs\\runs\\test\.log/,
  );
  assert.match(notification, /\+09:00/);
});

test("source monitoring distinguishes no response from unreadable HTML", () => {
  assert.match(
    explainAutomationFailure({ detail: "ENOTFOUND" }, "source").reason,
    /接続できなかった/,
  );
  assert.match(
    explainAutomationFailure({ detail: "Version was not found" }, "source")
      .reason,
    /HTML/,
  );
});

test("changed file parsing normalizes separators and deployment selection uses the exact commit", () => {
  assert.deepEqual(
    parseChangedFiles("site\\sw.js\r\nsite/data/Item.json\nsite/sw.js\n"),
    ["site/data/Item.json", "site/sw.js"],
  );
  assert.equal(
    selectDeploymentRun(
      [{ headSha: "old" }, { headSha: "new", status: "completed" }],
      "new",
    ).headSha,
    "new",
  );
});

test("Discord authentication failure is recorded locally with Japanese recovery advice", async () => {
  const messages = [];
  const sent = await notifySafely({
    webhookUrl: "https://discord.com/api/webhooks/1/token",
    content: "test",
    logger: { write: (message) => messages.push(message) },
    fetchImpl: async () => ({ ok: false, status: 404 }),
  });
  assert.equal(sent, false);
  assert.match(messages.join("\n"), /Webhookを再作成/);
  assert.match(messages.join("\n"), /test-notification/);
});

test("automatic publication runs the shared pipeline and finishes without Git writes when output is unchanged", async (t) => {
  const root = temporaryRoot(t);
  const calls = [];
  const run = async (command, args) => {
    calls.push([path.basename(command), ...args]);
    if (args[0] === "branch") return response("main");
    if (args[0] === "status" && args[1] === "--porcelain") return response("");
    if (args[0] === "rev-parse") return response("base");
    if (args[0] === "diff" && args[1] === "--name-only") return response("");
    if (args[0] === "ls-files") return response("");
    return response("");
  };
  const notifications = [];
  const result = await runAutomaticPublication({
    config: {
      discordWebhookUrl: "https://discord.com/api/webhooks/1/token",
      delayMs: 0,
    },
    current: { Version: "7.6" },
    repositoryRoot: root,
    statePath: path.join(root, "pipeline", "state", "auto-publish.json"),
    logger: { write() {} },
    run,
    fetchImpl: async (_url, options) => {
      notifications.push(JSON.parse(options.body).content);
      return { ok: true, status: 204 };
    },
  });
  assert.equal(result.status, "published");
  assert.ok(calls.some((call) => call.includes("lodestone-audit")));
  assert.ok(
    calls.some((call) => call.includes("--max-old-space-size=8192")),
  );
  assert.ok(calls.some((call) => call.includes("publish-lodestone-candidate")));
  assert.ok(calls.some((call) => call.includes("app-cache-version")));
  assert.equal(
    calls.some((call) => call.includes("commit")),
    false,
  );
  assert.match(notifications[0], /自動更新が完了/);
  const resumed = await runAutomaticPublication({
    config: {
      discordWebhookUrl: "https://discord.com/api/webhooks/1/token",
      delayMs: 0,
    },
    current: { Version: "7.6" },
    repositoryRoot: root,
    statePath: path.join(root, "pipeline", "state", "auto-publish.json"),
    logger: { write() {} },
    run: async () => {
      throw new Error("公開済みの同じ更新ではコマンドを実行しません");
    },
  });
  assert.equal(resumed.status, "published");
});

test("automatic publication commits allowed files, pushes once, and confirms the matching deployment", async (t) => {
  const root = temporaryRoot(t);
  const calls = [];
  let committed = false;
  const run = async (command, args) => {
    calls.push([path.basename(command), ...args]);
    if (args[0] === "branch") return response("main");
    if (args[0] === "status" && args[1] === "--porcelain") return response("");
    if (args[0] === "rev-parse" && args[1] === "HEAD")
      return response(committed ? "new-sha" : "base-sha");
    if (args[0] === "rev-parse") return response("base-sha");
    if (args[0] === "diff" && args[1] === "--name-only")
      return response("site/data/Item.json\nsite/sw.js");
    if (args[0] === "ls-files") return response("");
    if (args[0] === "commit") {
      committed = true;
      return response("");
    }
    if (args[0] === "run" && args[1] === "list") {
      return response(
        JSON.stringify([
          {
            databaseId: 1,
            status: "completed",
            conclusion: "success",
            url: "https://example.test/run/1",
            headSha: "new-sha",
          },
        ]),
      );
    }
    return response("");
  };
  const result = await runAutomaticPublication({
    config: {
      discordWebhookUrl: "https://discord.com/api/webhooks/1/token",
      delayMs: 0,
    },
    current: { Version: "7.6" },
    repositoryRoot: root,
    statePath: path.join(root, "pipeline", "state", "auto-publish.json"),
    logger: { write() {} },
    run,
    delay: async () => {},
    fetchImpl: async () => ({ ok: true, status: 204 }),
  });
  assert.equal(result.status, "published");
  assert.equal(result.commitSha, "new-sha");
  assert.deepEqual(result.changedFiles, ["site/data/Item.json", "site/sw.js"]);
  assert.equal(calls.filter((call) => call[1] === "push").length, 1);
  assert.ok(AUTO_PUBLISH_FILES.includes("site/sw.js"));
});

test("unexpected generated files stop publication, restore only approved files, and send a Japanese failure", async (t) => {
  const root = temporaryRoot(t);
  const calls = [];
  const notifications = [];
  const run = async (command, args) => {
    calls.push([path.basename(command), ...args]);
    if (args[0] === "branch") return response("main");
    if (args[0] === "status" && args[1] === "--porcelain") return response("");
    if (args[0] === "rev-parse") return response("base");
    if (args[0] === "diff" && args[1] === "--name-only")
      return response("site/data/Item.json\nREADME.md");
    if (args[0] === "ls-files") return response("");
    return response("");
  };
  await assert.rejects(
    runAutomaticPublication({
      config: {
        discordWebhookUrl: "https://discord.com/api/webhooks/1/token",
        delayMs: 0,
      },
      current: { Version: "7.6" },
      repositoryRoot: root,
      statePath: path.join(root, "pipeline", "state", "auto-publish.json"),
      logger: { write() {} },
      run,
      fetchImpl: async (_url, options) => {
        notifications.push(JSON.parse(options.body).content);
        return { ok: true, status: 204 };
      },
    }),
    /想定外のファイル/,
  );
  assert.equal(
    calls.some((call) => call[1] === "commit"),
    false,
  );
  const restore = calls.find((call) => call[1] === "restore");
  assert.ok(restore);
  assert.ok(restore.includes("--staged"));
  assert.equal(restore.includes("README.md"), false);
  assert.match(notifications[0], /公開データ生成・検証/);
  assert.match(notifications[0], /処理を中止/);
});
