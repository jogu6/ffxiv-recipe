import test from 'node:test';
import assert from 'node:assert/strict';
import { validReport, reportLength, formatDiagnostics, installBugReport, reportElapsed } from '../web/bug-report.js';
import worker from '../../workers/bug-report/worker.mjs';

test('経過時間は分秒で表示し、未記録をゼロ扱いしない', () => {
  assert.equal(reportElapsed(704667.5749999881), '11分44.7秒');
  assert.equal(reportElapsed(59999), '1分0.0秒');
  assert.equal(reportElapsed(undefined), '未記録');
});

test('本文は空白のみを拒否し、絵文字も1文字として1000文字まで受け付ける', () => {
  for (const value of ['', ' \n\t　', 'a'.repeat(1001), '📜'.repeat(1001)]) {
    assert.equal(validReport(value), false);
  }
  assert.equal(reportLength('📜あ'), 2);
  assert.equal(validReport('📜'.repeat(1000)), true);
});

test('診断テキストに見出しと改行を保つ', () => {
  assert.equal(formatDiagnostics({ マクロ: '/ac 作業\n/ac 加工', 中間素材: [{ 品質: 'HQ' }] }),
    '【マクロ】\n/ac 作業\n/ac 加工\n\n【中間素材】\n1. 品質：HQ');
});

test('ポリシーを報告の上に開き、閉じても入力を保持し送信しない', async () => {
  const controls = new Map();
  const requests = [];
  let doc;
  const node = () => ({ children: [], handlers: {}, style: {}, value: '', open: false,
    get ownerDocument() { return doc; },
    append(...items) { this.children.push(...items); },
    addEventListener(type, handler) { this.handlers[type] = handler; },
    setAttribute() {}, focus() {}, remove() { this.removed = true; },
    showModal() { this.open = true; },
    close() { this.open = false; this.handlers.close?.(); },
    querySelectorAll() { return []; }
  });
  doc = { body: node(), createElement: node, getElementById(id) {
    if (!controls.has(id)) controls.set(id, node());
    return controls.get(id);
  } };
  installBugReport({ document: doc, capture: () => ({}), fetch: async (url, options) => {
    requests.push({ url: String(url), options });
    return new Response('# プライバシー・ポリシー\n\n説明本文');
  } });
  doc.getElementById('bugReportButton').handlers.click();
  doc.getElementById('bugReportText').value = '入力途中の内容';
  let prevented = false;
  await doc.getElementById('bugReportPrivacyLink').handlers.click({ preventDefault() { prevented = true; } });
  const policy = doc.body.children.at(-1);
  assert.equal(prevented, true);
  assert.equal(policy.open, true);
  assert.equal(policy.children[0].children[1].textContent, '説明本文');
  policy.children[0].children[2].children[0].handlers.click();
  assert.equal(policy.removed, true);
  assert.equal(doc.getElementById('bugReportDialog').open, true);
  assert.equal(doc.getElementById('bugReportText').value, '入力途中の内容');
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/docs\/privacy-policy\.md$/);
  assert.notEqual(requests[0].options.method, 'POST');
});

test('確認画面は入力本文だけを表示し、確定前・キャンセルでは送信しない', async () => {
  const controls = new Map();
  const control = id => {
    if (!controls.has(id)) controls.set(id, {
      value: '', textContent: '', hidden: false, disabled: false, open: false, handlers: {},
      addEventListener(event, handler) { this.handlers[event] = handler; },
      dispatch(event) { return this.handlers[event]?.({ target: this }); },
      focus() {}, setAttribute() {},
      showModal() { this.open = true; }, close() { this.open = false; this.dispatch('close'); },
      querySelectorAll() { return [control('cancel')]; },
      querySelector() { return null; }
    });
    return controls.get(id);
  };
  const calls = [];
  installBugReport({ document: { getElementById: control }, capture: () => ({ 診断: '自動取得の秘密ではない情報' }),
    fetch: async (_, options) => { calls.push(options); return new Response('{"ok":true}'); } });
  control('bugReportButton').dispatch('click');
  control('bugReportText').value = '　\n';
  control('bugReportText').dispatch('input');
  assert.equal(control('bugReportNext').disabled, true);
  control('bugReportText').value = '<script>これは文字列</script>\n不具合';
  control('bugReportText').dispatch('input');
  control('bugReportNext').dispatch('click');
  assert.equal(control('bugReportPreview').textContent, control('bugReportText').value);
  assert.doesNotMatch(control('bugReportPreview').textContent, /自動取得/);
  assert.equal(calls.length, 0);
  control('bugReportBack').dispatch('click');
  assert.equal(control('bugReportEditor').hidden, false);
  control('cancel').dispatch('click');
  assert.equal(calls.length, 0);
  control('bugReportButton').dispatch('click');
  control('bugReportText').value = '再入力\n本文';
  control('bugReportNext').dispatch('click');
  await control('bugReportSubmit').dispatch('click');
  assert.equal(calls.length, 1);
  const payload = JSON.parse(calls[0].body);
  assert.equal(payload.description, '再入力\n本文');
  assert.match(payload.diagnostics, /自動取得/);
  assert.equal(control('bugReportConfirmation').hidden, true);
  assert.equal(control('bugReportStatus').textContent, '送信が完了しました。\nご協力ありがとうございます、');
  assert.equal(control('cancel').textContent, '閉じる');
  assert.equal(control('bugReportIntroduction').hidden, true);
  control('cancel').dispatch('click');
  control('bugReportButton').dispatch('click');
  assert.equal(control('bugReportIntroduction').hidden, false);
});

test('Workerは検証後だけDiscordへ送り、秘密とIPを本文へ含めない', async () => {
  const original = globalThis.fetch;
  const calls = [];
  const env = { DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/123/test-secret',
    REPORT_LIMITER: { limit: async () => ({ success: true }) } };
  const request = (payload, origin = 'https://jogu6.github.io') => new Request('https://worker.example/', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1' },
    body: JSON.stringify(payload)
  });
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return new Response('{}'); };
  try {
    assert.equal((await worker.fetch(request({ description: '', diagnostics: 'test' }), env)).status, 400);
    assert.equal((await worker.fetch(request({ description: 'ok', diagnostics: 'test' }, 'https://other.example'), env)).status, 403);
    assert.equal((await worker.fetch(request({ description: 'ok', diagnostics: 'test' }), { ...env, REPORT_LIMITER: null })).status, 503);
    assert.equal((await worker.fetch(request({ description: 'ok', diagnostics: 'test' }), {
      ...env, REPORT_LIMITER: { limit: async () => ({ success: false }) }
    })).status, 429);
    assert.equal((await worker.fetch(request({ description: '📜'.repeat(1001), diagnostics: 'test' }), env)).status, 400);
    assert.equal(calls.length, 0);
    const response = await worker.fetch(request({ description: '@everyone\n本文', diagnostics: '【条件】\nHQ' }), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://jogu6.github.io');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url.searchParams.get('wait'), 'true');
    const message = JSON.parse(calls[0].options.body.get('payload_json'));
    assert.deepEqual(message.allowed_mentions, { parse: [] });
    const attachment = await calls[0].options.body.get('files[0]').text();
    assert.match(attachment, /@everyone\n本文/);
    assert.match(attachment, /【条件】\nHQ/);
    assert.doesNotMatch(attachment, /192\.0\.2\.1|test-secret/);
    assert.match(attachment, /受付日時: \d{4}-\d{2}-\d{2}T[^\n]+\+09:00/);
    for (const address of [
      ' https://discordapp.com/api/webhooks/123/test-secret ',
      'https://canary.discord.com/api/webhooks/123/test-secret',
      'https://ptb.discord.com/api/webhooks/123/test-secret',
      'https://discord.com/api/v10/webhooks/123/test-secret/',
      'https://discord.com/api/webhooks/123/test-secret?thread_id=456'
    ]) {
      assert.equal((await worker.fetch(request({ description: 'ok', diagnostics: 'test' }), {
        ...env, DISCORD_WEBHOOK_URL: address
      })).status, 200);
      assert.equal(calls.at(-1).url.hostname, 'discord.com');
      assert.equal(calls.at(-1).url.pathname, '/api/webhooks/123/test-secret');
    }
    const sent = calls.length;
    for (const address of [
      'https://discord.com/channels/123/456', 'https://evil.example/api/webhooks/123/test-secret',
      'https://discord.com.evil.example/api/webhooks/123/test-secret', 'not a URL',
      'https://user:password@discord.com/api/webhooks/123/test-secret'
    ]) {
      const rejected = await worker.fetch(request({ description: 'ok', diagnostics: 'test' }), {
        ...env, DISCORD_WEBHOOK_URL: address
      });
      assert.equal(rejected.status, 503);
      assert.equal((await rejected.json()).code, 'invalid_webhook');
    }
    assert.equal(calls.length, sent);
    globalThis.fetch = async () => new Response('{}', { status: 429 });
    assert.equal((await worker.fetch(request({ description: 'ok', diagnostics: 'test' }), env)).status, 429);
    globalThis.fetch = async () => { throw new Error(env.DISCORD_WEBHOOK_URL); };
    const failed = await worker.fetch(request({ description: 'ok', diagnostics: 'test' }), env);
    assert.equal(failed.status, 502);
    assert.equal(await failed.text(), '{"ok":false,"code":"delivery_unconfirmed"}');
    assert.equal((await worker.fetch(request({ description: 'ok', diagnostics: 'a'.repeat(100000) }), env)).status, 413);
  } finally { globalThis.fetch = original; }
});

test('一般項目は日本語のラベル付きテキスト、詳細な計測だけJSONにする', () => {
  const text = formatDiagnostics({
    現在の製作ステータス: { level: 100, craftsmanship: 5655, manipulation: true },
    中間素材: [{ 名前: '高山食塩', 必要数: 2, 品質: 'HQ' }, { 名前: 'ペリラオイル', 必要数: 1, 品質: 'NQ' }],
    食事: { 名前: 'ロネークステーキ', 効果: { controlPercent: 5, controlCap: 97 } },
    薬品: '使用しない', 直近の探索計測: [{ searchNodes: 123 }]
  });
  assert.match(text, /ジョブレベル：100\n作業精度：5655\nマニピュレーション：あり/);
  assert.match(text, /1\. 名前：高山食塩\n  必要数：2\n  品質：HQ\n2\. 名前：ペリラオイル/);
  assert.match(text, /効果：\n  加工精度上昇率（%）：5\n  加工精度上昇上限：97/);
  assert.match(text, /【薬品】\n使用しない/);
  assert.match(text, /【直近の探索計測（詳細JSON）】\n\[/);
  assert.doesNotMatch(text.split('【直近の探索計測')[0], /[{}]/);
});
