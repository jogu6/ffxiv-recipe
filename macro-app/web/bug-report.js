import { collectDeviceInfo, collectScreenInfo } from './device-info.js';
import { MAX_SCREENSHOTS, validateScreenshots, prepareScreenshot, screenshotName } from './report-attachments.js';
import { measuredSnapshot } from './profiling.js';

// Called only while exporting a report. Never mutates the recorded profile,
// requests device information, or adds work to the running solver callbacks.
export function profileForReport(profile) {
  if (!profile) return { summary: '未記録', samples: [], storage: {}, storageEvents: [], estimates: [], development: null };
  const samples = profile.samples || [];
  const estimateKeys = ['storageQuotaBytes', 'storageUsageBytes', 'storageAvailableBytes'];
  const withoutEstimates = value => Object.fromEntries(Object.entries(value || {})
    .filter(([key]) => !estimateKeys.includes(key) && key !== 'localSimulatedSleepMs'));
  const clean = sample => ({ ...withoutEstimates(measuredSnapshot(sample)), elapsedMs: sample.elapsedMs,
    nodesPerSecond: sample.nodesPerSecond ?? null });
  const trendKeys = ['searchNodes', 'searchQueuedNodes', 'wasmMemoryBytes', 'storageResidentBytes',
    'storageDiskUsedBytes', 'storageDiskHighWaterBytes', 'storagePageReads', 'storagePageWrites'];
  const point = sample => ({ 段階: sample.stage, 経過時間ms: sample.elapsedMs,
    ...Object.fromEntries(trendKeys.filter(key => Number.isFinite(sample[key])).map(key => [key, sample[key]])) });
  const stages = [];
  const peaks = {};
  let previous, maxGap = null;
  for (const sample of samples) {
    if (previous && Number.isFinite(sample.elapsedMs) && Number.isFinite(previous.elapsedMs)) {
      const gap = sample.elapsedMs - previous.elapsedMs;
      if (!maxGap || gap > maxGap.間隔ms) maxGap = { 間隔ms: gap,
        開始ms: previous.elapsedMs, 終了ms: sample.elapsedMs, 開始段階: previous.stage, 終了段階: sample.stage };
    }
    let stage = stages.at(-1);
    if (!stage || stage.段階 !== sample.stage) {
      if (stage) stage.次段階の初回観測ms = sample.elapsedMs;
      stage = { 段階: sample.stage, 初回観測ms: sample.elapsedMs, 最終観測ms: sample.elapsedMs, 記録数: 0 };
      stages.push(stage);
    }
    stage.最終観測ms = sample.elapsedMs;
    stage.記録数++;
    for (const key of trendKeys) {
      if (Number.isFinite(sample[key]) && (!peaks[key] || sample[key] > peaks[key].値)) {
        peaks[key] = { 値: sample[key], 経過時間ms: sample.elapsedMs, 段階: sample.stage };
      }
    }
    previous = sample;
  }
  // Keep the report bounded even when the existing recorder holds 2,400 entries.
  // Full-history extrema and gaps above are computed before selecting 32 points.
  const indices = new Set();
  for (let i = 0; i < Math.min(32, samples.length); i++) {
    indices.add(Math.round(i * (samples.length - 1) / Math.max(1, Math.min(32, samples.length) - 1)));
  }
  const estimates = (profile.storageEvents || []).filter(event =>
    estimateKeys.some(key => Number.isFinite(event[key]))).map(event => ({
    取得元: '一時保存バックエンド', 記録イベント: event.operation, 記録時点ms: event.elapsedMs,
    容量推計の取得時点: '保存領域を開く際の予約前。記録イベントごとの再取得ではありません',
    storageQuotaBytes: event.storageQuotaBytes > 0 ? event.storageQuotaBytes : '取得不可・未取得',
    storageUsageBytes: event.storageQuotaBytes > 0 ? event.storageUsageBytes : '取得不可・未取得',
    storageAvailableBytes: event.storageQuotaBytes > 0 ? event.storageAvailableBytes : '取得不可・未取得',
    整合性: event.storageUsageBytes > event.storageQuotaBytes && event.storageQuotaBytes > 0
      ? '使用量推計が上限推計を超過。実際の空き容量・予約可否の判定には使えません' : 'ブラウザー推計値'
  }));
  return {
    samples: samples.slice(-10).map(clean),
    storage: withoutEstimates(profile.storage),
    storageEvents: (profile.storageEvents || []).map(withoutEstimates),
    estimates,
    development: profile.metadata?.localResourceTest || samples.some(sample => 'localSimulatedSleepMs' in sample)
      ? { 記録元: '開発試験でのみ付与された設定・計測',
        試験設定: profile.metadata?.localResourceTest ? structuredClone(profile.metadata.localResourceTest) : null,
        過去の試験用待機計測: samples.filter(sample => 'localSimulatedSleepMs' in sample).slice(-10)
          .map(sample => ({ elapsedMs: sample.elapsedMs, localSimulatedSleepMs: sample.localSimulatedSleepMs })) }
      : null,
    summary: {
      記録元: '本番共通：アプリ内の既存生成記録',
      保存済み計測数: samples.length, 記録時の間引き数: profile.decimatedSamples || 0,
      初回計測ms: samples[0]?.elapsedMs ?? null, 最終計測ms: samples.at(-1)?.elapsedMs ?? null,
      観測範囲の注意: '各時刻は通知の受信時点です。段階の厳密な開始・終了時刻、CPU停止時間ではありません。',
      段階別: stages.map(stage => ({ ...stage,
        初回観測から次段階までms: Number.isFinite(stage.次段階の初回観測ms)
          ? stage.次段階の初回観測ms - stage.初回観測ms : null })),
      保存済み計測間の最長間隔: maxGap,
      最長間隔の注意: profile.decimatedSamples > 0
        ? '記録が間引かれているため、通知自体の最長間隔は復元できません'
        : '詳細計測の間隔です。その間も候補数や作業進捗が通知される場合があり、停止の証拠ではありません',
      観測値の最大: peaks,
      全期間の推移: [...indices].map(index => point(samples[index])),
      推移の出力上限: 32,
      永続保存の失敗: Boolean(profile.storageUnavailable),
      作業進捗の取得状態: profile.workProgress ? '取得済み'
        : samples.at(-1)?.wasmEngineKind === 'parallel' ? '対象外：並列エンジンはこの通知を生成しません' : '未記録',
      計測時間の意味: profile.timingMeaning || '未記録'
    }
  };
}
export const REPORT_ENDPOINT = 'https://xivca-bug-report.jun1-ogu6.workers.dev/';
export const MAX_REPORT_LENGTH = 1000;
export function reportLength(text) { return Array.from(text).length; }
export function validReport(text) {
  return typeof text === 'string' && text.trim().length > 0 && reportLength(text) <= MAX_REPORT_LENGTH;
}

const REPORT_LABELS = {
  level: 'ジョブレベル', crafterLevel: 'ジョブレベル', craftsmanship: '作業精度', control: '加工精度', cp: 'CP', maxCp: 'CP',
  manipulation: 'マニピュレーション', manipulationAvailable: 'マニピュレーション',
  heartAndSoul: '一心不乱', heartAndSoulAvailable: '一心不乱',
  quickInnovation: 'クイックイノベーション', quickInnovationAvailable: 'クイックイノベーション',
  maxDurability: '耐久', maxProgress: '必要工数', maxQuality: '最大品質', targetQuality: '目標品質',
  requiredCraftsmanship: '必要作業精度', requiredControl: '必要加工精度',
  recipeLevel: 'レシピ計算係数', jobLevel: '製作レベル', progressDivisor: '工数除数', qualityDivisor: '品質除数',
  progressModifier: '工数補正', qualityModifier: '品質補正', materialQualityPercent: '素材品質割合（%）',
  ingredients: '中間素材', amount: '必要数', hq: 'HQ素材', trainedEyeAvailable: '匠の早業',
  adversarial: '状態変化を考慮した品質保証', stellarSteadyHandCharges: 'ステラステディハンド使用可能回数',
  craftsmanshipPercent: '作業精度上昇率（%）', craftsmanshipCap: '作業精度上昇上限',
  controlPercent: '加工精度上昇率（%）', controlCap: '加工精度上昇上限', cpPercent: 'CP上昇率（%）', cpCap: 'CP上昇上限',
  enabled: '有効', width: '開始時の画面幅（px）', widthAtUpload: '送信時の画面幅（px）',
  cpuMode: 'CPU制限方式', slowdownTarget: '所要時間の倍率目標', wasmMaximumBytes: 'WASM上限（bytes）', threadCount: 'スレッド数'
};
const REPORT_VALUES = { running: '生成中', completed: '完了', cancelled: '中断', interrupted: '中断（ページ終了等）',
  error: 'エラー', 'no-solution': '解なし', visible: '表示中', hidden: '非表示', 'cooperative-worker-budget': '探索区間ごとの協調休止' };
export function reportElapsed(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '未記録';
  const tenths = Math.round(ms / 100);
  return `${Math.floor(tenths / 600)}分${((tenths % 600) / 10).toFixed(1)}秒`;
}
function readableValue(value, indent = '') {
  if (value == null) return '未取得・未設定';
  if (typeof value === 'boolean') return value ? 'あり' : 'なし';
  if (typeof value !== 'object') return REPORT_VALUES[value] || String(value);
  if (Array.isArray(value)) return value.length ? value.map((item, index) =>
    `${indent}${index + 1}. ${readableValue(item, indent + '  ').trimStart()}`
  ).join('\n') : `${indent}なし`;
  if (!Object.keys(value).length) return `${indent}なし`;
  return Object.entries(value).map(([key, item]) => {
    const label = REPORT_LABELS[key] || key;
    if (key === '表示内容') return `${indent}${label}：\n${indent}  ${readableValue(item).replace(/\n/g, `\n${indent}  `)}`;
    return item !== null && typeof item === 'object'
      ? `${indent}${label}：\n${readableValue(item, indent + '  ')}`
      : `${indent}${label}：${readableValue(item).replace(/\n/g, `\n${indent}  `)}`;
  }).join('\n');
}

// Only explicit app data is supplied here: never storage dumps, cookies or URLs.
export function formatDiagnostics(snapshot) {
  return Object.entries(snapshot).map(([name, value]) => {
    const detailed = name === '直近の探索計測';
    return `【${name}${detailed ? '（詳細JSON）' : ''}】\n${detailed ? JSON.stringify(value, null, 2) : readableValue(value)}`;
  }).join('\n\n');
}

function boundedDiagnostics(snapshot) {
  const text = formatDiagnostics(snapshot);
  const bytes = new TextEncoder().encode(text);
  const limit = 72 * 1024;
  return bytes.length <= limit ? text
    : `${new TextDecoder().decode(bytes.subarray(0, limit - 100))}\n\n（容量上限により診断情報の末尾を省略しました）`;
}

export function installBugReport({ capture, document: doc = document, fetch: send = fetch, button = doc.getElementById('bugReportButton') }) {
  let dialog = doc.getElementById('bugReportDialog');
  if (!dialog) {
    dialog = doc.createElement('dialog');
    dialog.id = 'bugReportDialog';
    dialog.className = 'bug-report-dialog';
    dialog.setAttribute('aria-labelledby', 'bugReportTitle');
    dialog.innerHTML = `
      <div class="bug-report-card">
        <h2 id="bugReportTitle">不具合・その他お問い合わせ</h2>
        <div class="bug-report-content">
        <p id="bugReportIntroduction">返信が必要な場合は、ご連絡先も入力してください。動作確認のための情報を添え、内容を暗号化して送信します。<a id="bugReportPrivacyLink" href="${new URL('../../docs/privacy-policy.md', import.meta.url).href}" target="_blank" rel="noopener">プライバシー・ポリシー</a>をご確認の上、記載された情報の取り扱いに同意いただける場合に送信してください。連絡先：<a href="https://x.com/ff14_recipe" target="_blank" rel="noopener noreferrer">@ff14_recipe</a></p>
        <div id="bugReportEditor">
          <label for="bugReportText">お問い合わせ内容</label>
          <textarea id="bugReportText" class="settings-input" rows="7" required aria-describedby="bugReportCount" placeholder="不具合・その他お問い合わせ内容を入力してください（1,000文字以内）"></textarea>
          <output id="bugReportCount" aria-live="polite">0 / 1000文字</output>
        </div>
        <div id="bugReportAttachments">
          <div id="bugReportFilePicker">
            <span id="bugReportFileLabel">スクリーンショット（任意）</span>
            <button id="bugReportChooseFiles" class="settings-btn" type="button" aria-describedby="bugReportFileHelp bugReportFileError">画像を選択</button>
            <input id="bugReportFiles" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden aria-labelledby="bugReportFileLabel" aria-describedby="bugReportFileHelp bugReportFileError">
            <p id="bugReportFileHelp">PNG・JPEG・WebP、4枚まで、元画像は1枚32MiB以内。画像の貼り付けもできます。送信用に圧縮する場合があります。下の画像で内容をご確認ください。</p>
          </div>
          <p id="bugReportFileError" role="status"></p>
          <div id="bugReportFileList"></div>
        </div>
        <div id="bugReportConfirmation" hidden>
          <p>この内容で送信しますか？</p>
          <pre id="bugReportPreview" aria-label="入力したお問い合わせ内容"></pre>
        </div>
        <p id="bugReportStatus" role="status"></p>
        </div>
        <div class="confirm-btns bug-report-actions">
          <button id="bugReportBack" class="confirm-btn no" type="button" hidden>修正する</button>
          <button id="bugReportNext" class="confirm-btn yes" type="button" disabled>送信する</button>
          <button id="bugReportSubmit" class="confirm-btn yes" type="button" hidden>送信する</button>
          <button class="confirm-btn no" type="button" data-report-cancel>キャンセル</button>
        </div>
      </div>`;
    doc.body.append(dialog);
  }
  if (doc.head && !doc.querySelector('link[data-inquiry-style]')) {
    const style = doc.createElement('link');
    style.rel = 'stylesheet';
    style.href = new URL('./bug-report.css', import.meta.url).href;
    style.dataset.inquiryStyle = 'true';
    doc.head.append(style);
  }
  const input = doc.getElementById('bugReportText');
  const counter = doc.getElementById('bugReportCount');
  const editor = doc.getElementById('bugReportEditor');
  const confirmation = doc.getElementById('bugReportConfirmation');
  const preview = doc.getElementById('bugReportPreview');
  const next = doc.getElementById('bugReportNext');
  const submit = doc.getElementById('bugReportSubmit');
  const back = doc.getElementById('bugReportBack');
  const status = doc.getElementById('bugReportStatus');
  const introduction = doc.getElementById('bugReportIntroduction');
  const attachmentSection = doc.getElementById('bugReportAttachments');
  const picker = doc.getElementById('bugReportFilePicker');
  const fileInput = doc.getElementById('bugReportFiles');
  const chooseFiles = doc.getElementById('bugReportChooseFiles');
  const fileList = doc.getElementById('bugReportFileList');
  const fileError = doc.getElementById('bugReportFileError');
  const closeButtons = dialog.querySelectorAll('[data-report-cancel]');
  // Hosted panels display the modal in the main page, centered over the whole app.
  const view = doc.defaultView;
  const openPolicy = async event => {
    event.preventDefault();
    const host = dialog.ownerDocument;
    const policy = host.createElement('dialog');
    policy.className = 'bug-report-dialog bug-report-policy';
    policy.setAttribute('aria-label', 'プライバシー・ポリシー');
    const card = host.createElement('div');
    card.className = 'privacy-document-card';
    const title = host.createElement('h2');
    title.textContent = 'プライバシー・ポリシー';
    const content = host.createElement('div');
    content.className = 'document-text privacy-document-content';
    content.textContent = '読み込み中...';
    const actions = host.createElement('div');
    actions.className = 'settings-close';
    const close = host.createElement('button');
    close.type = 'button';
    close.className = 'confirm-btn no';
    close.textContent = '閉じる';
    close.addEventListener('click', () => policy.close());
    policy.addEventListener('click', event => {
      if (event.target !== policy) return;
      const bounds = policy.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right
        || event.clientY < bounds.top || event.clientY > bounds.bottom) policy.close();
    });
    const cleanup = () => policy.remove();
    view?.addEventListener('pagehide', cleanup, { once: true });
    policy.addEventListener('close', () => {
      view?.removeEventListener('pagehide', cleanup);
      policy.remove();
    });
    actions.append(close);
    card.append(title, content, actions);
    policy.append(card);
    host.body.append(policy);
    policy.showModal();
    try {
      const response = await send(new URL('../../docs/privacy-policy.md', import.meta.url), { cache: 'no-cache' });
      if (!response.ok) throw new Error('policy unavailable');
      const markdown = (await response.text()).replace(/^# .*\r?\n+/, '');
      const renderer = host.defaultView;
      if (renderer?.marked?.parse && renderer?.DOMPurify?.sanitize) {
        content.innerHTML = renderer.DOMPurify.sanitize(renderer.marked.parse(markdown, { gfm: true }));
      } else {
        content.style.whiteSpace = 'pre-wrap';
        content.textContent = markdown;
      }
    } catch {
      content.textContent = '文書を読み込めませんでした。閉じてから再度お試しください。';
    }
  };
  doc.getElementById('bugReportPrivacyLink')?.addEventListener('click', openPolicy);
  if (view && view.parent !== view) {
    const host = view.parent.document;
    if (!host.querySelector('link[data-macro-bug-report-style]')) {
      const link = host.createElement('link');
      link.rel = 'stylesheet';
      link.href = new URL('./bug-report.css', import.meta.url).href;
      link.dataset.macroBugReportStyle = 'true';
      host.head.append(link);
    }
    host.body.append(dialog);
    view.addEventListener('pagehide', () => { dialog.close(); dialog.remove(); });
  }
  let diagnostics = '';
  let diagnosticsReady = Promise.resolve();
  let controller = null;
  let confirmedText = '';
  let screenshots = [];
  let screenshotUrls = [];
  let checkingFiles = false;
  let session = 0;
  let returnFocus = button;
  const clearScreenshots = () => {
    screenshotUrls.forEach(url => URL.revokeObjectURL(url));
    screenshotUrls = [];
    screenshots = [];
    fileList?.replaceChildren?.();
    if (fileInput) fileInput.value = '';
  };
  const renderScreenshots = () => {
    if (!fileList) return;
    screenshotUrls.forEach(url => URL.revokeObjectURL(url));
    screenshotUrls = [];
    fileList.replaceChildren?.();
    screenshots.forEach((file, index) => {
      const card = doc.createElement('div');
      card.className = 'bug-report-image';
      const image = doc.createElement('img');
      const url = URL.createObjectURL(file);
      screenshotUrls.push(url);
      image.src = url;
      image.alt = `添付スクリーンショット ${index + 1}`;
      const label = doc.createElement('span');
      label.textContent = `${index + 1}枚目（${Math.ceil(file.size / 1024)}KiB）`;
      const remove = doc.createElement('button');
      remove.type = 'button';
      remove.className = 'bug-report-image-remove';
      const removeMark = doc.createElement('span');
      removeMark.setAttribute('aria-hidden', 'true');
      removeMark.textContent = '×';
      remove.append(removeMark);
      remove.setAttribute('aria-label', `${index + 1}枚目のスクリーンショットを削除`);
      remove.hidden = editor.hidden;
      remove.disabled = checkingFiles;
      remove.addEventListener('click', () => {
        screenshots.splice(index, 1);
        fileError.textContent = '';
        renderScreenshots();
        update();
      });
      const thumbnail = doc.createElement('div');
      thumbnail.className = 'bug-report-thumbnail';
      thumbnail.append(image, remove);
      card.append(thumbnail, label);
      fileList.append(card);
    });
  };
  const update = () => {
    if (chooseFiles) chooseFiles.disabled = checkingFiles || screenshots.length >= MAX_SCREENSHOTS;
    counter.textContent = `${reportLength(input.value)} / ${MAX_REPORT_LENGTH}文字`;
    next.disabled = checkingFiles || !validReport(input.value);
    input.setAttribute('aria-invalid', String(reportLength(input.value) > MAX_REPORT_LENGTH));
  };
  const edit = () => {
    introduction.hidden = false;
    next.hidden = false;
    back.hidden = true;
    submit.hidden = true;
    editor.hidden = false;
    confirmation.hidden = true;
    status.textContent = '';
    if (picker) picker.hidden = false;
    renderScreenshots();
    input.focus();
  };
  const open = (trigger = button) => {
    if (dialog.open) return;
    session++;
    returnFocus = trigger;
    submit.disabled = false;
    back.disabled = false;
    checkingFiles = false;
    clearScreenshots();
    if (attachmentSection) attachmentSection.hidden = false;
    if (fileInput) fileInput.disabled = false;
    if (fileError) fileError.textContent = '';
    introduction.hidden = false;
    const snapshot = capture();
    if (view) snapshot.報告時の実行環境 = {
      ...snapshot.報告時の実行環境, ...collectScreenInfo(view),
      言語: view.navigator?.language, セキュアコンテキスト: view.isSecureContext,
      分離コンテキスト: view.crossOriginIsolated, ページ表示状態: doc.visibilityState
    };
    diagnostics = boundedDiagnostics(snapshot);
    const ready = collectDeviceInfo(view?.navigator || {}).then(info => {
      if (diagnosticsReady === ready) diagnostics = boundedDiagnostics({ ...snapshot,
        報告時の実行環境: { ...snapshot.報告時の実行環境, ...info } });
    });
    diagnosticsReady = ready;
    input.value = '';
    confirmedText = '';
    closeButtons.forEach(control => { control.textContent = 'キャンセル'; });
    update();
    dialog.showModal();
    edit();
  };
  button?.addEventListener('click', () => open(button));
  const addScreenshots = async files => {
    if (checkingFiles || editor.hidden || !dialog.open || !files.length) return;
    const currentSession = session;
    checkingFiles = true;
    fileInput.disabled = true;
    fileError.textContent = '画像を準備しています…';
    update();
    renderScreenshots();
    try {
      if (screenshots.length + files.length > MAX_SCREENSHOTS) throw new Error('スクリーンショットは4枚まで添付できます。');
      const candidates = [...screenshots];
      for (const file of files) {
        candidates.push(await prepareScreenshot(file, doc));
        if (session !== currentSession || !dialog.open) return;
      }
      const error = await validateScreenshots(candidates);
      if (session !== currentSession || !dialog.open) return;
      fileError.textContent = error;
      if (!error) screenshots = candidates;
    } catch (error) {
      if (session === currentSession) fileError.textContent = error.message || '画像を読み込めませんでした。選び直してください。';
    } finally {
      if (session === currentSession) {
        checkingFiles = false;
        fileInput.disabled = false;
        fileInput.value = '';
        renderScreenshots();
        update();
      }
    }
  };
  chooseFiles?.addEventListener('click', () => fileInput.click());
  fileInput?.addEventListener('change', () => addScreenshots([...fileInput.files]));
  dialog.addEventListener('paste', event => {
    const files = [...(event.clipboardData?.files || [])];
    if (!files.length || editor.hidden) return;
    event.preventDefault();
    void addScreenshots(files);
  });
  input.addEventListener('input', update);
  next.addEventListener('click', () => {
    if (checkingFiles || !validReport(input.value)) return;
    confirmedText = input.value;
    preview.textContent = confirmedText;
    introduction.hidden = true;
    next.hidden = true;
    back.hidden = false;
    submit.hidden = false;
    editor.hidden = true;
    confirmation.hidden = false;
    if (picker) picker.hidden = true;
    if (fileError) fileError.textContent = '';
    renderScreenshots();
    status.textContent = '';
    submit.focus();
  });
  back.addEventListener('click', edit);
  closeButtons.forEach(control =>
    control.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => {
    session++;
    clearScreenshots();
    diagnostics = '';
    diagnosticsReady = Promise.resolve();
    controller?.abort();
    controller = null;
    returnFocus?.focus();
  });
  submit.addEventListener('click', async () => {
    if (controller || !validReport(confirmedText)) return;
    const attempt = new AbortController();
    controller = attempt;
    submit.disabled = true;
    back.disabled = true;
    status.textContent = '送信しています。送信開始後は、キャンセルしても届く場合があります。';
    const content = dialog.querySelector('.bug-report-content');
    if (content) content.scrollTop = content.scrollHeight;
    const timeout = setTimeout(() => attempt.abort(), 25000);
    try {
      await diagnosticsReady;
      if (attempt.signal.aborted || !dialog.open || controller !== attempt) return;
      const body = screenshots.length ? new FormData() : JSON.stringify({ description: confirmedText, diagnostics });
      if (screenshots.length) {
        body.set('description', confirmedText);
        body.set('diagnostics', diagnostics);
        screenshots.forEach((file, index) => body.append('screenshots', file, screenshotName(file, index)));
      }
      const response = await send(REPORT_ENDPOINT, {
        method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer',
        headers: screenshots.length ? {} : { 'Content-Type': 'application/json' },
        body, signal: attempt.signal
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok !== true) {
        const messages = {
          400: '送信データの形式が正しくありません。',
          403: 'このサイトからの送信が許可されていません。',
          413: '添付画像または診断情報の容量が送信上限を超えています。',
          415: '送信先がこの送信形式に対応していないため、送信できませんでした。',
          429: '送信が集中しています。しばらく待ってからお試しください。',
          502: 'お問い合わせの送信に失敗しました。',
          503: '送信先の設定に問題があります。'
        };
        const displayCode = result.code === 'discord_rejected' ? 'delivery_rejected' : result.code;
        const code = /^[a-z_]+$/.test(displayCode || '') ? ` / ${displayCode}` : '';
        const error = new Error(`${messages[response.status] || '送信できませんでした。'}（HTTP ${response.status}${code}）`);
        error.confirmedRejection = [400, 403, 413, 415, 429, 503].includes(response.status) || result.code === 'discord_rejected';
        throw error;
      }
      if (!dialog.open || controller !== attempt) return;
      next.hidden = true;
      back.hidden = true;
      submit.hidden = true;
      confirmation.hidden = true;
      introduction.hidden = true;
      if (attachmentSection) attachmentSection.hidden = true;
      clearScreenshots();
      status.textContent = '送信が完了しました。\nご協力ありがとうございます、';
      closeButtons.forEach(control => { control.textContent = '閉じる'; });
      closeButtons[0]?.focus();
    } catch (error) {
      if (dialog.open && controller === attempt) status.textContent =
        `${error.name === 'AbortError' ? '送信結果を確認できませんでした。' : error.message}${error.confirmedRejection ? '' : ' 通信が途切れた場合は、すでに届いている可能性があります。'}`;
    } finally {
      clearTimeout(timeout);
      if (controller === attempt) {
        controller = null;
        submit.disabled = false;
        back.disabled = false;
      }
    }
  });
  return { open };
}
