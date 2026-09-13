import { installBugReport, reportElapsed, profileForReport } from './bug-report.js';
import { collectDeviceInfo, collectScreenInfo } from './device-info.js';
import { loadMacroData, recipeFromLocation } from './data-loader.js';
import {
  CRAFTER_JOBS, buildSearchInput, crafterStatusFailure, effectiveCrafterStats, formatMacro,
  isCompleteCrafterStatus, recipeParameterFailure, sortConsumables
} from './model.js';
import {
  formatJapaneseDateTime, japaneseIsoDateTime, loadRestorableResult, saveGeneratedResult,
  loadDraftSelection, saveDraftSelection, loadPanelView, savePanelView
} from './persistence.js';
import { selectSolverWorkerCount } from './worker-policy.js';
import { createProfiler } from './profiling.js';

const STORAGE_KEY = 'xivca.macro.crafter-status.v1';
// Raphael のバージョンに内部リビジョンを付加し、生成エンジンの変更時に末尾を増やす。
const ENGINE_VERSION = '0.28.6.7';
const REPORT_BUILD_ID = '__REPORT_BUILD_ID__';
const COMPLETION_HOLD_MS = 200;
const HQ_MARK_PATH = './assets/hq-mark-transparent.webp';
const CRAFTER_JOB_ICON_FILES = Object.freeze({
  木工師: 'job-icons/carpenter.webp',
  鍛冶師: 'job-icons/blacksmith.webp',
  甲冑師: 'job-icons/armorer.webp',
  彫金師: 'job-icons/goldsmith.webp',
  革細工師: 'job-icons/leatherworker.webp',
  裁縫師: 'job-icons/weaver.webp',
  錬金術師: 'job-icons/alchemist.webp',
  調理師: 'job-icons/culinarian.webp'
});
const requestedSiteRoot = new URLSearchParams(location.search).get('siteRoot');
const siteRoot = requestedSiteRoot === '../..' ? '../..' : '../../site';
const elements = Object.fromEntries([...document.querySelectorAll('[id]')].map(element => [element.id, element]));
const state = { data: null, recipe: null, food: null, medicine: null, hqIngredientIds: new Set() };
let solverWorkers = [];
let generationController = null;
let solverRequestSerial = 0;
let wakeLockSentinel = null;
let generationStartedAt = 0;
let elapsedTimer = 0;
let lastEngineWorkUnits = 0;
let generationActivity = null;
let generationNotice = null;
let solverWorkerCleanup = null;
let restoringPanel = true;
const panelSections = Object.fromEntries([
  'ingredientList', 'crafterStatusSection', 'foodList', 'medicineList', 'generatedStatusSection', 'macroSection'
].map(key => [key, elements[key].closest('.accordion')]));
const profiler = createProfiler(localStorage);
Object.defineProperty(globalThis, '__xivcaMacroProfile', { get: () => profiler.current });

function siteAssetUrl(path) {
  return new URL(`${siteRoot}/${path}`, location.href).href;
}

function isHostedPanel() {
  return window.parent !== window && requestedSiteRoot === '../..';
}

// Standalone previews use the same controller and CSS as the main application.
if (!isHostedPanel()) await import(siteAssetUrl('floating-window.js'));
const generationMessageWindow = isHostedPanel() ? null
  : globalThis.FloatingWindow.createFloatingWindow(elements.confirmOverlay);

function notifyHost(type, detail = {}) {
  if (window.parent === window) return;
  window.parent.postMessage({ source: 'xivca-macro', type, ...detail }, location.origin);
}

function formatElapsed(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function updateElapsedTime() {
  elements.elapsedTime.textContent = formatElapsed(Date.now() - generationStartedAt);
  renderGenerationActivity();
}

function startGenerationClock() {
  window.clearInterval(elapsedTimer);
  generationStartedAt = Date.now();
  updateElapsedTime();
  elapsedTimer = window.setInterval(updateElapsedTime, 1000);
}

function stopGenerationClock() {
  window.clearInterval(elapsedTimer);
  elapsedTimer = 0;
}

function formatActivityBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes === 0) return '0MB';
  if (bytes >= 1024 ** 3) return `${(bytes / (1024 ** 3)).toFixed(2)}GB`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('ja-JP')}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function activityAgeText(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 5) return 'たった今';
  if (seconds < 60) return `${seconds}秒前`;
  return `${Math.floor(seconds / 60)}分前`;
}

function renderGenerationActivity() {
  if (!generationActivity) return;
  const now = Date.now();
  const age = generationActivity.lastAdvanceAt ? now - generationActivity.lastAdvanceAt : 0;
  const stageText = {
    preparing: '生成の準備をしています',
    finishBound: '完成できる手順を調べています',
    resourceQualityBound: '品質を上げられる組み合わせを調べています',
    stepLowerBound: '必要な手数を調べています',
    bestFirstSearch: '作り方の組み合わせを調べています',
    complete: '探索が完了しました'
  }[generationActivity.engineStage || generationActivity.stage] || '生成の準備をしています';
  const lines = [stageText];
  if (generationActivity.searchNodes > 0) {
    lines.push(`確認した候補：${generationActivity.searchNodes.toLocaleString('ja-JP')}件`);
  }
  if (generationActivity.work && generationActivity.engineStage !== 'complete') {
    const { completed, total } = generationActivity.work;
    lines.push(`今回の作業の進み具合：${Math.floor(completed * 1000 / total) / 10}%`);
  }
  if (generationActivity.reservedBytes > 0) {
    const used = Number.isFinite(generationActivity.diskUsedBytes)
      ? formatActivityBytes(generationActivity.diskUsedBytes) : '確認中';
    lines.push(`端末への一時保存：${used}／${formatActivityBytes(generationActivity.reservedBytes)}`);
  }
  if (globalThis.__xivcaDevelopment === true && generationActivity.readBytes > 0) {
    lines.push(`一時保存からの読み込み：${formatActivityBytes(generationActivity.readBytes)} 完了`);
  }
  if (globalThis.__xivcaDevelopment === true && generationActivity.lastAdvanceAt) {
    lines.push(`最後に処理の進行を確認：${activityAgeText(age)}`);
  }
  const detail = lines.join('\n');
  if (elements.generationStatus.textContent === detail) return;
  elements.generationStatus.textContent = detail;
  notifyHost('progress', { detail });
}

function setGenerationProgress(value) {
  elements.progress.removeAttribute?.('value');
  elements.progressPercent.hidden = true;
  const percent = Math.min(100, Math.round(Number(value) || 0));
  if (percent === 100 && generationActivity) {
    generationActivity.stage = 'complete';
    generationActivity.engineStage = 'complete';
    generationActivity.lastAdvanceAt = Date.now();
  }
  renderGenerationActivity();
}

function observeEngineTelemetry(snapshot = {}, context = {}) {
  const now = Date.now();
  const workUnits = Math.max(0, Number(snapshot.workUnits) || 0);
  const stage = String(snapshot.stage || 'preparing');
  const searchNodes = Math.max(0, Number(snapshot.searchNodes) || 0);
  const previousStage = generationActivity?.engineStage;
  const advancing = workUnits > lastEngineWorkUnits || searchNodes > (generationActivity?.searchNodes || 0)
    || (stage !== 'preparing' && stage !== previousStage);
  if (advancing) lastEngineWorkUnits = workUnits;
  generationActivity ||= { stage: 'preparing', engineStage: 'preparing', searchNodes: 0,
    writtenBytes: 0, readBytes: 0, lastAdvanceAt: 0 };
  generationActivity.stage = stage;
  generationActivity.engineStage = stage;
  generationActivity.searchNodes = Math.max(generationActivity.searchNodes, searchNodes);
  if (Number.isFinite(snapshot.storageDiskUsedBytes) && snapshot.storageDiskCapacityBytes > 0) {
    generationActivity.diskUsedBytes = snapshot.storageDiskUsedBytes;
  }
  if (advancing) generationActivity.lastAdvanceAt = now;
  globalThis.__xivcaMacroEngineStatus = {
    running: Boolean(generationController),
    advancing,
    stage: snapshot.stage || 'preparing',
    workUnits,
    lastUpdateAt: now,
    lastAdvanceAt: advancing ? now : globalThis.__xivcaMacroEngineStatus?.lastAdvanceAt || now,
    ...context,
    telemetry: { ...snapshot }
  };
  setGenerationProgress(stage === 'complete' ? 100 : 0);
}

function observeLiveSearchProgress(progress = {}) {
  const searchNodes = Number(progress.searchNodes);
  const activityCount = Math.max(0, Number(progress.activityCount) || 0);
  if (!Number.isSafeInteger(searchNodes) || !generationActivity || generationActivity.stage === 'complete'
    || (searchNodes <= generationActivity.searchNodes && activityCount <= (generationActivity.activityCount || 0))) return;
  const now = Date.now();
  generationActivity.searchNodes = Math.max(generationActivity.searchNodes, searchNodes);
  generationActivity.activityCount = Math.max(generationActivity.activityCount || 0, activityCount);
  generationActivity.lastAdvanceAt = now;
  generationActivity.stage = generationActivity.engineStage = 'bestFirstSearch';
  globalThis.__xivcaMacroEngineStatus = { ...globalThis.__xivcaMacroEngineStatus,
    advancing: true, lastAdvanceAt: now, liveProgress: { searchNodes, activityCount, receivedAt: now } };
  profiler.liveProgress(progress);
  renderGenerationActivity();
}

function observeWorkProgress(work = {}) {
  const { workId, phase, completed, total } = work;
  if (![workId, phase, completed, total].every(Number.isSafeInteger)
    || total <= 0 || completed < 0 || completed > total || phase < 1 || phase > 7
    || generationActivity?.engineStage === 'complete') return;
  const previous = generationActivity?.work;
  if (previous && (workId < previous.workId || (workId === previous.workId && completed <= previous.completed))) return;
  generationActivity ||= { stage: 'preparing', engineStage: 'preparing', searchNodes: 0,
    writtenBytes: 0, readBytes: 0, lastAdvanceAt: 0 };
  generationActivity.work = { workId, phase, completed, total };
  generationActivity.lastAdvanceAt = Date.now();
  profiler.workProgress(generationActivity.work);
  globalThis.__xivcaMacroEngineStatus = { ...globalThis.__xivcaMacroEngineStatus,
    advancing: true, lastAdvanceAt: generationActivity.lastAdvanceAt, workProgress: generationActivity.work };
  renderGenerationActivity();
}

function observeStorageProgress(metrics = {}) {
  profiler.storage(metrics);
  generationActivity ||= { stage: 'preparing', engineStage: 'preparing', searchNodes: 0,
    writtenBytes: 0, readBytes: 0, lastAdvanceAt: 0 };
  const writtenBytes = Math.max(0, Number(metrics.storageWrittenBytes) || 0);
  const readBytes = Math.max(0, Number(metrics.storageReadBytes) || 0);
  const reservedBytes = Math.max(0, Number(metrics.storageReservedBytes) || 0);
  const advancing = writtenBytes > generationActivity.writtenBytes || readBytes > generationActivity.readBytes
    || reservedBytes > (generationActivity.reservedBytes || 0);
  generationActivity.writtenBytes = Math.max(generationActivity.writtenBytes, writtenBytes);
  generationActivity.readBytes = Math.max(generationActivity.readBytes, readBytes);
  generationActivity.reservedBytes = Math.max(generationActivity.reservedBytes || 0, reservedBytes);
  if (advancing) generationActivity.lastAdvanceAt = Date.now();
  renderGenerationActivity();
}

async function requestGenerationWakeLock() {
  if (isHostedPanel()) return;
  const controller = generationController;
  if (!controller || controller.signal.aborted || document.visibilityState !== 'visible'
    || !navigator.wakeLock?.request || (wakeLockSentinel && !wakeLockSentinel.released)) return;
  try {
    const sentinel = await navigator.wakeLock.request('screen');
    if (controller !== generationController || controller.signal.aborted) {
      await sentinel.release();
      return;
    }
    wakeLockSentinel = sentinel;
    sentinel.addEventListener('release', () => {
      if (wakeLockSentinel === sentinel) wakeLockSentinel = null;
    }, { once: true });
  } catch {
    // Wake Lock is optional. Generation must continue if the browser or device rejects it.
  }
}

function releaseGenerationWakeLock() {
  const sentinel = wakeLockSentinel;
  wakeLockSentinel = null;
  if (sentinel && !sentinel.released) void sentinel.release().catch(() => {});
}

function reportHostedScroll() {
  if (!isHostedPanel() || restoringPanel) return;
  notifyHost('scroll', {
    scrollTop: elements.macroContent.scrollTop,
    scrollHeight: elements.macroContent.scrollHeight,
    clientHeight: elements.macroContent.clientHeight
  });
}

function preparedHostMacroData() {
  if (window.parent === window || requestedSiteRoot !== '../..') return null;
  try {
    return window.parent.MacroLauncher?.getPreparedData?.() || null;
  } catch {
    return null;
  }
}

function readStatuses() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
}

function numberValue(input) { return Number.parseInt(input.value, 10); }
function formStatus() {
  return {
    level: numberValue(elements.level), craftsmanship: numberValue(elements.craftsmanship),
    control: numberValue(elements.control), cp: numberValue(elements.cp),
    manipulation: elements.manipulation.checked, heartAndSoul: elements.heartAndSoul.checked,
    quickInnovation: elements.quickInnovation.checked
  };
}

function saveEditedStatus() {
  const statuses = readStatuses();
  statuses[elements.job.value] = formStatus();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(statuses));
  if (state.recipe?.job === elements.job.value) restoreGeneratedResult();
}

function currentSelection() {
  return {
    foodId: state.food?.id || null,
    medicineId: state.medicine?.id || null,
    hqIngredientIds: [...state.hqIngredientIds]
  };
}

function savePanelState() {
  if (restoringPanel || generationController || !state.recipe) return;
  try {
    savePanelView(localStorage, state.recipe.id, {
      job: elements.job.value,
      expanded: Object.fromEntries(Object.entries(panelSections).map(([key, section]) => [key, section.classList.contains('open')])),
      listScroll: { foodList: elements.foodList.scrollTop, medicineList: elements.medicineList.scrollTop }
    });
  } catch { /* A full or unavailable store must not prevent panel interaction. */ }
}

function selectionEdited() {
  try {
    saveDraftSelection(localStorage, {
      recipeId: state.recipe.id, dataVersion: state.data.dataVersion, selection: currentSelection()
    });
  } catch { /* Keep the current in-memory selection usable. */ }
  restoreGeneratedResult();
  savePanelState();
}

function setCrafterStatusExpanded(open) {
  elements.crafterStatusSection.classList.toggle('open', open);
  elements.crafterStatusSection.querySelector('.accordion-toggle').setAttribute('aria-expanded', String(open));
}

function focusFirstMissingStatusValue() {
  const input = ['level', 'craftsmanship', 'control', 'cp']
    .map(key => elements[key])
    .find(candidate => !Number.isInteger(numberValue(candidate)) || numberValue(candidate) <= 0);
  input?.focus();
}

function fillStatus(status = {}) {
  for (const key of ['level', 'craftsmanship', 'control', 'cp']) {
    const value = status[key];
    const maximum = Number(elements[key].max);
    const valid = Number.isInteger(value) && value > 0 && (!Number.isFinite(maximum) || maximum <= 0 || value <= maximum);
    elements[key].value = valid ? String(value) : '';
  }
  for (const key of ['manipulation', 'heartAndSoul', 'quickInnovation']) elements[key].checked = status[key] === true;
}

function jobIcon(job) {
  const file = CRAFTER_JOB_ICON_FILES[job];
  if (!file) return null;
  const image = document.createElement('img');
  image.className = 'job-icon';
  image.src = hostIconUrl(file) || siteAssetUrl(`assets/${file}`);
  image.alt = '';
  return image;
}

function jobVisual(job) {
  const visual = document.createElement('span');
  visual.className = 'macro-job-visual';
  const icon = jobIcon(job);
  if (icon) visual.append(icon);
  visual.append(createText('span', '', job));
  return visual;
}

function closeJobPicker() {
  elements.jobPicker.classList.remove('open');
  elements.jobChoices.classList.remove('open');
  elements.jobToggle.setAttribute('aria-expanded', 'false');
  elements.jobChoices.style.maxHeight = '0px';
}

function positionJobChoices() {
  const scale = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--font-size-scale')) || 1;
  const margin = 4 * scale;
  const gap = 2 * scale;
  const viewport = window.visualViewport;
  const viewportLeft = viewport?.offsetLeft || 0;
  const viewportTop = viewport?.offsetTop || 0;
  const viewportWidth = viewport?.width || window.innerWidth;
  const viewportHeight = viewport?.height || window.innerHeight;
  const viewportRight = viewportLeft + viewportWidth;
  const viewportBottom = viewportTop + viewportHeight;
  const toggle = elements.jobToggle.getBoundingClientRect();
  const width = Math.min(Math.max(toggle.width, 180 * scale), viewportWidth - margin * 2);
  const left = Math.max(viewportLeft + margin, Math.min(toggle.left, viewportRight - width - margin));
  const availableBelow = Math.max(0, viewportBottom - toggle.bottom - gap - margin);
  const availableAbove = Math.max(0, toggle.top - viewportTop - gap - margin);
  const placeAbove = availableAbove > availableBelow;
  const maxHeight = Math.max(0, placeAbove ? availableAbove : availableBelow);
  elements.jobChoices.style.left = `${left}px`;
  elements.jobChoices.style.width = `${width}px`;
  elements.jobChoices.style.maxHeight = `${maxHeight}px`;
  elements.jobChoices.style.top = placeAbove ? 'auto' : `${toggle.bottom + gap}px`;
  elements.jobChoices.style.bottom = placeAbove ? `${viewportBottom - toggle.top + gap}px` : 'auto';
}

function updateSelectedJobVisual() {
  elements.jobToggle.replaceChildren(jobVisual(elements.job.value));
  for (const option of elements.jobChoices.querySelectorAll('[role="option"]')) {
    const selected = option.dataset.job === elements.job.value;
    option.classList.toggle('active', selected);
    option.setAttribute('aria-selected', String(selected));
  }
}

function loadSelectedJob() {
  updateSelectedJobVisual();
  fillStatus(readStatuses()[elements.job.value]);
}

function selectJob(job) {
  if (!CRAFTER_JOBS.includes(job)) return;
  elements.job.value = job;
  loadSelectedJob();
  closeJobPicker();
  if (state.recipe?.job === job) restoreGeneratedResult();
  savePanelState();
}

function initializeJobPicker() {
  elements.jobChoices.replaceChildren(...CRAFTER_JOBS.map(job => {
    const option = document.createElement('li');
    option.dataset.job = job;
    option.setAttribute('role', 'option');
    option.setAttribute('tabindex', '0');
    option.append(jobVisual(job));
    option.addEventListener('click', () => selectJob(job));
    option.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      selectJob(job);
    });
    return option;
  }));
  elements.jobToggle.addEventListener('click', () => {
    const open = !elements.jobPicker.classList.contains('open');
    elements.jobPicker.classList.toggle('open', open);
    elements.jobChoices.classList.toggle('open', open);
    elements.jobToggle.setAttribute('aria-expanded', String(open));
    if (open) positionJobChoices();
    else closeJobPicker();
  });
  document.addEventListener('pointerdown', event => {
    if (elements.jobPicker.classList.contains('open') && !elements.jobPicker.contains(event.target)) closeJobPicker();
  });
  window.addEventListener('resize', closeJobPicker);
  new MutationObserver(closeJobPicker).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-font-size-level'],
  });
  new MutationObserver(closeJobPicker).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-font-size-level'],
  });
  window.visualViewport?.addEventListener('resize', closeJobPicker);
  window.visualViewport?.addEventListener('scroll', closeJobPicker);
  elements.macroContent.addEventListener('scroll', closeJobPicker, { passive: true });
}

function createText(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function createHqMark(className = '') {
  const image = document.createElement('img');
  image.className = `hq-mark${className ? ` ${className}` : ''}`;
  image.src = HQ_MARK_PATH;
  image.alt = 'HQ';
  image.title = 'HQ';
  return image;
}

function iconFor(item, hq = item.hq === true) {
  const source = item.icon || hostIconUrl(item.iconFile);
  if (!source) return null;
  const image = document.createElement('img');
  image.className = 'item-icon';
  image.src = source;
  image.alt = '';
  image.loading = 'lazy';
  const frame = document.createElement('span');
  frame.className = `item-icon-frame${hq ? ' is-hq' : ''}`;
  frame.setAttribute('aria-hidden', 'true');
  frame.append(image);
  return frame;
}

function hostIconUrl(iconFile) {
  if (!iconFile || window.parent === window) return '';
  try {
    return window.parent.MacroLauncher?.resolveIcon?.(iconFile) || '';
  } catch {
    return '';
  }
}

function effectsText(effects = {}) {
  const labels = [
    ['craftsmanship', '作業精度'], ['control', '加工精度'], ['cp', 'CP']
  ];
  return labels.flatMap(([key, label]) => {
    const percent = effects[`${key}Percent`] || 0;
    const cap = effects[`${key}Cap`] || 0;
    return percent ? [`${label} +${percent}%（上限${cap}）`] : [];
  }).join(' / ') || '製作向け効果なし';
}

function renderRecipe(recipe) {
  const displayNumber = value => Number.isInteger(value) ? String(value) : '—';
  const fragment = document.createDocumentFragment();
  const icon = iconFor(recipe, recipe.hqAvailable !== false);
  if (icon) fragment.append(icon);
  const details = document.createElement('div');
  details.className = 'recipe-details';
  const recipeName = createText('strong', 'recipe-name', recipe.name);
  if (recipe.hqAvailable !== false) recipeName.append(' ', createHqMark('hq-mark-inline'));
  details.append(
    recipeName,
    createText('span', '', `${recipe.job} Lv.${recipe.level}`)
  );
  const values = createText('span', 'recipe-values', '');
  values.append(
    createText('span', '', `工数 ${displayNumber(recipe.difficulty)}`),
    createText('span', '', `品質 ${displayNumber(recipe.maxQuality)}`),
    createText('span', '', `耐久 ${displayNumber(recipe.durability)}`)
  );
  details.append(values);
  const requirements = [
    recipe.requiredCraftsmanship > 0 ? `必要作業精度 ${recipe.requiredCraftsmanship}` : '',
    recipe.requiredControl > 0 ? `必要加工精度 ${recipe.requiredControl}` : ''
  ].filter(Boolean);
  if (requirements.length) {
    const badges = createText('span', 'recipe-requirements', '');
    badges.append(...requirements.map(requirement => createText('span', 'badge', requirement)));
    details.append(badges);
  }
  if (recipe.expert || recipe.hqAvailable === false) {
    const flags = document.createElement('span');
    if (recipe.expert) flags.append('高難易度');
    if (recipe.expert && recipe.hqAvailable === false) flags.append(' / ');
    if (recipe.hqAvailable === false) flags.append(createHqMark('hq-mark-inline'), '製作不可');
    details.append(flags);
  }
  fragment.append(details);
  elements.recipeInfo.className = 'recipe-summary';
  elements.recipeInfo.replaceChildren(fragment);
}

function renderIngredients() {
  const rows = state.recipe.ingredients.map(item => {
    const row = document.createElement('div');
    row.className = 'item-row';
    const initiallyHq = state.hqIngredientIds.has(String(item.id));
    const icon = iconFor(item, initiallyHq);
    if (icon) row.append(icon);
    const detail = document.createElement('div');
    detail.className = 'item-detail';
    detail.append(createText('strong', '', item.name), createText('span', '', `必要数 ${item.amount}`));
    const choices = document.createElement('div');
    choices.className = 'hq-choice-group';
    const hq = document.createElement('button');
    hq.className = 'settings-btn hq-quality-choice';
    hq.type = 'button';
    hq.append('すべて', createHqMark('hq-mark-toggle'));
    hq.title = `${item.name}をすべてHQで用意済みにする`;
    hq.setAttribute('aria-label', `${item.name}はすべてHQ`);
    const nq = createText('button', 'settings-btn hq-quality-choice', 'NQ');
    nq.type = 'button';
    nq.title = `${item.name}をNQで用意する`;
    nq.setAttribute('aria-label', `${item.name}はNQ`);
    const chooseQuality = hqSelected => {
      const id = String(item.id);
      if (hqSelected) state.hqIngredientIds.add(id); else state.hqIngredientIds.delete(id);
      icon?.classList.toggle('is-hq', hqSelected);
      hq.setAttribute('aria-pressed', String(hqSelected));
      nq.setAttribute('aria-pressed', String(!hqSelected));
      selectionEdited();
    };
    hq.addEventListener('click', () => chooseQuality(true));
    nq.addEventListener('click', () => chooseQuality(false));
    hq.setAttribute('aria-pressed', String(initiallyHq));
    nq.setAttribute('aria-pressed', String(!initiallyHq));
    choices.append(hq, nq);
    row.append(detail, choices);
    return row;
  });
  elements.ingredientList.className = `list${rows.length ? '' : ' empty'}`;
  elements.ingredientList.replaceChildren(...(rows.length ? rows : [document.createTextNode('中間素材はありません')]));
}

function consumableDetail(item) {
  const detail = document.createElement('span');
  detail.className = 'item-detail';
  const name = document.createElement('strong');
  name.append(item.name);
  if (item.hq) name.append(' ', createHqMark('hq-mark-inline'));
  const levels = [
    Number.isInteger(item.craftLevel) ? `製作Lv. ${item.craftLevel}` : '',
    Number.isInteger(item.itemLevel) ? `IL ${item.itemLevel}` : ''
  ].filter(Boolean);
  detail.append(
    name,
    createText('span', '', `${levels.length ? `${levels.join(' / ')} / ` : ''}${effectsText(item.effects)}`)
  );
  return detail;
}

function renderCurrentConsumable(container, item) {
  if (!item) {
    container.className = 'current-consumable-value empty';
    container.textContent = '使用しない';
    return;
  }
  const content = [];
  const icon = iconFor(item);
  if (icon) content.push(icon);
  content.push(consumableDetail(item));
  container.className = 'current-consumable-value';
  container.replaceChildren(...content);
}

function setAccordionExpanded(section, open) {
  section.classList.toggle('open', open);
  section.querySelector('.accordion-toggle')?.setAttribute('aria-expanded', String(open));
}

function renderConsumables(container, items, kind) {
  const none = createText('button', 'choice choice-list-btn', '使用しない');
  none.type = 'button';
  const selected = () => state[kind];
  const choose = (item, userInitiated = false) => {
    state[kind] = item;
    for (const button of container.querySelectorAll('.choice')) {
      button.classList.toggle('selected', button.dataset.id === (item?.id || ''));
    }
    renderCurrentConsumable(elements[`${kind}Current`], item);
    if (userInitiated) {
      setAccordionExpanded(container.closest('.accordion'), false);
      selectionEdited();
    }
  };
  none.dataset.id = '';
  none.addEventListener('click', () => choose(null, true));
  const buttons = sortConsumables(items).map(item => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice choice-list-btn consumable-choice';
    button.dataset.id = item.id;
    const icon = iconFor(item);
    if (icon) button.append(icon);
    button.append(consumableDetail(item));
    button.addEventListener('click', () => choose(item, true));
    return button;
  });
  container.replaceChildren(none, ...buttons);
  choose(selected());
}

function hideGeneratedResult() {
  elements.generatedAtSection.hidden = true;
  elements.generatedStatusSection.hidden = true;
  elements.macroSection.hidden = true;
}

let macroLineLayoutKey = '';
function syncMacroLineNumbers() {
  const output = elements.macroOutput;
  if (!output.clientWidth || elements.macroSection.hidden) return;
  const style = getComputedStyle(output);
  const key = `${output.clientWidth}:${style.font}:${output.value}`;
  if (key === macroLineLayoutKey) return;
  const lines = output.value.split('\n');
  const measure = elements.macroLineMeasure;
  measure.style.width = `${output.getBoundingClientRect().width}px`;
  measure.replaceChildren(...lines.map(line => createText('div', '', line || '\u00a0')));
  const numbers = lines.map((_, index) => createText('div', '', String(index + 1)));
  elements.macroLineNumbers.replaceChildren(...numbers);
  // The gutter can gain a digit and reduce the available text width.
  measure.style.width = `${output.getBoundingClientRect().width}px`;
  numbers.forEach((number, index) => {
    number.style.height = `${measure.children[index].getBoundingClientRect().height}px`;
  });
  const minimumHeight = 4 * parseFloat(style.lineHeight)
    + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
    + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
  output.style.height = `${Math.max(minimumHeight, measure.getBoundingClientRect().height)}px`;
  macroLineLayoutKey = `${output.clientWidth}:${style.font}:${output.value}`;
}

const macroOutputResizeObserver = new ResizeObserver(syncMacroLineNumbers);
macroOutputResizeObserver.observe(elements.macroOutput);
const macroOutputFontObserver = new MutationObserver(syncMacroLineNumbers);
macroOutputFontObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-font-size-level'] });
document.fonts?.ready.then(syncMacroLineNumbers);

function renderGeneratedStatus(result) {
  const status = result.crafter;
  const food = state.data.foods.find(item => item.id === result.selection.foodId);
  const medicine = state.data.medicines.find(item => item.id === result.selection.medicineId);
  const effective = effectiveCrafterStats(status, [food, medicine]);
  const stats = document.createElement('dl');
  stats.className = 'generated-status-grid';
  for (const [label, value] of [
    ['ジョブレベル', status.level], ['作業精度', status.craftsmanship],
    ['加工精度', status.control], ['CP', status.cp]
  ]) {
    const entry = document.createElement('div');
    entry.append(createText('dt', '', label), createText('dd', '', String(value)));
    stats.append(entry);
  }
  const options = createText('div', 'generated-status-options', [
    ['マニピュレーション', status.manipulation], ['一心不乱', status.heartAndSoul],
    ['クイックイノベーション', status.quickInnovation]
  ].map(([name, enabled]) => `${name}：${enabled ? 'あり' : 'なし'}`).join(' / '));
  const qualityName = (name, hq) => {
    const span = createText('span', '', `${name} `);
    span.append(hq ? createHqMark('hq-mark-inline') : 'NQ');
    return span;
  };
  const consumableLine = (label, item) => {
    const line = createText('div', '', `${label}：`);
    line.append(item ? qualityName(item.name, item.hq) : '使用しない');
    return line;
  };
  const hqIds = new Set(result.selection.hqIngredientIds.map(String));
  const ingredients = createText('div', '', '中間素材：');
  state.recipe.ingredients.forEach((item, index) => {
    if (index) ingredients.append(' / ');
    ingredients.append(qualityName(item.name, hqIds.has(String(item.id))));
  });
  if (!state.recipe.ingredients.length) ingredients.append('なし');
  elements.generatedStatus.replaceChildren(
    jobVisual(state.recipe.job),
    createText('strong', '', '基礎ステータス'), stats, options,
    consumableLine('食事', food),
    consumableLine('薬品', medicine),
    createText('div', '', `食事・薬品適用後：作業精度 ${effective.craftsmanship} / 加工精度 ${effective.control} / CP ${effective.cp}`),
    ingredients
  );
}

function showGeneratedResult(result) {
  elements.generatedAt.textContent = formatJapaneseDateTime(result.generatedAt);
  elements.generatedAt.dateTime = result.generatedAt;
  renderGeneratedStatus(result);
  elements.macroOutput.value = result.macro;
  elements.macroOutput.rows = Math.max(4, result.macro.split('\n').length);
  elements.generatedAtSection.hidden = false;
  elements.generatedStatusSection.hidden = false;
  elements.macroSection.hidden = false;
  setAccordionExpanded(elements.macroSection, true);
  syncMacroLineNumbers();
}

function scrollToGeneratedMacro() {
  requestAnimationFrame(() => {
    elements.macroSection.scrollIntoView({
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start'
    });
  });
}

function restoreGeneratedResult() {
  hideGeneratedResult();
  const status = readStatuses()[state.recipe.job];
  if (!isCompleteCrafterStatus(status, state.data.maxCrafterLevel)) return;
  const result = loadRestorableResult(localStorage, {
    recipeId: state.recipe.id, dataVersion: state.data.dataVersion,
    crafter: status, selection: currentSelection()
  });
  if (!result) return;
  showGeneratedResult(result);
}

function cancelSolverWorkerCleanup() {
  if (!solverWorkerCleanup) return;
  if (solverWorkerCleanup.kind === 'idle') window.cancelIdleCallback?.(solverWorkerCleanup.id);
  else window.clearTimeout(solverWorkerCleanup.id);
  solverWorkerCleanup = null;
}

function deleteSearchStorage(name) {
  if (!name) return;
  if (name.startsWith('opfs:')) {
    const fileName = name.slice(5);
    void (async () => {
      const root = await navigator.storage?.getDirectory?.();
      if (!root) return;
      for (const delay of [0, 100, 500]) {
        if (delay) await new Promise(resolve => window.setTimeout(resolve, delay));
        let failed = false;
        try {
          for await (const name of root.keys()) {
            if (name !== fileName && !name.startsWith(`${fileName}-`)) continue;
            try { await root.removeEntry(name); } catch { failed = true; }
          }
          if (!failed) return;
        } catch {}
      }
    })().catch(() => {});
    return;
  }
  indexedDB.deleteDatabase(name);
}

function terminateSolverWorkers() {
  cancelSolverWorkerCleanup();
  solverWorkers.forEach(worker => {
    let stopped = false;
    const finish = () => {
      if (stopped) return;
      stopped = true;
      clearTimeout(timeout);
      worker.removeEventListener('message', onDispose);
      worker.terminate();
      deleteSearchStorage(worker.searchDatabaseName);
    };
    const onDispose = ({ data }) => {
      if (data.type === 'storage-created' || data.type === 'storage-open') worker.searchDatabaseName = data.databaseName;
      if (data.type === 'disposed') finish();
    };
    const timeout = setTimeout(finish, 5000);
    worker.addEventListener('message', onDispose);
    worker.postMessage({ type: 'dispose' });
  });
  solverWorkers = [];
}

function scheduleSolverWorkerCleanup() {
  cancelSolverWorkerCleanup();
  elements.generateButton.disabled = true;
  const cleanup = () => {
    solverWorkerCleanup = null;
    if (!generationController) terminateSolverWorkers();
    if (!generationController) elements.generateButton.disabled = false;
  };
  if (typeof window.requestIdleCallback === 'function') {
    solverWorkerCleanup = {
      kind: 'idle',
      id: window.requestIdleCallback(cleanup, { timeout: 5000 })
    };
  } else {
    solverWorkerCleanup = { kind: 'timer', id: window.setTimeout(cleanup, 1000) };
  }
}

function stopGeneration({ deferWorkerCleanup = false } = {}) {
  if (generationController && !deferWorkerCleanup) setAccordionExpanded(elements.macroSection, false);
  profiler.finish('cancelled');
  generationController?.abort();
  generationController = null;
  if (deferWorkerCleanup) scheduleSolverWorkerCleanup();
  else {
    terminateSolverWorkers();
    elements.generateButton.disabled = false;
  }
  stopGenerationClock();
  releaseGenerationWakeLock();
  elements.progressOverlay.hidden = true;
  elements.appShell.inert = false;
  document.body.style.overflow = '';
  if (globalThis.__xivcaMacroEngineStatus) {
    globalThis.__xivcaMacroEngineStatus.running = false;
  }
  notifyHost('idle');
}

function generationFailureMessage(error) {
  const message = String(error?.message || error || '');
  if (!message) return '';
  if (/\bNoSolution\b/.test(message)) {
    return '現在の製作ステータスと設定では、完成に必要な工数・品質を満たす手順が見つかりませんでした。\n食事・薬品の使用や、製作ステータス・HQ素材の設定を見直してください。';
  }
  if (/out of memory|memory allocation.*failed|failed to allocate|could not allocate memory|unable to grow.*memory|メモリーを確保できません/i.test(message)) {
    return '計算に必要なメモリーを確保できなかったため、マクロを生成できませんでした。\nほかのアプリやタブを閉じてから、もう一度お試しください。';
  }
  if (error?.name === 'QuotaExceededError' || /quota.*exceed/i.test(message)) {
    return '端末の一時保存領域が不足しているため、マクロを生成できませんでした。\n空き容量を増やしてから、もう一度お試しください。';
  }
  if (/SearchQueueCapacityExceeded/.test(message)) {
    return '調べられる候補数の上限に達したため、マクロを生成できませんでした。\n食事・薬品やHQ素材の設定を見直してください。';
  }
  if (/一時保存|メモリー|不足|製作|完成保証/.test(message)) return message;
  if (['reserve', 'read', 'write', 'close'].includes(error?.diagnostics?.phase)) {
    return '途中経過の一時保存を処理できなかったため、マクロを生成できませんでした。\n再度失敗する場合は「不具合・お問い合わせ」からご報告ください。';
  }
  if (/^[\x00-\x7f]*$/.test(message) || /unreachable|RuntimeError|InternalError/.test(message)) {
    return 'マクロの計算処理でエラーが発生しました。原因を特定できなかったため、「不具合・お問い合わせ」からご報告ください。';
  }
  return message;
}

function closeGenerationMessage() {
  generationMessageWindow?.close();
  if (generationNotice) generationNotice.visible = false;
  if (!elements.generateButton.disabled) elements.generateButton.focus({ preventScroll: true });
}

function showGenerationMessage(message, { dialog = true } = {}) {
  const originalMessage = String(message?.message || message || '');
  const text = generationFailureMessage(message);
  elements.confirmMsg.textContent = text;
  elements.confirmMsg.hidden = !text;
  generationNotice = text ? { at: japaneseIsoDateTime(), originalMessage, dialog,
    id: crypto.randomUUID(), visible: dialog } : null;
  if (text && dialog) {
    if (isHostedPanel()) {
      notifyHost('notice', { message: text, noticeId: generationNotice.id });
    } else {
      generationMessageWindow.open();
      elements.confirmNo.focus({ preventScroll: true });
    }
  } else generationMessageWindow?.close();
}

function requestSolverWorker(worker, type, payload = {}, {
  signal = null, onTelemetry = () => {}, onStorageProgress = () => {}, onSearchProgress = () => {}, onWorkProgress = () => {}
} = {}) {
  solverRequestSerial += 1;
  const requestId = globalThis.crypto?.randomUUID?.()
    || `solver-${Date.now()}-${solverRequestSerial}`;
  return new Promise((resolve, reject) => {
    const expectedType = type === 'prepare'
      ? 'ready'
      : (type === 'search' || type === 'solve') ? 'search-result' : type;
    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
    };
    const onMessage = event => {
      if (event.data?.requestId !== requestId) return;
      if (event.data.type === 'storage-open' || event.data.type === 'storage-created') {
        worker.searchDatabaseName = event.data.databaseName;
        if (event.data.metrics) onStorageProgress({ ...event.data.metrics, operation: 'open' });
        return;
      }
      if (event.data.type === 'search-progress') {
        onSearchProgress(event.data);
        return;
      }
      if (event.data.type === 'work-progress') {
        onWorkProgress(event.data);
        return;
      }
      if (event.data.type === 'telemetry') {
        onTelemetry(event.data.snapshot);
        return;
      }
      if (event.data.type === 'storage-progress') {
        onStorageProgress(event.data.metrics);
        return;
      }
      if (event.data.type !== expectedType && event.data.type !== 'error') return;
      cleanup();
      if (event.data.type === expectedType) resolve(event.data);
      else {
        const error = new Error(event.data.message || 'マクロ生成エンジンを準備できません');
        error.name = event.data.errorName || 'Error';
        error.diagnostics = event.data.diagnostics;
        reject(error);
      }
    };
    const onError = event => {
      cleanup();
      reject(new Error(event?.message || 'マクロ生成エンジンを準備できません'));
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException('マクロ生成を中断しました', 'AbortError'));
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.postMessage({ type, requestId, ...payload });
  });
}

function updateSolverRuntime(threadCount, threadError = '', activeThreadCount = threadCount) {
  const logicalProcessors = Math.floor(Number(navigator.hardwareConcurrency));
  const deviceMemory = Number(navigator.deviceMemory);
  globalThis.__xivcaMacroRuntime = {
    logicalProcessors: Number.isFinite(logicalProcessors) ? logicalProcessors : null,
    deviceMemoryGiB: Number.isFinite(deviceMemory) ? deviceMemory : null,
    workerCount: 1,
    threadCount,
    activeThreadCount,
    threadError
  };
}

async function prepareSolverWorkers(signal = null) {
  terminateSolverWorkers();
  const desiredCount = selectSolverWorkerCount(navigator);
  const first = new Worker('./solver-host.js', { type: 'module' });
  try {
    const ready = await requestSolverWorker(first, 'prepare', { threadCount: desiredCount }, { signal });
    solverWorkers.push(first);
    updateSolverRuntime(ready.threadCount || 1, ready.threadError || '', ready.activeThreadCount || 1);
  } catch (error) {
    first.terminate();
    throw error;
  }
}

async function ensureSolverWorkers(signal) {
  cancelSolverWorkerCleanup();
  if (solverWorkers.length === 0) await prepareSolverWorkers(signal);
}

async function runSolver(input, signal) {
  profiler.start(input, {
    environment: captureEnvironment(true),
    recipeId: state.recipe.id, recipeName: state.recipe.name, dataVersion: state.data.dataVersion,
    crafter: readStatuses()[state.recipe.job], selection: currentSelection(),
    userAgent: navigator.userAgent, secureContext: isSecureContext,
    crossOriginIsolated, protocol: location.protocol, runtime: globalThis.__xivcaMacroRuntime
  });
  const startedProfile = profiler.current;
  void collectDeviceInfo(navigator).then(info => {
    Object.assign(startedProfile.metadata.environment, info);
    if (profiler.current === startedProfile) profiler.persist();
  });
  setGenerationProgress(3);
  const response = await requestSolverWorker(
    solverWorkers[0],
    'solve',
    { input },
    {
      signal,
      onStorageProgress: observeStorageProgress,
      onSearchProgress: observeLiveSearchProgress,
      onWorkProgress: observeWorkProgress,
      onTelemetry: snapshot => {
        profiler.sample(snapshot);
        const context = {
          workerIndex: 0,
          workerCount: 1,
          threadCount: globalThis.__xivcaMacroRuntime?.threadCount || 1
        };
        globalThis.__xivcaMacroTelemetry = { ...snapshot, ...context };
        observeEngineTelemetry(snapshot, context);
      }
    }
  );
  profiler.finish(response.result?.actions ? 'completed' : 'no-solution', { result: response.result });
  return response.result?.actions || null;
}

elements.statusForm.addEventListener('submit', event => event.preventDefault());
for (const key of ['level', 'craftsmanship', 'control', 'cp']) {
  elements[key].addEventListener('input', () => {
    if (key === 'level') {
      const value = numberValue(elements.level);
      const maximum = Number(elements.level.max);
      if (Number.isInteger(value) && value > maximum) elements.level.value = String(maximum);
    }
    saveEditedStatus();
  });
}
for (const key of ['manipulation', 'heartAndSoul', 'quickInnovation']) {
  elements[key].addEventListener('change', saveEditedStatus);
}
document.querySelectorAll('.accordion-toggle').forEach(button => button.addEventListener('click', () => {
  const section = button.closest('.accordion');
  setAccordionExpanded(section, !section.classList.contains('open'));
  savePanelState();
}));

elements.cancelButton.addEventListener('click', stopGeneration);
elements.confirmNo.addEventListener('click', closeGenerationMessage);
elements.confirmOverlay.addEventListener('click', event => {
  if (event.target === elements.confirmOverlay) closeGenerationMessage();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && generationMessageWindow?.isOpen()) closeGenerationMessage();
});
elements.statusWarningButton.addEventListener('click', () => {
  elements.statusWarningOverlay.hidden = true;
  elements.appShell.inert = false;
  focusFirstMissingStatusValue();
});
elements.copyMacroButton.addEventListener('click', async () => {
  const text = elements.macroOutput.value;
  let copied = false;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API is unavailable');
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    const focused = document.activeElement;
    const selection = document.getSelection();
    const ranges = Array.from({ length: selection?.rangeCount || 0 }, (_, index) => selection.getRangeAt(index).cloneRange());
    const buffer = document.createElement('textarea');
    buffer.className = 'macro-copy-buffer';
    buffer.value = text;
    buffer.readOnly = true;
    buffer.tabIndex = -1;
    buffer.setAttribute('aria-hidden', 'true');
    document.body.append(buffer);
    try {
      buffer.focus({ preventScroll: true });
      buffer.select();
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    } finally {
      buffer.remove();
      focused?.focus({ preventScroll: true });
      selection?.removeAllRanges();
      for (const range of ranges) selection?.addRange(range);
    }
  }
  elements.copyMacroButton.classList.toggle('copied', copied);
  elements.copyMacroButton.title = copied ? 'コピー済み' : 'コピーできませんでした';
  elements.copyMacroButton.setAttribute('aria-label', elements.copyMacroButton.title);
  window.setTimeout(() => {
    elements.copyMacroButton.classList.remove('copied');
    elements.copyMacroButton.title = 'マクロをコピー';
    elements.copyMacroButton.setAttribute('aria-label', 'マクロをコピー');
  }, 1500);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) savePanelState();
  if (!document.hidden && generationController) void requestGenerationWakeLock();
});
window.addEventListener('pageshow', event => {
  if (event.persisted && generationController) {
    if (!isHostedPanel()) elements.progressOverlay.hidden = false;
    void requestGenerationWakeLock();
  }
});
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== window.parent) return;
  if (event.data?.source === 'xivca-host' && event.data.type === 'cancel') stopGeneration();
  if (event.data?.source === 'xivca-host' && event.data.type === 'notice-closed'
    && event.data.noticeId === generationNotice?.id) closeGenerationMessage();
});
elements.generateButton.addEventListener('click', async () => {
  const status = readStatuses()[state.recipe.job];
  if (!isCompleteCrafterStatus(status, state.data.maxCrafterLevel)) {
    setAccordionExpanded(elements.macroSection, false);
    setAccordionExpanded(elements.macroSection, false);
    elements.job.value = state.recipe.job;
    updateSelectedJobVisual();
    fillStatus(status);
    setCrafterStatusExpanded(true);
    showGenerationMessage('製作ステータスを入力してください。', { dialog: false });
    elements.statusWarningOverlay.hidden = false;
    elements.appShell.inert = true;
    elements.statusWarningButton.focus();
    return;
  }
  showGenerationMessage('');
  const selection = {
    food: state.food, medicine: state.medicine,
    hqIngredientIds: [...state.hqIngredientIds]
  };
  const parameterFailure = recipeParameterFailure(state.recipe, selection);
  if (parameterFailure) {
    setAccordionExpanded(elements.macroSection, false);
    setAccordionExpanded(elements.macroSection, false);
    showGenerationMessage(`完成保証マクロを生成できません。${parameterFailure}`);
    return;
  }
  const statusFailure = crafterStatusFailure(state.recipe, status, selection);
  if (statusFailure) {
    setAccordionExpanded(elements.macroSection, false);
    setAccordionExpanded(elements.macroSection, false);
    elements.job.value = state.recipe.job;
    updateSelectedJobVisual();
    fillStatus(status);
    setCrafterStatusExpanded(true);
    showGenerationMessage(`完成保証マクロを生成できません。${statusFailure}`);
    return;
  }
  lastEngineWorkUnits = 0;
  generationActivity = {
    stage: 'preparing', engineStage: 'preparing', searchNodes: 0,
    writtenBytes: 0, readBytes: 0, lastAdvanceAt: 0
  };
  globalThis.__xivcaMacroEngineStatus = {
    running: true,
    advancing: false,
    stage: 'preparing',
    workUnits: 0,
    lastUpdateAt: Date.now(),
    lastAdvanceAt: Date.now()
  };
  elements.progress.removeAttribute('value');
  elements.progressPercent.hidden = true;
  if (isHostedPanel()) {
    elements.progressOverlay.hidden = true;
  } else {
    elements.progressOverlay.hidden = false;
    elements.appShell.inert = true;
    elements.cancelButton.focus();
    document.body.style.overflow = 'hidden';
  }
  const controller = new AbortController();
  generationController = controller;
  elements.generateButton.disabled = true;
  startGenerationClock();
  notifyHost('busy');
  setGenerationProgress(1);
  void requestGenerationWakeLock();
  try {
    await ensureSolverWorkers(controller.signal);
    const actions = await runSolver(buildSearchInput(state.recipe, status, selection), controller.signal);
    if (controller.signal.aborted) return;
    if (actions) {
      setGenerationProgress(100);
      await new Promise(resolve => window.setTimeout(resolve, COMPLETION_HOLD_MS));
      if (controller.signal.aborted) return;
      const result = {
        recipeId: state.recipe.id, dataVersion: state.data.dataVersion,
        engineVersion: ENGINE_VERSION, crafter: status,
        selection: currentSelection(),
        macro: formatMacro(actions), generatedAt: japaneseIsoDateTime()
      };
      saveGeneratedResult(localStorage, result);
      stopGeneration({ deferWorkerCleanup: true });
      showGeneratedResult(result);
      scrollToGeneratedMacro();
    } else {
      stopGeneration();
      showGenerationMessage('NoSolution');
    }
  } catch (error) {
    if (error?.name === 'AbortError' && controller.signal.aborted) return;
    profiler.finish('error', { error: String(error?.message || error),
      errorName: error?.name || 'Error', errorDetails: error?.diagnostics || null });
    stopGeneration();
    showGenerationMessage(error || 'マクロ生成中にエラーが発生しました。');
  }
});

function installHostedSwipeNavigation() {
  if (!isHostedPanel()) return;
  let gesture = null;
  const clear = () => {
    if (gesture?.captureTarget?.hasPointerCapture?.(gesture.id)) {
      gesture.captureTarget.releasePointerCapture(gesture.id);
    }
    gesture = null;
  };
  const evaluate = event => {
    if (!gesture || event.pointerId !== gesture.id) return false;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (dx < 64 || Math.abs(dx) < Math.abs(dy) * 1.25) return false;
    clear();
    notifyHost('swipe', { direction: 'right' });
    return true;
  };
  document.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button > 0) return;
    const captureTarget = event.target instanceof Element ? event.target : document.documentElement;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, captureTarget };
    try { captureTarget.setPointerCapture?.(event.pointerId); } catch {}
  }, { passive: true });
  document.addEventListener('pointermove', evaluate, { passive: true });
  document.addEventListener('pointerup', event => {
    if (evaluate(event)) return;
    clear();
  }, { passive: true });
  document.addEventListener('pointercancel', clear, { passive: true });
  let touchGesture = null;
  document.addEventListener('touchstart', event => {
    if (event.touches.length !== 1) {
      touchGesture = null;
      return;
    }
    touchGesture = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  }, { passive: true, capture: true });
  document.addEventListener('touchend', event => {
    const start = touchGesture;
    touchGesture = null;
    const touch = event.changedTouches[0];
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (dx >= 64 && Math.abs(dx) >= Math.abs(dy) * 1.25) {
      notifyHost('swipe', { direction: 'right' });
    }
  }, { passive: true, capture: true });
  document.addEventListener('touchcancel', () => { touchGesture = null; }, { passive: true, capture: true });
}

installHostedSwipeNavigation();
elements.macroContent.addEventListener('scroll', reportHostedScroll, { passive: true });
if (typeof ResizeObserver === 'function') new ResizeObserver(reportHostedScroll).observe(elements.macroContent);

window.addEventListener('pagehide', event => {
  savePanelState();
  if (event.persisted) return;
  stopGeneration();
});

async function initialize() {
  try {
    initializeJobPicker();
    state.data = preparedHostMacroData() || await loadMacroData(siteAssetUrl('data/Item.json'));
    elements.level.max = String(state.data.maxCrafterLevel);
    state.recipe = recipeFromLocation(state.data);
    if (!state.recipe) throw new Error('選択された製作レシピが見つかりません');
    const view = loadPanelView(localStorage, state.recipe.id);
    const context = { recipeId: state.recipe.id, dataVersion: state.data.dataVersion,
      crafter: readStatuses()[state.recipe.job] };
    // Existing installations may have a result but no separately saved selection.
    const selection = loadDraftSelection(localStorage, context)
      || loadRestorableResult(localStorage, context)?.selection;
    state.food = state.data.foods.find(item => item.id === selection?.foodId) || null;
    state.medicine = state.data.medicines.find(item => item.id === selection?.medicineId) || null;
    state.hqIngredientIds = new Set(state.recipe.ingredients
      .filter(item => selection?.hqIngredientIds.includes(String(item.id))).map(item => String(item.id)));
    try {
      saveDraftSelection(localStorage, { ...context, selection: currentSelection() });
    } catch { /* Restoration must also work when storage is unavailable. */ }
    document.documentElement.classList.add('restoring-panel');
    elements.job.value = CRAFTER_JOBS.includes(view?.job) ? view.job : state.recipe.job;
    loadSelectedJob();
    renderRecipe(state.recipe);
    renderIngredients();
    renderConsumables(elements.foodList, state.data.foods, 'food');
    renderConsumables(elements.medicineList, state.data.medicines, 'medicine');
    setCrafterStatusExpanded(!isCompleteCrafterStatus(readStatuses()[state.recipe.job], state.data.maxCrafterLevel));
    restoreGeneratedResult();
    for (const [key, section] of Object.entries(panelSections)) {
      if (typeof view?.expanded?.[key] === 'boolean') setAccordionExpanded(section, view.expanded[key]);
    }
    const restoredScrollTop = Math.max(0, Math.floor(Number(new URLSearchParams(location.search).get('scrollTop')) || 0));
    // New/different recipes start at the top; saved-view restoration supplies
    // an explicit position. Reopening the same recipe keeps this document.
    await document.fonts?.ready;
    requestAnimationFrame(() => {
      syncMacroLineNumbers();
      for (const key of ['foodList', 'medicineList']) {
        elements[key].scrollTop = Math.max(0, Number(view?.listScroll?.[key]) || 0);
      }
      elements.macroContent.scrollTop = restoredScrollTop;
      // Apply the complete layout without opening/closing animations before scrolling.
      elements.macroContent.getBoundingClientRect();
      document.documentElement.classList.remove('restoring-panel');
      restoringPanel = false;
      reportHostedScroll();
    });
  } catch (error) {
    document.documentElement.classList.remove('restoring-panel');
    restoringPanel = false;
    elements.recipeInfo.className = 'empty';
    elements.recipeInfo.textContent = String(error?.message || error);
    return;
  }

  try {
    await prepareSolverWorkers();
    elements.generateButton.disabled = false;
  } catch (error) {
    showGenerationMessage(error || 'マクロ生成エンジンを準備できませんでした。');
  }
}

function captureEnvironment(atGenerationStart = false) {
  const limits = globalThis.__localMobileApplied;
  return { 言語: navigator.language, ...collectScreenInfo(window),
    セキュアコンテキスト: isSecureContext, 分離コンテキスト: crossOriginIsolated,
    ページ表示状態: document.visibilityState, データ版: state.data?.dataVersion,
    エンジン版: ENGINE_VERSION,
    ...(atGenerationStart ? { 開発用制限: limits?.enabled ? { ...limits } : '無効' } : {}) };
}

function captureBugReport() {
  const readable = element => {
    if (!element) return '';
    const walk = node => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent;
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      if (node.tagName === 'IMG') return node.alt || '';
      if (node.tagName === 'BR') return '\n';
      const text = [...node.childNodes].map(walk).join('');
      if (node.tagName === 'DT') return `${text}：`;
      if (node.tagName === 'STRONG') return `\n${text}\n`;
      if (node.tagName === 'SPAN' && element === elements.recipeInfo) return `${text}\n`;
      if (['DIV', 'DL', 'DD', 'P', 'LI'].includes(node.tagName)) return `${text}\n`;
      return text;
    };
    return walk(element).replace(/ *\n */g, '\n').replace(/\n+/g, '\n').trim();
  };
  const selected = item => item ? {
    名前: item.name, 品質: item.hq ? 'HQ' : 'NQ', 効果: item.effects,
    表示: readable(document.querySelector(`[data-id="${CSS.escape(item.id)}"]`))
  } : '使用しない';
  const profile = profiler.current;
  const relevant = profile?.metadata?.recipeId === state.recipe?.id ? profile : null;
  const reportProfile = profileForReport(relevant);
  return {
    取得日時: japaneseIsoDateTime(),
    出力元JavaScript識別子: REPORT_BUILD_ID,
    実行区分: globalThis.__xivcaDevelopment === true ? '開発環境' : '通常配信（開発用コードなし）',
    記録の区分: '本番共通のアプリ内記録。開発サーバーの監視ログ・送信ログ・試験結果ファイルは参照しません',
    製作アイテム: readable(elements.recipeInfo),
    レシピ情報: state.recipe ? {
      ID: state.recipe.id, ジョブ: state.recipe.job, レベル: state.recipe.level,
      耐久: state.recipe.durability, 必要工数: state.recipe.difficulty, 最大品質: state.recipe.maxQuality,
      必要作業精度: state.recipe.requiredCraftsmanship, 必要加工精度: state.recipe.requiredControl,
      計算係数: state.recipe.recipeLevel
    } : null,
    中間素材: state.recipe?.ingredients.map(item => ({ 名前: item.name, 必要数: item.amount,
      品質: state.hqIngredientIds.has(String(item.id)) ? 'HQ' : 'NQ' })) || [],
    現在の製作ステータス: { ジョブ: elements.job.value, ...formStatus() },
    食事: selected(state.food), 薬品: selected(state.medicine),
    前回のマクロ生成日時とクラフターステータス: elements.generatedStatusSection.hidden
      ? '表示なし' : `生成日時：${elements.generatedAt.textContent}（日本標準時）\n\n${readable(elements.generatedStatus).replace(/ \/ /g, '\n')}`,
    マクロ: elements.macroSection.hidden ? '表示なし' : elements.macroOutput.value,
    画面の通知: elements.confirmMsg.hidden ? '' : elements.confirmMsg.textContent,
    通知の詳細: generationNotice ? {
      通知日時: generationNotice.at,
      表示先: generationNotice.dialog ? 'フローティングウィンドウ' : '製作ステータスの警告',
      表示中: generationNotice.dialog ? generationNotice.visible : !elements.statusWarningOverlay.hidden,
      元の内容: generationNotice.originalMessage.replace(/https?:\/\/[^\s)]+/g, '[URL省略]')
    } : null,
    現在の生成状況: { 実行中: Boolean(generationController),
      表示: generationController ? elements.generationStatus.textContent : '生成していません' },
    直近の生成記録: {
      開始日時: relevant?.startedAt ? japaneseIsoDateTime(relevant.startedAt) : null, 状態: relevant?.status || '未生成',
      経過時間: reportElapsed(generationController ? Date.now() - generationStartedAt : relevant?.elapsedMs) },
    直近の生成時の入力: relevant?.input || '未記録',
    直近の生成開始時の実行環境: relevant?.metadata?.environment
      ? structuredClone(relevant.metadata.environment) : {
        画面と端末情報: '未記録',
        開発用制限: relevant?.metadata?.localResourceTest
          ? structuredClone(relevant.metadata.localResourceTest) : '未記録' },
    生成エラー: String(relevant?.error || '').replace(/https?:\/\/[^\s)]+/g, '[URL省略]'),
    生成エラー詳細: JSON.parse(JSON.stringify({ 種類: relevant?.errorName || null, ...relevant?.errorDetails },
      (_key, value) => typeof value === 'string' ? value.replace(/https?:\/\/[^\s)]+/g, '[URL省略]') : value)),
    一時保存の計測: reportProfile.storage,
    一時保存の準備と終了: reportProfile.storageEvents,
    ブラウザー容量推計: reportProfile.estimates,
    容量推計の注意: '探索側の共有領域にある未更新の0とは混在させません。端末全体の空きディスク容量ではありません。',
    生成全体の記録: reportProfile.summary,
    開発時だけの記録: reportProfile.development || 'なし',
    計測値の意味: (relevant?.memoryMeaning || '未記録').replace(/。(?=[^\r\n])/gu, '。\n'),
    処理の進行確認: relevant ? {
      最後の探索計測からの経過時間ms: Math.max(0, (generationController
        ? Date.now() - Date.parse(relevant.startedAt) : relevant.elapsedMs) - (relevant.samples.at(-1)?.elapsedMs || 0)),
      最後の進行確認からの経過時間ms: generationController && generationActivity?.lastAdvanceAt
        ? Math.max(0, Date.now() - generationActivity.lastAdvanceAt) : null
    } : null,
    直近の探索計測: reportProfile.samples,
    メモリー拡張の記録: relevant?.memoryEvents || [],
    直近の作業進捗: relevant?.workProgress || null,
    作業進捗と保存待ちの意味: '作業進捗は今回の処理範囲の実作業量で、全生成の完了率や確認した候補数ではありません。\nstorageReadMs／storageWriteMsは保存APIの処理時間、storageFlushMsはOPFSの書込反映時間です。\nstorageSolverWaitMsは単独エンジンが非同期保存の完了を待って計算を中断した時間で、通知の空白時間やOSのCPU待機時間ではありません。\nstorageSolverWaitCountは待機回数、storageSolverMaxWaitMsは1回の最長待機時間です。\n保存APIの処理時間と待機時間には重複があるため加算しません。',
    メモリー拡張の記録の意味: '最大64件。ページ単位は64KiB。\nrequestedPagesは追加要求、currentPagesは要求前の確保量、maximumPagesは設定上限。\noutcomeは0＝既知の上限超過を事前回避、1＝実際の拡張失敗、2＝拡張成功。\nstageは0＝初期化、1＝準備、2＝完成条件、3＝品質上限、4＝必要手数、5＝候補探索、6＝完了。\nphaseは0＝準備、1＝候補復元、2＝候補比較、3＝候補展開、4＝結果統合。\n失敗後の成功・退避量・候補数と合わせて確認します。',
    報告時の実行環境: captureEnvironment()
  };
}

globalThis.captureInquiryDiagnostics = captureBugReport;
if (window.parent !== window && typeof window.parent.openAppReport === 'function') {
  document.getElementById('bugReportButton').addEventListener('click', event => {
    void window.parent.openAppReport(event.currentTarget);
  });
} else {
  installBugReport({ capture: captureBugReport });
}

initialize();
