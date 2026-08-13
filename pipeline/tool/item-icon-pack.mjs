import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export const JOB_ICON_PACK_NAMES = Object.freeze([
  'alchemist.webp', 'armorer.webp', 'blacksmith.webp', 'botanist.webp', 'carpenter.webp', 'culinarian.webp',
  'fisher.webp', 'goldsmith.webp', 'leatherworker.webp', 'miner.webp', 'weaver.webp'
]);

export const ITEM_ICON_PACK_MAGIC = 'XIVIPK01';
export const ITEM_ICON_PACK_HEADER_BYTES = 48;

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest();
}

function writeBytesAtomic(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(temporary, bytes);
  fs.renameSync(temporary, file);
}

export function iconFileNames(document) {
  const items = Array.isArray(document) ? document : document?.Items;
  if (!Array.isArray(items)) throw new TypeError('Item.json must contain an item array.');
  return [...new Set(items.map(item => item?.IconFile).filter(Boolean))];
}

function itemArray(document) {
  const items = Array.isArray(document) ? document : document?.Items;
  if (!Array.isArray(items)) throw new TypeError('Item.json must contain an item array.');
  return items;
}

function itemIconFileName(itemName, webpBytes) {
  const nameHash = crypto.createHash('sha256').update(String(itemName || ''), 'utf8').digest('hex').slice(0, 20);
  const contentHash = crypto.createHash('sha256').update(webpBytes).digest('hex').slice(0, 12);
  return `${nameHash}-${contentHash}.webp`;
}

function validateWebp(key, bytes) {
  if (bytes.length < 12 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error(`Invalid WebP item icon: ${key}`);
  }
}

export function parseItemIconPack({ document, bytes, additionalKeys = [] }) {
  const source = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (source.length < ITEM_ICON_PACK_HEADER_BYTES) throw new Error('Item icon pack header is incomplete.');
  if (source.toString('ascii', 0, 8) !== ITEM_ICON_PACK_MAGIC) throw new Error('Invalid item icon pack magic.');
  const files = [...iconFileNames(document), ...additionalKeys];
  const count = source.readUInt32LE(8);
  const bodyOffset = source.readUInt32LE(12);
  if (count !== files.length) throw new Error(`Item icon pack count mismatch: ${count} / ${files.length}`);
  if (bodyOffset !== ITEM_ICON_PACK_HEADER_BYTES) throw new Error(`Invalid item icon pack body offset: ${bodyOffset}`);
  const body = source.subarray(bodyOffset);
  const expectedHash = source.subarray(16, 48);
  const actualHash = sha256(body);
  if (!actualHash.equals(expectedHash)) throw new Error('Item icon pack body hash mismatch.');
  const indexBytes = count * 4;
  if (body.length < indexBytes) throw new Error('Item icon pack index is incomplete.');
  const entries = new Map();
  let offset = indexBytes;
  files.forEach((file, index) => {
    const length = body.readUInt32LE(index * 4);
    const end = offset + length;
    if (length < 1 || end > body.length) throw new Error(`Invalid item icon pack range: ${file}`);
    const image = body.subarray(offset, end);
    validateWebp(file, image);
    entries.set(file, image);
    offset = end;
  });
  if (offset !== body.length) throw new Error('Item icon pack has trailing bytes.');
  return { bodyHash: expectedHash.toString('hex'), entries, files };
}

export function validateItemIconPack({ document, bytes, additionalKeys = [] }) {
  const parsed = parseItemIconPack({ document, bytes, additionalKeys });
  const names = new Set();
  const owners = new Map();
  for (const item of itemArray(document)) {
    if (!item?.Name || names.has(item.Name)) throw new Error(`Invalid or duplicate item name: ${item?.Name || '(empty)'}`);
    names.add(item.Name);
    if (!item.IconFile) continue;
    const image = parsed.entries.get(item.IconFile);
    if (!image) throw new Error(`Missing packed item icon: ${item.Name} ${item.IconFile}`);
    if (itemIconFileName(item.Name, image) !== item.IconFile) {
      throw new Error(`Packed item icon filename mismatch: ${item.Name} ${item.IconFile}`);
    }
    const owner = owners.get(item.IconFile);
    if (owner && owner !== item.Name) throw new Error(`Duplicate packed item icon: ${owner} / ${item.Name}`);
    owners.set(item.IconFile, item.Name);
  }
  return { ...parsed, items: names.size, icons: owners.size };
}

export function extractItemIconPack({ document, bytes, iconsRoot, additionalKeys = [] }) {
  const parsed = validateItemIconPack({ document, bytes, additionalKeys });
  let written = 0;
  let reused = 0;
  for (const file of iconFileNames(document)) {
    const image = parsed.entries.get(file);
    const target = path.join(iconsRoot, file.slice(0, 3), file);
    if (fs.existsSync(target) && fs.readFileSync(target).equals(image)) {
      reused += 1;
      continue;
    }
    writeBytesAtomic(target, image);
    written += 1;
  }
  return { bodyHash: parsed.bodyHash, icons: parsed.icons, reused, written };
}

export function createItemIconPack({ document, iconsRoot, additionalFiles = [] }) {
  const itemFiles = iconFileNames(document);
  const sources = [
    ...itemFiles.map(file => ({ key: file, source: path.join(iconsRoot, file.slice(0, 3), file) })),
    ...additionalFiles
  ];
  const files = sources.map(entry => entry.key);
  if (new Set(files).size !== files.length) throw new Error('Duplicate icon pack key.');
  const images = sources.map(({ key, source }) => {
    if (!fs.existsSync(source)) throw new Error(`Missing item icon: ${key}`);
    const bytes = fs.readFileSync(source);
    validateWebp(key, bytes);
    return bytes;
  });
  const indexBytes = files.length * 4;
  const body = Buffer.allocUnsafe(indexBytes + images.reduce((total, bytes) => total + bytes.length, 0));
  let imageOffset = indexBytes;
  images.forEach((bytes, index) => {
    body.writeUInt32LE(bytes.length, index * 4);
    bytes.copy(body, imageOffset);
    imageOffset += bytes.length;
  });
  const header = Buffer.alloc(ITEM_ICON_PACK_HEADER_BYTES);
  header.write(ITEM_ICON_PACK_MAGIC, 0, 'ascii');
  header.writeUInt32LE(files.length, 8);
  header.writeUInt32LE(ITEM_ICON_PACK_HEADER_BYTES, 12);
  sha256(body).copy(header, 16);
  return { files, bytes: Buffer.concat([header, body]) };
}

export function buildItemIconPack({ itemJsonPath, iconsRoot, outputPath, additionalFiles = [] }) {
  const document = JSON.parse(fs.readFileSync(itemJsonPath, 'utf8'));
  const pack = createItemIconPack({ document, iconsRoot, additionalFiles });
  const compressed = zlib.gzipSync(pack.bytes, { level: 9, mtime: 0 });
  writeBytesAtomic(outputPath, compressed);
  return {
    count: pack.files.length,
    bytes: pack.bytes.length,
    bodyHash: pack.bytes.subarray(16, 48).toString('hex'),
    compressedBytes: compressed.length,
    sha256: crypto.createHash('sha256').update(pack.bytes).digest('hex')
  };
}
