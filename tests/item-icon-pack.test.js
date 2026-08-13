const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const {
  HEADER_BYTES,
  MAGIC,
  cacheRequest,
  iconFileNames,
  parsePack,
  prepare,
  sha256Fallback,
  sha256FallbackAsync,
  validatePack
} = require('../site/item-icon-pack.js');

function webp(label) {
  const body = Buffer.from(label);
  const bytes = Buffer.alloc(12 + body.length);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WEBP', 8, 'ascii');
  body.copy(bytes, 12);
  return bytes;
}

function pack(images) {
  const index = Buffer.alloc(images.length * 4);
  images.forEach((image, position) => index.writeUInt32LE(image.length, position * 4));
  const body = Buffer.concat([index, ...images]);
  const header = Buffer.alloc(HEADER_BYTES);
  header.write(MAGIC, 0, 'ascii');
  header.writeUInt32LE(images.length, 8);
  header.writeUInt32LE(HEADER_BYTES, 12);
  crypto.createHash('sha256').update(body).digest().copy(header, 16);
  return Buffer.concat([header, body]);
}

function packVersion(bytes) {
  return bytes.subarray(16, 48).toString('hex');
}

test('Item.jsonの初出順を保ちつつ重複IconFileを一件へまとめる', () => {
  assert.deepEqual(iconFileNames({ Items: [
    { IconFile: 'b.webp' }, { IconFile: 'a.webp' }, { IconFile: 'b.webp' }, {}
  ] }), ['b.webp', 'a.webp']);
});

test('パック索引は要求されたWebP範囲だけを返す', async () => {
  const files = ['b.webp', 'a.webp'];
  const images = [webp('first'), webp('second')];
  const bytes = pack(images);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const parsed = parsePack(buffer, files);
  assert.equal(parsed.entries.get('b.webp').length, images[0].length);
  assert.equal(parsed.entries.get('a.webp').length, images[1].length);
  const validated = await validatePack(buffer, files, crypto.webcrypto);
  assert.equal(validated.size, 2);
});

test('内容が破損したパックをハッシュ検証で拒否する', async () => {
  const bytes = pack([webp('valid')]);
  bytes[bytes.length - 1] ^= 0xff;
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  await assert.rejects(validatePack(buffer, ['a.webp'], crypto.webcrypto), /内容ハッシュ/u);
});

test('Web CryptoがないLAN環境でも同じSHA-256で画像パックを検証する', async () => {
  const source = new TextEncoder().encode('abc');
  assert.equal(
    sha256Fallback(source.buffer),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
  const bytes = pack([webp('fallback')]);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const validated = await validatePack(buffer, ['a.webp'], null);
  assert.equal(validated.has('a.webp'), true);
});

test('Web Cryptoがない実サイズ相当の検証は主スレッドへ定期的に制御を返す', async () => {
  const source = new Uint8Array(2 * 1024 * 1024);
  source.fill(0x5a);
  let yields = 0;
  const actual = await sha256FallbackAsync(source.buffer, {
    blockBatchSize: 1024,
    yieldTask: async () => { yields += 1; }
  });
  const expected = crypto.createHash('sha256').update(source).digest('hex');
  assert.equal(actual, expected);
  assert.ok(yields > 1);
});

test('永続ストレージが使えなくても展開済みパックをメモリで利用する', async () => {
  const packed = pack([webp('memory')]);
  const prepared = await prepare({
    document: { Items: [{ IconFile: 'a.webp' }] },
    dataVersion: 'data-memory',
    packVersion: packVersion(packed),
    cacheStorage: null,
    indexedDBApi: null,
    fetchImpl: async () => new Response(zlib.gzipSync(packed), { status: 200 }),
    cryptoApi: null,
    additionalFiles: [],
    DecompressionStreamClass: DecompressionStream
  });
  assert.equal(prepared.has('a.webp'), true);
  prepared.close();
});

test('破損キャッシュを破棄しgzipをno-storeで再取得して展開済みパックだけを保存する', async () => {
  const files = ['a.webp'];
  const document = { Items: files.map(IconFile => ({ IconFile })) };
  const packed = pack([webp('fresh')]);
  const responses = new Map();
  const version = packVersion(packed);
  const requestUrl = cacheRequest('data-v1', version).url;
  responses.set(requestUrl, new Response(new Uint8Array([1, 2, 3])));
  responses.set('http://localhost/assets/item-icons/aaa/old.webp', new Response(webp('old')));
  const cache = {
    async match(request) { return responses.get(request.url)?.clone(); },
    async put(request, response) { responses.set(request.url, response.clone()); },
    async delete(request) { return responses.delete(typeof request === 'string' ? request : request.url); },
    async keys() { return [...responses.keys()].map(url => new Request(url)); }
  };
  const calls = [];
  const prepared = await prepare({
    document,
    dataVersion: 'data-v1',
    packVersion: version,
    cacheStorage: { open: async () => cache },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(zlib.gzipSync(packed), { status: 200 });
    },
    cryptoApi: crypto.webcrypto,
    additionalFiles: [],
    DecompressionStreamClass: DecompressionStream
  });
  assert.equal(prepared.has('a.webp'), true);
  assert.deepEqual(calls, [{ url: './data/item-icons.pack.gz', options: { cache: 'no-store' } }]);
  assert.deepEqual([...responses.keys()], [requestUrl]);
  assert.equal((await responses.get(requestUrl).arrayBuffer()).byteLength, packed.length);
  prepared.close();
});

test('公開版キーが一致する展開済みキャッシュは全体SHA-256を繰り返さない', async () => {
  const packed = pack([webp('cached')]);
  const version = packVersion(packed);
  const request = cacheRequest('data-cached', version);
  const cache = {
    async match(candidate) {
      return candidate.url === request.url ? new Response(packed) : undefined;
    },
    async keys() { return [request]; },
    async delete() { return true; }
  };
  const prepared = await prepare({
    document: { Items: [{ IconFile: 'a.webp' }] },
    dataVersion: 'data-cached',
    packVersion: version,
    cacheStorage: { open: async () => cache },
    fetchImpl: async () => { throw new Error('再取得してはならない'); },
    cryptoApi: { subtle: { digest: async () => { throw new Error('再検証してはならない'); } } },
    additionalFiles: []
  });
  assert.equal(prepared.has('a.webp'), true);
  prepared.close();
});
