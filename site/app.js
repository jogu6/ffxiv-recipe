const DATA_CACHE_VERSION = 'ff14recipe-data-7.50-6e392bcc';
const DATA_FILE = `./data/Item.json?v=${encodeURIComponent(DATA_CACHE_VERSION)}`;
const TIPS_FILE = './data/tips.md';
const ABOUT_URL = ['127.0.0.1', 'localhost'].includes(location.hostname)
  ? `http://${location.hostname}:4174/`
  : 'https://jogu6.github.io/ffxiv-recipe-about/';
const LS_FAV = 'ff14_favorites';
const LS_FAV_LISTS = 'ff14_favorite_lists_v3';
const LS_FAV_LISTS_LEGACY = 'ff14_favorite_lists_v2';
const LS_FAV_COUNTS = 'ff14_favorite_item_counts_v1';
const LS_SEARCH_HISTORY = 'ff14_search_history';
const LS_VIEW_STATE = 'ff14_view_state_v1';
const SS_SKIP_RESTORE_ONCE = 'ff14_skip_restore_once';
const SEARCH_HISTORY_LIMIT = 30;
const FAVORITE_NAME_MAX = 50;
const RECENT_LIST_ID = 'SYSTEM_RECENT_ITEMS';
const RECENT_LIST_NAME = '検索履歴';
const RECENT_LIST_LIMIT = 100;
const FAVORITE_LIST_FILE_TITLE = 'FF14 レシピ素材ツリー お気に入りリスト';
const FAVORITE_LIST_FILE_SEPARATOR = '\n\n----------------------------------------\n\n';
const FAVORITE_LIST_FILE_MAX_BYTES = 1024 * 1024;
const FAVORITE_LIST_FILE_MAX_LISTS = 1000;
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
  mergeAlternativeRequirements,
  mergeSummedRequirements,
  validateRequestedCount
} = RecipeCalculation;

const CRAFT_TYPE_NAME = {
  0: '木工師',
  1: '鍛冶師',
  2: '甲冑師',
  3: '彫金師',
  4: '革細工師',
  5: '裁縫師',
  6: '錬金術師',
  7: '調理師',
  8: '交換',
  9: '交換/精選'
};
const CRAFT_JOBS_SET = new Set(['木工師', '鍛冶師', '甲冑師', '彫金師', '革細工師', '裁縫師', '錬金術師', '調理師']);
const EXCHANGE_CRAFT_TYPES = new Set(['8', '9']);

const CRYSTAL_EXCLUDE = new Set(
  ['ファイア', 'アイス', 'ウィンド', 'アース', 'ライトニング', 'ウォーター'].flatMap(e =>
    ['シャード', 'クリスタル', 'クラスター'].map(t => e + t)
  )
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
  searchRow: document.querySelector('.search-row'),
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
  checkedFavoriteMaterialsHelpBtn: document.getElementById('checkedFavoriteMaterialsHelpBtn'),
  checkedFavoriteSumModeBtn: document.getElementById('checkedFavoriteSumModeBtn'),
  checkedFavoriteAnyOneModeBtn: document.getElementById('checkedFavoriteAnyOneModeBtn'),
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
  exportAllFavoritesBtn: document.getElementById('exportAllFavoritesBtn'),
  importAllFavoritesBtn: document.getElementById('importAllFavoritesBtn'),
  importAllFavoritesFile: document.getElementById('importAllFavoritesFile'),
  favoriteListFileStatus: document.getElementById('favoriteListFileStatus'),
  sharePlazaOpenBtn: document.getElementById('sharePlazaOpenBtn'),
  sharePlazaOverlay: document.getElementById('sharePlazaOverlay'),
  sharePlazaFrame: document.getElementById('sharePlazaFrame'),
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
  shopDialog: document.getElementById('shopDialog'),
  shopTitle: document.getElementById('shopTitle'),
  shopPriceHeader: document.getElementById('shopPriceHeader'),
  shopContent: document.getElementById('shopContent'),
  shopCloseBtn: document.getElementById('shopCloseBtn')
};

// Application state and indexes
let itemMaster = {};
let recipes = {};
let recipeVariants = {};
let activeRecipeIds = {};
let defaultRecipeIds = {};
let recipeNames = [];
let selectedRecipe = null;
let selectedRecipeId = '';
let favoriteStore = { version: 3, selectedListId: null, lists: [] };
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
let floatingDialogScrollState = null;
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
const autoSelectedRecipeNoticeKeys = new Set();
let favoriteMaterialCalcMode = 'sum';
let checkedFavoriteMaterialCalcMode = 'sum';
let favoriteAnyItemProductionExpanded = true;
let favoriteAnyListProductionExpanded = true;
let favoriteListProductionExpanded = {};
const expandedFavoriteCountRows = new Set();
let gatheringTimerIntervalId = null;
let canSaveViewState = false;
let suppressViewStateSave = false;
let purchasedIntermediateContext = '';
let purchasedIntermediateNames = new Set();
let searchInputTimerId = 0;
let searchCompositionActive = false;
let scrollStateSaveFrame = 0;
let viewScrollPositions = {
  recipeList: 0,
  usesList: 0,
  treeContainer: 0,
  panelRight: 0
};

const treePinMap = new Map();
const exchangeTreeState = new Map();
const materialSectionState = new Map();
const intermediateTreeState = new Map();
const CRYSTAL_ELEMENT_ORDER = ['ファイア', 'アイス', 'ウィンド', 'アース', 'ライトニング', 'ウォーター'];
const CRYSTAL_KIND_ORDER = ['シャード', 'クリスタル', 'クラスター'];
const EQUIPMENT_JOB_OPTIONS = [
  'ナイト',
  '剣術士',
  '戦士',
  '斧術士',
  '暗黒騎士',
  'ガンブレイカー',
  '白魔道士',
  '幻術士',
  '学者',
  '占星術師',
  '賢者',
  'モンク',
  '格闘士',
  '竜騎士',
  '槍術士',
  '忍者',
  '双剣士',
  '侍',
  'リーパー',
  'ヴァイパー',
  '魔獣使い',
  '吟遊詩人',
  '弓術士',
  '機工士',
  '踊り子',
  '黒魔道士',
  '呪術士',
  '召喚士',
  '巴術士',
  '赤魔道士',
  'ピクトマンサー',
  '青魔道士',
  '木工師',
  '鍛冶師',
  '甲冑師',
  '彫金師',
  '革細工師',
  '裁縫師',
  '錬金術師',
  '調理師',
  '採掘師',
  '園芸師',
  '漁師'
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
  ファイター: new Set([
    '剣術士',
    '斧術士',
    '格闘士',
    '槍術士',
    '双剣士',
    '弓術士',
    'ナイト',
    '戦士',
    '暗黒騎士',
    'ガンブレイカー',
    'モンク',
    '竜騎士',
    'リーパー',
    '侍',
    '忍者',
    '吟遊詩人',
    '機工士',
    '踊り子',
    'ヴァイパー',
    '魔獣使い'
  ]),
  ソーサラー: new Set([
    '幻術士',
    '呪術士',
    '巴術士',
    '白魔道士',
    '学者',
    '占星術師',
    '賢者',
    '黒魔道士',
    '召喚士',
    '赤魔道士',
    'ピクトマンサー',
    '青魔道士'
  ]),
  クラフター: new Set(['木工師', '鍛冶師', '甲冑師', '彫金師', '革細工師', '裁縫師', '錬金術師', '調理師']),
  ギャザラー: new Set(['採掘師', '園芸師', '漁師'])
};
const CRAFTER_EQUIPMENT_STATS = ['CP', '作業精度', '加工精度'];
const GATHERER_EQUIPMENT_STATS = ['GP', '獲得力', '技術力'];
const EQUIPMENT_ROLE_JOBS = {
  tank: new Set(['剣術士', '斧術士', 'ナイト', '戦士', '暗黒騎士', 'ガンブレイカー']),
  healer: new Set(['幻術士', '白魔道士', '学者', '占星術師', '賢者']),
  striker_slayer: new Set(['格闘士', '槍術士', 'モンク', '竜騎士', 'リーパー', '侍', '魔獣使い']),
  scout_ranger: new Set(['双剣士', '弓術士', '忍者', '吟遊詩人', '機工士', '踊り子', 'ヴァイパー']),
  caster: new Set(['呪術士', '巴術士', '黒魔道士', '召喚士', '赤魔道士', 'ピクトマンサー', '青魔道士']),
  fighter: null,
  sorcerer: null
};
const CASTER_SHIELD_JOBS = new Set(['幻術士', '白魔道士', '呪術士', '黒魔道士']);
const ONE_HANDED_CASTER_WEAPON_CATEGORIES = new Set(['片手幻具', '片手呪具']);
EQUIPMENT_ROLE_JOBS.fighter = EQUIPMENT_JOB_GROUPS.ファイター;
EQUIPMENT_ROLE_JOBS.sorcerer = EQUIPMENT_JOB_GROUPS.ソーサラー;
const CRAFT_JOB_ABBREVIATIONS = {
  木工師: '木工',
  鍛冶師: '鍛冶',
  甲冑師: '甲冑',
  彫金師: '彫金',
  革細工師: '革',
  裁縫師: '裁縫',
  錬金術師: '錬金',
  調理師: '調理'
};
const JOB_ICON_PATHS = {
  木工師: './assets/job-icons/carpenter.webp',
  鍛冶師: './assets/job-icons/blacksmith.webp',
  甲冑師: './assets/job-icons/armorer.webp',
  彫金師: './assets/job-icons/goldsmith.webp',
  革細工師: './assets/job-icons/leatherworker.webp',
  裁縫師: './assets/job-icons/weaver.webp',
  錬金術師: './assets/job-icons/alchemist.webp',
  調理師: './assets/job-icons/culinarian.webp',
  採掘師: './assets/job-icons/miner.webp',
  園芸師: './assets/job-icons/botanist.webp',
  漁師: './assets/job-icons/fisher.webp'
};
const GATHERING_METHOD_JOBS = {
  採掘: '採掘師',
  砕岩: '採掘師',
  伐採: '園芸師',
  草刈: '園芸師'
};

function craftJobName(method) {
  return CRAFT_JOB_ABBREVIATIONS[method] || method;
}

function craftJobLevelLabel(method, craftLevel, masterbook = '') {
  if (masterbook) return masterbook;
  const level = toNumeric(craftLevel, 0);
  return level > 0 ? `${craftJobName(method)}Lv${level}` : craftJobName(method);
}
const EQUIPMENT_JOB_ABBREVIATIONS = Object.fromEntries(
  EQUIPMENT_JOB_OPTIONS.map(job => [job, job.replace(/士$|師$|道士$/u, '').slice(0, 1)])
);
EQUIPMENT_JOB_ABBREVIATIONS['吟遊詩人'] = '詩';
EQUIPMENT_JOB_ABBREVIATIONS['魔獣使い'] = '獣';
const EQUIPMENT_JOB_ORDER = new Map(EQUIPMENT_JOB_OPTIONS.map((job, index) => [job, index]));
function isMobile() {
  return window.innerWidth <= MOBILE_BREAKPOINT;
}

function isPwaDisplayMode() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches
  );
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
function isEnglishFirst(name) {
  return /^[A-Za-z]/.test(name);
}

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
  rememberVisibleScrollPositions();
  writeStoredJson(LS_VIEW_STATE, {
    v: 1,
    dataVersion: DATA_CACHE_VERSION,
    input: {
      search: elements.searchBox.value,
      count: elements.countInput.value,
      active: ['searchBox', 'countInput'].includes(document.activeElement?.id) ? document.activeElement.id : ''
    },
    selected: {
      recipe: selectedRecipe || '',
      recipeId: selectedRecipeId || '',
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
      ringCounts: favoriteMaterialsRingCounts,
      calcMode: favoriteMaterialCalcMode,
      checkedCalcMode: checkedFavoriteMaterialCalcMode,
      anyItemProductionExpanded: favoriteAnyItemProductionExpanded,
      anyListProductionExpanded: favoriteAnyListProductionExpanded,
      listProductionExpanded: Object.fromEntries(
        Object.entries(favoriteListProductionExpanded).filter(
          ([listId, expanded]) => findFavoriteList(listId) && typeof expanded === 'boolean'
        )
      )
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
    },
    scroll: { ...viewScrollPositions }
  });
}

function scrollPositionContainers() {
  return {
    recipeList: elements.recipeList,
    usesList: elements.usesList,
    treeContainer: elements.treeContainer,
    panelRight: elements.panelRight
  };
}

function isScrollPositionActive(key) {
  if (!isMobile()) return true;
  const panel = currentMobilePanel();
  if (key === 'recipeList') return panel === 'left';
  if (key === 'usesList') return panel === 'middle';
  return panel === 'right';
}

function rememberVisibleScrollPositions() {
  Object.entries(scrollPositionContainers()).forEach(([key, container]) => {
    if (isScrollPositionActive(key)) viewScrollPositions[key] = container.scrollTop;
  });
}

function scheduleScrollStateSave() {
  if (scrollStateSaveFrame) return;
  scrollStateSaveFrame = requestAnimationFrame(() => {
    scrollStateSaveFrame = 0;
    saveViewState();
  });
}

function clearViewState() {
  removeStoredItem(LS_VIEW_STATE);
  viewScrollPositions = {
    recipeList: 0,
    usesList: 0,
    treeContainer: 0,
    panelRight: 0
  };
  purchasedIntermediateContext = '';
  purchasedIntermediateNames.clear();
  favoriteListProductionExpanded = {};
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
    const activeInput = ['searchBox', 'countInput'].includes(state.input?.active) ? state.input.active : '';
    const favoriteList = findFavoriteList(state.selected?.favoriteListId);
    const restoredFavoriteMaterialIds = Array.isArray(state.favoriteMaterials?.listIds)
      ? state.favoriteMaterials.listIds.filter(id => {
          const list = findFavoriteList(id);
          return list && !isRecentList(list);
        })
      : [];
    const recipe = recipes[state.selected?.recipe] ? state.selected.recipe : '';
    const recipeId = activateRecipeVariant(recipe, state.selected?.recipeId || '')?.recipeId || '';
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
    selectedRecipeId = recipe ? recipeId : '';
    selectedUsesItem = usesItem || null;
    elements.countInput.value = count || '1';
    readRequestedCount(elements.countInput);
    const restoreFavoriteMaterials =
      state.view?.sourceMode === 'favorite-materials' &&
      (restoredFavoriteMaterialIds.length >= 1 || (favoriteList && !isRecentList(favoriteList)));
    favoriteMaterialsListIds =
      restoreFavoriteMaterials && restoredFavoriteMaterialIds.length >= 1 ? restoredFavoriteMaterialIds : [];
    setResultSourceMode(restoreFavoriteMaterials ? 'favorite-materials' : 'recipe');
    const restoredRecipeLists = restoreFavoriteMaterials
      ? favoriteMaterialsListIds.length > 0
        ? favoriteMaterialsListIds.map(findFavoriteList).filter(Boolean)
        : [favoriteList].filter(Boolean)
      : listMode === 'fav' && favoriteList
        ? [favoriteList]
        : [];
    resolveAndReportRecipeSelections(restoredRecipeLists);
    if (favoriteMaterialsListIds.length === 0 && listMode === 'fav' && favoriteList) {
      applyRecipeSelectionContext(favoriteList.recipeSelections);
      if (selectedRecipe) selectedRecipeId = activeRecipeVariant(selectedRecipe)?.recipeId || '';
    }
    const restoredFavoriteMaterialCalcMode = ['counts', 'any-one'].includes(state.favoriteMaterials?.calcMode)
      ? state.favoriteMaterials.calcMode
      : 'sum';
    favoriteMaterialCalcMode =
      restoreFavoriteMaterials && favoriteMaterialsListIds.length === 0 ? restoredFavoriteMaterialCalcMode : 'sum';
    checkedFavoriteMaterialCalcMode = state.favoriteMaterials?.checkedCalcMode === 'any-one' ? 'any-one' : 'sum';
    favoriteAnyItemProductionExpanded = state.favoriteMaterials?.anyItemProductionExpanded !== false;
    favoriteAnyListProductionExpanded = state.favoriteMaterials?.anyListProductionExpanded !== false;
    favoriteListProductionExpanded = Object.fromEntries(
      Object.entries(state.favoriteMaterials?.listProductionExpanded || {}).filter(
        ([listId, expanded]) => findFavoriteList(listId) && typeof expanded === 'boolean'
      )
    );
    if (restoreFavoriteMaterials && favoriteMaterialsListIds.length === 0 && favoriteList) {
      getFavoriteCountState(favoriteList).enabled = favoriteMaterialCalcMode !== 'sum';
    }
    favoriteMaterialsRingCounts = normalizeFavoriteMaterialsRingCounts(state.favoriteMaterials?.ringCounts);
    materialSectionState.clear();
    Object.entries(normalizeMaterialSectionState(state.materials?.sections)).forEach(([key, collapsed]) =>
      materialSectionState.set(key, collapsed)
    );
    purchasedIntermediateContext =
      typeof state.materials?.purchasedContext === 'string' ? state.materials.purchasedContext : '';
    purchasedIntermediateNames = new Set(
      Array.isArray(state.materials?.purchasedNames)
        ? state.materials.purchasedNames.filter(name => typeof name === 'string')
        : []
    );
    if (resultSourceMode === 'favorite-materials') {
      selectedRecipe = null;
      selectedRecipeId = '';
    }
    setResultViewMode(state.view?.resultMode === 'materials' ? 'materials' : 'tree');
    updateFavoriteButtonState();
    renderList();
    renderResultView();
    if (restoreFavoriteMaterials) {
      renderFavoriteLists();
      elements.favoriteLists.classList.add('open');
      updateFavoriteListsMaxHeight();
    }

    if (selectedUsesItem) showUsesPanel(selectedUsesItem, { record: false });

    if (isMobile()) {
      const panel = state.view?.mobilePanel;
      if (panel === 'right' && (selectedRecipe || resultSourceMode === 'favorite-materials')) showMobilePanel('right');
      else if (panel === 'middle' && selectedUsesItem) showMobilePanel('middle');
      else showMobilePanel('left');
    } else {
      clearMobilePanels();
    }
    const restoredScroll = state.scroll || {};
    viewScrollPositions = {
      recipeList: Math.max(0, toNumeric(restoredScroll.recipeList)),
      usesList: Math.max(0, toNumeric(restoredScroll.usesList)),
      treeContainer: Math.max(0, toNumeric(restoredScroll.treeContainer)),
      panelRight: Math.max(0, toNumeric(restoredScroll.panelRight))
    };
    const restoreScrollPositions = () => {
      Object.entries(scrollPositionContainers()).forEach(([key, container]) => {
        container.scrollTop = viewScrollPositions[key];
      });
    };
    restoreScrollPositions();
    requestAnimationFrame(restoreScrollPositions);
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
  const normalized = {};
  Object.entries(value).forEach(([key, countOrMap]) => {
    if ([0, 1, 2].includes(countOrMap)) {
      normalized[key] = countOrMap;
      return;
    }
    if (!countOrMap || typeof countOrMap !== 'object') return;
    const counts = Object.fromEntries(Object.entries(countOrMap).filter(([, count]) => [0, 1, 2].includes(count)));
    if (Object.keys(counts).length > 0) normalized[key] = counts;
  });
  return normalized;
}

function normalizeMaterialSectionState(value) {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value).filter(([key, collapsed]) => typeof key === 'string' && typeof collapsed === 'boolean')
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
  return (
    [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate())].join('-') +
    ' ' +
    [pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds())].join(':')
  );
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
  return [...new Set(itemIds.map(id => parseInt(id, 10)).filter(id => Number.isInteger(id) && id > 0))];
}

function normalizeRecipeSelections(value) {
  const stored = normalizeStoredRecipeSelections(value);
  const normalized = {};
  Object.entries(stored).forEach(([itemId, recipeId]) => {
    const name = itemNameForId(itemId);
    const variants = recipeVariants[name] || [];
    if (variants.length <= 1 || !variants.some(variant => variant.recipeId === recipeId)) return;
    normalized[itemId] = recipeId;
  });
  return normalized;
}

function normalizeStoredRecipeSelections(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const normalized = {};
  Object.entries(value).forEach(([itemId, recipeId]) => {
    const numericId = parseInt(itemId, 10);
    if (!Number.isInteger(numericId) || numericId <= 0 || typeof recipeId !== 'string' || !recipeId) return;
    normalized[String(numericId)] = recipeId;
  });
  return normalized;
}

function withDuplicateSuffix(baseName, suffixNumber) {
  if (suffixNumber === 0) return baseName.slice(0, FAVORITE_NAME_MAX);
  const suffix = `（${suffixNumber}）`;
  return `${baseName.slice(0, FAVORITE_NAME_MAX - suffix.length)}${suffix}`;
}

function uniqueFavoriteListName(name, excludeId = null) {
  const baseName = normalizeFavoriteListName(name);
  const exists = candidate => favoriteStore.lists.some(list => list.id !== excludeId && list.name === candidate);

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
    itemIds: normalizedIds,
    recipeSelections: {}
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

function favoriteRecipeSelection(name, list = getDisplayedFavoriteList()) {
  const itemId = itemIdForName(name);
  if (!list || !itemId || (recipeVariants[name] || []).length <= 1) return '';
  return list.recipeSelections?.[String(itemId)] || '';
}

function setFavoriteRecipeSelection(name, recipeId, list = getDisplayedFavoriteList()) {
  const itemId = itemIdForName(name);
  const variants = recipeVariants[name] || [];
  if (!list || isRecentList(list) || !itemId || variants.length <= 1) return false;
  if (!variants.some(variant => variant.recipeId === recipeId)) return false;
  if (!list.recipeSelections) list.recipeSelections = {};
  if (list.recipeSelections[String(itemId)] === recipeId) return false;
  list.recipeSelections[String(itemId)] = recipeId;
  saveFavorites();
  return true;
}

function collectActiveRecipeSelections(rootNames) {
  const selections = {};
  const visited = new Set();
  const stack = [...rootNames];
  while (stack.length > 0) {
    const name = stack.pop();
    if (!name || visited.has(name)) continue;
    visited.add(name);
    const variants = recipeVariants[name] || [];
    const recipe = activeRecipeVariant(name);
    if (!recipe) continue;
    if (variants.length > 1 && recipe.recipeId) {
      const itemId = itemIdForName(name);
      if (itemId) selections[String(itemId)] = recipe.recipeId;
    }
    recipe.ingredients.forEach(ingredient => {
      if (recipes[ingredient.name]) stack.push(ingredient.name);
    });
  }
  return selections;
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
  favoriteMaterialsRingCounts = {};
  checkedFavoriteMaterialCalcMode = 'sum';
  favoriteAnyListProductionExpanded = true;
  saveFavorites();
  renderFavoriteLists();
  updateCheckedFavoriteMaterialsButton();
  return true;
}

function updateCheckedFavoriteMaterialsButton() {
  if (!elements.checkedFavoriteMaterialsActions) return;
  const active = hasMaterialSelectedFavoriteLists();
  elements.checkedFavoriteMaterialsActions.classList.toggle('visible', active);
  elements.panelLeft
    .querySelector('.panel-left-header')
    ?.classList.toggle('favorite-material-selection-active', active);
  elements.searchRow?.setAttribute('aria-hidden', String(active));
  if (active && document.activeElement === elements.searchBox) elements.searchBox.blur();
  elements.searchBox.disabled = active || equipmentSearchOpen;
  elements.equipmentSearchToggle.disabled = active;
  elements.checkedFavoriteSumModeBtn?.classList.toggle('active', checkedFavoriteMaterialCalcMode === 'sum');
  elements.checkedFavoriteAnyOneModeBtn?.classList.toggle('active', checkedFavoriteMaterialCalcMode === 'any-one');
  if (elements.favoriteLists?.classList.contains('open')) updateFavoriteListsMaxHeight();
}

function getActiveFavoriteMaterialLists() {
  if (favoriteMaterialsListIds.length >= 1) {
    const selected = favoriteMaterialsListIds.map(findFavoriteList).filter(list => list && !isRecentList(list));
    if (selected.length >= 1) return selected;
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

function createFavoriteList(name, itemIds = [], recipeSelections = {}, { captureSelections = false } = {}) {
  const normalizedItemIds = normalizeItemIds(itemIds);
  const capturedSelections = captureSelections
    ? collectActiveRecipeSelections(normalizedItemIds.map(itemNameForId).filter(Boolean))
    : {};
  const list = {
    id: createFavoriteListId(),
    name: uniqueFavoriteListName(name),
    itemIds: normalizedItemIds,
    recipeSelections: normalizeRecipeSelections({ ...capturedSelections, ...recipeSelections }),
    materialSelected: false
  };
  favoriteStore.lists.push(list);
  favoriteStore.selectedListId = list.id;
  saveFavorites();
  return list;
}

function loadFavorites() {
  localStorage.removeItem(LS_FAV);
  const storedV3 = readStoredJson(LS_FAV_LISTS, null);
  const storedV2 = storedV3 ? null : readStoredJson(LS_FAV_LISTS_LEGACY, null);
  const stored = storedV3 || storedV2;
  const storedLists = Array.isArray(stored?.lists)
    ? stored.lists.map(list => ({
        id: typeof list.id === 'string' ? list.id : createFavoriteListId(),
        name: normalizeFavoriteListName(list.name),
        itemIds: normalizeItemIds(list.itemIds),
        recipeSelections: isRecentList(list) ? {} : normalizeStoredRecipeSelections(list.recipeSelections),
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
    version: 3,
    selectedListId: lists.some(list => list.id === stored?.selectedListId) ? stored.selectedListId : null,
    lists
  };
  const saved = saveFavorites();
  if (storedV2 && saved) {
    const verified = readStoredJson(LS_FAV_LISTS, null);
    if (JSON.stringify(verified) === JSON.stringify(favoriteStore)) removeStoredItem(LS_FAV_LISTS_LEGACY);
  }
  loadFavoriteItemCountStore();
}

function saveFavorites() {
  try {
    writeStoredJson(LS_FAV_LISTS, favoriteStore);
    return true;
  } catch {
    return false;
  }
}

function validateFavoriteRecipeSelections() {
  let changed = false;
  favoriteStore.lists.forEach(list => {
    if (isRecentList(list)) return;
    const normalized = normalizeRecipeSelections(list.recipeSelections);
    if (JSON.stringify(normalized) === JSON.stringify(list.recipeSelections || {})) return;
    list.recipeSelections = normalized;
    changed = true;
  });
  if (changed) saveFavorites();
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
      {
        counts: state.counts || {},
        anyOneTargets: state.anyOneTargets || {}
      }
    ])
  );
  writeStoredJson(LS_FAV_COUNTS, { version: 1, lists });
}

function getFavoriteCountState(list = getDisplayedFavoriteList()) {
  if (!list || isRecentList(list)) return { enabled: false, counts: {} };
  if (!favoriteItemCountStore.lists[list.id]) {
    favoriteItemCountStore.lists[list.id] = {
      enabled: false,
      counts: {},
      anyOneTargets: {}
    };
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

function equipmentHasPositiveStat(master, statNames) {
  const stats = master?.equipmentInfo?.stats || {};
  return statNames.some(name => toNumeric(stats[name]) > 0);
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
  if (jobs.includes('全クラス')) {
    if (EQUIPMENT_JOB_GROUPS.クラフター.has(job) && equipmentHasPositiveStat(master, CRAFTER_EQUIPMENT_STATS)) {
      return true;
    }
    if (EQUIPMENT_JOB_GROUPS.ギャザラー.has(job) && equipmentHasPositiveStat(master, GATHERER_EQUIPMENT_STATS)) {
      return true;
    }
  }
  if (!jobs.some(group => ['全クラス', 'ファイター', 'ソーサラー'].includes(group))) return false;
  const recommendedRole = master?.equipmentInfo?.recommendedRole || '';
  if (!recommendedRole) return false;
  if (!EQUIPMENT_ROLE_JOBS[recommendedRole]?.has(job)) return false;
  const broadJobMatches =
    jobs.includes('全クラス') ||
    (jobs.includes('ファイター') && EQUIPMENT_JOB_GROUPS.ファイター.has(job)) ||
    (jobs.includes('ソーサラー') && EQUIPMENT_JOB_GROUPS.ソーサラー.has(job));
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
  return [...jobs].sort(
    (a, b) =>
      (EQUIPMENT_JOB_ORDER.get(a) ?? Number.MAX_SAFE_INTEGER) - (EQUIPMENT_JOB_ORDER.get(b) ?? Number.MAX_SAFE_INTEGER)
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
  const top = below >= desiredHeight || below >= rect.top ? rect.bottom + 3 : Math.max(8, rect.top - desiredHeight - 3);
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
  const option = [...select.querySelectorAll('.custom-select-option')].find(row => row.dataset.value === normalized);
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
  const normalizedEntries = entries.map(entry => (Array.isArray(entry) ? entry : [entry, entry]));
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
  setCustomSelectValue(
    select,
    normalizedEntries.some(([value]) => String(value) === String(preferred)) ? preferred : fallback
  );
  toggle.disabled = normalizedEntries.length === 0;
}

function buildEquipmentSearchIndexes() {
  equipmentSearchIndex = new Map(
    EQUIPMENT_JOB_OPTIONS.map(job => [
      job,
      {
        levels: new Map(),
        specialSlots: new Set()
      }
    ])
  );
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
        jobIndex.levels.set(equipLevel, {
          itemLevels: new Set(),
          slots: new Map()
        });
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
  const specialSlots =
    equipmentSearchIndex.get(customSelectValue(elements.equipmentJobSelect))?.specialSlots || new Set();
  const options = EQUIPMENT_SLOT_OPTIONS.filter(
    ([slot]) => !['shield', 'mainTool', 'offTool'].includes(slot) || specialSlots.has(slot)
  );
  setCustomSelectOptions(elements.equipmentSlotSelect, options, preferred);
}

function setupEquipmentSearchControls() {
  if (!elements.equipmentSearchToggle) return;
  setCustomSelectOptions(
    elements.equipmentJobSelect,
    [['', '---'], ...EQUIPMENT_JOB_OPTIONS.map(job => [job, job])],
    ''
  );
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

function updateEquipmentItemLevelOptions(preferredItemLevel = null) {
  const rawLevel = equipmentLevelInputValue();
  if (rawLevel <= 0) {
    setCustomSelectOptions(elements.equipmentItemLevelSelect, []);
    updateEquipmentSearchButtons();
    saveViewState();
    return;
  }
  const level = Math.max(1, Math.min(maxEquipmentLevel, rawLevel));
  const job = customSelectValue(elements.equipmentJobSelect);
  const availableLevels = equipmentLevelsForJob(job).filter(candidate => candidate <= level);
  const sourceLevel = availableLevels[0] || 0;
  const sourceItemLevels = [
    ...(equipmentSearchIndex.get(job)?.levels.get(sourceLevel)?.itemLevels || [])
  ];
  const sourceMaxItemLevel = Math.max(0, ...sourceItemLevels);
  const higherFallbackItemLevels = availableLevels
    .slice(1)
    .flatMap(candidate => [...(equipmentSearchIndex.get(job)?.levels.get(candidate)?.itemLevels || [])])
    .filter(itemLevel => itemLevel > sourceMaxItemLevel);
  const itemLevels = [...new Set([...sourceItemLevels, ...higherFallbackItemLevels])].sort((a, b) => b - a);
  const selectedItemLevel = preferredItemLevel === null ? itemLevels[0] : preferredItemLevel;
  setCustomSelectOptions(elements.equipmentItemLevelSelect, itemLevels.map(String), String(selectedItemLevel || ''));
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
    customSelectValue(elements.equipmentJobSelect) &&
    rawLevel >= 1 &&
    rawLevel <= maxEquipmentLevel &&
    selectedEquipmentItemLevel() &&
    customSelectValue(elements.equipmentSlotSelect)
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
  elements.searchBox.disabled = open || hasMaterialSelectedFavoriteLists();
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
  updateEquipmentSearchButtons();
  saveViewState();
}

function findEquipmentMatchesAtLevel(level, itemLevel, job, slot) {
  const slotIndex = equipmentSearchIndex.get(job)?.levels.get(level)?.slots.get(slot);
  if (!slotIndex) return [];
  if (itemLevel) {
    const availableItemLevel = [...slotIndex.keys()]
      .filter(candidate => candidate <= itemLevel)
      .sort((a, b) => b - a)[0];
    return availableItemLevel ? [...(slotIndex.get(availableItemLevel) || [])] : [];
  }
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

function equipmentParameterComparisonKey(name) {
  const master = itemMaster[name];
  if (!isEquipmentSearchTarget(master)) return '';
  const slot = equipmentSlotForItem(master);
  return [
    slot,
    equipmentEquipLevel(master),
    equipmentItemLevel(master),
    equipmentPerformanceScore(master, slot),
    equipmentSpecialtyScore(master)
  ].join(':');
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
      slot === 'shield' &&
      selectedSlot === 'all' &&
      CASTER_SHIELD_JOBS.has(job) &&
      selectedWeapons.length > 0 &&
      !selectedWeapons.some(name => ONE_HANDED_CASTER_WEAPON_CATEGORIES.has(itemMaster[name]?.uiCategoryName))
    )
      return;
    for (let level = requestedLevel; level >= 1; level -= 1) {
      const matches = findEquipmentMatchesAtLevel(level, requestedItemLevel, job, slot);
      if (matches.length === 0) continue;
      const maxItemLevel = Math.max(...matches.map(name => equipmentItemLevel(itemMaster[name])));
      const itemLevelMatches = matches.filter(name => equipmentItemLevel(itemMaster[name]) === maxItemLevel);
      const maxPerformance = Math.max(
        ...itemLevelMatches.map(name => equipmentPerformanceScore(itemMaster[name], slot))
      );
      const performanceMatches = itemLevelMatches.filter(
        name => equipmentPerformanceScore(itemMaster[name], slot) === maxPerformance
      );
      const maxSpecialty = Math.max(...performanceMatches.map(name => equipmentSpecialtyScore(itemMaster[name])));
      const specialtyMatches =
        maxSpecialty > 0
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
  selectedRecipeId = '';
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
    const list = createFavoriteList(value, itemIds, {}, { captureSelections: true });
    setEquipmentSearchOpen(false);
    selectFavoriteList(list.id);
  });
}

function showConfirm(msg, onYes) {
  elements.confirmOverlay.classList.remove('recipe-resolution-info');
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
  elements.confirmOverlay.classList.remove('recipe-resolution-info');
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
  elements.confirmOverlay.classList.remove('recipe-resolution-info');
  elements.confirmMsg.classList.toggle('markdown-content', markdown);
  if (markdown) elements.confirmMsg.innerHTML = renderMarkdown(msg);
  else elements.confirmMsg.textContent = msg;
  pendingConfirmAction = null;
  elements.confirmOverlay.classList.add('info');
  elements.confirmYes.classList.add('hidden');
  elements.confirmNo.textContent = '閉じる';
  elements.confirmOverlay.classList.add('open');
}

function showRecipeResolutionInfo(content) {
  elements.confirmMsg.classList.remove('markdown-content');
  elements.confirmMsg.replaceChildren(content);
  pendingConfirmAction = null;
  elements.confirmOverlay.classList.add('info', 'recipe-resolution-info');
  elements.confirmYes.classList.add('hidden');
  elements.confirmNo.textContent = '閉じる';
  elements.confirmOverlay.classList.add('open');
}

function closeConfirm() {
  elements.confirmOverlay.classList.remove('open');
  elements.confirmOverlay.classList.remove('info');
  elements.confirmOverlay.classList.remove('recipe-resolution-info');
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
  selectedRecipeId = '';
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
  if (shouldAdd) {
    list.recipeSelections = {
      ...collectActiveRecipeSelections([name]),
      ...(list.recipeSelections || {})
    };
  }
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
  const selectedList = findFavoriteList(listId);
  resolveAndReportRecipeSelections([selectedList].filter(Boolean));
  applyRecipeSelectionContext(selectedList?.recipeSelections || {});
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
    delete favoriteListProductionExpanded[listId];
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
  const activeCount = recipeNames.filter(name => {
    const itemId = itemIdForName(name);
    if (!countState.enabled) return true;
    return favoriteAnyOneMode() ? favoriteAnyOneTarget(itemId, list) : favoriteItemCount(itemId, list) > 0;
  }).length;

  const li = document.createElement('li');
  li.className = 'favorite-materials-row';
  const materialButton = document.createElement('button');
  materialButton.className = 'favorite-list-action favorite-list-action-compact';
  materialButton.classList.toggle('active', resultSourceMode === 'favorite-materials');
  materialButton.type = 'button';
  materialButton.textContent =
    countState.enabled && activeCount < recipeCount
      ? `素材リストを表示(${activeCount}/${recipeCount})`
      : '素材リストを表示';
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
    if (enable) favoriteAnyItemProductionExpanded = true;
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
  anyOneButton.textContent = 'どれか1アイテム';
  anyOneButton.addEventListener('click', event => {
    event.stopPropagation();
    const enable = !favoriteAnyOneMode();
    favoriteItemReorderEnabled = false;
    countState.enabled = enable;
    favoriteMaterialCalcMode = enable ? 'any-one' : 'sum';
    if (enable) favoriteAnyItemProductionExpanded = true;
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
    openMarkdownNotice(
      '拡張機能について',
      `### 並び替え

お気に入りリスト内のアイテム順を変更します。素材リストの計算内容は変わりません。

### 個数指定

アイテムごとに作りたい個数を指定し、その合計に必要な素材リストを表示します。0個のアイテムは素材リストから外れます。

個数指定中に使える操作:

- **全て1個**  
  お気に入りリスト内全アイテムの個数をまとめて1個にします。
- **全て0個**  
  お気に入りリスト内全アイテムの個数をまとめて0個にします。

### どれか1アイテム

チェックしたアイテムのうち、どれか1つをセット数分制作するために必要な素材リストを表示します。チェックした全てを制作する素材リストではありません。

完成品が直接使う同じ末端素材と、同じ中間素材は、候補間で最も多く必要な数を1回分だけ表示します。異なる中間素材はそれぞれ表示し、それらの製作に共通して使う末端素材は合算します。

どれか1アイテム中に使える操作:

- **全てOn**  
  お気に入りリスト内全アイテムをまとめてチェックします。
- **全てOff**  
  お気に入りリスト内全アイテムのチェックをまとめて外します。`
    );
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
  const showBulkButtons =
    countState.enabled && (favoriteMaterialCalcMode === 'counts' || favoriteMaterialCalcMode === 'any-one');
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
    const list = createFavoriteList(value, source.itemIds, source.recipeSelections);
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
        if (resultSourceMode === 'favorite-materials' && favoriteMaterialsListIds.length >= 1) {
          favoriteMaterialsListIds = getMaterialSelectedFavoriteLists().map(entry => entry.id);
          if (favoriteMaterialsListIds.length === 0) leaveFavoriteMaterialsMode();
          else ensureFavoriteMaterialsRingCounts();
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
    const list = createFavoriteList(value, id ? [id] : [], {}, { captureSelections: true });
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
  favoriteStore.lists
    .filter(list => !isRecentList(list))
    .forEach(list => {
      frag.appendChild(
        createFavoriteTargetButton(list.name, list.id === selectedList?.id, () => {
          confirmFavoriteTargetOnMobile(name, list, () => {
            addFavoriteToList(name, list.id);
          });
        })
      );
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

function createJobIcon(jobName) {
  const icon = createItemIcon(JOB_ICON_PATHS[jobName], 'job-icon');
  if (icon) icon.setAttribute('aria-hidden', 'true');
  return icon;
}

function createJobBadge(jobName, className, label) {
  const badge = createTextElement('span', `${className} job-badge`, '');
  const icon = createJobIcon(jobName);
  if (icon) badge.appendChild(icon);
  badge.append(label);
  return badge;
}

function createCraftJobLabel(jobName, className, label) {
  const wrapper = createTextElement('span', 'craft-job-label', '');
  const icon = createJobIcon(jobName);
  if (icon) wrapper.appendChild(icon);
  wrapper.appendChild(createTextElement('span', `${className} job-badge`, label));
  return wrapper;
}

function masterbookGroups(craftInfo) {
  const groups = new Map();
  for (const info of craftInfo || []) {
    if (!info?.masterbook || !CRAFT_JOBS_SET.has(info.job)) continue;
    const commonName = String(info.masterbook).replace(/^[^:]*秘伝書/u, '秘伝書');
    if (!groups.has(commonName)) groups.set(commonName, []);
    if (!groups.get(commonName).some(entry => entry.job === info.job)) groups.get(commonName).push(info);
  }
  return [...groups.entries()];
}

function createMasterbookLabel(commonName, craftInfo, className) {
  if (craftInfo.length === 1) {
    const label = createCraftJobLabel(
      craftInfo[0].job,
      `${className} ${methodBadgeClass(craftInfo[0].job)}`,
      craftInfo[0].masterbook
    );
    label.title = `${craftInfo[0].job}: ${craftInfo[0].masterbook}`;
    return label;
  }
  const wrapper = createTextElement('span', 'craft-job-label masterbook-job-label', '');
  const icons = createTextElement('span', 'masterbook-job-icons', '');
  for (const info of craftInfo) {
    const icon = createJobIcon(info.job);
    if (icon) icons.appendChild(icon);
  }
  wrapper.append(
    icons,
    createTextElement('span', `${className} badge-masterbook job-badge`, commonName)
  );
  wrapper.title = craftInfo.map(info => `${info.job}: ${info.masterbook}`).join('\n');
  return wrapper;
}

function createCraftRequirementLabels(master, className, { requireLevel = false } = {}) {
  const groups = masterbookGroups(master.craftInfo);
  if (groups.length > 0) {
    return groups.map(([commonName, craftInfo]) => createMasterbookLabel(commonName, craftInfo, className));
  }
  if (!CRAFT_JOBS_SET.has(master.method) || (requireLevel && master.craftLevel <= 0)) return [];
  return [
    createCraftJobLabel(
      master.method,
      `${className} ${methodBadgeClass(master.method)}`,
      craftJobLevelLabel(master.method, master.craftLevel)
    )
  ];
}

function recipeVariantMaster(name, variant = null) {
  const master = itemMaster[name] || {};
  const recipe = variant || activeRecipeVariant(name);
  if (!recipe) return master;
  const craftInfo = recipe.craftInfo;
  const method = CRAFT_TYPE_NAME[recipe.craftType] || master.method || 'クラフト';
  return {
    ...master,
    method,
    craftType: recipe.craftType,
    craftLevel: toNumeric(craftInfo?.level, master.craftLevel || 0),
    masterbook: craftInfo?.masterbook || '',
    craftInfo: craftInfo ? [craftInfo] : []
  };
}

function createItemDisplayLabel(
  name,
  {
    favorite = false,
    recipeVariant = null,
    provisional = false,
    hideCraftRequirement = false,
    hideEquipmentParameters = false
  } = {}
) {
  const master = recipeVariant ? recipeVariantMaster(name, recipeVariant) : itemMaster[name] || {};
  const wrapper = document.createElement('span');
  wrapper.className = favorite ? 'favorite-item-label item-list-label' : 'item-list-label';
  const badges = document.createElement('span');
  badges.className = 'item-list-badges';

  if (!hideCraftRequirement) {
    for (const label of createCraftRequirementLabels(
      master,
      `${favorite ? 'favorite-item-job ' : ''}badge`,
      { requireLevel: true }
    )) {
      badges.appendChild(label);
    }
  }
  if (isEquipmentSearchTarget(master)) {
    badges.append(
      createTextElement(
        'span',
        'badge badge-equipment',
        `Lv${equipmentEquipLevel(master)}/IL${equipmentItemLevel(master)}`
      )
    );
    const jobs = sortEquipmentJobs(
      equipmentJobs(master).filter(
        job => !['全クラス', 'ファイター', 'ソーサラー', 'クラフター', 'ギャザラー'].includes(job)
      )
    );
    const role = master.equipmentInfo?.recommendedRole || '';
    let targetLabel = jobs.map(job => EQUIPMENT_JOB_ABBREVIATIONS[job] || job).join('');
    if (!targetLabel && role === 'fighter') targetLabel = 'ファイター';
    else if (!targetLabel && role === 'sorcerer') targetLabel = 'ソーサラー';
    else if (!targetLabel && EQUIPMENT_ROLE_JOBS[role]) {
      targetLabel = sortEquipmentJobs(EQUIPMENT_ROLE_JOBS[role])
        .map(job => EQUIPMENT_JOB_ABBREVIATIONS[job] || job)
        .join('');
    }
    if (targetLabel) badges.append(createTextElement('span', 'badge badge-equipment-job', targetLabel));
  }
  if (master.isEx === true) {
    badges.append(createTextElement('span', 'badge badge-ex', '譲渡・出品✖'));
  }

  const nameElement = createTextElement('span', favorite ? 'favorite-item-name list-name' : 'list-name', name);
  if (badges.childElementCount > 0) wrapper.appendChild(badges);
  wrapper.appendChild(nameElement);
  if (
    !hideEquipmentParameters &&
    (listMode === 'equipment' || listMode === 'fav') &&
    equipmentParameterDisplayNames.has(name)
  ) {
    const comparisonKey = equipmentParameterComparisonKey(name);
    const peers = [...equipmentParameterDisplayNames].filter(
      peerName => equipmentParameterComparisonKey(peerName) === comparisonKey
    );
    const parameters = Object.entries(master.equipmentInfo?.stats || {})
      .filter(([, value]) => Number(value) > 0)
      .filter(
        ([label, value]) =>
          !peers.every(peerName => Number(itemMaster[peerName]?.equipmentInfo?.stats?.[label] || 0) === Number(value))
      )
      .map(([label, value]) => `${label} +${formatNumber(Number(value))}`)
      .join(' / ');
    if (parameters) wrapper.appendChild(createTextElement('span', 'equipment-parameters', parameters));
  }
  return wrapper;
}

function createItemListRow(name, className = '', { recipeVariant = null, provisional = false } = {}) {
  const row = document.createElement('li');
  row.className = className;
  row.title = name;

  const icon = createItemIcon(itemMaster[name]?.icon);
  if (icon) row.appendChild(icon);
  row.appendChild(
    createItemDisplayLabel(name, {
      favorite: className.split(/\s+/).includes('fav-item-row'),
      recipeVariant,
      provisional
    })
  );
  return row;
}

function createEmptyListItem(message) {
  return createTextElement('li', 'list-empty', message);
}

function createSearchEmptyListItem() {
  const item = createTextElement('li', 'list-empty search-list-empty', '');
  item.append(
    createTextElement('div', 'search-empty-message', '条件に一致するアイテムがありません'),
    createTextElement(
      'div',
      'search-empty-scope',
      '⚠️ このアプリには、製作レシピがあるアイテムと、製作に必要なアイテムのみ登録されています。'
    )
  );
  return item;
}

function createMarkdownElement(tagName, className, html) {
  const element = document.createElement(tagName);
  element.className = className;
  element.innerHTML = html;
  return element;
}

function createAboutAppLink() {
  const container = document.createElement('div');
  container.className = 'tips-about-link';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tips-about-btn';
  button.textContent = 'このアプリは何ですか？';
  button.dataset.url = ABOUT_URL;
  button.addEventListener('click', () => {
    window.location.href = ABOUT_URL;
  });
  const description = document.createElement('span');
  description.className = 'tips-about-description';
  description.textContent = '← 選択すると、このアプリでできることや各種機能の説明画面が表示されます';
  container.append(button, description);
  return container;
}

function renderTips() {
  [elements.tipsMsg, elements.mobileTipsMsg].forEach(container => {
    const rows = tipsData.map(tip => createMarkdownElement('div', 'tips-row markdown-content', tip.html));
    container.replaceChildren(createAboutAppLink(), ...rows);
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
  const byComparison = new Map();
  names.forEach(name => {
    const key = equipmentParameterComparisonKey(name);
    if (!key) return;
    if (!byComparison.has(key)) byComparison.set(key, []);
    byComparison.get(key).push(name);
  });
  byComparison.forEach(comparisonNames => {
    if (comparisonNames.length > 1) {
      comparisonNames.forEach(name => equipmentParameterDisplayNames.add(name));
    }
  });
}

function renderList({ preserveScroll = false } = {}) {
  const scrollTop = elements.recipeList.scrollTop;
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
    frag.appendChild(createSearchEmptyListItem());
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
      else if (recipes[name]) {
        for (const variant of recipeVariants[name] || [recipes[name]]) {
          frag.appendChild(makeRecipeLi(name, variant));
        }
      }
      else frag.appendChild(makeIngredientLi(name));
    });
  }

  if (listMode === 'fav' && getDisplayedFavoriteList() && !hasMaterialSelectedFavoriteLists()) {
    frag.appendChild(createFavoriteSaveRow());
  }

  elements.recipeList.replaceChildren(frag);
  elements.recipeList.scrollTop = preserveScroll ? scrollTop : 0;
  saveViewState();
}

function makeFavLi(name, index) {
  const list = getDisplayedFavoriteList();
  const savedRecipeId = favoriteRecipeSelection(name, list);
  const variants = recipeVariants[name] || [];
  const provisional = variants.length > 1 && !savedRecipeId;
  const variant =
    variants.find(candidate => candidate.recipeId === savedRecipeId) ||
    defaultRecipeVariantForName(name) ||
    activeRecipeVariant(name);
  const li = createItemListRow(name, 'fav-item-row', { recipeVariant: variant, provisional });
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
    li.appendChild(
      createReorderHandle(`「${name}」を並び替え`, event => {
        startReorderDrag(event, {
          container: elements.recipeList,
          rowSelector: '#recipeList li.fav-item-row[data-reorder-index]',
          onReorder: reorderFavoriteItems
        });
      })
    );
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
        renderList({ preserveScroll: true });
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
        renderList({ preserveScroll: true });
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
    if (recipes[name]) selectRecipeByName(name, variant?.recipeId || '');
    else {
      clearMaterialSelectedFavoriteLists();
      markRecipeListSelection(li);
      showUsesPanel(name);
    }
  });
  return li;
}

function makeRecipeLi(name, variant = activeRecipeVariant(name)) {
  const li = createItemListRow(name, 'recipe-variant-row', { recipeVariant: variant });
  li.dataset.recipeId = variant?.recipeId || '';
  li.classList.toggle(
    'selected',
    selectedRecipe === name && (!variant?.recipeId || selectedRecipeId === variant.recipeId)
  );
  appendItemActionButtons(li, createShopInfoButton(name), createGatheringTimerButton(name));

  li.addEventListener('click', () => {
    rememberCurrentSearch();
    markRecipeListSelection(li);
    selectRecipe(name, li, variant?.recipeId || '');
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

function usedInRecipeVariants(ingredientName) {
  return (usedIn[ingredientName] || []).flatMap(recipeName =>
    (recipeVariants[recipeName] || [recipes[recipeName]])
      .filter(Boolean)
      .filter(recipe => recipe.ingredients.some(ingredient => ingredient.name === ingredientName))
      .map(variant => ({ recipeName, variant }))
  );
}

// Used-in panel and mobile navigation
function showUsesPanel(ingredientName, options = {}) {
  selectedUsesItem = ingredientName;
  if (options.record !== false) recordViewedItem(ingredientName);
  const uses = usedInRecipeVariants(ingredientName);
  elements.usesTitle.textContent = `${ingredientName}（${formatNumber(uses.length)}件）`;
  const frag = document.createDocumentFragment();

  uses.forEach(({ recipeName, variant }) => {
    const li = createItemListRow(recipeName, 'recipe-variant-row', { recipeVariant: variant });
    li.dataset.recipeId = variant.recipeId || '';
    li.addEventListener('click', () => {
      recordViewedItem(recipeName);
      resetFavoriteOperationModes();
      if (
        selectedRecipe !== recipeName ||
        selectedRecipeId !== (variant.recipeId || '') ||
        resultSourceMode === 'favorite-materials'
      ) {
        resetCountInput();
      }
      activateRecipeVariant(recipeName, variant.recipeId);
      selectedRecipe = recipeName;
      selectedRecipeId = variant.recipeId || '';
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

function selectRecipe(name, li, recipeId = '') {
  const preservePurchasedIntermediates = listMode === 'search';
  const variant = activateRecipeVariant(name, recipeId);
  const nextRecipeId = variant?.recipeId || '';
  recordViewedItem(name);
  resetFavoriteOperationModes();
  clearMaterialSelectedFavoriteLists();
  if (
    selectedRecipe !== name ||
    selectedRecipeId !== nextRecipeId ||
    resultSourceMode === 'favorite-materials'
  ) {
    resetCountInput();
  }
  selectedRecipe = name;
  selectedRecipeId = nextRecipeId;
  closeUsesPanel();
  leaveFavoriteMaterialsMode();
  if (preservePurchasedIntermediates) purchasedIntermediateContext = currentMaterialPurchaseContext();
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

function selectRecipeByName(name, recipeId = '') {
  const variant = activateRecipeVariant(name, recipeId || activeRecipeIds[name] || '');
  const nextRecipeId = variant?.recipeId || '';
  recordViewedItem(name);
  resetFavoriteOperationModes();
  clearMaterialSelectedFavoriteLists();
  if (
    selectedRecipe !== name ||
    selectedRecipeId !== nextRecipeId ||
    resultSourceMode === 'favorite-materials'
  ) {
    resetCountInput();
  }
  selectedRecipe = name;
  selectedRecipeId = nextRecipeId;
  closeUsesPanel();
  leaveFavoriteMaterialsMode();
  purchasedIntermediateContext = currentMaterialPurchaseContext();
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
    tipsData = [{ html: renderMarkdown(await response.text(), { breaks: true }) }];
  } catch {
    tipsData = [
      {
        html: renderMarkdown('📌 ピンでお気に入り登録\n\n検索欄でアイテム名検索', {
          breaks: true
        })
      }
    ];
  }
}

function iconPath(item) {
  if (!item?.IconFile) return '';
  const folder = item.IconFile.slice(0, 3);
  return `./assets/item-icons/${folder}/${item.IconFile}?v=${encodeURIComponent(DATA_CACHE_VERSION)}`;
}

function normalizedRecipeVariant(rawRecipe, fallbackCraftInfo = null) {
  if (!rawRecipe || rawRecipe.CraftType === undefined || !Array.isArray(rawRecipe.Ingredients)) return null;
  const craftType = String(rawRecipe.CraftType);
  const craftInfo = rawRecipe.CraftInfo || fallbackCraftInfo || null;
  return {
    recipeId: String(rawRecipe.RecipeID || ''),
    yield: toNumeric(rawRecipe.AmountResult, 1),
    craftType,
    craftInfo,
    ingredients: rawRecipe.Ingredients.map(ingredient => ({
      name: ingredient.Name || itemNameForId(ingredient.ItemID),
      qty: toNumeric(ingredient.Amount, 1),
      itemId: ingredient.ItemID
    })).filter(ingredient => ingredient.name)
  };
}

function recipeIngredientSignature(recipe) {
  return (recipe?.ingredients || [])
    .map(ingredient => `${ingredient.itemId}:${ingredient.name}:${ingredient.qty}`)
    .join('|');
}

function defaultRecipeVariant(variants, legacyRecipe) {
  if (variants.length <= 1) return variants[0] || null;
  const legacy = normalizedRecipeVariant(legacyRecipe);
  if (!legacy) return variants[0];
  const signature = recipeIngredientSignature(legacy);
  return (
    variants.find(
      variant => variant.craftType === legacy.craftType && recipeIngredientSignature(variant) === signature
    ) ||
    variants.find(variant => recipeIngredientSignature(variant) === signature) ||
    variants.find(variant => variant.craftType === legacy.craftType) ||
    variants[0]
  );
}

function activateRecipeVariant(name, recipeId = '') {
  const variants = recipeVariants[name] || [];
  if (variants.length === 0) return null;
  const variant = variants.find(candidate => candidate.recipeId === recipeId) || recipes[name] || variants[0];
  recipes[name] = variant;
  activeRecipeIds[name] = variant.recipeId;
  return variant;
}

function activeRecipeVariant(name) {
  return activateRecipeVariant(name, activeRecipeIds[name] || '');
}

function defaultRecipeVariantForName(name) {
  const variants = recipeVariants[name] || [];
  return variants.find(variant => variant.recipeId === defaultRecipeIds[name]) || variants[0] || null;
}

function applyRecipeSelectionContext(recipeSelections = {}) {
  Object.keys(recipeVariants).forEach(name => {
    if (recipeVariants[name].length > 1) activateRecipeVariant(name, defaultRecipeIds[name] || '');
  });
  Object.entries(recipeSelections).forEach(([itemId, recipeId]) => {
    const name = itemNameForId(itemId);
    if (name) activateRecipeVariant(name, recipeId);
  });
}

function buildItemAndRecipeMasters(rawList, idToItem) {
  let maxPatch = 0;

  rawList.forEach(item => {
    const legacyRecipe = item.Recipe;
    const name = item.Name;

    if (legacyRecipe?.PatchNumber) {
      const patchNumber = toNumeric(legacyRecipe.PatchNumber);
      if (patchNumber > maxPatch) maxPatch = patchNumber;
    }

    const variants = (Array.isArray(item.Recipes) && item.Recipes.length > 0 ? item.Recipes : [legacyRecipe])
      .map(rawRecipe => {
        const method = CRAFT_TYPE_NAME[rawRecipe?.CraftType] || 'クラフト';
        const fallbackCraftInfo =
          (item.CraftInfo || []).find(info => info.job === method) || item.CraftInfo?.[0] || null;
        return normalizedRecipeVariant(rawRecipe, fallbackCraftInfo);
      })
      .filter(Boolean);

    if (variants.length > 0) {
      const recipe = defaultRecipeVariant(variants, legacyRecipe);
      const craftType = recipe.craftType;
      const method = CRAFT_TYPE_NAME[craftType] || 'クラフト';
      const craftInfo = recipe.craftInfo;
      itemMaster[name] = {
        method,
        icon: iconPath(item),
        craftType,
        craftLevel: toNumeric(craftInfo?.level, 0),
        masterbook: craftInfo?.masterbook || '',
        id: item.ID,
        numericId: toNumeric(item.ID),
        uiCategory: toNumeric(item.ItemUICategory),
        uiCategoryName: item.ItemUICategoryName || '',
        gatheringTimer: item.GatheringTimer || [],
        shopInfo: item.ShopInfo || null,
        equipmentInfo: item.EquipmentInfo || null,
        craftInfo: item.CraftInfo || [],
        isEx: item.IsEx === true
      };
      recipeVariants[name] = variants;
      recipes[name] = recipe;
      activeRecipeIds[name] = recipe.recipeId;
      defaultRecipeIds[name] = recipe.recipeId;

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
        equipmentInfo: item.EquipmentInfo || null,
        isEx: item.IsEx === true
      };
    }
  });

  rawList.forEach(item => {
    const sourceRecipes = Array.isArray(item.Recipes) && item.Recipes.length > 0 ? item.Recipes : [item.Recipe];
    sourceRecipes.flatMap(recipe => recipe?.Ingredients || []).forEach(ingredient => {
      const ingredientName = ingredient.Name || itemNameForId(ingredient.ItemID);
      if (!ingredientName || itemMaster[ingredientName]) return;
      itemMaster[ingredientName] = {
        method: '',
        icon: iconPath(idToItem[ingredient.ItemID]),
        craftType: '',
        id: ingredient.ItemID,
        numericId: toNumeric(ingredient.ItemID),
        uiCategory: toNumeric(idToItem[ingredient.ItemID]?.ItemUICategory),
        uiCategoryName: idToItem[ingredient.ItemID]?.ItemUICategoryName || '',
        gatheringTimer: idToItem[ingredient.ItemID]?.GatheringTimer || [],
        shopInfo: idToItem[ingredient.ItemID]?.ShopInfo || null,
        equipmentInfo: idToItem[ingredient.ItemID]?.EquipmentInfo || null,
        isEx: idToItem[ingredient.ItemID]?.IsEx === true
      };
    });
  });

  return maxPatch;
}

function buildRecipeIndexes() {
  recipeNames = sortRecipeNames(Object.keys(recipes));
  const usedInSets = {};

  Object.entries(recipeVariants).forEach(([recipeName, variants]) => {
    variants.forEach(recipe => {
      recipe.ingredients.forEach(ingredient => {
        if (!usedInSets[ingredient.name]) usedInSets[ingredient.name] = new Set();
        usedInSets[ingredient.name].add(recipeName);
      });
    });
  });

  usedIn = Object.fromEntries(
    Object.entries(usedInSets).map(([ingredientName, recipeSet]) => [ingredientName, [...recipeSet]])
  );
  ingredientNames = sortRecipeNames(Object.keys(usedIn).filter(name => !recipes[name] && !CRYSTAL_EXCLUDE.has(name)));
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
  const patch = `${String(maxPatch).slice(0, -2)}.${String(maxPatch).slice(-2)}`.replace(/0$/, '');
  elements.loadStatus.textContent =
    maxPatch > 0 ? `patch ${patch} 対応` : '';
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
    const rawList = await fetchJson(DATA_FILE, status => `Item.json が見つかりません (${status})`);
    const applicationDataStartedAt = performance.now();
    updatePatchStatus(buildApplicationData(rawList));
    validateFavoriteRecipeSelections();
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
  rememberVisibleScrollPositions();
  elements.panelLeft.classList.toggle('mobile-visible', panelName === 'left');
  elements.panelMiddle.classList.toggle('mobile-visible', panelName === 'middle');
  elements.panelRight.classList.toggle('mobile-visible', panelName === 'right');
  elements.mobileBackBtn.classList.toggle('visible', panelName !== 'left');
  elements.mobileBackBtn.dataset.panel = panelName;
  const visibleScrollKeys =
    panelName === 'left'
      ? ['recipeList']
      : panelName === 'middle'
        ? ['usesList']
        : ['treeContainer', 'panelRight'];
  visibleScrollKeys.forEach(key => {
    scrollPositionContainers()[key].scrollTop = viewScrollPositions[key];
  });
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
  elements.countInput.value = Math.min(REQUEST_COUNT_MAX, Math.max(1, readRequestedCount(elements.countInput) + delta));
  renderResultView({ preserveScroll: true });
}

function readRequestedCount(input) {
  const numericValue = Number(input.value);
  try {
    return validateRequestedCount(numericValue, REQUEST_COUNT_MAX);
  } catch {
    const normalized = Number.isSafeInteger(numericValue) && numericValue > REQUEST_COUNT_MAX ? REQUEST_COUNT_MAX : 1;
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
  const previousValue = input.value;
  readRequestedCount(input);
  if (input.value !== previousValue || previousValue === '') render();
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
  if (!list) return [];
  return getFavoriteListRecipeNames(list).filter(isRingRecipe).sort(compareItemNames);
}

function ensureFavoriteMaterialsRingCounts() {
  if (favoriteMaterialsListIds.length >= 1) {
    favoriteMaterialsRingCounts = Object.fromEntries(
      getActiveFavoriteMaterialLists().map(list => {
        const current = favoriteMaterialsRingCounts[list.id] || {};
        const counts = Object.fromEntries(
          getFavoriteMaterialRingNames(list).map(name => [name, [0, 1, 2].includes(current[name]) ? current[name] : 1])
        );
        return [list.id, counts];
      })
    );
    return;
  }
  const ringNames = getFavoriteMaterialRingNames();
  favoriteMaterialsRingCounts = Object.fromEntries(
    ringNames.map(name => [
      name,
      [0, 1, 2].includes(favoriteMaterialsRingCounts[name]) ? favoriteMaterialsRingCounts[name] : 1
    ])
  );
}

function favoriteMaterialRingCount(name, list = null) {
  if (favoriteMaterialsListIds.length >= 1 && list) {
    return favoriteMaterialsRingCounts[list.id]?.[name] ?? 1;
  }
  return favoriteMaterialsRingCounts[name] ?? 1;
}

function setFavoriteMaterialRingCount(name, value, list = null) {
  if (favoriteMaterialsListIds.length >= 1 && list) {
    if (!favoriteMaterialsRingCounts[list.id]) favoriteMaterialsRingCounts[list.id] = {};
    favoriteMaterialsRingCounts[list.id][name] = value;
  } else {
    favoriteMaterialsRingCounts[name] = value;
  }
}

function requestFavoriteMaterialsMode() {
  const selectedLists = getMaterialSelectedFavoriteLists();
  if (selectedLists.length >= 2) {
    openFavoriteMaterialsMode({
      listIds: selectedLists.map(list => list.id)
    });
    return;
  }
  openFavoriteMaterialsMode();
}

function openCheckedFavoriteMaterialsMode() {
  const selectedLists = getMaterialSelectedFavoriteLists();
  if (selectedLists.length === 0) return;
  favoriteAnyListProductionExpanded = true;
  openFavoriteMaterialsMode({ listIds: selectedLists.map(list => list.id) });
}

function openFavoriteMaterialsMode({ listIds = [] } = {}) {
  const checkedIds = listIds.filter(id => findFavoriteList(id) && !isRecentList(id));
  if (checkedIds.length < 1 && !getDisplayedFavoriteList()) return;
  if (resultSourceMode !== 'favorite-materials') resetCountInput();
  favoriteMaterialsListIds = checkedIds;
  selectedRecipe = null;
  selectedRecipeId = '';
  setResultSourceMode('favorite-materials');
  setResultViewMode('materials');
  ensureFavoriteMaterialsRingCounts();
  const activeLists =
    checkedIds.length > 0 ? checkedIds.map(findFavoriteList).filter(Boolean) : [getDisplayedFavoriteList()].filter(Boolean);
  resolveAndReportRecipeSelections(activeLists);
  if (checkedIds.length === 0) applyRecipeSelectionContext(getDisplayedFavoriteList()?.recipeSelections || {});
  resetRightPanelViewState();
  renderList();
  renderResultView();
  if (isMobile()) {
    prevPanel = 'left';
    showMobilePanel('right');
  }
  requestAnimationFrame(() => {
    elements.treeContainer.scrollTop = 0;
    elements.panelRight.scrollTop = 0;
  });
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
    const hideCountInput = favoriteMaterialsListIds.length === 0 && favoriteCountEnabled() && !favoriteAnyOneMode();
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
    elements.resultHeader.querySelectorAll('.count-control button').forEach(button => {
      button.disabled = hideCountInput;
    });
    return;
  }

  elements.resultHeader.classList.remove('hide-count-input');
  elements.countInput.disabled = false;
  elements.resultHeader.querySelectorAll('.count-control button').forEach(button => {
    button.disabled = false;
  });
  elements.countLabel.textContent = '個数:';
  elements.resultTitle.textContent = '';
  const usesCount = selectedRecipe ? usedInRecipeVariants(selectedRecipe).length : 0;
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
  synchronizeRecipeMethodWidths(elements.treeContainer);
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
  selectedRecipeId = '';
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
  const elementDiff =
    CRYSTAL_ELEMENT_ORDER.indexOf(crystalElement(a)) - CRYSTAL_ELEMENT_ORDER.indexOf(crystalElement(b));
  return elementDiff || compareItemNames(a, b);
}

function compareMaterialRows(a, b) {
  return compareItemNames(a.name, b.name);
}

function compareIntermediateRows(a, b, recipeMap = recipes) {
  const leftRecipe = recipeMap[a.name];
  const rightRecipe = recipeMap[b.name];
  const left = itemSortKey(a.name);
  const right = itemSortKey(b.name);

  return (
    toNumeric(leftRecipe?.craftType) - toNumeric(rightRecipe?.craftType) ||
    left.uiCategory - right.uiCategory ||
    left.id - right.id ||
    a.name.localeCompare(b.name, 'ja')
  );
}

function compareAvailableIntermediateRows(
  a,
  b,
  previous,
  remainingCraftTypes,
  craftTypeDependencies,
  recipeMap = recipes
) {
  const previousRecipe = previous ? recipeMap[previous.name] : null;
  const leftRecipe = recipeMap[a.name];
  const rightRecipe = recipeMap[b.name];
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
    [...(craftTypeDependencies.get(craftType) || [])].some(
      requiredCraftType => (remainingCraftTypes.get(requiredCraftType) || 0) > 0
    );
  const leftBlocked = waitsForRemainingCraftType(leftCraftType) ? 1 : 0;
  const rightBlocked = waitsForRemainingCraftType(rightCraftType) ? 1 : 0;
  if (leftBlocked !== rightBlocked) return leftBlocked - rightBlocked;
  return compareIntermediateRows(a, b, recipeMap);
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
  return compareSupplementEntryLists(a.supplements, b.supplements) || compareMaterialRows(a, b);
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

  const sortRows = targetRows =>
    targetRows.sort((a, b) => {
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
  if (info.surplus > 0)
    entries.push({
      label: '↩',
      qty: info.surplus,
      suffix: '個余り',
      kind: 'surplus'
    });
  if (!EXCHANGE_CRAFT_TYPES.has(recipe.craftType) && info.craftTimes >= 1) {
    entries.push({
      label: '🔨',
      qty: info.craftTimes,
      suffix: '回製作',
      kind: 'craft'
    });
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
  return rows
    .map(row => {
      if (row.type === 'item') return createMaterialLabel(row.name, row.qty);
      return row.options
        .map(option => option.map(item => createMaterialLabel(item.name, item.qty)).join(' / '))
        .join(' もしくは ');
    })
    .join(' / ');
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
  const materialMap = new Map(targetRows.filter(row => row.type === 'item').map(row => [row.name, row]));

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

function renderFavoriteRingControls(container, list = null) {
  if (favoriteMaterialsListIds.length === 0 && favoriteCountEnabled()) return;
  const ringNames = getFavoriteMaterialRingNames(list || getDisplayedFavoriteList());
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
      button.classList.toggle('active', favoriteMaterialRingCount(name, list) === value);
      button.addEventListener('click', () => {
        setFavoriteMaterialRingCount(name, value, list);
        purchasedIntermediateContext = currentMaterialPurchaseContext();
        saveViewState();
        renderResultView({ preserveScroll: true });
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

function renderFavoriteRingBulkControls(container, lists = []) {
  if (favoriteMaterialsListIds.length === 0 && favoriteCountEnabled()) return;
  const targets = (lists.length ? lists : [getDisplayedFavoriteList()])
    .filter(Boolean)
    .flatMap(list => getFavoriteMaterialRingNames(list).map(name => ({ list, name })));
  if (targets.length < 2) return;
  const controls = createTextElement('div', 'favorite-ring-bulk-actions bulk-action-row', '');
  [0, 1, 2].forEach(value => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = value === 0 ? '全て0' : `全て${value}つ`;
    button.disabled = targets.every(({ list, name }) => favoriteMaterialRingCount(name, list) === value);
    button.addEventListener('click', () => {
      targets.forEach(({ list, name }) => setFavoriteMaterialRingCount(name, value, list));
      purchasedIntermediateContext = currentMaterialPurchaseContext();
      saveViewState();
      renderResultView({ preserveScroll: true });
    });
    controls.appendChild(button);
  });
  container.appendChild(controls);
}

function createFavoriteRingSection(lists = []) {
  if (favoriteMaterialsListIds.length === 0 && favoriteCountEnabled()) return null;
  const activeLists = lists.filter(Boolean);
  const ringLists = activeLists
    .map(list => ({ list, ringNames: getFavoriteMaterialRingNames(list) }))
    .filter(entry => entry.ringNames.length > 0);
  if (ringLists.length === 0) return null;

  const section = document.createElement('section');
  section.className = 'favorite-ring-section';
  const header = document.createElement('div');
  header.className = 'production-content-toggle materials-section-header';
  header.appendChild(createTextElement('span', 'materials-section-title', '指輪'));
  section.appendChild(header);
  renderFavoriteRingBulkControls(
    section,
    ringLists.map(entry => entry.list)
  );

  const showListRoots = activeLists.length > 1;
  ringLists.forEach(({ list }) => {
    if (!showListRoots) {
      renderFavoriteRingControls(section, list);
      return;
    }
    const block = document.createElement('div');
    block.className = 'favorite-list-production-block';
    block.appendChild(createFavoriteListRootSummary(list));
    renderFavoriteRingControls(block, list);
    section.appendChild(block);
  });
  return section;
}

function recipeMapForSelections(recipeSelections = {}) {
  const contextualRecipes = { ...recipes };
  Object.entries(recipeVariants).forEach(([name, variants]) => {
    if (variants.length > 1) contextualRecipes[name] = defaultRecipeVariantForName(name);
  });
  Object.entries(normalizeRecipeSelections(recipeSelections)).forEach(([itemId, recipeId]) => {
    const name = itemNameForId(itemId);
    const variant = (recipeVariants[name] || []).find(candidate => candidate.recipeId === recipeId);
    if (name && variant) contextualRecipes[name] = variant;
  });
  return contextualRecipes;
}

function reachableMultiRecipeNames(rootNames, recipeSelections = {}) {
  const recipeMap = recipeMapForSelections(recipeSelections);
  const reachable = [];
  const visited = new Set();
  const stack = [...rootNames];
  while (stack.length > 0) {
    const name = stack.pop();
    if (!name || visited.has(name)) continue;
    visited.add(name);
    const recipe = recipeMap[name];
    if (!recipe) continue;
    if ((recipeVariants[name] || []).length > 1) reachable.push(name);
    recipe.ingredients.forEach(ingredient => {
      if (recipeMap[ingredient.name]) stack.push(ingredient.name);
    });
  }
  return reachable;
}

function effectiveRecipeSelectionSignature(recipeSelections = {}) {
  return JSON.stringify(
    Object.entries(normalizeRecipeSelections(recipeSelections))
      .filter(([itemId, recipeId]) => {
        const name = itemNameForId(itemId);
        return defaultRecipeIds[name] !== recipeId;
      })
      .sort(([left], [right]) => Number(left) - Number(right))
  );
}

function calculateMaterialRequirements(rootItems, terminalNames = [], recipeSelections = null) {
  const recipeMap = recipeSelections === null ? recipes : recipeMapForSelections(recipeSelections);
  return calculateRequirements(recipeMap, rootItems, {
    exchangeCraftTypes: EXCHANGE_CRAFT_TYPES,
    terminalNames
  });
}

function calculateFavoriteListGroups(lists, terminalNames = []) {
  const groups = new Map();
  lists.forEach(list => {
    const signature = effectiveRecipeSelectionSignature(list.recipeSelections);
    if (!groups.has(signature)) groups.set(signature, { recipeSelections: list.recipeSelections, roots: new Map() });
    const roots = groups.get(signature).roots;
    getFavoriteListMaterialRoots(list).forEach(root => {
      roots.set(root.name, (roots.get(root.name) || 0) + root.qty);
    });
  });
  const results = [...groups.values()].map(group =>
    calculateMaterialRequirements(
      [...group.roots].filter(([, qty]) => qty > 0).map(([name, qty]) => ({ name, qty })),
      terminalNames,
      group.recipeSelections
    )
  );
  return results.length === 1 ? results[0] : mergeSummedRequirements(results);
}

function unresolvedRecipeSelections(list) {
  if (!list || isRecentList(list)) return [];
  const recipeMap = recipeMapForSelections(list.recipeSelections);
  const selections = normalizeRecipeSelections(list.recipeSelections);
  const unresolved = [];
  const visited = new Set();
  const stack = getFavoriteListRecipeNames(list);
  while (stack.length > 0) {
    const name = stack.pop();
    if (!name || visited.has(name)) continue;
    visited.add(name);
    const recipe = recipeMap[name];
    if (!recipe) continue;
    const variants = recipeVariants[name] || [];
    const itemId = itemIdForName(name);
    if (variants.length > 1 && itemId && !selections[String(itemId)]) {
      unresolved.push({ name, recipe });
    }
    recipe.ingredients.forEach(ingredient => {
      if (recipeMap[ingredient.name]) stack.push(ingredient.name);
    });
  }
  return unresolved.sort((left, right) => left.name.localeCompare(right.name, 'ja'));
}

function recipeSelectionLabel(name, recipe) {
  const master = recipeVariantMaster(name, recipe);
  return craftJobLevelLabel(master.method, master.craftLevel, master.masterbook);
}

function recipeSelectionJobScore(list, recipeSelections) {
  const recipeMap = recipeMapForSelections(recipeSelections);
  const roots = getFavoriteListRecipeNames(list).map(name => ({ name, qty: 1 }));
  const result = calculateRequirements(recipeMap, roots, { exchangeCraftTypes: EXCHANGE_CRAFT_TYPES });
  const sequence = [
    ...orderedIntermediateRows(result, recipeMap).map(row => row.name),
    ...roots.map(root => root.name)
  ]
    .map(name => recipeMap[name]?.craftType)
    .filter(craftType => CRAFT_JOBS_SET.has(CRAFT_TYPE_NAME[craftType]));
  let changes = 0;
  for (let index = 1; index < sequence.length; index += 1) {
    if (sequence[index] !== sequence[index - 1]) changes += 1;
  }
  return [changes, new Set(sequence).size];
}

function compareRecipeSelectionScores(left, right) {
  return left[0] - right[0] || left[1] - right[1];
}

function resolveFavoriteRecipeSelections(list) {
  if (!list || isRecentList(list)) return [];
  const originalSelections = normalizeRecipeSelections(list.recipeSelections);
  const selections = { ...originalSelections };
  const automaticNames = new Set();
  const selectedEntries = new Map();

  while (true) {
    const unresolved = unresolvedRecipeSelections({ ...list, recipeSelections: selections });
    const next = unresolved.find(({ name }) => !automaticNames.has(name));
    if (!next) break;
    const itemId = itemIdForName(next.name);
    if (!itemId || !next.recipe?.recipeId) break;
    selections[String(itemId)] = next.recipe.recipeId;
    automaticNames.add(next.name);
    selectedEntries.set(next.name, next.recipe);
  }

  let changed = true;
  let passes = 0;
  while (changed && passes < Math.max(1, automaticNames.size * 2)) {
    changed = false;
    passes += 1;
    [...automaticNames].forEach(name => {
      const itemId = String(itemIdForName(name));
      const variants = recipeVariants[name] || [];
      let best = variants.find(variant => variant.recipeId === selections[itemId]) || variants[0];
      let bestScore = recipeSelectionJobScore(list, selections);
      variants.forEach(variant => {
        const candidateSelections = { ...selections, [itemId]: variant.recipeId };
        const score = recipeSelectionJobScore(list, candidateSelections);
        if (compareRecipeSelectionScores(score, bestScore) < 0) {
          best = variant;
          bestScore = score;
        }
      });
      if (best && selections[itemId] !== best.recipeId) {
        selections[itemId] = best.recipeId;
        changed = true;
      }
      if (best) selectedEntries.set(name, best);
    });
  }

  if (JSON.stringify(selections) !== JSON.stringify(originalSelections)) {
    list.recipeSelections = selections;
    saveFavorites();
  }
  return [...selectedEntries].map(([name, recipe]) => ({ name, recipe }));
}

function recipeVariantForList(name, list) {
  const recipeId = favoriteRecipeSelection(name, list);
  return (
    (recipeVariants[name] || []).find(variant => variant.recipeId === recipeId) ||
    defaultRecipeVariantForName(name)
  );
}

function currentRecipeSelectionList() {
  const list = getDisplayedFavoriteList();
  return list && !isRecentList(list) ? list : null;
}

function selectRecipeMethod(name, recipeId, list = null) {
  const variant = (recipeVariants[name] || []).find(candidate => candidate.recipeId === recipeId);
  if (!variant) return;
  if (list) {
    setFavoriteRecipeSelection(name, recipeId, list);
    if (currentRecipeSelectionList()?.id === list.id) applyRecipeSelectionContext(list.recipeSelections);
  } else {
    activateRecipeVariant(name, recipeId);
  }
  if (name === selectedRecipe) selectedRecipeId = recipeId;
  purchasedIntermediateNames.clear();
  purchasedIntermediateContext = currentMaterialPurchaseContext();
  renderList({ preserveScroll: true });
  renderResultView({ preserveScroll: true });
}

function createRecipeMethodVisual(name, variant) {
  const visual = createTextElement('span', 'recipe-method-visual', '');
  const labels = createCraftRequirementLabels(recipeVariantMaster(name, variant), 'badge', {
    requireLevel: true
  });
  if (labels.length > 0) visual.append(...labels);
  else visual.appendChild(createTextElement('span', 'badge badge-craft', recipeSelectionLabel(name, variant)));
  return visual;
}

function createRecipeMethodSelector(name, { list = null } = {}) {
  const variants = recipeVariants[name] || [];
  if (variants.length <= 1) return null;
  const selected = list ? recipeVariantForList(name, list) : activeRecipeVariant(name);
  if (!selected) return null;
  const control = document.createElement('div');
  control.className = 'recipe-method-control';
  control.addEventListener('click', event => event.stopPropagation());

  const details = document.createElement('div');
  details.className = 'recipe-method-selector';
  const summary = document.createElement('button');
  summary.type = 'button';
  summary.className = 'recipe-method-summary';
  summary.appendChild(createRecipeMethodVisual(name, selected));
  summary.addEventListener('click', () => {
    const open = !details.classList.contains('open');
    details.classList.toggle('open', open);
    control.classList.toggle('open', open);
    choices.hidden = !open;
    summary.setAttribute('aria-expanded', String(open));
  });
  summary.setAttribute('aria-expanded', 'false');
  details.appendChild(summary);

  const choices = document.createElement('div');
  choices.className = 'recipe-method-choices';
  choices.hidden = true;
  variants.forEach(variant => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'recipe-method-choice';
    button.classList.toggle('selected', variant.recipeId === selected.recipeId);
    button.append(
      createTextElement('span', 'recipe-method-check', variant.recipeId === selected.recipeId ? '✓' : ''),
      createRecipeMethodVisual(name, variant)
    );
    button.addEventListener('click', () => selectRecipeMethod(name, variant.recipeId, list));
    choices.appendChild(button);
  });
  details.appendChild(choices);
  control.appendChild(details);
  return control;
}

function synchronizeRecipeMethodWidths(container) {
  const selectors = [...container.querySelectorAll('.recipe-method-selector')];
  if (selectors.length === 0) return;
  const measure = document.createElement('div');
  measure.className = 'recipe-method-width-measure';
  document.body.appendChild(measure);
  let widest = 0;
  selectors.forEach(selector => {
    selector.querySelectorAll('.recipe-method-visual').forEach(visual => {
      const clone = visual.cloneNode(true);
      measure.appendChild(clone);
      widest = Math.max(widest, clone.getBoundingClientRect().width);
      clone.remove();
    });
  });
  measure.remove();
  container.style.setProperty('--recipe-method-selector-width', `${Math.min(360, Math.ceil(widest + 46))}px`);
}

function resolveAndReportRecipeSelections(lists) {
  const entries = lists
    .map(list => ({ list, resolved: resolveFavoriteRecipeSelections(list) }))
    .filter(entry => entry.resolved.length > 0);
  if (entries.length === 0) return;
  const key = entries
    .map(
      ({ list, resolved }) =>
        `${list.id}:${resolved.map(({ name, recipe }) => `${name}:${recipe.recipeId}`).join(',')}`
    )
    .join('|');
  if (autoSelectedRecipeNoticeKeys.has(key)) return;
  autoSelectedRecipeNoticeKeys.add(key);
  const content = document.createElement('div');
  content.className = 'recipe-resolution-notice';
  content.appendChild(
    createTextElement('div', 'recipe-resolution-message', '製作方法情報がなかったため、次の製作方法に設定しました。')
  );
  const details = document.createElement('div');
  details.className = 'recipe-resolution-list';
  entries.forEach(({ list, resolved }) => {
    const group = document.createElement('div');
    group.className = 'recipe-resolution-group';
    if (entries.length > 1) group.appendChild(createTextElement('div', 'recipe-resolution-list-name', list.name));
    const itemList = document.createElement('ul');
    resolved.forEach(({ name, recipe }) =>
      itemList.appendChild(createTextElement('li', '', `${name}：${recipeSelectionLabel(name, recipe)}`))
    );
    group.appendChild(itemList);
    details.appendChild(group);
  });
  content.appendChild(details);
  showRecipeResolutionInfo(content);
}

function intermediateUsageEntries(result, state) {
  return [...state.parents]
    .map(parentName => {
      const parentState = result.states.get(parentName);
      if (!parentState?.recipe || parentState.isRoot || parentState.isExchange) return null;
      const quantityPerCraft = parentState.recipe.ingredients
        .filter(ingredient => ingredient.name === state.name)
        .reduce((sum, ingredient) => sum + ingredient.qty, 0);
      const qty = quantityPerCraft * parentState.craftTimes;
      return qty > 0 ? { name: parentName, qty } : null;
    })
    .filter(Boolean)
    .sort((a, b) => compareIntermediateRows(a, b));
}

function usageSignature(entries) {
  return entries.map(entry => `${entry.name}:${entry.qty}`).join('|');
}

function mergeAlternativeRequirementsWithUsage(results) {
  const merged = mergeAlternativeRequirements(results);
  merged.states.forEach((state, name) => {
    const usageAlternatives = [];
    results.forEach(result => {
      const source = result.states.get(name);
      if (!source || source.needed !== state.needed) return;
      const usage = intermediateUsageEntries(result, source);
      if (!usageAlternatives.some(entries => usageSignature(entries) === usageSignature(usage))) {
        usageAlternatives.push(usage);
      }
    });
    state.usageAlternatives = usageAlternatives;
  });
  return merged;
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

function orderedIntermediateRows(result, recipeMap = recipes) {
  const rows = new Map();
  result.states.forEach(state => {
    if (!state.recipe || state.isRoot || state.isExchange || crystalKind(state.name)) return;
    rows.set(state.name, {
      name: state.name,
      qty: state.needed,
      craftTimes: state.craftTimes,
      produced: state.produced,
      surplus: state.surplus,
      parents: new Set(
        [...state.parents].filter(name => {
          const parent = result.states.get(name);
          return parent?.recipe && !parent.isRoot && !parent.isExchange && !crystalKind(parent.name);
        })
      ),
      usageAlternatives: state.usageAlternatives || [intermediateUsageEntries(result, state)]
    });
  });

  const indegree = new Map([...rows.keys()].map(name => [name, 0]));
  const dependents = new Map([...rows.keys()].map(name => [name, []]));
  const craftTypeDependencies = new Map();
  const remainingCraftTypes = new Map();
  rows.forEach(row => {
    const craftType = toNumeric(recipeMap[row.name]?.craftType);
    remainingCraftTypes.set(craftType, (remainingCraftTypes.get(craftType) || 0) + 1);
  });
  rows.forEach(row => {
    row.parents.forEach(parentName => {
      if (!rows.has(parentName)) return;
      indegree.set(parentName, indegree.get(parentName) + 1);
      dependents.get(row.name).push(parentName);
      const requiredCraftType = toNumeric(recipeMap[row.name]?.craftType);
      const dependentCraftType = toNumeric(recipeMap[parentName]?.craftType);
      if (requiredCraftType !== dependentCraftType) {
        if (!craftTypeDependencies.has(dependentCraftType)) craftTypeDependencies.set(dependentCraftType, new Set());
        craftTypeDependencies.get(dependentCraftType).add(requiredCraftType);
      }
    });
  });

  const available = [...rows.values()].filter(row => indegree.get(row.name) === 0);
  const ordered = [];
  while (available.length > 0) {
    available.sort((a, b) =>
      compareAvailableIntermediateRows(a, b, ordered.at(-1), remainingCraftTypes, craftTypeDependencies, recipeMap)
    );
    const row = available.shift();
    ordered.push(row);
    const craftType = toNumeric(recipeMap[row.name]?.craftType);
    remainingCraftTypes.set(craftType, remainingCraftTypes.get(craftType) - 1);
    dependents.get(row.name).forEach(parentName => {
      indegree.set(parentName, indegree.get(parentName) - 1);
      if (indegree.get(parentName) === 0) available.push(rows.get(parentName));
    });
  }
  if (ordered.length < rows.size) {
    const included = new Set(ordered.map(row => row.name));
    ordered.push(
      ...[...rows.values()]
        .filter(row => !included.has(row.name))
        .sort((a, b) => compareIntermediateRows(a, b, recipeMap))
    );
  }
  return ordered;
}

function getFavoriteListMaterialRoots(list) {
  const setCount = readRequestedCount(elements.countInput);
  return getFavoriteListRecipeNames(list)
    .map(name => {
      const multiplier = isRingRecipe(name) ? favoriteMaterialRingCount(name, list) : 1;
      return { name, qty: setCount * multiplier };
    })
    .filter(root => root.qty > 0);
}

function getFavoriteMaterialRoots() {
  ensureFavoriteMaterialsRingCounts();
  const setCount = readRequestedCount(elements.countInput);
  const activeLists = getActiveFavoriteMaterialLists();
  if (favoriteMaterialsListIds.length >= 1) {
    const roots = new Map();
    activeLists.forEach(list => {
      getFavoriteListMaterialRoots(list).forEach(root => {
        roots.set(root.name, (roots.get(root.name) || 0) + root.qty);
      });
    });
    return [...roots.entries()].filter(([, qty]) => qty > 0).map(([name, qty]) => ({ name, qty }));
  }
  const list = getDisplayedFavoriteList();
  const useItemCounts = favoriteCountEnabled(list);
  return getFavoriteListRecipeNames(list)
    .map(name => {
      const itemId = itemIdForName(name);
      const specifiedCount = useItemCounts ? favoriteItemCount(itemId, list) : 1;
      if (favoriteAnyOneMode() && !favoriteAnyOneTarget(itemId, list)) return null;
      if (!favoriteAnyOneMode() && specifiedCount <= 0) return null;
      if (favoriteAnyOneMode()) return { name, qty: setCount };
      const multiplier = !useItemCounts && isRingRecipe(name) ? (favoriteMaterialsRingCounts[name] ?? 1) : 1;
      const qty = setCount * specifiedCount * multiplier;
      return qty > 0 ? { name, qty } : null;
    })
    .filter(Boolean);
}

function selectedRecipeContextKey() {
  const name = selectedRecipe || '';
  const variants = recipeVariants[name] || [];
  return variants.length > 1 ? `recipe:${name}:${selectedRecipeId || ''}` : `recipe:${name}`;
}

function currentMaterialPurchaseContext() {
  if (resultSourceMode === 'favorite-materials') {
    const ids =
      favoriteMaterialsListIds.length >= 1 ? favoriteMaterialsListIds : [getDisplayedFavoriteList()?.id || ''];
    const mode = favoriteMaterialsListIds.length >= 1 ? checkedFavoriteMaterialCalcMode : favoriteMaterialCalcMode;
    return `favorite:${ids.join(',')}:${mode}:${JSON.stringify(favoriteMaterialsRingCounts)}`;
  }
  return selectedRecipeContextKey();
}

function getCurrentMaterialRequirements(terminalNames = []) {
  const count = readRequestedCount(elements.countInput);
  if (
    resultSourceMode === 'favorite-materials' &&
    favoriteMaterialsListIds.length >= 1 &&
    checkedFavoriteMaterialCalcMode === 'any-one'
  ) {
    const results = getActiveFavoriteMaterialLists().map(list =>
      calculateMaterialRequirements(getFavoriteListMaterialRoots(list), terminalNames, list.recipeSelections)
    );
    return mergeAlternativeRequirementsWithUsage(results);
  }
  if (resultSourceMode === 'favorite-materials' && favoriteAnyOneMode() && favoriteMaterialsListIds.length === 0) {
    const roots = getFavoriteMaterialRoots();
    const list = getDisplayedFavoriteList();
    const results = roots.map(root =>
      calculateMaterialRequirements([{ name: root.name, qty: root.qty }], terminalNames, list?.recipeSelections || {})
    );
    return mergeAlternativeRequirementsWithUsage(results);
  }
  if (resultSourceMode === 'favorite-materials' && favoriteMaterialsListIds.length >= 1) {
    return calculateFavoriteListGroups(getActiveFavoriteMaterialLists(), terminalNames);
  }
  const roots =
    resultSourceMode === 'favorite-materials' ? getFavoriteMaterialRoots() : [{ name: selectedRecipe, qty: count }];
  return calculateMaterialRequirements(
    roots,
    terminalNames,
    resultSourceMode === 'favorite-materials' ? getDisplayedFavoriteList()?.recipeSelections || {} : null
  );
}

function createProductionContentSection(kind) {
  const isList = kind === 'list';
  const section = document.createElement('section');
  section.className = 'production-content-section';
  const button = document.createElement('button');
  button.className = 'production-content-toggle materials-section-header';
  button.type = 'button';
  const toggle = createTextElement('span', 'materials-section-toggle', '▼');
  const title = createTextElement('span', 'materials-section-title', '製作内容');
  const clip = document.createElement('div');
  clip.className = 'production-content-clip';
  const body = document.createElement('div');
  body.className = 'production-content-body';
  const expanded = isList ? favoriteAnyListProductionExpanded : favoriteAnyItemProductionExpanded;
  const applyState = value => {
    toggle.textContent = value ? '▼' : '▶';
    button.setAttribute('aria-expanded', String(value));
    clip.classList.toggle('collapsed', !value);
  };
  applyState(expanded);
  button.addEventListener('click', () => {
    const next = button.getAttribute('aria-expanded') !== 'true';
    if (isList) favoriteAnyListProductionExpanded = next;
    else favoriteAnyItemProductionExpanded = next;
    applyState(next);
    saveViewState();
  });
  clip.appendChild(body);
  button.append(toggle, title);
  section.append(button, clip);
  return { section, body };
}

function appendFavoriteListProduction(target, list, { collapsible = false } = {}) {
  const block = document.createElement('div');
  block.className = 'favorite-list-production-block production-list-block';
  const rootSummary = createFavoriteListRootSummary(list);
  block.appendChild(rootSummary);
  const contentTarget = document.createElement('div');
  getFavoriteListMaterialRoots(list).forEach(root => {
    contentTarget.appendChild(
      createResultRootSummary(
        root.name,
        root.qty,
        'result-root-summary favorite-material-root-summary',
        false,
        list,
        { hideEquipmentParameters: true }
      )
    );
  });
  if (collapsible) {
    block.classList.add('collapsible');
    const rootRow = rootSummary.querySelector('.node-row');
    const toggle = createTextElement('span', 'materials-section-toggle production-list-toggle', '');
    const clip = document.createElement('div');
    clip.className = 'production-content-clip';
    const body = document.createElement('div');
    body.className = 'production-content-body';
    body.append(...contentTarget.childNodes);
    clip.appendChild(body);
    const applyState = expanded => {
      toggle.textContent = expanded ? '▼' : '▶';
      rootSummary.setAttribute('aria-expanded', String(expanded));
      clip.classList.toggle('collapsed', !expanded);
    };
    const toggleState = () => {
      const expanded = rootSummary.getAttribute('aria-expanded') !== 'true';
      favoriteListProductionExpanded[list.id] = expanded;
      applyState(expanded);
      saveViewState();
    };
    rootRow.prepend(toggle);
    rootSummary.setAttribute('role', 'button');
    rootSummary.tabIndex = 0;
    rootSummary.addEventListener('click', toggleState);
    rootSummary.addEventListener('keydown', event => {
      if (!['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      toggleState();
    });
    applyState(favoriteListProductionExpanded[list.id] === true);
    block.appendChild(clip);
  } else {
    block.append(...contentTarget.childNodes);
  }
  target.appendChild(block);
}

function recipeDependsOn(name, target, visited = new Set()) {
  if (name === target) return true;
  if (visited.has(name)) return false;
  visited.add(name);
  return (recipes[name]?.ingredients || []).some(ingredient => recipeDependsOn(ingredient.name, target, visited));
}

function purchasedIntermediateBlockers(name) {
  return [...purchasedIntermediateNames].filter(
    purchasedName => purchasedName !== name && recipeDependsOn(purchasedName, name)
  );
}

function renderMaterialsList() {
  const count = readRequestedCount(elements.countInput);
  const requirements = getCurrentMaterialRequirements();
  const purchaseContext = currentMaterialPurchaseContext();
  if (purchasedIntermediateContext !== purchaseContext) {
    purchasedIntermediateContext = purchaseContext;
    purchasedIntermediateNames.clear();
  }
  let requirementsAfterPurchases = purchasedIntermediateNames.size
    ? getCurrentMaterialRequirements(purchasedIntermediateNames)
    : requirements;
  const invalidPurchasedNames = [...purchasedIntermediateNames].filter(
    name => !requirementsAfterPurchases.states.has(name)
  );
  if (invalidPurchasedNames.length > 0) {
    invalidPurchasedNames.forEach(name => purchasedIntermediateNames.delete(name));
    requirementsAfterPurchases = purchasedIntermediateNames.size
      ? getCurrentMaterialRequirements(purchasedIntermediateNames)
      : requirements;
    saveViewState();
  }
  const originalRows = materialRowsFromRequirements(requirements);
  const recalculatedRows = materialRowsFromRequirements(requirementsAfterPurchases);
  const recalculatedRowsByKey = new Map(recalculatedRows.map(row => [`${row.type}:${row.name}`, row]));
  const rows = originalRows.map(row => recalculatedRowsByKey.get(`${row.type}:${row.name}`) || row);
  const originalIntermediateRows = orderedIntermediateRows(requirements);
  const originalIntermediateRowsByName = new Map(originalIntermediateRows.map(row => [row.name, row]));
  const recalculatedIntermediateRowsByName = new Map(
    orderedIntermediateRows(requirementsAfterPurchases).map(row => [row.name, row])
  );
  const intermediateRows = originalIntermediateRows.map(row => recalculatedIntermediateRowsByName.get(row.name) || row);
  const categorizedRows = categorizeMaterialRows(rows);
  const list = document.createElement('ul');
  list.className = 'materials-list';
  const exchangeSummary = createSupplementSummaryState();
  recalculatedRows.forEach(row => {
    if (row.type === 'item' && row.supplements?.length) {
      accumulateSupplementSummary(exchangeSummary, row.supplements);
    }
  });

  if (resultSourceMode === 'favorite-materials') {
    const activeLists = getActiveFavoriteMaterialLists();
    if (favoriteMaterialsListIds.length >= 1) {
      const production = createProductionContentSection('list');
      const collapsibleLists = activeLists.length > 1;
      activeLists.forEach((list, index) => {
        if (checkedFavoriteMaterialCalcMode === 'any-one' && index > 0)
          production.body.appendChild(createTextElement('div', 'favorite-material-root-or', 'もしくは'));
        appendFavoriteListProduction(production.body, list, { collapsible: collapsibleLists });
      });
      elements.treeContainer.appendChild(production.section);
    }
    if (favoriteMaterialsListIds.length === 0) {
      const roots = getFavoriteMaterialRoots();
      const production = createProductionContentSection('item');
      const target = production.body;
      roots.forEach((root, index) => {
        if (favoriteAnyOneMode() && index > 0) {
          target.appendChild(createTextElement('div', 'favorite-material-root-or', 'もしくは'));
        }
        target.appendChild(
          createResultRootSummary(
            root.name,
            root.qty,
            'result-root-summary favorite-material-root-summary',
            false,
            getDisplayedFavoriteList(),
            { hideEquipmentParameters: true }
          )
        );
      });
      elements.treeContainer.appendChild(production.section);
    }
    const ringSection = createFavoriteRingSection(activeLists);
    if (ringSection) elements.treeContainer.appendChild(ringSection);
  } else {
    elements.treeContainer.appendChild(createResultRootSummary(selectedRecipe, count, 'result-root-summary', true));
  }
  const contextKey =
    resultSourceMode === 'favorite-materials'
      ? `favorite:${favoriteMaterialsListIds.length >= 1 ? favoriteMaterialsListIds.join(',') : getDisplayedFavoriteList()?.id || ''}`
      : selectedRecipeContextKey();
  const appendSectionHeader = (title, initiallyCollapsed, bodyRows, leadingRows = []) => {
    if (bodyRows.length === 0) return;
    const stateKey = `${contextKey}:${title}`;
    const collapsedState = materialSectionState.has(stateKey) ? materialSectionState.get(stateKey) : initiallyCollapsed;
    const header = document.createElement('li');
    header.className = 'materials-section-header';
    const toggle = createTextElement('span', 'materials-section-toggle', collapsedState ? '▶' : '▼');
    header.append(toggle, createTextElement('span', 'materials-section-title', title));
    list.appendChild(header);
    const collapsibleRows = [...leadingRows, ...bodyRows];
    collapsibleRows.forEach(row => {
      row.classList.toggle('collapsed', collapsedState);
      list.appendChild(row);
    });
    header.addEventListener('click', () => {
      const collapsed = toggle.textContent === '▼';
      toggle.textContent = collapsed ? '▶' : '▼';
      materialSectionState.set(stateKey, collapsed);
      collapsibleRows.forEach(row => setCollapsedAnimated(row, collapsed));
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
            appendItemActionButtons(entryRow, createShopInfoButton(entry.name), createGatheringTimerButton(entry.name));
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
    const originalQty = originalIntermediateRowsByName.get(row.name)?.qty || row.qty;
    const reducedQty = Math.max(0, originalQty - (noLongerNeeded ? 0 : row.qty));
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
    const master = recipeVariantMaster(row.name);
    const selector = createRecipeMethodSelector(row.name, { list: currentRecipeSelectionList() });
    if (!selector) {
      for (const label of createCraftRequirementLabels(master, 'badge')) {
        primary.appendChild(label);
      }
    }
    const nameAndQuantity = document.createElement('span');
    nameAndQuantity.className = 'material-name-quantity';
    nameAndQuantity.append(
      createTextElement('span', 'material-name', row.name),
      createTextElement('span', 'material-qty', `× ${formatNumber(row.qty)}`)
    );
    primary.appendChild(nameAndQuantity);
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
        entries.forEach(entry =>
          appendUsageDetail('うち ', entry, entries.length === 1 && row.surplus === 0 && entry.qty === row.produced)
        );
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
      createShopInfoButton(row.name, {
        intermediatePurchase: {
          disabled: noLongerNeeded,
          qty: noLongerNeeded ? 0 : row.qty,
          reducedQty,
          blockers: purchasedIntermediateBlockers(row.name)
        }
      }),
      createGatheringTimerButton(row.name),
      treeButton
    );
    rowElement.appendChild(content);
    li.appendChild(rowElement);
    if (selector) {
      li.classList.add('has-recipe-method');
      li.appendChild(selector);
    }
    return li;
  };

  const intermediateSectionRows = intermediateRows.map(createIntermediateRow);
  const materialSectionRows = [...categorizedRows.normal, ...categorizedRows.exchange].map(createMaterialRow);
  const crystalSectionRows = categorizedRows.crystals.map(createMaterialRow);
  const exchangeSourceRows = rows.filter(row => row.type === 'item' && row.supplements?.length);
  const shouldCollapseExchangeSummary =
    exchangeSourceRows.length > 0 && exchangeSourceRows.every(row => itemMaster[row.name]?.craftType === '9');

  const purchasableIntermediateNames = originalIntermediateRows.filter(row => hasShopInfo(row.name)).map(row => row.name);
  const createBulkPurchaseRow = purchaseLabel => {
    if (purchasableIntermediateNames.length < 2) return [];
    const row = createTextElement('li', 'materials-bulk-actions bulk-action-row', '');
    const purchaseAllButton = document.createElement('button');
    purchaseAllButton.type = 'button';
    purchaseAllButton.textContent = purchaseLabel;
    purchaseAllButton.disabled = purchasableIntermediateNames.every(
      name => purchasedIntermediateNames.has(name) || !requirementsAfterPurchases.states.has(name)
    );
    purchaseAllButton.addEventListener('click', event => {
      event.stopPropagation();
      purchasedIntermediateContext = currentMaterialPurchaseContext();
      purchasableIntermediateNames.forEach(name => purchasedIntermediateNames.add(name));
      saveViewState();
      renderResultView({ preserveScroll: true });
    });
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = '購入取消';
    cancelButton.disabled = purchasedIntermediateNames.size === 0;
    cancelButton.addEventListener('click', event => {
      event.stopPropagation();
      purchasedIntermediateContext = currentMaterialPurchaseContext();
      purchasedIntermediateNames.clear();
      saveViewState();
      renderResultView({ preserveScroll: true });
    });
    row.append(purchaseAllButton, cancelButton);
    return [row];
  };
  appendSectionHeader('製作する中間素材', false, intermediateSectionRows, createBulkPurchaseRow('全中間素材購入'));
  appendSectionHeader('必要素材', false, materialSectionRows, createBulkPurchaseRow('全素材購入'));
  appendSectionHeader('必要なシャード/クリスタル/クラスター', true, crystalSectionRows);

  if (exchangeSummary.fixed.size > 0 || exchangeSummary.choices.size > 0) {
    const summaryRows = [];

    [...exchangeSummary.fixed.values()]
      .sort((a, b) => compareItemNames(a.name, b.name) || Number(a.refinable) - Number(b.refinable))
      .forEach(entry => {
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

    [...exchangeSummary.choices.values()]
      .map(sortSupplementEntries)
      .sort((a, b) => compareItemNames(a[0]?.name || '', b[0]?.name || ''))
      .forEach(entries => {
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
  const selectionList = currentRecipeSelectionList();
  elements.treeContainer.appendChild(
    createResultRootSummary(selectedRecipe, count, 'result-root-summary', true, selectionList)
  );
  if (!recipe) return;
  appendRecipeChildren(
    elements.treeContainer,
    recipe,
    count,
    -1,
    selectedRecipe,
    shouldShowCraftBadgeOnlyAtRoot(selectedRecipe),
    true,
    selectionList
  );
}

function renderMaterialTreeDialog({ preserveScroll = false } = {}) {
  if (!materialTreeRecipe) return;
  const previousScrollTop = elements.materialTreeContent.scrollTop;
  const count = readRequestedCount(elements.materialTreeCountInput);
  elements.materialTreeTitle.textContent = '素材ツリー';
  elements.materialTreeContent.style.height = '';
  elements.materialTreeContent.replaceChildren();
  elements.materialTreeContent.appendChild(
    createResultRootSummary(
      materialTreeRecipe,
      count,
      'material-tree-root-summary',
      false,
      currentRecipeSelectionList()
    )
  );
  const recipe = recipes[materialTreeRecipe];
  if (recipe) {
    appendRecipeChildren(
      elements.materialTreeContent,
      recipe,
      count,
      -1,
      `material-dialog:${materialTreeRecipe}`,
      shouldShowCraftBadgeOnlyAtRoot(materialTreeRecipe),
      false,
      currentRecipeSelectionList()
    );
  }
  lockMaterialTreeContentHeight();
  synchronizeRecipeMethodWidths(elements.materialTreeContent);
  elements.materialTreeContent.scrollTop = preserveScroll ? previousScrollTop : 0;
}

function createResultRootSummary(
  name,
  neededQty,
  className = 'result-root-summary',
  showPin = false,
  selectionList = currentRecipeSelectionList(),
  { hideEquipmentParameters = false } = {}
) {
  const master = recipeVariantMaster(name);
  const recipe = recipes[name];
  const selector = createRecipeMethodSelector(name, { list: selectionList });
  const producedQty = calcProduced(name, neededQty);
  const wrapper = document.createElement('div');
  wrapper.className = className;
  const row = document.createElement('div');
  row.className = 'node-row';
  const icon = createItemIcon(master.icon, 'node-icon');
  if (showPin) row.appendChild(createTreePin(name));
  if (icon) row.appendChild(icon);
  const main = document.createElement('span');
  main.className = 'node-main root-item-main';
  const title = document.createElement('span');
  title.className = 'node-title root-item-title';
  const display = createItemDisplayLabel(name, {
    recipeVariant: recipe,
    hideCraftRequirement: Boolean(selector),
    hideEquipmentParameters
  });
  display.classList.add('root-item-display-label');
  title.append(display, createTextElement('span', 'node-qty', `× ${formatNumber(producedQty)}`));
  main.appendChild(title);
  const subInfo = createTreeSubInfo(recipe, neededQty, producedQty, null, null);
  if (subInfo) main.appendChild(subInfo);
  row.appendChild(main);
  appendItemActionButtons(row, createShopInfoButton(name), createGatheringTimerButton(name));
  wrapper.appendChild(row);
  if (selector) {
    wrapper.classList.add('recipe-method-root');
    wrapper.appendChild(selector);
  }
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
  renderMaterialTreeDialog({ preserveScroll: true });
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
  const label = CRAFT_JOBS_SET.has(method) ? craftJobName(method) : method;
  const badge = CRAFT_JOBS_SET.has(method)
    ? createCraftJobLabel(method, `badge ${methodBadgeClass(method)}`, label)
    : createTextElement('span', `badge ${methodBadgeClass(method)}`, label);
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

function createShopInfoButton(name, { allowIntermediatePurchase = false, intermediatePurchase = null } = {}) {
  if (!hasShopInfo(name)) return null;
  const button = document.createElement('button');
  button.className = 'shop-info-btn';
  button.type = 'button';
  const purchaseEnabled = allowIntermediatePurchase || Boolean(intermediatePurchase);
  const purchased = purchaseEnabled && purchasedIntermediateNames.has(name);
  button.textContent = purchased ? '💰🛒' : '🛒';
  button.title = `${name}の店情報`;
  button.setAttribute('aria-label', `${name}の店情報`);
  button.addEventListener('click', event => {
    event.stopPropagation();
    showShopDialog(name, { allowIntermediatePurchase, intermediatePurchase });
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

function rememberFloatingDialogScroll() {
  floatingDialogScrollState = {
    panelRight: elements.panelRight.scrollTop,
    treeContainer: elements.treeContainer.scrollTop
  };
}

function restoreFloatingDialogScroll() {
  if (!floatingDialogScrollState) return;
  const state = floatingDialogScrollState;
  floatingDialogScrollState = null;
  requestAnimationFrame(() => {
    elements.panelRight.scrollTop = state.panelRight;
    elements.treeContainer.scrollTop = state.treeContainer;
  });
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
  rememberFloatingDialogScroll();
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
      head.appendChild(
        createJobBadge(
          GATHERING_METHOD_JOBS[entry.Method],
          `badge gathering-method ${gatheringMethodClass(entry.Method)}`,
          entry.Method
        )
      );
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
        timeChip
          .querySelector('.gathering-countdown')
          .append(
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
  restoreFloatingDialogScroll();
}

function showShopDialog(name, { allowIntermediatePurchase = false, intermediatePurchase = null } = {}) {
  rememberFloatingDialogScroll();
  const shopInfo = itemMaster[name]?.shopInfo;
  const shops = shopInfo?.shops || [];
  elements.shopDialog.style.width = '';
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
    if (allowIntermediatePurchase || intermediatePurchase) {
      const purchaseLabel = createTextElement('label', 'shop-purchase-option', '');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = purchasedIntermediateNames.has(name);
      checkbox.disabled = Boolean(intermediatePurchase?.disabled);
      checkbox.setAttribute('aria-label', 'この中間素材は購入💰して用意する');
      const qty = intermediatePurchase?.qty;
      const text = checkbox.disabled
        ? '現在は購入指定できません'
        : Number.isFinite(qty)
          ? `${formatNumber(qty)}個を購入💰して用意する`
          : 'この中間素材は購入💰して用意する';
      purchaseLabel.append(checkbox, document.createTextNode(text));
      if (intermediatePurchase?.reducedQty > 0) {
        const blockerText = intermediatePurchase.blockers?.length
          ? `「${intermediatePurchase.blockers.join('」「')}」の購入指定により`
          : '上位中間素材の購入指定により';
        purchaseLabel.appendChild(
          createTextElement(
            'span',
            'shop-purchase-reason',
            checkbox.disabled
              ? `${blockerText}不要です`
              : `${blockerText}${formatNumber(intermediatePurchase.reducedQty)}個不要になりました`
          )
        );
      }
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
    const entryList = createTextElement('div', 'shop-entry-list', '');
    shops.forEach(shop => {
      const entry = createTextElement('div', 'shop-entry', '');
      const hasCoordinates = Number.isFinite(Number(shop.x)) && Number.isFinite(Number(shop.y));
      const location = hasCoordinates ? `${shop.area || ''} X:${shop.x} Y:${shop.y}` : `${shop.area || ''}`;
      entry.append(
        createTextElement('div', 'shop-name', shop.shopName || 'ショップ'),
        createTextElement('div', 'shop-location', location)
      );
      if (shop.requiredRank) {
        entry.appendChild(createTextElement('div', 'shop-required-rank', `必要友好ランク：${shop.requiredRank}`));
      }
      entryList.appendChild(entry);
    });
    listSection.appendChild(entryList);
    elements.shopContent.appendChild(listSection);
  }
  elements.shopOverlay.classList.add('open');
  const entryList = elements.shopContent.querySelector('.shop-entry-list');
  if (entryList) requestAnimationFrame(() => layoutShopEntries(entryList));
}

function layoutShopEntries(entryList) {
  const entries = [...entryList.querySelectorAll('.shop-entry')];
  if (entries.length === 0) return;
  elements.shopDialog.style.width = '';
  entryList.style.gridTemplateColumns = 'minmax(0, 1fr)';
  const compactDialogWidth = elements.shopDialog.getBoundingClientRect().width;
  const dialogWidthOverhead = compactDialogWidth - entryList.clientWidth;
  entryList.classList.add('measuring');
  const requiredWidth = Math.max(...entries.map(entry => entry.getBoundingClientRect().width));
  const maxDialogWidth = Math.min(880, window.innerWidth - 24);
  const gap = 8;
  if (isMobile()) {
    elements.shopDialog.style.width = `${compactDialogWidth}px`;
    entryList.classList.remove('measuring');
    entryList.style.gridTemplateColumns = 'minmax(0, 1fr)';
    return;
  }
  const preferredColumnWidth = Math.min(requiredWidth, 360);
  const availableContentWidth = maxDialogWidth - dialogWidthOverhead;
  const columns = Math.max(
    1,
    Math.min(entries.length, Math.floor((availableContentWidth + gap) / (preferredColumnWidth + gap)))
  );
  const desiredDialogWidth =
    columns > 1
      ? dialogWidthOverhead + preferredColumnWidth * columns + gap * (columns - 1)
      : compactDialogWidth;
  elements.shopDialog.style.width = `${desiredDialogWidth}px`;
  entryList.classList.remove('measuring');
  entryList.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
}

function closeShopDialog() {
  elements.shopOverlay.classList.remove('open');
  restoreFloatingDialogScroll();
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

function appendRecipeChildren(
  container,
  recipe,
  neededQty,
  depth,
  pathKey,
  showCraftBadgeOnlyAtRoot,
  showPins,
  selectionList = null
) {
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
        showPins,
        selectionList
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
  showPins = true,
  selectionList = null
) {
  const recipe = recipes[name];
  const master = recipeVariantMaster(name, recipe) || { method: '', icon: '', craftType: '' };
  const hasChildren = Boolean(recipe);
  const selector = createRecipeMethodSelector(name, { list: selectionList });

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
      selector ? null : createTreeBadge(master.method, hideCraftBadge)
    )
  );
  appendItemActionButtons(row, createShopInfoButton(name), createGatheringTimerButton(name));
  node.appendChild(row);
  if (selector) {
    node.classList.add('has-recipe-method');
    node.appendChild(selector);
  }

  if (!hasChildren) return node;

  const children = document.createElement('div');
  children.className = 'node-children';
  appendRecipeChildren(
    children,
    recipe,
    neededQty,
    depth,
    pathKey,
    showCraftBadgeOnlyAtRoot,
    showPins,
    selectionList
  );

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

function encodeVarUint(value) {
  let remaining = Number(value);
  if (!Number.isSafeInteger(remaining) || remaining < 0) throw new RangeError('可変長整数の値が不正です');
  const bytes = [];
  do {
    let byte = remaining % 128;
    remaining = Math.floor(remaining / 128);
    if (remaining > 0) byte += 128;
    bytes.push(byte);
  } while (remaining > 0);
  return bytes;
}

function decodeVarUint(bytes, state) {
  let value = 0;
  let multiplier = 1;
  for (let count = 0; count < 8; count += 1) {
    if (state.offset >= bytes.length) throw new Error('可変長整数が途中で終了しました');
    const byte = bytes[state.offset];
    state.offset += 1;
    value += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) {
      if (!Number.isSafeInteger(value)) throw new Error('可変長整数が大きすぎます');
      return value;
    }
    multiplier *= 128;
  }
  throw new Error('可変長整数が長すぎます');
}

function crc16Ccitt(bytes) {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function compactRecipeSelections(list) {
  const reachableItemIds = new Set(
    reachableMultiRecipeNames(
      normalizeItemIds(list?.itemIds).map(itemNameForId).filter(Boolean),
      list?.recipeSelections || {}
    ).map(name => String(itemIdForName(name)))
  );
  return Object.entries(normalizeRecipeSelections(list?.recipeSelections))
    .filter(([itemId]) => reachableItemIds.has(itemId))
    .map(([itemId, recipeId]) => {
      const name = itemNameForId(itemId);
      const variant = (recipeVariants[name] || []).find(candidate => candidate.recipeId === recipeId);
      const craftType = Number(variant?.craftType);
      return Number.isInteger(craftType) && craftType >= 0 && craftType <= 7
        ? { itemId: Number(itemId), craftType }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.itemId - b.itemId);
}

function encodeFavoriteList(list) {
  if (!list) return '';
  const nameBytes = new TextEncoder().encode(normalizeFavoriteListName(list.name));
  const itemIds = normalizeItemIds(list.itemIds);
  const selections = compactRecipeSelections(list);
  const payload = [
    1,
    ...encodeVarUint(nameBytes.length),
    ...nameBytes,
    ...encodeVarUint(itemIds.length),
    ...itemIds.flatMap(encodeVarUint),
    ...encodeVarUint(selections.length)
  ];
  let previousItemId = 0;
  selections.forEach(selection => {
    payload.push(...encodeVarUint((selection.itemId - previousItemId) * 8 + selection.craftType));
    previousItemId = selection.itemId;
  });
  const checksum = crc16Ccitt(payload);
  const bytes = Uint8Array.from([...payload, checksum >> 8, checksum & 0xff]);
  return `Y${bytesToBase64Url(bytes)}`;
}

// Settings and favorite sharing
function decodeOldFavorites(str) {
  if (!str || !/^[A-Z0-9]+$/.test(str) || str.length % 4 !== 0) return null;
  const names = [];
  for (let i = 0; i < str.length; i += 4) {
    const name = idToRecipeName[parseInt(str.slice(i, i + 4), 36)];
    if (name) names.push(name);
  }
  return {
    name: '',
    itemIds: names.map(itemIdForName).filter(Boolean),
    recipeSelections: {},
    needsName: true
  };
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
      recipeSelections: {},
      needsName: false
    };
  } catch {
    return null;
  }
}

function decodeCompactFavoriteList(str) {
  if (!str.startsWith('Y')) return null;
  const bytes = base64UrlToBytes(str.slice(1));
  if (!bytes || bytes.length < 5) return null;
  const payload = bytes.subarray(0, -2);
  const expectedChecksum = (bytes[bytes.length - 2] << 8) | bytes[bytes.length - 1];
  if (crc16Ccitt(payload) !== expectedChecksum) return null;

  try {
    const state = { offset: 0 };
    const version = payload[state.offset];
    state.offset += 1;
    if (version !== 1) return null;
    const nameLength = decodeVarUint(payload, state);
    if (nameLength < 0 || state.offset + nameLength > payload.length) return null;
    const name = normalizeFavoriteListName(new TextDecoder().decode(payload.subarray(state.offset, state.offset + nameLength)));
    state.offset += nameLength;

    const itemCount = decodeVarUint(payload, state);
    if (itemCount > 10000) return null;
    const itemIds = [];
    for (let index = 0; index < itemCount; index += 1) itemIds.push(decodeVarUint(payload, state));

    const selectionCount = decodeVarUint(payload, state);
    if (selectionCount > 10000) return null;
    const recipeSelections = {};
    let previousItemId = 0;
    for (let index = 0; index < selectionCount; index += 1) {
      const packed = decodeVarUint(payload, state);
      const craftType = packed % 8;
      const itemId = previousItemId + Math.floor(packed / 8);
      previousItemId = itemId;
      const itemName = itemNameForId(itemId);
      const matches = (recipeVariants[itemName] || []).filter(variant => Number(variant.craftType) === craftType);
      if (matches.length === 1) recipeSelections[String(itemId)] = matches[0].recipeId;
    }
    if (state.offset !== payload.length) return null;
    return {
      name,
      itemIds: normalizeItemIds(itemIds).filter(id => itemNameForId(id)),
      recipeSelections,
      needsName: false
    };
  } catch {
    return null;
  }
}

function decodeFavoriteShareCode(str) {
  const source = String(str || '').trim();
  if (!source) return null;
  if (source.startsWith('Y')) return decodeCompactFavoriteList(source);
  const legacy = source.toUpperCase();
  if (!/^[A-Z0-9]+$/.test(legacy)) return null;
  if (legacy.startsWith('Z')) return decodeNewFavoriteList(legacy);
  return decodeOldFavorites(legacy);
}

function openSettings() {
  selectedExportListId = null;
  elements.exportCode.value = '';
  elements.exportListToggle.textContent = 'リストを選択...';
  elements.copyExportBtn.textContent = 'コピー';
  elements.importCode.value = '';
  setImportError();
  setFavoriteListFileStatus();
  closeExportListDropdown();
  renderExportListChoices();
  elements.settingsOverlay.classList.add('open');
}

function closeSettings() {
  elements.settingsOverlay.classList.remove('open');
  closeExportListDropdown();
}

const SHARE_PLAZA_URL = ['127.0.0.1', 'localhost'].includes(location.hostname)
  ? `http://${location.hostname}:4174/share-code-plaza.html`
  : 'https://jogu6.github.io/ffxiv-recipe-about/share-code-plaza.html';

function openSharePlaza() {
  if (!elements.sharePlazaFrame.src) elements.sharePlazaFrame.src = SHARE_PLAZA_URL;
  elements.sharePlazaOverlay.classList.add('open');
  elements.sharePlazaOverlay.setAttribute('aria-hidden', 'false');
}

function closeSharePlaza() {
  elements.sharePlazaOverlay.classList.remove('open');
  elements.sharePlazaOverlay.setAttribute('aria-hidden', 'true');
}

function isTrustedSharePlazaMessage(event) {
  if (event.source !== elements.sharePlazaFrame.contentWindow) return false;
  if (event.origin === 'https://jogu6.github.io') return true;
  if (!['127.0.0.1', 'localhost'].includes(location.hostname)) return false;
  return event.origin === `http://${location.hostname}:4174`;
}

function importFavoriteFromSharePlaza(code) {
  const decoded = decodeFavoriteShareCode(code);
  if (!decoded || decoded.needsName || decoded.itemIds.length === 0) return;
  showTextInput('取り込むお気に入りリスト名', decoded.name, name => {
    const list = createFavoriteList(name, decoded.itemIds, decoded.recipeSelections);
    renderFavoriteLists();
    renderExportListChoices();
    elements.sharePlazaFrame.contentWindow?.postMessage(
      { type: 'ffxiv-share-code-imported', listName: list.name },
      '*'
    );
  });
}

function handleSharePlazaMessage(event) {
  if (!isTrustedSharePlazaMessage(event) || !event.data || typeof event.data !== 'object') return;
  if (event.data.type === 'ffxiv-share-code-plaza-close') closeSharePlaza();
  if (event.data.type === 'ffxiv-share-code-import') importFavoriteFromSharePlaza(event.data.code);
}

function renderMarkdown(markdown, { breaks = false } = {}) {
  if (!window.marked?.parse || !window.DOMPurify?.sanitize) {
    throw new Error('Markdownレンダラの読み込みに失敗しました');
  }
  return window.DOMPurify.sanitize(window.marked.parse(markdown, { gfm: true, breaks }));
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
    setTimeout(() => {
      elements.copyExportBtn.textContent = 'コピー';
    }, 1500);
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

function setFavoriteListFileStatus(message = '', { error = false } = {}) {
  elements.favoriteListFileStatus.textContent = message;
  elements.favoriteListFileStatus.classList.toggle('error', Boolean(message) && error);
}

function localDateStamp(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('-');
}

function favoriteListFileBlock(list) {
  const itemNames = list.itemIds.map(itemNameForId).filter(Boolean);
  const itemLines = itemNames.length > 0 ? itemNames.map(name => `・${name}`).join('\n') : '・（アイテムなし）';
  return `【${list.name}】\n登録アイテム:\n${itemLines}\n\n復元コード:\n${encodeFavoriteList(list)}`;
}

function exportAllFavoriteLists() {
  const lists = favoriteStore.lists.filter(list => !isRecentList(list));
  if (lists.length === 0) {
    setFavoriteListFileStatus('書き出せるお気に入りリストがありません', { error: true });
    return;
  }
  const text = `${FAVORITE_LIST_FILE_TITLE}\n\n${lists.map(favoriteListFileBlock).join(FAVORITE_LIST_FILE_SEPARATOR)}\n`;
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `favorite-lists-${localDateStamp()}.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  setFavoriteListFileStatus(`${lists.length}件のお気に入りリストを書き出しました`);
}

function decodeFavoriteListFile(source) {
  const normalized = String(source || '').replace(/\r\n?/g, '\n').trim();
  const prefix = `${FAVORITE_LIST_FILE_TITLE}\n\n`;
  if (!normalized.startsWith(prefix)) return null;
  const blocks = normalized.slice(prefix.length).split(FAVORITE_LIST_FILE_SEPARATOR);
  if (blocks.length === 0 || blocks.length > FAVORITE_LIST_FILE_MAX_LISTS) return null;
  const names = new Set();
  const lists = [];
  for (const block of blocks) {
    const match = block.match(/^【(.+)】\n登録アイテム:\n([\s\S]+?)\n\n復元コード:\n(\S+)$/);
    if (!match) return null;
    const [, displayedName, displayedItems, shareCode] = match;
    const decoded = decodeFavoriteShareCode(shareCode);
    const itemNames = decoded?.itemIds.map(itemNameForId).filter(Boolean) || [];
    const expectedItems = itemNames.length > 0 ? itemNames.map(name => `・${name}`).join('\n') : '・（アイテムなし）';
    if (
      !decoded ||
      decoded.needsName ||
      normalizeFavoriteListName(displayedName) !== decoded.name ||
      displayedItems !== expectedItems ||
      names.has(decoded.name)
    ) {
      return null;
    }
    names.add(decoded.name);
    lists.push(decoded);
  }
  return lists;
}

function applyFavoriteListFileImport(decodedLists, mode) {
  const previousLists = favoriteStore.lists;
  const previousSelectedListId = favoriteStore.selectedListId;
  const replacedListIds =
    mode === 'replace' ? new Set(previousLists.filter(list => !isRecentList(list)).map(list => list.id)) : new Set();
  if (mode === 'replace') {
    const recent = previousLists.find(isRecentList) || createRecentList();
    favoriteStore.lists = [recent];
    favoriteStore.selectedListId = null;
  }

  const imported = decodedLists.map(decoded => {
    const list = {
      id: createFavoriteListId(),
      name: uniqueFavoriteListName(decoded.name),
      itemIds: normalizeItemIds(decoded.itemIds),
      recipeSelections: normalizeRecipeSelections(decoded.recipeSelections),
      materialSelected: false
    };
    favoriteStore.lists.push(list);
    return list;
  });
  if (mode === 'replace') favoriteStore.selectedListId = imported[0]?.id || RECENT_LIST_ID;

  if (!saveFavorites()) {
    favoriteStore.lists = previousLists;
    favoriteStore.selectedListId = previousSelectedListId;
    setFavoriteListFileStatus('お気に入りリストを保存できませんでした', { error: true });
    return;
  }
  if (mode === 'replace') {
    replacedListIds.forEach(listId => {
      delete favoriteItemCountStore.lists[listId];
      delete favoriteListProductionExpanded[listId];
      delete favoriteMaterialsRingCounts[listId];
    });
    favoriteMaterialsListIds = favoriteMaterialsListIds.filter(listId => !replacedListIds.has(listId));
    saveFavoriteItemCountStore();
  }
  renderFavoriteLists();
  renderExportListChoices();
  updateFavoriteButtonState();
  if (listMode === 'fav') {
    renderList();
    renderResultView();
  }
  setFavoriteListFileStatus(
    `${imported.length}件のお気に入りリストを${mode === 'replace' ? '置き換えて' : '追加して'}読み込みました`
  );
}

function confirmFavoriteListFileImport(decodedLists) {
  const content = document.createElement('div');
  content.className = 'favorite-list-file-confirm';
  content.appendChild(createTextElement('div', '', `${decodedLists.length}件のお気に入りリストを読み込みます`));
  const preview = document.createElement('ul');
  preview.className = 'favorite-list-file-preview';
  decodedLists.forEach(list => preview.appendChild(createTextElement('li', '', list.name)));
  content.appendChild(preview);
  const choices = document.createElement('div');
  choices.className = 'favorite-list-file-import-modes';
  const createChoice = (value, text, checked = false) => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'favorite-list-file-import-mode';
    input.value = value;
    input.checked = checked;
    label.append(input, document.createTextNode(text));
    return label;
  };
  choices.append(
    createChoice('add', '既存を残して追加', true),
    createChoice('replace', '既存をすべて削除して置き換える')
  );
  content.appendChild(choices);
  showConfirmContent(content, () => {
    const mode = choices.querySelector('input:checked')?.value === 'replace' ? 'replace' : 'add';
    applyFavoriteListFileImport(decodedLists, mode);
  });
  elements.confirmYes.textContent = '読み込む';
}

async function importAllFavoriteLists(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  if (file.size > FAVORITE_LIST_FILE_MAX_BYTES) {
    setFavoriteListFileStatus('ファイルサイズが大きすぎます', { error: true });
    return;
  }
  let source;
  try {
    source = await file.text();
  } catch {
    setFavoriteListFileStatus('ファイルを読み込めませんでした', { error: true });
    return;
  }
  const decodedLists = decodeFavoriteListFile(source);
  if (!decodedLists) {
    setFavoriteListFileStatus('対応していない、または内容が不正なファイルです', { error: true });
    return;
  }
  setFavoriteListFileStatus();
  confirmFavoriteListFileImport(decodedLists);
}

function startImport() {
  const code = elements.importCode.value.trim();
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
    const list = createFavoriteList(name, decoded.itemIds, decoded.recipeSelections);
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
  const top = Math.round((screen.height - h) / 2);
  const win = window.open(
    location.pathname,
    'ff14recipe',
    `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=no,toolbar=no,menubar=no,location=no,status=no`
  );
  if (!win) alert('ポップアップがブロックされました。\nアドレスバーの通知から許可してください。');
}

// Event wiring and application startup
function handleDocumentPointerDown(event) {
  if (!event.target.closest?.('.custom-select')) closeAllCustomSelects();
  if (
    event.target !== elements.searchBox &&
    event.target !== elements.equipmentSearchToggle &&
    !elements.searchHistory.contains(event.target) &&
    !elements.equipmentSearchPanel?.contains(event.target)
  ) {
    closeSearchHistory();
  }
  if (
    event.target !== elements.favBtn &&
    !elements.favoriteLists.contains(event.target) &&
    !elements.checkedFavoriteMaterialsActions.contains(event.target) &&
    !elements.licenseOverlay.contains(event.target)
  ) {
    closeFavoriteLists();
  }
  if (event.target !== elements.exportListToggle && !elements.exportListChoices.contains(event.target)) {
    closeExportListDropdown();
  }
}

function bindEvents() {
  const standaloneQuery = window.matchMedia('(display-mode: standalone)');
  const overlayQuery = window.matchMedia('(display-mode: window-controls-overlay)');
  standaloneQuery.addEventListener?.('change', updatePopupButtonVisibility);
  overlayQuery.addEventListener?.('change', updatePopupButtonVisibility);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (elements.shopOverlay.classList.contains('open')) closeShopDialog();
    else if (elements.gatheringOverlay.classList.contains('open')) closeGatheringDialog();
  });

  elements.appTitle.addEventListener('click', resetToStartupView);
  elements.appTitle.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    resetToStartupView();
  });
  elements.popupBtn.addEventListener('click', openPopup);
  elements.settingsBtn.addEventListener('click', openSettings);
  elements.searchBox.addEventListener('input', scheduleSearchFromInput);
  elements.searchBox.addEventListener('compositionstart', () => {
    searchCompositionActive = true;
  });
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
  elements.checkedFavoriteSumModeBtn.addEventListener('click', () => {
    checkedFavoriteMaterialCalcMode = 'sum';
    updateCheckedFavoriteMaterialsButton();
  });
  elements.checkedFavoriteAnyOneModeBtn.addEventListener('click', () => {
    checkedFavoriteMaterialCalcMode = 'any-one';
    favoriteAnyListProductionExpanded = true;
    updateCheckedFavoriteMaterialsButton();
  });
  elements.checkedFavoriteMaterialsHelpBtn.addEventListener('click', () => {
    openMarkdownNotice(
      '拡張機能について',
      `### 合算

チェックした複数のお気に入りリスト内の全アイテムを制作するために必要な素材を合算して表示します。

### どれか1リスト

チェックしたお気に入りリストのうち、どれか1リストをセット数分製作するために必要な素材リストを表示します。チェックしたすべてのリストを製作する素材リストではありません。

完成品が直接使う同じ末端素材は各リスト内で合算してから、リスト間で最も多い数を表示します。同じ中間素材もリスト間で最も多く必要な数を1回分だけ表示します。異なる中間素材はそれぞれ表示し、それらの製作に共通して使う末端素材は合算します。`
    );
  });
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
  const renderResultViewPreservingScroll = () => renderResultView({ preserveScroll: true });
  elements.countInput.addEventListener('input', () =>
    handleRequestedCountInput(elements.countInput, renderResultViewPreservingScroll)
  );
  elements.countInput.addEventListener('blur', () =>
    commitRequestedCountInput(elements.countInput, renderResultViewPreservingScroll)
  );
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
  const renderMaterialTreeDialogPreservingScroll = () => renderMaterialTreeDialog({ preserveScroll: true });
  elements.materialTreeCountInput.addEventListener('input', () => {
    handleRequestedCountInput(elements.materialTreeCountInput, renderMaterialTreeDialogPreservingScroll);
  });
  elements.materialTreeCountInput.addEventListener('blur', () => {
    commitRequestedCountInput(elements.materialTreeCountInput, renderMaterialTreeDialogPreservingScroll);
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
  Object.entries(scrollPositionContainers()).forEach(([key, container]) => {
    container.addEventListener(
      'scroll',
      () => {
        if (!isScrollPositionActive(key)) return;
        viewScrollPositions[key] = container.scrollTop;
        scheduleScrollStateSave();
      },
      { passive: true }
    );
  });
  window.addEventListener('pagehide', () => {
    saveViewState();
    stopGatheringTimerUpdates();
  });
  window.addEventListener('resize', () => {
    if (elements.favoriteLists.classList.contains('open')) updateFavoriteListsMaxHeight();
    const shopEntries = elements.shopContent.querySelector('.shop-entry-list');
    if (elements.shopOverlay.classList.contains('open') && shopEntries) layoutShopEntries(shopEntries);
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
  elements.exportAllFavoritesBtn.addEventListener('click', exportAllFavoriteLists);
  elements.importAllFavoritesBtn.addEventListener('click', () => elements.importAllFavoritesFile.click());
  elements.importAllFavoritesFile.addEventListener('change', importAllFavoriteLists);
  elements.sharePlazaOpenBtn.addEventListener('click', openSharePlaza);
  window.addEventListener('message', handleSharePlazaMessage);
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
  navigator.serviceWorker
    .register('./sw.js')
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
