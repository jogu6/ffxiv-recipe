const DATA_FILE = './data/Item.json';
const TIPS_FILE = './data/tips.json';
const LS_FAV = 'ff14_favorites';
const LS_SEARCH_HISTORY = 'ff14_search_history';
const SEARCH_HISTORY_LIMIT = 30;
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
  recipeList: document.getElementById('recipeList'),
  usesBackBtn: document.getElementById('usesBackBtn'),
  usesTitle: document.getElementById('usesTitle'),
  usesList: document.getElementById('usesList'),
  backBtn: document.getElementById('backBtn'),
  countDecrease5Btn: document.getElementById('countDecrease5Btn'),
  countDecreaseBtn: document.getElementById('countDecreaseBtn'),
  countInput: document.getElementById('countInput'),
  countIncreaseBtn: document.getElementById('countIncreaseBtn'),
  countIncrease5Btn: document.getElementById('countIncrease5Btn'),
  resultTitle: document.getElementById('resultTitle'),
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
  importChoiceOverlay: document.getElementById('importChoiceOverlay'),
  importChoiceMsg: document.getElementById('importChoiceMsg'),
  importReplaceBtn: document.getElementById('importReplaceBtn'),
  importMergeBtn: document.getElementById('importMergeBtn'),
  importCancelBtn: document.getElementById('importCancelBtn')
};

// Application state and indexes
let itemMaster = {};
let recipes = {};
let recipeNames = [];
let selectedRecipe = null;
let favorites = new Set();
let searchHistory = [];
let tipsData = [];
let idToRecipeName = {};
let usedIn = {};
let ingredientNames = [];
let prevPanel = 'left';
let listMode = 'none';
let pendingImportNames = null;
let pendingConfirmAction = null;
let wasMobile = isMobile();

const treePinMap = new Map();

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

function loadFavorites() {
  const storedFavorites = readStoredJson(LS_FAV, []);
  favorites = new Set(Array.isArray(storedFavorites) ? storedFavorites : []);
}

function saveFavorites() {
  writeStoredJson(LS_FAV, [...favorites]);
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

function applyFavoriteChange(name, shouldAdd) {
  if (shouldAdd) favorites.add(name);
  else favorites.delete(name);
  saveFavorites();
  refreshPins(name);
  if (listMode === 'fav') renderList();
}

function pinOn(name) {
  applyFavoriteChange(name, true);
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
  const isOn = favorites.has(name);
  treePinMap.get(name)?.forEach(btn => {
    btn.textContent = isOn ? '📌' : '📍';
    btn.classList.toggle('inactive', !isOn);
    btn.title = isOn ? 'お気に入りから削除' : 'お気に入りに追加';
  });
}

function onSearch() {
  const q = elements.searchBox.value.trim();
  elements.searchClearBtn.classList.toggle('visible', q !== '');
  elements.favBtn.classList.remove('active');
  listMode = q === '' ? 'none' : 'search';
  renderList();
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
  listMode = 'fav';
  elements.favBtn.classList.add('active');
  renderList();
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
    case 'fav':
      return [...favorites].filter(n => recipes[n]);
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
  } else if (listMode === 'fav' && favorites.size === 0) {
    frag.appendChild(createEmptyListItem('お気に入りはありません'));
  } else if (names.length === 0) {
    frag.appendChild(createEmptyListItem('該当するレシピがありません'));
  } else {
    names.forEach(name => {
      if (listMode === 'fav') frag.appendChild(makeFavLi(name));
      else if (recipes[name]) frag.appendChild(makeRecipeLi(name));
      else frag.appendChild(makeIngredientLi(name));
    });
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
      elements.usesList.querySelectorAll('li').forEach(el => el.classList.remove('selected'));
      li.classList.add('selected');
      renderTree();
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
  elements.recipeList.querySelectorAll('li').forEach(el => el.classList.remove('selected'));
  li.classList.add('selected');
  renderTree();
  if (isMobile()) {
    prevPanel = 'left';
    showMobilePanel('right');
    elements.treeContainer.scrollTop = 0;
  }
}

function selectRecipeByName(name) {
  selectedRecipe = name;
  renderList();
  renderTree();
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
        id: item.ID
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
      itemMaster[name] = { method: '', icon: iconPath(item), craftType: '', id: item.ID };
    }
  });

  rawList.forEach(item => {
    item.Recipe?.Ingredients?.forEach(ingredient => {
      if (itemMaster[ingredient.Name]) return;
      itemMaster[ingredient.Name] = {
        method: '',
        icon: iconPath(idToItem[ingredient.ItemID]),
        craftType: ''
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
  renderTree();
}

function clearRenderedTree() {
  Array.from(elements.treeContainer.children).forEach(child => {
    if (child !== elements.tipsMsg) child.remove();
  });
}

function resetToStartupView() {
  selectedRecipe = null;
  prevPanel = 'left';
  listMode = 'none';
  treePinMap.clear();

  elements.searchBox.value = '';
  elements.searchClearBtn.classList.remove('visible');
  elements.favBtn.classList.remove('active');
  closeSearchHistory();
  closeUsesPanel();

  elements.usesTitle.textContent = '';
  elements.usesList.replaceChildren();
  elements.resultTitle.textContent = '';
  elements.usesBtn.classList.remove('visible');
  elements.countInput.value = '1';

  clearRenderedTree();
  elements.tipsMsg.classList.remove('hidden');
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

function renderTree() {
  const count = parseInt(elements.countInput.value, 10) || 1;
  clearRenderedTree();

  if (!selectedRecipe) {
    elements.tipsMsg.classList.remove('hidden');
    return;
  }

  elements.tipsMsg.classList.add('hidden');
  elements.resultTitle.textContent = `【${selectedRecipe} × ${count}個分】`;
  const usesCount = usedIn[selectedRecipe]?.length || 0;
  elements.usesBtn.textContent = `使用先 (${usesCount})`;
  elements.usesBtn.classList.toggle('visible', usesCount > 0);
  treePinMap.clear();

  const producedQty = calcProduced(selectedRecipe, count);
  elements.treeContainer.appendChild(
    buildNode(
      selectedRecipe,
      count,
      producedQty,
      0,
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
  const isFavorite = favorites.has(name);
  pin.className = 'pin-btn';
  pin.classList.toggle('inactive', !isFavorite);
  pin.textContent = isFavorite ? '📌' : '📍';
  pin.title = isFavorite ? 'お気に入りから削除' : 'お気に入りに追加';
  pin.addEventListener('click', event => {
    event.stopPropagation();
    favorites.has(name) ? pinOff(name) : pinOn(name);
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

function appendRecipeChildren(container, recipe, producedQty, depth, showCraftBadgeOnlyAtRoot) {
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
        isExchange ? ingredient.qty : null,
        isExchange ? craftTimes : null,
        showCraftBadgeOnlyAtRoot
      )
    );
  });
}

function buildNode(name, neededQty, producedQty, depth, unitCost = null, unitTimes = null, showCraftBadgeOnlyAtRoot = false) {
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
  appendRecipeChildren(children, recipe, producedQty, depth, showCraftBadgeOnlyAtRoot);

  if (recipe.craftType === '9') {
    children.classList.add('collapsed');
    toggle.textContent = '▶';
  }

  row.addEventListener('click', () => {
    const collapsed = children.classList.toggle('collapsed');
    toggle.textContent = collapsed ? '▶' : '▼';
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

function encodeFavorites() {
  const ids = [...favorites]
    .filter(n => recipes[n] && itemMaster[n]?.id)
    .map(n => parseInt(itemMaster[n].id, 10))
    .filter(n => !Number.isNaN(n))
    .sort((a, b) => a - b);
  return ids.map(id => id.toString(36).toUpperCase().padStart(4, '0')).join('');
}

// Settings and favorite sharing
function decodeFavorites(str) {
  if (!str || !/^[A-Z0-9]+$/.test(str) || str.length % 4 !== 0) return null;
  const names = [];
  for (let i = 0; i < str.length; i += 4) {
    const name = idToRecipeName[parseInt(str.slice(i, i + 4), 36)];
    if (name) names.push(name);
  }
  return names;
}

function openSettings() {
  elements.exportCode.value = encodeFavorites();
  elements.importCode.value = '';
  setImportError();
  elements.settingsOverlay.classList.add('open');
}

function closeSettings() {
  elements.settingsOverlay.classList.remove('open');
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

function setImportError(message = '') {
  elements.importErr.textContent = message;
  elements.importErr.classList.toggle('visible', Boolean(message));
}

function startImport() {
  const code = elements.importCode.value.trim().toUpperCase();
  const names = decodeFavorites(code);
  if (!names) {
    setImportError('無効なコードです');
    return;
  }
  if (names.length === 0) {
    setImportError('有効なレシピが見つかりませんでした');
    return;
  }
  setImportError();
  pendingImportNames = names;
  elements.importChoiceMsg.textContent = `${names.length}件のお気に入りを取り込みます`;
  elements.importChoiceOverlay.classList.add('open');
}

function closeImportChoice() {
  elements.importChoiceOverlay.classList.remove('open');
}

function importMerge() {
  if (!pendingImportNames) return;
  pendingImportNames.forEach(n => favorites.add(n));
  saveFavorites();
  pendingImportNames = null;
  closeImportChoice();
  closeSettings();
  if (listMode === 'fav') renderList();
}

function importReplace() {
  if (!pendingImportNames) return;
  closeImportChoice();
  showConfirm('お気に入りを全て削除してから\n取り込みますか？', () => {
    favorites.clear();
    pendingImportNames.forEach(n => favorites.add(n));
    saveFavorites();
    pendingImportNames = null;
    closeSettings();
    if (listMode === 'fav') renderList();
  });
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
  elements.countInput.addEventListener('input', renderTree);
  elements.countIncreaseBtn.addEventListener('click', () => changeCount(1));
  elements.countIncrease5Btn.addEventListener('click', () => changeCount(5));
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
  elements.importReplaceBtn.addEventListener('click', importReplace);
  elements.importMergeBtn.addEventListener('click', importMerge);
  elements.importCancelBtn.addEventListener('click', closeImportChoice);

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
