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


test("Windows PATH normalization preserves existing key casing and linker precedence", () => {
  const host = "x86_64-pc-windows-msvc";
  const sysroot = "C:\\Rust";
  const bin = rustToolchainBin(sysroot, host, "win32");
  for (const key of ["Path", "PATH", "path", "pAtH"]) {
    const baseEnv = { [key]: "C:\\Cargo\\bin;C:\\Windows", RUSTFLAGS: "-C opt-level=1" };
    const env = createTauriBuildEnvironment({
      platform: "win32", baseEnv, sysroot, host, hasRustLld: true,
    });
    assert.deepEqual(Object.keys(env).filter(name => name.toUpperCase() === "PATH"), [key]);
    assert.equal(env[key], `${bin};${baseEnv[key]}`);
    assert.equal(env.RUSTFLAGS, "-C opt-level=1 -C linker=rust-lld.exe");
    assert.equal(baseEnv[key], "C:\\Cargo\\bin;C:\\Windows");
  }
});

test("Windows collapses duplicate PATH keys even without an optional linker", () => {
  for (const hasRustLld of [false, true]) {
    for (const baseEnv of [
      { PATH: "duplicate", Path: "C:\\Cargo\\bin", path: "another" },
      { Path: "C:\\Cargo\\bin", PATH: "duplicate" },
    ]) {
      const original = { ...baseEnv };
      const env = createTauriBuildEnvironment({
        platform: "win32", baseEnv, hasRustLld,
        sysroot: "C:\\Rust", host: "x86_64-pc-windows-msvc",
      });
      assert.deepEqual(Object.keys(env).filter(key => key.toUpperCase() === "PATH"), ["Path"]);
      assert.equal(env.Path, hasRustLld
        ? `${path.win32.join("C:\\Rust", "lib", "rustlib", "x86_64-pc-windows-msvc", "bin")};${baseEnv.Path}`
        : baseEnv.Path);
      assert.deepEqual(baseEnv, original);
    }
  }
});

test("Windows creates Path when missing and retains an empty existing Path", () => {
  for (const baseEnv of [{}, { Path: "", PATH: "duplicate" }]) {
    const env = createTauriBuildEnvironment({
      platform: "win32", baseEnv, sysroot: "C:\\Rust", host: "windows", hasRustLld: true,
    });
    assert.deepEqual(Object.keys(env).filter(key => key.toUpperCase() === "PATH"), ["Path"]);
    assert.equal(env.Path, `${path.win32.join("C:\\Rust", "lib", "rustlib", "windows", "bin")};`);
  }
});

test("Linux uses only uppercase PATH for linker insertion and preserves sccache overrides", () => {
  const baseEnv = { PATH: "/cargo/bin:/usr/bin", Path: "independent", RUSTFLAGS: "existing",
    RUSTC_WRAPPER: "/custom/wrapper", SCCACHE_IGNORE_SERVER_IO_ERROR: "0" };
  for (const mode of ["check", "dev", "exe", "bundle", "timings"]) {
    const env = createTauriBuildEnvironment({
      platform: "linux", baseEnv, mode, sysroot: "/rust", host: "linux",
      hasRustLld: true, hasSccache: true,
    });
    assert.equal(env.PATH, "/rust/lib/rustlib/linux/bin:/cargo/bin:/usr/bin");
    assert.equal(env.Path, "independent");
    assert.equal(env.RUSTFLAGS, "existing -C linker=rust-lld.exe");
    assert.equal(env.RUSTC_WRAPPER, "/custom/wrapper");
    assert.equal(env.SCCACHE_IGNORE_SERVER_IO_ERROR, "0");
  }
});
