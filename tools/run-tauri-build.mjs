import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export function rustToolchainBin(sysroot, host) {
  return path.join(sysroot, "lib", "rustlib", host, "bin");
}

export function createTauriBuildEnvironment({
  baseEnv = process.env,
  mode = "check",
  sysroot,
  host,
  hasRustLld = false,
  hasSccache = false,
  sccacheExecutable = "sccache",
}) {
  const useSccache = hasSccache && ["exe", "bundle", "timings"].includes(mode);
  const env = { ...baseEnv };
  if (hasRustLld) {
    const bin = rustToolchainBin(sysroot, host);
    env.PATH = `${bin}${path.delimiter}${env.PATH || ""}`;
    env.RUSTFLAGS = [env.RUSTFLAGS, "-C linker=rust-lld.exe"]
      .filter(Boolean)
      .join(" ");
  }
  if (useSccache && !env.RUSTC_WRAPPER) {
    env.RUSTC_WRAPPER = sccacheExecutable;
    env.SCCACHE_IGNORE_SERVER_IO_ERROR ??= "1";
  }
  return env;
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

function findSccacheExecutable(baseEnv = process.env) {
  if (
    spawnSync("sccache", ["--version"], {
      env: baseEnv,
      windowsHide: true,
      stdio: "ignore",
    }).status === 0
  ) {
    return "sccache";
  }
  const packageRoot = path.join(
    baseEnv.LOCALAPPDATA || "",
    "Microsoft",
    "WinGet",
    "Packages",
  );
  if (!fs.existsSync(packageRoot)) return "";
  for (const packageName of fs.readdirSync(packageRoot)) {
    if (!packageName.startsWith("Mozilla.sccache_")) continue;
    const packageDirectory = path.join(packageRoot, packageName);
    for (const versionDirectory of fs.readdirSync(packageDirectory)) {
      const executable = path.join(
        packageDirectory,
        versionDirectory,
        "sccache.exe",
      );
      if (fs.existsSync(executable) && fs.statSync(executable).isFile()) {
        return executable;
      }
    }
  }
  return "";
}

function toolchainEnvironment(mode) {
  const sysroot = capture("rustc", ["--print", "sysroot"]);
  const version = capture("rustc", ["-vV"]);
  const host = version.match(/^host:\s*(.+)$/m)?.[1] || "";
  const bin = sysroot && host ? rustToolchainBin(sysroot, host) : "";
  const rustLld = bin ? path.join(bin, "rust-lld.exe") : "";
  const hasRustLld = Boolean(
    rustLld && fs.existsSync(rustLld) && fs.statSync(rustLld).isFile(),
  );
  const sccacheExecutable = findSccacheExecutable();
  const hasSccache = Boolean(sccacheExecutable);
  return {
    env: createTauriBuildEnvironment({
      mode,
      sysroot,
      host,
      hasRustLld,
      hasSccache,
      sccacheExecutable,
    }),
    hasRustLld,
    hasSccache,
    sccacheExecutable,
  };
}

export function commandForMode(mode) {
  if (mode === "check") {
    return {
      command: "cargo",
      args: ["check", "--manifest-path", "src-tauri/Cargo.toml"],
    };
  }
  const cli = require.resolve("@tauri-apps/cli/tauri.js");
  if (mode === "dev") return { command: process.execPath, args: [cli, "dev"] };
  if (mode === "exe")
    return { command: process.execPath, args: [cli, "build", "--no-bundle"] };
  if (mode === "bundle")
    return { command: process.execPath, args: [cli, "build"] };
  if (mode === "timings") {
    return {
      command: process.execPath,
      args: [cli, "build", "--no-bundle", "--", "--timings"],
    };
  }
  throw new Error(`Unknown Tauri build mode: ${mode}`);
}

function main() {
  const mode = process.argv[2] || "check";
  const { command, args } = commandForMode(mode);
  const { env, hasRustLld, hasSccache, sccacheExecutable } =
    toolchainEnvironment(mode);
  const usingSccache = Boolean(env.RUSTC_WRAPPER);
  console.log(
    `Tauri ${mode}: rust-lld=${hasRustLld ? "on" : "off"}, ` +
      `sccache=${usingSccache ? "on" : hasSccache ? "standby" : "off"}, ` +
      "incremental=profile",
  );
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  console.log(
    `Tauri ${mode} finished in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
  );
  if (usingSccache) {
    spawnSync(sccacheExecutable, ["--show-stats"], {
      env,
      stdio: "inherit",
      windowsHide: true,
    });
  }
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  main();
}
