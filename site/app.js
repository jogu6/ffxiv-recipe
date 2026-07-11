const DATA_CACHE_VERSION = 'ff14recipe-data-7.50-dc0bb2d1';
const DATA_FILE = `./data/Item.json?v=${encodeURIComponent(DATA_CACHE_VERSION)}`;
const TIPS_FILE = './data/tips.md';
const ABOUT_URL = 'https://jogu6.github.io/ffxiv-recipe-about/';
const LS_FAV = 'ff14_favorites';
const LS_FAV_LISTS = 'ff14_favorite_lists_v2';
const LS_FAV_COUNTS = 'ff14_favorite_item_counts_v1';
const LS_SEARCH_HISTORY = 'ff14_search_history';
const LS_VIEW_STATE = 'ff14_view_state_v1';
const SS_SKIP_RESTORE_ONCE = 'ff14_skip_restore_once';
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
const MIN_LOADING_OVERLAY_MS = 2500;
const loadingOverlayStartedAt = Date.now();
const EORZEA_TIME_MULTIPLIER = 144 / 7;
const {
  calculateCraft,
  calculateRequirements,
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
  loadingOverlay: document.getElementById('loadingOverlay'),
  popupBtn: document.getElementById('popupBtn'),
  appTitle: document.getElementById('appTitle'),
  settingsBtn: document.getElementById('settingsBtn'),
  panelLeft: document.getElementById('panelLeft'),
  panelMiddle: document.getElementById('panelMiddle'),
  panelRight: document.getElementById('panelRight'),
  resultHeader: document.querySelector('.result-header'),
  searchBox: document.getElementById('searchBox'),
  searchClearBtn: document.getElementById('searchClearBtn'),
  equipmentSearchToggle: document.getElementById('equipmentSearchToggle'),
  equipmentSearchPanel: document.getElementById('equipmentSearchPanel'),
  equipmentJobSelect: document.getElementById('equipmentJobSelect'),
  equipmentLevelInput: document.getElementById('equipmentLevelInput'),
  equipmentLevelDown5Btn: document.getElementById('equipmentLevelDown5Btn'),
  equipmentLevelDownBtn: document.getElementById('equipmentLevelDownBtn'),
  equipmentLevelUpBtn: document.getElementById('equipmentLevelUpBtn'),
  equipmentLevelUp5Btn: document.getElementById('equipmentLevelUp5Btn'),
  equipmentItemLevelSelect: document.getElementById('equipmentItemLevelSelect'),
  equipmentSlotSelect: document.getElementById('equipmentSlotSelect'),
  equipmentSearchBtn: document.getElementById('equipmentSearchBtn'),
  equipmentSearchResetBtn: document.getElementById('equipmentSearchResetBtn'),
  saveEquipmentSearchBtn: document.getElementById('saveEquipmentSearchBtn'),
  searchHistory: document.getElementById('searchHistory'),
  favBtn: document.getElementById('favBtn'),
  checkedFavoriteMaterialsActions: document.getElementById('checkedFavoriteMaterialsActions'),
  checkedFavoriteMaterialsBtn: document.getElementById('checkedFavoriteMaterialsBtn'),
  clearFavoriteMaterialChecksBtn: document.getElementById('clearFavoriteMaterialChecksBtn'),
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
  materialTreeCloseBtn: document.getElementById('materialTreeCloseBtn'),
  gatheringOverlay: document.getElementById('gatheringOverlay'),
  gatheringTitle: document.getElementById('gatheringTitle'),
  gatheringContent: document.getElementById('gatheringContent'),
  gatheringCloseBtn: document.getElementById('gatheringCloseBtn'),
  shopOverlay: document.getElementById('shopOverlay'),
  shopTitle: document.getElementById('shopTitle'),
  shopPriceHeader: document.getElementById('shopPriceHeader'),
  shopContent: document.getElementById('shopContent'),
  shopCloseBtn: document.getElementById('shopCloseBtn')
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
let equipmentSearchOpen = false;
let equipmentSearchResults = [];
let equipmentSearchIndex = new Map();
let equipmentParameterDisplayNames = new Set();
let equipmentItemLevelSourceLevel = 0;
let maxEquipmentLevel = 1;
let favoriteMaterialsRingCounts = {};
let favoriteItemCountStore = { version: 1, lists: {} };
let pendingConfirmAction = null;
let pendingTextInputAction = null;
let selectedExportListId = null;
let wasMobile = isMobile();
let reorderDrag = null;
let favoriteItemReorderEnabled = false;
let materialTreeRecipe = null;
let expandedFavoriteListActionsId = null;
let expandedFavoriteMaterialActions = false;
let favoriteMaterialsListIds = [];
let favoriteMaterialCalcMode = 'sum';
const expandedFavoriteCountRows = new Set();
let gatheringTimerIntervalId = null;
let canSaveViewState = false;
let suppressViewStateSave = false;
let purchasedIntermediateContext = '';
let purchasedIntermediateNames = new Set();
let searchInputTimerId = 0;
let searchCompositionActive = false;

const treePinMap = new Map();
const exchangeTreeState = new Map();
const materialSectionState = new Map();
const intermediateTreeState = new Map();
const CRYSTAL_ELEMENT_ORDER = ['ファイア', 'アイス', 'ウィンド', 'アース', 'ライトニング', 'ウォーター'];
const CRYSTAL_KIND_ORDER = ['シャード', 'クリスタル', 'クラスター'];
const EQUIPMENT_JOB_OPTIONS = [
  'ナイト', '剣術士', '戦士', '斧術士', '暗黒騎士', 'ガンブレイカー',
  '白魔道士', '幻術士', '学者', '占星術師', '賢者',
  'モンク', '格闘士', '竜騎士', '槍術士', '忍者', '双剣士', '侍', 'リーパー',
  'ヴァイパー', '魔獣使い', '吟遊詩人', '弓術士', '機工士', '踊り子',
  '黒魔道士', '呪術士', '召喚士', '巴術士', '赤魔道士', 'ピクトマンサー', '青魔道士',
  '木工師', '鍛冶師', '甲冑師', '彫金師', '革細工師', '裁縫師', '錬金術師', '調理師',
  '採掘師', '園芸師', '漁師'
];
const EQUIPMENT_SLOT_OPTIONS = [
  ['all', '全部'],
  ['weapon', '武器'],
  ['shield', '盾'],
  ['mainTool', '主道具'],
  ['offTool', '副道具'],
  ['head', '頭'],
  ['body', '胴'],
  ['hands', '手'],
  ['legs', '脚'],
  ['feet', '足'],
  ['ears', '耳'],
  ['neck', '首'],
  ['wrists', '腕'],
  ['ring', '指']
];
const EQUIPMENT_SLOT_ORDER = EQUIPMENT_SLOT_OPTIONS.slice(1).map(([key]) => key);
const EQUIPMENT_CATEGORY_TO_SLOT = {
  盾: 'shield',
  頭防具: 'head',
  胴防具: 'body',
  手防具: 'hands',
  脚防具: 'legs',
  足防具: 'feet',
  耳飾り: 'ears',
  首飾り: 'neck',
  腕輪: 'wrists',
  指輪: 'ring',
  格闘武器: 'weapon',
  片手剣: 'weapon',
  両手斧: 'weapon',
  両手槍: 'weapon',
  弓: 'weapon',
  両手幻具: 'weapon',
  片手幻具: 'weapon',
  両手呪具: 'weapon',
  片手呪具: 'weapon',
  魔道書: 'weapon',
  '魔道書(学者専用)': 'weapon',
  双剣: 'weapon',
  両手剣: 'weapon',
  銃: 'weapon',
  天球儀: 'weapon',
  刀: 'weapon',
  細剣: 'weapon',
  ガンブレード: 'weapon',
  投擲武器: 'weapon',
  賢具: 'weapon',
  両手鎌: 'weapon',
  二刀流武器: 'weapon',
  筆: 'weapon'
};
const EQUIPMENT_JOB_GROUPS = {
  ファイター: new Set(['剣術士','斧術士','格闘士','槍術士','双剣士','弓術士','ナイト','戦士','暗黒騎士','ガンブレイカー','モンク','竜騎士','リーパー','侍','忍者','吟遊詩人','機工士','踊り子','ヴァイパー','魔獣使い']),
  ソーサラー: new Set(['幻術士','呪術士','巴術士','白魔道士','学者','占星術師','賢者','黒魔道士','召喚士','赤魔道士','ピクトマンサー','青魔道士']),
  クラフター: new Set(['木工師','鍛冶師','甲冑師','彫金師','革細工師','裁縫師','錬金術師','調理師']),
  ギャザラー: new Set(['採掘師','園芸師','漁師'])
};
const EQUIPMENT_ROLE_JOBS = {
  tank: new Set(['剣術士','斧術士','ナイト','戦士','暗黒騎士','ガンブレイカー']),
  healer: new Set(['幻術士','白魔道士','学者','占星術師','賢者']),
  striker_slayer: new Set(['格闘士','槍術士','モンク','竜騎士','リーパー','侍','魔獣使い']),
  scout_ranger: new Set(['双剣士','弓術士','忍者','吟遊詩人','機工士','踊り子','ヴァイパー']),
  caster: new Set(['呪術士','巴術士','黒魔道士','召喚士','赤魔道士','ピクトマンサー','青魔道士']),
  fighter: null,
  sorcerer: null
};
const CASTER_SHIELD_JOBS = new Set(['幻術士', '白魔道士', '呪術士', '黒魔道士']);
const ONE_HANDED_CASTER_WEAPON_CATEGORIES = new Set(['片手幻具', '片手呪具']);
EQUIPMENT_ROLE_JOBS.fighter = EQUIPMENT_JOB_GROUPS.ファイター;
EQUIPMENT_ROLE_JOBS.sorcerer = EQUIPMENT_JOB_GROUPS.ソーサラー;
const CRAFT_JOB_ABBREVIATIONS = {
  木工師: '木工', 鍛冶師: '鍛冶', 甲冑師: '甲冑', 彫金師: '彫金',
  革細工師: '革', 裁縫師: '裁縫', 錬金術師: '錬金', 調理師: '調理'
};
const EQUIPMENT_JOB_ABBREVIATIONS = Object.fromEntries(EQUIPMENT_JOB_OPTIONS.map(job => [job, job.replace(/士$|師$|道士$/u, '').slice(0, 1)]));
EQUIPMENT_JOB_ABBREVIATIONS['吟遊詩人'] = '詩';
const EQUIPMENT_JOB_ORDER = new Map(EQUIPMENT_JOB_OPTIONS.map((job, index) => [job, index]));
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

function consumeSkipRestoreOnce() {
  try {
    if (sessionStorage.getItem(SS_SKIP_RESTORE_ONCE) !== '1') return false;
    sessionStorage.removeItem(SS_SKIP_RESTORE_ONCE);
    return true;
  } catch {
    return false;
  }
}

function markSkipRestoreOnce() {
  try {
    sessionStorage.setItem(SS_SKIP_RESTORE_ONCE, '1');
  } catch {
    // ignore
  }
}

function currentMobilePanel() {
  if (!isMobile()) return '';
  return elements.mobileBackBtn.dataset.panel || 'left';
}

function saveViewState() {
  if (!canSaveViewState || suppressViewStateSave) return;
  writeStoredJson(LS_VIEW_STATE, {
    v: 1,
    dataVersion: DATA_CACHE_VERSION,
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
      listIds: favoriteMaterialsListIds,
      ringCounts: favoriteMaterialsRingCounts
    },
    materials: {
      sections: Object.fromEntries(materialSectionState),
      purchasedContext: purchasedIntermediateContext,
      purchasedNames: [...purchasedIntermediateNames]
    },
    equipmentSearch: {
      open: equipmentSearchOpen,
      job: customSelectValue(elements.equipmentJobSelect),
      equipLevel: elements.equipmentLevelInput.value,
      itemLevel: customSelectValue(elements.equipmentItemLevelSelect),
      slot: customSelectValue(elements.equipmentSlotSelect),
      results: listMode === 'equipment' ? equipmentSearchResults : [],
      parameterNames: listMode === 'equipment' ? [...equipmentParameterDisplayNames] : []
    }
  });
}

function clearViewState() {
  removeStoredItem(LS_VIEW_STATE);
  purchasedIntermediateContext = '';
  purchasedIntermediateNames.clear();
}

function restoreViewState() {
  const state = readStoredJson(LS_VIEW_STATE, null);
  if (!state || state.v !== 1) return false;
  if (state.dataVersion !== DATA_CACHE_VERSION) {
    clearViewState();
    return false;
  }

  suppressViewStateSave = true;
  try {
    const search = typeof state.input?.search === 'string' ? state.input.search : '';
    const count = typeof state.input?.count === 'string' ? state.input.count : '1';
    const activeInput = ['searchBox', 'countInput'].includes(state.input?.active)
      ? state.input.active
      : '';
    const favoriteList = findFavoriteList(state.selected?.favoriteListId);
    const restoredFavoriteMaterialIds = Array.isArray(state.favoriteMaterials?.listIds)
      ? state.favoriteMaterials.listIds.filter(id => {
        const list = findFavoriteList(id);
        return list && !isRecentList(list);
      })
      : [];
    const recipe = recipes[state.selected?.recipe] ? state.selected.recipe : '';
    const usesItem = usedIn[state.selected?.usesItem] ? state.selected.usesItem : '';
    const equipmentState = state.equipmentSearch || {};
    setCustomSelectValue(elements.equipmentJobSelect, equipmentState.job || '');
    updateEquipmentSlotOptions(equipmentState.slot || 'all');
    elements.equipmentLevelInput.value = String(equipmentState.equipLevel || maxEquipmentLevel);
    updateEquipmentItemLevelOptions(equipmentState.itemLevel || '');
    equipmentSearchResults = Array.isArray(equipmentState.results)
      ? equipmentState.results.filter(name => itemMaster[name] && isEquipmentSearchTarget(itemMaster[name]))
      : [];
    equipmentParameterDisplayNames = new Set(
      Array.isArray(equipmentState.parameterNames)
        ? equipmentState.parameterNames.filter(name => equipmentSearchResults.includes(name))
        : []
    );
    setEquipmentSearchOpen(Boolean(equipmentState.open));

    elements.searchBox.value = equipmentState.open ? '' : search;
    elements.searchClearBtn.classList.toggle('visible', elements.searchBox.value.trim() !== '');
    favoriteStore.selectedListId = favoriteList?.id || null;

    if (state.view?.listMode === 'equipment' && equipmentSearchResults.length) listMode = 'equipment';
    else if (state.view?.listMode === 'fav' && favoriteList) listMode = 'fav';
    else listMode = search.trim() ? 'search' : 'none';

    selectedRecipe = recipe || null;
    selectedUsesItem = usesItem || null;
    elements.countInput.value = count || '1';
    readRequestedCount(elements.countInput);
    const restoreFavoriteMaterials = state.view?.sourceMode === 'favorite-materials'
      && (restoredFavoriteMaterialIds.length >= 2 || (favoriteList && !isRecentList(favoriteList)));
    favoriteMaterialsListIds = restoreFavoriteMaterials && restoredFavoriteMaterialIds.length >= 2
      ? restoredFavoriteMaterialIds
      : [];
    setResultSourceMode(restoreFavoriteMaterials ? 'favorite-materials' : 'recipe');
    favoriteMaterialsRingCounts = normalizeFavoriteMaterialsRingCounts(state.favoriteMaterials?.ringCounts);
    materialSectionState.clear();
    Object.entries(normalizeMaterialSectionState(state.materials?.sections))
      .forEach(([key, collapsed]) => materialSectionState.set(key, collapsed));
    purchasedIntermediateContext = typeof state.materials?.purchasedContext === 'string'
      ? state.materials.purchasedContext
      : '';
    purchasedIntermediateNames = new Set(
      Array.isArray(state.materials?.purchasedNames)
        ? state.materials.purchasedNames.filter(name => typeof name === 'string')
        : []
    );
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
      .filter(([, count]) => count === 0 || count === 2)
  );
}

function normalizeMaterialSectionState(value) {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, collapsed]) => typeof key === 'string' && typeof collapsed === 'boolean')
  );
}

function setCollapsedAnimated(element, collapsed) {
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion || !element.isConnected) {
    element.classList.toggle('collapsed', collapsed);
    return;
  }

  const startHeight = element.getBoundingClientRect().height;
  element.classList.add('collapsible-animating');
  element.style.height = `${startHeight}px`;
  element.getBoundingClientRect();

  if (collapsed) {
    element.classList.add('collapsed');
    element.style.height = '0px';
  } else {
    element.classList.remove('collapsed');
    const endHeight = element.scrollHeight;
    element.style.height = '0px';
    element.getBoundingClientRect();
    element.style.height = `${endHeight}px`;
  }

  const cleanup = event => {
    if (event.propertyName !== 'height') return;
    element.classList.remove('collapsible-animating');
    element.style.height = '';
    element.removeEventListener('transitionend', cleanup);
  };
  element.addEventListener('transitionend', cleanup);
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
  updateCheckedFavoriteMaterialsButton();
}

function getFavoriteListRecipeNames(list = getDisplayedFavoriteList()) {
  return list ? list.itemIds.map(itemNameForId).filter(name => name && recipes[name]) : [];
}

function getMaterialSelectedFavoriteLists() {
  return favoriteStore.lists.filter(list => !isRecentList(list) && list.materialSelected);
}

function hasMaterialSelectedFavoriteLists() {
  return getMaterialSelectedFavoriteLists().length > 0;
}

function clearMaterialSelectedFavoriteLists() {
  let changed = false;
  favoriteStore.lists.forEach(list => {
    if (!isRecentList(list) && list.materialSelected) {
      list.materialSelected = false;
      changed = true;
    }
  });
  if (!changed) return false;
  favoriteMaterialsListIds = [];
  saveFavorites();
  renderFavoriteLists();
  updateCheckedFavoriteMaterialsButton();
  return true;
}

function updateCheckedFavoriteMaterialsButton() {
  if (!elements.checkedFavoriteMaterialsActions) return;
  elements.checkedFavoriteMaterialsActions.classList.toggle('visible', hasMaterialSelectedFavoriteLists());
  if (elements.favoriteLists?.classList.contains('open')) updateFavoriteListsMaxHeight();
}

function getActiveFavoriteMaterialLists() {
  if (favoriteMaterialsListIds.length >= 2) {
    const selected = favoriteMaterialsListIds
      .map(findFavoriteList)
      .filter(list => list && !isRecentList(list));
    if (selected.length >= 2) return selected;
  }
  const displayed = getDisplayedFavoriteList();
  return displayed ? [displayed] : [];
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
    itemIds: normalizeItemIds(itemIds),
    materialSelected: false
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
        itemIds: normalizeItemIds(list.itemIds),
        materialSelected: Boolean(list.materialSelected) && !isRecentList(list)
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
  loadFavoriteItemCountStore();
}

function saveFavorites() {
  writeStoredJson(LS_FAV_LISTS, favoriteStore);
}

function loadFavoriteItemCountStore() {
  const stored = readStoredJson(LS_FAV_COUNTS, null);
  const lists = {};
  Object.entries(stored?.lists || {}).forEach(([listId, state]) => {
    const counts = {};
    Object.entries(state?.counts || {}).forEach(([itemId, value]) => {
      const count = Number(value);
      if (Number.isInteger(count) && count >= 0 && count <= REQUEST_COUNT_MAX) counts[itemId] = count;
    });
    const anyOneTargets = {};
    Object.entries(state?.anyOneTargets || {}).forEach(([itemId, value]) => {
      if (typeof value === 'boolean') anyOneTargets[itemId] = value;
    });
    lists[listId] = { enabled: false, counts, anyOneTargets };
  });
  favoriteItemCountStore = { version: 1, lists };
  saveFavoriteItemCountStore();
}

function saveFavoriteItemCountStore() {
  const lists = Object.fromEntries(
    Object.entries(favoriteItemCountStore.lists || {}).map(([listId, state]) => [
      listId,
      { counts: state.counts || {}, anyOneTargets: state.anyOneTargets || {} }
    ])
  );
  writeStoredJson(LS_FAV_COUNTS, { version: 1, lists });
}

function getFavoriteCountState(list = getDisplayedFavoriteList()) {
  if (!list || isRecentList(list)) return { enabled: false, counts: {} };
  if (!favoriteItemCountStore.lists[list.id]) {
    favoriteItemCountStore.lists[list.id] = { enabled: false, counts: {}, anyOneTargets: {} };
  }
  return favoriteItemCountStore.lists[list.id];
}

function favoriteCountEnabled(list = getDisplayedFavoriteList()) {
  return Boolean(getFavoriteCountState(list).enabled);
}

function favoriteItemCount(itemId, list = getDisplayedFavoriteList()) {
  const state = getFavoriteCountState(list);
  const value = state.counts[itemId];
  return Number.isInteger(value) ? value : 1;
}

function setFavoriteItemCount(itemId, value) {
  const state = getFavoriteCountState();
  state.counts[itemId] = Math.max(0, Math.min(REQUEST_COUNT_MAX, Number.isInteger(value) ? value : 1));
  saveFavoriteItemCountStore();
}

function favoriteAnyOneTarget(itemId, list = getDisplayedFavoriteList()) {
  const state = getFavoriteCountState(list);
  if (typeof state.anyOneTargets?.[itemId] === 'boolean') return state.anyOneTargets[itemId];
  return favoriteItemCount(itemId, list) > 0;
}

function setFavoriteAnyOneTarget(itemId, checked) {
  const state = getFavoriteCountState();
  if (!state.anyOneTargets) state.anyOneTargets = {};
  state.anyOneTargets[itemId] = Boolean(checked);
  saveFavoriteItemCountStore();
}

function favoriteCountsChanged(list = getDisplayedFavoriteList()) {
  const state = getFavoriteCountState(list);
  return state.enabled && Object.values(state.counts).some(value => value !== 1);
}

function resetFavoriteOperationModes() {
  favoriteItemReorderEnabled = false;
  expandedFavoriteMaterialActions = false;
  favoriteMaterialCalcMode = 'sum';
  expandedFavoriteCountRows.clear();
  Object.values(favoriteItemCountStore.lists || {}).forEach(state => {
    state.enabled = false;
  });
}

function favoriteAnyOneMode() {
  return favoriteMaterialCalcMode === 'any-one' && favoriteCountEnabled();
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

function equipmentSlotForItem(master) {
  const category = master?.uiCategoryName || '';
  if (EQUIPMENT_CATEGORY_TO_SLOT[category]) return EQUIPMENT_CATEGORY_TO_SLOT[category];
  if (category.endsWith('道具(主道具)')) return 'mainTool';
  if (category.endsWith('道具(副道具)')) return 'offTool';
  return '';
}

function isEquipmentSearchTarget(master) {
  return Boolean(master?.equipmentInfo && equipmentSlotForItem(master));
}

function equipmentItemLevel(master) {
  return toNumeric(master?.equipmentInfo?.itemLevel, 0);
}

function equipmentEquipLevel(master) {
  return toNumeric(master?.equipmentInfo?.equipLevel, 0);
}

function equipmentJobs(master) {
  return Array.isArray(master?.equipmentInfo?.jobs) ? master.equipmentInfo.jobs : [];
}

function equipmentMatchesJob(master, job) {
  const jobs = equipmentJobs(master);
  if (job === '巴術士' && jobs.includes(job)) {
    const stats = master?.equipmentInfo?.stats || {};
    if (toNumeric(stats.INT) < toNumeric(stats.MND)) return false;
  }
  if (jobs.includes(job)) return true;
  if (jobs.includes('クラフター') && EQUIPMENT_JOB_GROUPS.クラフター.has(job)) return true;
  if (jobs.includes('ギャザラー') && EQUIPMENT_JOB_GROUPS.ギャザラー.has(job)) return true;
  if (!jobs.some(group => ['全クラス', 'ファイター', 'ソーサラー'].includes(group))) return false;
  const recommendedRole = master?.equipmentInfo?.recommendedRole || '';
  if (!recommendedRole) return false;
  if (!EQUIPMENT_ROLE_JOBS[recommendedRole]?.has(job)) return false;
  const broadJobMatches = jobs.includes('全クラス')
    || (jobs.includes('ファイター') && EQUIPMENT_JOB_GROUPS.ファイター.has(job))
    || (jobs.includes('ソーサラー') && EQUIPMENT_JOB_GROUPS.ソーサラー.has(job));
  if (!broadJobMatches) return false;
  if (recommendedRole !== 'sorcerer') return true;
  const stats = master?.equipmentInfo?.stats || {};
  const intValue = toNumeric(stats.INT);
  const mindValue = toNumeric(stats.MND);
  if (job === '巴術士' || EQUIPMENT_ROLE_JOBS.caster.has(job)) return intValue >= mindValue;
  if (EQUIPMENT_ROLE_JOBS.healer.has(job)) return mindValue >= intValue;
  return false;
}

function sortEquipmentJobs(jobs) {
  return [...jobs].sort((a, b) =>
    (EQUIPMENT_JOB_ORDER.get(a) ?? Number.MAX_SAFE_INTEGER)
    - (EQUIPMENT_JOB_ORDER.get(b) ?? Number.MAX_SAFE_INTEGER)
  );
}

function equipmentSortKey(name) {
  const master = itemMaster[name] || {};
  return [
    EQUIPMENT_SLOT_ORDER.indexOf(equipmentSlotForItem(master)),
    -equipmentEquipLevel(master),
    -equipmentItemLevel(master),
    name
  ];
}

function sortEquipmentNames(names) {
  return [...names].sort((a, b) => {
    const ak = equipmentSortKey(a);
    const bk = equipmentSortKey(b);
    for (let i = 0; i < ak.length; i += 1) {
      if (ak[i] < bk[i]) return -1;
      if (ak[i] > bk[i]) return 1;
    }
    return 0;
  });
}

function customSelectValue(select) {
  return select?.dataset.value || '';
}

function closeCustomSelect(select) {
  select?.classList.remove('open');
  select?.querySelector('.custom-select-toggle')?.setAttribute('aria-expanded', 'false');
}

function closeAllCustomSelects(except = null) {
  document.querySelectorAll('.custom-select.open').forEach(select => {
    if (select !== except) closeCustomSelect(select);
  });
}

function positionCustomSelectOptions(select) {
  const options = select.querySelector('.custom-select-options');
  if (!options) return;
  const rect = select.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const maxHeight = Math.min(320, Math.max(120, viewportHeight - 20));
  options.style.width = `${Math.max(rect.width, 120)}px`;
  options.style.maxHeight = `${maxHeight}px`;
  const desiredHeight = Math.min(options.scrollHeight, maxHeight);
  const below = viewportHeight - rect.bottom - 8;
  const top = below >= desiredHeight || below >= rect.top
    ? rect.bottom + 3
    : Math.max(8, rect.top - desiredHeight - 3);
  options.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - Math.max(rect.width, 120) - 8))}px`;
  options.style.top = `${top}px`;
}

function openCustomSelect(select) {
  const opening = !select.classList.contains('open');
  closeAllCustomSelects(select);
  select.classList.toggle('open', opening);
  select.querySelector('.custom-select-toggle')?.setAttribute('aria-expanded', String(opening));
  if (opening) requestAnimationFrame(() => positionCustomSelectOptions(select));
}

function setCustomSelectValue(select, value, { notify = false } = {}) {
  if (!select) return false;
  const normalized = String(value ?? '');
  const option = [...select.querySelectorAll('.custom-select-option')]
    .find(row => row.dataset.value === normalized);
  if (!option) return false;
  select.dataset.value = normalized;
  select.querySelector('.custom-select-toggle').textContent = option.textContent;
  select.querySelectorAll('.custom-select-option').forEach(row => {
    const selected = row === option;
    row.classList.toggle('selected', selected);
    row.setAttribute('aria-selected', String(selected));
  });
  if (notify) select.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function setCustomSelectOptions(select, entries, preferred = '') {
  const normalizedEntries = entries.map(entry => Array.isArray(entry) ? entry : [entry, entry]);
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'custom-select-toggle';
  toggle.setAttribute('aria-haspopup', 'listbox');
  toggle.setAttribute('aria-expanded', 'false');
  const options = document.createElement('div');
  options.className = 'custom-select-options';
  options.setAttribute('role', 'listbox');
  normalizedEntries.forEach(([value, label]) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'custom-select-option';
    option.dataset.value = String(value);
    option.textContent = String(label);
    option.setAttribute('role', 'option');
    option.addEventListener('click', event => {
      event.stopPropagation();
      setCustomSelectValue(select, value, { notify: true });
      closeCustomSelect(select);
    });
    option.addEventListener('keydown', event => {
      const rows = [...options.querySelectorAll('.custom-select-option')];
      const index = rows.indexOf(option);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        rows[(index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus();
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        option.click();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeCustomSelect(select);
        toggle.focus();
      }
    });
    options.appendChild(option);
  });
  toggle.addEventListener('click', () => openCustomSelect(select));
  toggle.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    openCustomSelect(select);
    select.querySelector('.custom-select-option.selected')?.focus();
  });
  select.dataset.value = '';
  select.replaceChildren(toggle, options);
  const fallback = normalizedEntries[0]?.[0] ?? '';
  setCustomSelectValue(select, normalizedEntries.some(([value]) => String(value) === String(preferred)) ? preferred : fallback);
  toggle.disabled = normalizedEntries.length === 0;
}

function buildEquipmentSearchIndexes() {
  equipmentSearchIndex = new Map(EQUIPMENT_JOB_OPTIONS.map(job => [job, {
    levels: new Map(),
    specialSlots: new Set()
  }]));
  maxEquipmentLevel = 1;
  Object.entries(itemMaster).forEach(([name, master]) => {
    if (!isEquipmentSearchTarget(master)) return;
    const equipLevel = equipmentEquipLevel(master);
    const itemLevel = equipmentItemLevel(master);
    const slot = equipmentSlotForItem(master);
    if (equipLevel <= 0 || itemLevel <= 0) return;
    maxEquipmentLevel = Math.max(maxEquipmentLevel, equipLevel);
    EQUIPMENT_JOB_OPTIONS.forEach(job => {
      if (!equipmentMatchesJob(master, job)) return;
      const jobIndex = equipmentSearchIndex.get(job);
      if (['shield', 'mainTool', 'offTool'].includes(slot)) jobIndex.specialSlots.add(slot);
      if (!jobIndex.levels.has(equipLevel)) {
        jobIndex.levels.set(equipLevel, { itemLevels: new Set(), slots: new Map() });
      }
      const levelIndex = jobIndex.levels.get(equipLevel);
      levelIndex.itemLevels.add(itemLevel);
      if (!levelIndex.slots.has(slot)) levelIndex.slots.set(slot, new Map());
      const slotIndex = levelIndex.slots.get(slot);
      if (!slotIndex.has(itemLevel)) slotIndex.set(itemLevel, []);
      slotIndex.get(itemLevel).push(name);
    });
  });
}

function updateEquipmentSlotOptions(preferred = customSelectValue(elements.equipmentSlotSelect)) {
  const specialSlots = equipmentSearchIndex.get(customSelectValue(elements.equipmentJobSelect))?.specialSlots || new Set();
  const options = EQUIPMENT_SLOT_OPTIONS.filter(([slot]) =>
    !['shield', 'mainTool', 'offTool'].includes(slot) || specialSlots.has(slot)
  );
  setCustomSelectOptions(elements.equipmentSlotSelect, options, preferred);
}

function setupEquipmentSearchControls() {
  if (!elements.equipmentSearchToggle) return;
  setCustomSelectOptions(elements.equipmentJobSelect, [['', '---'], ...EQUIPMENT_JOB_OPTIONS.map(job => [job, job])], '');
  updateEquipmentSlotOptions('all');
  elements.equipmentLevelInput.min = '1';
  elements.equipmentLevelInput.max = String(maxEquipmentLevel);
  elements.equipmentLevelInput.value = String(maxEquipmentLevel);
  updateEquipmentItemLevelOptions('');
  updateEquipmentSearchButtons();
}

function equipmentLevelsForJob(job) {
  return [...(equipmentSearchIndex.get(job)?.levels.keys() || [])].sort((a, b) => b - a);
}

function normalizeEquipmentLevelForJob() {
  const levels = equipmentLevelsForJob(customSelectValue(elements.equipmentJobSelect));
  if (levels.length === 0) return;
  const current = equipmentLevelInputValue();
  if (levels.includes(current)) return;
  elements.equipmentLevelInput.value = String(levels.find(level => level < current) ?? levels[0]);
}

function equipmentLevelValue() {
  return Math.max(1, Math.min(maxEquipmentLevel, toNumeric(elements.equipmentLevelInput.value, maxEquipmentLevel)));
}

function equipmentLevelInputValue() {
  const value = elements.equipmentLevelInput.value.trim();
  if (value === '') return 0;
  const number = parseInt(value, 10);
  return Number.isFinite(number) ? number : 0;
}

function selectedEquipmentItemLevel() {
  return toNumeric(customSelectValue(elements.equipmentItemLevelSelect), 0);
}

function updateEquipmentItemLevelOptions(preferredItemLevel = selectedEquipmentItemLevel()) {
  const rawLevel = equipmentLevelInputValue();
  if (rawLevel <= 0) {
    equipmentItemLevelSourceLevel = 0;
    setCustomSelectOptions(elements.equipmentItemLevelSelect, []);
    updateEquipmentSearchButtons();
    saveViewState();
    return;
  }
  const level = Math.max(1, Math.min(maxEquipmentLevel, rawLevel));
  const job = customSelectValue(elements.equipmentJobSelect);
  let sourceLevel = level;
  let itemLevels = [];
  while (sourceLevel >= 1) {
    itemLevels = [...(equipmentSearchIndex.get(job)?.levels.get(sourceLevel)?.itemLevels || [])]
      .sort((a, b) => b - a);
    if (itemLevels.length > 0) break;
    sourceLevel -= 1;
  }
  equipmentItemLevelSourceLevel = itemLevels.length > 0 ? sourceLevel : 0;
  setCustomSelectOptions(elements.equipmentItemLevelSelect, itemLevels.map(String), String(preferredItemLevel));
  updateEquipmentSearchButtons();
  saveViewState();
}

function commitEquipmentLevelInput() {
  elements.equipmentLevelInput.value = String(equipmentLevelValue());
  updateEquipmentItemLevelOptions();
}

function updateEquipmentSearchButtons() {
  const rawLevel = equipmentLevelInputValue();
  const ready = Boolean(
    customSelectValue(elements.equipmentJobSelect)
    && rawLevel >= 1
    && rawLevel <= maxEquipmentLevel
    && selectedEquipmentItemLevel()
    && customSelectValue(elements.equipmentSlotSelect)
  );
  elements.equipmentSearchBtn.disabled = !ready;
  elements.saveEquipmentSearchBtn.disabled = equipmentSearchResults.length === 0;
}

function setEquipmentSearchOpen(open) {
  if (!elements.equipmentSearchToggle) return;
  closeAllCustomSelects();
  equipmentSearchOpen = open;
  if (open) {
    elements.searchBox.value = '';
    elements.searchClearBtn.classList.remove('visible');
    closeSearchHistory();
    closeFavoriteLists();
  }
  elements.searchBox.disabled = open;
  elements.equipmentSearchPanel.classList.toggle('open', open);
  elements.equipmentSearchToggle.classList.toggle('active', open);
  elements.equipmentSearchToggle.textContent = open ? '▲' : '▼';
  elements.equipmentSearchToggle.setAttribute('aria-expanded', String(open));
  elements.panelLeft.querySelector('.panel-left-header')?.classList.toggle('equipment-search-active', open);
  saveViewState();
}

function resetEquipmentSearch() {
  elements.searchBox.value = '';
  elements.searchClearBtn.classList.remove('visible');
  setCustomSelectValue(elements.equipmentJobSelect, '');
  elements.equipmentLevelInput.value = String(maxEquipmentLevel);
  updateEquipmentSlotOptions('all');
  updateEquipmentItemLevelOptions('');
  equipmentSearchResults = [];
  equipmentParameterDisplayNames.clear();
  listMode = 'none';
  selectedRecipe = null;
  closeUsesPanel();
  resetRightPanelViewState();
  renderList();
  renderResultView();
  updateFavoriteButtonState();
  updateEquipmentSearchButtons();
  saveViewState();
}

function findEquipmentMatchesAtLevel(level, itemLevel, job, slot) {
  const slotIndex = equipmentSearchIndex.get(job)?.levels.get(level)?.slots.get(slot);
  if (!slotIndex) return [];
  if (itemLevel && level === equipmentItemLevelSourceLevel) return [...(slotIndex.get(itemLevel) || [])];
  return [...slotIndex.values()].flat();
}

function equipmentPerformanceScore(master, slot) {
  const performance = master?.equipmentInfo?.performance || {};
  if (slot === 'weapon') {
    return Math.max(toNumeric(performance.physicalDamage), toNumeric(performance.magicalDamage));
  }
  return toNumeric(performance.physicalDefense);
}

function equipmentSpecialtyScore(master) {
  const stats = master?.equipmentInfo?.stats || {};
  return Math.max(toNumeric(stats['不屈']), toNumeric(stats['信仰']));
}

function runEquipmentSearch() {
    const job = customSelectValue(elements.equipmentJobSelect);
    const requestedLevel = equipmentLevelValue();
    const requestedItemLevel = selectedEquipmentItemLevel();
    const selectedSlot = customSelectValue(elements.equipmentSlotSelect);
    const slots = selectedSlot === 'all' ? EQUIPMENT_SLOT_ORDER : [selectedSlot];
    const results = [];
    let selectedWeapons = [];
    equipmentParameterDisplayNames.clear();

    slots.forEach(slot => {
      if (
        slot === 'shield'
        && selectedSlot === 'all'
        && CASTER_SHIELD_JOBS.has(job)
        && selectedWeapons.length > 0
        && !selectedWeapons.some(name => ONE_HANDED_CASTER_WEAPON_CATEGORIES.has(itemMaster[name]?.uiCategoryName))
      ) return;
      for (let level = requestedLevel; level >= 1; level -= 1) {
        const matches = findEquipmentMatchesAtLevel(level, requestedItemLevel, job, slot);
        if (matches.length === 0) continue;
        const maxItemLevel = Math.max(...matches.map(name => equipmentItemLevel(itemMaster[name])));
        const itemLevelMatches = matches.filter(name => equipmentItemLevel(itemMaster[name]) === maxItemLevel);
        const maxPerformance = Math.max(...itemLevelMatches.map(name => equipmentPerformanceScore(itemMaster[name], slot)));
        const performanceMatches = itemLevelMatches.filter(name =>
          equipmentPerformanceScore(itemMaster[name], slot) === maxPerformance
        );
        const maxSpecialty = Math.max(...performanceMatches.map(name => equipmentSpecialtyScore(itemMaster[name])));
        const specialtyMatches = maxSpecialty > 0
          ? performanceMatches.filter(name => equipmentSpecialtyScore(itemMaster[name]) === maxSpecialty)
          : performanceMatches;
        results.push(...specialtyMatches);
        if (slot === 'weapon') selectedWeapons = specialtyMatches;
        if (specialtyMatches.length > 1) {
          specialtyMatches.forEach(name => equipmentParameterDisplayNames.add(name));
        }
        break;
      }
    });

    equipmentSearchResults = sortEquipmentNames([...new Set(results)]);
    listMode = 'equipment';
    favoriteStore.selectedListId = null;
    selectedRecipe = null;
    closeUsesPanel();
    resetRightPanelViewState();
    elements.searchClearBtn.classList.remove('visible');
    closeSearchHistory();
    renderFavoriteLists();
    updateFavoriteButtonState();
    renderList();
    renderResultView();
    updateEquipmentSearchButtons();
}

function defaultEquipmentFavoriteListName() {
  return `${customSelectValue(elements.equipmentJobSelect)}:装備Lv${equipmentLevelValue()}:IL${selectedEquipmentItemLevel()}`;
}

function saveEquipmentSearchAsFavorite() {
  if (equipmentSearchResults.length === 0) return;
  const itemIds = equipmentSearchResults.map(itemIdForName).filter(Boolean);
  showTextInput('お気に入りリスト名', defaultEquipmentFavoriteListName(), value => {
    const list = createFavoriteList(value, itemIds);
    setEquipmentSearchOpen(false);
    selectFavoriteList(list.id);
  });
}

function showConfirm(msg, onYes) {
  elements.confirmMsg.classList.remove('markdown-content');
  elements.confirmMsg.textContent = msg;
  pendingConfirmAction = onYes;
  elements.confirmOverlay.classList.remove('info');
  elements.confirmYes.textContent = 'はい';
  elements.confirmNo.textContent = 'いいえ';
  elements.confirmYes.classList.remove('hidden');
  elements.confirmOverlay.classList.add('open');
}

function showConfirmContent(content, onYes) {
  elements.confirmMsg.classList.remove('markdown-content');
  elements.confirmMsg.replaceChildren(content);
  pendingConfirmAction = onYes;
  elements.confirmOverlay.classList.remove('info');
  elements.confirmYes.textContent = 'はい';
  elements.confirmNo.textContent = 'いいえ';
  elements.confirmYes.classList.remove('hidden');
  elements.confirmOverlay.classList.add('open');
}

function showInfo(msg, { markdown = false } = {}) {
  elements.confirmMsg.classList.toggle('markdown-content', markdown);
  if (markdown) elements.confirmMsg.innerHTML = renderMarkdown(msg);
  else elements.confirmMsg.textContent = msg;
  pendingConfirmAction = null;
  elements.confirmOverlay.classList.add('info');
  elements.confirmYes.classList.add('hidden');
  elements.confirmNo.textContent = '閉じる';
  elements.confirmOverlay.classList.add('open');
}

function closeConfirm() {
  elements.confirmOverlay.classList.remove('open');
  elements.confirmOverlay.classList.remove('info');
  elements.confirmMsg.textContent = '';
  elements.confirmMsg.classList.remove('markdown-content');
  elements.confirmYes.classList.remove('hidden');
  elements.confirmYes.textContent = 'はい';
  elements.confirmNo.textContent = 'いいえ';
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
  if (searchInputTimerId) {
    clearTimeout(searchInputTimerId);
    searchInputTimerId = 0;
  }
  const q = elements.searchBox.value.trim();
  equipmentSearchResults = [];
  resetFavoriteOperationModes();
  leaveFavoriteMaterialsMode();
  elements.searchClearBtn.classList.toggle('visible', q !== '');
  closeFavoriteLists();
  listMode = q === '' ? 'none' : 'search';
  updateFavoriteButtonState();
  renderList();
  renderResultView();
  renderSearchHistory();
}

function scheduleSearchFromInput() {
  if (searchCompositionActive) return;
  if (searchInputTimerId) clearTimeout(searchInputTimerId);
  searchInputTimerId = 0;
  const q = elements.searchBox.value.trim();
  elements.searchClearBtn.classList.toggle('visible', q !== '');
  if (q === '') {
    onSearch();
    return;
  }
  if ([...q].length < 3) {
    if (listMode === 'search') {
      listMode = 'none';
      renderList();
      renderResultView();
    }
    return;
  }
  searchInputTimerId = window.setTimeout(onSearch, 200);
}

function commitShortSearch() {
  const q = elements.searchBox.value.trim();
  if (q && [...q].length < 3) onSearch();
}

function clearSearch() {
  if (searchInputTimerId) clearTimeout(searchInputTimerId);
  searchInputTimerId = 0;
  elements.searchBox.value = '';
  elements.searchClearBtn.classList.remove('visible');
  equipmentSearchResults = [];
  listMode = 'none';
  closeSearchHistory();
  updateFavoriteButtonState();
  renderList();
  renderResultView();
  elements.searchBox.focus();
}

function toggleFav() {
  elements.searchBox.value = '';
  elements.searchClearBtn.classList.remove('visible');
  closeSearchHistory();
  renderFavoriteLists();
  updateFavoriteListsMaxHeight();
  elements.favoriteLists.classList.toggle('open');
}

function closeFavoriteLists() {
  elements.favoriteLists.classList.remove('open');
  expandedFavoriteListActionsId = null;
}

function updateFavoriteListsMaxHeight() {
  const list = elements.favoriteLists;
  if (!list) return;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const listRect = list.getBoundingClientRect();
  const actions = elements.checkedFavoriteMaterialsActions;
  let listTop = listRect.top;
  if (actions?.classList.contains('visible')) {
    const actionsRect = actions.getBoundingClientRect();
    const actionsStyle = window.getComputedStyle(actions);
    const targetActionsHeight = Math.min(
      actions.scrollHeight,
      Number.parseFloat(actionsStyle.maxHeight) || actions.scrollHeight
    );
    listTop += Math.max(0, targetActionsHeight - actionsRect.height);
  }
  const bottomPadding = 12;
  const availableHeight = Math.max(0, viewportHeight - listTop - bottomPadding);
  const maxHeight = Math.floor(Math.min(viewportHeight * 0.7, availableHeight));
  list.style.setProperty('--favorite-lists-max-height', `${maxHeight}px`);
}

function selectFavoriteList(listId) {
  const changedList = getDisplayedFavoriteList()?.id !== listId;
  resetFavoriteOperationModes();
  leaveFavoriteMaterialsMode();
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
    favoriteMaterialsListIds = favoriteMaterialsListIds.filter(id => id !== listId);
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
  const countState = getFavoriteCountState(list);
  const recipeNames = getFavoriteListRecipeNames(list);
  const recipeCount = recipeNames.length;
  const activeCount = recipeNames
    .filter(name => {
      const itemId = itemIdForName(name);
      if (!countState.enabled) return true;
      return favoriteAnyOneMode()
        ? favoriteAnyOneTarget(itemId, list)
        : favoriteItemCount(itemId, list) > 0;
    })
    .length;

  const li = document.createElement('li');
  li.className = 'favorite-materials-row';
  const materialButton = document.createElement('button');
  materialButton.className = 'favorite-list-action favorite-list-action-compact';
  materialButton.classList.toggle('active', resultSourceMode === 'favorite-materials');
  materialButton.type = 'button';
  materialButton.textContent = countState.enabled && activeCount < recipeCount
    ? `素材リスト(${activeCount}/${recipeCount})`
    : '素材リスト';
  materialButton.addEventListener('click', event => {
    event.stopPropagation();
    requestFavoriteMaterialsMode();
  });

  const curtain = document.createElement('div');
  curtain.className = 'favorite-material-curtain';
  curtain.classList.toggle('expanded', expandedFavoriteMaterialActions);
  const curtainToggle = document.createElement('button');
  curtainToggle.className = 'favorite-material-curtain-toggle';
  curtainToggle.type = 'button';
  curtainToggle.textContent = expandedFavoriteMaterialActions ? '▲' : '▼';
  curtainToggle.setAttribute('aria-expanded', String(expandedFavoriteMaterialActions));
  curtainToggle.addEventListener('click', event => {
    event.stopPropagation();
    expandedFavoriteMaterialActions = !expandedFavoriteMaterialActions;
    curtain.classList.toggle('expanded', expandedFavoriteMaterialActions);
    curtainToggle.textContent = expandedFavoriteMaterialActions ? '▲' : '▼';
    curtainToggle.setAttribute('aria-expanded', String(expandedFavoriteMaterialActions));
    if (!expandedFavoriteMaterialActions) {
      favoriteItemReorderEnabled = false;
      countState.enabled = false;
      favoriteMaterialCalcMode = 'sum';
      expandedFavoriteCountRows.clear();
      saveFavoriteItemCountStore();
      if (resultSourceMode === 'favorite-materials') renderResultView();
      window.setTimeout(renderList, 190);
    }
  });

  const reorderButton = document.createElement('button');
  reorderButton.className = 'favorite-list-action favorite-list-action-compact';
  reorderButton.classList.toggle('active', favoriteItemReorderEnabled);
  reorderButton.type = 'button';
  reorderButton.textContent = '並び替え';
  reorderButton.addEventListener('click', event => {
    event.stopPropagation();
    const enable = !favoriteItemReorderEnabled;
    favoriteItemReorderEnabled = enable;
    if (enable) {
      countState.enabled = false;
      favoriteMaterialCalcMode = 'sum';
      expandedFavoriteCountRows.clear();
      saveFavoriteItemCountStore();
      if (resultSourceMode === 'favorite-materials') renderResultView();
    }
    renderList();
  });

  const countButton = document.createElement('button');
  countButton.className = 'favorite-list-action favorite-list-action-compact';
  countButton.classList.toggle('active', countState.enabled && favoriteMaterialCalcMode === 'counts');
  countButton.type = 'button';
  countButton.textContent = '個数指定';
  countButton.addEventListener('click', event => {
    event.stopPropagation();
    const enable = favoriteMaterialCalcMode !== 'counts';
    favoriteItemReorderEnabled = false;
    countState.enabled = enable;
    favoriteMaterialCalcMode = enable ? 'counts' : 'sum';
    expandedFavoriteCountRows.clear();
    if (countState.enabled) {
      list.itemIds.forEach(itemId => expandedFavoriteCountRows.add(itemId));
    }
    saveFavoriteItemCountStore();
    renderList();
    if (resultSourceMode === 'favorite-materials') renderResultView();
  });

  const anyOneButton = document.createElement('button');
  anyOneButton.className = 'favorite-list-action favorite-list-action-compact';
  anyOneButton.classList.toggle('active', favoriteAnyOneMode());
  anyOneButton.type = 'button';
  anyOneButton.textContent = 'どれでも1つ';
  anyOneButton.addEventListener('click', event => {
    event.stopPropagation();
    const enable = !favoriteAnyOneMode();
    favoriteItemReorderEnabled = false;
    countState.enabled = enable;
    favoriteMaterialCalcMode = enable ? 'any-one' : 'sum';
    expandedFavoriteCountRows.clear();
    if (enable) {
      list.itemIds.forEach(itemId => expandedFavoriteCountRows.add(itemId));
    }
    saveFavoriteItemCountStore();
    renderList();
    if (resultSourceMode === 'favorite-materials') renderResultView();
  });

  const anyOneHelp = document.createElement('button');
  anyOneHelp.className = 'favorite-material-help-btn';
  anyOneHelp.type = 'button';
  anyOneHelp.textContent = '?';
  anyOneHelp.setAttribute('aria-label', '拡張機能について');
  anyOneHelp.addEventListener('click', event => {
    event.stopPropagation();
    openMarkdownNotice('拡張機能について', `### 並び替え

お気に入りリスト内のアイテム順を変更します。素材リストの計算内容は変わりません。

### 個数指定

アイテムごとに作りたい個数を指定し、その合計に必要な素材リストを表示します。0個のアイテムは素材リストから外れます。

個数指定中に使える操作:

- **全て1個**  
  お気に入りリスト内全アイテムの個数をまとめて1個にします。
- **全て0個**  
  お気に入りリスト内全アイテムの個数をまとめて0個にします。

### どれでも1つ

チェックしたアイテムのうち、どれか1つをセット数分制作するために必要な素材リストを表示します。チェックした全てを制作する素材リストではありません。

どれでも1つ中に使える操作:

- **全てOn**  
  お気に入りリスト内全アイテムをまとめてチェックします。
- **全てOff**  
  お気に入りリスト内全アイテムのチェックをまとめて外します。`);
  });

  const setAllCounts = value => {
    getFavoriteListRecipeNames(list).forEach(name => {
      const itemId = itemIdForName(name);
      if (favoriteAnyOneMode()) {
        if (!countState.anyOneTargets) countState.anyOneTargets = {};
        countState.anyOneTargets[itemId] = Boolean(value);
      } else {
        countState.counts[itemId] = value;
      }
    });
    saveFavoriteItemCountStore();
    renderList();
    if (resultSourceMode === 'favorite-materials') renderResultView();
  };
  const oneButton = document.createElement('button');
  oneButton.className = 'favorite-list-action favorite-list-action-compact';
  oneButton.type = 'button';
  oneButton.textContent = favoriteAnyOneMode() ? '全てOn' : '全て1個';
  oneButton.disabled = !countState.enabled;
  oneButton.addEventListener('click', event => {
    event.stopPropagation();
    setAllCounts(1);
  });
  const zeroButton = document.createElement('button');
  zeroButton.className = 'favorite-list-action favorite-list-action-compact';
  zeroButton.type = 'button';
  zeroButton.textContent = favoriteAnyOneMode() ? '全てOff' : '全て0個';
  zeroButton.disabled = !countState.enabled;
  zeroButton.addEventListener('click', event => {
    event.stopPropagation();
    setAllCounts(0);
  });

  const actions = document.createElement('div');
  actions.className = 'favorite-material-curtain-actions';
  const actionsHeader = document.createElement('div');
  actionsHeader.className = 'favorite-material-actions-header';
  actionsHeader.append(createTextElement('span', '', '拡張機能'), anyOneHelp);
  const modeGroup = document.createElement('div');
  modeGroup.className = 'favorite-material-action-group favorite-material-mode-group';
  modeGroup.append(reorderButton, countButton, anyOneButton);
  actions.append(actionsHeader, modeGroup);
  const showBulkButtons = countState.enabled && (favoriteMaterialCalcMode === 'counts' || favoriteMaterialCalcMode === 'any-one');
  if (showBulkButtons) {
    const bulkGroup = document.createElement('div');
    bulkGroup.className = 'favorite-material-action-group favorite-material-bulk-group';
    bulkGroup.append(oneButton, zeroButton);
    actions.appendChild(bulkGroup);
  }
  curtain.appendChild(curtainToggle);
  li.append(materialButton, curtain, actions);
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
      li.classList.toggle('material-selected-favorite-list', Boolean(list.materialSelected) && !recent);
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

      const materialSelect = document.createElement('input');
      materialSelect.className = 'favorite-list-material-checkbox';
      materialSelect.type = 'checkbox';
      materialSelect.checked = Boolean(list.materialSelected);
      materialSelect.title = '複数素材リストに含める';
      materialSelect.setAttribute('aria-label', `「${list.name}」を複数素材リストに含める`);
      materialSelect.addEventListener('click', event => {
        event.stopPropagation();
      });
      materialSelect.addEventListener('change', event => {
        event.stopPropagation();
        list.materialSelected = materialSelect.checked;
        saveFavorites();
        renderFavoriteLists();
        updateCheckedFavoriteMaterialsButton();
        renderList();
        if (resultSourceMode === 'favorite-materials' && favoriteMaterialsListIds.length >= 2) {
          favoriteMaterialsListIds = getMaterialSelectedFavoriteLists().map(entry => entry.id);
          if (favoriteMaterialsListIds.length < 2) leaveFavoriteMaterialsMode();
          renderResultView();
        }
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
      curtain.append(curtainToggle, materialSelect, actions);

      li.append(name, curtain);
      li.addEventListener('click', () => selectFavoriteList(list.id));
      frag.appendChild(li);
    });
  }

  elements.favoriteLists.replaceChildren(frag);
  updateCheckedFavoriteMaterialsButton();
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
    case 'equipment':
      return equipmentSearchResults;
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

function createItemDisplayLabel(name, { favorite = false } = {}) {
  const master = itemMaster[name] || {};
  const wrapper = document.createElement('span');
  wrapper.className = favorite ? 'favorite-item-label item-list-label' : 'item-list-label';
  const badges = document.createElement('span');
  badges.className = 'item-list-badges';

  if (CRAFT_JOBS_SET.has(master.method) && master.craftLevel > 0) {
    const badge = createTextElement(
      'span',
      `${favorite ? 'favorite-item-job ' : ''}badge ${methodBadgeClass(master.method)}`,
      `${CRAFT_JOB_ABBREVIATIONS[master.method] || master.method}Lv${master.craftLevel}`
    );
    badges.appendChild(badge);
  }
  if (isEquipmentSearchTarget(master)) {
    badges.append(createTextElement('span', 'badge badge-equipment', `Lv${equipmentEquipLevel(master)}/IL${equipmentItemLevel(master)}`));
    const jobs = sortEquipmentJobs(equipmentJobs(master).filter(job =>
      !['全クラス', 'ファイター', 'ソーサラー', 'クラフター', 'ギャザラー'].includes(job)
    ));
    const role = master.equipmentInfo?.recommendedRole || '';
    let targetLabel = jobs.map(job => EQUIPMENT_JOB_ABBREVIATIONS[job] || job).join('');
    if (!targetLabel && role === 'fighter') targetLabel = 'ファイター';
    else if (!targetLabel && role === 'sorcerer') targetLabel = 'ソーサラー';
    else if (!targetLabel && EQUIPMENT_ROLE_JOBS[role]) {
      targetLabel = sortEquipmentJobs(EQUIPMENT_ROLE_JOBS[role]).map(job => EQUIPMENT_JOB_ABBREVIATIONS[job] || job).join('');
    }
    if (targetLabel) badges.append(createTextElement('span', 'badge badge-equipment-job', targetLabel));
  }

  const nameElement = createTextElement(
    'span',
    favorite ? 'favorite-item-name list-name' : 'list-name',
    name
  );
  if (badges.childElementCount > 0) wrapper.appendChild(badges);
  wrapper.appendChild(nameElement);
  if ((listMode === 'equipment' || listMode === 'fav') && equipmentParameterDisplayNames.has(name)) {
    const peers = [...equipmentParameterDisplayNames]
      .filter(peerName => equipmentSlotForItem(itemMaster[peerName]) === equipmentSlotForItem(master));
    const parameters = Object.entries(master.equipmentInfo?.stats || {})
      .filter(([, value]) => Number(value) > 0)
      .filter(([label, value]) => !peers.every(peerName =>
        Number(itemMaster[peerName]?.equipmentInfo?.stats?.[label] || 0) === Number(value)
      ))
      .map(([label, value]) => `${label} +${formatNumber(Number(value))}`)
      .join(' / ');
    if (parameters) wrapper.appendChild(createTextElement('span', 'equipment-parameters', parameters));
  }
  return wrapper;
}

function createItemListRow(name, className = '') {
  const row = document.createElement('li');
  row.className = className;
  row.title = name;

  const icon = createItemIcon(itemMaster[name]?.icon);
  if (icon) row.appendChild(icon);
  row.appendChild(createItemDisplayLabel(name, { favorite: className.split(/\s+/).includes('fav-item-row') }));
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

function updateListEquipmentParameterNames(names) {
  if (listMode === 'equipment') return;
  equipmentParameterDisplayNames.clear();
  if (listMode !== 'fav') return;
  const bySlot = new Map();
  names.forEach(name => {
    const master = itemMaster[name];
    if (!isEquipmentSearchTarget(master)) return;
    const slot = equipmentSlotForItem(master);
    if (!bySlot.has(slot)) bySlot.set(slot, []);
    bySlot.get(slot).push(name);
  });
  bySlot.forEach(slotNames => {
    if (slotNames.length > 1) slotNames.forEach(name => equipmentParameterDisplayNames.add(name));
  });
}

function renderList() {
  const frag = document.createDocumentFragment();
  const names = getDisplayList();
  updateListEquipmentParameterNames(names);
  const showMobileTips = listMode === 'none' && isMobile();

  elements.recipeList.classList.toggle('hidden', showMobileTips);
  elements.mobileTipsMsg.classList.toggle('hidden', !showMobileTips);

  if (listMode === 'fav' && !getDisplayedFavoriteList()) {
    frag.appendChild(createEmptyListItem('お気に入りリストを選択してください'));
  } else if (listMode === 'fav' && names.length === 0) {
    frag.appendChild(createEmptyListItem('お気に入りはありません'));
  } else if (names.length === 0) {
    frag.appendChild(createEmptyListItem('該当するレシピがありません'));
  } else if (listMode === 'fav' && hasMaterialSelectedFavoriteLists()) {
    // Checked favorite lists use the dedicated combined-materials button under the favorite selector.
  } else {
    if (listMode === 'fav' && getDisplayedFavoriteList()) {
      const materialsRow = createFavoriteMaterialsRow();
      if (materialsRow) frag.appendChild(materialsRow);
    }
    names.forEach((name, index) => {
      if (listMode === 'fav') frag.appendChild(makeFavLi(name, index));
      else if (listMode === 'equipment') frag.appendChild(makeEquipmentLi(name));
      else if (recipes[name]) frag.appendChild(makeRecipeLi(name));
      else frag.appendChild(makeIngredientLi(name));
    });
  }

  if (listMode === 'fav' && getDisplayedFavoriteList() && !hasMaterialSelectedFavoriteLists()) {
    frag.appendChild(createFavoriteSaveRow());
  }

  elements.recipeList.replaceChildren(frag);
  elements.recipeList.scrollTop = 0;
  saveViewState();
}

function makeFavLi(name, index) {
  const li = createItemListRow(name, 'fav-item-row');
  const itemId = itemIdForName(name);
  li.dataset.reorderIndex = String(index);
  li.classList.toggle('selected', selectedRecipe === name);
  const countState = getFavoriteCountState();
  const countsEnabled = countState.enabled && recipes[name];
  const itemCount = favoriteItemCount(itemId);
  const anyOneMode = favoriteAnyOneMode();
  const anyOneChecked = favoriteAnyOneTarget(itemId);
  li.classList.toggle('favorite-count-zero', countsEnabled && (anyOneMode ? !anyOneChecked : itemCount === 0));

  const label = li.querySelector('.item-list-label') || li.querySelector('.list-name');

  const pin = document.createElement('button');
  pin.className = 'pin-btn';
  pin.textContent = '📌';
  pin.title = 'お気に入りから削除';
  pin.addEventListener('click', event => {
    event.stopPropagation();
    pinOff(name);
  });
  if (!countsEnabled) li.insertBefore(pin, label);

  appendItemActionButtons(
    li,
    createShopInfoButton(name),
    createGatheringTimerButton(name),
    !recipes[name] ? createUsesListButton(name, li, false) : null
  );

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

  if (countsEnabled) {
    const expanded = expandedFavoriteCountRows.has(itemId);
    const curtain = document.createElement('div');
    curtain.className = 'favorite-item-count-curtain';
    curtain.classList.toggle('expanded', expanded);
    curtain.classList.toggle('any-one', anyOneMode);
    const toggle = document.createElement('button');
    toggle.className = 'favorite-item-count-toggle';
    toggle.type = 'button';
    toggle.textContent = expanded ? '▶' : '◀';
    toggle.addEventListener('click', event => {
      event.stopPropagation();
      const nextExpanded = !expandedFavoriteCountRows.has(itemId);
      if (nextExpanded) expandedFavoriteCountRows.add(itemId);
      else expandedFavoriteCountRows.delete(itemId);
      curtain.classList.toggle('expanded', nextExpanded);
      toggle.textContent = nextExpanded ? '▶' : '◀';
    });
    const controls = document.createElement('div');
    controls.className = 'favorite-item-count-controls';
    if (anyOneMode) {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'favorite-anyone-checkbox';
      checkbox.checked = anyOneChecked;
      checkbox.addEventListener('click', event => event.stopPropagation());
      checkbox.addEventListener('change', event => {
        setFavoriteAnyOneTarget(itemId, checkbox.checked);
        renderList();
        if (resultSourceMode === 'favorite-materials') renderResultView();
      });
      controls.appendChild(checkbox);
    } else {
      const dec = document.createElement('button');
      dec.type = 'button';
      dec.textContent = '－';
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.max = String(REQUEST_COUNT_MAX);
      input.step = '1';
      input.inputMode = 'numeric';
      input.value = String(itemCount);
      const inc = document.createElement('button');
      inc.type = 'button';
      inc.textContent = '＋';
      const commit = value => {
        setFavoriteItemCount(itemId, value);
        renderList();
        if (resultSourceMode === 'favorite-materials') renderResultView();
      };
      dec.addEventListener('click', event => {
        event.stopPropagation();
        commit(itemCount - 1);
      });
      inc.addEventListener('click', event => {
        event.stopPropagation();
        commit(itemCount + 1);
      });
      input.addEventListener('click', event => event.stopPropagation());
      input.addEventListener('change', event => commit(Number(event.target.value)));
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') input.blur();
      });
      controls.append(dec, input, inc);
    }
    curtain.append(toggle, controls);
    li.appendChild(curtain);
  }

  li.addEventListener('click', () => {
    if (countsEnabled) return;
    if (recipes[name]) selectRecipeByName(name);
    else {
      clearMaterialSelectedFavoriteLists();
      markRecipeListSelection(li);
      showUsesPanel(name);
    }
  });
  return li;
}

function makeRecipeLi(name) {
  const li = createItemListRow(name);
  li.classList.toggle('selected', selectedRecipe === name);
  appendItemActionButtons(li, createShopInfoButton(name), createGatheringTimerButton(name));

  li.addEventListener('click', () => {
    rememberCurrentSearch();
    markRecipeListSelection(li);
    selectRecipe(name, li);
  });
  return li;
}

function makeIngredientLi(name) {
  const li = createItemListRow(name, 'ingredient-row');
  appendItemActionButtons(
    li,
    createShopInfoButton(name),
    createGatheringTimerButton(name),
    createUsesListButton(name, li, true)
  );
  li.addEventListener('click', () => {
    rememberCurrentSearch();
    clearMaterialSelectedFavoriteLists();
    markRecipeListSelection(li);
    showUsesPanel(name);
  });
  return li;
}

function makeEquipmentLi(name) {
  const li = recipes[name] ? makeRecipeLi(name) : makeIngredientLi(name);
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
    clearMaterialSelectedFavoriteLists();
    markRecipeListSelection(row);
    showUsesPanel(name);
  });
  return usesButton;
}

function closeUsesPanel() {
  elements.panelMiddle.classList.remove('open');
  elements.panelMiddle.classList.remove('mobile-visible');
  elements.usesList.scrollTop = 0;
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
      resetFavoriteOperationModes();
      if (selectedRecipe !== recipeName || resultSourceMode === 'favorite-materials') resetCountInput();
      selectedRecipe = recipeName;
      leaveFavoriteMaterialsMode();
      resetRightPanelViewState();
      setResultViewMode('tree');
      elements.usesList.querySelectorAll('li').forEach(el => el.classList.remove('selected'));
      li.classList.add('selected');
      renderResultView();
      if (isMobile()) {
        prevPanel = 'middle';
        showMobilePanel('right');
      }
    });
    frag.appendChild(li);
  });

  elements.usesList.replaceChildren(frag);
  elements.usesList.scrollTop = 0;
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
  resetFavoriteOperationModes();
  clearMaterialSelectedFavoriteLists();
  if (selectedRecipe !== name || resultSourceMode === 'favorite-materials') resetCountInput();
  selectedRecipe = name;
  closeUsesPanel();
  leaveFavoriteMaterialsMode();
  resetRightPanelViewState();
  setResultViewMode('tree');
  markRecipeListSelection(li);
  renderResultView();
  if (isMobile()) {
    prevPanel = 'left';
    showMobilePanel('right');
    elements.panelRight.scrollTop = 0;
  }
}

function selectRecipeByName(name) {
  recordViewedItem(name);
  resetFavoriteOperationModes();
  clearMaterialSelectedFavoriteLists();
  if (selectedRecipe !== name || resultSourceMode === 'favorite-materials') resetCountInput();
  selectedRecipe = name;
  closeUsesPanel();
  leaveFavoriteMaterialsMode();
  resetRightPanelViewState();
  setResultViewMode('tree');
  renderList();
  renderResultView();
  if (isMobile()) {
    prevPanel = 'left';
    showMobilePanel('right');
    elements.panelRight.scrollTop = 0;
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
        craftLevel: toNumeric(item.CraftInfo?.[0]?.level, 0),
        id: item.ID,
        numericId: toNumeric(item.ID),
        uiCategory: toNumeric(item.ItemUICategory),
        uiCategoryName: item.ItemUICategoryName || '',
        gatheringTimer: item.GatheringTimer || [],
        shopInfo: item.ShopInfo || null,
        equipmentInfo: item.EquipmentInfo || null,
        craftInfo: item.CraftInfo || []
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
        uiCategoryName: item.ItemUICategoryName || '',
        gatheringTimer: item.GatheringTimer || [],
        shopInfo: item.ShopInfo || null,
        equipmentInfo: item.EquipmentInfo || null
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
        uiCategoryName: idToItem[ingredient.ItemID]?.ItemUICategoryName || '',
        gatheringTimer: idToItem[ingredient.ItemID]?.GatheringTimer || [],
        shopInfo: idToItem[ingredient.ItemID]?.ShopInfo || null,
        equipmentInfo: idToItem[ingredient.ItemID]?.EquipmentInfo || null
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
  buildEquipmentSearchIndexes();
  return maxPatch;
}

function updatePatchStatus(maxPatch) {
  elements.loadStatus.textContent = maxPatch > 0
    ? `patch ${String(maxPatch).slice(0, -2)}.${String(maxPatch).slice(-2)} 対応`
    : '';
}

function showLoadError(error) {
  elements.loadStatus.textContent = '読み込みエラー';
  hideLoadingOverlay();
  const message = document.createElement('div');
  message.className = 'error-msg';
  message.append('データの読み込みに失敗しました。', document.createElement('br'), error.message);
  elements.treeContainer.replaceChildren(message);
}

function hideLoadingOverlay() {
  const overlay = elements.loadingOverlay;
  if (!overlay) return;
  const remaining = Math.max(0, MIN_LOADING_OVERLAY_MS - (Date.now() - loadingOverlayStartedAt));
  window.setTimeout(() => overlay.classList.remove('open'), remaining);
}

async function init() {
  updatePopupButtonVisibility();
  loadFavorites();
  updateCheckedFavoriteMaterialsButton();
  loadSearchHistory();
  await loadTips();

  renderList();
  renderTips();

  try {
    const rawList = await fetchJson(
      DATA_FILE,
      status => `Item.json が見つかりません (${status})`
    );
    const applicationDataStartedAt = performance.now();
    updatePatchStatus(buildApplicationData(rawList));
    setupEquipmentSearchControls();
    performance.measure('application-data-setup', {
      start: applicationDataStartedAt,
      end: performance.now()
    });
    canSaveViewState = true;
    if (consumeSkipRestoreOnce() || !restoreViewState()) {
      renderList();
      renderResultView();
      if (isMobile()) showMobilePanel('left');
      else clearMobilePanels();
      saveViewState();
    }
    hideLoadingOverlay();
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

function resetRightPanelViewState() {
  elements.treeContainer.scrollTop = 0;
  elements.panelRight.scrollTop = 0;
  exchangeTreeState.clear();
  intermediateTreeState.clear();
  materialSectionState.clear();
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
  if (favoriteMaterialsListIds.length >= 2) {
    return [...new Set(
      getActiveFavoriteMaterialLists()
        .flatMap(entry => getFavoriteListRecipeNames(entry))
        .filter(isRingRecipe)
    )].sort(compareItemNames);
  }
  return getFavoriteListRecipeNames(list).filter(isRingRecipe).sort(compareItemNames);
}

function ensureFavoriteMaterialsRingCounts() {
  const ringNames = getFavoriteMaterialRingNames();
  favoriteMaterialsRingCounts = Object.fromEntries(
    ringNames.map(name => [name, [0, 2].includes(favoriteMaterialsRingCounts[name])
      ? favoriteMaterialsRingCounts[name]
      : 1])
  );
}

function requestFavoriteMaterialsMode() {
  const selectedLists = getMaterialSelectedFavoriteLists();
  if (selectedLists.length >= 2) {
    openFavoriteMaterialsMode({ listIds: selectedLists.map(list => list.id) });
    return;
  }
  openFavoriteMaterialsMode();
}

function openCheckedFavoriteMaterialsMode() {
  const selectedLists = getMaterialSelectedFavoriteLists();
  if (selectedLists.length === 0) return;
  if (selectedLists.length === 1) {
    favoriteStore.selectedListId = selectedLists[0].id;
    saveFavorites();
    listMode = 'fav';
    updateFavoriteButtonState();
    closeFavoriteLists();
    resetTreeSelection();
    openFavoriteMaterialsMode();
    return;
  }
  openFavoriteMaterialsMode({ listIds: selectedLists.map(list => list.id) });
}

function openFavoriteMaterialsMode({ listIds = [] } = {}) {
  const multiIds = listIds.filter(id => findFavoriteList(id) && !isRecentList(id));
  if (multiIds.length < 2 && !getDisplayedFavoriteList()) return;
  if (resultSourceMode !== 'favorite-materials') resetCountInput();
  favoriteMaterialsListIds = multiIds.length >= 2 ? multiIds : [];
  selectedRecipe = null;
  setResultSourceMode('favorite-materials');
  setResultViewMode('materials');
  ensureFavoriteMaterialsRingCounts();
  resetRightPanelViewState();
  renderList();
  renderResultView();
  if (isMobile()) {
    prevPanel = 'left';
    showMobilePanel('right');
  }
}

function leaveFavoriteMaterialsMode() {
  if (resultSourceMode !== 'favorite-materials') return;
  setResultSourceMode('recipe');
  favoriteMaterialsRingCounts = {};
  favoriteMaterialsListIds = [];
}

function updateResultHeader() {
  const count = readRequestedCount(elements.countInput);
  if (resultSourceMode === 'favorite-materials') {
    const activeLists = getActiveFavoriteMaterialLists();
    const hasFavoriteMaterials = activeLists.length > 0;
    const hideCountInput = favoriteMaterialsListIds.length < 2 && favoriteCountEnabled() && !favoriteAnyOneMode();
    elements.countLabel.textContent = 'セット数:';
    elements.resultTitle.textContent = '';
    elements.usesBtn.classList.remove('visible');
    elements.treeViewBtn.classList.add('hidden');
    elements.materialsViewBtn.classList.remove('hidden');
    elements.materialsViewBtn.classList.add('active');
    elements.materialsViewBtn.disabled = true;
    elements.resultViewSwitch.classList.toggle('hidden', !hasFavoriteMaterials);
    elements.resultViewSwitch.classList.add('favorite-materials-only');
    elements.resultHeader.classList.toggle('hidden', !hasFavoriteMaterials);
    elements.resultHeader.classList.toggle('hide-count-input', hideCountInput);
    elements.countInput.disabled = hideCountInput;
    elements.resultHeader.querySelectorAll('.count-control button')
      .forEach(button => { button.disabled = hideCountInput; });
    return;
  }

  elements.resultHeader.classList.remove('hide-count-input');
  elements.countInput.disabled = false;
  elements.resultHeader.querySelectorAll('.count-control button')
    .forEach(button => { button.disabled = false; });
  elements.countLabel.textContent = '個数:';
  elements.resultTitle.textContent = '';
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

function renderResultView({ preserveScroll = false } = {}) {
  const treeScrollTop = elements.treeContainer.scrollTop;
  const panelScrollTop = elements.panelRight.scrollTop;
  if (!preserveScroll) {
    elements.treeContainer.scrollTop = 0;
    elements.panelRight.scrollTop = 0;
  }
  clearRenderedTree();
  updateResultHeader();

  if (resultSourceMode === 'favorite-materials' && getActiveFavoriteMaterialLists().length === 0) {
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
  if (preserveScroll) {
    elements.treeContainer.scrollTop = treeScrollTop;
    elements.panelRight.scrollTop = panelScrollTop;
  }
  saveViewState();
}

function resetToStartupView() {
  suppressViewStateSave = true;
  leaveFavoriteMaterialsMode();
  resetFavoriteOperationModes();
  clearMaterialSelectedFavoriteLists();
  selectedRecipe = null;
  selectedUsesItem = null;
  equipmentSearchResults = [];
  setEquipmentSearchOpen(false);
  prevPanel = 'left';
  listMode = 'none';
  setResultViewMode('tree');
  favoriteStore.selectedListId = null;
  saveFavorites();
  treePinMap.clear();
  resetRightPanelViewState();

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
  return CRYSTAL_EXCLUDE.has(name) ? getCrystalPart(name, CRYSTAL_KIND_ORDER) : '';
}

function crystalElement(name) {
  return CRYSTAL_EXCLUDE.has(name) ? getCrystalPart(name, CRYSTAL_ELEMENT_ORDER) : '';
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

function compareAvailableIntermediateRows(a, b, previous, remainingCraftTypes, craftTypeDependencies) {
  const previousRecipe = previous ? recipes[previous.name] : null;
  const leftRecipe = recipes[a.name];
  const rightRecipe = recipes[b.name];
  const previousCraftType = previous ? toNumeric(previousRecipe?.craftType) : null;
  const leftCraftType = toNumeric(leftRecipe?.craftType);
  const rightCraftType = toNumeric(rightRecipe?.craftType);
  const leftSameCraftType = previous && leftCraftType === previousCraftType ? 0 : 1;
  const rightSameCraftType = previous && rightCraftType === previousCraftType ? 0 : 1;
  if (leftSameCraftType !== rightSameCraftType) return leftSameCraftType - rightSameCraftType;

  if (previous && leftSameCraftType === 0) {
    const previousCategory = itemSortKey(previous.name).uiCategory;
    const leftSameCategory = itemSortKey(a.name).uiCategory === previousCategory ? 0 : 1;
    const rightSameCategory = itemSortKey(b.name).uiCategory === previousCategory ? 0 : 1;
    if (leftSameCategory !== rightSameCategory) return leftSameCategory - rightSameCategory;
  }

  const waitsForRemainingCraftType = craftType =>
    [...(craftTypeDependencies.get(craftType) || [])]
      .some(requiredCraftType => (remainingCraftTypes.get(requiredCraftType) || 0) > 0);
  const leftBlocked = waitsForRemainingCraftType(leftCraftType) ? 1 : 0;
  const rightBlocked = waitsForRemainingCraftType(rightCraftType) ? 1 : 0;
  if (leftBlocked !== rightBlocked) return leftBlocked - rightBlocked;
  return compareIntermediateRows(a, b);
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
  if (favoriteMaterialsListIds.length < 2 && favoriteCountEnabled()) return;
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

    [0, 1, 2].forEach(value => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = value === 0 ? '0' : `${value}つ`;
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

function calculateMaterialRequirements(rootItems, terminalNames = []) {
  return calculateRequirements(recipes, rootItems, {
    exchangeCraftTypes: EXCHANGE_CRAFT_TYPES,
    terminalNames
  });
}

function intermediateUsageEntries(result, state) {
  return [...state.parents].map(parentName => {
    const parentState = result.states.get(parentName);
    if (!parentState?.recipe || parentState.isRoot || parentState.isExchange) return null;
    const quantityPerCraft = parentState.recipe.ingredients
      .filter(ingredient => ingredient.name === state.name)
      .reduce((sum, ingredient) => sum + ingredient.qty, 0);
    const qty = quantityPerCraft * parentState.craftTimes;
    return qty > 0 ? { name: parentName, qty } : null;
  }).filter(Boolean).sort((a, b) => compareIntermediateRows(a, b));
}

function usageSignature(entries) {
  return entries.map(entry => `${entry.name}:${entry.qty}`).join('|');
}

function mergeMaxRequirementResults(results) {
  const states = new Map();
  const roots = new Set();
  const exchangeTypes = new Set(EXCHANGE_CRAFT_TYPES);

  results.forEach(result => {
    result.roots.forEach(name => roots.add(name));
    result.states.forEach((state, name) => {
      const current = states.get(name);
      const usage = intermediateUsageEntries(result, state);
      if (current && current.needed > state.needed) return;
      if (current && current.needed === state.needed) {
        current.parents = new Set([...current.parents, ...state.parents]);
        if (!current.usageAlternatives.some(entries => usageSignature(entries) === usageSignature(usage))) {
          current.usageAlternatives.push(usage);
        }
        return;
      }
      states.set(name, {
        ...state,
        parents: new Set(state.parents),
        usageAlternatives: [usage]
      });
    });
  });

  states.forEach((state, name) => {
    state.isRoot = roots.has(name);
  });

  return { states, roots, exchangeTypes };
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

function orderedIntermediateRows(result) {
  const rows = new Map();
  result.states.forEach(state => {
    if (!state.recipe || state.isRoot || state.isExchange || crystalKind(state.name)) return;
    rows.set(state.name, {
      name: state.name,
      qty: state.needed,
      craftTimes: state.craftTimes,
      produced: state.produced,
      surplus: state.surplus,
      parents: new Set([...state.parents].filter(name => {
        const parent = result.states.get(name);
        return parent?.recipe && !parent.isRoot && !parent.isExchange && !crystalKind(parent.name);
      })),
      usageAlternatives: state.usageAlternatives || [intermediateUsageEntries(result, state)]
    });
  });

  const indegree = new Map([...rows.keys()].map(name => [name, 0]));
  const dependents = new Map([...rows.keys()].map(name => [name, []]));
  const craftTypeDependencies = new Map();
  const remainingCraftTypes = new Map();
  rows.forEach(row => {
    const craftType = toNumeric(recipes[row.name]?.craftType);
    remainingCraftTypes.set(craftType, (remainingCraftTypes.get(craftType) || 0) + 1);
  });
  rows.forEach(row => {
    row.parents.forEach(parentName => {
      if (!rows.has(parentName)) return;
      indegree.set(parentName, indegree.get(parentName) + 1);
      dependents.get(row.name).push(parentName);
      const requiredCraftType = toNumeric(recipes[row.name]?.craftType);
      const dependentCraftType = toNumeric(recipes[parentName]?.craftType);
      if (requiredCraftType !== dependentCraftType) {
        if (!craftTypeDependencies.has(dependentCraftType)) craftTypeDependencies.set(dependentCraftType, new Set());
        craftTypeDependencies.get(dependentCraftType).add(requiredCraftType);
      }
    });
  });

  const available = [...rows.values()].filter(row => indegree.get(row.name) === 0);
  const ordered = [];
  while (available.length > 0) {
    available.sort((a, b) => compareAvailableIntermediateRows(
      a,
      b,
      ordered.at(-1),
      remainingCraftTypes,
      craftTypeDependencies
    ));
    const row = available.shift();
    ordered.push(row);
    const craftType = toNumeric(recipes[row.name]?.craftType);
    remainingCraftTypes.set(craftType, remainingCraftTypes.get(craftType) - 1);
    dependents.get(row.name).forEach(parentName => {
      indegree.set(parentName, indegree.get(parentName) - 1);
      if (indegree.get(parentName) === 0) available.push(rows.get(parentName));
    });
  }
  if (ordered.length < rows.size) {
    const included = new Set(ordered.map(row => row.name));
    ordered.push(...[...rows.values()].filter(row => !included.has(row.name)).sort(compareIntermediateRows));
  }
  return ordered;
}

function getFavoriteMaterialRoots() {
  ensureFavoriteMaterialsRingCounts();
  const setCount = readRequestedCount(elements.countInput);
  const activeLists = getActiveFavoriteMaterialLists();
  if (favoriteMaterialsListIds.length >= 2) {
    const roots = new Map();
    activeLists.forEach(list => {
      getFavoriteListRecipeNames(list).forEach(name => {
        const multiplier = isRingRecipe(name) ? (favoriteMaterialsRingCounts[name] ?? 1) : 1;
        roots.set(name, (roots.get(name) || 0) + setCount * multiplier);
      });
    });
    return [...roots.entries()].filter(([, qty]) => qty > 0).map(([name, qty]) => ({ name, qty }));
  }
  const list = getDisplayedFavoriteList();
  const useItemCounts = favoriteCountEnabled(list);
  return getFavoriteListRecipeNames(list).map(name => {
    const itemId = itemIdForName(name);
    const specifiedCount = useItemCounts ? favoriteItemCount(itemId, list) : 1;
    if (favoriteAnyOneMode() && !favoriteAnyOneTarget(itemId, list)) return null;
    if (!favoriteAnyOneMode() && specifiedCount <= 0) return null;
    if (favoriteAnyOneMode()) return { name, qty: setCount };
    const multiplier = !useItemCounts && isRingRecipe(name) ? (favoriteMaterialsRingCounts[name] ?? 1) : 1;
    const qty = setCount * specifiedCount * multiplier;
    return qty > 0 ? { name, qty } : null;
  }).filter(Boolean);
}

function currentMaterialPurchaseContext() {
  if (resultSourceMode === 'favorite-materials') {
    const ids = favoriteMaterialsListIds.length >= 2
      ? favoriteMaterialsListIds
      : [getDisplayedFavoriteList()?.id || ''];
    return `favorite:${ids.join(',')}`;
  }
  return `recipe:${selectedRecipe || ''}`;
}

function getCurrentMaterialRequirements(terminalNames = []) {
  const count = readRequestedCount(elements.countInput);
  if (resultSourceMode === 'favorite-materials' && favoriteAnyOneMode() && favoriteMaterialsListIds.length < 2) {
    const roots = getFavoriteMaterialRoots();
    const results = roots.map(root => calculateMaterialRequirements([{ name: root.name, qty: root.qty }], terminalNames));
    return mergeMaxRequirementResults(results);
  }
  const roots = resultSourceMode === 'favorite-materials'
    ? getFavoriteMaterialRoots()
    : [{ name: selectedRecipe, qty: count }];
  return calculateMaterialRequirements(roots, terminalNames);
}

function renderMaterialsList() {
  const count = readRequestedCount(elements.countInput);
  const requirements = getCurrentMaterialRequirements();
  const purchaseContext = currentMaterialPurchaseContext();
  if (purchasedIntermediateContext !== purchaseContext) {
    purchasedIntermediateContext = purchaseContext;
    purchasedIntermediateNames.clear();
  }
  const requirementsAfterPurchases = purchasedIntermediateNames.size
    ? getCurrentMaterialRequirements(purchasedIntermediateNames)
    : requirements;
  const rows = materialRowsFromRequirements(requirements);
  const intermediateRows = orderedIntermediateRows(requirements);
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
    const activeLists = getActiveFavoriteMaterialLists();
    if (favoriteMaterialsListIds.length >= 2) {
      activeLists.forEach(list => {
        elements.treeContainer.appendChild(createFavoriteListRootSummary(list));
      });
      renderFavoriteRingControls(elements.treeContainer);
    } else {
      renderFavoriteRingControls(elements.treeContainer);
    }
    if (favoriteMaterialsListIds.length < 2 && favoriteCountEnabled()) {
      getFavoriteMaterialRoots().forEach((root, index) => {
        if (favoriteAnyOneMode() && index > 0) {
          elements.treeContainer.appendChild(createTextElement('div', 'favorite-material-root-or', 'もしくは'));
        }
        elements.treeContainer.appendChild(
          createResultRootSummary(root.name, root.qty, 'result-root-summary favorite-material-root-summary', false)
        );
      });
    }
  } else {
    elements.treeContainer.appendChild(createResultRootSummary(selectedRecipe, count, 'result-root-summary', true));
  }

  const contextKey = resultSourceMode === 'favorite-materials'
    ? `favorite:${favoriteMaterialsListIds.length >= 2 ? favoriteMaterialsListIds.join(',') : getDisplayedFavoriteList()?.id || ''}`
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
      bodyRows.forEach(row => setCollapsedAnimated(row, collapsed));
      saveViewState();
    });
  };

  const createMaterialRow = row => {
    const li = document.createElement('li');
    if (row.type === 'item') {
      const noLongerNeeded = !requirementsAfterPurchases.states.has(row.name);
      if (noLongerNeeded) li.classList.add('purchase-unneeded');
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
      if (noLongerNeeded) {
        primary.appendChild(createTextElement('span', 'purchase-status', '中間素材購入💰の為不要'));
      }
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
            appendItemActionButtons(
              entryRow,
              createShopInfoButton(entry.name),
              createGatheringTimerButton(entry.name)
            );
          }
          supplement.appendChild(entryRow);
        });
        content.appendChild(supplement);
      }

      li.appendChild(content);
      appendItemActionButtons(li, createShopInfoButton(row.name), createGatheringTimerButton(row.name));
    } else {
      li.appendChild(createMaterialChoiceContent(row));
    }
    return li;
  };

  const createIntermediateRow = row => {
    const li = document.createElement('li');
    li.className = 'intermediate-tree-node';
    const purchased = purchasedIntermediateNames.has(row.name);
    const noLongerNeeded = !purchased && !requirementsAfterPurchases.states.has(row.name);
    if (purchased) li.classList.add('purchase-selected');
    if (noLongerNeeded) li.classList.add('purchase-unneeded');
    const rowElement = document.createElement('div');
    rowElement.className = 'intermediate-tree-row';
    const icon = createItemIcon(itemMaster[row.name]?.icon);
    if (icon) rowElement.appendChild(icon);
    const content = document.createElement('div');
    content.className = 'material-content';
    const primary = document.createElement('div');
    primary.className = 'material-primary';
    const master = itemMaster[row.name] || {};
    if (CRAFT_JOBS_SET.has(master.method)) {
      primary.appendChild(createTextElement(
        'span',
        `badge ${methodBadgeClass(master.method)}`,
        CRAFT_JOB_ABBREVIATIONS[master.method] || master.method
      ));
    }
    primary.append(
      createTextElement('span', 'material-name', row.name),
      createTextElement('span', 'material-qty', `× ${formatNumber(row.qty)}`)
    );
    if (noLongerNeeded) {
      primary.appendChild(createTextElement('span', 'purchase-status', '中間素材購入💰の為不要'));
    }
    content.appendChild(primary);

    const supplementEntries = createCraftSupplementEntries(row.name, row.qty);
    const usageAlternatives = row.usageAlternatives || [];
    if (supplementEntries.length || usageAlternatives.some(entries => entries.length > 0)) {
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
      const appendUsageDetail = (prefix, entry, all = false) => {
        const detail = document.createElement('div');
        detail.className = 'material-usage-detail';
        if (all) {
          detail.append(
            createTextElement('span', 'material-usage-emphasis', 'すべて'),
            document.createTextNode('を'),
            createTextElement('span', 'material-usage-emphasis', entry.name),
            document.createTextNode('に使用')
          );
        } else {
          detail.append(
            document.createTextNode(prefix),
            createTextElement('span', 'material-usage-emphasis', formatNumber(entry.qty)),
            document.createTextNode(' 個は'),
            createTextElement('span', 'material-usage-emphasis', entry.name),
            document.createTextNode('に使用')
          );
        }
        supplement.appendChild(detail);
      };
      if (usageAlternatives.length <= 1) {
        const entries = usageAlternatives[0] || [];
        entries.forEach(entry => appendUsageDetail(
          'うち ',
          entry,
          entries.length === 1 && row.surplus === 0 && entry.qty === row.produced
        ));
      } else {
        usageAlternatives.forEach(entries => {
          entries.forEach(entry => appendUsageDetail('使用先候補: ', entry));
        });
      }
      content.appendChild(supplement);
    }

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
    appendItemActionButtons(
      primary,
      createShopInfoButton(row.name, { allowIntermediatePurchase: true }),
      createGatheringTimerButton(row.name),
      treeButton
    );
    rowElement.appendChild(content);
    li.appendChild(rowElement);
    return li;
  };

  const intermediateSectionRows = intermediateRows.map(createIntermediateRow);
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

  const recipe = recipes[selectedRecipe];
  elements.treeContainer.appendChild(createResultRootSummary(selectedRecipe, count, 'result-root-summary', true));
  if (!recipe) return;
  appendRecipeChildren(
    elements.treeContainer,
    recipe,
    count,
    -1,
    selectedRecipe,
    shouldShowCraftBadgeOnlyAtRoot(selectedRecipe),
    true
  );
}

function renderMaterialTreeDialog() {
  if (!materialTreeRecipe) return;
  const count = readRequestedCount(elements.materialTreeCountInput);
  elements.materialTreeTitle.textContent = '素材ツリー';
  elements.materialTreeContent.style.height = '';
  elements.materialTreeContent.replaceChildren();
  elements.materialTreeContent.scrollTop = 0;
  elements.materialTreeContent.appendChild(createResultRootSummary(materialTreeRecipe, count, 'material-tree-root-summary', false));
  const recipe = recipes[materialTreeRecipe];
  if (recipe) {
    appendRecipeChildren(
      elements.materialTreeContent,
      recipe,
      count,
      -1,
      `material-dialog:${materialTreeRecipe}`,
      shouldShowCraftBadgeOnlyAtRoot(materialTreeRecipe),
      false
    );
  }
  lockMaterialTreeContentHeight();
}

function createResultRootSummary(name, neededQty, className = 'result-root-summary', showPin = false) {
  const master = itemMaster[name] || { method: '', icon: '', craftType: '' };
  const recipe = recipes[name];
  const producedQty = calcProduced(name, neededQty);
  const wrapper = document.createElement('div');
  wrapper.className = className;
  const row = document.createElement('div');
  row.className = 'node-row';
  const icon = createItemIcon(master.icon, 'node-icon');
  if (showPin) row.appendChild(createTreePin(name));
  if (icon) row.appendChild(icon);
  row.appendChild(
    createTreeMain(
      name,
      producedQty,
      createTreeSubInfo(recipe, neededQty, producedQty, null, null),
      createTreeBadge(master.method, false)
    )
  );
  appendItemActionButtons(row, createShopInfoButton(name), createGatheringTimerButton(name));
  wrapper.appendChild(row);
  return wrapper;
}

function createFavoriteListRootSummary(list) {
  const wrapper = document.createElement('div');
  wrapper.className = 'result-root-summary favorite-material-root-summary favorite-list-root-summary';
  const row = document.createElement('div');
  row.className = 'node-row';
  row.appendChild(createTextElement('div', 'tree-main favorite-list-root-name', list.name));
  wrapper.appendChild(row);
  return wrapper;
}

function lockMaterialTreeContentHeight() {
  if (!elements.materialTreeOverlay.classList.contains('open')) return;
  const content = elements.materialTreeContent;
  content.style.height = '';
  const maxHeight = Math.max(120, Math.min(520, window.innerHeight * 0.52));
  const height = Math.min(Math.ceil(content.getBoundingClientRect().height), maxHeight);
  content.style.height = `${height}px`;
}

function openMaterialTree(name, neededQty) {
  materialTreeRecipe = name;
  elements.materialTreeCountInput.value = String(Math.min(REQUEST_COUNT_MAX, Math.max(1, neededQty)));
  elements.materialTreeOverlay.classList.add('open');
  renderMaterialTreeDialog();
}

function closeMaterialTree() {
  elements.materialTreeOverlay.classList.remove('open');
  elements.materialTreeContent.style.height = '';
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

function hasGatheringTimer(name) {
  return (itemMaster[name]?.gatheringTimer || []).length > 0;
}

function createGatheringTimerButton(name) {
  if (!hasGatheringTimer(name)) return null;
  const button = document.createElement('button');
  button.className = 'gathering-timer-btn';
  button.type = 'button';
  button.textContent = '⏰';
  button.title = `${name}の採集情報`;
  button.setAttribute('aria-label', `${name}の採集情報`);
  button.addEventListener('click', event => {
    event.stopPropagation();
    showGatheringDialog(name);
  });
  return button;
}

function hasShopInfo(name) {
  return (itemMaster[name]?.shopInfo?.shops || []).length > 0;
}

function createShopInfoButton(name, { allowIntermediatePurchase = false } = {}) {
  if (!hasShopInfo(name)) return null;
  const button = document.createElement('button');
  button.className = 'shop-info-btn';
  button.type = 'button';
  const purchased = allowIntermediatePurchase && purchasedIntermediateNames.has(name);
  button.textContent = purchased ? '💰🛒' : '🛒';
  button.title = `${name}の店情報`;
  button.setAttribute('aria-label', `${name}の店情報`);
  button.addEventListener('click', event => {
    event.stopPropagation();
    showShopDialog(name, { allowIntermediatePurchase });
  });
  return button;
}

function appendItemActionButtons(parent, ...buttons) {
  const visibleButtons = buttons.filter(Boolean);
  if (!visibleButtons.length) return null;
  const actions = document.createElement('span');
  actions.className = 'item-action-buttons';
  actions.append(...visibleButtons);
  parent.appendChild(actions);
  return actions;
}

function gatheringMethodClass(method) {
  return method === '採掘' || method === '砕岩' ? 'gathering-method-mining' : 'gathering-method-botany';
}

function parseGatheringTimeRange(timeRange) {
  const match = String(timeRange).match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
  if (!match) return null;
  const start = Number(match[1]) * 60 + Number(match[2]);
  let end = Number(match[3]) * 60 + Number(match[4]);
  if (end <= start) end += 1440;
  return { start, end };
}

function currentEorzeaMinutes(now = Date.now()) {
  return (now * EORZEA_TIME_MULTIPLIER) / 60000;
}

function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${String(seconds).padStart(2, '0')}s`;
}

function gatheringTimeStatus(timeRange, now = Date.now()) {
  const range = parseGatheringTimeRange(timeRange);
  if (!range) return null;
  const etNow = currentEorzeaMinutes(now);
  const etDay = Math.floor(etNow / 1440);
  const candidates = [etDay - 1, etDay, etDay + 1].map(day => ({
    start: day * 1440 + range.start,
    end: day * 1440 + range.end
  }));
  const active = candidates.find(candidate => etNow >= candidate.start && etNow < candidate.end);
  const targetEt = active
    ? active.end
    : candidates.filter(candidate => candidate.start > etNow).sort((a, b) => a.start - b.start)[0]?.start;
  if (!Number.isFinite(targetEt)) return null;
  const remainingMs = ((targetEt - etNow) * 60000) / EORZEA_TIME_MULTIPLIER;
  return {
    active: Boolean(active),
    remaining: formatCountdown(remainingMs)
  };
}

function updateGatheringTimeStatuses() {
  elements.gatheringContent.querySelectorAll('.gathering-time[data-et-range]').forEach(timeChip => {
    const status = gatheringTimeStatus(timeChip.dataset.etRange);
    const label = timeChip.querySelector('.gathering-countdown-label');
    const remaining = timeChip.querySelector('.gathering-countdown-time');
    if (!status || !label || !remaining) return;
    label.textContent = status.active ? '終了まで' : '開始まで';
    label.classList.toggle('active', status.active);
    label.classList.toggle('waiting', !status.active);
    remaining.textContent = status.remaining;
  });
}

function stopGatheringTimerUpdates() {
  if (gatheringTimerIntervalId === null) return;
  window.clearInterval(gatheringTimerIntervalId);
  gatheringTimerIntervalId = null;
}

function startGatheringTimerUpdates() {
  stopGatheringTimerUpdates();
  if (!elements.gatheringOverlay.classList.contains('open') || document.hidden) return;
  updateGatheringTimeStatuses();
  gatheringTimerIntervalId = window.setInterval(updateGatheringTimeStatuses, 1000);
}

function createGatheringNote(label, highlightText, suffix) {
  const note = createTextElement('div', 'gathering-note', '');
  if (label) note.append(label);
  note.appendChild(createTextElement('span', 'gathering-note-highlight', highlightText));
  if (suffix) note.append(suffix);
  return note;
}

function showGatheringDialog(name) {
  stopGatheringTimerUpdates();
  const entries = itemMaster[name]?.gatheringTimer || [];
  elements.gatheringTitle.textContent = `採集情報: ${name}`;
  elements.gatheringContent.replaceChildren();
  if (entries.length === 0) {
    elements.gatheringContent.appendChild(createTextElement('p', 'gathering-empty', '採集情報はありません。'));
  } else {
    let currentArea = '';
    let currentMap = '';
    let areaSection = null;
    let mapSection = null;
    for (const entry of entries) {
      if (entry.Area !== currentArea) {
        currentArea = entry.Area;
        currentMap = '';
        areaSection = createTextElement('section', 'gathering-area-section', '');
        areaSection.appendChild(createTextElement('h3', '', entry.Area || 'その他'));
        elements.gatheringContent.appendChild(areaSection);
      }
      if (entry.Map !== currentMap) {
        currentMap = entry.Map;
        mapSection = createTextElement('section', 'gathering-map-section', '');
        mapSection.appendChild(createTextElement('h4', '', entry.Map));
        areaSection.appendChild(mapSection);
      }
      const block = createTextElement('div', 'gathering-entry', '');
      const head = createTextElement('div', 'gathering-entry-head', '');
      head.appendChild(createTextElement('span', `badge gathering-method ${gatheringMethodClass(entry.Method)}`, entry.Method));
      head.appendChild(createTextElement('span', 'gathering-type', entry.Type));
      block.appendChild(head);
      if (entry.Chronicle) block.appendChild(createGatheringNote('', entry.Chronicle, ' が必要'));
      if (Number.isFinite(Number(entry.RequiredTechnical))) {
        block.appendChild(createGatheringNote('必要技術力: ', formatNumber(Number(entry.RequiredTechnical)), ' 以上'));
      }
      const times = createTextElement('div', 'gathering-times', '');
      for (const time of entry.Times || []) {
        const timeChip = createTextElement('span', 'gathering-time', '');
        timeChip.dataset.etRange = time;
        timeChip.append(
          createTextElement('span', 'gathering-time-et', 'ET'),
          createTextElement('span', 'gathering-time-text', time),
          createTextElement('span', 'gathering-countdown', '')
        );
        timeChip.querySelector('.gathering-countdown').append(
          createTextElement('span', 'gathering-countdown-label', '開始まで'),
          createTextElement('span', 'gathering-time-lt', 'LT'),
          createTextElement('span', 'gathering-countdown-time', '--:--')
        );
        times.appendChild(timeChip);
      }
      block.appendChild(times);
      mapSection.appendChild(block);
    }
  }
  elements.gatheringOverlay.classList.add('open');
  startGatheringTimerUpdates();
}

function closeGatheringDialog() {
  elements.gatheringOverlay.classList.remove('open');
  stopGatheringTimerUpdates();
}

function showShopDialog(name, { allowIntermediatePurchase = false } = {}) {
  const shopInfo = itemMaster[name]?.shopInfo;
  const shops = shopInfo?.shops || [];
  elements.shopTitle.textContent = `店情報: ${name}`;
  elements.shopPriceHeader.replaceChildren();
  elements.shopContent.replaceChildren();
  if (!shops.length) {
    elements.shopContent.appendChild(createTextElement('p', 'shop-empty', '店情報はありません。'));
  } else {
    const price = Number(shopInfo.price);
    if (Number.isFinite(price)) {
      const priceBlock = createTextElement('section', 'shop-price-section', '');
      priceBlock.append(
        createTextElement('h3', '', '販売価格'),
        createTextElement('div', 'shop-price', `${formatNumber(price)}ギル`)
      );
      elements.shopPriceHeader.appendChild(priceBlock);
    }
    if (allowIntermediatePurchase) {
      const purchaseLabel = createTextElement('label', 'shop-purchase-option', '');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = purchasedIntermediateNames.has(name);
      purchaseLabel.append(checkbox, document.createTextNode('この中間素材は購入💰して用意する'));
      checkbox.addEventListener('change', () => {
        purchasedIntermediateContext = currentMaterialPurchaseContext();
        if (checkbox.checked) purchasedIntermediateNames.add(name);
        else purchasedIntermediateNames.delete(name);
        saveViewState();
        renderResultView({ preserveScroll: true });
      });
      elements.shopPriceHeader.appendChild(purchaseLabel);
    }
    const listSection = createTextElement('section', 'shop-list-section', '');
    listSection.appendChild(createTextElement('h3', '', '販売場所'));
    shops.forEach(shop => {
      const entry = createTextElement('div', 'shop-entry', '');
      const hasCoordinates = Number.isFinite(Number(shop.x)) && Number.isFinite(Number(shop.y));
      const location = hasCoordinates ? `${shop.area || ''} X:${shop.x} Y:${shop.y}` : `${shop.area || ''}`;
      entry.append(
        createTextElement('div', 'shop-name', shop.shopName || 'ショップ'),
        createTextElement('div', 'shop-location', location)
      );
      listSection.appendChild(entry);
    });
    elements.shopContent.appendChild(listSection);
  }
  elements.shopOverlay.classList.add('open');
}

function closeShopDialog() {
  elements.shopOverlay.classList.remove('open');
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
  appendItemActionButtons(row, createShopInfoButton(name), createGatheringTimerButton(name));
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
    const collapsed = !children.classList.contains('collapsed');
    setCollapsedAnimated(children, collapsed);
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

function renderMarkdown(markdown) {
  if (!window.marked?.parse || !window.DOMPurify?.sanitize) {
    throw new Error('Markdownレンダラの読み込みに失敗しました');
  }
  window.marked.use({ gfm: true, breaks: false });
  return window.DOMPurify.sanitize(window.marked.parse(markdown));
}

function openMarkdownNotice(title, markdown) {
  elements.licenseTitle.textContent = title;
  try {
    elements.licenseText.innerHTML = renderMarkdown(markdown);
  } catch {
    elements.licenseText.textContent = '文書を表示できませんでした。時間をおいて再度お試しください。';
  }
  elements.licenseOverlay.classList.add('open');
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
  const list = findFavoriteList(listId);
  if (!list || isRecentList(list)) {
    selectedExportListId = null;
    elements.exportCode.value = '';
    elements.exportListToggle.textContent = 'リストを選択...';
    closeExportListDropdown();
    renderExportListChoices();
    return;
  }
  selectedExportListId = listId;
  elements.exportCode.value = encodeFavoriteList(list);
  elements.exportListToggle.textContent = list ? list.name : 'リストを選択...';
  closeExportListDropdown();
  renderExportListChoices();
}

function renderExportListChoices() {
  if (!elements.exportListChoices) return;
  const frag = document.createDocumentFragment();
  const exportableLists = favoriteStore.lists.filter(list => !isRecentList(list));
  if (exportableLists.length === 0) {
    frag.appendChild(createTextElement('li', 'list-empty', 'お気に入りリストがありません'));
  } else {
    exportableLists.forEach(list => {
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
  if (!event.target.closest?.('.custom-select')) closeAllCustomSelects();
  if (
    event.target !== elements.searchBox
    && event.target !== elements.equipmentSearchToggle
    && !elements.searchHistory.contains(event.target)
    && !elements.equipmentSearchPanel?.contains(event.target)
  ) {
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
  elements.searchBox.addEventListener('input', scheduleSearchFromInput);
  elements.searchBox.addEventListener('compositionstart', () => { searchCompositionActive = true; });
  elements.searchBox.addEventListener('compositionend', () => {
    searchCompositionActive = false;
    scheduleSearchFromInput();
  });
  elements.searchBox.addEventListener('blur', commitShortSearch);
  elements.searchBox.addEventListener('click', openSearchHistory);
  elements.searchBox.addEventListener('focus', openSearchHistory);
  elements.searchBox.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeSearchHistory();
    if (event.key === 'Enter' && !event.isComposing) onSearch();
  });
  elements.searchClearBtn.addEventListener('pointerdown', event => event.preventDefault());
  elements.searchClearBtn.addEventListener('click', clearSearch);
  if (elements.equipmentSearchToggle) {
    elements.equipmentSearchToggle.addEventListener('click', () => setEquipmentSearchOpen(!equipmentSearchOpen));
    elements.equipmentJobSelect.addEventListener('change', () => {
      updateEquipmentSlotOptions();
      updateEquipmentItemLevelOptions();
    });
    elements.equipmentLevelInput.addEventListener('input', updateEquipmentItemLevelOptions);
    elements.equipmentLevelInput.addEventListener('blur', commitEquipmentLevelInput);
    elements.equipmentLevelDown5Btn.addEventListener('click', () => {
      elements.equipmentLevelInput.value = String(Math.max(1, equipmentLevelValue() - 5));
      updateEquipmentItemLevelOptions();
    });
    elements.equipmentLevelDownBtn.addEventListener('click', () => {
      elements.equipmentLevelInput.value = String(Math.max(1, equipmentLevelValue() - 1));
      updateEquipmentItemLevelOptions();
    });
    elements.equipmentLevelUpBtn.addEventListener('click', () => {
      elements.equipmentLevelInput.value = String(Math.min(maxEquipmentLevel, equipmentLevelValue() + 1));
      updateEquipmentItemLevelOptions();
    });
    elements.equipmentLevelUp5Btn.addEventListener('click', () => {
      elements.equipmentLevelInput.value = String(Math.min(maxEquipmentLevel, equipmentLevelValue() + 5));
      updateEquipmentItemLevelOptions();
    });
    elements.equipmentItemLevelSelect.addEventListener('change', () => {
      updateEquipmentSearchButtons();
      saveViewState();
    });
    elements.equipmentSlotSelect.addEventListener('change', () => {
      updateEquipmentSearchButtons();
      saveViewState();
    });
    elements.equipmentSearchBtn.addEventListener('click', runEquipmentSearch);
    elements.equipmentSearchResetBtn.addEventListener('click', resetEquipmentSearch);
    elements.saveEquipmentSearchBtn.addEventListener('click', saveEquipmentSearchAsFavorite);
  }
  elements.favBtn.addEventListener('click', toggleFav);
  elements.checkedFavoriteMaterialsBtn.addEventListener('click', openCheckedFavoriteMaterialsMode);
  elements.clearFavoriteMaterialChecksBtn.addEventListener('click', () => {
    clearMaterialSelectedFavoriteLists();
    leaveFavoriteMaterialsMode();
    renderList();
    renderResultView();
  });
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
  elements.gatheringCloseBtn.addEventListener('click', closeGatheringDialog);
  elements.gatheringOverlay.addEventListener('click', event => {
    if (event.target === elements.gatheringOverlay) closeGatheringDialog();
  });
  elements.shopCloseBtn.addEventListener('click', closeShopDialog);
  elements.shopOverlay.addEventListener('click', event => {
    if (event.target === elements.shopOverlay) closeShopDialog();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopGatheringTimerUpdates();
    else startGatheringTimerUpdates();
  });
  window.addEventListener('pagehide', stopGatheringTimerUpdates);
  window.addEventListener('resize', () => {
    if (elements.favoriteLists.classList.contains('open')) updateFavoriteListsMaxHeight();
  });
  elements.usesBtn.addEventListener('click', () => showUsesPanel(selectedRecipe));
  elements.updateReloadBtn.addEventListener('click', () => {
    clearViewState();
    markSkipRestoreOnce();
    location.reload();
  });
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
