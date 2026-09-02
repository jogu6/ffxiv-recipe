const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const { getCurrentWindow, LogicalSize } = window.__TAURI__.window;

const MIN_WIDTH = 760;
const MIN_HEIGHT = 520;
const DEFAULT_WIDTH = 900;
const DEFAULT_HEIGHT = 620;
const SIZE_KEY = 'ffxiv-pipeline-window-size';
const UI_STATE_KEY = 'ffxiv-pipeline-ui-state-v2';
const ETA_HISTORY_KEY = 'ffxiv-pipeline-eta-history-v2';
const INTERRUPTED_RUN_KEY = 'ffxiv-pipeline-interrupted-run-v2';
const MAX_ETA_SAMPLES = 50;
const LOG_BURST_LIMIT = 4;
const LOG_FLUSH_INTERVAL_MS = 1000;

const elements = Object.fromEntries([
  'appTitle', 'statusText', 'moduleSelectorField', 'moduleSelector', 'moduleSummary', 'settingsRoot',
  'resetSettingsBtn', 'settingsErrors', 'actionsRoot', 'progressTitle', 'progressPercent', 'progressBar',
  'progressDetail', 'etaText', 'progressActions', 'cancelBtn', 'resumeBtn', 'openLogFolderBtn', 'clearLogBtn',
  'log', 'previewOverlay', 'previewTitle', 'previewContent', 'previewCloseBtn', 'previewThemeBtn',
  'previewScale2', 'previewScale3', 'confirmOverlay', 'confirmMessage', 'confirmOkBtn', 'confirmCancelBtn'
].map(id => [id, document.getElementById(id)]));

let definition = null;
let activeModule = null;
let settings = new Map();
let settingElements = new Map();
let actionButtons = new Map();
let actionStatusElements = new Map();
let running = false;
let cancellationRequested = false;
let activeRun = null;
let activeCommand = '';
let pendingConfirm = null;
let interruptedRun = null;
let outputListenerReady = Promise.resolve();
let pendingLogLines = [];
let logFlushTimer = 0;
let logBurstStartedAt = performance.now();
let logBurstCount = 0;
let etaHistory = readStorage(ETA_HISTORY_KEY, {});
let etaState = null;
let etaTimer = 0;

function readStorage(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function jstTime(date = new Date()) {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(date);
}

function jstIso(date = new Date()) {
  const shifted = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return `${shifted.toISOString().slice(0, -1)}+09:00`;
}

function appendLog(message, level = 'info') {
  const text = String(message || '').replace(/https:\/\/[^\s]+\/api\/webhooks\/[^\s]+/gi, '[Webhook URL]');
  pendingLogLines.push({ text: `[${jstTime()}] ${text}`, level });
  const now = performance.now();
  if (now - logBurstStartedAt >= LOG_FLUSH_INTERVAL_MS) {
    logBurstStartedAt = now;
    logBurstCount = 0;
  }
  logBurstCount += 1;
  if (logBurstCount <= LOG_BURST_LIMIT && !logFlushTimer) {
    flushLogs();
    return;
  }
  if (!logFlushTimer) {
    const remaining = Math.max(0, LOG_FLUSH_INTERVAL_MS - (now - logBurstStartedAt));
    logFlushTimer = window.setTimeout(() => {
      logBurstStartedAt = performance.now();
      logBurstCount = 0;
      flushLogs();
    }, remaining);
  }
}

function flushLogs() {
  if (logFlushTimer) window.clearTimeout(logFlushTimer);
  logFlushTimer = 0;
  if (!pendingLogLines.length) return;
  const wasAtBottom = elements.log.scrollHeight - elements.log.scrollTop - elements.log.clientHeight <= 4;
  const fragment = document.createDocumentFragment();
  for (const line of pendingLogLines.splice(0)) {
    const row = document.createElement('div');
    row.className = `log-line log-${line.level}`;
    row.textContent = line.text;
    fragment.append(row);
  }
  elements.log.append(fragment);
  if (wasAtBottom) elements.log.scrollTop = elements.log.scrollHeight;
}

function validateRuntimeDefinition(value) {
  if (!value || value.schemaVersion !== 2 || !Array.isArray(value.modules) || value.modules.length === 0) {
    throw new Error('未対応または空のGUI定義です。');
  }
  const allIds = new Set();
  for (const module of value.modules) {
    if (!module.id || allIds.has(`module:${module.id}`)) throw new Error(`モジュールIDが不正です: ${module.id || ''}`);
    allIds.add(`module:${module.id}`);
    const localIds = new Set();
    const visit = node => {
      if (!node.id || localIds.has(node.id)) throw new Error(`${module.label}の項目IDが不正です: ${node.id || ''}`);
      localIds.add(node.id);
      for (const child of node.children || []) visit(child);
    };
    for (const node of module.settings || []) visit(node);
    for (const action of module.actions || []) {
      if (!action.id || localIds.has(action.id)) throw new Error(`${module.label}の操作IDが不正です: ${action.id || ''}`);
      localIds.add(action.id);
    }
  }
}

function moduleStorage() {
  const root = readStorage(UI_STATE_KEY, {});
  const key = `${activeModule.id}@${activeModule.schemaVersion}`;
  if (!root[key]) root[key] = { values: {}, accordions: {} };
  return { root, key, state: root[key] };
}

function flattenSettings(nodes, result = []) {
  for (const node of nodes || []) {
    if (node.type === 'group') flattenSettings(node.children, result);
    else result.push(node);
  }
  return result;
}

function normalizedValue(setting, raw) {
  if (setting.type === 'checkbox') return Boolean(raw);
  if (['number', 'range'].includes(setting.type)) {
    const value = Number(raw);
    return Number.isFinite(value) ? value : raw;
  }
  return String(raw ?? '');
}

function settingError(setting, value) {
  if (setting.required && (value === '' || value === null || value === undefined)) return '必須です。';
  if (['number', 'range'].includes(setting.type)) {
    if (!Number.isFinite(Number(value))) return '数値を入力してください。';
    if (setting.min !== undefined && Number(value) < setting.min) return `${setting.min}以上にしてください。`;
    if (setting.max !== undefined && Number(value) > setting.max) return `${setting.max}以下にしてください。`;
  }
  if (setting.type === 'select' && !(setting.options || []).some(option => String(option.value) === String(value))) return '有効な選択肢ではありません。';
  return '';
}

function conditionMatches(condition) {
  if (!condition) return true;
  const left = settings.get(condition.settingId);
  const right = condition.value;
  if (condition.operator === 'eq') return left === right;
  if (condition.operator === 'ne') return left !== right;
  if (condition.operator === 'gt') return Number(left) > Number(right);
  if (condition.operator === 'gte') return Number(left) >= Number(right);
  if (condition.operator === 'lt') return Number(left) < Number(right);
  if (condition.operator === 'lte') return Number(left) <= Number(right);
  if (condition.operator === 'in') return Array.isArray(right) && right.includes(left);
  return false;
}

function validateSettings(settingIds = null) {
  const wanted = settingIds ? new Set(settingIds) : null;
  const errors = [];
  for (const setting of flattenSettings(activeModule.settings)) {
    if (wanted && !wanted.has(setting.id)) continue;
    if (!conditionMatches(setting.visibleWhen) || !conditionMatches(setting.enabledWhen)) continue;
    const error = settingError(setting, settings.get(setting.id));
    const field = settingElements.get(setting.id)?.field;
    const errorElement = settingElements.get(setting.id)?.error;
    field?.classList.toggle('invalid', Boolean(error));
    if (errorElement) {
      errorElement.textContent = error;
      errorElement.hidden = !error;
    }
    if (error) errors.push(`${setting.label}: ${error}`);
    if (setting.acknowledge && !settingElements.get(setting.id)?.acknowledged?.checked) errors.push(`${setting.label}: 確認が必要です。`);
  }
  for (const validator of activeModule.validators || []) {
    if (!conditionMatches(validator.when)) continue;
    errors.push(validator.message);
  }
  return errors;
}

function saveValidSettings() {
  const { root, key, state } = moduleStorage();
  for (const setting of flattenSettings(activeModule.settings)) {
    if (!setting.persist || settingError(setting, settings.get(setting.id))) continue;
    state.values[setting.id] = settings.get(setting.id);
  }
  root[key] = state;
  writeStorage(UI_STATE_KEY, root);
}

function updateConditionsAndActions() {
  for (const setting of flattenSettings(activeModule.settings)) {
    const record = settingElements.get(setting.id);
    if (!record) continue;
    const visible = conditionMatches(setting.visibleWhen);
    const enabled = visible && conditionMatches(setting.enabledWhen) && !running;
    record.field.hidden = !visible;
    record.input.disabled = !enabled;
  }
  const errors = validateSettings();
  elements.settingsErrors.textContent = errors.join('\n');
  elements.settingsErrors.hidden = errors.length === 0;
  for (const action of activeModule.actions) {
    const actionErrors = validateSettings(action.settingIds || []);
    const enabled = !running && actionErrors.length === 0 && conditionMatches(action.enabledWhen);
    actionButtons.get(action.id).disabled = !enabled;
  }
  elements.moduleSelector.disabled = running;
  elements.resetSettingsBtn.disabled = running || Boolean(interruptedRun);
}

function createInput(setting, value) {
  let input;
  if (setting.type === 'select') {
    input = document.createElement('select');
    for (const option of setting.options || []) {
      const element = document.createElement('option');
      element.value = option.value;
      element.textContent = option.label;
      input.append(element);
    }
  } else {
    input = document.createElement('input');
    input.type = setting.type === 'directory' || setting.type === 'file' ? 'text' : setting.type;
    for (const attribute of ['min', 'max', 'step', 'placeholder']) if (setting[attribute] !== undefined) input[attribute] = setting[attribute];
  }
  if (setting.type === 'checkbox') input.checked = Boolean(value);
  else input.value = String(value ?? '');
  input.id = `setting-${setting.id}`;
  input.addEventListener('input', () => {
    settings.set(setting.id, normalizedValue(setting, setting.type === 'checkbox' ? input.checked : input.value));
    saveValidSettings();
    updateConditionsAndActions();
  });
  return input;
}

function setAccordionExpanded(container, toggle, body, expanded, animate = true) {
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.querySelector('.section-toggle-mark').textContent = expanded ? '▼' : '▶';
  if (!animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    body.hidden = !expanded;
    body.classList.toggle('is-open', expanded);
    body.style.maxHeight = expanded ? 'none' : '0px';
    return;
  }
  body.hidden = false;
  if (expanded) {
    body.style.maxHeight = '0px';
    requestAnimationFrame(() => {
      body.classList.add('is-open');
      body.style.maxHeight = `${body.scrollHeight}px`;
    });
  } else {
    body.style.maxHeight = `${body.scrollHeight}px`;
    requestAnimationFrame(() => {
      body.classList.remove('is-open');
      body.style.maxHeight = '0px';
    });
  }
  const finish = event => {
    if (event.propertyName !== 'max-height') return;
    body.removeEventListener('transitionend', finish);
    if (expanded) body.style.maxHeight = 'none';
    else body.hidden = true;
  };
  body.addEventListener('transitionend', finish);
  container.classList.toggle('expanded', expanded);
}

function renderSettingNode(node, accordionState) {
  if (node.type === 'group') {
    const section = document.createElement('section');
    section.className = `setting-group depth-${Math.min(6, Number(node.depth || 0))}`;
    let body = section;
    if (node.accordion) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'section-toggle';
      toggle.innerHTML = '<span class="section-toggle-mark" aria-hidden="true"></span><span></span>';
      toggle.querySelector('span:last-child').textContent = node.label;
      body = document.createElement('div');
      body.className = 'collapsible-body';
      body.id = `accordion-${node.id}`;
      toggle.setAttribute('aria-controls', body.id);
      section.append(toggle, body);
      const expanded = accordionState[node.id] ?? Boolean(node.expanded);
      setAccordionExpanded(section, toggle, body, expanded, false);
      toggle.addEventListener('click', () => {
        const next = toggle.getAttribute('aria-expanded') !== 'true';
        setAccordionExpanded(section, toggle, body, next, true);
        const { root, key, state } = moduleStorage();
        state.accordions[node.id] = next;
        root[key] = state;
        writeStorage(UI_STATE_KEY, root);
      });
    } else {
      const heading = document.createElement('h2');
      heading.className = 'setting-heading';
      heading.textContent = node.label;
      body = document.createElement('div');
      body.className = 'setting-group-body';
      section.append(heading, body);
    }
    for (const child of node.children || []) body.append(renderSettingNode(child, accordionState));
    return section;
  }

  const field = document.createElement('label');
  field.className = 'field dynamic-field';
  field.dataset.settingId = node.id;
  const label = document.createElement('span');
  label.className = 'field-label';
  label.textContent = node.label;
  const control = document.createElement('span');
  control.className = 'field-control';
  const input = createInput(node, settings.get(node.id));
  control.append(input);
  if (node.unit) {
    const unit = document.createElement('span');
    unit.className = 'field-unit';
    unit.textContent = node.unit;
    control.append(unit);
  }
  if (node.type === 'file' || node.type === 'directory') {
    const browse = document.createElement('button');
    browse.type = 'button';
    browse.textContent = '参照';
    browse.addEventListener('click', async event => {
      event.preventDefault();
      try {
        const command = node.type === 'directory' ? 'select_directory' : 'select_file';
        const selected = await invoke(command, { initialPath: input.value });
        if (selected) {
          input.value = selected;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      } catch (error) {
        appendLog(`選択ダイアログを開けませんでした: ${String(error)}`, 'error');
      }
    });
    control.append(browse);
  }
  field.append(label, control);
  if (node.description) {
    const description = document.createElement('small');
    description.className = 'field-description';
    description.textContent = node.description;
    field.append(description);
  }
  if (node.warning) {
    const warning = document.createElement('small');
    warning.className = 'field-warning';
    warning.textContent = node.warning;
    field.append(warning);
  }
  const error = document.createElement('small');
  error.className = 'field-error';
  error.hidden = true;
  field.append(error);
  settingElements.set(node.id, { field, input, error });
  return field;
}

function renderActions() {
  elements.actionsRoot.replaceChildren();
  actionButtons.clear();
  actionStatusElements.clear();
  const groups = [...activeModule.actionGroups].sort((a, b) => a.order - b.order);
  for (const group of groups) {
    const actions = activeModule.actions.filter(action => action.group === group.id).sort((a, b) => a.order - b.order);
    if (!actions.length) continue;
    const section = document.createElement('section');
    section.className = 'action-group';
    if (groups.length > 1) {
      const heading = document.createElement('h2');
      heading.textContent = group.label;
      section.append(heading);
    }
    for (const action of actions) {
      const item = document.createElement('div');
      item.className = 'action-item';
      item.dataset.actionId = action.id;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = action.label;
      const description = document.createElement('p');
      description.textContent = action.description;
      const status = document.createElement('span');
      status.className = 'action-status';
      status.textContent = '○ 未実行';
      item.append(button, description, status);
      section.append(item);
      actionButtons.set(action.id, button);
      actionStatusElements.set(action.id, status);
      button.addEventListener('click', () => startActionWithConfirmation(action));
    }
    elements.actionsRoot.append(section);
  }
}

function renderModule(module) {
  activeModule = module;
  settingElements.clear();
  const { state } = moduleStorage();
  settings = new Map(flattenSettings(module.settings).map(setting => {
    const restored = setting.persist && Object.hasOwn(state.values, setting.id) ? state.values[setting.id] : setting.default;
    return [setting.id, settingError(setting, restored) ? setting.default : normalizedValue(setting, restored)];
  }));
  elements.moduleSummary.replaceChildren();
  const heading = document.createElement('h2');
  heading.textContent = module.label;
  const description = document.createElement('p');
  description.textContent = module.description || '';
  elements.moduleSummary.append(heading, description);
  elements.settingsRoot.replaceChildren(...module.settings.map(node => renderSettingNode(node, state.accordions)));
  renderActions();
  updateConditionsAndActions();
}

function applyDefinition(value) {
  validateRuntimeDefinition(value);
  definition = value;
  document.title = value.application.title;
  elements.appTitle.textContent = value.application.title;
  elements.statusText.textContent = value.application.idleStatus;
  elements.progressTitle.textContent = value.chrome.progressTitle;
  elements.progressDetail.textContent = value.chrome.progressIdle;
  elements.cancelBtn.textContent = value.chrome.cancel;
  elements.resumeBtn.textContent = value.chrome.resume;
  elements.clearLogBtn.textContent = value.chrome.clearLog;
  elements.resetSettingsBtn.textContent = value.chrome.resetSettings;
  elements.confirmOkBtn.textContent = value.chrome.confirmOk;
  elements.confirmCancelBtn.textContent = value.chrome.confirmCancel;
  const modules = [...value.modules].sort((a, b) => a.order - b.order);
  elements.moduleSelector.replaceChildren(...modules.map(module => {
    const option = document.createElement('option');
    option.value = module.id;
    option.textContent = module.label;
    return option;
  }));
  elements.moduleSelectorField.hidden = modules.length <= 1;
  renderModule(modules[0]);
}

function actionById(id) {
  return activeModule.actions.find(action => action.id === id);
}

function resolveArgs(action) {
  const args = [];
  for (const mapping of action.args || []) {
    const value = settings.get(mapping.settingId);
    if (mapping.omitEmpty && String(value ?? '').trim() === '') continue;
    if (typeof value === 'boolean') {
      if (value) args.push(mapping.flag);
    } else {
      args.push(mapping.flag, String(value));
    }
  }
  return args;
}

function showConfirm(message, { okLabel = '実行', cancelLabel = 'キャンセル' } = {}) {
  elements.confirmMessage.textContent = message;
  elements.confirmOkBtn.textContent = okLabel;
  elements.confirmCancelBtn.textContent = cancelLabel;
  elements.confirmOverlay.classList.add('open');
  elements.confirmOverlay.setAttribute('aria-hidden', 'false');
  elements.confirmOkBtn.focus();
  return new Promise(resolve => { pendingConfirm = resolve; });
}

function closeConfirm(result) {
  if (!pendingConfirm) return;
  const resolve = pendingConfirm;
  pendingConfirm = null;
  elements.confirmOverlay.classList.remove('open');
  elements.confirmOverlay.setAttribute('aria-hidden', 'true');
  resolve(result);
}

function textElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function previewCell(label, file, size, baseSize, note = '', selected = false) {
  const cell = textElement('div', `preview-cell${selected ? ' selected' : ''}`);
  const swatch = textElement('div', 'preview-swatch');
  const image = document.createElement('img');
  image.src = file;
  image.alt = '';
  swatch.append(image);
  cell.append(swatch, textElement('b', '', selected ? `${label}（設定値）` : label));
  if (Number.isFinite(size)) {
    const ratio = Number.isFinite(baseSize) && baseSize > 0 ? ` / ${Math.round((size / baseSize) * 100)}%` : '';
    cell.append(textElement('span', '', `${formatBytes(size)}${ratio}`));
  }
  if (note) cell.append(textElement('span', '', note));
  return cell;
}

function renderQualityPreview(rows) {
  elements.previewContent.replaceChildren();
  if (!Array.isArray(rows) || !rows.length) {
    elements.previewContent.append(textElement('p', 'preview-message', '表示できる比較画像がありません。'));
    return;
  }
  for (const row of rows) {
    const section = textElement('section', 'preview-row');
    section.append(textElement('h3', '', row.itemName || row.iconName));
    const tags = textElement('div', 'preview-tags');
    for (const value of [row.category, row.background].filter(Boolean)) tags.append(textElement('span', '', value));
    const grid = textElement('div', 'preview-grid');
    const dimensions = Number.isFinite(row.pngWidth) && Number.isFinite(row.pngHeight)
      ? `元画像 ${row.pngWidth}x${row.pngHeight}px`
      : '元画像';
    grid.append(previewCell('PNG', row.pngFile, row.pngSize, null, dimensions));
    for (const variant of row.variants || []) {
      grid.append(previewCell(`q${variant.quality}`, variant.file, variant.size, row.pngSize, '', Boolean(variant.selected)));
    }
    section.append(tags, grid);
    elements.previewContent.append(section);
  }
}

async function openQualityPreview(view = {}) {
  elements.previewTitle.textContent = view.title || 'アイテム画像プレビュー';
  elements.previewCloseBtn.textContent = view.closeLabel || '閉じる';
  elements.previewContent.replaceChildren(textElement('p', 'preview-message', '読み込み中...'));
  elements.previewOverlay.classList.add('open');
  elements.previewOverlay.setAttribute('aria-hidden', 'false');
  try {
    renderQualityPreview(await invoke('read_quality_preview'));
  } catch (error) {
    const message = `画像プレビューを開けませんでした: ${String(error)}`;
    elements.previewContent.replaceChildren(textElement('p', 'preview-message', message));
    appendLog(message, 'error');
  }
}

function closeQualityPreview() {
  elements.previewOverlay.classList.remove('open');
  elements.previewOverlay.setAttribute('aria-hidden', 'true');
  elements.previewContent.replaceChildren();
}

async function startActionWithConfirmation(action) {
  if (running) return;
  const errors = validateSettings(action.settingIds || []);
  if (errors.length) {
    elements.settingsErrors.textContent = errors.join('\n');
    elements.settingsErrors.hidden = false;
    return;
  }
  if (interruptedRun && interruptedRun.actionId !== action.id) {
    if (!(await showConfirm('中断中の処理状態を破棄して新しい処理を開始しますか？'))) return;
    clearInterruptedRun();
  }
  if (action.confirm && !(await showConfirm(action.confirm))) return;
  await runAction(action);
}

function settingsSnapshot() {
  return Object.fromEntries(settings);
}

function setSettingsSnapshot(snapshot) {
  for (const setting of flattenSettings(activeModule.settings)) {
    if (!Object.hasOwn(snapshot || {}, setting.id)) continue;
    const value = snapshot[setting.id];
    if (settingError(setting, value)) continue;
    settings.set(setting.id, value);
    const input = settingElements.get(setting.id)?.input;
    if (setting.type === 'checkbox') input.checked = Boolean(value);
    else input.value = String(value);
  }
  saveValidSettings();
  updateConditionsAndActions();
}

function persistInterruptedRun(payload) {
  interruptedRun = payload;
  writeStorage(INTERRUPTED_RUN_KEY, payload);
  updateProgressActions();
  updateConditionsAndActions();
}

function clearInterruptedRun() {
  interruptedRun = null;
  localStorage.removeItem(INTERRUPTED_RUN_KEY);
  updateProgressActions();
  updateConditionsAndActions();
}

function markAction(id, state) {
  const item = actionButtons.get(id)?.closest('.action-item');
  if (!item) return;
  item.classList.remove('running', 'done', 'failed', 'interrupted');
  item.classList.add(state);
  const labels = { running: '● 実行中', done: '✓ 完了', failed: '× 失敗', interrupted: '○ 中断済み' };
  actionStatusElements.get(id).textContent = labels[state] || '○ 未実行';
}

function lockInterface(locked) {
  running = locked;
  for (const input of elements.settingsRoot.querySelectorAll('input, select, button')) input.disabled = locked;
  for (const button of actionButtons.values()) button.disabled = locked;
  elements.moduleSelector.disabled = locked;
  elements.resetSettingsBtn.disabled = locked || Boolean(interruptedRun);
  updateProgressActions();
  if (!locked) updateConditionsAndActions();
}

function updateProgressActions() {
  const showCancel = running;
  const showResume = !running && Boolean(interruptedRun);
  elements.progressActions.hidden = !showCancel && !showResume;
  elements.cancelBtn.hidden = !showCancel;
  elements.cancelBtn.disabled = !showCancel || cancellationRequested;
  if (showCancel && !cancellationRequested) elements.cancelBtn.textContent = definition.chrome.cancel;
  elements.resumeBtn.hidden = !showResume;
  elements.resumeBtn.disabled = !showResume;
}

function median(values) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function historyKey(actionId) {
  return `${activeModule.id}@${activeModule.schemaVersion}:${actionId}`;
}

function durationPrediction(actionId) {
  const samples = (etaHistory[historyKey(actionId)] || []).filter(sample => sample.seconds > 0).map(sample => sample.seconds);
  if (!samples.length) return { seconds: NaN, low: NaN, high: NaN, count: 0 };
  const center = median(samples);
  const mad = median(samples.map(value => Math.abs(value - center))) || 0;
  return { seconds: center, low: Math.max(0, center - 1.4826 * mad), high: center + 1.4826 * mad, count: samples.length };
}

function recordDuration(actionId, seconds, outcome) {
  const key = historyKey(actionId);
  const samples = etaHistory[key] || [];
  samples.push({ seconds, outcome, completedAt: jstIso() });
  etaHistory[key] = samples.slice(-MAX_ETA_SAMPLES);
  writeStorage(ETA_HISTORY_KEY, etaHistory);
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '-';
  const rounded = Math.trunc(seconds);
  const sign = rounded < 0 ? '-' : '';
  const absolute = Math.abs(rounded);
  const hours = Math.floor(absolute / 3600);
  const minutes = Math.floor((absolute % 3600) / 60);
  const rest = absolute % 60;
  return hours > 0
    ? `${sign}${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${sign}${minutes}:${String(rest).padStart(2, '0')}`;
}

function renderEta() {
  if (!etaState || !Number.isFinite(etaState.authoritative)) {
    elements.etaText.textContent = 'ETA 算出中';
    return;
  }
  const elapsed = Math.floor((performance.now() - etaState.baseAt) / 1000);
  const value = etaState.authoritative - elapsed;
  let suffix = etaState.provisional ? '・暫定' : '';
  if (Number.isFinite(etaState.low) && Number.isFinite(etaState.high)) {
    const low = etaState.low - elapsed;
    const high = etaState.high - elapsed;
    suffix += ` (${formatDuration(low)}～${formatDuration(high)})`;
  }
  elements.etaText.textContent = `ETA ${formatDuration(value)}${suffix}`;
}

function setEtaEstimate(seconds, { low = NaN, high = NaN, provisional = false, force = false } = {}) {
  const rounded = Number.isFinite(seconds) ? Math.ceil(seconds) : NaN;
  if (!etaState || force || !Object.is(etaState.authoritative, rounded)) {
    etaState = { authoritative: rounded, low, high, provisional, baseAt: performance.now() };
  } else {
    etaState.low = low;
    etaState.high = high;
    etaState.provisional = provisional;
  }
  renderEta();
}

function setProgress(percent, detail = '', { force = false } = {}) {
  const safe = Math.max(0, Math.min(100, Number(percent) || 0));
  const now = performance.now();
  const signature = `${Math.round(safe * 100)}:${detail}`;
  if (!force && activeRun?.renderSignature !== signature) {
    activeRun.renderBurst = (activeRun.renderBurst || 0) + 1;
    if (activeRun.renderBurst > 4 && now - (activeRun.lastRenderAt || 0) < 1000) return;
  }
  if (activeRun) {
    activeRun.renderSignature = signature;
    activeRun.lastRenderAt = now;
    if (now - (activeRun.lastBurstReset || 0) > 1200) {
      activeRun.renderBurst = 0;
      activeRun.lastBurstReset = now;
    }
  }
  elements.progressBar.style.width = `${safe}%`;
  elements.progressPercent.textContent = `${Math.round(safe)}%`;
  if (detail) elements.progressDetail.textContent = detail;
}

function initialEtaForSteps(steps) {
  const predictions = steps.map(step => durationPrediction(step.id));
  const sum = key => predictions.reduce((total, prediction) => total + (Number.isFinite(prediction[key]) ? prediction[key] : 0), 0);
  const known = predictions.filter(prediction => Number.isFinite(prediction.seconds));
  if (!known.length) return { seconds: NaN, low: NaN, high: NaN, provisional: true };
  return { seconds: sum('seconds'), low: sum('low'), high: sum('high'), provisional: known.length !== steps.length || known.some(value => value.count < 3) };
}

function updateEtaFromProgress(completed, total) {
  if (!activeRun || completed <= 0 || total <= 0) return;
  const elapsed = (performance.now() - activeRun.stepStartedAt) / 1000;
  const currentRemaining = Math.max(0, (elapsed / completed) * (total - completed));
  const future = activeRun.steps.slice(activeRun.stepIndex + 1).map(step => durationPrediction(step.id));
  const futureSeconds = future.reduce((sum, item) => sum + (Number.isFinite(item.seconds) ? item.seconds : 0), 0);
  const futureLow = future.reduce((sum, item) => sum + (Number.isFinite(item.low) ? item.low : 0), 0);
  const futureHigh = future.reduce((sum, item) => sum + (Number.isFinite(item.high) ? item.high : 0), 0);
  const ratio = total > 0 ? (total - completed) / total : 0;
  setEtaEstimate(currentRemaining + futureSeconds, {
    low: Math.max(0, currentRemaining * 0.8) + futureLow,
    high: currentRemaining * 1.2 + futureHigh,
    provisional: completed < Math.min(total, 3) || future.some(item => item.count < 3)
  });
}

function parseProgress(line) {
  const match = String(line).match(/(?:^|\s)(\d+)\s*\/\s*(\d+)(?:\s|:|$)/);
  if (!match) return null;
  const completed = Number(match[1]);
  const total = Number(match[2]);
  return total > 0 && completed <= total ? { completed, total } : null;
}

function handlePipelineOutput(line) {
  if (!line || line.startsWith('__ETA__ ')) return;
  appendLog(line);
  if (!activeRun) return;
  const progress = parseProgress(line);
  if (!progress) return;
  activeRun.currentCompleted = progress.completed;
  activeRun.currentTotal = progress.total;
  const local = progress.completed / progress.total;
  const percent = ((activeRun.stepIndex + local) / activeRun.steps.length) * 100;
  setProgress(percent, line);
  updateEtaFromProgress(progress.completed, progress.total);
}

async function runAction(action, { resumeState = null } = {}) {
  const steps = action.sequence ? action.sequence.map(actionById) : [action];
  if (steps.some(step => !step?.command)) throw new Error('実行定義に未対応の処理があります。');
  cancellationRequested = false;
  lockInterface(true);
  const startedAt = performance.now();
  const completedStepIds = new Set(
    (resumeState?.completedStepIds || []).filter(id => steps.some(step => step.id === id))
  );
  activeRun = {
    action,
    steps,
    stepIndex: 0,
    stepStartedAt: startedAt,
    completedStepIds,
    lastRenderAt: 0,
    lastBurstReset: startedAt,
    renderBurst: 0
  };
  elements.statusText.textContent = '実行中';
  elements.progressTitle.textContent = action.label;
  setProgress(0, '開始', { force: true });
  const prediction = initialEtaForSteps(steps);
  setEtaEstimate(prediction.seconds, prediction);
  persistInterruptedRun({
    moduleId: activeModule.id,
    moduleSchemaVersion: activeModule.schemaVersion,
    actionId: action.id,
    settings: settingsSnapshot(),
    startedAt: resumeState?.startedAt || jstIso(),
    completedStepIds: [...completedStepIds],
    currentStepId: null,
  });
  let outcome = 'completed';
  try {
    await outputListenerReady;
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      activeRun.stepIndex = index;
      if (completedStepIds.has(step.id)) {
        markAction(step.id, 'done');
        setProgress(((index + 1) / steps.length) * 100, `${step.label} 完了済み`, { force: true });
        continue;
      }
      activeRun.stepStartedAt = performance.now();
      activeRun.currentCompleted = 0;
      activeRun.currentTotal = 0;
      activeCommand = step.command;
      markAction(step.id, 'running');
      elements.progressDetail.textContent = step.label;
      persistInterruptedRun({
        ...interruptedRun,
        completedStepIds: [...completedStepIds],
        currentStepId: step.id,
      });
      const output = await invoke('run_pipeline_command', { command: step.command, args: resolveArgs(step) });
      if (output?.trim()) appendLog(output.trim());
      const duration = (performance.now() - activeRun.stepStartedAt) / 1000;
      recordDuration(step.id, duration, 'completed');
      completedStepIds.add(step.id);
      persistInterruptedRun({
        ...interruptedRun,
        completedStepIds: [...completedStepIds],
        currentStepId: null,
      });
      markAction(step.id, 'done');
      setProgress(((index + 1) / steps.length) * 100, `${step.label} 完了`, { force: true });
      const remaining = initialEtaForSteps(steps.slice(index + 1));
      setEtaEstimate(remaining.seconds, remaining);
    }
    recordDuration(action.id, (performance.now() - startedAt) / 1000, 'completed');
    clearInterruptedRun();
    elements.statusText.textContent = '完了';
    setProgress(100, 'すべての処理が完了しました', { force: true });
    setEtaEstimate(0, { low: 0, high: 0, force: true });
    if (action.resultView?.type === 'quality-preview') await openQualityPreview(action.resultView);
  } catch (error) {
    outcome = cancellationRequested ? 'cancelled' : 'failed';
    const duration = activeRun?.stepStartedAt ? (performance.now() - activeRun.stepStartedAt) / 1000 : 0;
    if (activeCommand) {
      const step = steps.find(candidate => candidate.command === activeCommand);
      if (step) {
        recordDuration(step.id, duration, outcome);
        markAction(step.id, cancellationRequested ? 'interrupted' : 'failed');
      }
    }
    recordDuration(action.id, (performance.now() - startedAt) / 1000, outcome);
    elements.statusText.textContent = cancellationRequested ? '中断' : '失敗';
    appendLog(cancellationRequested ? '安全な処理境界で中断しました。' : `実行に失敗しました: ${String(error)}`, cancellationRequested ? 'warning' : 'error');
    persistInterruptedRun({ ...interruptedRun, failedAt: jstIso(), outcome });
  } finally {
    activeCommand = '';
    activeRun = null;
    cancellationRequested = false;
    lockInterface(false);
    if (outcome !== 'completed') renderEta();
  }
}

async function cancelCurrentRun() {
  if (!running || cancellationRequested) return;
  cancellationRequested = true;
  elements.statusText.textContent = '中止処理中';
  elements.cancelBtn.disabled = true;
  elements.cancelBtn.textContent = '中止処理中...';
  try {
    await invoke('cancel_pipeline_command');
  } catch (error) {
    appendLog(`中止要求を送信できませんでした: ${String(error)}`, 'error');
    cancellationRequested = false;
    elements.cancelBtn.disabled = false;
  }
}

async function resumeInterruptedRun() {
  if (!interruptedRun || running) return;
  const module = definition.modules.find(candidate => candidate.id === interruptedRun.moduleId);
  if (!module || module.schemaVersion !== interruptedRun.moduleSchemaVersion) {
    await showConfirm('定義が変更されたため安全に再開できません。中断状態を破棄します。', { okLabel: '破棄', cancelLabel: '閉じる' });
    clearInterruptedRun();
    return;
  }
  if (activeModule.id !== module.id) renderModule(module);
  const action = actionById(interruptedRun.actionId);
  if (!action) {
    clearInterruptedRun();
    return;
  }
  if (!(await showConfirm('中断時の設定を復元し、完了済みキャッシュを利用して続きから再開しますか？', { okLabel: '再開' }))) return;
  setSettingsSnapshot(interruptedRun.settings);
  await runAction(action, { resumeState: interruptedRun });
}

function resetSettings() {
  for (const setting of flattenSettings(activeModule.settings)) {
    settings.set(setting.id, normalizedValue(setting, setting.default));
    const input = settingElements.get(setting.id)?.input;
    if (setting.type === 'checkbox') input.checked = Boolean(setting.default);
    else input.value = String(setting.default ?? '');
  }
  const { root, key, state } = moduleStorage();
  state.values = {};
  root[key] = state;
  writeStorage(UI_STATE_KEY, root);
  updateConditionsAndActions();
}

function restoreWindowSize() {
  const saved = readStorage(SIZE_KEY, null);
  const width = Math.max(MIN_WIDTH, Number(saved?.width) || DEFAULT_WIDTH);
  const height = Math.max(MIN_HEIGHT, Number(saved?.height) || DEFAULT_HEIGHT);
  getCurrentWindow().setMinSize(new LogicalSize(MIN_WIDTH, MIN_HEIGHT));
  getCurrentWindow().setSize(new LogicalSize(width, height));
  getCurrentWindow().onResized(({ payload }) => writeStorage(SIZE_KEY, payload));
}

function blockBrowserNavigation() {
  window.addEventListener('beforeunload', event => event.preventDefault());
  window.addEventListener('keydown', event => {
    const reload = event.key === 'F5' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r');
    if (reload) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
}

function bindCommonEvents() {
  elements.moduleSelector.addEventListener('change', () => renderModule(definition.modules.find(module => module.id === elements.moduleSelector.value)));
  elements.resetSettingsBtn.addEventListener('click', resetSettings);
  elements.cancelBtn.addEventListener('click', cancelCurrentRun);
  elements.resumeBtn.addEventListener('click', resumeInterruptedRun);
  elements.clearLogBtn.addEventListener('click', () => {
    if (logFlushTimer) window.clearTimeout(logFlushTimer);
    logFlushTimer = 0;
    logBurstStartedAt = performance.now();
    logBurstCount = 0;
    pendingLogLines = [];
    elements.log.replaceChildren();
  });
  elements.openLogFolderBtn.addEventListener('click', () => invoke('open_log_directory').catch(error => appendLog(String(error), 'error')));
  elements.previewCloseBtn.addEventListener('click', closeQualityPreview);
  elements.previewOverlay.addEventListener('click', event => { if (event.target === elements.previewOverlay) closeQualityPreview(); });
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
  elements.confirmOkBtn.addEventListener('click', () => closeConfirm(true));
  elements.confirmCancelBtn.addEventListener('click', () => closeConfirm(false));
  elements.confirmOverlay.addEventListener('click', event => { if (event.target === elements.confirmOverlay) closeConfirm(false); });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && elements.previewOverlay.classList.contains('open')) {
      event.preventDefault();
      closeQualityPreview();
    }
  });
}

async function initialize() {
  try {
    applyDefinition(await invoke('read_pipeline_ui_definition'));
  } catch (error) {
    elements.statusText.textContent = '定義読込失敗';
    appendLog(`GUI定義を読み込めませんでした: ${String(error)}`, 'error');
    return;
  }
  interruptedRun = readStorage(INTERRUPTED_RUN_KEY, null);
  outputListenerReady = listen('pipeline-output', event => handlePipelineOutput(String(event.payload || ''))).catch(error => {
    appendLog(`実行ログの受信準備に失敗しました: ${String(error)}`, 'error');
  });
  bindCommonEvents();
  blockBrowserNavigation();
  restoreWindowSize();
  updateProgressActions();
  updateConditionsAndActions();
  etaTimer = window.setInterval(renderEta, 1000);
}

initialize();
