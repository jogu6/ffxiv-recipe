const DATA_FILE = './data/Item.json';
const TIPS_FILE = './data/tips.json';
const LS_FAV = 'ff14_favorites';
const LS_FAV_LISTS = 'ff14_favorite_lists_v2';
const LS_SEARCH_HISTORY = 'ff14_search_history';
const SEARCH_HISTORY_LIMIT = 30;
const FAVORITE_NAME_MAX = 50;
const MOBILE_BREAKPOINT = 600;

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

const LICENSE_NOTICE_TEXT = `The MIT License applies only to the original application source code and project tooling in this repository.

It does not grant rights to game images, game data, names, trademarks, or other third-party material stored or referenced by this project.

- FINAL FANTASY XIV (C) SQUARE ENIX
- FINAL FANTASY is a registered trademark of Square Enix Holdings Co., Ltd.
- FINAL FANTASY XIV images, names, item and recipe data, trademarks, and other game-derived materials are owned by SQUARE ENIX.
- Item and recipe information is derived from FINAL FANTASY XIV data.
- Item image acquisition uses XIVAPI endpoints.

This project is unofficial and is not affiliated with, sponsored by, approved by, or endorsed by SQUARE ENIX.

All third-party material remains subject to the rights and terms of its respective owner. Use of FINAL FANTASY XIV materials is intended to follow the FINAL FANTASY XIV Materials Usage License and related SQUARE ENIX rules and policies.

If SQUARE ENIX requests correction, removal, suspension, or discontinuation of any material or service related to this project, the maintainer will respond promptly and comply. If necessary, distribution of the application may be suspended and affected materials or data may be removed.

XIVAPI is used as a community data and asset endpoint where applicable. Use of XIVAPI remains subject to any applicable XIVAPI documentation, service guidance, and maintainer requests.`;

// Cached DOM references
const elements = {
  appVersion: document.getElementById('appVersion'),
  loadStatus: document.getElementById('loadStatus'),
  popupBtn: document.getElementById('popupBtn'),
  settingsBtn: document.getElementById('settingsBtn'),
  panelLeft: document.getElementById('panelLeft'),
  panelMiddle: document.getElementById('panelMiddle'),
  panelRight: document.getElementById('panelRight'),
  searchBox: document.getElementById('searchBox'),
  searchClearBtn: document.getElementById('searchClearBtn'),
  searchHistory: document.getElementById('searchHistory'),
  favBtn: document.getElementById('favBtn'),
  favoriteLists: document.getElementById('favoriteLists'),
  recipeList: document.getElementById('recipeList'),
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
  licenseBtn: document.getElementById('licenseBtn'),
  licenseOverlay: document.getElementById('licenseOverlay'),
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
  favoriteTargetCancelBtn: document.getElementById('favoriteTargetCancelBtn')
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
let usedIn = {};
let ingredientNames = [];
let prevPanel = 'left';
let listMode = 'none';
let resultViewMode = 'tree';
let resultSourceMode = 'recipe';
let favoriteMaterialsRingCounts = {};
let pendingConfirmAction = null;
let pendingTextInputAction = null;
let selectedExportListId = null;
let wasMobile = isMobile();

const treePinMap = new Map();
const exchangeTreeState = new Map();

function isMobile() {
  return window.innerWidth <= MOBILE_BREAKPOINT;
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

function getSelectedFavoriteList() {
  return favoriteStore.lists.find(list => list.id === favoriteStore.selectedListId) || null;
}

function getDisplayedFavoriteList() {
  return listMode === 'fav' ? getSelectedFavoriteList() : null;
}

function getFavoriteListRecipeNames(list = getDisplayedFavoriteList()) {
  return list ? list.itemIds.map(recipeNameForId).filter(name => name && recipes[name]) : [];
}

function isRingRecipe(name) {
  return itemMaster[name]?.uiCategoryName === '指輪';
}

function findFavoriteList(id) {
  return favoriteStore.lists.find(list => list.id === id) || null;
}

function recipeIdForName(name) {
  const id = parseInt(itemMaster[name]?.id, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function recipeNameForId(id) {
  return idToRecipeName[parseInt(id, 10)] || null;
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
  const lists = Array.isArray(stored?.lists)
    ? stored.lists.map(list => ({
        id: typeof list.id === 'string' ? list.id : createFavoriteListId(),
        name: normalizeFavoriteListName(list.name),
        itemIds: normalizeItemIds(list.itemIds)
      }))
    : [];

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

function isFavorite(name) {
  const list = getDisplayedFavoriteList();
  const id = recipeIdForName(name);
  return Boolean(list && id && list.itemIds.includes(id));
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
  elements.tipsMsg.classList.remove('hidden');
  if (!isMobile()) renderTips();
  else showMobilePanel('left');
}

function applyFavoriteChange(name, shouldAdd, listId = getDisplayedFavoriteList()?.id) {
  const list = findFavoriteList(listId);
  const id = recipeIdForName(name);
  if (!list || !id) return;

  if (shouldAdd && !list.itemIds.includes(id)) list.itemIds.push(id);
  if (!shouldAdd) list.itemIds = list.itemIds.filter(itemId => itemId !== id);
  saveFavorites();
  refreshPins(name);
  if (listMode === 'fav') renderList();
}

function pinOn(name) {
  openFavoriteTarget(name);
}

function pinOff(name) {
  showConfirm(`「${name}」を\nお気に入りから削除しますか？`, () => {
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

function onSearch() {
  const q = elements.searchBox.value.trim();
  leaveFavoriteMaterialsMode();
  elements.searchClearBtn.classList.toggle('visible', q !== '');
  elements.favBtn.classList.remove('active');
  closeFavoriteLists();
  listMode = q === '' ? 'none' : 'search';
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
}

function selectFavoriteList(listId) {
  leaveFavoriteMaterialsMode();
  favoriteStore.selectedListId = listId;
  saveFavorites();
  listMode = 'fav';
  elements.favBtn.classList.add('active');
  closeFavoriteLists();
  resetTreeSelection();
  renderList();
}

function renameFavoriteList(listId) {
  const list = findFavoriteList(listId);
  if (!list) return;
  showTextInput('お気に入りリスト名を変更', list.name, value => {
    list.name = uniqueFavoriteListName(value, list.id);
    saveFavorites();
    renderFavoriteLists();
    renderExportListChoices();
  });
}

function deleteFavoriteList(listId) {
  const list = findFavoriteList(listId);
  if (!list) return;
  showConfirm(`「${list.name}」を\n削除しますか？`, () => {
    const wasDisplayed = getDisplayedFavoriteList()?.id === listId;
    favoriteStore.lists = favoriteStore.lists.filter(entry => entry.id !== listId);
    if (favoriteStore.selectedListId === listId) {
      favoriteStore.selectedListId = null;
    }
    if (wasDisplayed) {
      listMode = 'none';
      elements.favBtn.classList.remove('active');
      resetTreeSelection();
    }
    saveFavorites();
    renderFavoriteLists();
    renderExportListChoices();
    renderList();
  });
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
  const li = document.createElement('li');
  li.className = 'favorite-materials-row';
  const button = document.createElement('button');
  button.className = 'favorite-list-action';
  button.type = 'button';
  button.textContent = '素材リスト';
  button.addEventListener('click', event => {
    event.stopPropagation();
    openFavoriteMaterialsMode();
  });
  li.appendChild(button);
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

  if (favoriteStore.lists.length === 0) {
    frag.appendChild(createEmptyListItem('お気に入りリストがありません'));
  } else {
    favoriteStore.lists.forEach(list => {
      const li = document.createElement('li');
      li.classList.toggle('active', list.id === getDisplayedFavoriteList()?.id);

      const name = createTextElement('span', 'favorite-list-name', list.name);
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

      li.append(name, renameBtn, deleteBtn);
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

function addFavoriteToNewList(name) {
  closeFavoriteTarget();
  showTextInput('新しいお気に入りリスト名', formatDefaultListName(), value => {
    const id = recipeIdForName(name);
    const list = createFavoriteList(value, id ? [id] : []);
    favoriteStore.selectedListId = list.id;
    saveFavorites();
    listMode = 'fav';
    elements.favBtn.classList.add('active');
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
  const selectedList = getDisplayedFavoriteList();

  elements.favoriteTargetCreate.replaceChildren(
    createFavoriteTargetButton('新規作成', !selectedList, () => addFavoriteToNewList(name))
  );
  favoriteStore.lists.forEach(list => {
    frag.appendChild(createFavoriteTargetButton(list.name, list.id === selectedList?.id, () => {
      addFavoriteToList(name, list.id);
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
      return list ? list.itemIds.map(recipeNameForId).filter(name => name && recipes[name]) : [];
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

function renderTips() {
  const rows = tipsData.map(text => createTextElement('div', 'tips-row', text));
  elements.tipsMsg.replaceChildren(...rows);
}

function renderList() {
  const frag = document.createDocumentFragment();
  const names = getDisplayList();

  if (listMode === 'none' && isMobile()) {
    const li = document.createElement('li');
    li.className = 'tips-li';
    tipsData.forEach(text => li.appendChild(createTextElement('div', 'tips-row-list', text)));
    frag.appendChild(li);
  } else if (listMode === 'fav' && !getDisplayedFavoriteList()) {
    frag.appendChild(createEmptyListItem('お気に入りリストを選択してください'));
  } else if (listMode === 'fav' && names.length === 0) {
    frag.appendChild(createEmptyListItem('お気に入りはありません'));
  } else if (names.length === 0) {
    frag.appendChild(createEmptyListItem('該当するレシピがありません'));
  } else {
    if (listMode === 'fav' && getDisplayedFavoriteList()) {
      frag.appendChild(createFavoriteMaterialsRow());
    }
    names.forEach(name => {
      if (listMode === 'fav') frag.appendChild(makeFavLi(name));
      else if (recipes[name]) frag.appendChild(makeRecipeLi(name));
      else frag.appendChild(makeIngredientLi(name));
    });
  }

  if (listMode === 'fav' && getDisplayedFavoriteList()) {
    frag.appendChild(createFavoriteSaveRow());
  }

  elements.recipeList.replaceChildren(frag);
}

function makeFavLi(name) {
  const li = createItemListRow(name, 'fav-item-row');
  li.classList.toggle('selected', selectedRecipe === name);

  const pin = document.createElement('button');
  pin.className = 'pin-btn';
  pin.textContent = '📌';
  pin.title = 'お気に入りから削除';
  pin.addEventListener('click', event => {
    event.stopPropagation();
    pinOff(name);
  });
  li.insertBefore(pin, li.querySelector('.list-name'));

  li.addEventListener('click', () => selectRecipeByName(name));
  return li;
}

function makeRecipeLi(name) {
  const li = createItemListRow(name);
  li.classList.toggle('selected', selectedRecipe === name);

  li.addEventListener('click', () => {
    rememberCurrentSearch();
    selectRecipe(name, li);
  });
  return li;
}

function makeIngredientLi(name) {
  const li = createItemListRow(name, 'ingredient-row');
  const usesButton = document.createElement('button');
  usesButton.className = 'uses-list-btn';
  usesButton.type = 'button';
  usesButton.textContent = '使用先';
  usesButton.addEventListener('click', event => {
    event.stopPropagation();
    rememberCurrentSearch();
    showUsesPanel(name);
  });
  li.appendChild(usesButton);
  li.addEventListener('click', () => {
    rememberCurrentSearch();
    showUsesPanel(name);
  });
  return li;
}

function closeUsesPanel() {
  elements.panelMiddle.classList.remove('open');
  elements.panelMiddle.classList.remove('mobile-visible');
}

// Used-in panel and mobile navigation
function showUsesPanel(ingredientName) {
  const uses = usedIn[ingredientName] || [];
  elements.usesTitle.textContent = `${ingredientName}（${uses.length}件）`;
  const frag = document.createDocumentFragment();

  uses.forEach(recipeName => {
    const li = createItemListRow(recipeName);
    li.addEventListener('click', () => {
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
}

function goBack() {
  showMobilePanel(prevPanel);
}

function returnToList() {
  closeUsesPanel();
  showMobilePanel('left');
}

function selectRecipe(name, li) {
  selectedRecipe = name;
  leaveFavoriteMaterialsMode();
  exchangeTreeState.clear();
  setResultViewMode('tree');
  elements.recipeList.querySelectorAll('li').forEach(el => el.classList.remove('selected'));
  li.classList.add('selected');
  renderResultView();
  if (isMobile()) {
    prevPanel = 'left';
    showMobilePanel('right');
    elements.treeContainer.scrollTop = 0;
  }
}

function selectRecipeByName(name) {
  selectedRecipe = name;
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
    const match = source.match(/const\s+CACHE_VERSION\s*=\s*['"][^'"]*?(v\d+(?:\.\d+)*)['"]/i);
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
    const response = await fetch(TIPS_FILE);
    tipsData = response.ok ? await response.json() : [];
  } catch {
    tipsData = ['📌 ピンでお気に入り登録', 'あ〜英 で行絞り込み', '検索欄でアイテム名検索'];
  }
}

function iconPath(item) {
  if (!item?.IconFile) return '';
  const folder = item.IconFile.slice(0, 3);
  return `./assets/item-icons/${folder}/${item.IconFile}`;
}

function buildItemAndRecipeMasters(rawList, idToItem) {
  let maxPatch = 0;

  rawList.forEach(item => {
    const recipe = item.Recipe;
    const name = item.Name;

    if (recipe?.PatchNumber) {
      const patchNumber = parseInt(recipe.PatchNumber, 10);
      if (patchNumber > maxPatch) maxPatch = patchNumber;
    }

    if (recipe && recipe.CraftType !== undefined) {
      const craftType = String(recipe.CraftType);
      itemMaster[name] = {
        method: CRAFT_TYPE_NAME[recipe.CraftType] || 'クラフト',
        icon: iconPath(item),
        craftType,
        id: item.ID,
        uiCategoryName: item.ItemUICategoryName || ''
      };
      recipes[name] = {
        yield: parseInt(recipe.AmountResult, 10) || 1,
        craftType,
        ingredients: recipe.Ingredients.map(ingredient => ({
          name: ingredient.Name,
          qty: parseInt(ingredient.Amount, 10) || 1,
          itemId: ingredient.ItemID
        }))
      };

      const numericId = parseInt(item.ID, 10);
      if (!Number.isNaN(numericId)) idToRecipeName[numericId] = name;
    } else if (!itemMaster[name]) {
      itemMaster[name] = {
        method: '',
        icon: iconPath(item),
        craftType: '',
        id: item.ID,
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
  rawList.forEach(item => { idToItem[item.ID] = item; });
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
  loadFavorites();
  loadSearchHistory();
  await loadTips();

  renderList();
  if (!isMobile()) renderTips();

  try {
    const rawList = await fetchJson(
      DATA_FILE,
      status => `Item.json が見つかりません (${status})`
    );
    updatePatchStatus(buildApplicationData(rawList));
    renderList();
    if (isMobile()) showMobilePanel('left');
  } catch (e) {
    showLoadError(e);
  }
}

function showMobilePanel(panelName) {
  if (!isMobile()) return;
  elements.panelLeft.classList.toggle('mobile-visible', panelName === 'left');
  elements.panelMiddle.classList.toggle('mobile-visible', panelName === 'middle');
  elements.panelRight.classList.toggle('mobile-visible', panelName === 'right');
}

function clearMobilePanels() {
  elements.panelLeft.classList.remove('mobile-visible');
  elements.panelMiddle.classList.remove('mobile-visible');
  elements.panelRight.classList.remove('mobile-visible');
}

function changeCount(delta) {
  elements.countInput.value = Math.max(1, (parseInt(elements.countInput.value, 10) || 1) + delta);
  renderResultView();
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
  return getFavoriteListRecipeNames(list).filter(isRingRecipe);
}

function ensureFavoriteMaterialsRingCounts() {
  const ringNames = getFavoriteMaterialRingNames();
  favoriteMaterialsRingCounts = Object.fromEntries(
    ringNames.map(name => [name, favoriteMaterialsRingCounts[name] === 2 ? 2 : 1])
  );
}

function openFavoriteMaterialsMode() {
  if (!getDisplayedFavoriteList()) return;
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
  const count = parseInt(elements.countInput.value, 10) || 1;
  if (resultSourceMode === 'favorite-materials') {
    const listName = getDisplayedFavoriteList()?.name || '';
    elements.countLabel.textContent = 'セット数:';
    elements.resultTitle.textContent = listName ? `【${listName} × ${count}セット分】` : '';
    elements.usesBtn.classList.remove('visible');
    elements.treeViewBtn.classList.add('hidden');
    elements.materialsViewBtn.classList.remove('hidden');
    elements.materialsViewBtn.classList.add('active');
    elements.materialsViewBtn.disabled = true;
    elements.resultViewSwitch.classList.toggle('hidden', !listName);
    elements.resultViewSwitch.classList.add('favorite-materials-only');
    return;
  }

  elements.countLabel.textContent = '個数:';
  elements.resultTitle.textContent = selectedRecipe ? `【${selectedRecipe} × ${count}個分】` : '';
  const usesCount = selectedRecipe ? (usedIn[selectedRecipe]?.length || 0) : 0;
  elements.usesBtn.textContent = `使用先 (${usesCount})`;
  elements.usesBtn.classList.toggle('visible', usesCount > 0);
  elements.treeViewBtn.classList.remove('hidden');
  elements.materialsViewBtn.disabled = false;
  elements.resultViewSwitch.classList.remove('favorite-materials-only');
  const showSwitch = Boolean(selectedRecipe);
  elements.resultViewSwitch.classList.toggle('hidden', !showSwitch);
}

function renderResultView() {
  clearRenderedTree();
  updateResultHeader();

  if (resultSourceMode === 'favorite-materials' && !getDisplayedFavoriteList()) {
    elements.tipsMsg.classList.remove('hidden');
    setResultSourceMode('recipe');
    updateResultHeader();
    return;
  }

  if (!selectedRecipe && resultSourceMode !== 'favorite-materials') {
    elements.tipsMsg.classList.remove('hidden');
    return;
  }

  elements.tipsMsg.classList.add('hidden');
  if (resultViewMode === 'materials') renderMaterialsList();
  else renderTree();
}

function resetToStartupView() {
  leaveFavoriteMaterialsMode();
  selectedRecipe = null;
  prevPanel = 'left';
  listMode = 'none';
  setResultViewMode('tree');
  favoriteStore.selectedListId = null;
  saveFavorites();
  treePinMap.clear();
  exchangeTreeState.clear();

  elements.searchBox.value = '';
  elements.searchClearBtn.classList.remove('visible');
  elements.favBtn.classList.remove('active');
  closeSearchHistory();
  closeFavoriteLists();
  closeUsesPanel();

  elements.usesTitle.textContent = '';
  elements.usesList.replaceChildren();
  elements.countInput.value = '1';

  clearRenderedTree();
  elements.tipsMsg.classList.remove('hidden');
  updateResultHeader();
  renderList();

  if (isMobile()) showMobilePanel('left');
  else {
    clearMobilePanels();
    renderTips();
  }
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
  return qty === null ? name : `${name} × ${qty}`;
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
    qty: ingredient.qty * craftTimes
  }));
}

function supplementGroupKey(entries = []) {
  return entries
    .map(entry => `${entry.name}:${entry.qty}`)
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
    summary.fixed.set(entry.name, (summary.fixed.get(entry.name) || 0) + entry.qty);
    return;
  }

  const key = supplementGroupKey(entries);
  if (!summary.choices.has(key)) {
    summary.choices.set(key, entries.map(cloneSupplementEntry));
    return;
  }

  const current = summary.choices.get(key);
  entries.forEach((entry, index) => {
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
        itemEl.appendChild(createTextElement('span', 'material-choice-qty', `× ${item.qty}`));
      }
      optionEl.appendChild(itemEl);
    });

    wrapper.appendChild(optionEl);
  });

  return wrapper;
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
        renderResultView();
      });
      toggle.appendChild(button);
    });

    row.appendChild(toggle);
    section.appendChild(row);
  });

  container.appendChild(section);
}

function collectMaterialRows(name, neededQty, pathKey = name) {
  const recipe = recipes[name];
  if (!recipe) return [{ type: 'item', name, qty: neededQty }];

  const craftTimes = Math.ceil(neededQty / recipe.yield);
  if (EXCHANGE_CRAFT_TYPES.has(recipe.craftType)) {
    return [{
      type: 'item',
      name,
      qty: neededQty,
      supplements: createExchangeSupplementEntries(recipe, craftTimes)
    }];
  }

  const rows = [];
  recipe.ingredients.forEach((ingredient, index) => {
    mergeMaterialRows(
      rows,
      collectMaterialRows(
        ingredient.name,
        ingredient.qty * craftTimes,
        childTreePath(pathKey, ingredient.name, index)
      )
    );
  });
  return rows;
}

function collectFavoriteMaterialsRows() {
  ensureFavoriteMaterialsRingCounts();
  const setCount = parseInt(elements.countInput.value, 10) || 1;
  const rows = [];

  getFavoriteListRecipeNames().forEach(name => {
    const multiplier = isRingRecipe(name) ? (favoriteMaterialsRingCounts[name] || 1) : 1;
    mergeMaterialRows(rows, collectMaterialRows(name, setCount * multiplier));
  });

  return rows;
}

function renderMaterialsList() {
  const rows = resultSourceMode === 'favorite-materials'
    ? collectFavoriteMaterialsRows()
    : collectMaterialRows(selectedRecipe, parseInt(elements.countInput.value, 10) || 1);
  const list = document.createElement('ul');
  list.className = 'materials-list';
  const exchangeSummary = createSupplementSummaryState();

  if (resultSourceMode === 'favorite-materials') {
    renderFavoriteRingControls(elements.treeContainer);
  }

  rows.forEach(row => {
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
        createTextElement('span', 'material-qty', `× ${row.qty}`)
      );
      content.appendChild(primary);

      if (row.supplements?.length) {
        const supplement = document.createElement('div');
        supplement.className = 'material-supplement';
        row.supplements.forEach((entry, index) => {
          if (index > 0) {
            supplement.appendChild(createTextElement('div', 'material-supplement-sep', 'もしくは'));
          }

          const entryRow = document.createElement('div');
          entryRow.className = 'material-supplement-row';
          entryRow.append(
            createTextElement('span', 'material-supplement-name', entry.name),
            createTextElement('span', 'material-supplement-qty', `× ${entry.qty}`)
          );
          supplement.appendChild(entryRow);
        });
        accumulateSupplementSummary(exchangeSummary, row.supplements);
        content.appendChild(supplement);
      }

      li.appendChild(content);
    } else {
      li.appendChild(createMaterialChoiceContent(row));
    }
    list.appendChild(li);
  });

  if (exchangeSummary.fixed.size > 0 || exchangeSummary.choices.size > 0) {
    const separator = document.createElement('li');
    separator.className = 'materials-summary-separator';
    list.appendChild(separator);

    [...exchangeSummary.fixed.entries()].forEach(([name, qty]) => {
      const li = document.createElement('li');
      li.className = 'materials-summary-row';
      const icon = createItemIcon(itemMaster[name]?.icon);
      if (icon) li.appendChild(icon);
      const content = document.createElement('div');
      content.className = 'material-content';
      const primary = document.createElement('div');
      primary.className = 'material-primary';
      primary.append(
        createTextElement('span', 'material-name', name),
        createTextElement('span', 'material-qty', `× ${qty}`)
      );
      content.appendChild(primary);
      li.appendChild(content);
      list.appendChild(li);
    });

    [...exchangeSummary.choices.values()].forEach(entries => {
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
        entryRow.append(
          createTextElement('span', 'material-name', entry.name),
          createTextElement('span', 'material-qty', `× ${entry.qty}`)
        );
        supplement.appendChild(entryRow);
      });

      content.appendChild(supplement);
      li.appendChild(content);
      list.appendChild(li);
    });
  }

  elements.treeContainer.appendChild(list);
}

function renderTree() {
  const count = parseInt(elements.countInput.value, 10) || 1;
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

function calcProduced(name, needed) {
  const r = recipes[name];
  if (!r) return needed;
  return r.yield * Math.ceil(needed / r.yield);
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

function createTreeMain(name, producedQty, subInfo) {
  const title = document.createElement('span');
  title.className = 'node-title';
  title.append(
    createTextElement('span', 'node-name', name),
    createTextElement('span', 'node-qty', `× ${producedQty}`)
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
  const craftTimes = recipe ? Math.ceil(neededQty / recipe.yield) : 0;

  if (unitCost !== null && unitTimes !== null) {
    rows.push(createTreeSubRow(`(@${unitCost} × `, unitTimes, ')'));
  }
  if (surplus > 0) {
    rows.push(createTreeSubRow('(↩', ` ${surplus} `, '個余り)'));
  }
  if (!isExchange && craftTimes >= 1) {
    rows.push(createTreeSubRow('(🔨', ` ${craftTimes} `, '回制作)'));
  }
  if (rows.length === 0) return null;

  const subInfo = document.createElement('span');
  subInfo.className = 'node-sub-info';
  subInfo.append(...rows);
  return subInfo;
}

function appendRecipeChildren(container, recipe, producedQty, depth, pathKey, showCraftBadgeOnlyAtRoot) {
  const isExchange = EXCHANGE_CRAFT_TYPES.has(recipe.craftType);
  const craftTimes = Math.ceil(producedQty / recipe.yield);

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
        showCraftBadgeOnlyAtRoot
      )
    );
  });
}

function buildNode(name, neededQty, producedQty, depth, pathKey, unitCost = null, unitTimes = null, showCraftBadgeOnlyAtRoot = false) {
  const master = itemMaster[name] || { method: '', icon: '', craftType: '' };
  const recipe = recipes[name];
  const hasChildren = Boolean(recipe);

  const node = document.createElement('div');
  node.className = 'tree-node';
  const row = document.createElement('div');
  row.className = 'node-row';
  const toggle = createTextElement('span', 'toggle', hasChildren ? '▼' : ' ');
  const hideCraftBadge = showCraftBadgeOnlyAtRoot && depth > 0 && CRAFT_JOBS_SET.has(master.method);

  row.append(toggle, createTreeBadge(master.method, hideCraftBadge));
  const icon = createItemIcon(master.icon, 'node-icon');
  if (icon) row.appendChild(icon);
  if (hasChildren) row.appendChild(createTreePin(name));
  row.appendChild(
    createTreeMain(
      name,
      producedQty,
      createTreeSubInfo(recipe, neededQty, producedQty, unitCost, unitTimes)
    )
  );
  node.appendChild(row);

  if (!hasChildren) return node;

  const children = document.createElement('div');
  children.className = 'node-children';
  appendRecipeChildren(children, recipe, producedQty, depth, pathKey, showCraftBadgeOnlyAtRoot);

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
  return { name: '', itemIds: names.map(recipeIdForName).filter(Boolean), needsName: true };
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
      itemIds: normalizeItemIds(payload.i).filter(id => recipeNameForId(id)),
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

function openLicenseNotice() {
  elements.licenseText.textContent = LICENSE_NOTICE_TEXT;
  elements.licenseOverlay.classList.add('open');
}

function closeLicenseNotice() {
  elements.licenseOverlay.classList.remove('open');
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
    setImportError('有効なレシピが見つかりませんでした');
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
  elements.countDecrease5Btn.addEventListener('click', () => changeCount(-5));
  elements.countDecreaseBtn.addEventListener('click', () => changeCount(-1));
  elements.countInput.addEventListener('input', renderResultView);
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
  elements.usesBtn.addEventListener('click', () => showUsesPanel(selectedRecipe));
  elements.updateReloadBtn.addEventListener('click', () => location.reload());
  elements.confirmYes.addEventListener('click', confirmPendingAction);
  elements.confirmNo.addEventListener('click', closeConfirm);
  elements.settingsOverlay.addEventListener('click', event => {
    if (event.target === elements.settingsOverlay) closeSettings();
  });
  elements.copyExportBtn.addEventListener('click', copyExportCode);
  elements.startImportBtn.addEventListener('click', startImport);
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
