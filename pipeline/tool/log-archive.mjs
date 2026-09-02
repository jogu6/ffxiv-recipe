#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import zlib from "node:zlib";

const repositoryRoot = path.resolve(import.meta.dirname, "..", "..");
const defaultLogsRoot = path.join(repositoryRoot, "pipeline", "logs");
const utf8Flag = 0x0800;

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1)
    crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  return crc >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const value of buffer)
    crc = (crc >>> 8) ^ crcTable[(crc ^ value) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function zipDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      Math.floor(date.getSeconds() / 2),
  };
}

function createZip(entries, date = new Date()) {
  const localParts = [];
  const centralParts = [];
  const stamp = zipDateTime(date);
  let offset = 0;

  for (const [name, content] of [...entries].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const nameBuffer = Buffer.from(name.replaceAll("\\", "/"), "utf8");
    const source = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const deflated = zlib.deflateRawSync(source);
    const compressed = deflated.length < source.length ? deflated : source;
    const method = compressed === source ? 0 : 8;
    const checksum = crc32(source);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(utf8Flag, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(source.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuffer, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(utf8Flag, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(source.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + compressed.length;
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce(
    (total, part) => total + part.length,
    0,
  );
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.size, 8);
  end.writeUInt16LE(entries.size, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

function readZip(buffer) {
  const entries = new Map();
  let offset = 0;
  while (
    offset + 4 <= buffer.length &&
    buffer.readUInt32LE(offset) === 0x04034b50
  ) {
    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    const expectedCrc = buffer.readUInt32LE(offset + 14);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const sourceSize = buffer.readUInt32LE(offset + 22);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    if (flags & 0x0008)
      throw new Error("データ記述子付きZIPには対応していません");
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) throw new Error("ZIPが途中で切れています");
    const name = buffer
      .subarray(nameStart, nameStart + nameLength)
      .toString(flags & utf8Flag ? "utf8" : "latin1");
    const compressed = buffer.subarray(dataStart, dataEnd);
    const source =
      method === 0
        ? Buffer.from(compressed)
        : method === 8
          ? zlib.inflateRawSync(compressed)
          : null;
    if (!source) throw new Error(`未対応のZIP圧縮方式です: ${method}`);
    if (source.length !== sourceSize || crc32(source) !== expectedCrc)
      throw new Error(`ZIP検証に失敗しました: ${name}`);
    entries.set(name, source);
    offset = dataEnd;
  }
  return entries;
}

function replaceFileAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  const backup = `${file}.${process.pid}.bak`;
  fs.writeFileSync(temporary, content);
  let movedOriginal = false;
  try {
    if (fs.existsSync(file)) {
      fs.renameSync(file, backup);
      movedOriginal = true;
    }
    fs.renameSync(temporary, file);
    if (movedOriginal) fs.rmSync(backup);
  } catch (error) {
    if (!fs.existsSync(file) && movedOriginal && fs.existsSync(backup))
      fs.renameSync(backup, file);
    if (fs.existsSync(temporary)) fs.rmSync(temporary);
    throw error;
  }
}

function writeVerifiedZip(file, entries, now) {
  const content = createZip(entries, now);
  const verified = readZip(content);
  if (verified.size !== entries.size)
    throw new Error(`ZIP項目数の検証に失敗しました: ${file}`);
  for (const [name, source] of entries) {
    if (!verified.get(name)?.equals(source))
      throw new Error(`ZIP内容の検証に失敗しました: ${name}`);
  }
  replaceFileAtomic(file, content);
  readZip(fs.readFileSync(file));
}

function jstMonth(date) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 7);
}

function runMonthFromName(name) {
  const match = /^(\d{13})-/.exec(name);
  if (!match) return null;
  const date = new Date(Number(match[1]));
  return Number.isNaN(date.getTime()) ? null : jstMonth(date);
}

function monitorMonth(line) {
  return /^\[(\d{4}-\d{2})-\d{2}T/.exec(line)?.[1] ?? null;
}

function mergeMonitorContent(existing, added) {
  const lines = new Set(`${existing}${added}`.split(/(?<=\n)/).filter(Boolean));
  return Buffer.from([...lines].sort().join(""), "utf8");
}

function existingMonthlyEntries(month, monthlyFile, yearlyRoot) {
  if (fs.existsSync(monthlyFile)) return readZip(fs.readFileSync(monthlyFile));
  const yearlyFile = path.join(yearlyRoot, `${month.slice(0, 4)}.zip`);
  if (!fs.existsSync(yearlyFile)) return new Map();
  const embedded = readZip(fs.readFileSync(yearlyFile)).get(
    `monthly/${month}.zip`,
  );
  return embedded ? readZip(embedded) : new Map();
}

export function archivePipelineLogs({
  logsRoot = defaultLogsRoot,
  now = new Date(),
} = {}) {
  const currentMonth = jstMonth(now);
  const currentYear = currentMonth.slice(0, 4);
  const runsRoot = path.join(logsRoot, "runs");
  const monitorFile = path.join(logsRoot, "lodestone-monitor.txt");
  const latestFile = path.join(logsRoot, "latest.log");
  const monthlyRoot = path.join(logsRoot, "archive", "monthly");
  const yearlyRoot = path.join(logsRoot, "archive", "yearly");
  const monthly = new Map();
  const archivedRunFiles = [];

  const runFiles = fs.existsSync(runsRoot)
    ? fs
        .readdirSync(runsRoot, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort()
    : [];
  for (const name of runFiles) {
    const month = runMonthFromName(name);
    if (!month || month >= currentMonth) continue;
    if (!monthly.has(month)) monthly.set(month, { runs: [], monitor: "" });
    monthly.get(month).runs.push(name);
    archivedRunFiles.push(name);
  }

  const retainedMonitorLines = [];
  if (fs.existsSync(monitorFile)) {
    for (const line of fs
      .readFileSync(monitorFile, "utf8")
      .split(/(?<=\n)/)
      .filter(Boolean)) {
      const month = monitorMonth(line);
      if (!month || month >= currentMonth) {
        retainedMonitorLines.push(line);
        continue;
      }
      if (!monthly.has(month)) monthly.set(month, { runs: [], monitor: "" });
      monthly.get(month).monitor += line;
    }
  }

  const monthlyFiles = [];
  for (const [month, source] of [...monthly].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const archiveFile = path.join(monthlyRoot, `${month}.zip`);
    const entries = existingMonthlyEntries(month, archiveFile, yearlyRoot);
    for (const name of source.runs) {
      const content = fs.readFileSync(path.join(runsRoot, name));
      const entryName = `runs/${name}`;
      if (entries.has(entryName) && !entries.get(entryName).equals(content))
        throw new Error(`同名ログの内容が異なります: ${name}`);
      entries.set(entryName, content);
    }
    if (source.monitor) {
      entries.set(
        "lodestone-monitor.txt",
        mergeMonitorContent(
          entries.get("lodestone-monitor.txt") ?? Buffer.alloc(0),
          source.monitor,
        ),
      );
    }
    writeVerifiedZip(archiveFile, entries, now);
    monthlyFiles.push(archiveFile);
  }

  const archivedNames = new Set(archivedRunFiles);
  const retainedRuns = runFiles.filter((name) => !archivedNames.has(name));
  const latestContent = Buffer.concat(
    retainedRuns.map((name) => fs.readFileSync(path.join(runsRoot, name))),
  );
  replaceFileAtomic(latestFile, latestContent);
  replaceFileAtomic(
    monitorFile,
    Buffer.from(retainedMonitorLines.join(""), "utf8"),
  );
  for (const name of archivedRunFiles) fs.rmSync(path.join(runsRoot, name));

  const yearlyFiles = [];
  if (fs.existsSync(monthlyRoot)) {
    const byYear = new Map();
    for (const name of fs
      .readdirSync(monthlyRoot)
      .filter((name) => /^\d{4}-\d{2}\.zip$/.test(name))) {
      const year = name.slice(0, 4);
      if (year >= currentYear) continue;
      if (!byYear.has(year)) byYear.set(year, []);
      byYear.get(year).push(name);
    }
    for (const [year, names] of byYear) {
      const yearlyFile = path.join(yearlyRoot, `${year}.zip`);
      const entries = fs.existsSync(yearlyFile)
        ? readZip(fs.readFileSync(yearlyFile))
        : new Map();
      for (const name of names.sort())
        entries.set(
          `monthly/${name}`,
          fs.readFileSync(path.join(monthlyRoot, name)),
        );
      writeVerifiedZip(yearlyFile, entries, now);
      for (const name of names) fs.rmSync(path.join(monthlyRoot, name));
      yearlyFiles.push(yearlyFile);
    }
  }

  return {
    currentMonth,
    monthlyArchives: monthlyFiles.map((file) => path.relative(logsRoot, file)),
    yearlyArchives: yearlyFiles.map((file) => path.relative(logsRoot, file)),
    archivedRunFiles: archivedRunFiles.length,
    archivedMonitorLines: [...monthly.values()].reduce(
      (total, value) =>
        total + value.monitor.split("\n").filter(Boolean).length,
      0,
    ),
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
) {
  try {
    console.log(JSON.stringify(archivePipelineLogs(), null, 2));
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}
