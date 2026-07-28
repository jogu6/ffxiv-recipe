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
const OXIDIZER_SOURCE_KEY = 'ffxiv-pipeline-oxidizer-source';
const FFXIV_GAME_PATH_KEY = 'ffxiv-pipeline-game-path';

const elements = {
  appTitle: document.getElementById('appTitle'),
  statusText: document.getElementById('statusText'),
  lastChecked: document.getElementById('lastChecked'),
  workflowGuide: document.getElementById('workflowGuide'),
  checkUpdatesBtn: document.getElementById('checkUpdatesBtn'),
  downloadCsvBtn: document.getElementById('downloadCsvBtn'),
  oxidizerSourceInput: document.getElementById('oxidizerSourceInput'),
  ffxivGamePathInput: document.getElementById('ffxivGamePathInput'),
  oxidizerForceInput: document.getElementById('oxidizerForceInput'),
  selectOxidizerSourceBtn: document.getElementById('selectOxidizerSourceBtn'),
  selectFfxivGamePathBtn: document.getElementById('selectFfxivGamePathBtn'),
  validateCsvBtn: document.getElementById('validateCsvBtn'),
  buildBtn: document.getElementById('buildBtn'),
  publishBtn: document.getElementById('publishBtn'),
  equipmentRoleBtn: document.getElementById('equipmentRoleBtn'),
  equipmentRoleCount: document.getElementById('equipmentRoleCount'),
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
  openLogFolderBtn: document.getElementById('openLogFolderBtn'),
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
  previewScale3: document.getElementById('previewScale3'),
  equipmentRoleOverlay: document.getElementById('equipmentRoleOverlay'),
  equipmentRoleSummary: document.getElementById('equipmentRoleSummary'),
  equipmentRoleList: document.getElementById('equipmentRoleList'),
  equipmentRoleCloseBtn: document.getElementById('equipmentRoleCloseBtn'),
  equipmentRoleSaveBtn: document.getElementById('equipmentRoleSaveBtn'),
  publicationReviewOverlay: document.getElementById('publicationReviewOverlay'),
  publicationReviewSummary: document.getElementById('publicationReviewSummary'),
  publicationReviewList: document.getElementById('publicationReviewList'),
  publicationReviewCloseBtn: document.getElementById('publicationReviewCloseBtn'),
  publicationReviewSaveBtn: document.getElementById('publicationReviewSaveBtn'),
  oxidizerDiffOverlay: document.getElementById('oxidizerDiffOverlay'),
  oxidizerDiffSummary: document.getElementById('oxidizerDiffSummary'),
  oxidizerDiffList: document.getElementById('oxidizerDiffList'),
  oxidizerDiffCloseBtn: document.getElementById('oxidizerDiffCloseBtn'),
  oxidizerDiffLodestoneBtn: document.getElementById('oxidizerDiffLodestoneBtn'),
  oxidizerDiffImportBtn: document.getElementById('oxidizerDiffImportBtn'),
  postImportOverlay: document.getElementById('postImportOverlay'),
  postImportRunAllBtn: document.getElementById('postImportRunAllBtn'),
  postImportCloseBtn: document.getElementById('postImportCloseBtn')
};

let uiDefinition = null;
let actionDefs = [];
let stepDefs = [];
let recommendedSequence = [];
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
let equipmentRoleGroups = [];
let equipmentRoleOverrides = {};
let equipmentRoleCollapsedKeys = new Set();
let equipmentRoleSavedSnapshot = '{}';
let equipmentRoleRefreshCommands = new Set();
let publicationReviewRows = [];
let publicationReviewEdits = {};
let oxidizerDiffReport = null;
let uiCompatibilityMessages = [];
let workflowStatus = null;

let equipmentRoleLabels = {};

function actionDefinition(idOrCommand) {
  return actionDefs.find(action => action.id === idOrCommand || action.command === idOrCommand);
}

function validateRuntimeUiDefinition(value) {
  if (!value || value.schemaVersion !== 1) throw new Error('未対応のUI定義です。');
  if (!value.application?.title || !value.application?.idleStatus) throw new Error('UI定義にアプリ情報がありません。');
  if (!Array.isArray(value.sections) || !Array.isArray(value.actions) || !Array.isArray(value.recommendedSequence)) {
    throw new Error('UI定義の配列が不正です。');
  }
  const actionIds = new Set();
  for (const action of value.actions) {
    if (!action.id || actionIds.has(action.id)) throw new Error(`UI操作IDが不正です: ${action.id || ''}`);
    actionIds.add(action.id);
    if (!action.buttonId) throw new Error(`UI操作のボタンIDがありません: ${action.id}`);
  }
}

function resolveActionArgs(action, property = 'args') {
  const mappings = action?.[property] || action?.args || [];
  const args = [];
  for (const mapping of mappings) {
    if (mapping.type === 'checkbox') {
      if (document.getElementById(mapping.inputId)?.checked) args.push(mapping.flag);
      continue;
    }
    const value = mapping.inputId ? document.getElementById(mapping.inputId)?.value : mapping.value;
    if (mapping.omitEmpty && !String(value ?? '').trim()) continue;
    args.push(mapping.flag, String(value ?? ''));
  }
  return args;
}

function applyUiDefinition(value) {
  validateRuntimeUiDefinition(value);
  uiDefinition = value;
  uiCompatibilityMessages = [];
  actionDefs = value.actions.filter(action => {
    const button = document.getElementById(action.buttonId);
    const item = document.querySelector(`.action-item[data-step="${action.command || action.id}"]`)
      || document.querySelector(`.action-item[data-action-id="${action.id}"]`);
    if (button && item) return true;
    uiCompatibilityMessages.push(`このexeに未搭載の操作を無視しました: ${action.label || action.id}`);
    return false;
  });
  equipmentRoleLabels = value.equipmentRoleLabels;
  stepDefs = actionDefs.map(action => ({ ...action, command: action.command || action.id }));
  equipmentRoleRefreshCommands = new Set(
    actionDefs.filter(action => action.refreshEquipmentRole && action.command).map(action => action.command)
  );
  recommendedSequence = value.recommendedSequence.flatMap(command => {
    const action = actionDefinition(command);
    if (!action) {
      uiCompatibilityMessages.push(`このexeに未搭載の一括操作を無視しました: ${command}`);
      return [];
    }
    return [{ command, args: () => resolveActionArgs(action, 'sequenceArgs') }];
  });

  document.title = value.application.title;
  elements.appTitle.textContent = value.application.title;
  elements.statusText.textContent = value.application.idleStatus;

  for (const section of value.sections) {
    const toggle = document.getElementById(section.toggleId);
    const body = document.getElementById(section.bodyId);
    if (!toggle || !body) {
      uiCompatibilityMessages.push(`このexeに未搭載のセクションを無視しました: ${section.label || section.id}`);
      continue;
    }
    toggle.querySelector('span:last-child').textContent = section.label;
    toggle.setAttribute('aria-expanded', String(Boolean(section.expanded)));
  }

  for (const action of actionDefs) {
    const button = document.getElementById(action.buttonId);
    const item = document.querySelector(`.action-item[data-step="${action.command || action.id}"]`)
      || document.querySelector(`.action-item[data-action-id="${action.id}"]`);
    if (!item) throw new Error(`UI操作領域が見つかりません: ${action.id}`);
    button.textContent = action.label;
    item.querySelector('.order-label').textContent = action.order;
    item.querySelector(':scope > p').textContent = action.description;
  }

  elements.progressTitle.textContent = value.chrome.progressTitle;
  elements.progressDetail.textContent = value.chrome.progressIdle;
  elements.cancelBtn.textContent = value.chrome.cancel;
  elements.resumeBtn.textContent = value.chrome.resume;
  elements.clearLogBtn.textContent = value.chrome.clearLog;
  elements.confirmOkBtn.textContent = value.chrome.confirmOk;
  elements.confirmCancelBtn.textContent = value.chrome.confirmCancel;
  document.getElementById('previewTitle').textContent = value.chrome.previewTitle;
  elements.previewCloseBtn.textContent = value.chrome.previewClose;
  document.getElementById('equipmentRoleTitle').textContent = value.chrome.equipmentRoleTitle;
  elements.equipmentRoleCloseBtn.textContent = value.chrome.equipmentRoleClose;
  elements.equipmentRoleSaveBtn.textContent = value.chrome.equipmentRoleSave;
}

async function loadUiDefinition() {
  applyUiDefinition(await invoke('read_pipeline_ui_definition'));
}

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
  if (!disabled) applyWorkflowControls();
  updateProgressActions();
}

function workflowCommandComplete(command) {
  if (!workflowStatus) return false;
  if (command === 'build') return Boolean(workflowStatus.stages?.build?.complete);
  if (command === 'publish-lodestone-info') {
    return Boolean(workflowStatus.stages?.lodestone?.complete) && !elements.lodestoneForceInput.checked;
  }
  if (command === 'icons') {
    const stage = workflowStatus.stages?.icons;
    return Boolean(
      stage?.complete
      && Number(stage.quality) === Number(elements.qualityInput.value)
      && Number(stage.size) === Number(elements.iconSizeInput.value)
    );
  }
  if (command === 'publish') return Boolean(workflowStatus.stages?.publish?.complete);
  return false;
}

function setWorkflowStepState(command, { complete = false, enabled = true } = {}) {
  const item = document.querySelector(`.action-item[data-step="${command}"]`);
  if (!item || item.classList.contains('running')) return;
  if (!complete && (item.classList.contains('failed') || item.classList.contains('interrupted'))) return;
  const status = item.querySelector('.action-status');
  item.classList.remove('done', 'failed', 'interrupted');
  if (complete) {
    item.classList.add('done');
    if (status) status.textContent = '✓ 完了済み';
  } else if (!enabled) {
    if (status) status.textContent = '— 前の工程を完了してください';
  } else if (status) {
    status.textContent = '○ 実行可能';
  }
}

function applyWorkflowControls() {
  if (!uiDefinition || !workflowStatus || running) return;
  const stages = workflowStatus.stages || {};
  const inputAvailable = Boolean(workflowStatus.inputAvailable);
  const iconCompleteForSettings = workflowCommandComplete('icons');
  const actionButton = id => document.getElementById(actionDefinition(id)?.buttonId || '');

  const importButton = actionButton('oxidizer-import');
  if (importButton) importButton.disabled = Boolean(workflowStatus.import?.sourceMatchesInput);
  setWorkflowStepState('oxidizer-import', {
    complete: Boolean(workflowStatus.import?.sourceMatchesInput),
    enabled: true
  });

  const buildButton = actionButton('build');
  if (buildButton) buildButton.disabled = !inputAvailable || Boolean(stages.build?.complete);
  setWorkflowStepState('build', { complete: Boolean(stages.build?.complete), enabled: inputAvailable });

  const lodestoneButton = actionButton('publish-lodestone-info');
  const lodestoneComplete = Boolean(stages.lodestone?.complete);
  if (lodestoneButton) {
    lodestoneButton.disabled = !stages.lodestone?.enabled || (lodestoneComplete && !elements.lodestoneForceInput.checked);
  }
  setWorkflowStepState('publish-lodestone-info', {
    complete: lodestoneComplete && !elements.lodestoneForceInput.checked,
    enabled: Boolean(stages.lodestone?.enabled)
  });

  const iconsButton = actionButton('icons');
  if (iconsButton) iconsButton.disabled = !stages.icons?.enabled || iconCompleteForSettings;
  setWorkflowStepState('icons', {
    complete: iconCompleteForSettings,
    enabled: Boolean(stages.icons?.enabled)
  });

  const reviewButton = actionButton('publication-review');
  if (reviewButton) reviewButton.disabled = !lodestoneComplete;
  setWorkflowStepState('publication-review', { enabled: lodestoneComplete });

  const equipmentButton = actionButton('equipment-role-groups');
  if (equipmentButton) equipmentButton.disabled = !lodestoneComplete;
  setWorkflowStepState('equipment-role-groups', { enabled: lodestoneComplete });

  const publishButton = actionButton('publish');
  if (publishButton) publishButton.disabled = !stages.publish?.enabled || Boolean(stages.publish?.complete);
  setWorkflowStepState('publish', {
    complete: Boolean(stages.publish?.complete),
    enabled: Boolean(stages.publish?.enabled)
  });

  const runAllButton = actionButton('run-all');
  if (runAllButton) {
    runAllButton.disabled = !inputAvailable || (Boolean(stages.publish?.complete) && iconCompleteForSettings);
  }

  const nextLabels = {
    build: '次の工程: 公開候補を生成します。「公開工程を続行」を実行してください。',
    'publish-lodestone-info': '次の工程: Lodestone情報を公開候補へ反映します。完了済みの生成処理は再実行しません。',
    icons: '次の工程: 確認済み項目のアイコンを生成します。Lodestone情報の再取得は不要です。',
    publish: '次の工程: 公開反映です。必要なら先に「公式公開判定」を確認してください。',
    complete: 'すべての公開工程が完了しています。同じ入力での再実行は不要です。'
  };
  const effectiveNext =
    stages.lodestone?.complete && !iconCompleteForSettings ? 'icons' : workflowStatus.next;
  elements.workflowGuide.textContent = nextLabels[effectiveNext] || '工程状態を確認できませんでした。';
}

async function refreshWorkflowStatus({ silent = false } = {}) {
  try {
    workflowStatus = await invoke('read_pipeline_workflow_status');
    applyWorkflowControls();
  } catch (error) {
    workflowStatus = null;
    if (!silent) appendLog(`工程状態を読み込めませんでした: ${String(error)}`);
  }
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
    if (equipmentRoleRefreshCommands.has(command)) await refreshEquipmentRoleCount();
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
    await refreshWorkflowStatus({ silent: true });
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

function roleLabel(role) {
  return equipmentRoleLabels[role] || role;
}

function updateEquipmentRoleSummary() {
  const total = equipmentRoleGroups.length;
  const selected = equipmentRoleGroups.filter(group => equipmentRoleOverrides[group.key]).length;
  const unselected = total - selected;
  elements.equipmentRoleSummary.textContent = total
    ? `指定済み ${selected} / 未指定 ${unselected} / 全${total}グループ`
    : '指定が必要な装備はありません。';
  elements.equipmentRoleSaveBtn.textContent = '保存';
  elements.equipmentRoleSaveBtn.disabled = false;
  if (elements.equipmentRoleCount) {
    elements.equipmentRoleCount.textContent = total
      ? `指定済み ${selected} / 未指定 ${unselected}`
      : '指定対象なし';
  }
}

function renderEquipmentRoleGroups() {
  elements.equipmentRoleList.replaceChildren();
  if (equipmentRoleGroups.length === 0) {
    elements.equipmentRoleList.append(textEl('p', 'preview-message', '指定が必要な装備はありません。'));
    updateEquipmentRoleSummary();
    return;
  }
  for (const group of equipmentRoleGroups) {
    const section = document.createElement('section');
    section.className = 'equipment-role-group';
    section.classList.toggle('collapsed', equipmentRoleCollapsedKeys.has(group.key));
    const header = document.createElement('div');
    header.className = 'equipment-role-group-header';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'equipment-role-toggle';
    toggle.textContent = equipmentRoleCollapsedKeys.has(group.key) ? '▶' : '▼';
    const title = document.createElement('div');
    title.className = 'equipment-role-title';
    title.textContent = `Lv${group.equipLevel} / IL${group.itemLevel} / ${group.commonToken} / ${group.items.length}件`;
    const status = document.createElement('span');
    status.className = 'equipment-role-status';
    status.textContent = equipmentRoleOverrides[group.key] ? roleLabel(equipmentRoleOverrides[group.key]) : '未指定';
    header.append(toggle, title, status);

    const body = document.createElement('div');
    body.className = 'equipment-role-body';
    const options = document.createElement('div');
    options.className = 'equipment-role-options';
    for (const role of ['', ...(group.candidates || [])]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = role ? roleLabel(role) : '未指定';
      button.classList.toggle('active', (equipmentRoleOverrides[group.key] || '') === role);
      button.addEventListener('click', () => {
        const scrollTop = elements.equipmentRoleList.scrollTop;
        if (role) equipmentRoleOverrides[group.key] = role;
        else {
          delete equipmentRoleOverrides[group.key];
          equipmentRoleCollapsedKeys.delete(group.key);
        }
        renderEquipmentRoleGroups();
        elements.equipmentRoleList.scrollTop = scrollTop;
      });
      options.append(button);
    }
    const items = document.createElement('div');
    items.className = 'equipment-role-items';
    for (const item of group.items || []) {
      const row = document.createElement('div');
      row.className = 'equipment-role-item';
      const icon = document.createElement('img');
      icon.className = 'equipment-role-item-icon';
      icon.alt = '';
      if (item.iconDataUrl) icon.src = item.iconDataUrl;
      const itemName = document.createElement('span');
      itemName.className = 'equipment-role-item-name';
      itemName.textContent = `${item.name}（${item.category || '-'}）`;
      const itemInfo = document.createElement('span');
      itemInfo.className = 'equipment-role-item-info';
      const stats = document.createElement('span');
      stats.className = 'equipment-role-item-stats';
      stats.textContent = Object.entries(item.stats || {})
        .filter(([, value]) => Number(value) > 0)
        .map(([name, value]) => `${name} +${value}`)
        .join(' / ');
      itemInfo.append(itemName);
      if (stats.textContent) itemInfo.append(stats);
      row.append(icon, itemInfo);
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'equipment-role-link';
      link.textContent = 'Lodestone';
      link.disabled = !item.lodestoneUrl;
      link.addEventListener('click', () => {
        if (item.lodestoneUrl) invoke('open_external_url', { url: item.lodestoneUrl });
      });
      row.append(link);
      items.append(row);
    }
    body.append(options, items);
    const toggleGroup = () => {
      section.classList.toggle('collapsed');
      if (section.classList.contains('collapsed')) {
        equipmentRoleCollapsedKeys.add(group.key);
        toggle.textContent = '▶';
      } else {
        equipmentRoleCollapsedKeys.delete(group.key);
        toggle.textContent = '▼';
      }
    };
    header.addEventListener('click', event => {
      if (event.target.closest('button')) return;
      toggleGroup();
    });
    toggle.addEventListener('click', toggleGroup);
    section.append(header, body);
    elements.equipmentRoleList.append(section);
  }
  updateEquipmentRoleSummary();
}

async function openEquipmentRoleDialog() {
  if (running) return;
  markStep('equipment-role-groups', 'running');
  elements.equipmentRoleOverlay.classList.add('open');
  elements.equipmentRoleOverlay.setAttribute('aria-hidden', 'false');
  elements.equipmentRoleList.replaceChildren(textEl('p', 'preview-message', '読み込み中...'));
  elements.equipmentRoleSummary.textContent = '読み込み中...';
  try {
    equipmentRoleGroups = await invoke('read_equipment_role_groups');
    equipmentRoleOverrides = Object.fromEntries(
      equipmentRoleGroups
        .filter(group => group.selectedRole)
        .map(group => [group.key, group.selectedRole])
    );
    equipmentRoleSavedSnapshot = JSON.stringify(equipmentRoleOverrides);
    equipmentRoleCollapsedKeys = new Set(
      equipmentRoleGroups
        .filter(group => group.selectedRole)
        .map(group => group.key)
    );
    renderEquipmentRoleGroups();
    markStep('equipment-role-groups', 'done');
  } catch (error) {
    elements.equipmentRoleList.replaceChildren(textEl('p', 'preview-message', `読み込みに失敗しました: ${String(error)}`));
    elements.equipmentRoleSummary.textContent = '読み込み失敗';
    markStep('equipment-role-groups', 'failed');
  }
}

async function closeEquipmentRoleDialog({ force = false } = {}) {
  if (!force && JSON.stringify(equipmentRoleOverrides) !== equipmentRoleSavedSnapshot) {
    if (!(await showConfirm(
      '推奨ロールの変更が保存されていません。保存せずに閉じると、今回の変更内容は失われます。保存せずに閉じますか？',
      { okLabel: 'はい', cancelLabel: 'いいえ' }
    ))) return;
  }
  elements.equipmentRoleOverlay.classList.remove('open');
  elements.equipmentRoleOverlay.setAttribute('aria-hidden', 'true');
}

async function saveEquipmentRoleOverrides() {
  try {
    await invoke('save_equipment_role_overrides', { overrides: equipmentRoleOverrides });
    equipmentRoleSavedSnapshot = JSON.stringify(equipmentRoleOverrides);
    updateEquipmentRoleSummary();
    await refreshEquipmentRoleCount();
    await closeEquipmentRoleDialog({ force: true });
    appendLog('推奨ロール指定を保存しました');
    markStep('equipment-role-groups', 'done');
  } catch (error) {
    appendLog(`推奨ロール指定の保存に失敗しました: ${String(error)}`);
    markStep('equipment-role-groups', 'failed');
  }
}

async function refreshEquipmentRoleCount() {
  try {
    const summary = await invoke('read_equipment_role_summary');
    if (elements.equipmentRoleCount) {
      elements.equipmentRoleCount.textContent = `指定済み ${summary.selected} / 未指定 ${summary.unselected}`;
    }
  } catch {
    if (elements.equipmentRoleCount) elements.equipmentRoleCount.textContent = '指定状況を取得できませんでした';
  }
}

function renderPublicationReview() {
  elements.publicationReviewList.replaceChildren();
  if (!publicationReviewRows.length) {
    elements.publicationReviewList.append(textEl('p', 'preview-message', '確認が必要な項目はありません。'));
    elements.publicationReviewSummary.textContent = '未分類 0件';
    return;
  }
  let unreviewed = 0;
  for (const row of publicationReviewRows) {
    const edit = publicationReviewEdits[row.id] || {
      decision: ['keep', 'exclude', 'hold'].includes(row.status) ? row.status : '',
      reason: row.reason || '',
      iconSource: row.iconSource || 'none'
    };
    publicationReviewEdits[row.id] = edit;
    if (!edit.decision && row.status !== 'lodestone') unreviewed += 1;
    const item = document.createElement('section');
    item.className = 'publication-review-item';
    const info = document.createElement('div');
    info.className = 'publication-review-name';
    info.textContent = `${row.id} ${row.name}`;
    const meta = document.createElement('div');
    meta.className = 'publication-review-meta';
    meta.textContent = [
      row.lodestoneConfirmed ? 'Lodestone確認済み' : 'Lodestone未確認',
      row.existing ? '既存' : '新規',
      `参照レシピ ${row.recipeReferences}件`
    ].join(' / ');
    info.append(meta);
    const options = document.createElement('div');
    options.className = 'publication-review-options';
    for (const [decision, label] of [['keep', '維持'], ['exclude', '除外'], ['hold', '保留']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.classList.toggle('active', edit.decision === decision);
      button.addEventListener('click', () => {
        edit.decision = decision;
        renderPublicationReview();
      });
      options.append(button);
    }
    const iconSource = document.createElement('select');
    iconSource.setAttribute('aria-label', 'アイコン取得元');
    for (const [value, label] of [['none', '画像なし'], ['lodestone', 'Lodestone'], ['xivapi', 'XIVAPI']]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      iconSource.append(option);
    }
    iconSource.value = edit.iconSource;
    iconSource.addEventListener('change', () => {
      edit.iconSource = iconSource.value;
    });
    options.append(iconSource);
    const reason = document.createElement('input');
    reason.type = 'text';
    reason.className = 'publication-review-reason';
    reason.placeholder = '判断理由（例: exchange-currency）';
    reason.value = edit.reason;
    reason.addEventListener('input', () => {
      edit.reason = reason.value;
    });
    item.append(info, options, reason);
    elements.publicationReviewList.append(item);
  }
  elements.publicationReviewSummary.textContent = `対象 ${publicationReviewRows.length}件 / 未分類 ${unreviewed}件`;
}

async function openPublicationReviewDialog() {
  if (running) return;
  markStep('publication-review', 'running');
  elements.publicationReviewOverlay.classList.add('open');
  elements.publicationReviewOverlay.setAttribute('aria-hidden', 'false');
  elements.publicationReviewList.replaceChildren(textEl('p', 'preview-message', '読み込み中...'));
  try {
    publicationReviewRows = await invoke('read_publication_review');
    publicationReviewEdits = {};
    renderPublicationReview();
    markStep('publication-review', 'done');
  } catch (error) {
    elements.publicationReviewList.replaceChildren(textEl('p', 'preview-message', `読み込みに失敗しました: ${String(error)}`));
    elements.publicationReviewSummary.textContent = '読み込み失敗';
    markStep('publication-review', 'failed');
  }
}

function closePublicationReviewDialog() {
  elements.publicationReviewOverlay.classList.remove('open');
  elements.publicationReviewOverlay.setAttribute('aria-hidden', 'true');
}

async function savePublicationReview() {
  const items = {};
  for (const [id, edit] of Object.entries(publicationReviewEdits)) {
    if (!edit.decision) continue;
    if (!String(edit.reason || '').trim()) {
      appendLog(`${id}: 判断理由を入力してください`);
      return;
    }
    items[id] = {
      decision: edit.decision,
      reason: String(edit.reason).trim(),
      iconSource: edit.iconSource || 'none'
    };
  }
  try {
    await invoke('save_publication_decisions', { decisions: { version: 1, items } });
    appendLog(`公式公開判定を保存しました: ${Object.keys(items).length}件`);
    closePublicationReviewDialog();
    markStep('publication-review', 'done');
  } catch (error) {
    appendLog(`公式公開判定の保存に失敗しました: ${String(error)}`);
    markStep('publication-review', 'failed');
  }
}

function formatDiffValue(value) {
  if (value === null || value === undefined) return 'なし';
  if (typeof value === 'string') return value || '（空文字）';
  return JSON.stringify(value);
}

function appendOxidizerDiffGroup(title, rows, kind) {
  const preflightById = new Map(
    (oxidizerDiffReport?.lodestonePreflight?.results || []).map(row => [String(row.ID), row])
  );
  const group = document.createElement('section');
  group.className = 'oxidizer-diff-group';
  group.append(textEl('h3', '', `${title} ${rows.length}件`));
  if (!rows.length) {
    group.append(textEl('p', 'preview-message', '該当なし'));
  }
  for (const row of rows) {
    const item = document.createElement('div');
    item.className = 'oxidizer-diff-item';
    item.append(textEl('strong', '', `${row.ID} ${row.Name || row.BeforeName || '（名称なし）'}`));
    if (kind !== 'removed') {
      const preflight = preflightById.get(String(row.ID));
      const labels = {
        verified: 'Lodestone・情報・アイコン確認済み',
        'not-found': 'Lodestone未掲載',
        'data-failed': 'Lodestone情報取得失敗',
        'icon-failed': 'Lodestoneアイコン取得失敗'
      };
      const status = textEl(
        'div',
        `oxidizer-lodestone-status ${preflight?.status || 'unverified'}`,
        preflight ? labels[preflight.status] || preflight.status : 'Lodestone未確認'
      );
      if (preflight?.error) status.title = preflight.error;
      item.append(status);
      if (preflight?.info) {
        item.append(textEl(
          'div',
          'oxidizer-lodestone-info',
          `店 ${preflight.info.shopSales} / 製作 ${preflight.info.craftInfo} / ` +
          `装備 ${preflight.info.equipmentInfo ? 'あり' : 'なし'} / EX ${preflight.info.isEx ? 'あり' : 'なし'}`
        ));
      }
    }
    if (kind === 'changed') {
      const fields = document.createElement('ul');
      fields.className = 'oxidizer-diff-fields';
      if (!Array.isArray(row.Fields)) {
        fields.append(textEl('li', '', '詳細なし。もう一度「CSV取り込み確認」を実行してください。'));
      } else {
        for (const field of row.Fields) {
          const line = document.createElement('li');
          const label = document.createElement('strong');
          label.textContent = `${field.field}: `;
          const values = document.createElement('code');
          values.textContent = `${formatDiffValue(field.before)} → ${formatDiffValue(field.after)}`;
          line.append(label, values);
          fields.append(line);
        }
      }
      item.append(fields);
    }
    group.append(item);
  }
  elements.oxidizerDiffList.append(group);
}

function renderOxidizerDiff() {
  const report = oxidizerDiffReport || {};
  const preflight = report.lodestonePreflight;
  elements.oxidizerDiffList.replaceChildren();
  elements.oxidizerDiffSummary.textContent =
    `現行 ${report.currentCount || 0}件 / 候補 ${report.candidateCount || 0}件 / ` +
    `追加 ${report.addedCount || 0}件 / 削除 ${report.removedCount || 0}件 / 変更 ${report.changedCount || 0}件` +
    (preflight
      ? ` — Lodestone確認済み ${preflight.verified}件 / 未掲載 ${preflight.notFound}件 / ` +
        `情報失敗 ${preflight.dataFailed}件 / アイコン失敗 ${preflight.iconFailed}件`
      : ' — Lodestone未確認');
  appendOxidizerDiffGroup('追加', report.added || [], 'added');
  appendOxidizerDiffGroup('変更', report.changed || [], 'changed');
  appendOxidizerDiffGroup('削除', report.removed || [], 'removed');
  elements.oxidizerDiffLodestoneBtn.disabled = report.status !== 'previewed';
  elements.oxidizerDiffLodestoneBtn.textContent = preflight ? 'Lodestoneを再確認' : 'Lodestone事前確認';
  elements.oxidizerDiffImportBtn.disabled = report.status !== 'previewed' || !preflight;
  elements.oxidizerDiffImportBtn.textContent =
    report.status === 'previewed' ? 'CSVをローカル反映' : '反映済み';
}

async function openOxidizerDiffDialog() {
  elements.oxidizerDiffOverlay.classList.add('open');
  elements.oxidizerDiffOverlay.setAttribute('aria-hidden', 'false');
  elements.oxidizerDiffList.replaceChildren(textEl('p', 'preview-message', '読み込み中...'));
  elements.oxidizerDiffSummary.textContent = '読み込み中...';
  try {
    oxidizerDiffReport = await invoke('read_oxidizer_import_preview');
    renderOxidizerDiff();
  } catch (error) {
    elements.oxidizerDiffList.replaceChildren(
      textEl('p', 'preview-message', `差分を読み込めませんでした: ${String(error)}`)
    );
    elements.oxidizerDiffSummary.textContent = '読み込み失敗';
    elements.oxidizerDiffImportBtn.disabled = true;
  }
}

function closeOxidizerDiffDialog() {
  elements.oxidizerDiffOverlay.classList.remove('open');
  elements.oxidizerDiffOverlay.setAttribute('aria-hidden', 'true');
}

function openPostImportDialog() {
  elements.postImportOverlay.classList.add('open');
  elements.postImportOverlay.setAttribute('aria-hidden', 'false');
}

function closePostImportDialog() {
  elements.postImportOverlay.classList.remove('open');
  elements.postImportOverlay.setAttribute('aria-hidden', 'true');
}

function continueWithFullRun() {
  closePostImportDialog();
  const action = actionDefinition('run-all');
  confirmAndRun(action.confirm, () => runSequence(recommendedSequence));
}

async function verifyOxidizerDiffWithLodestone() {
  closeOxidizerDiffDialog();
  const args = [];
  const source = elements.oxidizerSourceInput.value.trim();
  if (source) args.push('--source', source);
  args.push('--delay', elements.lodestoneDelayInput.value);
  await runCommand(
    'oxidizer-lodestone-preview',
    args,
    { title: 'Lodestone事前確認' }
  );
  await openOxidizerDiffDialog();
}

async function importReviewedOxidizerCsv() {
  closeOxidizerDiffDialog();
  const approved = await showConfirm(
    '表示中の検証済みCSVをpipeline入力へ反映します。既存CSVはローカルバックアップへ保護されます。実行しますか？'
  );
  if (!approved) {
    await openOxidizerDiffDialog();
    return;
  }
  const succeeded = await runCommand(
    'oxidizer-import',
    resolveActionArgs(actionDefinition('oxidizer-import')),
    { title: actionDefinition('oxidizer-import').label }
  );
  if (succeeded) openPostImportDialog();
}

async function refreshPreviewButton() {
  const previewAction = actionDefinition('tmp-quality-preview');
  try {
    const state = await invoke('read_quality_preview_state');
    elements.previewBtn.textContent = state?.available ? previewAction.availableLabel : previewAction.label;
  } catch {
    elements.previewBtn.textContent = previewAction.label;
  }
}

async function runSequence(commands) {
  if (running) return;
  await refreshWorkflowStatus({ silent: true });
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
      if (workflowCommandComplete(item.command)) {
        const label = stepDefs.find(step => step.command === item.command)?.label || item.command;
        markStep(item.command, 'done');
        appendLog(`[省略] ${label}: 現在の入力に対して完了済みです`);
        setProgress(((index + 1) / commands.length) * 100, `${label} 完了済み`);
        continue;
      }
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
      await refreshWorkflowStatus({ silent: true });
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
      if (equipmentRoleRefreshCommands.has(item.command)) await refreshEquipmentRoleCount();
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
    await refreshWorkflowStatus({ silent: true });
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

function bindActionButtons() {
  for (const action of actionDefs) {
    const button = document.getElementById(action.buttonId);
    if (action.behavior === 'equipment-role-dialog') {
      button.addEventListener('click', openEquipmentRoleDialog);
      continue;
    }
    if (action.behavior === 'publication-review-dialog') {
      button.addEventListener('click', openPublicationReviewDialog);
      continue;
    }
    if (action.behavior === 'oxidizer-import-preview') {
      button.addEventListener('click', async () => {
        if (await runCommand(action.command, resolveActionArgs(action), { title: action.label })) {
          await openOxidizerDiffDialog();
        }
      });
      continue;
    }
    if (action.behavior === 'sequence') {
      button.addEventListener('click', () => confirmAndRun(action.confirm, () => runSequence(recommendedSequence)));
      continue;
    }
    if (action.behavior === 'quality-preview') {
      button.addEventListener('click', () => {
        const available = button.textContent === action.availableLabel;
        confirmAndRun(available ? action.availableConfirm : action.confirm, async () => {
          if (available) {
            await openQualityPreview();
            return;
          }
          if (await runCommand(action.command, resolveActionArgs(action), { title: action.label })) {
            await refreshPreviewButton();
            await openQualityPreview();
          }
        });
      });
      continue;
    }
    if (action.behavior === 'command') {
      const run = async () => {
        const succeeded = await runCommand(action.command, resolveActionArgs(action), { title: action.label });
        if (succeeded && action.command === 'oxidizer-import') openPostImportDialog();
      };
      button.addEventListener('click', () => {
        if (action.confirm) confirmAndRun(action.confirm, run);
        else run();
      });
    }
  }
}

function bindEvents() {
  elements.qualityInput.value = localStorage.getItem(QUALITY_KEY) || '80';
  elements.iconSizeInput.value = localStorage.getItem(ICON_SIZE_KEY) || '80';
  elements.iconDelayInput.value = localStorage.getItem(ICON_DELAY_KEY) || '500';
  elements.lodestoneDelayInput.value = localStorage.getItem(LODESTONE_DELAY_KEY) || '100';
  elements.previewSizeInput.value = localStorage.getItem(PREVIEW_SIZE_KEY) || '80';
  elements.oxidizerSourceInput.value = localStorage.getItem(OXIDIZER_SOURCE_KEY) || '';
  elements.ffxivGamePathInput.value = localStorage.getItem(FFXIV_GAME_PATH_KEY) || '';
  elements.qualityInput.addEventListener('change', () => {
    elements.qualityInput.value = String(clampNumber(elements.qualityInput.value, 1, 100, 80));
    localStorage.setItem(QUALITY_KEY, elements.qualityInput.value);
    applyWorkflowControls();
  });
  elements.iconSizeInput.addEventListener('change', () => {
    elements.iconSizeInput.value = String(clampNumber(elements.iconSizeInput.value, 1, 512, 80));
    localStorage.setItem(ICON_SIZE_KEY, elements.iconSizeInput.value);
    applyWorkflowControls();
  });
  elements.iconDelayInput.addEventListener('change', () => {
    elements.iconDelayInput.value = String(clampNumber(elements.iconDelayInput.value, 0, 60000, 500));
    localStorage.setItem(ICON_DELAY_KEY, elements.iconDelayInput.value);
  });
  elements.lodestoneDelayInput.addEventListener('change', () => {
    elements.lodestoneDelayInput.value = String(clampNumber(elements.lodestoneDelayInput.value, 0, 60000, 100));
    localStorage.setItem(LODESTONE_DELAY_KEY, elements.lodestoneDelayInput.value);
  });
  elements.lodestoneForceInput.addEventListener('change', applyWorkflowControls);
  elements.previewSizeInput.addEventListener('change', () => {
    elements.previewSizeInput.value = String(clampNumber(elements.previewSizeInput.value, 1, 512, 80));
    localStorage.setItem(PREVIEW_SIZE_KEY, elements.previewSizeInput.value);
    elements.previewBtn.textContent = actionDefinition('tmp-quality-preview').label;
  });
  elements.oxidizerSourceInput.addEventListener('change', () => {
    localStorage.setItem(OXIDIZER_SOURCE_KEY, elements.oxidizerSourceInput.value.trim());
  });
  elements.ffxivGamePathInput.addEventListener('change', () => {
    localStorage.setItem(FFXIV_GAME_PATH_KEY, elements.ffxivGamePathInput.value.trim());
  });
  elements.selectOxidizerSourceBtn.addEventListener('click', async () => {
    try {
      const selected = await invoke('select_directory', { initialPath: elements.oxidizerSourceInput.value });
      if (selected) {
        elements.oxidizerSourceInput.value = selected;
        localStorage.setItem(OXIDIZER_SOURCE_KEY, selected);
      }
    } catch (error) {
      appendLog(`フォルダーを選択できませんでした: ${String(error)}`);
    }
  });
  elements.selectFfxivGamePathBtn.addEventListener('click', async () => {
    try {
      const selected = await invoke('select_directory', { initialPath: elements.ffxivGamePathInput.value });
      if (selected) {
        elements.ffxivGamePathInput.value = selected;
        localStorage.setItem(FFXIV_GAME_PATH_KEY, selected);
      }
    } catch (error) {
      appendLog(`フォルダーを選択できませんでした: ${String(error)}`);
    }
  });
  elements.clearLogBtn.addEventListener('click', () => {
    pendingLogLines = [];
    if (logFlushTimer) {
      window.clearTimeout(logFlushTimer);
      logFlushTimer = 0;
    }
    elements.log.replaceChildren();
  });
  elements.openLogFolderBtn.addEventListener('click', async () => {
    try {
      await invoke('open_log_directory');
    } catch (error) {
      appendLog(`ログ保存先を開けませんでした: ${String(error)}`);
    }
  });
  bindSectionToggles([
    { toggle: elements.csvToggle, body: elements.csvBody },
    { toggle: elements.buildToggle, body: elements.buildBody },
    { toggle: elements.iconQualityToggle, body: elements.iconQualityBody }
  ]);
  bindActionButtons();
  elements.resumeBtn.addEventListener('click', () => confirmAndRun(
    uiDefinition.chrome.resumeConfirm,
    () => runSequence(recommendedSequence)
  ));
  elements.cancelBtn.addEventListener('click', cancelCurrentRun);
  elements.confirmOkBtn.addEventListener('click', resolveConfirmOk);
  elements.confirmCancelBtn.addEventListener('click', resolveConfirmCancel);
  elements.confirmOverlay.addEventListener('click', event => {
    if (event.target === elements.confirmOverlay) resolveConfirmCancel();
  });
  elements.previewCloseBtn.addEventListener('click', closeQualityPreview);
  elements.equipmentRoleCloseBtn.addEventListener('click', closeEquipmentRoleDialog);
  elements.equipmentRoleSaveBtn.addEventListener('click', saveEquipmentRoleOverrides);
  elements.publicationReviewCloseBtn.addEventListener('click', closePublicationReviewDialog);
  elements.publicationReviewSaveBtn.addEventListener('click', savePublicationReview);
  elements.oxidizerDiffCloseBtn.addEventListener('click', closeOxidizerDiffDialog);
  elements.oxidizerDiffLodestoneBtn.addEventListener('click', verifyOxidizerDiffWithLodestone);
  elements.oxidizerDiffImportBtn.addEventListener('click', importReviewedOxidizerCsv);
  elements.postImportRunAllBtn.addEventListener('click', continueWithFullRun);
  elements.postImportCloseBtn.addEventListener('click', closePostImportDialog);
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
    if (event.key === 'Escape' && elements.publicationReviewOverlay.classList.contains('open')) {
      event.preventDefault();
      closePublicationReviewDialog();
      return;
    }
    if (event.key === 'Escape' && elements.oxidizerDiffOverlay.classList.contains('open')) {
      event.preventDefault();
      closeOxidizerDiffDialog();
      return;
    }
    if (event.key === 'Escape' && elements.postImportOverlay.classList.contains('open')) {
      event.preventDefault();
      closePostImportDialog();
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

function showConfirm(message, { okLabel = '実行', cancelLabel = 'キャンセル' } = {}) {
  elements.confirmMessage.textContent = message;
  elements.confirmOkBtn.textContent = okLabel;
  elements.confirmCancelBtn.textContent = cancelLabel;
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

async function initialize() {
  try {
    await loadUiDefinition();
  } catch (error) {
    elements.statusText.textContent = '定義読込失敗';
    appendLog(`UI定義を読み込めませんでした: ${String(error)}`);
    setButtonsDisabled(true);
    return;
  }
  for (const message of uiCompatibilityMessages) appendLog(`互換モード: ${message}`);

  pipelineOutputReady = listen('pipeline-output', event => {
    const line = String(event.payload || '');
    if (!line) return;
    if (line.startsWith('OXIDIZER_OUTPUT_ROOT ')) {
      const selected = line.slice('OXIDIZER_OUTPUT_ROOT '.length).trim();
      elements.oxidizerSourceInput.value = selected;
      localStorage.setItem(OXIDIZER_SOURCE_KEY, selected);
    }
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
  await refreshWorkflowStatus();
  updateProgressActions();
  restoreWindowSize();
  loadUpdateState();
  refreshPreviewButton();
  refreshEquipmentRoleCount();
}

initialize();
