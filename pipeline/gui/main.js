const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const { getCurrentWindow, LogicalSize } = window.__TAURI__.window;

const MIN_WIDTH = 760;
const MIN_HEIGHT = 520;
const DEFAULT_WIDTH = 900;
const DEFAULT_HEIGHT = 620;
const SIZE_KEY = 'ffxiv-pipeline-window-size';
const QUALITY_KEY = 'ffxiv-pipeline-webp-quality';

const elements = {
  statusText: document.getElementById('statusText'),
  lastChecked: document.getElementById('lastChecked'),
  checkUpdatesBtn: document.getElementById('checkUpdatesBtn'),
  downloadCsvBtn: document.getElementById('downloadCsvBtn'),
  validateCsvBtn: document.getElementById('validateCsvBtn'),
  buildBtn: document.getElementById('buildBtn'),
  publishBtn: document.getElementById('publishBtn'),
  iconsBtn: document.getElementById('iconsBtn'),
  protectItemBtn: document.getElementById('protectItemBtn'),
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
  previewScale1: document.getElementById('previewScale1'),
  previewScale2: document.getElementById('previewScale2'),
  previewScale3: document.getElementById('previewScale3')
};

const stepDefs = [
  { command: 'protect-item-json', order: '1', label: 'Item.json保護', description: '現在の公開データを比較元として保存します。' },
  { command: 'validate-csv', order: '2', label: 'CSV検証', description: '必須ヘッダーと token-items.csv の形式を確認します。' },
  { command: 'build', order: '3', label: '候補生成', description: '公開候補 JSON を作成します。Item.json はまだ置き換えません。' },
  { command: 'publish', order: '4', label: '公開反映', description: '比較に通った候補で site/data/Item.json を置き換えます。' },
  { command: 'icons', order: '5', label: 'アイコン生成', description: 'WebP アイコンを生成。不足 PNG は取得/キャッシュします。' },
  { command: 'verify', order: '確認', label: 'Item.json比較', description: '比較だけを実行します。site/data/Item.json は変更しません。' },
  { command: 'check-updates', order: '任意', label: '更新チェック', description: '公式 CSV の更新有無と前回チェック日時を確認します。' },
  { command: 'download-csv', order: '任意', label: 'CSV取得', description: '更新または不足した公式 CSV を取得します。' },
  { command: 'tmp-quality-preview', order: '任意', label: '画質比較', description: 'PNG と q50/q60/q70/q80 の一時比較ページを作ります。' }
];
const recommendedSequence = [
  { command: 'validate-csv' },
  { command: 'build' },
  { command: 'publish' },
  { command: 'icons', args: () => ['--quality', elements.qualityInput.value] }
];
const accordionSections = [];
let running = false;
let currentRun = null;
let activeCommand = '';
let pendingConfirm = null;
let cancellationRequested = false;
let canResume = false;
let pipelineOutputReady = Promise.resolve();

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function appendLog(text) {
  elements.log.textContent += text.endsWith('\n') ? text : `${text}\n`;
  elements.log.scrollTop = elements.log.scrollHeight;
}

function setButtonsDisabled(disabled) {
  for (const button of document.querySelectorAll('.action-item button')) {
    button.disabled = disabled;
  }
  elements.qualityInput.disabled = disabled;
  updateProgressActions();
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
  step.classList.remove('running', 'done', 'failed');
  step.classList.add(state);
  const stateEl = step.querySelector('.action-status');
  if (stateEl) {
    stateEl.textContent = state === 'running' ? '● 実行中' : state === 'done' ? '✓ 完了' : state === 'failed' ? '× 失敗' : '○ 未実行';
  }
}

function resetProgress(title) {
  currentRun = { startedAt: Date.now(), lastTick: 0, title };
  elements.progressTitle.textContent = title;
  elements.etaText.textContent = 'ETA -';
  setProgress(0, '開始');
}

function updateTimedProgress(completed, total, detail) {
  const now = Date.now();
  if (now - currentRun.lastTick < 1000 && completed < total) return;
  currentRun.lastTick = now;
  const percent = total > 0 ? (completed / total) * 100 : 0;
  const elapsed = (now - currentRun.startedAt) / 1000;
  const eta = completed > 0 ? ((total - completed) * elapsed) / completed : NaN;
  setProgress(percent, detail);
  elements.etaText.textContent = formatEta(eta);
}

function parseProgress(line) {
  const iconMatch = line.match(/^(?:icons|アイコン|比較) (\d+)\/(\d+)/);
  if (iconMatch) return { completed: Number(iconMatch[1]), total: Number(iconMatch[2]), detail: line };
  const createdMatch = line.match(/^created .* \((\d+)\)/);
  if (createdMatch) return null;
  return null;
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
    setProgress(100, '完了');
    elements.etaText.textContent = 'ETA 0s';
    markStep(command, 'done');
    elements.statusText.textContent = '完了';
    if (command === 'check-updates') await loadUpdateState();
    return true;
  } catch (error) {
    appendLog(String(error));
    markStep(command, 'failed');
    canResume = cancellationRequested;
    elements.statusText.textContent = cancellationRequested ? '中断' : '失敗';
    return false;
  } finally {
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
    appendLog(`比較ページを開けませんでした: ${String(error)}`);
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function textEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function previewCell(label, file, size, baseSize) {
  const cell = textEl('div', 'preview-cell');
  const swatch = textEl('div', 'preview-swatch');
  const img = document.createElement('img');
  img.src = file;
  img.alt = '';
  swatch.append(img);
  cell.append(
    swatch,
    textEl('b', '', label),
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
    for (const text of [row.category, row.background, `q60/current ${Math.round((row.ratio || 0) * 100)}%`]) {
      tags.append(textEl('span', '', text));
    }
    const grid = textEl('div', 'preview-grid');
    grid.append(previewCell('PNG', row.pngFile, row.pngSize, null));
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
  setButtonsDisabled(true);
  elements.statusText.textContent = '実行中';
  const startedAt = Date.now();
  try {
    for (let index = 0; index < commands.length; index += 1) {
      const item = commands[index];
      activeCommand = item.command;
      currentRun = { startedAt, lastTick: 0, title: item.command };
      elements.progressTitle.textContent = item.command;
      markStep(item.command, 'running');
      appendLog(`[開始] ${stepDefs.find(step => step.command === item.command)?.label || item.command}`);
      setProgress((index / commands.length) * 100, item.command);
      const resolvedArgs = typeof item.args === 'function' ? item.args() : item.args || [];
      await pipelineOutputReady;
      const output = await invoke('run_pipeline_command', { command: item.command, args: resolvedArgs });
      if (output?.trim()) appendLog(`[完了後出力]\n${output.trimEnd()}`);
      markStep(item.command, 'done');
      setProgress(((index + 1) / commands.length) * 100, item.command);
      elements.etaText.textContent = formatEta(((commands.length - index - 1) * (Date.now() - startedAt)) / 1000 / (index + 1));
    }
    setProgress(100, '完了');
    elements.etaText.textContent = 'ETA 0s';
    elements.statusText.textContent = '完了';
  } catch (error) {
    appendLog(String(error));
    if (activeCommand) markStep(activeCommand, 'failed');
    canResume = cancellationRequested;
    elements.statusText.textContent = cancellationRequested ? '中断' : '失敗';
  } finally {
    running = false;
    activeCommand = '';
    setButtonsDisabled(false);
  }
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
  elements.qualityInput.value = localStorage.getItem(QUALITY_KEY) || '60';
  elements.qualityInput.addEventListener('change', () => {
    elements.qualityInput.value = String(clampNumber(elements.qualityInput.value, 1, 100, 60));
    localStorage.setItem(QUALITY_KEY, elements.qualityInput.value);
  });
  elements.clearLogBtn.addEventListener('click', () => {
    elements.log.textContent = '';
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
    'アイコン生成には時間がかかり、不足分は通信で取得します。実行しますか？',
    () => runCommand('icons', ['--quality', elements.qualityInput.value], { title: 'アイコン生成' })
  ));
  elements.protectItemBtn.addEventListener('click', () => runCommand('protect-item-json', [], { title: 'Item.json保護' }));
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
      if (await runCommand('tmp-quality-preview', [], { title: '比較ページ生成' })) {
        await refreshPreviewButton();
        await openQualityPreview();
      }
    }
  ));
  elements.runBtn.addEventListener('click', () => confirmAndRun(
    '全実行はデータ生成、公開反映、アイコン生成を行います。時間がかかる場合があります。実行しますか？',
    () => runSequence(recommendedSequence)
  ));
  elements.resumeBtn.addEventListener('click', () => confirmAndRun(
    '再開は安全な推奨順を再実行します。既存成果物とアイコンは再利用されます。実行しますか？',
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
  for (const [button, className] of [[elements.previewScale1, ''], [elements.previewScale2, 'preview-x2'], [elements.previewScale3, 'preview-x3']]) {
    button.addEventListener('click', () => {
      elements.previewContent.classList.remove('preview-x2', 'preview-x3');
      if (className) elements.previewContent.classList.add(className);
      for (const scaleButton of [elements.previewScale1, elements.previewScale2, elements.previewScale3]) scaleButton.classList.remove('active');
      button.classList.add('active');
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
  appendLog(line);
  const progress = parseProgress(line);
  if (progress) updateTimedProgress(progress.completed, progress.total, progress.detail);
}).catch(error => {
  appendLog(`実行ログの受信準備に失敗しました: ${String(error)}`);
});

blockBrowserNavigation();
bindEvents();
updateProgressActions();
restoreWindowSize();
loadUpdateState();
refreshPreviewButton();
