import fs from "node:fs";
import path from "node:path";

export function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

export function readJson(filePath, fallback = undefined) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (fallback !== undefined && error.code === "ENOENT") return fallback;
    throw error;
  }
}

export function writeJsonAtomic(filePath, value) {
  ensureDirectory(path.dirname(filePath));
  writeAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeTextAtomic(filePath, value) {
  ensureDirectory(path.dirname(filePath));
  writeAtomic(filePath, value);
}

let temporarySequence = 0;

function writeAtomic(filePath, value) {
  temporarySequence += 1;
  const temporaryPath = `${filePath}.${process.pid}.${temporarySequence}.tmp`;
  fs.writeFileSync(temporaryPath, value, "utf8");
  try {
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    // Windows can reject rename-over-existing while another process briefly has
    // the destination open. State files are recoverable, so replace explicitly.
    if (!["EEXIST", "EPERM"].includes(error.code)) throw error;
    fs.rmSync(filePath, { force: true });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}
