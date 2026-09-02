(function initMaterialModel(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MaterialModel = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function createMaterialModel() {
  'use strict';

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

  function sortSupplementEntries(entries = [], compareNames = (left, right) => left.localeCompare(right, 'ja')) {
    return [...entries].sort((a, b) => compareNames(a.name, b.name));
  }

  function supplementGroupKey(entries = [], compareNames) {
    return sortSupplementEntries(entries, compareNames)
      .map(entry => `${entry.name}:${entry.qty}:${entry.refinable ? 1 : 0}`)
      .join('|');
  }

  function createSupplementSummaryState() {
    return {
      fixed: new Map(),
      choices: new Map()
    };
  }

  function accumulateSupplementSummary(summary, entries = [], compareNames) {
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
    const sortedEntries = sortSupplementEntries(entries, compareNames);
    const key = supplementGroupKey(sortedEntries, compareNames);
    if (!summary.choices.has(key)) {
      summary.choices.set(key, sortedEntries.map(cloneSupplementEntry));
      return;
    }
    const current = summary.choices.get(key);
    sortedEntries.forEach((entry, index) => {
      current[index].qty += entry.qty;
    });
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

  function createMaterialOrdering({
    crystalNames = new Set(),
    crystalKindOrder = [],
    crystalElementOrder = [],
    exchangeCraftTypes = new Set(),
    getItemMaster = () => ({}),
    getRecipeMap = () => ({}),
    getRecipeMaster = name => getItemMaster(name)
  } = {}) {
    const toNumeric = (value, fallback = 0) => {
      const number = Number(value);
      return Number.isFinite(number) ? number : fallback;
    };
    const itemSortKey = name => {
      const master = getItemMaster(name) || {};
      return {
        uiCategory: toNumeric(master.uiCategory),
        id: toNumeric(master.numericId || master.id),
        materialSortOrder: toNumeric(master.materialSortOrder, Number.MAX_SAFE_INTEGER)
      };
    };
    const compareItemNames = (leftName, rightName) => {
      const left = itemSortKey(leftName);
      const right = itemSortKey(rightName);
      return (
        left.uiCategory - right.uiCategory ||
        left.id - right.id ||
        leftName.localeCompare(rightName, 'ja')
      );
    };
    const compareMaterialChronology = (leftName, rightName) => {
      const left = itemSortKey(leftName);
      const right = itemSortKey(rightName);
      return (
        left.materialSortOrder - right.materialSortOrder ||
        left.id - right.id ||
        left.uiCategory - right.uiCategory ||
        leftName.localeCompare(rightName, 'ja')
      );
    };
    const getCrystalPart = (name, parts) =>
      parts.find(part => name.startsWith(part) || name.endsWith(part)) || '';
    const crystalKind = name =>
      crystalNames.has(name) ? getCrystalPart(name, crystalKindOrder) : '';
    const crystalElement = name =>
      crystalNames.has(name) ? getCrystalPart(name, crystalElementOrder) : '';
    const compareCrystalNames = (leftName, rightName) => {
      const kindDiff =
        crystalKindOrder.indexOf(crystalKind(leftName)) - crystalKindOrder.indexOf(crystalKind(rightName));
      if (kindDiff !== 0) return kindDiff;
      const elementDiff =
        crystalElementOrder.indexOf(crystalElement(leftName)) -
        crystalElementOrder.indexOf(crystalElement(rightName));
      return elementDiff || compareItemNames(leftName, rightName);
    };
    const intermediateRecipeSortKey = (name, recipeMap = getRecipeMap()) => {
      const master = getRecipeMaster(name, recipeMap[name]) || {};
      const masterbook = String(master.masterbook || '');
      const volumeMatch = masterbook.match(/第(\d+)巻/u);
      return {
        level: toNumeric(master.craftLevel),
        masterbookKind: masterbook ? (volumeMatch ? 1 : 2) : 0,
        masterbookVolume: volumeMatch ? toNumeric(volumeMatch[1]) : 0,
        masterbook
      };
    };
    const compareIntermediateRecipeOrder = (leftRow, rightRow, recipeMap = getRecipeMap()) => {
      const left = intermediateRecipeSortKey(leftRow.name, recipeMap);
      const right = intermediateRecipeSortKey(rightRow.name, recipeMap);
      const recipeKindDiff = left.masterbookKind - right.masterbookKind;
      const normalRecipeLevelDiff =
        left.masterbookKind === 0 && right.masterbookKind === 0 ? left.level - right.level : 0;
      return (
        recipeKindDiff ||
        normalRecipeLevelDiff ||
        left.masterbookVolume - right.masterbookVolume ||
        left.masterbook.localeCompare(right.masterbook, 'ja')
      );
    };
    const compareIntermediateRows = (leftRow, rightRow, recipeMap = getRecipeMap()) => {
      const leftRecipe = recipeMap[leftRow.name];
      const rightRecipe = recipeMap[rightRow.name];
      const left = itemSortKey(leftRow.name);
      const right = itemSortKey(rightRow.name);
      return (
        toNumeric(leftRecipe?.craftType) - toNumeric(rightRecipe?.craftType) ||
        compareIntermediateRecipeOrder(leftRow, rightRow, recipeMap) ||
        left.uiCategory - right.uiCategory ||
        left.id - right.id ||
        leftRow.name.localeCompare(rightRow.name, 'ja')
      );
    };
    const compareAvailableIntermediateRows = (
      leftRow,
      rightRow,
      previous,
      remainingCraftTypes,
      craftTypeDependencies,
      recipeMap = getRecipeMap()
    ) => {
      const previousRecipe = previous ? recipeMap[previous.name] : null;
      const leftRecipe = recipeMap[leftRow.name];
      const rightRecipe = recipeMap[rightRow.name];
      const previousCraftType = previous ? toNumeric(previousRecipe?.craftType) : null;
      const leftCraftType = toNumeric(leftRecipe?.craftType);
      const rightCraftType = toNumeric(rightRecipe?.craftType);
      const leftSameCraftType = previous && leftCraftType === previousCraftType ? 0 : 1;
      const rightSameCraftType = previous && rightCraftType === previousCraftType ? 0 : 1;
      if (leftSameCraftType !== rightSameCraftType) return leftSameCraftType - rightSameCraftType;

      if (previous && leftSameCraftType === 0) {
        const recipeOrder = compareIntermediateRecipeOrder(leftRow, rightRow, recipeMap);
        if (recipeOrder !== 0) return recipeOrder;
        const previousCategory = itemSortKey(previous.name).uiCategory;
        const leftSameCategory = itemSortKey(leftRow.name).uiCategory === previousCategory ? 0 : 1;
        const rightSameCategory = itemSortKey(rightRow.name).uiCategory === previousCategory ? 0 : 1;
        if (leftSameCategory !== rightSameCategory) return leftSameCategory - rightSameCategory;
      }

      const waitsForRemainingCraftType = craftType =>
        [...(craftTypeDependencies.get(craftType) || [])].some(
          requiredCraftType => (remainingCraftTypes.get(requiredCraftType) || 0) > 0
        );
      const leftBlocked = waitsForRemainingCraftType(leftCraftType) ? 1 : 0;
      const rightBlocked = waitsForRemainingCraftType(rightCraftType) ? 1 : 0;
      return leftBlocked - rightBlocked || compareIntermediateRows(leftRow, rightRow, recipeMap);
    };
    const sortConfiguredSupplementEntries = entries =>
      sortSupplementEntries(entries, compareItemNames);
    const compareSupplementEntryLists = (leftEntries = [], rightEntries = []) => {
      const left = sortConfiguredSupplementEntries(leftEntries);
      const right = sortConfiguredSupplementEntries(rightEntries);
      const length = Math.max(left.length, right.length);
      for (let index = 0; index < length; index += 1) {
        if (!left[index]) return -1;
        if (!right[index]) return 1;
        const result = compareItemNames(left[index].name, right[index].name);
        if (result !== 0) return result;
      }
      return 0;
    };
    const categorizeMaterialRows = rows => {
      const normal = [];
      const exchange = [];
      const crystals = [];
      rows.forEach(row => {
        if (row.type !== 'item') normal.push(row);
        else if (crystalKind(row.name)) crystals.push(row);
        else if (exchangeCraftTypes.has(getItemMaster(row.name)?.craftType)) exchange.push(row);
        else normal.push(row);
      });
      normal.sort((left, right) => {
        if (left.type === 'item' && right.type === 'item') {
          return compareMaterialChronology(left.name, right.name);
        }
        if (left.type === 'item') return -1;
        if (right.type === 'item') return 1;
        return 0;
      });
      exchange.sort(
        (left, right) =>
          compareSupplementEntryLists(left.supplements, right.supplements) ||
          compareItemNames(left.name, right.name)
      );
      crystals.sort((left, right) => compareCrystalNames(left.name, right.name));
      return { normal, exchange, crystals };
    };

    return Object.freeze({
      categorizeMaterialRows,
      compareAvailableIntermediateRows,
      compareIntermediateRows,
      compareItemNames,
      crystalKind,
      itemSortKey,
      sortSupplementEntries: sortConfiguredSupplementEntries
    });
  }

  return Object.freeze({
    accumulateSupplementSummary,
    childTreePath,
    createMaterialOrdering,
    createSupplementSummaryState,
    mergeMaterialItems,
    mergeMaterialRows,
    mergeSupplementEntries,
    sortSupplementEntries,
    supplementGroupKey
  });
});
