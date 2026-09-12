import { installBugReport, reportElapsed } from './bug-report.js';
import { collectDeviceInfo, collectScreenInfo } from './device-info.js';
import { loadMacroData, recipeFromLocation } from './data-loader.js';
import {
  CRAFTER_JOBS, buildSearchInput, crafterStatusFailure, effectiveCrafterStats, formatMacro,
  isCompleteCrafterStatus, recipeParameterFailure, sortConsumables
} from './model.js';
import {
  formatJapaneseDateTime, japaneseIsoDateTime, loadRestorableResult, saveGeneratedResult
} from './persistence.js';
import { selectSolverWorkerCount } from './worker-policy.js';
import { createProfiler } from './profiling.js';

const STORAGE_KEY = 'xivca.macro.crafter-status.v1';
// Raphael のバージョンに内部リビジョンを付加し、生成エンジンの変更時に末尾を増やす。
const ENGINE_VERSION = '0.28.6.1';
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
let lastGenerationProgress = 0;
let lastEngineWorkUnits = 0;
let solverWorkerCleanup = null;
const profiler = createProfiler(localStorage);
Object.defineProperty(globalThis, '__xivcaMacroProfile', { get: () => profiler.current });

function siteAssetUrl(path) {
  return new URL(`${siteRoot}/${path}`, location.href).href;
}

function isHostedPanel() {
  return window.parent !== window && requestedSiteRoot === '../..';
}

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

function setGenerationProgress(value, detail = '') {
  const percent = Math.max(lastGenerationProgress, Math.min(100, Math.round(Number(value) || 0)));
  lastGenerationProgress = percent;
  elements.progress.value = percent;
  elements.progressPercent.value = `${percent}%`;
  elements.progressPercent.textContent = `${percent}%`;
  if (detail || percent <= 3 || percent === 100) {
    elements.generationStatus.textContent = detail || (percent === 100 ? '生成が完了しました' : '生成を準備しています');
  }
  notifyHost('progress', { percent, detail: elements.generationStatus.textContent });
}

function telemetryProgress(snapshot = {}) {
  const stage = String(snapshot.stage || 'preparing');
  if (stage === 'finishBound') {
    return 5 + Math.min(9, Math.floor(Math.log2(Math.max(1, Number(snapshot.finishStates) || 0))));
  }
  if (stage === 'resourceQualityBound') {
    const stateRatio = (Number(snapshot.resourceQualityMemoEntries) || 0)
      / Math.max(1, Number(snapshot.resourceQualityStateLimit) || 1);
    const pointRatio = (Number(snapshot.resourceQualityFrontPoints) || 0)
      / Math.max(1, Number(snapshot.resourceQualityPointLimit) || 1);
    return 15 + Math.floor(Math.min(1, Math.max(stateRatio, pointRatio)) * 34);
  }
  if (stage === 'stepLowerBound') return 40;
  if (stage === 'bestFirstSearch') {
    const processed = Number(snapshot.searchNodes) || 0;
    const queued = Number(snapshot.searchQueuedNodes) || 0;
    const known = processed + queued;
    return 50 + Math.floor((known > 0 ? processed / known : 0) * 48);
  }
  if (stage === 'complete') return 99;
  return 3;
}

function observeEngineTelemetry(snapshot = {}, context = {}) {
  const now = Date.now();
  const workUnits = Math.max(0, Number(snapshot.workUnits) || 0);
  const advancing = workUnits > lastEngineWorkUnits;
  if (advancing) lastEngineWorkUnits = workUnits;
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
  const detail = snapshot.stage === 'bestFirstSearch'
    ? `マクロを探索中：${Math.max(0, Number(snapshot.searchNodes) || 0).toLocaleString('ja-JP')}件確認`
    : {
      finishBound: '完成できる手順を確認しています',
      resourceQualityBound: '到達できる品質を計算しています',
      stepLowerBound: '必要な手数を計算しています',
      complete: '探索が完了しました'
    }[snapshot.stage] || '生成を準備しています';
  setGenerationProgress(telemetryProgress(snapshot), detail);
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
  if (!isHostedPanel()) return;
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
      hideGeneratedResult();
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
      hideGeneratedResult();
      setAccordionExpanded(container.closest('.accordion'), false);
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
    crafter: status
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

function terminateSolverWorkers() {
  cancelSolverWorkerCleanup();
  solverWorkers.forEach(worker => {
    worker.terminate();
    if (worker.searchDatabaseName) indexedDB.deleteDatabase(worker.searchDatabaseName);

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

function showGenerationMessage(message) {
  elements.generationMessage.textContent = message;
  elements.generationMessage.hidden = !message;
}

function requestSolverWorker(worker, type, payload = {}, { signal = null, onTelemetry = () => {} } = {}) {
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
      if (event.data.type === 'storage-open') {
        worker.searchDatabaseName = event.data.databaseName;
        return;
      }
      if (event.data.type === 'telemetry') {
        onTelemetry(event.data.snapshot);
        return;
      }
      if (event.data.type !== expectedType && event.data.type !== 'error') return;
      cleanup();
      if (event.data.type === expectedType) resolve(event.data);
      else reject(new Error(event.data.message || 'マクロ生成エンジンを準備できません'));
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

function updateSolverRuntime(threadCount, threadError = '') {
  const logicalProcessors = Math.floor(Number(navigator.hardwareConcurrency));
  const deviceMemory = Number(navigator.deviceMemory);
  globalThis.__xivcaMacroRuntime = {
    logicalProcessors: Number.isFinite(logicalProcessors) ? logicalProcessors : null,
    deviceMemoryGiB: Number.isFinite(deviceMemory) ? deviceMemory : null,
    workerCount: 1,
    threadCount,
    threadError
  };
}

async function prepareSolverWorkers(signal = null) {
  terminateSolverWorkers();
  const desiredCount = selectSolverWorkerCount(navigator);
  const first = new Worker('./solver-worker.js', { type: 'module' });
  try {
    const ready = await requestSolverWorker(first, 'prepare', { threadCount: desiredCount }, { signal });
    solverWorkers.push(first);
    updateSolverRuntime(ready.threadCount || 1, ready.threadError || '');
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
}));

elements.cancelButton.addEventListener('click', stopGeneration);
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
    showGenerationMessage('製作ステータスを入力してください。');
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
  lastGenerationProgress = 0;
  lastEngineWorkUnits = 0;
  globalThis.__xivcaMacroEngineStatus = {
    running: true,
    advancing: false,
    stage: 'preparing',
    workUnits: 0,
    lastUpdateAt: Date.now(),
    lastAdvanceAt: Date.now()
  };
  elements.progress.value = 1;
  elements.progressPercent.value = '1%';
  elements.progressPercent.textContent = '1%';
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
      showGenerationMessage('現在の製作ステータスと設定では、完成保証マクロを生成できません。');
    }
  } catch (error) {
    if (error?.name === 'AbortError') return;
    profiler.finish('error', { error: String(error?.message || error) });
    stopGeneration();
    showGenerationMessage(error?.message || 'マクロ生成中にエラーが発生しました。');
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
    elements.job.value = state.recipe.job;
    loadSelectedJob();
    renderRecipe(state.recipe);
    renderIngredients();
    renderConsumables(elements.foodList, state.data.foods, 'food');
    renderConsumables(elements.medicineList, state.data.medicines, 'medicine');
    setCrafterStatusExpanded(!isCompleteCrafterStatus(readStatuses()[state.recipe.job], state.data.maxCrafterLevel));
    restoreGeneratedResult();
    const restoredScrollTop = Math.max(0, Math.floor(Number(new URLSearchParams(location.search).get('scrollTop')) || 0));
    if (restoredScrollTop > 0) requestAnimationFrame(() => {
      elements.macroContent.scrollTop = restoredScrollTop;
      requestAnimationFrame(reportHostedScroll);
    });
    requestAnimationFrame(reportHostedScroll);
  } catch (error) {
    elements.recipeInfo.className = 'empty';
    elements.recipeInfo.textContent = String(error?.message || error);
    return;
  }

  try {
    await prepareSolverWorkers();
    elements.generateButton.disabled = false;
  } catch (error) {
    showGenerationMessage(error?.message || 'マクロ生成エンジンを準備できませんでした。');
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
  const numericSamples = relevant?.samples?.slice(-10).map(sample => Object.fromEntries(
    Object.entries(sample).filter(([key, value]) => typeof value === 'number'
      || key === 'stage' || key === 'wasmSha256')
  )) || [];
  return {
    取得日時: japaneseIsoDateTime(),
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
    画面の通知: elements.generationMessage.hidden ? '' : elements.generationMessage.textContent,
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
    直近の探索計測: numericSamples,
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
