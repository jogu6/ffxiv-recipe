import test from 'node:test';
import assert from 'node:assert/strict';
import { validateScreenshots, MAX_SCREENSHOT_BYTES } from '../web/report-attachments.js';
import worker from '../../workers/bug-report/worker.mjs';

const png = () => new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'original-private-name.png', { type: 'image/png' });
const webp = () => new File(['RIFF1234WEBP'], 'image.webp', { type: 'image/webp' });

test('添付の枚数・合計容量・形式を検証する', async () => {
  assert.equal(await validateScreenshots([]), '');
  assert.equal(await validateScreenshots([png(), webp()]), '');
  assert.match(await validateScreenshots(Array.from({ length: 5 }, png)), /4枚/);
  assert.match(await validateScreenshots([new File([], 'empty.png', { type: 'image/png' })]), /形式/);
  assert.match(await validateScreenshots([new File(['<svg/>'], 'fake.png', { type: 'image/png' })]), /一致しません/);
  assert.match(await validateScreenshots([new File(['GIF89a'], 'image.gif', { type: 'image/gif' })]), /形式/);
  assert.match(await validateScreenshots([{ size: MAX_SCREENSHOT_BYTES + 1 }]), /8MiB/);
});

test('Workerは任意画像を本文と一緒に転送し、不正な添付を送らない', async () => {
  const original = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (_, options) => { sent.push(options.body); return new Response('{}'); };
  const env = { DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/123/test-secret',
    REPORT_LIMITER: { limit: async () => ({ success: true }) } };
  const request = (files, diagnostics = '【左パネル】\n検索条件', extra = null) => {
    const form = new FormData();
    form.set('description', 'お問い合わせ本文');
    form.set('diagnostics', diagnostics);
    files.forEach(file => form.append('screenshots', file));
    if (extra) form.append('description', extra);
    return new Request('https://worker.example/', { method: 'POST',
      headers: { Origin: 'https://jogu6.github.io' }, body: form });
  };
  try {
    assert.equal((await worker.fetch(request([png(), webp()]), env)).status, 200);
    assert.equal(sent.length, 1);
    const metadata = JSON.parse(sent[0].get('payload_json'));
    assert.deepEqual(metadata.attachments.map(item => item.filename), ['bug-report.txt', 'screenshot-1.png', 'screenshot-2.webp']);
    assert.match(await sent[0].get('files[0]').text(), /お問い合わせ本文/);
    assert.equal(sent[0].get('files[1]').type, 'image/png');
    assert.equal(await sent[0].get('files[2]').text(), 'RIFF1234WEBP');
    const count = sent.length;
    assert.equal((await worker.fetch(request(Array.from({ length: 5 }, png)), env)).status, 400);
    assert.equal((await worker.fetch(request([new File(['<svg/>'], 'fake.png', { type: 'image/png' })]), env)).status, 400);
    assert.equal((await worker.fetch(request(['not a file']), env)).status, 400);
    assert.equal((await worker.fetch(request([png()], 'a'.repeat(81 * 1024)), env)).status, 400);
    assert.equal((await worker.fetch(request([png()], '診断', 'duplicate'), env)).status, 400);
    const tooLarge = new File([new Uint8Array(MAX_SCREENSHOT_BYTES + 1)], 'large.png', { type: 'image/png' });
    assert.equal((await worker.fetch(request([tooLarge]), env)).status, 413);
    assert.equal(sent.length, count);
  } finally { globalThis.fetch = original; }
});
