import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  commandForMode,
  createTauriBuildEnvironment,
  rustToolchainBin,
} from "../tools/run-tauri-build.mjs";

test("Tauri build modes separate checks, exe generation, and installer bundling", () => {
  assert.deepEqual(commandForMode("check"), {
    command: "cargo",
    args: ["check", "--manifest-path", "src-tauri/Cargo.toml"],
  });
  assert.ok(commandForMode("dev").args.includes("dev"));
  assert.ok(commandForMode("exe").args.includes("--no-bundle"));
  assert.equal(commandForMode("bundle").args.includes("--no-bundle"), false);
  assert.ok(commandForMode("timings").args.includes("--timings"));
  assert.throws(() => commandForMode("unknown"), /Unknown Tauri build mode/);
});

test("release builds use sccache without overriding Cargo profiles", () => {
  const sysroot = path.join("C:", "rust");
  const host = "x86_64-pc-windows-msvc";
  const env = createTauriBuildEnvironment({
    baseEnv: { PATH: "base" },
    mode: "exe",
    sysroot,
    host,
    hasRustLld: true,
    hasSccache: true,
    sccacheExecutable: "C:\\tools\\sccache.exe",
  });
  assert.equal(env.CARGO_INCREMENTAL, undefined);
  assert.match(env.RUSTFLAGS, /linker=rust-lld\.exe/);
  assert.equal(env.RUSTC_WRAPPER, "C:\\tools\\sccache.exe");
  assert.equal(env.SCCACHE_IGNORE_SERVER_IO_ERROR, "1");
  assert.ok(env.PATH.startsWith(rustToolchainBin(sysroot, host)));
});

test("development checks leave acceleration policy to the dev profile", () => {
  const env = createTauriBuildEnvironment({
    baseEnv: { PATH: "base" },
    mode: "check",
    sysroot: "",
    host: "",
    hasRustLld: false,
    hasSccache: true,
  });
  assert.equal(env.CARGO_INCREMENTAL, undefined);
  assert.equal(env.RUSTFLAGS, undefined);
  assert.equal(env.RUSTC_WRAPPER, undefined);
  assert.equal(env.PATH, "base");
});

test("release builds do not require unavailable optional tools", () => {
  const env = createTauriBuildEnvironment({
    baseEnv: { PATH: "base" },
    mode: "bundle",
    sysroot: "",
    host: "",
    hasRustLld: false,
    hasSccache: false,
  });
  assert.equal(env.CARGO_INCREMENTAL, undefined);
  assert.equal(env.RUSTC_WRAPPER, undefined);
});
