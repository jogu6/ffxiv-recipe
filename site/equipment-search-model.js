(function initEquipmentSearchModel(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EquipmentSearchModel = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function createEquipmentSearchModule() {
  'use strict';

  function createEquipmentSearchModel(config) {
    const {
      jobOptions, slotOrder, categoryToSlot, jobGroups, roleJobs, casterShieldJobs,
      oneHandedCasterWeaponCategories, crafterStats, gathererStats, getItemMaster
    } = config;
    const toNumeric = (value, fallback = 0) => {
      const number = Number(value);
      return Number.isFinite(number) ? number : fallback;
    };
    const equipmentSlotForItem = master => {
      const category = master?.uiCategoryName || '';
      if (categoryToSlot[category]) return categoryToSlot[category];
      if (category.endsWith('道具(主道具)')) return 'mainTool';
      if (category.endsWith('道具(副道具)')) return 'offTool';
      return '';
    };
    const isEquipmentSearchTarget = master => Boolean(master?.equipmentInfo && equipmentSlotForItem(master));
    const equipmentItemLevel = master => toNumeric(master?.equipmentInfo?.itemLevel, 0);
    const equipmentEquipLevel = master => toNumeric(master?.equipmentInfo?.equipLevel, 0);
    const equipmentJobs = master => Array.isArray(master?.equipmentInfo?.jobs) ? master.equipmentInfo.jobs : [];
    const equipmentHasPositiveStat = (master, statNames) => {
      const stats = master?.equipmentInfo?.stats || {};
      return statNames.some(name => toNumeric(stats[name]) > 0);
    };
    const equipmentPrimaryStatForJob = job => {
      if (roleJobs.healer?.has(job)) return 'MND';
      if (roleJobs.caster?.has(job)) return 'INT';
      if (roleJobs.scout_ranger?.has(job)) return 'DEX';
      if (roleJobs.tank?.has(job) || roleJobs.striker_slayer?.has(job)) return 'STR';
      return '';
    };
    const equipmentPrimaryStatScore = (master, job) => {
      const primaryStat = equipmentPrimaryStatForJob(job);
      return primaryStat ? toNumeric(master?.equipmentInfo?.stats?.[primaryStat]) : 0;
    };
    const broadBattleJobMatches = (master, job, jobs) => {
      const broadGroupMatches =
        jobs.includes('全クラス') ||
        (jobs.includes('ファイター') && jobGroups.ファイター.has(job)) ||
        (jobs.includes('ソーサラー') && jobGroups.ソーサラー.has(job));
      if (!broadGroupMatches || equipmentPrimaryStatScore(master, job) <= 0) return false;

      const recommendedRole = master?.equipmentInfo?.recommendedRole || '';
      if (!recommendedRole || recommendedRole === 'fighter') return jobGroups.ファイター.has(job);
      if (recommendedRole === 'sorcerer') {
        const stats = master?.equipmentInfo?.stats || {};
        const intValue = toNumeric(stats.INT);
        const mindValue = toNumeric(stats.MND);
        if (roleJobs.caster?.has(job)) return intValue >= mindValue;
        if (roleJobs.healer?.has(job)) return mindValue >= intValue;
        return false;
      }
      if (roleJobs[recommendedRole]?.has(job)) return true;

      const crossesPhysicalRoles =
        (recommendedRole === 'scout_ranger' && roleJobs.striker_slayer?.has(job)) ||
        (recommendedRole === 'striker_slayer' && roleJobs.scout_ranger?.has(job));
      if (!crossesPhysicalRoles) return false;
      const stats = master?.equipmentInfo?.stats || {};
      return toNumeric(stats.STR) > 0 && toNumeric(stats.STR) === toNumeric(stats.DEX);
    };
    const equipmentRoleMatchScore = (master, job) => {
      if (!equipmentPrimaryStatForJob(job)) return 0;
      const jobs = equipmentJobs(master);
      if (jobs.includes(job)) return 4;
      const recommendedRole = master?.equipmentInfo?.recommendedRole || '';
      if (!recommendedRole) return 1;
      if (recommendedRole === 'fighter' || recommendedRole === 'sorcerer') return 2;
      if (roleJobs[recommendedRole]?.has(job)) return 3;
      const crossesPhysicalRoles =
        (recommendedRole === 'scout_ranger' && roleJobs.striker_slayer?.has(job)) ||
        (recommendedRole === 'striker_slayer' && roleJobs.scout_ranger?.has(job));
      if (crossesPhysicalRoles) return 2;
      return 0;
    };
    const equipmentMatchesJob = (master, job) => {
      const jobs = equipmentJobs(master);
      if (job === '巴術士' && jobs.includes(job)) {
        const stats = master?.equipmentInfo?.stats || {};
        if (toNumeric(stats.INT) < toNumeric(stats.MND)) return false;
      }
      if (jobs.includes(job)) return true;
      if (jobs.includes('クラフター') && jobGroups.クラフター.has(job)) return true;
      if (jobs.includes('ギャザラー') && jobGroups.ギャザラー.has(job)) return true;
      if (jobs.includes('全クラス')) {
        if (jobGroups.クラフター.has(job) && equipmentHasPositiveStat(master, crafterStats)) return true;
        if (jobGroups.ギャザラー.has(job) && equipmentHasPositiveStat(master, gathererStats)) return true;
      }
      if (!jobs.some(group => ['全クラス', 'ファイター', 'ソーサラー'].includes(group))) return false;
      return broadBattleJobMatches(master, job, jobs);
    };
    const sortEquipmentNames = names => [...names].sort((leftName, rightName) => {
      const key = name => {
        const master = getItemMaster(name) || {};
        return [
          slotOrder.indexOf(equipmentSlotForItem(master)),
          -equipmentEquipLevel(master),
          -equipmentItemLevel(master),
          name
        ];
      };
      const left = key(leftName);
      const right = key(rightName);
      for (let index = 0; index < left.length; index += 1) {
        if (left[index] < right[index]) return -1;
        if (left[index] > right[index]) return 1;
      }
      return 0;
    });
    const buildEquipmentSearchIndex = itemMaster => {
      const index = new Map(jobOptions.map(job => [job, { levels: new Map(), specialSlots: new Set() }]));
      let maxEquipmentLevel = 1;
      Object.entries(itemMaster).forEach(([name, master]) => {
        if (!isEquipmentSearchTarget(master)) return;
        const equipLevel = equipmentEquipLevel(master);
        const itemLevel = equipmentItemLevel(master);
        const slot = equipmentSlotForItem(master);
        if (equipLevel <= 0 || itemLevel <= 0) return;
        maxEquipmentLevel = Math.max(maxEquipmentLevel, equipLevel);
        jobOptions.forEach(job => {
          if (!equipmentMatchesJob(master, job)) return;
          const jobIndex = index.get(job);
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
      return { index, maxEquipmentLevel };
    };
    const equipmentLevelsForJob = (index, job) =>
      [...(index.get(job)?.levels.keys() || [])].sort((left, right) => right - left);
    const findEquipmentMatchesAtLevel = (index, level, itemLevel, job, slot) => {
      const slotIndex = index.get(job)?.levels.get(level)?.slots.get(slot);
      if (!slotIndex) return [];
      if (!itemLevel) return [...slotIndex.values()].flat();
      return [...slotIndex.entries()]
        .filter(([candidate]) => candidate <= itemLevel)
        .flatMap(([, names]) => names);
    };
    const equipmentPerformanceScore = (master, slot) => {
      const performance = master?.equipmentInfo?.performance || {};
      return slot === 'weapon'
        ? Math.max(toNumeric(performance.physicalDamage), toNumeric(performance.magicalDamage))
        : toNumeric(performance.physicalDefense);
    };
    const equipmentSpecialtyScore = master => {
      const stats = master?.equipmentInfo?.stats || {};
      return Math.max(toNumeric(stats['不屈']), toNumeric(stats['信仰']));
    };
    const equipmentParameterComparisonKey = name => {
      const master = getItemMaster(name);
      if (!isEquipmentSearchTarget(master)) return '';
      const slot = equipmentSlotForItem(master);
      return [
        slot, equipmentEquipLevel(master), equipmentItemLevel(master),
        equipmentPerformanceScore(master, slot), equipmentSpecialtyScore(master)
      ].join(':');
    };
    const selectEquipmentResults = ({ index, job, requestedLevel, requestedItemLevel, selectedSlot }) => {
      const slots = selectedSlot === 'all' ? slotOrder : [selectedSlot];
      const results = [];
      const parameterDisplayNames = new Set();
      let selectedWeapons = [];
      slots.forEach(slot => {
        if (
          slot === 'shield' && selectedSlot === 'all' && casterShieldJobs.has(job) &&
          selectedWeapons.length > 0 &&
          !selectedWeapons.some(name => oneHandedCasterWeaponCategories.has(getItemMaster(name)?.uiCategoryName))
        ) return;
        for (let level = requestedLevel; level >= 1; level -= 1) {
          const matches = findEquipmentMatchesAtLevel(index, level, requestedItemLevel, job, slot);
          if (matches.length === 0) continue;
          const maxRoleMatch = Math.max(...matches.map(name => equipmentRoleMatchScore(getItemMaster(name), job)));
          const roleMatches = matches.filter(
            name => equipmentRoleMatchScore(getItemMaster(name), job) === maxRoleMatch
          );
          const maxItemLevel = Math.max(...roleMatches.map(name => equipmentItemLevel(getItemMaster(name))));
          const itemLevelMatches = roleMatches.filter(name => equipmentItemLevel(getItemMaster(name)) === maxItemLevel);
          const maxPerformance = Math.max(
            ...itemLevelMatches.map(name => equipmentPerformanceScore(getItemMaster(name), slot))
          );
          const performanceMatches = itemLevelMatches.filter(
            name => equipmentPerformanceScore(getItemMaster(name), slot) === maxPerformance
          );
          const maxPrimaryStat = Math.max(
            ...performanceMatches.map(name => equipmentPrimaryStatScore(getItemMaster(name), job))
          );
          const primaryStatMatches = maxPrimaryStat > 0
            ? performanceMatches.filter(name => equipmentPrimaryStatScore(getItemMaster(name), job) === maxPrimaryStat)
            : performanceMatches;
          const maxSpecialty = Math.max(
            ...primaryStatMatches.map(name => equipmentSpecialtyScore(getItemMaster(name)))
          );
          const selected = maxSpecialty > 0
            ? primaryStatMatches.filter(name => equipmentSpecialtyScore(getItemMaster(name)) === maxSpecialty)
            : primaryStatMatches;
          results.push(...selected);
          if (slot === 'weapon') selectedWeapons = selected;
          if (selected.length > 1) selected.forEach(name => parameterDisplayNames.add(name));
          break;
        }
      });
      return { parameterDisplayNames, results: sortEquipmentNames([...new Set(results)]) };
    };

    return Object.freeze({
      buildEquipmentSearchIndex, equipmentEquipLevel, equipmentItemLevel, equipmentJobs, equipmentLevelsForJob,
      equipmentMatchesJob, equipmentParameterComparisonKey, equipmentPrimaryStatForJob, equipmentRoleMatchScore,
      equipmentSlotForItem,
      isEquipmentSearchTarget, selectEquipmentResults, sortEquipmentNames
    });
  }

  return Object.freeze({ createEquipmentSearchModel });
});
