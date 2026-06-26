const DATA_CACHE_VERSION = 'ff14recipe-data-7.50-2dbf6112';
const DATA_FILE = `./data/Item.json?v=${encodeURIComponent(DATA_CACHE_VERSION)}`;
const TIPS_FILE = './data/tips.md';
const ABOUT_URL = 'https://jogu6.github.io/ffxiv-recipe-about/';
const LS_FAV = 'ff14_favorites';
const LS_FAV_LISTS = 'ff14_favorite_lists_v2';
const LS_SEARCH_HISTORY = 'ff14_search_history';
const LS_VIEW_STATE = 'ff14_view_state_v1';
const SEARCH_HISTORY_LIMIT = 30;
const FAVORITE_NAME_MAX = 50;
const RECENT_LIST_ID = 'SYSTEM_RECENT_ITEMS';
const RECENT_LIST_NAME = '検索履歴';
const RECENT_LIST_LIMIT = 100;
const MOBILE_BREAKPOINT = 600;
const LICENSE_NOTICE_FILE = './docs/license-notice.md';
const PRIVACY_POLICY_FILE = './docs/privacy-policy.md';
const CONTACT_URL = 'https://discord.gg/eZP5temK6e';
const REQUEST_COUNT_MAX = 999;
const {
  calculateCraft,
  calculateRequirements,
  createIntermediateForest,
  validateRequestedCount
} = RecipeCalculation;

const CRAFT_TYPE_NAME = {
  '0': '木工師', '1': '鍛冶師', '2': '甲冑師', '3': '彫金師',
  '4': '革細工師', '5': '裁縫師', '6': '錬金術師', '7': '調理師',
  '8': '交換', '9': '交換/精選'
};
const CRAFT_JOBS_SET = new Set(['木工師','鍛冶師','甲冑師','彫金師','革細工師','裁縫師','錬金術師','調理師']);
const EXCHANGE_CRAFT_TYPES = new Set(['8', '9']);

const CRYSTAL_EXCLUDE = new Set(
  ['ファイア','アイス','ウィンド','アース','ライトニング','ウォーター']
    .flatMap(e => ['シャード','クリスタル','クラスター'].map(t => e + t))
);

// Cached DOM references
const elements = {
  appVersion: document.getElementById('appVersion'),
  loadStatus: document.getElementById('loadStatus'),
  popupBtn: document.getElementById('popupBtn'),
  appTitle: document.getElementById('appTitle'),
  settingsBtn: document.getElementById('settingsBtn'),
  panelLeft: document.getElementById('panelLeft'),
  panelMiddle: document.getElementById('panelMiddle'),
  panelRight: document.getElementById('panelRight'),
  resultHeader: document.querySelector('.result-header'),
  searchBox: document.getElementById('searchBox'),
  searchClearBtn: document.getElementById('searchClearBtn'),
  searchHistory: document.getElementById('searchHistory'),
  favBtn: document.getElementById('favBtn'),
  favoriteLists: document.getElementById('favoriteLists'),
  recipeList: document.getElementById('recipeList'),
  mobileTipsMsg: document.getElementById('mobileTipsMsg'),
  usesBackBtn: document.getElementById('usesBackBtn'),
  usesTitle: document.getElementById('usesTitle'),
  usesList: document.getElementById('usesList'),
  backBtn: document.getElementById('backBtn'),
  countLabel: document.getElementById('countLabel'),
  countDecrease5Btn: document.getElementById('countDecrease5Btn'),
  countDecreaseBtn: document.getElementById('countDecreaseBtn'),
  countInput: document.getElementById('countInput'),
  countIncreaseBtn: document.getElementById('countIncreaseBtn'),
  countIncrease5Btn: document.getElementById('countIncrease5Btn'),
  resultTitle: document.getElementById('resultTitle'),
  resultViewSwitch: document.getElementById('resultViewSwitch'),
  treeViewBtn: document.getElementById('treeViewBtn'),
  materialsViewBtn: document.getElementById('materialsViewBtn'),
  usesBtn: document.getElementById('usesBtn'),
  treeContainer: document.getElementById('treeContainer'),
  tipsMsg: document.getElementById('tipsMsg'),
  mobileBackBtn: document.getElementById('mobileBackBtn'),
  updateNotice: document.getElementById('updateNotice'),
  updateReloadBtn: document.getElementById('updateReloadBtn'),
  confirmOverlay: document.getElementById('confirmOverlay'),
  confirmMsg: document.getElementById('confirmMsg'),
  confirmYes: document.getElementById('confirmYes'),
  confirmNo: document.getElementById('confirmNo'),
  settingsOverlay: document.getElementById('settingsOverlay'),
  exportListToggle: document.getElementById('exportListToggle'),
  exportListChoices: document.getElementById('exportListChoices'),
  exportCode: document.getElementById('exportCode'),
  copyExportBtn: document.getElementById('copyExportBtn'),
  importCode: document.getElementById('importCode'),
  startImportBtn: document.getElementById('startImportBtn'),
  importErr: document.getElementById('importErr'),
  contactBtn: document.getElementById('contactBtn'),
  privacyBtn: document.getElementById('privacyBtn'),
  licenseBtn: document.getElementById('licenseBtn'),
  licenseOverlay: document.getElementById('licenseOverlay'),
  licenseTitle: document.getElementById('licenseTitle'),
  licenseText: document.getElementById('licenseText'),
  licenseCloseBtn: document.getElementById('licenseCloseBtn'),
  settingsCloseBtn: document.getElementById('settingsCloseBtn'),
  textInputOverlay: document.getElementById('textInputOverlay'),
  textInputMsg: document.getElementById('textInputMsg'),
  textInputField: document.getElementById('textInputField'),
  textInputOkBtn: document.getElementById('textInputOkBtn'),
  textInputCancelBtn: document.getElementById('textInputCancelBtn'),
  favoriteTargetOverlay: document.getElementById('favoriteTargetOverlay'),
  favoriteTargetMsg: document.getElementById('favoriteTargetMsg'),
  favoriteTargetCreate: document.getElementById('favoriteTargetCreate'),
  favoriteTargetChoices: document.getElementById('favoriteTargetChoices'),
  favoriteTargetCancelBtn: document.getElementById('favoriteTargetCancelBtn'),
  materialTreeOverlay: document.getElementById('materialTreeOverlay'),
  materialTreeTitle: document.getElementById('materialTreeTitle'),
  materialTreeCountInput: document.getElementById('materialTreeCountInput'),
  materialTreeDecrease5Btn: document.getElementById('materialTreeDecrease5Btn'),
  materialTreeDecreaseBtn: document.getElementById('materialTreeDecreaseBtn'),
  materialTreeIncreaseBtn: document.getElementById('materialTreeIncreaseBtn'),
  materialTreeIncrease5Btn: document.getElementById('materialTreeIncrease5Btn'),
  materialTreeContent: document.getElementById('materialTreeContent'),
  materialTreeCloseBtn: document.getElementById('materialTreeCloseBtn')
};

// Application state and indexes
let itemMaster = {};
let recipes = {};
let recipeNames = [];
let selectedRecipe = null;
let favoriteStore = { version: 2, selectedListId: null, lists: [] };
let searchHistory = [];
let tipsData = [];
let idToRecipeName = {};
let idToItemName = {};
let usedIn = {};
let ingredientNames = [];
let prevPanel = 'left';
let listMode = 'none';
let resultViewMode = 'tree';
let resultSourceMode = 'recipe';
let selectedUsesItem = null;
let favoriteMaterialsRingCounts = {};
let pendingConfirmAction = null;
let pendingTextInputAction = null;
let selectedExportListId = null;
let wasMobile = isMobile();
let reorderDrag = null;
let favoriteItemReorderEnabled = false;
let materialTreeRecipe = null;
let expandedFavoriteListActionsId = null;
let canSaveViewState = false;
let suppressViewStateSave = false;

const treePinMap = new Map();
const exchangeTreeState = new Map();
const materialSectionState = new Map();
const intermediateTreeState = new Map();
const CRYSTAL_ELEMENT_ORDER = ['ファイア', 'アイス', 'ウィンド', 'アース', 'ライトニング', 'ウォーター'];
const CRYSTAL_KIND_ORDER = ['シャード', 'クリスタル', 'クラスター'];

function isMobile() {
  return window.innerWidth <= MOBILE_BREAKPOINT;
}

function isPwaDisplayMode() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: window-controls-overlay)').matches;
}

function updatePopupButtonVisibility() {
  elements.popupBtn.classList.toggle('hidden', isPwaDisplayMode());
}

function toNumeric(value, fallback = 0) {
  const number = parseInt(value, 10);
  return Number.isFinite(number) ? number : fallback;
}

function formatNumber(value) {
  return toNumeric(value).toLocaleString('ja-JP');
}

// Sorting and persistence
function isEnglishFirst(name) { return /^[A-Za-z]/.test(name); }

function sortRecipeNames(names) {
  const ja = names.filter(n => !isEnglishFirst(n));
  const en = names.filter(n => isEnglishFirst(n));
  ja.sort((a, b) => a.localeCompare(b, 'ja'));
  en.sort((a, b) => a.localeCompare(b, 'en'));
  return [...ja, ...en];
}

function readStoredJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function removeStoredItem(key) {
  localStorage.removeItem(key);
}

function currentMobilePanel() {
  if (!isMobile()) return '';
  return elements.mobileBackBtn.dataset.panel || 'left';
}

function saveViewState() {
  if (!canSaveViewState || suppressViewStateSave) return;
  writeStoredJson(LS_VIEW_STATE, {
    v: 1,
    input: {
      search: elements.searchBox.value,
      count: elements.countInput.value,
      active: ['searchBox', 'countInput'].includes(document.activeElement?.id)
        ? document.activeElement.id
        : ''
    },
    selected: {
      recipe: selectedRecipe || '',
      favoriteListId: favoriteStore.selectedListId || '',
      usesItem: selectedUsesItem || ''
    },
    view: {
      listMode,
      sourceMode: resultSourceMode,
      resultMode: resultViewMode,
      mobilePanel: currentMobilePanel()
    },
    favoriteMaterials: {
      ringCounts: favoriteMaterialsRingCounts
    }
  });
}

function clearViewState() {
  removeStoredItem(LS_VIEW_STATE);
}

function restoreViewState() {
  const state = readStoredJson(LS_VIEW_STATE, null);
  if (!state || state.v !== 1) return false;

  suppressViewStateSave = true;
  try {
    const search = typeof state.input?.search === 'string' ? state.input.search : '';
    const count = typeof state.input?.count === 'string' ? state.input.count : '1';
    const activeInput = ['searchBox', 'countInput'].includes(state.input?.active)
      ? state.input.active
      : '';
    const favoriteList = findFavoriteList(state.selected?.favoriteListId);
    const recipe = recipes[state.selected?.recipe] ? state.selected.recipe : '';
    const usesItem = usedIn[state.selected?.usesItem] ? state.selected.usesItem : '';

    elements.searchBox.value = search;
    elements.searchClearBtn.classList.toggle('visible', search.trim() !== '');
    favoriteStore.selectedListId = favoriteList?.id || null;

    if (state.view?.listMode === 'fav' && favoriteList) listMode = 'fav';
    else listMode = search.trim() ? 'search' : 'none';

    selectedRecipe = recipe || null;
    selectedUsesItem = usesItem || null;
    elements.countInput.value = count || '1';
    readRequestedCount(elements.countInput);
    setResultSourceMode(
      state.view?.sourceMode === 'favorite-materials' && favoriteList && !isRecentList(favoriteList)
        ? 'favorite-materials'
        : 'recipe'
    );
    favoriteMaterialsRingCounts = normalizeFavoriteMaterialsRingCounts(state.favoriteMaterials?.ringCounts);
    if (resultSourceMode === 'favorite-materials') selectedRecipe = null;
    setResultViewMode(state.view?.resultMode === 'materials' ? 'materials' : 'tree');
    updateFavoriteButtonState();
    renderList();
    renderResultView();

    if (selectedUsesItem) showUsesPanel(selectedUsesItem, { record: false });

    if (isMobile()) {
      const panel = state.view?.mobilePanel;
      if (panel === 'right' && (selectedRecipe || resultSourceMode === 'favorite-materials')) showMobilePanel('right');
      else if (panel === 'middle' && selectedUsesItem) showMobilePanel('middle');
      else showMobilePanel('left');
    } else {
      clearMobilePanels();
    }
    if (activeInput) {
      setTimeout(() => document.getElementById(activeInput)?.focus(), 0);
    }
    return true;
  } finally {
    suppressViewStateSave = false;
  }
}

function normalizeFavoriteMaterialsRingCounts(value) {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, count]) => count === 2)
      .map(([name]) => [name, 2])
  );
}

function formatDefaultListName() {
  const now = new Date();
  const pad = value => String(value).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate())
  ].join('-') + ' ' + [
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join(':');
}

function normalizeFavoriteListName(name) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  return (trimmed || formatDefaultListName()).slice(0, FAVORITE_NAME_MAX);
}

function createFavoriteListId() {
  return `L${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeItemIds(itemIds) {
  if (!Array.isArray(itemIds)) return [];
  return [...new Set(
    itemIds.map(id => parseInt(id, 10)).filter(id => Number.isInteger(id) && id > 0)
  )];
}

function withDuplicateSuffix(baseName, suffixNumber) {
  if (suffixNumber === 0) return baseName.slice(0, FAVORITE_NAME_MAX);
  const suffix = `（${suffixNumber}）`;
  return `${baseName.slice(0, FAVORITE_NAME_MAX - suffix.length)}${suffix}`;
}

function uniqueFavoriteListName(name, excludeId = null) {
  const baseName = normalizeFavoriteListName(name);
  const exists = candidate => favoriteStore.lists.some(list =>
    list.id !== excludeId && list.name === candidate
  );

  for (let i = 0; i < 1000; i += 1) {
    const candidate = withDuplicateSuffix(baseName, i);
    if (!exists(candidate)) return candidate;
  }
  return withDuplicateSuffix(baseName, Date.now() % 1000);
}

function isRecentList(listOrId) {
  return (typeof listOrId === 'string' ? listOrId : listOrId?.id) === RECENT_LIST_ID;
}

function createRecentList(itemIds = []) {
  const normalizedIds = normalizeItemIds(itemIds).slice(0, RECENT_LIST_LIMIT);
  return {
    id: RECENT_LIST_ID,
    name: RECENT_LIST_NAME,
    itemIds: normalizedIds
  };
}

function getSelectedFavoriteList() {
  return favoriteStore.lists.find(list => list.id === favoriteStore.selectedListId) || null;
}

function getDisplayedFavoriteList() {
  return listMode === 'fav' ? getSelectedFavoriteList() : null;
}

function updateFavoriteButtonState() {
  const list = getDisplayedFavoriteList();
  elements.favBtn.classList.toggle('active', Boolean(list));
  elements.favBtn.textContent = list ? `📌 ${list.name}` : '📌 お気に入り';
  elements.favBtn.title = list ? list.name : 'お気に入り';
}

function getFavoriteListRecipeNames(list = getDisplayedFavoriteList()) {
  return list ? list.itemIds.map(itemNameForId).filter(name => name && recipes[name]) : [];
}

function isRingRecipe(name) {
  return itemMaster[name]?.uiCategoryName === '指輪';
}

function findFavoriteList(id) {
  return favoriteStore.lists.find(list => list.id === id) || null;
}

function itemIdForName(name) {
  const id = parseInt(itemMaster[name]?.id, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function recipeNameForId(id) {
  return idToRecipeName[parseInt(id, 10)] || null;
}

function itemNameForId(id) {
  return idToItemName[parseInt(id, 10)] || null;
}

function createFavoriteList(name, itemIds = []) {
  const list = {
    id: createFavoriteListId(),
    name: uniqueFavoriteListName(name),
    itemIds: normalizeItemIds(itemIds)
  };
  favoriteStore.lists.push(list);
  favoriteStore.selectedListId = list.id;
  saveFavorites();
  return list;
}

function loadFavorites() {
  localStorage.removeItem(LS_FAV);
  const stored = readStoredJson(LS_FAV_LISTS, null);
  const storedLists = Array.isArray(stored?.lists)
    ? stored.lists.map(list => ({
        id: typeof list.id === 'string' ? list.id : createFavoriteListId(),
        name: normalizeFavoriteListName(list.name),
        itemIds: normalizeItemIds(list.itemIds)
      }))
    : [];
  const storedRecent = storedLists.find(isRecentList);
  const normalLists = storedLists.filter(list => !isRecentList(list));
  normalLists.forEach(list => {
    if (list.name === RECENT_LIST_NAME) {
      const exists = candidate => normalLists.some(other => other !== list && other.name === candidate);
      for (let suffix = 1; suffix < 1000; suffix += 1) {
        const candidate = withDuplicateSuffix(RECENT_LIST_NAME, suffix);
        if (!exists(candidate)) {
          list.name = candidate;
          break;
        }
      }
    }
  });
  const lists = [createRecentList(storedRecent?.itemIds), ...normalLists];

  favoriteStore = {
    version: 2,
    selectedListId: lists.some(list => list.id === stored?.selectedListId)
      ? stored.selectedListId
      : null,
    lists
  };
  saveFavorites();
}

function saveFavorites() {
  writeStoredJson(LS_FAV_LISTS, favoriteStore);
}

function recordViewedItem(name) {
  const id = itemIdForName(name);
  const list = findFavoriteList(RECENT_LIST_ID);
  if (!id || !list) return;

  if (list.itemIds.includes(id)) return;
  list.itemIds.unshift(id);
  list.itemIds = list.itemIds.slice(0, RECENT_LIST_LIMIT);
  saveFavorites();
  if (getDisplayedFavoriteList()?.id === RECENT_LIST_ID) renderList();
}

function loadSearchHistory() {
  const storedHistory = readStoredJson(LS_SEARCH_HISTORY, []);
  searchHistory = Array.isArray(storedHistory)
    ? storedHistory.filter(value => typeof value === 'string' && value.trim()).slice(0, SEARCH_HISTORY_LIMIT)
    : [];
}

function saveSearchHistory() {
  writeStoredJson(LS_SEARCH_HISTORY, searchHistory);
}

function rememberCurrentSearch() {
  if (listMode !== 'search') return;
  const query = elements.searchBox.value.trim();
  if (!query) return;
  searchHistory = [query, ...searchHistory.filter(value => value !== query)].slice(0, SEARCH_HISTORY_LIMIT);
  saveSearchHistory();
  closeSearchHistory();
}

// Search, favorites, and list rendering
function renderSearchHistory() {
  const query = elements.searchBox.value.trim();
  const entries = searchHistory.filter(value => !query || value.includes(query));
  const frag = document.createDocumentFragment();

  entries.forEach(value => {
    const li = document.createElement('li');
    const textEl = document.createElement('span');
    textEl.className = 'history-text';
    textEl.textContent = value;

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'history-delete';
    deleteBtn.type = 'button';
    deleteBtn.textContent = '🗑️';
    deleteBtn.title = '検索履歴から削除';
    deleteBtn.setAttribute('aria-label', `「${value}」を検索履歴から削除`);
    deleteBtn.addEventListener('click', event => {
      event.stopPropagation();
      searchHistory = searchHistory.filter(entry => entry !== value);
      saveSearchHistory();
      renderSearchHistory();
    });

    li.append(textEl, deleteBtn);
    li.addEventListener('click', () => {
      elements.searchBox.value = value;
      onSearch();
      closeSearchHistory();
    });
    frag.appendChild(li);
  });

  elements.searchHistory.replaceChildren(frag);
  elements.searchHistory.classList.toggle('open', entries.length > 0);
}

function openSearchHistory() {
  renderSearchHistory();
}

function closeSearchHistory() {
  elements.searchHistory.classList.remove('open');
}

function showConfirm(msg, onYes) {
  elements.confirmMsg.textContent = msg;
  pendingConfirmAction = onYes;
  elements.confirmOverlay.classList.add('open');
}

function closeConfirm() {
  elements.confirmOverlay.classList.remove('open');
  pendingConfirmAction = null;
}

function confirmPendingAction() {
  const action = pendingConfirmAction;
  pendingConfirmAction = null;
  closeConfirm();
  action?.();
}

function closeTextInput() {
  elements.textInputOverlay.classList.remove('open');
  pendingTextInputAction = null;
}

function showTextInput(message, defaultValue, onSubmit) {
  elements.textInputMsg.textContent = message;
  elements.textInputField.value = defaultValue || '';
  pendingTextInputAction = onSubmit;
  elements.textInputOverlay.classList.add('open');
  elements.textInputField.focus();
  elements.textInputField.select();
}

function submitTextInput() {
  const action = pendingTextInputAction;
  const value = elements.textInputField.value;
  closeTextInput();
  action?.(value);
}

function isFavorite(name, listId = getDisplayedFavoriteList()?.id || favoriteStore.selectedListId) {
  const list = findFavoriteList(listId);
  const id = itemIdForName(name);
  return Boolean(list && !isRecentList(list) && id && list.itemIds.includes(id));
}

function markRecipeListSelection(li) {
  elements.recipeList.querySelectorAll('li').forEach(el => el.classList.remove('selected'));
  li.classList.add('selected');
}

function resetTreeSelection() {
  selectedRecipe = null;
  prevPanel = 'left';
  treePinMap.clear();
  closeUsesPanel();
  elements.usesTitle.textContent = '';
  elements.usesList.replaceChildren();
  elements.resultTitle.textContent = '';
  elements.usesBtn.classList.remove('visible');
  clearRenderedTree();
  showTips();
  updateResultHeader();
  if (isMobile()) showMobilePanel('left');
}

function applyFavoriteChange(name, shouldAdd, listId = getDisplayedFavoriteList()?.id) {
  const list = findFavoriteList(listId);
  const id = itemIdForName(name);
  if (!list || !id) return;
  if (shouldAdd && isRecentList(list)) return;

  if (shouldAdd && !list.itemIds.includes(id)) list.itemIds.push(id);
  if (!shouldAdd) {
    list.itemIds = list.itemIds.filter(itemId => itemId !== id);
  }
  saveFavorites();
  refreshPins(name);
  if (listMode === 'fav') renderList();
}

function pinOn(name) {
  openFavoriteTarget(name);
}

function pinOff(name) {
  const listName = findFavoriteList(getDisplayedFavoriteList()?.id || favoriteStore.selectedListId)?.name;
  const message = listName
    ? `「${name}」を\n「${listName}」から削除しますか？`
    : `「${name}」を\nお気に入りから削除しますか？`;
  showConfirm(message, () => {
    applyFavoriteChange(name, false);
  });
}

function registerTreePin(name, btn) {
  if (!treePinMap.has(name)) treePinMap.set(name, new Set());
  treePinMap.get(name).add(btn);
}

function refreshPins(name) {
  const isOn = isFavorite(name);
  treePinMap.get(name)?.forEach(btn => {
    btn.textContent = isOn ? '📌' : '📍';
    btn.classList.toggle('inactive', !isOn);
    btn.title = isOn ? 'お気に入りから削除' : 'お気に入りに追加';
  });
}

function moveArrayItem(items, fromIndex, toIndex) {
  if (!Array.isArray(items) || fromIndex === toIndex) return false;
  if (fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length) return false;
  const [item] = items.splice(fromIndex, 1);
  items.splice(toIndex, 0, item);
  return true;
}

function createReorderHandle(label, onPointerDown) {
  const handle = document.createElement('button');
  handle.className = 'reorder-handle';
  handle.type = 'button';
  handle.textContent = '☰';
  handle.title = label;
  handle.setAttribute('aria-label', label);
  handle.addEventListener('click', event => event.stopPropagation());
  handle.addEventListener('pointerdown', onPointerDown);
  return handle;
}

function clearReorderDropTarget() {
  document.querySelectorAll('.reorder-drop-before, .reorder-drop-after').forEach(row => {
    row.classList.remove('reorder-drop-before', 'reorder-drop-after');
  });
}

function updateReorderDropTarget() {
  clearReorderDropTarget();
  if (!reorderDrag) return;
  const rows = [...reorderDrag.container.querySelectorAll(reorderDrag.rowSelector)];
  if (rows.length === 0) return;
  if (reorderDrag.insertIndex >= rows.length) rows[rows.length - 1].classList.add('reorder-drop-after');
  else rows[reorderDrag.insertIndex].classList.add('reorder-drop-before');
}

function startReorderDrag(event, options) {
  if (event.button !== undefined && event.button !== 0) return;
  const row = event.currentTarget.closest(options.rowSelector);
  if (!row) return;

  event.preventDefault();
  event.stopPropagation();

  reorderDrag = {
    ...options,
    handle: event.currentTarget,
    row,
    fromIndex: Number(row.dataset.reorderIndex),
    insertIndex: Number(row.dataset.reorderIndex)
  };
  row.classList.add('dragging');
  event.currentTarget.setPointerCapture?.(event.pointerId);
  event.currentTarget.addEventListener('pointermove', onReorderPointerMove);
  event.currentTarget.addEventListener('pointerup', onReorderPointerUp);
  event.currentTarget.addEventListener('pointercancel', cancelReorderDrag);
  onReorderPointerMove(event);
}

function onReorderPointerMove(event) {
  if (!reorderDrag) return;
  const rows = [...reorderDrag.container.querySelectorAll(reorderDrag.rowSelector)];
  let insertIndex = rows.length;

  for (let index = 0; index < rows.length; index += 1) {
    const rect = rows[index].getBoundingClientRect();
    if (event.clientY < rect.top + rect.height / 2) {
      insertIndex = index;
      break;
    }
  }

  reorderDrag.insertIndex = insertIndex;
  updateReorderDropTarget();
}

function finishReorderDrag() {
  if (!reorderDrag) return;
  const { handle, row } = reorderDrag;
  handle.removeEventListener('pointermove', onReorderPointerMove);
  handle.removeEventListener('pointerup', onReorderPointerUp);
  handle.removeEventListener('pointercancel', cancelReorderDrag);
  row.classList.remove('dragging');
  clearReorderDropTarget();
}

function onReorderPointerUp() {
  if (!reorderDrag) return;
  const { fromIndex, insertIndex, onReorder } = reorderDrag;
  const toIndex = insertIndex > fromIndex ? insertIndex - 1 : insertIndex;
  finishReorderDrag();
  const callback = onReorder;
  reorderDrag = null;
  callback(fromIndex, toIndex);
}

function cancelReorderDrag() {
  finishReorderDrag();
  reorderDrag = null;
}

function onSearch() {
  const q = elements.searchBox.value.trim();
  leaveFavoriteMaterialsMode();
  elements.searchClearBtn.classList.toggle('visible', q !== '');
  closeFavoriteLists();
  listMode = q === '' ? 'none' : 'search';
  updateFavoriteButtonState();
  renderList();
  renderResultView();
  renderSearchHistory();
}

function clearSearch() {
  elements.searchBox.value = '';
  onSearch();
  elements.searchBox.focus();
}

function toggleFav() {
  elements.searchBox.value = '';
  elements.searchClearBtn.classList.remove('visible');
  closeSearchHistory();
  renderFavoriteLists();
  elements.favoriteLists.classList.toggle('open');
}

function closeFavoriteLists() {
  elements.favoriteLists.classList.remove('open');
  expandedFavoriteListActionsId = null;
}

function selectFavoriteList(listId) {
  const changedList = getDisplayedFavoriteList()?.id !== listId;
  leaveFavoriteMaterialsMode();
  favoriteItemReorderEnabled = false;
  favoriteStore.selectedListId = listId;
  if (changedList) resetCountInput();
  saveFavorites();
  listMode = 'fav';
  updateFavoriteButtonState();
  closeFavoriteLists();
  resetTreeSelection();
  renderList();
}

function renameFavoriteList(listId) {
  const list = findFavoriteList(listId);
  if (!list || isRecentList(list)) return;
  showTextInput('お気に入りリスト名を変更', list.name, value => {
    list.name = uniqueFavoriteListName(value, list.id);
    saveFavorites();
    renderFavoriteLists();
    renderExportListChoices();
    updateFavoriteButtonState();
  });
}

function deleteFavoriteList(listId) {
  const list = findFavoriteList(listId);
  if (!list || isRecentList(list)) return;
  showConfirm(`「${list.name}」を\n削除しますか？`, () => {
    const wasDisplayed = getDisplayedFavoriteList()?.id === listId;
    favoriteStore.lists = favoriteStore.lists.filter(entry => entry.id !== listId);
    if (favoriteStore.selectedListId === listId) {
      favoriteStore.selectedListId = null;
    }
    if (wasDisplayed) {
      listMode = 'none';
      updateFavoriteButtonState();
      resetTreeSelection();
    }
    saveFavorites();
    renderFavoriteLists();
    renderExportListChoices();
    renderList();
  });
}

function reorderFavoriteLists(fromIndex, toIndex) {
  const recentList = findFavoriteList(RECENT_LIST_ID);
  const normalLists = favoriteStore.lists.filter(list => !isRecentList(list));
  if (!moveArrayItem(normalLists, fromIndex, toIndex)) return;
  favoriteStore.lists = [recentList, ...normalLists].filter(Boolean);
  saveFavorites();
  renderFavoriteLists();
  renderExportListChoices();
}

function reorderFavoriteItems(fromIndex, toIndex) {
  const list = getDisplayedFavoriteList();
  if (!list || isRecentList(list) || !moveArrayItem(list.itemIds, fromIndex, toIndex)) return;
  saveFavorites();
  renderList();
  if (resultSourceMode === 'favorite-materials') renderResultView();
}

function createFavoriteActionRow(text, onClick) {
  const li = document.createElement('li');
  li.className = 'favorite-list-action-row';
  const button = document.createElement('button');
  button.className = 'favorite-list-action';
  button.type = 'button';
  button.textContent = text;
  button.addEventListener('click', onClick);
  li.appendChild(button);
  return li;
}

function createFavoriteSaveRow() {
  const li = document.createElement('li');
  li.className = 'favorite-save-row';
  const button = document.createElement('button');
  button.className = 'favorite-list-action';
  button.type = 'button';
  button.textContent = '新規リストとして保存';
  button.addEventListener('click', event => {
    event.stopPropagation();
    saveSelectedFavoriteListAs();
  });
  li.appendChild(button);
  return li;
}

function createFavoriteMaterialsRow() {
  const list = getDisplayedFavoriteList();
  if (isRecentList(list)) return null;

  const li = document.createElement('li');
  li.className = 'favorite-materials-row';
  const materialButton = document.createElement('button');
  materialButton.className = 'favorite-list-action favorite-list-action-compact';
  materialButton.classList.toggle('active', resultSourceMode === 'favorite-materials');
  materialButton.type = 'button';
  materialButton.textContent = '素材リスト';
  materialButton.addEventListener('click', event => {
    event.stopPropagation();
    openFavoriteMaterialsMode();
  });

  const reorderButton = document.createElement('button');
  reorderButton.className = 'favorite-list-action favorite-list-action-compact';
  reorderButton.classList.toggle('active', favoriteItemReorderEnabled);
  reorderButton.type = 'button';
  reorderButton.textContent = '並び替え';
  reorderButton.addEventListener('click', event => {
    event.stopPropagation();
    favoriteItemReorderEnabled = !favoriteItemReorderEnabled;
    renderList();
  });

  li.append(materialButton, reorderButton);
  return li;
}

function addNewFavoriteList() {
  showTextInput('新しいお気に入りリスト名', formatDefaultListName(), value => {
    const list = createFavoriteList(value);
    selectFavoriteList(list.id);
  });
}

function saveSelectedFavoriteListAs() {
  const source = getDisplayedFavoriteList();
  if (!source) return;
  showTextInput('新規リストとして保存', source.name, value => {
    const list = createFavoriteList(value, source.itemIds);
    selectFavoriteList(list.id);
  });
}

function renderFavoriteLists() {
  const frag = document.createDocumentFragment();
  let normalIndex = 0;

  if (favoriteStore.lists.length === 0) {
    frag.appendChild(createEmptyListItem('お気に入りリストがありません'));
  } else {
    favoriteStore.lists.forEach(list => {
      const li = document.createElement('li');
      const recent = isRecentList(list);
      li.classList.toggle('recent-favorite-list', recent);
      if (!recent) {
        li.classList.add('reorder-enabled');
        li.dataset.reorderIndex = String(normalIndex);
        normalIndex += 1;
      }
      li.classList.toggle('active', list.id === getDisplayedFavoriteList()?.id);

      const name = createTextElement('span', 'favorite-list-name', list.name);
      if (recent) {
        li.appendChild(name);
        li.addEventListener('click', () => selectFavoriteList(list.id));
        frag.appendChild(li);
        return;
      }
      const renameBtn = document.createElement('button');
      renameBtn.className = 'favorite-list-icon';
      renameBtn.type = 'button';
      renameBtn.textContent = '✏️';
      renameBtn.title = '名前変更';
      renameBtn.setAttribute('aria-label', `「${list.name}」の名前を変更`);
      renameBtn.addEventListener('click', event => {
        event.stopPropagation();
        renameFavoriteList(list.id);
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'favorite-list-icon';
      deleteBtn.type = 'button';
      deleteBtn.textContent = '🗑️';
      deleteBtn.title = '削除';
      deleteBtn.setAttribute('aria-label', `「${list.name}」を削除`);
      deleteBtn.addEventListener('click', event => {
        event.stopPropagation();
        deleteFavoriteList(list.id);
      });

      const reorderBtn = createReorderHandle(`「${list.name}」を並び替え`, event => {
        startReorderDrag(event, {
          container: elements.favoriteLists,
          rowSelector: '#favoriteLists li[data-reorder-index]:not(.recent-favorite-list)',
          onReorder: reorderFavoriteLists
        });
      });

      const curtain = document.createElement('div');
      const expanded = expandedFavoriteListActionsId === list.id;
      curtain.className = 'favorite-list-curtain';
      curtain.classList.toggle('expanded', expanded);

      const curtainToggle = document.createElement('button');
      curtainToggle.className = 'favorite-list-curtain-toggle';
      curtainToggle.type = 'button';
      curtainToggle.textContent = expanded ? '▶' : '◀';
      curtainToggle.title = expanded ? 'リスト操作を折り畳む' : 'リスト操作を展開する';
      curtainToggle.setAttribute('aria-label', curtainToggle.title);
      curtainToggle.setAttribute('aria-expanded', String(expanded));
      curtainToggle.addEventListener('click', event => {
        event.stopPropagation();
        const nextExpanded = !curtain.classList.contains('expanded');
        elements.favoriteLists.querySelectorAll('.favorite-list-curtain.expanded').forEach(openCurtain => {
          if (openCurtain === curtain) return;
          openCurtain.classList.remove('expanded');
          const openToggle = openCurtain.querySelector('.favorite-list-curtain-toggle');
          openToggle.textContent = '◀';
          openToggle.title = 'リスト操作を展開する';
          openToggle.setAttribute('aria-label', openToggle.title);
          openToggle.setAttribute('aria-expanded', 'false');
        });
        curtain.classList.toggle('expanded', nextExpanded);
        curtainToggle.textContent = nextExpanded ? '▶' : '◀';
        curtainToggle.title = nextExpanded ? 'リスト操作を折り畳む' : 'リスト操作を展開する';
        curtainToggle.setAttribute('aria-label', curtainToggle.title);
        curtainToggle.setAttribute('aria-expanded', String(nextExpanded));
        expandedFavoriteListActionsId = nextExpanded ? list.id : null;
      });

      const actions = document.createElement('div');
      actions.className = 'favorite-list-curtain-actions';
      actions.append(renameBtn, deleteBtn, reorderBtn);
      curtain.append(curtainToggle, actions);

      li.append(name, curtain);
      li.addEventListener('click', () => selectFavoriteList(list.id));
      frag.appendChild(li);
    });
  }

  elements.favoriteLists.replaceChildren(frag);
}

function closeFavoriteTarget() {
  elements.favoriteTargetOverlay.classList.remove('open');
  elements.favoriteTargetCreate.replaceChildren();
  elements.favoriteTargetChoices.replaceChildren();
}

function addFavoriteToList(name, listId) {
  if (!getDisplayedFavoriteList()) {
    favoriteStore.selectedListId = listId;
    saveFavorites();
  }
  applyFavoriteChange(name, true, listId);
  closeFavoriteTarget();
  if (listMode === 'fav') renderList();
}

function confirmFavoriteTargetOnMobile(name, list, onConfirm) {
  if (!isMobile()) {
    onConfirm();
    return;
  }

  showConfirm(`「${name}」を\n「${list.name}」に登録しますか？`, onConfirm);
}

function addFavoriteToNewList(name) {
  const preserveSearch = listMode === 'search';
  closeFavoriteTarget();
  showTextInput('新しいお気に入りリスト名', formatDefaultListName(), value => {
    const id = itemIdForName(name);
    const list = createFavoriteList(value, id ? [id] : []);
    favoriteStore.selectedListId = list.id;
    saveFavorites();
    if (!preserveSearch) listMode = 'fav';
    updateFavoriteButtonState();
    refreshPins(name);
    renderList();
  });
}

function createFavoriteTargetButton(text, active, onClick) {
  const btn = document.createElement('button');
  btn.className = 'choice-list-btn';
  btn.classList.toggle('active', active);
  btn.type = 'button';
  btn.textContent = text;
  btn.title = text;
  btn.addEventListener('click', onClick);
  return btn;
}

function openFavoriteTarget(name) {
  elements.favoriteTargetMsg.textContent = `「${name}」を登録するお気に入りリスト`;
  const frag = document.createDocumentFragment();
  const displayedList = getDisplayedFavoriteList();
  const selectedList = isRecentList(displayedList) ? null : displayedList;

  elements.favoriteTargetCreate.replaceChildren(
    createFavoriteTargetButton('新規作成', !selectedList, () => addFavoriteToNewList(name))
  );
  favoriteStore.lists.filter(list => !isRecentList(list)).forEach(list => {
    frag.appendChild(createFavoriteTargetButton(list.name, list.id === selectedList?.id, () => {
      confirmFavoriteTargetOnMobile(name, list, () => {
        addFavoriteToList(name, list.id);
      });
    }));
  });

  elements.favoriteTargetChoices.replaceChildren(frag);
  elements.favoriteTargetOverlay.classList.add('open');
}

function getDisplayList() {
  switch (listMode) {
    case 'search': {
      const q = elements.searchBox.value.trim();
      if (!q) return [];
      const rMatches = recipeNames.filter(n => n.includes(q));
      const iMatches = ingredientNames.filter(n => n.includes(q));
      return sortRecipeNames([...rMatches, ...iMatches]);
    }
    case 'fav': {
      const list = getSelectedFavoriteList();
      return list ? list.itemIds.map(itemNameForId).filter(Boolean) : [];
    }
    default:
      return [];
  }
}

function createTextElement(tagName, className, text) {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

function createItemIcon(iconPath, className = 'list-icon') {
  if (!iconPath) return null;
  const image = document.createElement('img');
  image.src = iconPath;
  image.className = className;
  image.alt = '';
  image.addEventListener('error', () => image.classList.add('hidden'));
  return image;
}

function createItemListRow(name, className = '') {
  const row = document.createElement('li');
  row.className = className;
  row.title = name;

  const icon = createItemIcon(itemMaster[name]?.icon);
  if (icon) row.appendChild(icon);
  row.appendChild(createTextElement('span', 'list-name', name));
  return row;
}

function createEmptyListItem(message) {
  return createTextElement('li', 'list-empty', message);
}

function createMarkdownElement(tagName, className, html) {
  const element = document.createElement(tagName);
  element.className = className;
  element.innerHTML = html;
  return element;
}

function createAboutAppButton() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tips-about-btn';
  button.textContent = 'このアプリは何ですか？';
  button.addEventListener('click', () => {
    window.location.href = ABOUT_URL;
  });
  return button;
}

function renderTips() {
  [elements.tipsMsg, elements.mobileTipsMsg].forEach(container => {
    const rows = tipsData.map(tip =>
      createMarkdownElement('div', 'tips-row markdown-content', tip.html)
    );
    container.replaceChildren(createAboutAppButton(), ...rows);
  });
}

function showTips() {
  elements.tipsMsg.classList.remove('hidden');
  renderTips();
}

function renderList() {
  const frag = document.createDocumentFragment();
  const names = getDisplayList();
  const showMobileTips = listMode === 'none' && isMobile();

  elements.recipeList.classList.toggle('hidden', showMobileTips);
  elements.mobileTipsMsg.classList.toggle('hidden', !showMobileTips);

  if (listMode === 'fav' && !getDisplayedFavoriteList()) {
    frag.appendChild(createEmptyListItem('お気に入りリストを選択してください'));
  } else if (listMode === 'fav' && names.length === 0) {
    frag.appendChild(createEmptyListItem('お気に入りはありません'));
  } else if (names.length === 0) {
    frag.appendChild(createEmptyListItem('該当するレシピがありません'));
  } else {
    if (listMode === 'fav' && getDisplayedFavoriteList()) {
      const materialsRow = createFavoriteMaterialsRow();
      if (materialsRow) frag.appendChild(materialsRow);
    }
    names.forEach((name, index) => {
      if (listMode === 'fav') frag.appendChild(makeFavLi(name, index));
      else if (recipes[name]) frag.appendChild(makeRecipeLi(name));
      else frag.appendChild(makeIngredientLi(name));
    });
  }

  if (listMode === 'fav' && getDisplayedFavoriteList()) {
    frag.appendChild(createFavoriteSaveRow());
  }

  elements.recipeList.replaceChildren(frag);
  saveViewState();
}

function makeFavLi(name, index) {
  const li = createItemListRow(name, 'fav-item-row');
  li.dataset.reorderIndex = String(index);
  li.classList.toggle('selected', selectedRecipe === name);

  const nameElement = li.querySelector('.list-name');
  let label = nameElement;
  if (recipes[name]) {
    label = document.createElement('span');
    label.className = 'favorite-item-label';
    label.append(
      createTextElement(
        'span',
        `favorite-item-job badge ${methodBadgeClass(itemMaster[name]?.method)}`,
        itemMaster[name]?.method || '製作情報なし'
      ),
      createTextElement('span', 'favorite-item-name', name)
    );
    nameElement.replaceWith(label);
  }

  const pin = document.createElement('button');
  pin.className = 'pin-btn';
  pin.textContent = '📌';
  pin.title = 'お気に入りから削除';
  pin.addEventListener('click', event => {
    event.stopPropagation();
    pinOff(name);
  });
  li.insertBefore(pin, label);

  if (!recipes[name]) li.appendChild(createUsesListButton(name, li, false));

  if (favoriteItemReorderEnabled) {
    li.classList.add('reorder-enabled');
    li.appendChild(createReorderHandle(`「${name}」を並び替え`, event => {
      startReorderDrag(event, {
        container: elements.recipeList,
        rowSelector: '#recipeList li.fav-item-row[data-reorder-index]',
        onReorder: reorderFavoriteItems
      });
    }));
  }

  li.addEventListener('click', () => {
    if (recipes[name]) selectRecipeByName(name);
    else {
      markRecipeListSelection(li);
      showUsesPanel(name);
    }
  });
  return li;
}

function makeRecipeLi(name) {
  const li = createItemListRow(name);
  li.classList.toggle('selected', selectedRecipe === name);

  li.addEventListener('click', () => {
    rememberCurrentSearch();
    markRecipeListSelection(li);
    selectRecipe(name, li);
  });
  return li;
}

function makeIngredientLi(name) {
  const li = createItemListRow(name, 'ingredient-row');
  li.appendChild(createUsesListButton(name, li, true));
  li.addEventListener('click', () => {
    rememberCurrentSearch();
    markRecipeListSelection(li);
    showUsesPanel(name);
  });
  return li;
}

function createUsesListButton(name, row, rememberSearch) {
  const usesButton = document.createElement('button');
  usesButton.className = 'uses-list-btn';
  usesButton.type = 'button';
  usesButton.textContent = '使用先';
  usesButton.addEventListener('click', event => {
    event.stopPropagation();
    if (rememberSearch) rememberCurrentSearch();
    markRecipeListSelection(row);
    showUsesPanel(name);
  });
  return usesButton;
}

function closeUsesPanel() {
  elements.panelMiddle.classList.remove('open');
  elements.panelMiddle.classList.remove('mobile-visible');
  selectedUsesItem = null;
  saveViewState();
}

// Used-in panel and mobile navigation
function showUsesPanel(ingredientName, options = {}) {
  selectedUsesItem = ingredientName;
  if (options.record !== false) recordViewedItem(ingredientName);
  const uses = usedIn[ingredientName] || [];
  elements.usesTitle.textContent = `${ingredientName}（${formatNumber(uses.length)}件）`;
  const frag = document.createDocumentFragment();

  uses.forEach(recipeName => {
    const li = createItemListRow(recipeName);
    li.addEventListener('click', () => {
      recordViewedItem(recipeName);
      if (selectedRecipe !== recipeName || resultSourceMode === 'favorite-materials') resetCountInput();
      selectedRecipe = recipeName;
      leaveFavoriteMaterialsMode();
      setResultViewMode('tree');
      elements.usesList.querySelectorAll('li').forEach(el => el.classList.remove('selected'));
      li.classList.add('selected');
      renderResultView();
      if (isMobile()) {
        prevPanel = 'middle';
        showMobilePanel('right');
        elements.treeContainer.scrollTop = 0;
      }
    });
    frag.appendChild(li);
  });

  elements.usesList.replaceChildren(frag);
  elements.panelMiddle.classList.add('open');
  if (isMobile()) showMobilePanel('middle');
  saveViewState();
}

function goBack() {
  if (isMobile() && resultSourceMode === 'favorite-materials') {
    leaveFavoriteMaterialsMode();
    setResultViewMode('tree');
    renderList();
  }
  showMobilePanel(prevPanel);
}

function returnToList() {
  closeUsesPanel();
  showMobilePanel('left');
  saveViewState();
}

function selectRecipe(name, li) {
  recordViewedItem(name);
  if (selectedRecipe !== name || resultSourceMode === 'favorite-materials') resetCountInput();
  selectedRecipe = name;
  selectedUsesItem = null;
  leaveFavoriteMaterialsMode();
  exchangeTreeState.clear();
  setResultViewMode('tree');
  markRecipeListSelection(li);
  renderResultView();
  if (isMobile()) {
    prevPanel = 'left';
    showMobilePanel('right');
    elements.treeContainer.scrollTop = 0;
  }
}

function selectRecipeByName(name) {
  recordViewedItem(name);
  if (selectedRecipe !== name || resultSourceMode === 'favorite-materials') resetCountInput();
  selectedRecipe = name;
  selectedUsesItem = null;
  leaveFavoriteMaterialsMode();
  exchangeTreeState.clear();
  setResultViewMode('tree');
  renderList();
  renderResultView();
  if (isMobile()) {
    prevPanel = 'left';
    showMobilePanel('right');
    elements.treeContainer.scrollTop = 0;
  }
}

async function loadAppVersion() {
  try {
    const source = await fetch('./sw.js', { cache: 'no-store' }).then(response => {
      if (!response.ok) throw new Error(`sw.js (${response.status})`);
      return response.text();
    });
    const match = source.match(/const\s+APP_CACHE_VERSION\s*=\s*['"][^'"]*?(v\d+(?:\.\d+)*)['"]/i);
    elements.appVersion.textContent = match ? match[1] : '';
  } catch {
    elements.appVersion.textContent = '';
  }
}

// Data loading and index construction
async function fetchJson(path, errorMessage) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(errorMessage(response.status));
  return response.json();
}

async function loadTips() {
  try {
    const response = await fetch(TIPS_FILE, { cache: 'no-store' });
    if (!response.ok) throw new Error(`tips (${response.status})`);
    tipsData = [{ html: renderMarkdown(await response.text()) }];
  } catch {
    tipsData = [
      { html: renderMarkdown('📌 ピンでお気に入り登録\n\n検索欄でアイテム名検索') }
    ];
  }
}

function iconPath(item) {
  if (!item?.IconFile) return '';
  const folder = item.IconFile.slice(0, 3);
  return `./assets/item-icons/${folder}/${item.IconFile}?v=${encodeURIComponent(DATA_CACHE_VERSION)}`;
}

function buildItemAndRecipeMasters(rawList, idToItem) {
  let maxPatch = 0;

  rawList.forEach(item => {
    const recipe = item.Recipe;
    const name = item.Name;

    if (recipe?.PatchNumber) {
      const patchNumber = toNumeric(recipe.PatchNumber);
      if (patchNumber > maxPatch) maxPatch = patchNumber;
    }

    if (recipe && recipe.CraftType !== undefined) {
      const craftType = String(recipe.CraftType);
      itemMaster[name] = {
        method: CRAFT_TYPE_NAME[recipe.CraftType] || 'クラフト',
        icon: iconPath(item),
        craftType,
        id: item.ID,
        numericId: toNumeric(item.ID),
        uiCategory: toNumeric(item.ItemUICategory),
        uiCategoryName: item.ItemUICategoryName || ''
      };
      recipes[name] = {
        yield: toNumeric(recipe.AmountResult, 1),
        craftType,
        ingredients: recipe.Ingredients.map(ingredient => ({
          name: ingredient.Name,
          qty: toNumeric(ingredient.Amount, 1),
          itemId: ingredient.ItemID
        }))
      };

      const numericId = toNumeric(item.ID, NaN);
      if (!Number.isNaN(numericId)) idToRecipeName[numericId] = name;
    } else if (!itemMaster[name]) {
      itemMaster[name] = {
        method: '',
        icon: iconPath(item),
        craftType: '',
        id: item.ID,
        numericId: toNumeric(item.ID),
        uiCategory: toNumeric(item.ItemUICategory),
        uiCategoryName: item.ItemUICategoryName || ''
      };
    }
  });

  rawList.forEach(item => {
    item.Recipe?.Ingredients?.forEach(ingredient => {
      if (itemMaster[ingredient.Name]) return;
      itemMaster[ingredient.Name] = {
        method: '',
        icon: iconPath(idToItem[ingredient.ItemID]),
        craftType: '',
        id: ingredient.ItemID,
        numericId: toNumeric(ingredient.ItemID),
        uiCategory: toNumeric(idToItem[ingredient.ItemID]?.ItemUICategory),
        uiCategoryName: idToItem[ingredient.ItemID]?.ItemUICategoryName || ''
      };
    });
  });

  return maxPatch;
}

function buildRecipeIndexes() {
  recipeNames = sortRecipeNames(Object.keys(recipes));
  const usedInSets = {};

  Object.entries(recipes).forEach(([recipeName, recipe]) => {
    recipe.ingredients.forEach(ingredient => {
      if (!usedInSets[ingredient.name]) usedInSets[ingredient.name] = new Set();
      usedInSets[ingredient.name].add(recipeName);
    });
  });

  usedIn = Object.fromEntries(
    Object.entries(usedInSets).map(([ingredientName, recipeSet]) => [ingredientName, [...recipeSet]])
  );
  ingredientNames = sortRecipeNames(
    Object.keys(usedIn).filter(name => !recipes[name] && !CRYSTAL_EXCLUDE.has(name))
  );
}

function buildApplicationData(rawList) {
  const idToItem = {};
  rawList.forEach(item => {
    idToItem[item.ID] = item;
    const numericId = toNumeric(item.ID, NaN);
    if (!Number.isNaN(numericId)) idToItemName[numericId] = item.Name;
  });
  const maxPatch = buildItemAndRecipeMasters(rawList, idToItem);
  buildRecipeIndexes();
  return maxPatch;
}

function updatePatchStatus(maxPatch) {
  elements.loadStatus.textContent = maxPatch > 0
    ? `patch ${String(maxPatch).slice(0, -2)}.${String(maxPatch).slice(-2)} 対応`
    : '';
}

function showLoadError(error) {
  elements.loadStatus.textContent = '読み込みエラー';
  const message = document.createElement('div');
  message.className = 'error-msg';
  message.append('データの読み込みに失敗しました。', document.createElement('br'), error.message);
  elements.treeContainer.replaceChildren(message);
}

async function init() {
  updatePopupButtonVisibility();
  loadFavorites();
  loadSearchHistory();
  await loadTips();

  renderList();
  renderTips();

  try {
    const rawList = await fetchJson(
      DATA_FILE,
      status => `Item.json が見つかりません (${status})`
    );
    updatePatchStatus(buildApplicationData(rawList));
    canSaveViewState = true;
    if (!restoreViewState()) {
      renderList();
      renderResultView();
      if (isMobile()) showMobilePanel('left');
      else clearMobilePanels();
      saveViewState();
    }
  } catch (e) {
    showLoadError(e);
  }
}

function showMobilePanel(panelName) {
  if (!isMobile()) return;
  elements.panelLeft.classList.toggle('mobile-visible', panelName === 'left');
  elements.panelMiddle.classList.toggle('mobile-visible', panelName === 'middle');
  elements.panelRight.classList.toggle('mobile-visible', panelName === 'right');
  elements.mobileBackBtn.classList.toggle('visible', panelName !== 'left');
  elements.mobileBackBtn.dataset.panel = panelName;
  saveViewState();
}

function clearMobilePanels() {
  elements.panelLeft.classList.remove('mobile-visible');
  elements.panelMiddle.classList.remove('mobile-visible');
  elements.panelRight.classList.remove('mobile-visible');
  elements.mobileBackBtn.classList.remove('visible');
  delete elements.mobileBackBtn.dataset.panel;
}

function changeCount(delta) {
  elements.countInput.value = Math.min(
    REQUEST_COUNT_MAX,
    Math.max(1, readRequestedCount(elements.countInput) + delta)
  );
  renderResultView();
}

function readRequestedCount(input) {
  const numericValue = Number(input.value);
  try {
    return validateRequestedCount(numericValue, REQUEST_COUNT_MAX);
  } catch {
    const normalized = Number.isSafeInteger(numericValue) && numericValue > REQUEST_COUNT_MAX
      ? REQUEST_COUNT_MAX
      : 1;
    input.value = String(normalized);
    return normalized;
  }
}

function handleRequestedCountInput(input, render) {
  if (input.value === '') return;
  readRequestedCount(input);
  render();
}

function commitRequestedCountInput(input, render) {
  readRequestedCount(input);
  render();
}

function resetCountInput() {
  elements.countInput.value = '1';
}

function clearRenderedTree() {
  Array.from(elements.treeContainer.children).forEach(child => {
    if (child !== elements.tipsMsg) child.remove();
  });
}

function setResultViewMode(mode) {
  resultViewMode = mode === 'materials' ? 'materials' : 'tree';
  elements.treeViewBtn.classList.toggle('active', resultViewMode === 'tree');
  elements.materialsViewBtn.classList.toggle('active', resultViewMode === 'materials');
}

function setResultSourceMode(mode) {
  resultSourceMode = mode === 'favorite-materials' ? 'favorite-materials' : 'recipe';
}

function getFavoriteMaterialRingNames(list = getDisplayedFavoriteList()) {
  return getFavoriteListRecipeNames(list).filter(isRingRecipe).sort(compareItemNames);
}

function ensureFavoriteMaterialsRingCounts() {
  const ringNames = getFavoriteMaterialRingNames();
  favoriteMaterialsRingCounts = Object.fromEntries(
    ringNames.map(name => [name, favoriteMaterialsRingCounts[name] === 2 ? 2 : 1])
  );
}

function openFavoriteMaterialsMode() {
  if (!getDisplayedFavoriteList()) return;
  resetCountInput();
  selectedRecipe = null;
  setResultSourceMode('favorite-materials');
  setResultViewMode('materials');
  ensureFavoriteMaterialsRingCounts();
  renderList();
  renderResultView();
  if (isMobile()) {
    prevPanel = 'left';
    showMobilePanel('right');
    elements.treeContainer.scrollTop = 0;
  }
}

function leaveFavoriteMaterialsMode() {
  if (resultSourceMode !== 'favorite-materials') return;
  setResultSourceMode('recipe');
  favoriteMaterialsRingCounts = {};
}

function updateResultHeader() {
  const count = readRequestedCount(elements.countInput);
  if (resultSourceMode === 'favorite-materials') {
    const listName = getDisplayedFavoriteList()?.name || '';
    elements.countLabel.textContent = 'セット数:';
    elements.resultTitle.textContent = listName ? `【${listName} × ${formatNumber(count)}セット分】` : '';
    elements.usesBtn.classList.remove('visible');
    elements.treeViewBtn.classList.add('hidden');
    elements.materialsViewBtn.classList.remove('hidden');
    elements.materialsViewBtn.classList.add('active');
    elements.materialsViewBtn.disabled = true;
    elements.resultViewSwitch.classList.toggle('hidden', !listName);
    elements.resultViewSwitch.classList.add('favorite-materials-only');
    elements.resultHeader.classList.toggle('hidden', !listName);
    return;
  }

  elements.countLabel.textContent = '個数:';
  elements.resultTitle.textContent = selectedRecipe ? `【${selectedRecipe} × ${formatNumber(count)}個分】` : '';
  const usesCount = selectedRecipe ? (usedIn[selectedRecipe]?.length || 0) : 0;
  elements.usesBtn.textContent = `使用先 (${formatNumber(usesCount)})`;
  elements.usesBtn.classList.toggle('visible', usesCount > 0);
  elements.treeViewBtn.classList.remove('hidden');
  elements.materialsViewBtn.disabled = false;
  elements.resultViewSwitch.classList.remove('favorite-materials-only');
  const showSwitch = Boolean(selectedRecipe);
  elements.resultViewSwitch.classList.toggle('hidden', !showSwitch);
  elements.resultHeader.classList.toggle('hidden', !showSwitch);
}

function renderResultView() {
  clearRenderedTree();
  updateResultHeader();

  if (resultSourceMode === 'favorite-materials' && !getDisplayedFavoriteList()) {
    showTips();
    setResultSourceMode('recipe');
    updateResultHeader();
    saveViewState();
    return;
  }

  if (!selectedRecipe && resultSourceMode !== 'favorite-materials') {
    showTips();
    saveViewState();
    return;
  }

  elements.tipsMsg.classList.add('hidden');
  if (resultViewMode === 'materials') renderMaterialsList();
  else renderTree();
  saveViewState();
}

function resetToStartupView() {
  suppressViewStateSave = true;
  leaveFavoriteMaterialsMode();
  favoriteItemReorderEnabled = false;
  selectedRecipe = null;
  selectedUsesItem = null;
  prevPanel = 'left';
  listMode = 'none';
  setResultViewMode('tree');
  favoriteStore.selectedListId = null;
  saveFavorites();
  treePinMap.clear();
  exchangeTreeState.clear();

  elements.searchBox.value = '';
  elements.searchClearBtn.classList.remove('visible');
  updateFavoriteButtonState();
  closeSearchHistory();
  closeFavoriteLists();
  closeUsesPanel();

  elements.usesTitle.textContent = '';
  elements.usesList.replaceChildren();
  elements.countInput.value = '1';

  clearRenderedTree();
  showTips();
  updateResultHeader();
  renderList();

  if (isMobile()) showMobilePanel('left');
  else {
    clearMobilePanels();
  }
  suppressViewStateSave = false;
  clearViewState();
}

function handleResize() {
  const mobile = isMobile();
  if (mobile === wasMobile) return;
  wasMobile = mobile;
  resetToStartupView();
}

// Recipe tree calculation and rendering
function shouldShowCraftBadgeOnlyAtRoot(recipeName) {
  const rootCraftType = recipes[recipeName]?.craftType;
  if (rootCraftType === undefined || EXCHANGE_CRAFT_TYPES.has(rootCraftType)) return false;
  const treeCraftTypes = collectTreeCraftTypes(recipeName);
  return treeCraftTypes.size === 1 && treeCraftTypes.has(rootCraftType);
}

function createMaterialLabel(name, qty) {
  return qty === null ? name : `${name} × ${formatNumber(qty)}`;
}

function itemSortKey(name) {
  const master = itemMaster[name] || {};
  return {
    uiCategory: toNumeric(master.uiCategory),
    id: toNumeric(master.numericId || master.id)
  };
}

function compareItemNames(a, b) {
  const left = itemSortKey(a);
  const right = itemSortKey(b);
  return left.uiCategory - right.uiCategory || left.id - right.id || a.localeCompare(b, 'ja');
}

function getCrystalPart(name, parts) {
  return parts.find(part => name.startsWith(part) || name.endsWith(part)) || '';
}

function crystalKind(name) {
  return getCrystalPart(name, CRYSTAL_KIND_ORDER);
}

function crystalElement(name) {
  return getCrystalPart(name, CRYSTAL_ELEMENT_ORDER);
}

function compareCrystalNames(a, b) {
  const kindDiff = CRYSTAL_KIND_ORDER.indexOf(crystalKind(a)) - CRYSTAL_KIND_ORDER.indexOf(crystalKind(b));
  if (kindDiff !== 0) return kindDiff;
  const elementDiff = CRYSTAL_ELEMENT_ORDER.indexOf(crystalElement(a)) - CRYSTAL_ELEMENT_ORDER.indexOf(crystalElement(b));
  return elementDiff || compareItemNames(a, b);
}

function compareMaterialRows(a, b) {
  return compareItemNames(a.name, b.name);
}

function compareIntermediateRows(a, b) {
  const leftRecipe = recipes[a.name];
  const rightRecipe = recipes[b.name];
  const left = itemSortKey(a.name);
  const right = itemSortKey(b.name);

  return toNumeric(leftRecipe?.craftType) - toNumeric(rightRecipe?.craftType)
    || left.uiCategory - right.uiCategory
    || left.id - right.id
    || a.name.localeCompare(b.name, 'ja');
}

function compareCrystalRows(a, b) {
  return compareCrystalNames(a.name, b.name);
}

function isExchangeMaterialRow(row) {
  return row.type === 'item' && EXCHANGE_CRAFT_TYPES.has(itemMaster[row.name]?.craftType);
}

function compareSupplementEntryLists(a = [], b = []) {
  const left = sortSupplementEntries(a);
  const right = sortSupplementEntries(b);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    if (!left[index]) return -1;
    if (!right[index]) return 1;
    const result = compareItemNames(left[index].name, right[index].name);
    if (result !== 0) return result;
  }
  return 0;
}

function compareExchangeMaterialRows(a, b) {
  return compareSupplementEntryLists(a.supplements, b.supplements)
    || compareMaterialRows(a, b);
}

function sortSupplementEntries(entries = []) {
  return [...entries].sort((a, b) => compareItemNames(a.name, b.name));
}

function categorizeMaterialRows(rows) {
  const normal = [];
  const exchange = [];
  const crystals = [];

  rows.forEach(row => {
    if (row.type !== 'item') {
      normal.push(row);
      return;
    }
    if (crystalKind(row.name)) crystals.push(row);
    else if (isExchangeMaterialRow(row)) exchange.push(row);
    else normal.push(row);
  });

  const sortRows = targetRows => targetRows.sort((a, b) => {
    if (a.type === 'item' && b.type === 'item') return compareMaterialRows(a, b);
    if (a.type === 'item') return -1;
    if (b.type === 'item') return 1;
    return 0;
  });
  sortRows(normal);
  exchange.sort((a, b) => compareExchangeMaterialRows(a, b));
  crystals.sort(compareCrystalRows);
  return { normal, exchange, crystals };
}

function childTreePath(pathKey, childName, index) {
  return `${pathKey}>${index}:${childName}`;
}

function cloneMaterialOption(option) {
  return option.map(item => ({ ...item }));
}

function cloneSupplementEntry(entry) {
  return { ...entry };
}

function mergeSupplementEntries(targetEntries = [], incomingEntries = []) {
  const merged = targetEntries.map(cloneSupplementEntry);
  const entryMap = new Map(merged.map(entry => [entry.name, entry]));

  incomingEntries.forEach(entry => {
    if (entryMap.has(entry.name)) entryMap.get(entry.name).qty += entry.qty;
    else {
      const nextEntry = cloneSupplementEntry(entry);
      entryMap.set(nextEntry.name, nextEntry);
      merged.push(nextEntry);
    }
  });

  return merged;
}

function createExchangeSupplementEntries(recipe, craftTimes) {
  return recipe.ingredients.map(ingredient => ({
    name: ingredient.name,
    qty: ingredient.qty * craftTimes,
    refinable: recipe.craftType === '9'
  }));
}

function createCraftInfo(name, neededQty) {
  const recipe = recipes[name];
  if (!recipe) return null;
  return calculateCraft(neededQty, recipe.yield);
}

function createCraftSupplementEntries(name, neededQty) {
  const recipe = recipes[name];
  if (!recipe) return [];
  const info = createCraftInfo(name, neededQty);
  if (!info) return [];
  const entries = [];
  if (info.surplus > 0) entries.push({ label: '↩', qty: info.surplus, suffix: '個余り', kind: 'surplus' });
  if (!EXCHANGE_CRAFT_TYPES.has(recipe.craftType) && info.craftTimes >= 1) {
    entries.push({ label: '🔨', qty: info.craftTimes, suffix: '回製作', kind: 'craft' });
  }
  return entries;
}

function supplementGroupKey(entries = []) {
  return sortSupplementEntries(entries)
    .map(entry => `${entry.name}:${entry.qty}:${entry.refinable ? 1 : 0}`)
    .join('|');
}

function createSupplementSummaryState() {
  return {
    fixed: new Map(),
    choices: new Map()
  };
}

function accumulateSupplementSummary(summary, entries = []) {
  if (!entries.length) return;

  if (entries.length === 1) {
    const entry = entries[0];
    const key = `${entry.name}:${entry.refinable ? 1 : 0}`;
    const current = summary.fixed.get(key) || {
      name: entry.name,
      qty: 0,
      refinable: Boolean(entry.refinable)
    };
    current.qty += entry.qty;
    summary.fixed.set(key, current);
    return;
  }

  const sortedEntries = sortSupplementEntries(entries);
  const key = supplementGroupKey(sortedEntries);
  if (!summary.choices.has(key)) {
    summary.choices.set(key, sortedEntries.map(cloneSupplementEntry));
    return;
  }

  const current = summary.choices.get(key);
  sortedEntries.forEach((entry, index) => {
    current[index].qty += entry.qty;
  });
}

function summarizeMaterialRows(rows) {
  return rows.map(row => {
    if (row.type === 'item') return createMaterialLabel(row.name, row.qty);
    return row.options.map(option =>
      option.map(item => createMaterialLabel(item.name, item.qty)).join(' / ')
    ).join(' もしくは ');
  }).join(' / ');
}

function createMaterialChoiceContent(row) {
  const wrapper = document.createElement('span');
  wrapper.className = 'material-choice';

  row.options.forEach((option, optionIndex) => {
    if (optionIndex > 0) {
      wrapper.appendChild(createTextElement('span', 'material-choice-sep', 'もしくは'));
    }

    const optionEl = document.createElement('span');
    optionEl.className = 'material-choice-option';

    option.forEach((item, itemIndex) => {
      if (itemIndex > 0) {
        optionEl.appendChild(createTextElement('span', 'material-choice-join', '/'));
      }

      const itemEl = document.createElement('span');
      itemEl.className = 'material-choice-item';
      const icon = createItemIcon(itemMaster[item.name]?.icon, 'list-icon');
      if (icon) itemEl.appendChild(icon);
      itemEl.appendChild(createTextElement('span', 'material-choice-name', item.name));
      if (item.qty !== null) {
        itemEl.appendChild(createTextElement('span', 'material-choice-qty', `× ${formatNumber(item.qty)}`));
      }
      optionEl.appendChild(itemEl);
    });

    wrapper.appendChild(optionEl);
  });

  return wrapper;
}

function createRefinableSupplementLabel() {
  return createTextElement('span', 'supplement-refine-label badge-exchange', '精選、または');
}

function appendSupplementName(target, entry, className) {
  if (entry.refinable) target.appendChild(createRefinableSupplementLabel());
  target.appendChild(createTextElement('span', className, entry.name));
}

function mergeMaterialRows(targetRows, incomingRows) {
  const materialMap = new Map(
    targetRows
      .filter(row => row.type === 'item')
      .map(row => [row.name, row])
  );

  incomingRows.forEach(row => {
    if (row.type === 'item') {
      if (materialMap.has(row.name)) {
        const current = materialMap.get(row.name);
        current.qty += row.qty;
        current.supplements = mergeSupplementEntries(current.supplements, row.supplements);
      } else {
        const nextRow = { ...row };
        if (row.supplements) nextRow.supplements = row.supplements.map(cloneSupplementEntry);
        materialMap.set(nextRow.name, nextRow);
        targetRows.push(nextRow);
      }
      return;
    }

    targetRows.push({
      type: 'choice',
      options: row.options.map(cloneMaterialOption)
    });
  });
}

function mergeMaterialItems(items) {
  const merged = [];
  const itemMap = new Map();

  items.forEach(item => {
    const key = `${item.name}::${item.qty === null ? 'null' : item.qty}`;
    if (item.qty === null) {
      merged.push({ ...item });
      return;
    }

    if (itemMap.has(item.name)) itemMap.get(item.name).qty += item.qty;
    else {
      const nextItem = { ...item };
      itemMap.set(nextItem.name, nextItem);
      merged.push(nextItem);
    }
  });

  return merged;
}

function renderFavoriteRingControls(container) {
  const ringNames = getFavoriteMaterialRingNames();
  if (ringNames.length === 0) return;

  const section = document.createElement('div');
  section.className = 'favorite-ring-controls';

  ringNames.forEach(name => {
    const row = document.createElement('div');
    row.className = 'favorite-ring-row';

    const icon = createItemIcon(itemMaster[name]?.icon);
    if (icon) row.appendChild(icon);
    row.appendChild(createTextElement('span', 'favorite-ring-name', name));

    const toggle = document.createElement('div');
    toggle.className = 'favorite-ring-toggle';

    [1, 2].forEach(value => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `${value}つ`;
      button.classList.toggle('active', favoriteMaterialsRingCounts[name] === value);
      button.addEventListener('click', () => {
        favoriteMaterialsRingCounts[name] = value;
        saveViewState();
        renderResultView();
      });
      toggle.appendChild(button);
    });

    row.appendChild(toggle);
    section.appendChild(row);
  });

  container.appendChild(section);
  const separator = document.createElement('div');
  separator.className = 'favorite-ring-separator';
  container.appendChild(separator);
}

function calculateMaterialRequirements(rootItems) {
  return calculateRequirements(recipes, rootItems, {
    exchangeCraftTypes: EXCHANGE_CRAFT_TYPES
  });
}

function materialRowsFromRequirements(result) {
  const rows = [];
  result.states.forEach(state => {
    if (state.recipe && !state.isExchange) return;
    const row = { type: 'item', name: state.name, qty: state.needed };
    if (state.isExchange) {
      row.supplements = createExchangeSupplementEntries(state.recipe, state.craftTimes);
    }
    rows.push(row);
  });
  return rows;
}

function intermediateTreeFromRequirements(result) {
  return createIntermediateForest(result, state => !crystalKind(state.name));
}

function getFavoriteMaterialRoots() {
  ensureFavoriteMaterialsRingCounts();
  const setCount = readRequestedCount(elements.countInput);
  return getFavoriteListRecipeNames().map(name => {
    const multiplier = isRingRecipe(name) ? (favoriteMaterialsRingCounts[name] || 1) : 1;
    return { name, qty: setCount * multiplier };
  });
}

function getCurrentMaterialRequirements() {
  const count = readRequestedCount(elements.countInput);
  const roots = resultSourceMode === 'favorite-materials'
    ? getFavoriteMaterialRoots()
    : [{ name: selectedRecipe, qty: count }];
  return calculateMaterialRequirements(roots);
}

function renderMaterialsList() {
  const requirements = getCurrentMaterialRequirements();
  const rows = materialRowsFromRequirements(requirements);
  const intermediateTree = intermediateTreeFromRequirements(requirements);
  const categorizedRows = categorizeMaterialRows(rows);
  const list = document.createElement('ul');
  list.className = 'materials-list';
  const exchangeSummary = createSupplementSummaryState();
  rows.forEach(row => {
    if (row.type === 'item' && row.supplements?.length) {
      accumulateSupplementSummary(exchangeSummary, row.supplements);
    }
  });

  if (resultSourceMode === 'favorite-materials') {
    renderFavoriteRingControls(elements.treeContainer);
  }

  const contextKey = resultSourceMode === 'favorite-materials'
    ? `favorite:${getDisplayedFavoriteList()?.id || ''}`
    : `recipe:${selectedRecipe || ''}`;
  const appendSectionHeader = (title, initiallyCollapsed, bodyRows) => {
    if (bodyRows.length === 0) return;
    const stateKey = `${contextKey}:${title}`;
    const collapsedState = materialSectionState.has(stateKey)
      ? materialSectionState.get(stateKey)
      : initiallyCollapsed;
    const header = document.createElement('li');
    header.className = 'materials-section-header';
    const toggle = createTextElement('span', 'materials-section-toggle', collapsedState ? '▶' : '▼');
    header.append(toggle, createTextElement('span', 'materials-section-title', title));
    list.appendChild(header);
    bodyRows.forEach(row => {
      row.classList.toggle('collapsed', collapsedState);
      list.appendChild(row);
    });
    header.addEventListener('click', () => {
      const collapsed = toggle.textContent === '▼';
      toggle.textContent = collapsed ? '▶' : '▼';
      materialSectionState.set(stateKey, collapsed);
      bodyRows.forEach(row => row.classList.toggle('collapsed', collapsed));
    });
  };

  const createMaterialRow = row => {
    const li = document.createElement('li');
    if (row.type === 'item') {
      const icon = createItemIcon(itemMaster[row.name]?.icon);
      if (icon) li.appendChild(icon);
      const content = document.createElement('div');
      content.className = 'material-content';
      const primary = document.createElement('div');
      primary.className = 'material-primary';
      primary.append(
        createTextElement('span', 'material-name', row.name),
        createTextElement('span', 'material-qty', `× ${formatNumber(row.qty)}`)
      );
      content.appendChild(primary);

      if (row.supplements?.length) {
        const supplement = document.createElement('div');
        supplement.className = 'material-supplement';
        sortSupplementEntries(row.supplements).forEach((entry, index) => {
          if (index > 0) {
            supplement.appendChild(createTextElement('div', 'material-supplement-sep', 'もしくは'));
          }

          const entryRow = document.createElement('div');
          entryRow.className = 'material-supplement-row';
          if (entry.isTextOnly) {
            appendSupplementName(entryRow, entry, 'material-supplement-name');
          } else {
            const supplementIcon = createItemIcon(itemMaster[entry.name]?.icon, 'material-supplement-icon');
            if (supplementIcon) entryRow.appendChild(supplementIcon);
            appendSupplementName(entryRow, entry, 'material-supplement-name');
            entryRow.appendChild(createTextElement('span', 'material-supplement-qty', `× ${formatNumber(entry.qty)}`));
          }
          supplement.appendChild(entryRow);
        });
        content.appendChild(supplement);
      }

      li.appendChild(content);
    } else {
      li.appendChild(createMaterialChoiceContent(row));
    }
    return li;
  };

  const createIntermediateRow = (row, pathKey, alignToggleSpace) => {
    const li = document.createElement('li');
    li.className = 'intermediate-tree-node';
    const rowElement = document.createElement('div');
    rowElement.className = 'intermediate-tree-row';
    const hasChildren = row.children.length > 0;
    const expanded = intermediateTreeState.get(pathKey) !== false;
    let toggle;
    if (hasChildren) {
      toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'intermediate-tree-toggle';
      toggle.textContent = expanded ? '▼' : '▶';
      toggle.setAttribute('aria-label', `${row.name}を展開・折り畳み`);
      rowElement.appendChild(toggle);
    } else if (alignToggleSpace) {
      const spacer = document.createElement('span');
      spacer.className = 'intermediate-tree-toggle intermediate-tree-toggle-spacer';
      spacer.setAttribute('aria-hidden', 'true');
      rowElement.appendChild(spacer);
    }
    const icon = createItemIcon(itemMaster[row.name]?.icon);
    if (icon) rowElement.appendChild(icon);
    const content = document.createElement('div');
    content.className = 'material-content';
    const primary = document.createElement('div');
    primary.className = 'material-primary';
    primary.append(
      createTextElement('span', 'material-name', row.name),
      createTextElement('span', 'material-qty', `× ${formatNumber(row.qty)}`)
    );
    content.appendChild(primary);

    const supplementEntries = createCraftSupplementEntries(row.name, row.qty);
    if (supplementEntries.length) {
      const supplement = document.createElement('div');
      supplement.className = 'material-supplement';
      const entryRow = document.createElement('div');
      entryRow.className = 'material-supplement-row';
      supplementEntries.forEach(entry => {
        const subRow = document.createElement('span');
        subRow.className = 'material-sub-row';
        subRow.append(
          createTextElement('span', 'material-sub-label', `${entry.label} `),
          createTextElement(
            'span',
            `material-sub-num ${entry.kind === 'surplus' ? 'material-sub-surplus' : ''}`,
            formatNumber(entry.qty)
          ),
          createTextElement('span', 'material-sub-label', ` ${entry.suffix}`)
        );
        entryRow.appendChild(subRow);
      });
      supplement.appendChild(entryRow);
      content.appendChild(supplement);
    }

    rowElement.appendChild(content);
    const treeButton = document.createElement('button');
    treeButton.type = 'button';
    treeButton.className = 'intermediate-material-tree-btn';
    treeButton.textContent = '🌲';
    treeButton.title = `${row.name}のミニレシピツリー`;
    treeButton.setAttribute('aria-label', `${row.name}のミニレシピツリー`);
    treeButton.addEventListener('click', event => {
      event.stopPropagation();
      openMaterialTree(row.name, row.qty);
    });
    rowElement.appendChild(treeButton);
    li.appendChild(rowElement);

    if (hasChildren) {
      const children = document.createElement('ul');
      children.className = 'intermediate-tree-children';
      children.classList.toggle('collapsed', !expanded);
      [...row.children].sort(compareIntermediateRows).forEach((child, index) => {
        children.appendChild(createIntermediateRow(child, childTreePath(pathKey, child.name, index), alignToggleSpace));
      });
      const toggleChildren = () => {
        const collapsed = children.classList.toggle('collapsed');
        toggle.textContent = collapsed ? '▶' : '▼';
        intermediateTreeState.set(pathKey, !collapsed);
      };
      toggle.addEventListener('click', event => {
        event.stopPropagation();
        toggleChildren();
      });
      rowElement.addEventListener('click', toggleChildren);
      li.appendChild(children);
    }
    return li;
  };

  const alignIntermediateToggleSpace = intermediateTree.some(row => row.children.length > 0);
  const intermediateSectionRows = intermediateTree
    .sort(compareIntermediateRows)
    .map((row, index) => createIntermediateRow(row, `${contextKey}:intermediate:${index}:${row.name}`, alignIntermediateToggleSpace));
  const materialSectionRows = [...categorizedRows.normal, ...categorizedRows.exchange].map(createMaterialRow);
  const crystalSectionRows = categorizedRows.crystals.map(createMaterialRow);
  const exchangeSourceRows = rows.filter(row => row.type === 'item' && row.supplements?.length);
  const shouldCollapseExchangeSummary = exchangeSourceRows.length > 0
    && exchangeSourceRows.every(row => itemMaster[row.name]?.craftType === '9');

  appendSectionHeader('製作する中間素材', false, intermediateSectionRows);
  appendSectionHeader('必要素材', false, materialSectionRows);
  appendSectionHeader('必要なシャード/クリスタル/クラスター', true, crystalSectionRows);

  if (exchangeSummary.fixed.size > 0 || exchangeSummary.choices.size > 0) {
    const summaryRows = [];

    [...exchangeSummary.fixed.values()].sort((a, b) =>
      compareItemNames(a.name, b.name) || Number(a.refinable) - Number(b.refinable)
    ).forEach(entry => {
      const li = document.createElement('li');
      li.className = 'materials-summary-row';
      const icon = createItemIcon(itemMaster[entry.name]?.icon);
      if (icon) li.appendChild(icon);
      const content = document.createElement('div');
      content.className = 'material-content';
      if (entry.refinable) {
        const labelRow = document.createElement('div');
        labelRow.className = 'material-refine-row';
        labelRow.appendChild(createRefinableSupplementLabel());
        content.appendChild(labelRow);
      }
      const primary = document.createElement('div');
      primary.className = 'material-primary';
      primary.append(
        createTextElement('span', 'material-name', entry.name),
        createTextElement('span', 'material-qty', `× ${formatNumber(entry.qty)}`)
      );
      content.appendChild(primary);
      li.appendChild(content);
      summaryRows.push(li);
    });

    [...exchangeSummary.choices.values()].map(sortSupplementEntries).sort((a, b) =>
      compareItemNames(a[0]?.name || '', b[0]?.name || '')
    ).forEach(entries => {
      const li = document.createElement('li');
      li.className = 'materials-summary-row';
      const content = document.createElement('div');
      content.className = 'material-content';
      const supplement = document.createElement('div');
      supplement.className = 'material-supplement material-supplement-summary';

      entries.forEach((entry, index) => {
        if (index > 0) {
          supplement.appendChild(createTextElement('div', 'material-supplement-sep', 'もしくは'));
        }

        const entryRow = document.createElement('div');
        entryRow.className = 'material-supplement-row materials-summary-choice-row';
        const icon = createItemIcon(itemMaster[entry.name]?.icon);
        if (icon) entryRow.appendChild(icon);
        if (entry.refinable) {
          const entryContent = document.createElement('div');
          entryContent.className = 'material-summary-entry-content';
          const labelRow = document.createElement('div');
          labelRow.className = 'material-refine-row';
          labelRow.appendChild(createRefinableSupplementLabel());
          const infoRow = document.createElement('div');
          infoRow.className = 'material-primary';
          infoRow.append(
            createTextElement('span', 'material-name', entry.name),
            createTextElement('span', 'material-qty', `× ${formatNumber(entry.qty)}`)
          );
          entryContent.append(labelRow, infoRow);
          entryRow.appendChild(entryContent);
        } else {
          entryRow.append(
            createTextElement('span', 'material-name', entry.name),
            createTextElement('span', 'material-qty', `× ${formatNumber(entry.qty)}`)
          );
        }
        supplement.appendChild(entryRow);
      });

      content.appendChild(supplement);
      li.appendChild(content);
      summaryRows.push(li);
    });

    appendSectionHeader('必要な交換貨幣', shouldCollapseExchangeSummary, summaryRows);
  }

  elements.treeContainer.appendChild(list);
}

function renderTree() {
  const count = readRequestedCount(elements.countInput);
  treePinMap.clear();

  const producedQty = calcProduced(selectedRecipe, count);
  elements.treeContainer.appendChild(
    buildNode(
      selectedRecipe,
      count,
      producedQty,
      0,
      selectedRecipe,
      null,
      null,
      shouldShowCraftBadgeOnlyAtRoot(selectedRecipe)
    )
  );
}

function renderMaterialTreeDialog() {
  if (!materialTreeRecipe) return;
  const count = readRequestedCount(elements.materialTreeCountInput);
  elements.materialTreeTitle.textContent = `【${materialTreeRecipe} × ${formatNumber(count)}個分】`;
  elements.materialTreeContent.replaceChildren();
  elements.materialTreeContent.appendChild(
    buildNode(
      materialTreeRecipe,
      count,
      calcProduced(materialTreeRecipe, count),
      0,
      `material-dialog:${materialTreeRecipe}`,
      null,
      null,
      shouldShowCraftBadgeOnlyAtRoot(materialTreeRecipe),
      false
    )
  );
}

function openMaterialTree(name, neededQty) {
  materialTreeRecipe = name;
  elements.materialTreeCountInput.value = String(Math.min(REQUEST_COUNT_MAX, Math.max(1, neededQty)));
  renderMaterialTreeDialog();
  elements.materialTreeOverlay.classList.add('open');
}

function closeMaterialTree() {
  elements.materialTreeOverlay.classList.remove('open');
  materialTreeRecipe = null;
  renderResultView();
}

function changeMaterialTreeCount(delta) {
  elements.materialTreeCountInput.value = Math.max(
    1,
    Math.min(REQUEST_COUNT_MAX, readRequestedCount(elements.materialTreeCountInput) + delta)
  );
  renderMaterialTreeDialog();
}

function calcProduced(name, needed) {
  const r = recipes[name];
  if (!r) return needed;
  return calculateCraft(needed, r.yield).produced;
}

function collectTreeCraftTypes(rootName) {
  const craftTypes = new Set();
  const visited = new Set();
  const stack = [rootName];

  while (stack.length > 0) {
    const name = stack.pop();
    if (visited.has(name)) continue;
    visited.add(name);

    const recipe = recipes[name];
    if (!recipe) continue;
    if (!EXCHANGE_CRAFT_TYPES.has(recipe.craftType)) craftTypes.add(recipe.craftType);
    recipe.ingredients.forEach(ing => stack.push(ing.name));
  }

  return craftTypes;
}

function createTreeBadge(method, hideCraftBadge) {
  const badge = createTextElement('span', `badge ${methodBadgeClass(method)}`, method);
  badge.classList.toggle('hidden', !method || hideCraftBadge);
  return badge;
}

function createTreePin(name) {
  const pin = document.createElement('button');
  const favorite = isFavorite(name);
  pin.className = 'pin-btn';
  pin.classList.toggle('inactive', !favorite);
  pin.textContent = favorite ? '📌' : '📍';
  pin.title = favorite ? 'お気に入りから削除' : 'お気に入りに追加';
  pin.addEventListener('click', event => {
    event.stopPropagation();
    isFavorite(name) ? pinOff(name) : pinOn(name);
  });
  registerTreePin(name, pin);
  return pin;
}

function createTreeMain(name, producedQty, subInfo, badge) {
  const title = document.createElement('span');
  title.className = 'node-title';
  if (badge) title.appendChild(badge);
  title.append(
    createTextElement('span', 'node-name', name),
    createTextElement('span', 'node-qty', `× ${formatNumber(producedQty)}`)
  );

  const main = document.createElement('span');
  main.className = 'node-main';
  main.appendChild(title);
  if (subInfo) main.appendChild(subInfo);
  return main;
}

function createTreeSubRow(prefix, number, suffix) {
  const row = document.createElement('span');
  row.className = 'node-sub-row';
  row.append(
    createTextElement('span', 'node-sub-label', prefix),
    createTextElement('span', 'node-sub-num', number),
    createTextElement('span', 'node-sub-label', suffix)
  );
  return row;
}

function createTreeSubInfo(recipe, neededQty, producedQty, unitCost, unitTimes) {
  const rows = [];
  const surplus = producedQty - neededQty;
  const isExchange = recipe && EXCHANGE_CRAFT_TYPES.has(recipe.craftType);
  const craftTimes = recipe ? calculateCraft(neededQty, recipe.yield).craftTimes : 0;

  if (unitCost !== null && unitTimes !== null) {
    rows.push(createTreeSubRow(`(@${formatNumber(unitCost)} × `, formatNumber(unitTimes), ')'));
  }
  if (surplus > 0) {
    rows.push(createTreeSubRow('(↩', ` ${formatNumber(surplus)} `, '個余り)'));
  }
  if (!isExchange && craftTimes >= 1) {
    rows.push(createTreeSubRow('(🔨', ` ${formatNumber(craftTimes)} `, '回制作)'));
  }
  if (rows.length === 0) return null;

  const subInfo = document.createElement('span');
  subInfo.className = 'node-sub-info';
  subInfo.append(...rows);
  return subInfo;
}

function appendRecipeChildren(container, recipe, neededQty, depth, pathKey, showCraftBadgeOnlyAtRoot, showPins) {
  const isExchange = EXCHANGE_CRAFT_TYPES.has(recipe.craftType);
  const craftTimes = calculateCraft(neededQty, recipe.yield).craftTimes;

  recipe.ingredients.forEach((ingredient, index) => {
    if (isExchange && index > 0) {
      container.appendChild(createTextElement('div', 'or-divider', 'もしくは'));
    }

    const neededQty = ingredient.qty * craftTimes;
    const producedIngredientQty = calcProduced(ingredient.name, neededQty);
    container.appendChild(
      buildNode(
        ingredient.name,
        neededQty,
        producedIngredientQty,
        depth + 1,
        childTreePath(pathKey, ingredient.name, index),
        isExchange ? ingredient.qty : null,
        isExchange ? craftTimes : null,
        showCraftBadgeOnlyAtRoot,
        showPins
      )
    );
  });
}

function buildNode(
  name,
  neededQty,
  producedQty,
  depth,
  pathKey,
  unitCost = null,
  unitTimes = null,
  showCraftBadgeOnlyAtRoot = false,
  showPins = true
) {
  const master = itemMaster[name] || { method: '', icon: '', craftType: '' };
  const recipe = recipes[name];
  const hasChildren = Boolean(recipe);

  const node = document.createElement('div');
  node.className = 'tree-node';
  const row = document.createElement('div');
  row.className = 'node-row';
  const toggle = createTextElement('span', 'toggle', hasChildren ? '▼' : ' ');
  const hideCraftBadge = showCraftBadgeOnlyAtRoot && depth > 0 && CRAFT_JOBS_SET.has(master.method);

  row.appendChild(toggle);
  const icon = createItemIcon(master.icon, 'node-icon');
  if (icon) row.appendChild(icon);
  if (showPins) row.appendChild(createTreePin(name));
  row.appendChild(
    createTreeMain(
      name,
      neededQty,
      createTreeSubInfo(recipe, neededQty, producedQty, unitCost, unitTimes),
      createTreeBadge(master.method, hideCraftBadge)
    )
  );
  node.appendChild(row);

  if (!hasChildren) return node;

  const children = document.createElement('div');
  children.className = 'node-children';
  appendRecipeChildren(children, recipe, neededQty, depth, pathKey, showCraftBadgeOnlyAtRoot, showPins);

  if (recipe.craftType === '9') {
    const expanded = exchangeTreeState.get(pathKey) === true;
    children.classList.toggle('collapsed', !expanded);
    toggle.textContent = expanded ? '▼' : '▶';
  }

  row.addEventListener('click', () => {
    const collapsed = children.classList.toggle('collapsed');
    toggle.textContent = collapsed ? '▶' : '▼';
    if (recipe.craftType === '9') {
      exchangeTreeState.set(pathKey, !collapsed);
      if (resultSourceMode === 'recipe' && resultViewMode === 'materials') renderResultView();
    }
  });
  node.appendChild(children);
  return node;
}

function methodBadgeClass(method) {
  if (!method) return 'badge-gather';
  if (CRAFT_JOBS_SET.has(method)) return 'badge-craft';
  if (method === '交換' || method === '交換/精選') return 'badge-exchange';
  return 'badge-gather';
}

function encodeBytesBase36(bytes) {
  return [...bytes].map(byte => byte.toString(36).toUpperCase().padStart(2, '0')).join('');
}

function decodeBytesBase36(str) {
  if (str.length % 2 !== 0 || !/^[0-9A-Z]+$/.test(str)) return null;
  const bytes = [];
  for (let i = 0; i < str.length; i += 2) {
    const byte = parseInt(str.slice(i, i + 2), 36);
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) return null;
    bytes.push(byte);
  }
  return new Uint8Array(bytes);
}

function encodeFavoriteList(list) {
  if (!list) return '';
  const payload = JSON.stringify({ n: list.name, i: normalizeItemIds(list.itemIds) });
  const bytes = new TextEncoder().encode(payload);
  return `Z${bytes.length.toString(36).toUpperCase().padStart(4, '0')}${encodeBytesBase36(bytes)}`;
}

// Settings and favorite sharing
function decodeOldFavorites(str) {
  if (!str || !/^[A-Z0-9]+$/.test(str) || str.length % 4 !== 0) return null;
  const names = [];
  for (let i = 0; i < str.length; i += 4) {
    const name = idToRecipeName[parseInt(str.slice(i, i + 4), 36)];
    if (name) names.push(name);
  }
  return { name: '', itemIds: names.map(itemIdForName).filter(Boolean), needsName: true };
}

function decodeNewFavoriteList(str) {
  if (!/^Z[0-9A-Z]+$/.test(str) || str.length < 5) return null;
  const length = parseInt(str.slice(1, 5), 36);
  if (!Number.isInteger(length) || length < 0) return null;
  const bytes = decodeBytesBase36(str.slice(5));
  if (!bytes || bytes.length !== length) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    return {
      name: normalizeFavoriteListName(payload.n),
      itemIds: normalizeItemIds(payload.i).filter(id => itemNameForId(id)),
      needsName: false
    };
  } catch {
    return null;
  }
}

function decodeFavoriteShareCode(str) {
  if (!str || !/^[A-Z0-9]+$/.test(str)) return null;
  if (str.startsWith('Z')) return decodeNewFavoriteList(str);
  return decodeOldFavorites(str);
}

function openSettings() {
  selectedExportListId = null;
  elements.exportCode.value = '';
  elements.exportListToggle.textContent = 'リストを選択...';
  elements.copyExportBtn.textContent = 'コピー';
  elements.importCode.value = '';
  setImportError();
  closeExportListDropdown();
  renderExportListChoices();
  elements.settingsOverlay.classList.add('open');
}

function closeSettings() {
  elements.settingsOverlay.classList.remove('open');
  closeExportListDropdown();
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function renderMarkdownInline(text) {
  const codeSegments = [];
  let html = escapeHtml(text).replace(/`([^`]+)`/g, (_, code) => {
    const token = `\u0000CODE${codeSegments.length}\u0000`;
    codeSegments.push(`<code>${code}</code>`);
    return token;
  });

  html = html
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');

  codeSegments.forEach((segment, index) => {
    html = html.replace(`\u0000CODE${index}\u0000`, segment);
  });
  return html;
}

function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let listOpen = false;
  let listItemOpen = false;
  let paragraph = [];

  const closeListItem = () => {
    if (!listItemOpen) return;
    html.push('</li>');
    listItemOpen = false;
  };

  const closeList = () => {
    if (!listOpen) return;
    closeListItem();
    html.push('</ul>');
    listOpen = false;
  };

  const closeParagraph = () => {
    if (paragraph.length === 0) return;
    html.push(`<p>${paragraph.map(renderMarkdownInline).join('<br>')}</p>`);
    paragraph = [];
  };

  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) {
      closeParagraph();
      closeList();
      return;
    }
    if (listItemOpen && /^\s+/.test(line) && !trimmed.startsWith('- ')) {
      html.push(`<br>${renderMarkdownInline(trimmed)}`);
      return;
    }
    if (trimmed === '---') {
      closeParagraph();
      closeList();
      html.push('<hr>');
      return;
    }
    if (trimmed.startsWith('### ')) {
      closeParagraph();
      closeList();
      html.push(`<h4>${renderMarkdownInline(trimmed.slice(4))}</h4>`);
      return;
    }
    if (trimmed.startsWith('## ')) {
      closeParagraph();
      closeList();
      html.push(`<h3>${renderMarkdownInline(trimmed.slice(3))}</h3>`);
      return;
    }
    if (trimmed.startsWith('# ')) {
      closeParagraph();
      closeList();
      html.push(`<h2>${renderMarkdownInline(trimmed.slice(2))}</h2>`);
      return;
    }
    if (trimmed.startsWith('- ')) {
      closeParagraph();
      if (!listOpen) {
        html.push('<ul>');
        listOpen = true;
      }
      closeListItem();
      html.push(`<li>${renderMarkdownInline(trimmed.slice(2))}`);
      listItemOpen = true;
      return;
    }
    closeList();
    paragraph.push(trimmed);
  });

  closeParagraph();
  closeList();
  return html.join('');
}

async function openDocumentNotice(title, path) {
  elements.licenseTitle.textContent = title;
  elements.licenseText.textContent = '読み込み中...';
  elements.licenseOverlay.classList.add('open');

  try {
    const response = await fetch(path, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Failed to load ${path}`);
    const markdown = (await response.text()).replace(/^# .*(?:\n+|$)/, '');
    elements.licenseText.innerHTML = renderMarkdown(markdown);
  } catch {
    elements.licenseText.textContent = '文書を読み込めませんでした。時間をおいて再度お試しください。';
  }
}

function openLicenseNotice() {
  openDocumentNotice('LICENSE / NOTICE', LICENSE_NOTICE_FILE);
}

function openPrivacyPolicy() {
  openDocumentNotice('プライバシー・ポリシー', PRIVACY_POLICY_FILE);
}

function closeLicenseNotice() {
  elements.licenseOverlay.classList.remove('open');
}

function openContactLink() {
  window.open(CONTACT_URL, '_blank', 'noopener,noreferrer');
}

function copyExportCode() {
  const code = elements.exportCode.value;
  if (!code) return;
  navigator.clipboard.writeText(code).then(() => {
    elements.copyExportBtn.textContent = 'コピー済み';
    setTimeout(() => { elements.copyExportBtn.textContent = 'コピー'; }, 1500);
  });
}

function closeExportListDropdown() {
  elements.exportListChoices.classList.remove('open');
}

function toggleExportListDropdown() {
  renderExportListChoices();
  elements.exportListChoices.classList.toggle('open');
}

function selectExportList(listId) {
  selectedExportListId = listId;
  const list = findFavoriteList(listId);
  elements.exportCode.value = encodeFavoriteList(list);
  elements.exportListToggle.textContent = list ? list.name : 'リストを選択...';
  closeExportListDropdown();
  renderExportListChoices();
}

function renderExportListChoices() {
  if (!elements.exportListChoices) return;
  const frag = document.createDocumentFragment();
  if (favoriteStore.lists.length === 0) {
    frag.appendChild(createTextElement('li', 'list-empty', 'お気に入りリストがありません'));
  } else {
    favoriteStore.lists.forEach(list => {
      const li = document.createElement('li');
      li.classList.toggle('active', list.id === selectedExportListId);
      li.textContent = list.name;
      li.title = list.name;
      li.addEventListener('click', () => selectExportList(list.id));
      frag.appendChild(li);
    });
  }
  elements.exportListChoices.replaceChildren(frag);
}

function setImportError(message = '') {
  elements.importErr.textContent = message;
  elements.importErr.classList.toggle('visible', Boolean(message));
}

function startImport() {
  const code = elements.importCode.value.trim().toUpperCase();
  const decoded = decodeFavoriteShareCode(code);
  if (!decoded) {
    setImportError('無効なコードです');
    return;
  }
  if (decoded.itemIds.length === 0) {
    setImportError('有効なアイテムが見つかりませんでした');
    return;
  }
  setImportError();
  const importAsNewList = name => {
    const list = createFavoriteList(name, decoded.itemIds);
    closeSettings();
    selectFavoriteList(list.id);
  };
  if (decoded.needsName) {
    showTextInput('取り込むお気に入りリスト名', formatDefaultListName(), importAsNewList);
  } else {
    importAsNewList(decoded.name);
  }
}

function openPopup() {
  const w = 601;
  const ROW_H = 34;
  const HEADER_H = 90;
  const rows = Math.min(recipeNames.length, 12);
  const h = HEADER_H + rows * ROW_H;
  const left = Math.round((screen.width - w) / 2);
  const top  = Math.round((screen.height - h) / 2);
  const win = window.open(
    location.pathname, 'ff14recipe',
    `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=no,toolbar=no,menubar=no,location=no,status=no`
  );
  if (!win) alert('ポップアップがブロックされました。\nアドレスバーの通知から許可してください。');
}

// Event wiring and application startup
function handleDocumentPointerDown(event) {
  if (event.target !== elements.searchBox && !elements.searchHistory.contains(event.target)) {
    closeSearchHistory();
  }
  if (event.target !== elements.favBtn && !elements.favoriteLists.contains(event.target)) {
    closeFavoriteLists();
  }
  if (
    event.target !== elements.exportListToggle
    && !elements.exportListChoices.contains(event.target)
  ) {
    closeExportListDropdown();
  }
}

function bindEvents() {
  const standaloneQuery = window.matchMedia('(display-mode: standalone)');
  const overlayQuery = window.matchMedia('(display-mode: window-controls-overlay)');
  standaloneQuery.addEventListener?.('change', updatePopupButtonVisibility);
  overlayQuery.addEventListener?.('change', updatePopupButtonVisibility);

  elements.appTitle.addEventListener('click', resetToStartupView);
  elements.appTitle.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    resetToStartupView();
  });
  elements.popupBtn.addEventListener('click', openPopup);
  elements.settingsBtn.addEventListener('click', openSettings);
  elements.searchBox.addEventListener('input', onSearch);
  elements.searchBox.addEventListener('click', openSearchHistory);
  elements.searchBox.addEventListener('focus', openSearchHistory);
  elements.searchBox.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeSearchHistory();
  });
  elements.searchClearBtn.addEventListener('click', clearSearch);
  elements.favBtn.addEventListener('click', toggleFav);
  elements.usesBackBtn.addEventListener('click', returnToList);
  elements.backBtn.addEventListener('click', goBack);
  elements.mobileBackBtn.addEventListener('click', () => {
    if (elements.mobileBackBtn.dataset.panel === 'middle') returnToList();
    else goBack();
  });
  elements.countDecrease5Btn.addEventListener('click', () => changeCount(-5));
  elements.countDecreaseBtn.addEventListener('click', () => changeCount(-1));
  elements.countInput.addEventListener('input', () => handleRequestedCountInput(elements.countInput, renderResultView));
  elements.countInput.addEventListener('blur', () => commitRequestedCountInput(elements.countInput, renderResultView));
  elements.countInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') elements.countInput.blur();
  });
  elements.countIncreaseBtn.addEventListener('click', () => changeCount(1));
  elements.countIncrease5Btn.addEventListener('click', () => changeCount(5));
  elements.treeViewBtn.addEventListener('click', () => {
    setResultViewMode('tree');
    renderResultView();
  });
  elements.materialsViewBtn.addEventListener('click', () => {
    setResultViewMode('materials');
    renderResultView();
  });
  elements.materialTreeDecrease5Btn.addEventListener('click', () => changeMaterialTreeCount(-5));
  elements.materialTreeDecreaseBtn.addEventListener('click', () => changeMaterialTreeCount(-1));
  elements.materialTreeCountInput.addEventListener('input', () => {
    handleRequestedCountInput(elements.materialTreeCountInput, renderMaterialTreeDialog);
  });
  elements.materialTreeCountInput.addEventListener('blur', () => {
    commitRequestedCountInput(elements.materialTreeCountInput, renderMaterialTreeDialog);
  });
  elements.materialTreeCountInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') elements.materialTreeCountInput.blur();
  });
  elements.materialTreeIncreaseBtn.addEventListener('click', () => changeMaterialTreeCount(1));
  elements.materialTreeIncrease5Btn.addEventListener('click', () => changeMaterialTreeCount(5));
  elements.materialTreeCloseBtn.addEventListener('click', closeMaterialTree);
  elements.materialTreeOverlay.addEventListener('click', event => {
    if (event.target === elements.materialTreeOverlay) closeMaterialTree();
  });
  elements.usesBtn.addEventListener('click', () => showUsesPanel(selectedRecipe));
  elements.updateReloadBtn.addEventListener('click', () => location.reload());
  elements.confirmYes.addEventListener('click', confirmPendingAction);
  elements.confirmNo.addEventListener('click', closeConfirm);
  elements.settingsOverlay.addEventListener('click', event => {
    if (event.target === elements.settingsOverlay) closeSettings();
  });
  elements.copyExportBtn.addEventListener('click', copyExportCode);
  elements.startImportBtn.addEventListener('click', startImport);
  elements.contactBtn.addEventListener('click', openContactLink);
  elements.privacyBtn.addEventListener('click', openPrivacyPolicy);
  elements.licenseBtn.addEventListener('click', openLicenseNotice);
  elements.licenseOverlay.addEventListener('click', event => {
    if (event.target === elements.licenseOverlay) closeLicenseNotice();
  });
  elements.licenseCloseBtn.addEventListener('click', closeLicenseNotice);
  elements.settingsCloseBtn.addEventListener('click', closeSettings);
  elements.exportListToggle.addEventListener('click', toggleExportListDropdown);
  elements.textInputOkBtn.addEventListener('click', submitTextInput);
  elements.textInputCancelBtn.addEventListener('click', closeTextInput);
  elements.textInputField.addEventListener('keydown', event => {
    if (event.key === 'Enter') submitTextInput();
    if (event.key === 'Escape') closeTextInput();
  });
  elements.textInputOverlay.addEventListener('click', event => {
    if (event.target === elements.textInputOverlay) closeTextInput();
  });
  elements.favoriteTargetCancelBtn.addEventListener('click', closeFavoriteTarget);
  elements.favoriteTargetOverlay.addEventListener('click', event => {
    if (event.target === elements.favoriteTargetOverlay) closeFavoriteTarget();
  });

  ['pointerdown', 'input', 'wheel'].forEach(eventName => {
    elements.panelLeft.addEventListener(eventName, closeUsesPanel);
  });
  document.addEventListener('pointerdown', handleDocumentPointerDown);
  window.addEventListener('resize', handleResize);
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js')
    .then(reg => {
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'activated' && hadController) {
            elements.updateNotice.classList.add('open');
          }
        });
      });
    })
    .catch(err => console.warn('[SW] 登録失敗:', err));
}

function startApp() {
  bindEvents();
  if (isMobile()) showMobilePanel('left');
  loadAppVersion();
  init();
  registerServiceWorker();
}

startApp();
