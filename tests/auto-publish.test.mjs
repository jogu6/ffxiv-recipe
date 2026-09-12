import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { updateAppCacheVersion, expectedAppCacheVersion } from "../tools/app-cache-version.mjs";
import {
  AUTO_PUBLISH_FILES,
  BACKGROUND_AUTH_ENV,
  applyBackgroundCpuPriority,
  buildFailureNotification,
  explainAutomationFailure,
  normalizeSettings,
  npmCheckInvocation,
  notifySafely,
  parseChangedFiles,
  runAutomaticPublication as publish,
  runProcess,
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

function gitAt(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function gitFixture(t) {
  const root = temporaryRoot(t);
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  };
  gitAt(root, 'init', '-b', 'main');
  gitAt(root, 'config', 'user.name', 'Publication Test');
  gitAt(root, 'config', 'user.email', 'publication@example.invalid');
  gitAt(root, 'config', 'core.autocrlf', 'false');
  write('.gitignore', 'pipeline/state/\nremote.git/\n');
  write('README.md', 'original\n');
  write('site/app.js', "const DATA_CACHE_VERSION = 'old-data';\nconst feature = 'original';\nconst stagedFeature = 'original';\n");
  write('site/item-icon-pack.js', "const PACK_VERSION = 'abcd';\nconst decoder = 'original';\n");
  write('site/sw.js', "const APP_CACHE_VERSION = 'ff14recipe-app-v3.24-old';\nconst DATA_CACHE_VERSION = 'old-data';\nconst PRECACHE_FILES = ['./app.js', './item-icon-pack.js'];\nconst worker = 'original';\n");
  write('site/data/Item.json', '{"Version":"7.5","Items":[]}\n');
  write('site/data/legacy-item-ids.json', '{}\n');
  write('site/data/item-icons.pack.gz', Buffer.from([0, 255, 1]));
  updateAppCacheVersion({ siteRoot: path.join(root, 'site'), serviceWorkerPath: path.join(root, 'site/sw.js') });
  gitAt(root, 'add', '.');
  gitAt(root, 'commit', '-m', 'Initial data');
  const base = gitAt(root, 'rev-parse', 'HEAD');
  const remote = path.join(root, 'remote.git');
  gitAt(root, 'init', '--bare', remote);
  gitAt(root, 'remote', 'add', 'origin', remote);
  gitAt(root, 'push', '-u', 'origin', 'main');
  const edit = (file, from, to) => write(file, fs.readFileSync(path.join(root, file), 'utf8').replace(from, to));
  const calls = [];
  const control = { failValidation: false, failPush: false, failAfterRef: false, noChanges: false };
  const run = async (command, args, options = {}) => {
    calls.push([path.basename(command), ...args]);
    if (command === 'git') {
      if (args[0] === 'push' && control.failPush) throw new Error('simulated push failure');
      const result = await runProcess(command, args, { ...options, cwd: root });
      if (args[0] === 'update-ref' && control.failAfterRef) throw new Error('simulated interruption after ref update');
      return result;
    }
    if (command === 'gh') {
      if (args[0] === 'run') return response(JSON.stringify([{ headSha: gitAt(remote, 'rev-parse', 'refs/heads/main'), status: 'completed', conclusion: 'success', url: 'https://example.invalid/deployment' }]));
      return response();
    }
    if (args.some(arg => arg.endsWith('validate-site.mjs'))) {
      if (control.failValidation) throw new Error('simulated validation failure');
      const candidate = path.resolve(path.dirname(args[0]), '..');
      const sw = fs.readFileSync(path.join(candidate, 'site/sw.js'), 'utf8');
      assert.ok(sw.includes(expectedAppCacheVersion({ siteRoot: path.join(candidate, 'site'), serviceWorkerSource: sw })));
      assert.doesNotMatch(fs.readFileSync(path.join(candidate, 'site/app.js'), 'utf8'), /local|staged-edit/);
      return response();
    }
    if (args.includes('publish-lodestone-candidate') && !control.noChanges) {
      write('site/data/Item.json', '{"Version":"7.6","Items":[]}\n');
      write('site/data/item-icons.pack.gz', Buffer.from([0, 255, 2]));
      edit('site/app.js', 'old-data', 'new-data');
      edit('site/sw.js', 'old-data', 'new-data');
      edit('site/item-icon-pack.js', 'abcd', 'ef01');
    }
    if (args.includes('app-cache-version')) updateAppCacheVersion({ siteRoot: path.join(root, 'site'), serviceWorkerPath: path.join(root, 'site/sw.js') });
    return response();
  };
  const options = { repositoryRoot: root, statePath: path.join(root, 'pipeline/state/auto-publish.json'),
    config: { discordWebhookUrl: 'https://discord.com/api/webhooks/1/test' }, current: { Version: '7.6' },
    logger: { write() {} }, run, delay: async () => {}, fetchImpl: async () => ({ ok: true, status: 204 }) };
  return { root, remote, base, write, edit, calls, control, options };
}

test('real main publication commits only data and constant lines while preserving staged and unstaged edits', async t => {
  const f = gitFixture(t);
  f.write('README.md', 'staged documentation\n');
  f.edit('site/app.js', "stagedFeature = 'original'", "stagedFeature = 'staged-edit'");
  gitAt(f.root, 'add', 'README.md', 'site/app.js');
  f.edit('site/app.js', "feature = 'original'", "feature = 'local'");
  f.edit('site/sw.js', "worker = 'original'", "worker = 'local'");
  f.edit('site/item-icon-pack.js', "decoder = 'original'", "decoder = 'local'");
  f.write('notes.txt', 'untracked notes');
  const result = await publish(f.options);
  assert.equal(result.status, 'published');
  assert.equal(gitAt(f.root, 'branch', '--show-current'), 'main');
  assert.equal(gitAt(f.remote, 'rev-parse', 'refs/heads/main'), result.commitSha);
  assert.equal(gitAt(f.root, 'show', 'HEAD:README.md'), 'original');
  assert.equal(gitAt(f.root, 'show', ':README.md'), 'staged documentation');
  assert.match(gitAt(f.root, 'show', ':site/app.js'), /staged-edit/);
  assert.doesNotMatch(gitAt(f.root, 'show', ':site/app.js'), /feature = 'local'/);
  assert.match(fs.readFileSync(path.join(f.root, 'site/app.js'), 'utf8'), /feature = 'local'/);
  for (const file of ['site/app.js', 'site/sw.js', 'site/item-icon-pack.js']) {
    const diff = gitAt(f.root, 'diff', '--unified=0', f.base, 'HEAD', '--', file);
    const changedLines = diff.split('\n').filter(line => /^[+-](?![+-])/.test(line));
    assert.ok(changedLines.length > 0);
    assert.ok(changedLines.every(line => /^[+-]const (?:APP_CACHE_VERSION|DATA_CACHE_VERSION|PACK_VERSION) = /.test(line)), diff);
  }
  assert.ok(result.changedFiles.every(file => AUTO_PUBLISH_FILES.includes(file)));
  assert.equal(result.changedFiles.includes('site/data/legacy-item-ids.json'), false);
  assert.equal(fs.readFileSync(path.join(f.root, 'notes.txt'), 'utf8'), 'untracked notes');
  assert.equal(gitAt(f.root, 'diff', '--cached', '--name-only'), 'README.md\nsite/app.js');
});

test('validation failure restores preexisting public edits and the index; retry regenerates rolled-back output', async t => {
  const f = gitFixture(t);
  f.edit('site/app.js', "feature = 'original'", "feature = 'local'");
  gitAt(f.root, 'add', 'site/app.js');
  const index = fs.readFileSync(path.join(f.root, '.git/index'));
  const before = Object.fromEntries(AUTO_PUBLISH_FILES.map(file => [file, fs.readFileSync(path.join(f.root, file))]));
  f.control.failValidation = true;
  await assert.rejects(publish(f.options), /simulated validation failure/);
  for (const file of AUTO_PUBLISH_FILES) assert.deepEqual(fs.readFileSync(path.join(f.root, file)), before[file]);
  assert.deepEqual(fs.readFileSync(path.join(f.root, '.git/index')), index);
  assert.equal(gitAt(f.remote, 'rev-parse', 'refs/heads/main'), f.base);
  f.control.failValidation = false;
  const result = await publish(f.options);
  assert.equal(result.status, 'published');
  assert.equal(f.calls.filter(call => call.includes('publish-lodestone-candidate')).length, 2);
  assert.equal(f.calls.filter(call => call.includes('lodestone-audit')).length, 1);
});

test('push retry publishes the saved data commit even after a later local main commit', async t => {
  const f = gitFixture(t);
  f.control.failPush = true;
  await assert.rejects(publish(f.options), /simulated push failure/);
  const automaticCommit = gitAt(f.root, 'rev-parse', 'HEAD');
  f.write('README.md', 'later local commit\n');
  gitAt(f.root, 'add', 'README.md');
  gitAt(f.root, 'commit', '-m', 'Unpublished local work');
  const localHead = gitAt(f.root, 'rev-parse', 'HEAD');
  f.control.failPush = false;
  const result = await publish(f.options);
  assert.equal(result.commitSha, automaticCommit);
  assert.equal(gitAt(f.remote, 'rev-parse', 'refs/heads/main'), automaticCommit);
  assert.equal(gitAt(f.root, 'rev-parse', 'HEAD'), localHead);
  assert.equal(f.calls.filter(call => call.includes('publish-lodestone-candidate')).length, 1);
});

test('unchanged data does not commit unrelated dirty files or the local application cache hash', async t => {
  const f = gitFixture(t);
  f.control.noChanges = true;
  f.edit('site/app.js', "feature = 'original'", "feature = 'local'");
  gitAt(f.root, 'add', 'site/app.js');
  const index = fs.readFileSync(path.join(f.root, '.git/index'));
  const result = await publish(f.options);
  assert.equal(result.commitSha, null);
  assert.deepEqual(result.changedFiles, []);
  assert.deepEqual(fs.readFileSync(path.join(f.root, '.git/index')), index);
  assert.equal(gitAt(f.root, 'rev-parse', 'HEAD'), f.base);
  assert.equal(f.calls.some(call => call[1] === 'push'), false);
});

test('interruption after updating main recovers its index and resumes the saved commit without regeneration', async t => {
  const f = gitFixture(t);
  f.edit('site/app.js', "stagedFeature = 'original'", "stagedFeature = 'staged-edit'");
  gitAt(f.root, 'add', 'site/app.js');
  f.control.failAfterRef = true;
  await assert.rejects(publish(f.options), /simulated interruption/);
  const state = JSON.parse(fs.readFileSync(f.options.statePath, 'utf8'));
  assert.equal(state.status, 'committed');
  assert.equal(state.commitSha, gitAt(f.root, 'rev-parse', 'HEAD'));
  assert.match(gitAt(f.root, 'show', ':site/app.js'), /staged-edit/);
  assert.match(gitAt(f.root, 'show', ':site/app.js'), /new-data/);
  f.control.failAfterRef = false;
  const result = await publish(f.options);
  assert.equal(result.commitSha, state.commitSha);
  assert.equal(f.calls.filter(call => call.includes('publish-lodestone-candidate')).length, 1);
});

// These command-level tests keep generation and commit preparation mocked;
// real Git/index preservation is covered by the integration tests below.
function runAutomaticPublication(options) {
  return publish({
    ...options,
    prepareFiles: async ({ repositoryRoot, run }) => ({
      candidateRoot: repositoryRoot,
      changedFiles: parseChangedFiles((await run('git', ['diff', '--name-only'])).stdout),
    }),
    commitFiles: async ({ prepared, message, run }) => {
      await run('git', ['commit', '-m', message, '--', ...prepared.changedFiles]);
      return (await run('git', ['rev-parse', 'HEAD'])).stdout.trim();
    },
  });
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
    nodeHeapMb: 1024,
  });
});

test("background CPU priority is applied without making priority support fatal", () => {
  const calls = [];
  assert.equal(applyBackgroundCpuPriority(123, (...args) => calls.push(args)), true);
  assert.deepEqual(calls, [[123, os.constants.priority.PRIORITY_BELOW_NORMAL]]);
  assert.equal(applyBackgroundCpuPriority(123, () => { throw new Error("unsupported"); }), false);
});

test("background authentication never opens an interactive prompt", () => {
  assert.deepEqual(BACKGROUND_AUTH_ENV, {
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "Never",
    GH_PROMPT_DISABLED: "1",
  });
});

test("Windows validation invokes npm through Node instead of spawning npm.cmd", () => {
  assert.deepEqual(npmCheckInvocation({
    platform: "win32",
    execPath: "C:\\Node\\node.exe",
    npmExecPath: "C:\\Node\\npm-cli.js",
    existsSync: (candidate) => candidate === "C:\\Node\\npm-cli.js",
  }), {
    command: "C:\\Node\\node.exe",
    args: ["C:\\Node\\npm-cli.js", "run", "check"],
  });
  assert.deepEqual(npmCheckInvocation({ platform: "linux" }), {
    command: "npm",
    args: ["run", "check"],
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
    calls.some((call) => call.includes("--max-old-space-size=1024")),
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
    if (args[0] === "diff" && args[1] === "--name-only" && args.length === 2)
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

test("failed publication resumes after its last completed pipeline command", async (t) => {
  const root = temporaryRoot(t);
  const statePath = path.join(root, "pipeline", "state", "auto-publish.json");
  fs.writeFileSync(
    statePath,
    `${JSON.stringify({
      schemaVersion: 1,
      status: "failed",
      targetVersion: "7.6",
      targetKey: "7.6||||",
      baseCommit: "base",
      completedCommands: ["lodestone-audit"],
      failedPhase: "generation",
      errorCode: "COMMAND_FAILED",
      errorMessage: "old failure",
    })}\n`,
  );
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
  const result = await runAutomaticPublication({
    config: {
      discordWebhookUrl: "https://discord.com/api/webhooks/1/token",
      delayMs: 0,
    },
    current: { Version: "7.6" },
    repositoryRoot: root,
    statePath,
    logger: { write() {} },
    run,
    fetchImpl: async () => ({ ok: true, status: 204 }),
  });
  assert.equal(result.status, "published");
  assert.equal(calls.some((call) => call.includes("lodestone-audit")), false);
  assert.equal(
    calls.some((call) => call.includes("build-lodestone-candidate")),
    true,
  );
  const saved = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert.equal(saved.status, "published");
  assert.equal("failedPhase" in saved, false);
  assert.equal("errorCode" in saved, false);
  assert.equal("errorMessage" in saved, false);
});

test("unexpected commit files stop publication, preserve the index, and send a Japanese failure", async (t) => {
  const root = temporaryRoot(t);
  const calls = [];
  const notifications = [];
  const run = async (command, args) => {
    calls.push([path.basename(command), ...args]);
    if (args[0] === "branch") return response("main");
    if (args[0] === "status" && args[1] === "--porcelain") return response("");
    if (args[0] === "rev-parse") return response("base");
    if (args[0] === "diff" && args[1] === "--name-only" && args.length === 2)
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
  assert.equal(calls.some((call) => call[1] === "restore"), false);
  assert.equal(calls.some((call) => call[1] === "reset"), false);
  assert.match(notifications[0], /公開データ生成・検証/);
  assert.match(notifications[0], /処理を中止/);
});
