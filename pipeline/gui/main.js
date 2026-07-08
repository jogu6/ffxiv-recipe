const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const { getCurrentWindow, LogicalSize } = window.__TAURI__.window;

const MIN_WIDTH = 760;
const MIN_HEIGHT = 520;
const DEFAULT_WIDTH = 900;
const DEFAULT_HEIGHT = 620;
const SIZE_KEY = 'ffxiv-pipeline-window-size';
const QUALITY_KEY = 'ffxiv-pipeline-webp-quality';
const ICON_SIZE_KEY = 'ffxiv-pipeline-webp-size';
const ICON_DELAY_KEY = 'ffxiv-pipeline-icon-delay';
const LODESTONE_DELAY_KEY = 'ffxiv-pipeline-lodestone-delay';
const PREVIEW_SIZE_KEY = 'ffxiv-pipeline-preview-size';

const elements = {
  statusText: document.getElementById('statusText'),
  lastChecked: document.getElementById('lastChecked'),
  checkUpdatesBtn: document.getElementById('checkUpdatesBtn'),
  downloadCsvBtn: document.getElementById('downloadCsvBtn'),
  validateCsvBtn: document.getElementById('validateCsvBtn'),
  buildBtn: document.getElementById('buildBtn'),
  publishBtn: document.getElementById('publishBtn'),
  lodestoneInfoBtn: document.getElementById('lodestoneInfoBtn'),
  iconsBtn: document.getElementById('iconsBtn'),
  verifyBtn: document.getElementById('verifyBtn'),
  runBtn: document.getElementById('runBtn'),
  resumeBtn: document.getElementById('resumeBtn'),
  cancelBtn: document.getElementById('cancelBtn'),
  previewBtn: document.getElementById('previewBtn'),
  csvToggle: document.getElementById('csvToggle'),
  csvBody: document.getElementById('csvBody'),
  buildToggle: document.getElementById('buildToggle'),
  buildBody: document.getElementById('buildBody'),
  iconQualityToggle: document.getElementById('iconQualityToggle'),
  iconQualityBody: document.getElementById('iconQualityBody'),
  qualityInput: document.getElementById('qualityInput'),
  iconSizeInput: document.getElementById('iconSizeInput'),
  iconDelayInput: document.getElementById('iconDelayInput'),
  lodestoneDelayInput: document.getElementById('lodestoneDelayInput'),
  lodestoneForceInput: document.getElementById('lodestoneForceInput'),
  progressTitle: document.getElementById('progressTitle'),
  progressPercent: document.getElementById('progressPercent'),
  progressBar: document.getElementById('progressBar'),
  progressDetail: document.getElementById('progressDetail'),
  etaText: document.getElementById('etaText'),
  progressActions: document.getElementById('progressActions'),
  clearLogBtn: document.getElementById('clearLogBtn'),
  log: document.getElementById('log'),
  confirmOverlay: document.getElementById('confirmOverlay'),
  confirmMessage: document.getElementById('confirmMessage'),
  confirmOkBtn: document.getElementById('confirmOkBtn'),
  confirmCancelBtn: document.getElementById('confirmCancelBtn'),
  previewOverlay: document.getElementById('previewOverlay'),
  previewContent: document.getElementById('previewContent'),
  previewCloseBtn: document.getElementById('previewCloseBtn'),
  previewThemeBtn: document.getElementById('previewThemeBtn'),
  previewSizeInput: document.getElementById('previewSizeInput'),
  previewScale2: document.getElementById('previewScale2'),
  previewScale3: document.getElementById('previewScale3')
};

const stepDefs = [
  { command: 'validate-csv', order: '1', label: 'CSV検証', description: '必須ヘッダーと token-items.csv の形式を確認します。' },
  { command: 'build', order: '2', label: '候補生成', description: '公開候補 JSON を作成します。Item.json はまだ置き換えません。' },
  { command: 'icons', order: '3', label: 'アイコン生成', description: 'Lodestone NQ 画像を優先し、指定サイズの WebP アイコンを生成します。' },
  { command: 'publish-lodestone-info', order: '4', label: 'Lodestone情報反映', description: '店、製作、装備情報をLodestoneから取得して公開候補JSONへ反映します。' },
  { command: 'publish', order: '5', label: '公開反映', description: '現在の Item.json を自動保護し、比較に通った候補で置き換えます。' },
  { command: 'verify', order: '確認', label: 'Item.json比較', description: '比較だけを実行します。site/data/Item.json は変更しません。' },
  { command: 'check-updates', order: '任意', label: '更新チェック', description: '公式 CSV の更新有無と前回チェック日時を確認します。' },
  { command: 'download-csv', order: '任意', label: 'CSV取得', description: '更新または不足した公式 CSV を取得します。' },
  { command: 'tmp-quality-preview', order: '任意', label: '画質比較', description: 'PNG と q50/q60/q70/q80 の一時比較ページを作ります。' }
];
const recommendedSequence = [
  { command: 'validate-csv' },
  { command: 'build' },
  { command: 'icons', args: () => ['--quality', elements.qualityInput.value, '--size', elements.iconSizeInput.value, '--delay', elements.iconDelayInput.value, '--item-json', 'pipeline/intermediate/06-public-items.json'] },
  { command: 'publish-lodestone-info', args: lodestoneInfoArgs },
  { command: 'publish' }
];
const accordionSections = [];
let running = false;
let currentRun = null;
let activeCommand = '';
let pendingConfirm = null;
let cancellationRequested = false;
let canResume = false;
let pipelineOutputReady = Promise.resolve();
let pendingLogLines = [];
let logFlushTimer = 0;
let etaModel = null;
let etaCountdownTimer = 0;
let etaEstimate = null;

function createAdaptiveThrottle() {
  return {
    lastAt: 0,
    lastSignature: '',
    lastChangeAt: 0,
    burstCount: 0,
    throttled: false,
    burstWindowMs: 250,
    quietMs: 1200,
    minIntervalMs: 1000
  };
}

const logThrottle = createAdaptiveThrottle();
const progressThrottle = createAdaptiveThrottle();

function resetAdaptiveThrottle(throttle) {
  throttle.lastAt = 0;
  throttle.lastSignature = '';
  throttle.lastChangeAt = 0;
  throttle.burstCount = 0;
  throttle.throttled = false;
}

function resetEtaModel() {
  etaModel = {
    command: '',
    samples: 0,
    networkSamples: 0,
    cacheSamples: 0,
    skipSamples: 0,
    networkMs: 0,
    cacheMs: 0,
    skipMs: 0
  };
  etaEstimate = null;
  stopEtaCountdown();
}

function stopEtaCountdown() {
  if (!etaCountdownTimer) return;
  window.clearInterval(etaCountdownTimer);
  etaCountdownTimer = 0;
}

function renderEtaEstimate() {
  if (!etaEstimate) {
    elements.etaText.textContent = 'ETA -';
    return;
  }
  const remaining = Math.max(0, etaEstimate.seconds - ((Date.now() - etaEstimate.at) / 1000));
  elements.etaText.textContent = formatEta(remaining);
}

function setEtaEstimate(seconds) {
  etaEstimate = Number.isFinite(seconds) ? { seconds, at: Date.now() } : null;
  renderEtaEstimate();
  if (!etaCountdownTimer && etaEstimate) etaCountdownTimer = window.setInterval(renderEtaEstimate, 1000);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function shouldFlushAdaptive(throttle, signature, { force = false } = {}) {
  const now = Date.now();
  const changed = signature !== throttle.lastSignature;
  if (force) {
    throttle.lastAt = now;
    throttle.lastSignature = signature;
    return true;
  }
  if (!changed) return false;

  const sinceChange = now - throttle.lastChangeAt;
  throttle.burstCount = sinceChange <= throttle.burstWindowMs ? throttle.burstCount + 1 : 1;
  throttle.lastChangeAt = now;

  if (throttle.throttled && sinceChange > throttle.quietMs) {
    throttle.throttled = false;
    throttle.burstCount = 1;
  } else if (!throttle.throttled && throttle.burstCount >= 3) {
    throttle.throttled = true;
  }

  if (throttle.throttled && now - throttle.lastAt < throttle.minIntervalMs) return false;
  throttle.lastAt = now;
  throttle.lastSignature = signature;
  return true;
}

function flushLog({ force = false } = {}) {
  if (pendingLogLines.length === 0) return;
  const signature = `${elements.log.childElementCount}:${pendingLogLines.length}`;
  if (!shouldFlushAdaptive(logThrottle, signature, { force })) {
    if (!logFlushTimer) {
      logFlushTimer = window.setTimeout(() => {
        logFlushTimer = 0;
        flushLog({ force: true });
      }, logThrottle.minIntervalMs);
    }
    return;
  }
  if (logFlushTimer) {
    window.clearTimeout(logFlushTimer);
    logFlushTimer = 0;
  }
  const wasAtBottom = elements.log.scrollHeight - elements.log.scrollTop - elements.log.clientHeight < 4;
  const fragment = document.createDocumentFragment();
  for (const line of pendingLogLines) {
    const row = document.createElement('div');
    row.className = 'log-line';
    row.textContent = line;
    fragment.append(row);
  }
  pendingLogLines = [];
  elements.log.append(fragment);
  if (wasAtBottom) elements.log.scrollTop = elements.log.scrollHeight;
}

function appendLog(text) {
  const lines = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  pendingLogLines.push(...lines);
  flushLog();
}

function setButtonsDisabled(disabled) {
  for (const button of document.querySelectorAll('.action-item button')) {
    button.disabled = disabled;
  }
  elements.qualityInput.disabled = disabled;
  elements.iconSizeInput.disabled = disabled;
  elements.iconDelayInput.disabled = disabled;
  elements.lodestoneDelayInput.disabled = disabled;
  elements.lodestoneForceInput.disabled = disabled;
  updateProgressActions();
}

function lodestoneInfoArgs() {
  const args = ['--delay', elements.lodestoneDelayInput.value];
  if (elements.lodestoneForceInput.checked) args.push('--force');
  return args;
}

function updateProgressActions() {
  const showCancel = running;
  const showResume = !running && canResume;
  elements.progressActions.hidden = !showCancel && !showResume;
  elements.cancelBtn.hidden = !showCancel;
  elements.cancelBtn.disabled = !showCancel || cancellationRequested;
  elements.resumeBtn.hidden = !showResume;
  elements.resumeBtn.disabled = !showResume;
}

function setProgress(percent, detail = '') {
  const safe = clampNumber(percent, 0, 100, 0);
  elements.progressBar.style.width = `${safe}%`;
  elements.progressPercent.textContent = `${Math.round(safe)}%`;
  if (detail) elements.progressDetail.textContent = detail;
}

function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return 'ETA -';
  const rounded = Math.ceil(seconds);
  const m = Math.floor(rounded / 60);
  const s = rounded % 60;
  return m > 0 ? `ETA ${m}m ${s}s` : `ETA ${s}s`;
}

function markStep(name, state) {
  const step = document.querySelector(`.action-item[data-step="${name}"]`);
  if (!step) return;
  step.classList.remove('running', 'done', 'failed', 'interrupted');
  step.classList.add(state);
  const stateEl = step.querySelector('.action-status');
  if (stateEl) {
    stateEl.textContent = state === 'running'
      ? '● 実行中'
      : state === 'done'
        ? '✓ 完了'
        : state === 'failed'
          ? '× 失敗'
          : state === 'interrupted'
            ? '○ 中断済み'
            : '○ 未実行';
  }
}

function resetProgress(title) {
  resetAdaptiveThrottle(progressThrottle);
  resetEtaModel();
  currentRun = { startedAt: Date.now(), lastTick: 0, title, basePercent: 0, weightPercent: 100 };
  elements.progressTitle.textContent = title;
  setEtaEstimate(NaN);
  setProgress(0, '開始');
}

function updateTimedProgress(completed, total, detail) {
  const now = Date.now();
  const signature = JSON.stringify({ completed, total, detail });
  if (!shouldFlushAdaptive(progressThrottle, signature) && completed < total) return;
  currentRun.lastTick = now;
  const localPercent = total > 0 ? (completed / total) * 100 : 0;
  const percent = (currentRun.basePercent || 0) + localPercent * ((currentRun.weightPercent || 100) / 100);
  const elapsed = (now - currentRun.startedAt) / 1000;
  const eta = completed > 0 ? ((total - completed) * elapsed) / completed : NaN;
  setProgress(percent, detail);
  setEtaEstimate(eta);
}

function parseEtaProgress(line) {
  if (!line.startsWith('__ETA__ ')) return null;
  try {
    return JSON.parse(line.slice(8));
  } catch {
    return null;
  }
}

function updateEtaProgress(payload) {
  if (!currentRun || payload?.command !== 'publish-lodestone-info') return;
  const completed = Number(payload.completed);
  const total = Number(payload.total);
  const elapsedMs = Number(payload.elapsedMs);
  const fetches = Number(payload.fetches);
  const skipped = Number(payload.skipped || 0);
  if (!Number.isFinite(completed) || !Number.isFinite(total) || total <= 0 || !Number.isFinite(elapsedMs)) return;
  if (!etaModel || etaModel.command !== payload.command) {
    resetEtaModel();
    etaModel.command = payload.command;
  }
  etaModel.samples += 1;
  if (skipped > 0) {
    etaModel.skipSamples += 1;
    etaModel.skipMs += elapsedMs;
  } else if (fetches > 0) {
    etaModel.networkSamples += 1;
    etaModel.networkMs += elapsedMs;
  } else {
    etaModel.cacheSamples += 1;
    etaModel.cacheMs += elapsedMs;
  }
  const localPercent = (completed / total) * 100;
  const percent = (currentRun.basePercent || 0) + localPercent * ((currentRun.weightPercent || 100) / 100);
  const detail = `Lodestone ${completed}/${total}`;
  const signature = JSON.stringify({ completed, total, detail, etaSamples: etaModel.samples });
  const shouldRender = shouldFlushAdaptive(progressThrottle, signature, { force: completed >= total });
  if (!shouldRender) return;
  currentRun.lastTick = Date.now();
  setProgress(percent, detail);
  if (etaModel.samples < 5) {
    setEtaEstimate(NaN);
    return;
  }
  const remaining = Math.max(0, total - completed);
  const networkRatio = etaModel.networkSamples / etaModel.samples;
  const skipRatio = etaModel.skipSamples / etaModel.samples;
  const cacheRatio = Math.max(0, 1 - networkRatio - skipRatio);
  const avgNetwork = etaModel.networkSamples ? etaModel.networkMs / etaModel.networkSamples : 0;
  const avgCache = etaModel.cacheSamples ? etaModel.cacheMs / etaModel.cacheSamples : 0;
  const avgSkip = etaModel.skipSamples ? etaModel.skipMs / etaModel.skipSamples : 0;
  setEtaEstimate((remaining * ((networkRatio * avgNetwork) + (cacheRatio * avgCache) + (skipRatio * avgSkip))) / 1000);
}

function parseProgress(line) {
  const iconMatch = line.match(/^(?:icons|アイコン|比較) (\d+)\/(\d+)/);
  if (iconMatch) return { completed: Number(iconMatch[1]), total: Number(iconMatch[2]), detail: line };
  const lodestoneMatch = line.match(/^Lodestone\s+(\d+)\/(\d+):\s+/);
  if (lodestoneMatch) return { completed: Number(lodestoneMatch[1]), total: Number(lodestoneMatch[2]), detail: line };
  const createdMatch = line.match(/^created .* \((\d+)\)/);
  if (createdMatch) return null;
  return null;
}

function parseCacheVersionUpdate(line) {
  const match = line.match(/^データキャッシュ版を更新しました\s+(\S+)(?:\s+\(([^)]+)\))?/);
  if (!match) return null;
  return { version: match[1], reason: match[2] || '' };
}

function showCacheVersionUpdate(update) {
  const suffix = update.reason ? ` (${update.reason})` : '';
  const detail = `キャッシュ版更新済み: ${update.version}${suffix}`;
  elements.progressDetail.textContent = detail;
  elements.statusText.textContent = 'キャッシュ版更新済み';
}

async function runCommand(command, args = [], options = {}) {
  if (running) return;
  running = true;
  canResume = false;
  cancellationRequested = false;
  activeCommand = command;
  setButtonsDisabled(true);
  resetProgress(options.title || command);
  markStep(command, 'running');
  elements.statusText.textContent = '実行中';
  appendLog(`[開始] ${options.title || command}`);
  try {
    await pipelineOutputReady;
    const output = await invoke('run_pipeline_command', { command, args });
    if (output?.trim()) appendLog(`[完了後出力]\n${output.trimEnd()}`);
    if (cancellationRequested) {
      markStep(command, 'interrupted');
      canResume = true;
      elements.statusText.textContent = '中断';
      appendLog(`${options.title || command}を中断しました`);
      return false;
    }
    setProgress(100, '完了');
    setEtaEstimate(0);
    markStep(command, 'done');
    elements.statusText.textContent = '完了';
    if (command === 'check-updates') await loadUpdateState();
    return true;
  } catch (error) {
    appendLog(String(error));
    markStep(command, cancellationRequested ? 'interrupted' : 'failed');
    canResume = cancellationRequested;
    elements.statusText.textContent = cancellationRequested ? '中断' : '失敗';
    return false;
  } finally {
    flushLog({ force: true });
    stopEtaCountdown();
    running = false;
    activeCommand = '';
    setButtonsDisabled(false);
  }
}

async function openQualityPreview() {
  try {
    elements.previewContent.textContent = '';
    const loading = document.createElement('p');
    loading.className = 'preview-message';
    loading.textContent = '読み込み中...';
    elements.previewContent.append(loading);
    elements.previewOverlay.classList.add('open');
    elements.previewOverlay.setAttribute('aria-hidden', 'false');
    renderQualityPreview(await invoke('read_quality_preview'));
  } catch (error) {
    elements.previewContent.textContent = '';
    elements.previewContent.append(textEl('p', 'preview-message', `比較ページを開けませんでした: ${String(error)}`));
    appendLog(`比較ページを開けませんでした: ${String(error)}`);
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatImagePixels(width, height) {
  return Number.isFinite(width) && Number.isFinite(height) ? `${width}x${height}px` : '';
}

function textEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function previewCell(label, file, size, baseSize, note = '') {
  const cell = textEl('div', 'preview-cell');
  const swatch = textEl('div', 'preview-swatch');
  const img = document.createElement('img');
  img.src = file;
  img.alt = '';
  swatch.append(img);
  cell.append(
    swatch,
    textEl('b', '', label),
    note ? textEl('span', '', note) : document.createDocumentFragment(),
    textEl('span', '', baseSize ? `${formatBytes(size)} / ${Math.round((size / baseSize) * 100)}%` : formatBytes(size))
  );
  return cell;
}

function renderQualityPreview(rows) {
  elements.previewContent.textContent = '';
  if (!Array.isArray(rows) || rows.length === 0) {
    elements.previewContent.append(textEl('p', 'preview-message', '表示できる比較データがありません。'));
    return;
  }
  for (const row of rows) {
    const section = textEl('section', 'preview-row');
    section.append(textEl('h3', '', row.iconName));
    const tags = textEl('div', 'preview-tags');
    for (const text of [row.category, row.background].filter(Boolean)) {
      tags.append(textEl('span', '', text));
    }
    const grid = textEl('div', 'preview-grid');
    grid.append(previewCell('PNG', row.pngFile, row.pngSize, null, `元画像 ${formatImagePixels(row.pngWidth, row.pngHeight) || '-'}`));
    for (const variant of row.variants || []) {
      grid.append(previewCell(`q${variant.quality}`, variant.file, variant.size, row.pngSize));
    }
    section.append(tags, grid);
    elements.previewContent.append(section);
  }
}

function closeQualityPreview() {
  elements.previewOverlay.classList.remove('open');
  elements.previewOverlay.setAttribute('aria-hidden', 'true');
  elements.previewContent.textContent = '';
}

async function refreshPreviewButton() {
  try {
    const state = await invoke('read_quality_preview_state');
    elements.previewBtn.textContent = state?.available ? '比較ページ表示' : '比較ページ生成';
  } catch {
    elements.previewBtn.textContent = '比較ページ生成';
  }
}

async function runSequence(commands) {
  if (running) return;
  running = true;
  canResume = false;
  cancellationRequested = false;
  resetAdaptiveThrottle(progressThrottle);
  setButtonsDisabled(true);
  elements.statusText.textContent = '実行中';
  const startedAt = Date.now();
  try {
    for (let index = 0; index < commands.length; index += 1) {
      const item = commands[index];
      activeCommand = item.command;
      currentRun = {
        startedAt,
        lastTick: 0,
        title: item.command,
        basePercent: (index / commands.length) * 100,
        weightPercent: 100 / commands.length
      };
      resetEtaModel();
      elements.progressTitle.textContent = item.command;
      markStep(item.command, 'running');
      appendLog(`[開始] ${stepDefs.find(step => step.command === item.command)?.label || item.command}`);
      setProgress((index / commands.length) * 100, item.command);
      const resolvedArgs = typeof item.args === 'function' ? item.args() : item.args || [];
      await pipelineOutputReady;
      const output = await invoke('run_pipeline_command', { command: item.command, args: resolvedArgs });
      if (output?.trim()) appendLog(`[完了後出力]\n${output.trimEnd()}`);
      const iconFailureConfirm = item.command === 'icons' ? parseIconFailureConfirm(output || '') : null;
      if (iconFailureConfirm) {
        const shouldContinue = await showConfirm(
          `アイコン失敗率が許容範囲を超えています。\n${iconFailureConfirm.failed}/${iconFailureConfirm.total}件 (${iconFailureConfirm.rate})、許容は0.3%までです。\n公開反映へ進む場合は「実行」、エラー扱いで止める場合は「キャンセル」を選んでください。`
        );
        if (!shouldContinue) {
          markStep(item.command, 'failed');
          elements.statusText.textContent = '確認停止';
          appendLog('アイコン失敗率超過をエラー扱いとして停止しました');
          return;
        }
        appendLog('アイコン失敗率超過を確認し、公開反映へ進みます');
      }
      if (cancellationRequested) {
        markStep(item.command, 'interrupted');
        canResume = true;
        elements.statusText.textContent = '中断';
        appendLog(`${stepDefs.find(step => step.command === item.command)?.label || item.command}を中断しました`);
        return;
      }
      markStep(item.command, 'done');
      setProgress(((index + 1) / commands.length) * 100, item.command);
      setEtaEstimate(((commands.length - index - 1) * (Date.now() - startedAt)) / 1000 / (index + 1));
    }
    setProgress(100, '完了');
    setEtaEstimate(0);
    elements.statusText.textContent = '完了';
  } catch (error) {
    appendLog(String(error));
    if (activeCommand) markStep(activeCommand, cancellationRequested ? 'interrupted' : 'failed');
    canResume = cancellationRequested;
    elements.statusText.textContent = cancellationRequested ? '中断' : '失敗';
  } finally {
    flushLog({ force: true });
    stopEtaCountdown();
    running = false;
    activeCommand = '';
    setButtonsDisabled(false);
  }
}

function parseIconFailureConfirm(output) {
  const match = String(output).match(/ICON_FAILURE_CONFIRM_REQUIRED\s+(\d+)\/(\d+)\s+([0-9.]+%)/);
  return match ? { failed: match[1], total: match[2], rate: match[3] } : null;
}

async function loadUpdateState() {
  const state = await invoke('read_update_state');
  elements.lastChecked.textContent = state?.lastCheckedAt ? new Date(state.lastCheckedAt).toLocaleString('ja-JP') : '-';
}

async function cancelCurrentRun() {
  if (!running) return;
  try {
    cancellationRequested = true;
    updateProgressActions();
    await invoke('cancel_pipeline_command');
    appendLog('中断を要求しました');
    elements.statusText.textContent = '中断中';
  } catch (error) {
    appendLog(String(error));
  }
}

async function restoreWindowSize() {
  const saved = JSON.parse(localStorage.getItem(SIZE_KEY) || 'null');
  const appWindow = getCurrentWindow();
  await appWindow.setMinSize(new LogicalSize(MIN_WIDTH, MIN_HEIGHT));
  const width = Math.max(MIN_WIDTH, Number(saved?.width) || DEFAULT_WIDTH);
  const height = Math.max(MIN_HEIGHT, Number(saved?.height) || DEFAULT_HEIGHT);
  await appWindow.setSize(new LogicalSize(width, height));
  await appWindow.onResized(({ payload }) => {
    const nextWidth = Number(payload?.width);
    const nextHeight = Number(payload?.height);
    if (Number.isFinite(nextWidth) && Number.isFinite(nextHeight)) {
      localStorage.setItem(SIZE_KEY, JSON.stringify({ width: nextWidth, height: nextHeight }));
    }
  });
}

function bindEvents() {
  elements.qualityInput.value = localStorage.getItem(QUALITY_KEY) || '80';
  elements.iconSizeInput.value = localStorage.getItem(ICON_SIZE_KEY) || '80';
  elements.iconDelayInput.value = localStorage.getItem(ICON_DELAY_KEY) || '500';
  elements.lodestoneDelayInput.value = localStorage.getItem(LODESTONE_DELAY_KEY) || '100';
  elements.previewSizeInput.value = localStorage.getItem(PREVIEW_SIZE_KEY) || '80';
  elements.qualityInput.addEventListener('change', () => {
    elements.qualityInput.value = String(clampNumber(elements.qualityInput.value, 1, 100, 80));
    localStorage.setItem(QUALITY_KEY, elements.qualityInput.value);
  });
  elements.iconSizeInput.addEventListener('change', () => {
    elements.iconSizeInput.value = String(clampNumber(elements.iconSizeInput.value, 1, 512, 80));
    localStorage.setItem(ICON_SIZE_KEY, elements.iconSizeInput.value);
  });
  elements.iconDelayInput.addEventListener('change', () => {
    elements.iconDelayInput.value = String(clampNumber(elements.iconDelayInput.value, 0, 60000, 500));
    localStorage.setItem(ICON_DELAY_KEY, elements.iconDelayInput.value);
  });
  elements.lodestoneDelayInput.addEventListener('change', () => {
    elements.lodestoneDelayInput.value = String(clampNumber(elements.lodestoneDelayInput.value, 0, 60000, 100));
    localStorage.setItem(LODESTONE_DELAY_KEY, elements.lodestoneDelayInput.value);
  });
  elements.previewSizeInput.addEventListener('change', () => {
    elements.previewSizeInput.value = String(clampNumber(elements.previewSizeInput.value, 1, 512, 80));
    localStorage.setItem(PREVIEW_SIZE_KEY, elements.previewSizeInput.value);
    elements.previewBtn.textContent = '比較ページ生成';
  });
  elements.clearLogBtn.addEventListener('click', () => {
    pendingLogLines = [];
    if (logFlushTimer) {
      window.clearTimeout(logFlushTimer);
      logFlushTimer = 0;
    }
    elements.log.replaceChildren();
  });
  bindSectionToggles([
    { toggle: elements.csvToggle, body: elements.csvBody },
    { toggle: elements.buildToggle, body: elements.buildBody },
    { toggle: elements.iconQualityToggle, body: elements.iconQualityBody }
  ]);
  elements.validateCsvBtn.addEventListener('click', () => runCommand('validate-csv', [], { title: 'CSV検証' }));
  elements.checkUpdatesBtn.addEventListener('click', () => runCommand('check-updates', [], { title: '更新チェック' }));
  elements.downloadCsvBtn.addEventListener('click', () => confirmAndRun(
    'CSVをダウンロードします。通信が発生します。実行しますか？',
    () => runCommand('download-csv', [], { title: 'CSV取得' })
  ));
  elements.buildBtn.addEventListener('click', () => confirmAndRun(
    'データ生成には時間がかかる場合があります。実行しますか？',
    () => runCommand('build', [], { title: 'データ生成' })
  ));
  elements.publishBtn.addEventListener('click', () => confirmAndRun(
    '検証後に site/data/Item.json を置き換えます。実行しますか？',
    () => runCommand('publish', [], { title: '公開反映' })
  ));
  elements.iconsBtn.addEventListener('click', () => confirmAndRun(
    'アイコン生成には時間がかかり、不足分は Lodestone または XIVAPI から取得します。実行しますか？',
    () => runCommand('icons', ['--quality', elements.qualityInput.value, '--size', elements.iconSizeInput.value, '--delay', elements.iconDelayInput.value], { title: 'アイコン生成' })
  ));
  elements.lodestoneInfoBtn.addEventListener('click', () => confirmAndRun(
    'Lodestoneから店、製作、装備情報を取得して公開候補JSONに反映します。公開データはまだ置き換えません。時間がかかります。実行しますか？',
    () => runCommand('publish-lodestone-info', lodestoneInfoArgs(), { title: 'Lodestone情報反映' })
  ));
  elements.verifyBtn.addEventListener('click', () => runCommand('verify', [], { title: 'Item.json比較' }));
  elements.previewBtn.addEventListener('click', () => confirmAndRun(
    elements.previewBtn.textContent === '比較ページ表示'
      ? '作成済みの比較ページを表示します。実行しますか？'
      : '比較ページ生成には時間がかかり、不足PNGを通信で取得する場合があります。実行しますか？',
    async () => {
      if (elements.previewBtn.textContent === '比較ページ表示') {
        await openQualityPreview();
        return;
      }
      if (await runCommand('tmp-quality-preview', ['--size', elements.previewSizeInput.value], { title: '比較ページ生成' })) {
        await refreshPreviewButton();
        await openQualityPreview();
      }
    }
  ));
  elements.runBtn.addEventListener('click', () => confirmAndRun(
    '全実行はデータ生成、アイコン生成、Lodestone情報反映、公開反映を行います。時間がかかる場合があります。実行しますか？',
    () => runSequence(recommendedSequence)
  ));
  elements.resumeBtn.addEventListener('click', () => confirmAndRun(
    '再開は安全な推奨順を再実行します。元画像キャッシュは再利用されます。実行しますか？',
    () => runSequence(recommendedSequence)
  ));
  elements.cancelBtn.addEventListener('click', cancelCurrentRun);
  elements.confirmOkBtn.addEventListener('click', resolveConfirmOk);
  elements.confirmCancelBtn.addEventListener('click', resolveConfirmCancel);
  elements.confirmOverlay.addEventListener('click', event => {
    if (event.target === elements.confirmOverlay) resolveConfirmCancel();
  });
  elements.previewCloseBtn.addEventListener('click', closeQualityPreview);
  elements.previewOverlay.addEventListener('click', event => {
    if (event.target === elements.previewOverlay) closeQualityPreview();
  });
  for (const [button, className] of [[elements.previewScale2, 'preview-x2'], [elements.previewScale3, 'preview-x3']]) {
    button.addEventListener('click', () => {
      const active = button.classList.contains('active');
      elements.previewContent.classList.remove('preview-x2', 'preview-x3');
      elements.previewScale2.classList.remove('active');
      elements.previewScale3.classList.remove('active');
      if (!active) {
        elements.previewContent.classList.add(className);
        button.classList.add('active');
      }
    });
  }
  elements.previewThemeBtn.addEventListener('click', () => elements.previewContent.classList.toggle('preview-light'));
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && elements.previewOverlay.classList.contains('open')) {
      event.preventDefault();
      closeQualityPreview();
      return;
    }
    if (!pendingConfirm) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      resolveConfirmCancel();
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      resolveConfirmOk();
    }
  });
}

function setSectionExpanded(section, expanded, animate = false) {
  section.toggle.setAttribute('aria-expanded', String(expanded));
  section.toggle.querySelector('.section-toggle-mark').textContent = expanded ? '▼' : '▶';
  if (section.onTransitionEnd) section.body.removeEventListener('transitionend', section.onTransitionEnd);
  if (!animate) {
    section.body.hidden = !expanded;
    section.body.classList.toggle('is-open', expanded);
    section.body.style.maxHeight = expanded ? `${section.body.scrollHeight}px` : '0px';
    return;
  }
  if (expanded) {
    section.body.hidden = false;
    section.body.style.maxHeight = '0px';
    requestAnimationFrame(() => {
      section.body.classList.add('is-open');
      section.body.style.maxHeight = `${section.body.scrollHeight}px`;
    });
    return;
  }
  section.body.style.maxHeight = `${section.body.scrollHeight}px`;
  requestAnimationFrame(() => {
    section.body.classList.remove('is-open');
    section.body.style.maxHeight = '0px';
  });
  section.onTransitionEnd = event => {
    if (event.propertyName !== 'max-height' || section.toggle.getAttribute('aria-expanded') === 'true') return;
    section.body.hidden = true;
    section.body.removeEventListener('transitionend', section.onTransitionEnd);
  };
  section.body.addEventListener('transitionend', section.onTransitionEnd);
}

function bindSectionToggles(sections) {
  accordionSections.splice(0, accordionSections.length, ...sections);
  for (const section of accordionSections) {
    setSectionExpanded(section, section.toggle.getAttribute('aria-expanded') === 'true');
    section.toggle.addEventListener('click', () => {
      if (section.toggle.getAttribute('aria-expanded') === 'true') return;
      for (const candidate of accordionSections) {
        setSectionExpanded(candidate, candidate === section, true);
      }
    });
  }
}

async function confirmAndRun(message, action) {
  if (running) return;
  if (!(await showConfirm(message))) return;
  action();
}

function showConfirm(message) {
  elements.confirmMessage.textContent = message;
  elements.confirmOverlay.classList.add('open');
  elements.confirmOverlay.setAttribute('aria-hidden', 'false');
  elements.confirmOkBtn.focus();
  return new Promise(resolve => {
    pendingConfirm = resolve;
  });
}

function closeConfirm(result) {
  if (!pendingConfirm) return;
  const resolve = pendingConfirm;
  pendingConfirm = null;
  elements.confirmOverlay.classList.remove('open');
  elements.confirmOverlay.setAttribute('aria-hidden', 'true');
  resolve(result);
}

function resolveConfirmOk() {
  closeConfirm(true);
}

function resolveConfirmCancel() {
  closeConfirm(false);
}

function blockBrowserNavigation() {
  window.addEventListener('beforeunload', event => {
    event.preventDefault();
  });
  window.addEventListener('popstate', () => {
    history.pushState(null, '', location.href);
  });
  history.replaceState(null, '', location.href);
  history.pushState(null, '', location.href);

  window.addEventListener('keydown', event => {
    const key = event.key;
    const isReload = key === 'F5' || ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'r');
    const isHistory = (event.altKey && (key === 'ArrowLeft' || key === 'ArrowRight'))
      || ((event.ctrlKey || event.metaKey) && (key === '[' || key === ']'));
    const isBackspaceNavigation = key === 'Backspace'
      && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)
      && !document.activeElement?.isContentEditable;
    if (isReload || isHistory || isBackspaceNavigation) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
}

pipelineOutputReady = listen('pipeline-output', event => {
  const line = String(event.payload || '');
  if (!line) return;
  const etaProgress = parseEtaProgress(line);
  if (etaProgress) {
    updateEtaProgress(etaProgress);
    return;
  }
  appendLog(line);
  const progress = parseProgress(line);
  if (progress) updateTimedProgress(progress.completed, progress.total, progress.detail);
  const cacheUpdate = parseCacheVersionUpdate(line);
  if (cacheUpdate) showCacheVersionUpdate(cacheUpdate);
}).catch(error => {
  appendLog(`実行ログの受信準備に失敗しました: ${String(error)}`);
});

blockBrowserNavigation();
bindEvents();
updateProgressActions();
restoreWindowSize();
loadUpdateState();
refreshPreviewButton();
