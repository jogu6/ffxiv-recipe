#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const defaultRepositoryRoot = path.resolve(import.meta.dirname, "..", "..");
const defaultStatePath = path.join(
  defaultRepositoryRoot,
  "pipeline",
  "state",
  "auto-publish.json",
);
const defaultLogsRoot = path.join(defaultRepositoryRoot, "pipeline", "logs");
const discordLimit = 1900;
const backgroundCpuPriority = os.constants.priority.PRIORITY_BELOW_NORMAL;

export function applyBackgroundCpuPriority(
  pid = 0,
  setPriority = os.setPriority,
) {
  try {
    setPriority(pid, backgroundCpuPriority);
    return true;
  } catch {
    return false;
  }
}

export const AUTO_PUBLISH_FILES = Object.freeze([
  "site/app.js",
  "site/data/Item.json",
  "site/data/item-icons.pack.gz",
  "site/data/legacy-item-ids.json",
  "site/item-icon-pack.js",
  "site/sw.js",
]);

export class AutomationError extends Error {
  constructor(
    message,
    { phase = "unknown", code = "AUTOMATION_FAILED", detail = "", cause } = {},
  ) {
    super(message, { cause });
    this.name = "AutomationError";
    this.phase = phase;
    this.code = code;
    this.detail = detail;
    this.discordNotified = false;
  }
}

function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function writeJsonAtomic(file, value) {
  ensureDir(path.dirname(file));
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
}

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function acquireLock(lockPath) {
  ensureDir(path.dirname(lockPath));
  try {
    const handle = fs.openSync(lockPath, "wx");
    fs.writeFileSync(
      handle,
      `${JSON.stringify({ pid: process.pid, startedAt: jstTimestamp() })}\n`,
      "utf8",
    );
    return () => {
      fs.closeSync(handle);
      try {
        fs.rmSync(lockPath);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let lock = {};
    try {
      lock = readJson(lockPath, {});
    } catch {
      // A process can stop between creating and writing the lock file.
    }
    if (processExists(Number(lock.pid))) {
      throw new AutomationError("別の自動公開処理が実行中です", {
        phase: "preflight",
        code: "ALREADY_RUNNING",
      });
    }
    fs.rmSync(lockPath);
    return acquireLock(lockPath);
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

function jstTimestamp(date = new Date()) {
  const shifted = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return `${shifted.toISOString().slice(0, -1)}+09:00`;
}

export function createAutomationLogger({
  logsRoot = defaultLogsRoot,
  now = new Date(),
} = {}) {
  const runsRoot = path.join(logsRoot, "runs");
  const runFile = path.join(runsRoot, `${now.getTime()}-auto-publish.log`);
  const latestFile = path.join(logsRoot, "latest.log");
  ensureDir(runsRoot);
  return {
    runFile,
    write(message, stream = "AUTO") {
      const sanitized = String(message ?? "")
        .replaceAll("\r", "")
        .trimEnd();
      if (!sanitized) return;
      const entries = sanitized
        .split("\n")
        .map((line) => `[${jstTimestamp()}] [${stream}] ${line}\n`)
        .join("");
      fs.appendFileSync(runFile, entries, "utf8");
      fs.appendFileSync(latestFile, entries, "utf8");
    },
  };
}

function boundedAppend(current, addition, limit = 32000) {
  const next = `${current}${addition}`;
  return next.length <= limit ? next : next.slice(next.length - limit);
}

export function runProcess(
  command,
  args,
  {
    cwd = defaultRepositoryRoot,
    timeoutMs = 60 * 60 * 1000,
    logger = null,
    env = {},
  } = {},
) {
  return new Promise((resolve, reject) => {
    logger?.write(`実行: ${path.basename(command)} ${args.join(" ")}`);
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (!applyBackgroundCpuPriority(child.pid)) {
      logger?.write(
        `警告: ${path.basename(command)}のCPU優先度を低く設定できませんでした`,
        "ERR",
      );
    }
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stdout = boundedAppend(stdout, text);
      logger?.write(text, "OUT");
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stderr = boundedAppend(stderr, text);
      logger?.write(text, "ERR");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(
        new AutomationError(`${path.basename(command)}を起動できませんでした`, {
          phase: "command",
          code:
            error.code === "ENOENT"
              ? "COMMAND_NOT_FOUND"
              : "COMMAND_START_FAILED",
          detail: error.message,
          cause: error,
        }),
      );
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      if (exitCode === 0)
        return resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode,
        });
      reject(
        new AutomationError(
          `${path.basename(command)}が正常終了しませんでした`,
          {
            phase: "command",
            code: signal ? "COMMAND_TIMEOUT" : "COMMAND_FAILED",
            detail: (stderr || stdout || `exit=${exitCode}`).trim(),
          },
        ),
      );
    });
  });
}

export function normalizeSettings(config = {}) {
  const source =
    config.autoPublish && typeof config.autoPublish === "object"
      ? config.autoPublish
      : {};
  return {
    enabled: source.enabled !== false,
    remote: String(source.remote || "origin"),
    branch: String(source.branch || "main"),
    deployWorkflow: String(source.deployWorkflow || "deploy-pages.yml"),
    deployTimeoutMinutes: Math.max(
      1,
      Number(source.deployTimeoutMinutes || 20),
    ),
    deployPollSeconds: Math.max(5, Number(source.deployPollSeconds || 15)),
    iconQuality: Math.min(100, Math.max(1, Number(source.iconQuality || 80))),
    iconSize: Math.max(1, Number(source.iconSize || 80)),
    nodeHeapMb: Math.max(512, Number(source.nodeHeapMb || 1024)),
  };
}

export function npmCheckInvocation({
  platform = process.platform,
  execPath = process.execPath,
  npmExecPath = process.env.npm_execpath,
  existsSync = fs.existsSync,
} = {}) {
  if (platform !== "win32") return { command: "npm", args: ["run", "check"] };
  const npmCli = [
    npmExecPath,
    path.join(path.dirname(execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ].find((candidate) => candidate && existsSync(candidate));
  if (!npmCli) {
    throw new AutomationError("npm本体を確認できませんでした", {
      phase: "generation",
      code: "COMMAND_NOT_FOUND",
      detail: "npm-cli.js がNode.jsのインストール先にありません",
    });
  }
  return { command: execPath, args: [npmCli, "run", "check"] };
}

function looksLikeAuthenticationFailure(value) {
  return /(?:authentication failed|bad credentials|could not read username|terminal prompts disabled|http\s*(?:401|403)|unauthorized|permission denied|token.*(?:expired|invalid)|not logged into|gh auth login)/iu.test(
    String(value || ""),
  );
}

function looksLikeNetworkFailure(value) {
  return /(?:timed?\s*out|econnreset|enotfound|could not resolve host|failed to connect|network is unreachable|http\s*[45]\d\d)/iu.test(
    String(value || ""),
  );
}

export function explainAutomationFailure(
  error,
  phase = error?.phase || "unknown",
) {
  const detail = String(
    error?.detail || error?.message || error || "不明なエラー",
  );
  if (looksLikeAuthenticationFailure(detail)) {
    return {
      reason: "GitHubの認証情報が期限切れ、無効、または未設定です。",
      advice:
        "PowerShellで `gh auth login --hostname github.com --git-protocol https --web` を実行し、続けて `gh auth setup-git` と `gh auth status` で確認してください。再認証後は次回の定期実行で未完了工程から再開します。",
    };
  }
  if (error?.code === "COMMAND_NOT_FOUND" && /gh(?:\.exe)?/iu.test(detail)) {
    return {
      reason: "GitHub CLI（gh）が見つかりません。",
      advice:
        "GitHub CLIを再インストールし、PowerShellで `gh --version` と `gh auth status` を確認してください。",
    };
  }
  if (phase === "source") {
    return looksLikeNetworkFailure(detail)
      ? {
          reason:
            "Lodestoneへ接続できなかったため、更新の有無を確認できませんでした。",
          advice:
            "インターネット接続とLodestoneの稼働状況を確認してください。更新なしとは扱わず、次回の定期実行で再確認します。",
        }
      : {
          reason:
            "LodestoneのHTMLから期待した版・件数・一覧情報を読み取れませんでした。",
          advice:
            "LodestoneのHTML構造が変更された可能性があります。自動公開は行わず、監視・抽出処理の確認が必要です。",
        };
  }
  if (phase === "preflight") {
    return {
      reason: "自動処理を安全に開始できるGit状態ではありません。",
      advice:
        "未コミット変更、現在のブランチ、リモートとの差分を確認してください。既存の作業内容は自動的に上書きしません。",
    };
  }
  if (phase === "generation") {
    return {
      reason: "Item.jsonまたは関連公開データの生成・検証に失敗しました。",
      advice:
        "公開中のデータは更新していません。ローカルの自動公開ログで失敗した工程を確認してください。",
    };
  }
  if (phase === "commit") {
    return {
      reason: "生成した公開データをコミットできませんでした。",
      advice:
        "Gitのユーザー設定、フック、ステージ内容を確認してください。自動生成した公開ファイルは元に戻し、pushは行っていません。",
    };
  }
  if (phase === "push") {
    return {
      reason: "自動コミットをGitHubへpushできませんでした。",
      advice:
        "GitHubの認証、リポジトリ権限、リモートブランチの状態を確認してください。認証切れの場合は `gh auth login --hostname github.com --git-protocol https --web` を実行してください。",
    };
  }
  if (phase === "deployment") {
    return {
      reason: "GitHub Pagesのデプロイ成功を確認できませんでした。",
      advice:
        "GitHub ActionsのDeploy GitHub Pagesを確認してください。push済みのコミットは保持し、次回は再コミットせずデプロイ確認から再開します。",
    };
  }
  return {
    reason: "自動公開処理で予期しないエラーが発生しました。",
    advice:
      "ローカルの自動公開ログで詳細を確認してください。処理は安全のため中止しました。",
  };
}

function sanitizeNotificationValue(value) {
  return String(value || "")
    .replace(
      /https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/[^\s]+/giu,
      "[Discord Webhook]",
    )
    .replace(/[A-Za-z0-9_-]{32,}/gu, "[機密情報の可能性がある値]")
    .slice(0, 500);
}

export function buildFailureNotification({ error, phase, version, logPath }) {
  const explanation = explainAutomationFailure(error, phase);
  const phaseLabel =
    {
      source: "Lodestone確認",
      preflight: "事前確認",
      generation: "公開データ生成・検証",
      commit: "Gitコミット",
      push: "GitHubへのpush",
      deployment: "GitHub Pagesデプロイ確認",
      notification: "Discord通知",
    }[phase] || "自動処理";
  return [
    "**FF14レシピデータの自動処理を中止しました**",
    "",
    `工程: ${phaseLabel}`,
    `対象Lodestone版: ${version || "確認前"}`,
    `原因: ${explanation.reason}`,
    `対応方法: ${explanation.advice}`,
    ...(logPath ? [`確認ログ: ${path.resolve(logPath)}`] : []),
    `記録日時: ${jstTimestamp()}`,
  ].join("\n");
}

export function buildSuccessNotification({
  version,
  commitSha,
  deploymentUrl,
  changedFiles,
}) {
  return [
    "**FF14レシピデータの自動更新が完了しました**",
    "",
    `Lodestone版: ${version}`,
    `コミット: ${commitSha ? commitSha.slice(0, 12) : "変更なし"}`,
    `変更ファイル: ${changedFiles.length}件`,
    `デプロイ: ${deploymentUrl ? "成功" : "新しいデプロイ不要"}`,
    `完了日時: ${jstTimestamp()}`,
  ].join("\n");
}

export async function postDiscord(
  webhookUrl,
  content,
  { fetchImpl = fetch } = {},
) {
  if (
    !/^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/[^/]+\/[^/]+$/u.test(
      webhookUrl || "",
    )
  ) {
    throw new AutomationError("Discord Webhookが未設定または不正です", {
      phase: "notification",
      code: "DISCORD_AUTH",
      detail: "Discord Webhook URL invalid",
    });
  }
  const response = await fetchImpl(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      content: String(content).slice(0, discordLimit),
      allowed_mentions: { parse: [] },
    }),
  });
  if (!response.ok) {
    throw new AutomationError(
      `Discord通知に失敗しました (HTTP ${response.status})`,
      {
        phase: "notification",
        code: [401, 403, 404].includes(response.status)
          ? "DISCORD_AUTH"
          : "DISCORD_FAILED",
        detail: `HTTP ${response.status}`,
      },
    );
  }
}

export async function notifySafely({
  webhookUrl,
  content,
  logger,
  fetchImpl = fetch,
}) {
  try {
    await postDiscord(webhookUrl, content, { fetchImpl });
    return true;
  } catch (error) {
    const advice =
      error.code === "DISCORD_AUTH"
        ? "Discord Webhookが無効です。DiscordでWebhookを再作成し、pipeline/configのローカル設定にあるdiscordWebhookUrlを更新後、`node pipeline/tool/lodestone-update-monitor.mjs --test-notification` で確認してください。"
        : "Discordへ接続できませんでした。通信状態を確認してください。";
    logger?.write(
      `${advice} 詳細=${sanitizeNotificationValue(error.message)}`,
      "ERR",
    );
    return false;
  }
}

export function parseChangedFiles(output) {
  return [
    ...new Set(
      String(output || "")
        .split(/\r?\n/u)
        .map((value) => value.trim().replaceAll("\\", "/"))
        .filter(Boolean),
    ),
  ].sort();
}

function assertAllowedChanges(files) {
  const allowed = new Set(AUTO_PUBLISH_FILES);
  const unexpected = files.filter((file) => !allowed.has(file));
  if (unexpected.length) {
    throw new AutomationError(
      `想定外のファイルが変更されました: ${unexpected.join("、")}`,
      {
        phase: "generation",
        code: "UNEXPECTED_CHANGES",
        detail: unexpected.join("\n"),
      },
    );
  }
}

function pipelineCommands(settings) {
  const delay = String(settings.delayMs);
  return [
    ["lodestone-audit", "--delay", delay],
    ["build-lodestone-candidate", "--delay", delay],
    ["item-icon-cache"],
    [
      "lodestone-candidate-icons",
      "--delay",
      delay,
      "--quality",
      String(settings.iconQuality),
      "--size",
      String(settings.iconSize),
    ],
    ["publish-lodestone-candidate"],
    ["item-icon-validate"],
    ["app-cache-version"],
  ];
}

async function commandText(run, command, args, options) {
  return (await run(command, args, options)).stdout.trim();
}

async function gitChangedFiles(run, repositoryRoot, logger) {
  const tracked = parseChangedFiles(
    await commandText(run, "git", ["diff", "--name-only"], {
      cwd: repositoryRoot,
      logger,
    }),
  );
  const staged = parseChangedFiles(
    await commandText(run, "git", ["diff", "--cached", "--name-only"], {
      cwd: repositoryRoot,
      logger,
    }),
  );
  const untracked = parseChangedFiles(
    await commandText(
      run,
      "git",
      ["ls-files", "--others", "--exclude-standard"],
      { cwd: repositoryRoot, logger },
    ),
  );
  return [...new Set([...tracked, ...staged, ...untracked])].sort();
}

async function rollbackAllowedFiles(run, repositoryRoot, logger) {
  try {
    await run(
      "git",
      ["restore", "--staged", "--worktree", "--", ...AUTO_PUBLISH_FILES],
      {
        cwd: repositoryRoot,
        logger,
      },
    );
  } catch (error) {
    logger?.write(
      `自動生成ファイルの復元に失敗しました: ${sanitizeNotificationValue(error.message)}`,
      "ERR",
    );
  }
}

function publicationState(statePath) {
  return readJson(statePath, { schemaVersion: 1, status: "idle" });
}

function publicationKey(current) {
  return [
    current?.Version,
    current?.RecipeVersion,
    current?.ItemCount,
    current?.RecipeCount,
    current?.ItemOrderSignature,
  ]
    .map((value) => String(value ?? ""))
    .join("|");
}

function savePublicationState(statePath, previous, update) {
  const next = {
    ...previous,
    ...update,
    schemaVersion: 1,
    updatedAt: jstTimestamp(),
  };
  writeJsonAtomic(statePath, next);
  return next;
}

export function selectDeploymentRun(runs, commitSha) {
  if (!Array.isArray(runs)) return null;
  return runs.find((run) => !commitSha || run.headSha === commitSha) || null;
}

async function waitForDeployment({
  run,
  repositoryRoot,
  workflow,
  commitSha,
  timeoutMinutes,
  pollSeconds,
  logger,
  delay,
}) {
  const deadline = Date.now() + timeoutMinutes * 60 * 1000;
  while (Date.now() < deadline) {
    const output = await commandText(
      run,
      "gh",
      [
        "run",
        "list",
        "--workflow",
        workflow,
        "--commit",
        commitSha,
        "--limit",
        "5",
        "--json",
        "databaseId,status,conclusion,url,headSha",
      ],
      { cwd: repositoryRoot, logger, timeoutMs: 5 * 60 * 1000 },
    );
    const deployment = selectDeploymentRun(
      JSON.parse(output || "[]"),
      commitSha,
    );
    if (!deployment) {
      logger?.write("GitHub Pagesの実行開始を待っています");
    } else if (deployment.status === "completed") {
      if (deployment.conclusion === "success") return deployment;
      throw new AutomationError(
        `GitHub Pagesが${deployment.conclusion || "失敗"}で終了しました`,
        {
          phase: "deployment",
          code: "DEPLOYMENT_FAILED",
          detail: deployment.url || deployment.conclusion,
        },
      );
    } else {
      logger?.write(`GitHub Pagesの完了を待っています: ${deployment.status}`);
    }
    await delay(pollSeconds * 1000);
  }
  throw new AutomationError("GitHub Pagesの完了待ちがタイムアウトしました", {
    phase: "deployment",
    code: "DEPLOYMENT_TIMEOUT",
  });
}

function defaultDelay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function runAutomaticPublication({
  config,
  current,
  repositoryRoot = defaultRepositoryRoot,
  statePath = defaultStatePath,
  logger = createAutomationLogger(),
  run = runProcess,
  delay = defaultDelay,
  fetchImpl = fetch,
  lockPath = path.join(path.dirname(statePath), "auto-publish.lock"),
  lockHeld = false,
} = {}) {
  if (!lockHeld) {
    const releaseLock = acquireLock(lockPath);
    try {
      return await runAutomaticPublication({
        config,
        current,
        repositoryRoot,
        statePath,
        logger,
        run,
        delay,
        fetchImpl,
        lockPath,
        lockHeld: true,
      });
    } finally {
      releaseLock();
    }
  }
  const settings = {
    ...normalizeSettings(config),
    delayMs: Math.max(0, Number(config?.delayMs ?? 100) || 0),
  };
  const version = String(current?.Version || "").trim();
  const targetKey = publicationKey(current);
  if (!settings.enabled) return { status: "disabled", changedFiles: [] };
  if (!version)
    throw new AutomationError("Lodestone版がありません", {
      phase: "source",
      code: "SOURCE_INVALID",
    });
  let state = publicationState(statePath);
  let phase = "preflight";
  let generated = false;
  try {
    if (state.status === "published" && state.targetKey === targetKey) {
      return {
        status: "published",
        commitSha: state.commitSha || null,
        deploymentUrl: state.deploymentUrl || null,
        changedFiles: state.changedFiles || [],
      };
    }
    if (
      ["committed", "pushed"].includes(state.status) &&
      state.targetKey !== targetKey
    ) {
      throw new AutomationError(
        `未完了版${state.targetVersion}があるため、新しい版${version}を開始できません`,
        {
          phase: "preflight",
          code: "PENDING_VERSION",
        },
      );
    }

    if (state.status === "pushed") {
      phase = "deployment";
      const deployment = await waitForDeployment({
        run,
        repositoryRoot,
        workflow: settings.deployWorkflow,
        commitSha: state.commitSha,
        timeoutMinutes: settings.deployTimeoutMinutes,
        pollSeconds: settings.deployPollSeconds,
        logger,
        delay,
      });
      state = savePublicationState(statePath, state, {
        status: "published",
        deploymentUrl: deployment.url,
        completedAt: jstTimestamp(),
      });
      await notifySafely({
        webhookUrl: config.discordWebhookUrl,
        content: buildSuccessNotification({
          version,
          commitSha: state.commitSha,
          deploymentUrl: deployment.url,
          changedFiles: state.changedFiles || [],
        }),
        logger,
        fetchImpl,
      });
      return {
        status: "published",
        commitSha: state.commitSha,
        deploymentUrl: deployment.url,
        changedFiles: state.changedFiles || [],
      };
    }

    if (state.status === "committed") {
      phase = "push";
      await run("git", ["push", settings.remote, `HEAD:${settings.branch}`], {
        cwd: repositoryRoot,
        logger,
        timeoutMs: 10 * 60 * 1000,
      });
      state = savePublicationState(statePath, state, {
        status: "pushed",
        pushedAt: jstTimestamp(),
      });
      return runAutomaticPublication({
        config,
        current,
        repositoryRoot,
        statePath,
        logger,
        run,
        delay,
        fetchImpl,
        lockPath,
        lockHeld: true,
      });
    }

    const branch = await commandText(run, "git", ["branch", "--show-current"], {
      cwd: repositoryRoot,
      logger,
    });
    if (branch !== settings.branch)
      throw new AutomationError(
        `現在のブランチは${branch || "detached HEAD"}です`,
        { phase, code: "WRONG_BRANCH" },
      );
    if (state.status === "generating") {
      const recoveryHead = await commandText(
        run,
        "git",
        ["rev-parse", "HEAD"],
        { cwd: repositoryRoot, logger },
      );
      if (state.baseCommit && recoveryHead !== state.baseCommit) {
        const recoveredFiles = parseChangedFiles(
          await commandText(
            run,
            "git",
            ["diff", "--name-only", `${state.baseCommit}..${recoveryHead}`],
            { cwd: repositoryRoot, logger },
          ),
        );
        assertAllowedChanges(recoveredFiles);
        state = savePublicationState(statePath, state, {
          status: "committed",
          commitSha: recoveryHead,
          changedFiles: recoveredFiles,
          recoveredAt: jstTimestamp(),
        });
        return runAutomaticPublication({
          config,
          current,
          repositoryRoot,
          statePath,
          logger,
          run,
          delay,
          fetchImpl,
          lockPath,
          lockHeld: true,
        });
      }
      const recoveryFiles = await gitChangedFiles(run, repositoryRoot, logger);
      assertAllowedChanges(recoveryFiles);
      if (recoveryFiles.length)
        await rollbackAllowedFiles(run, repositoryRoot, logger);
      state = savePublicationState(statePath, state, {
        status: "failed",
        recoveredAt: jstTimestamp(),
      });
    }
    const status = await commandText(run, "git", ["status", "--porcelain"], {
      cwd: repositoryRoot,
      logger,
    });
    if (status)
      throw new AutomationError("未コミット変更があります", {
        phase,
        code: "DIRTY_WORKTREE",
        detail: status,
      });
    await run("gh", ["auth", "status", "--hostname", "github.com"], {
      cwd: repositoryRoot,
      logger,
      timeoutMs: 2 * 60 * 1000,
    });
    await run("git", ["fetch", settings.remote, settings.branch], {
      cwd: repositoryRoot,
      logger,
      timeoutMs: 10 * 60 * 1000,
    });
    const localHead = await commandText(run, "git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      logger,
    });
    const remoteHead = await commandText(
      run,
      "git",
      ["rev-parse", `${settings.remote}/${settings.branch}`],
      { cwd: repositoryRoot, logger },
    );
    if (localHead !== remoteHead)
      throw new AutomationError(
        "ローカルとリモートの先頭コミットが一致しません",
        { phase, code: "BRANCH_DIVERGED" },
      );

    const completedCommands =
      state.status === "failed" &&
      state.targetKey === targetKey &&
      state.baseCommit === localHead &&
      Array.isArray(state.completedCommands)
        ? state.completedCommands.filter((command) =>
            pipelineCommands(settings).some(([name]) => name === command),
          )
        : [];

    phase = "generation";
    generated = true;
    state = savePublicationState(statePath, state, {
      status: "generating",
      targetVersion: version,
      targetKey,
      startedAt: jstTimestamp(),
      commitSha: null,
      baseCommit: localHead,
      deploymentUrl: null,
      changedFiles: [],
      completedCommands,
    });
    const pipelineTool = path.join(
      repositoryRoot,
      "pipeline",
      "tool",
      "pipeline-tool.mjs",
    );
    for (const args of pipelineCommands(settings)) {
      const commandName = args[0];
      if (state.completedCommands.includes(commandName)) {
        logger?.write(`完了済み工程を再利用: ${commandName}`);
        continue;
      }
      await run(
        process.execPath,
        [`--max-old-space-size=${settings.nodeHeapMb}`, pipelineTool, ...args],
        {
          cwd: repositoryRoot,
          logger,
          timeoutMs: 12 * 60 * 60 * 1000,
        },
      );
      state = savePublicationState(statePath, state, {
        completedCommands: [...state.completedCommands, commandName],
      });
    }
    const npmCheck = npmCheckInvocation();
    await run(npmCheck.command, npmCheck.args, {
      cwd: repositoryRoot,
      logger,
      timeoutMs: 2 * 60 * 60 * 1000,
    });
    const changedFiles = await gitChangedFiles(run, repositoryRoot, logger);
    assertAllowedChanges(changedFiles);
    if (
      changedFiles.length &&
      (!changedFiles.includes("site/data/Item.json") ||
        !changedFiles.includes("site/sw.js"))
    ) {
      throw new AutomationError("Item.jsonまたはsw.jsが更新されていません", {
        phase,
        code: "REQUIRED_CHANGES_MISSING",
        detail: changedFiles.join("\n"),
      });
    }
    if (!changedFiles.length) {
      state = savePublicationState(statePath, state, {
        status: "published",
        completedAt: jstTimestamp(),
        changedFiles,
      });
      await notifySafely({
        webhookUrl: config.discordWebhookUrl,
        content: buildSuccessNotification({
          version,
          commitSha: null,
          deploymentUrl: null,
          changedFiles,
        }),
        logger,
        fetchImpl,
      });
      return {
        status: "published",
        commitSha: null,
        deploymentUrl: null,
        changedFiles,
      };
    }

    phase = "commit";
    await run("git", ["add", "--", ...changedFiles], {
      cwd: repositoryRoot,
      logger,
    });
    await run("git", ["diff", "--cached", "--check"], {
      cwd: repositoryRoot,
      logger,
    });
    await run(
      "git",
      [
        "commit",
        "-m",
        `Update Lodestone data to ${version.replace(/[^A-Za-z0-9._-]/gu, "-")}`,
      ],
      {
        cwd: repositoryRoot,
        logger,
        timeoutMs: 10 * 60 * 1000,
      },
    );
    const commitSha = await commandText(run, "git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      logger,
    });
    state = savePublicationState(statePath, state, {
      status: "committed",
      commitSha,
      changedFiles,
      committedAt: jstTimestamp(),
    });
    generated = false;
    return runAutomaticPublication({
      config,
      current,
      repositoryRoot,
      statePath,
      logger,
      run,
      delay,
      fetchImpl,
      lockPath,
      lockHeld: true,
    });
  } catch (sourceError) {
    const error =
      sourceError instanceof AutomationError
        ? sourceError
        : new AutomationError(sourceError.message || String(sourceError), {
            phase,
            cause: sourceError,
          });
    error.phase = error.phase === "command" ? phase : error.phase || phase;
    if (generated && !["committed", "pushed"].includes(state.status))
      await rollbackAllowedFiles(run, repositoryRoot, logger);
    savePublicationState(statePath, state, {
      status:
        state.status === "committed" || state.status === "pushed"
          ? state.status
          : "failed",
      failedPhase: error.phase,
      errorCode: error.code,
      errorMessage: sanitizeNotificationValue(error.message),
    });
    error.discordNotified = await notifySafely({
      webhookUrl: config?.discordWebhookUrl,
      content: buildFailureNotification({
        error,
        phase: error.phase,
        version,
        logPath: logger?.runFile,
      }),
      logger,
      fetchImpl,
    });
    throw error;
  }
}

export async function notifyMonitorFailure({
  config,
  error,
  logger = createAutomationLogger(),
  fetchImpl = fetch,
}) {
  if (error?.discordNotified) throw error;
  const wrapped =
    error instanceof AutomationError
      ? error
      : new AutomationError(error?.message || String(error), {
          phase: "source",
          detail: error?.stack || error?.message,
        });
  wrapped.phase = "source";
  wrapped.discordNotified = await notifySafely({
    webhookUrl: config?.discordWebhookUrl,
    content: buildFailureNotification({
      error: wrapped,
      phase: "source",
      version: null,
      logPath: logger?.runFile,
    }),
    logger,
    fetchImpl,
  });
  throw wrapped;
}
