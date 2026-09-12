import { MAX_SCREENSHOT_BYTES, validateScreenshots, screenshotName } from '../../macro-app/web/report-attachments.js';
const TEXT_BODY_LIMIT = 96 * 1024;
const BODY_LIMIT = MAX_SCREENSHOT_BYTES + TEXT_BODY_LIMIT;
function validateReport(value) {
  return value && typeof value.description === 'string' && value.description.trim().length > 0
    && Array.from(value.description).length <= 1000
    && typeof value.diagnostics === 'string' && value.diagnostics.trim().length > 0
    && new TextEncoder().encode(value.diagnostics).length <= 80 * 1024;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || 'https://jogu6.github.io').split(',').map(x => x.trim());
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Origin' };
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });
    if (!allowed.includes(origin)) return reply(403, { ok: false });
    headers['Access-Control-Allow-Origin'] = origin;
    if (request.method === 'OPTIONS') {
      headers['Access-Control-Allow-Methods'] = 'POST';
      headers['Access-Control-Allow-Headers'] = 'Content-Type';
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== 'POST') return reply(405, { ok: false });
    const contentType = request.headers.get('Content-Type') || '';
    const multipart = contentType.startsWith('multipart/form-data;');
    if (!multipart && !contentType.startsWith('application/json')) return reply(415, { ok: false });
    if (!env.REPORT_LIMITER || !env.DISCORD_WEBHOOK_URL) return reply(503, { ok: false, code: 'missing_configuration' });
    let webhook;
    try {
      webhook = new URL(String(env.DISCORD_WEBHOOK_URL).trim());
      if (webhook.protocol !== 'https:' || !['discord.com', 'discordapp.com', 'canary.discord.com', 'ptb.discord.com'].includes(webhook.hostname)
        || webhook.username || webhook.password || webhook.port) return reply(503, { ok: false, code: 'invalid_webhook' });
      const match = webhook.pathname.match(/^\/api\/(?:v\d+\/)?webhooks\/(\d+)\/([A-Za-z0-9_-]+)\/?$/);
      if (!match) return reply(503, { ok: false, code: 'invalid_webhook' });
      // Normalize legacy host/version URLs without following redirects carrying the token.
      webhook.hostname = 'discord.com';
      webhook.pathname = `/api/webhooks/${match[1]}/${match[2]}`;
      webhook.hash = '';
      webhook.searchParams.set('wait', 'true');
    } catch { return reply(503, { ok: false, code: 'invalid_webhook' }); }
    // IP is used only for rate limiting; it is never included in the Discord report.
    const limit = await env.REPORT_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') || 'unknown' });
    if (!limit.success) return reply(429, { ok: false });
    let payload;
    let screenshots = [];
    try {
      const bodyLimit = multipart ? BODY_LIMIT : TEXT_BODY_LIMIT;
      if (Number(request.headers.get('Content-Length')) > bodyLimit) return reply(413, { ok: false });
      const reader = request.body?.getReader();
      if (!reader) return reply(400, { ok: false });
      const chunks = []; let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > bodyLimit) { await reader.cancel(); return reply(413, { ok: false }); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      if (multipart) {
        const form = await new Response(bytes, { headers: { 'Content-Type': contentType } }).formData();
        if ([...form.keys()].some(key => !['description', 'diagnostics', 'screenshots'].includes(key))
          || form.getAll('description').length !== 1 || form.getAll('diagnostics').length !== 1) {
          return reply(400, { ok: false });
        }
        payload = { description: form.get('description'), diagnostics: form.get('diagnostics') };
        screenshots = form.getAll('screenshots');
        if (screenshots.some(file => typeof file === 'string')) return reply(400, { ok: false });
        if (screenshots.reduce((sum, file) => sum + file.size, 0) > MAX_SCREENSHOT_BYTES) return reply(413, { ok: false });
        if (await validateScreenshots(screenshots)) return reply(400, { ok: false });
      } else payload = JSON.parse(new TextDecoder().decode(bytes));
    } catch { return reply(400, { ok: false }); }
    if (!validateReport(payload)) return reply(400, { ok: false });
    try {
      const form = new FormData();
      form.set('payload_json', JSON.stringify({
        content: '不具合・その他お問い合わせが届きました。本文と診断情報は添付テキストをご確認ください。',
        allowed_mentions: { parse: [] }, attachments: [{ id: 0, filename: 'bug-report.txt' },
          ...screenshots.map((file, index) => ({ id: index + 1, filename: screenshotName(file, index) }))]
      }));
      form.set('files[0]', new Blob([
        `不具合・その他お問い合わせ\n受付日時: ${new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace('Z', '+09:00')}\n\n【お問い合わせ内容】\n${payload.description}\n\n${payload.diagnostics}`
      ], { type: 'text/plain;charset=utf-8' }), 'bug-report.txt');
      screenshots.forEach((file, index) => form.set(`files[${index + 1}]`, file, screenshotName(file, index)));
      const response = await fetch(webhook, { method: 'POST', body: form, signal: AbortSignal.timeout(18000) });
      if (!response.ok) {
        console.warn(JSON.stringify({ event: 'discord_rejected', status: response.status }));
        return reply(response.status === 429 ? 429 : 502, { ok: false, code: 'discord_rejected' });
      }
      return reply(200, { ok: true });
    } catch { return reply(502, { ok: false, code: 'delivery_unconfirmed' }); }
  }
};
