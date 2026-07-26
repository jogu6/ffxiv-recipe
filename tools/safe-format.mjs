import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import prettier from "prettier";

const MAX_CHANGED_LINES = 200;
const MAX_CHANGED_RATIO = 0.25;
const workspace = process.cwd();

function fail(message) {
  console.error(`safe-format: ${message}`);
  process.exitCode = 1;
}

function normalizedWorkspacePath(input) {
  const absolute = resolve(workspace, input);
  const inside = relative(workspace, absolute);
  if (!inside || inside.startsWith("..") || isAbsolute(inside)) {
    throw new Error(
      `ワークスペース内の明示的なファイルを指定してください: ${input}`,
    );
  }
  if (!statSync(absolute).isFile())
    throw new Error(`ファイルではありません: ${input}`);
  return { absolute, display: inside };
}

function diffSize(before, after, extension) {
  const directory = mkdtempSync(resolve(tmpdir(), "ffxiv-safe-format-"));
  const beforePath = resolve(directory, `before${extension}`);
  const afterPath = resolve(directory, `after${extension}`);
  try {
    writeFileSync(beforePath, before, "utf8");
    writeFileSync(afterPath, after, "utf8");
    let output = "";
    try {
      output = execFileSync(
        "git",
        ["diff", "--no-index", "--numstat", "--", beforePath, afterPath],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        },
      );
    } catch (error) {
      if (error.status !== 1) throw error;
      output = String(error.stdout || "");
    }
    const [added = "0", removed = "0"] = output.trim().split(/\s+/);
    return Number(added) + Number(removed);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function usesCrLf(source) {
  return source.includes("\r\n");
}

function exceedsDiffBudget(changedLines, sourceLines) {
  return (
    changedLines > MAX_CHANGED_LINES ||
    changedLines / Math.max(1, sourceLines) > MAX_CHANGED_RATIO
  );
}

function isTracked(display) {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", "--", display], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

async function formatFile(input, { write, allowLargeDiff }) {
  const { absolute, display } = normalizedWorkspacePath(input);
  const source = readFileSync(absolute, "utf8");
  const crlf = usesCrLf(source);
  const formatted = await prettier.format(source, {
    filepath: absolute,
    endOfLine: crlf ? "crlf" : "lf",
  });
  const changedLines = diffSize(
    source,
    formatted,
    `.${basename(absolute).split(".").pop()}`,
  );
  const sourceLines = Math.max(1, source.split(/\r?\n/).length);
  const changedRatio = changedLines / sourceLines;

  if (changedLines === 0) {
    console.log(`${display}: 変更なし`);
    return;
  }
  if (
    isTracked(display) &&
    !allowLargeDiff &&
    exceedsDiffBudget(changedLines, sourceLines)
  ) {
    throw new Error(
      `${display}: ${changedLines}行（${Math.round(changedRatio * 100)}%）の変更を拒否しました。` +
        " 大規模整形にはユーザーの明示許可と --allow-large-diff が必要です。",
    );
  }
  if (!write) {
    throw new Error(
      `${display}: ${changedLines}行の整形差分があります。書き込みには --write を指定してください。`,
    );
  }

  writeFileSync(absolute, formatted, "utf8");
  console.log(
    `${display}: ${changedLines}行を整形（改行コード維持: ${crlf ? "CRLF" : "LF"}）`,
  );
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const allowLargeDiff = args.includes("--allow-large-diff");
  const files = args.filter((arg) => !arg.startsWith("--"));
  if (files.length === 0) {
    fail("対象ファイルを明示してください。例: npm run format -- site/app.js");
    return;
  }

  for (const file of files) await formatFile(file, { write, allowLargeDiff });
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => fail(error.message));
}

export { diffSize, exceedsDiffBudget, usesCrLf };
