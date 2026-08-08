const test = require('node:test');
const assert = require('node:assert/strict');
const { createEquipmentSearchModel } = require('../site/equipment-search-model.js');

function fixture() {
  const masters = {};
  const groups = {
    ファイター: new Set(['ナイト', 'モンク', '忍者']),
    ソーサラー: new Set(['巴術士', '白魔道士', '黒魔道士']),
    クラフター: new Set(['木工師']),
    ギャザラー: new Set(['採掘師'])
  };
  const model = createEquipmentSearchModel({
    jobOptions: ['ナイト', 'モンク', '忍者', '巴術士', '白魔道士', '黒魔道士', '木工師', '採掘師'],
    slotOrder: ['weapon', 'shield', 'head', 'body', 'hands', 'legs', 'feet', 'neck', 'ring'],
    categoryToSlot: {
      片手斧: 'weapon', 盾: 'shield', 頭防具: 'head', 胴防具: 'body',
      手防具: 'hands', 脚防具: 'legs', 足防具: 'feet', 首飾り: 'neck', 指輪: 'ring'
    },
    jobGroups: groups,
    roleJobs: {
      tank: new Set(['ナイト']),
      striker_slayer: new Set(['モンク']),
      scout_ranger: new Set(['忍者']),
      caster: new Set(['巴術士', '黒魔道士']),
      healer: new Set(['白魔道士']),
      fighter: groups.ファイター,
      sorcerer: groups.ソーサラー
    },
    casterShieldJobs: new Set(['白魔道士']),
    oneHandedCasterWeaponCategories: new Set(['片手幻具']),
    crafterStats: ['CP'],
    gathererStats: ['GP'],
    getItemMaster: name => masters[name]
  });
  return { masters, model };
}

function equipment(category, jobs, equipLevel, itemLevel, extra = {}) {
  return {
    uiCategoryName: category,
    equipmentInfo: { jobs, equipLevel, itemLevel, stats: {}, performance: {}, ...extra }
  };
}

test('equipment slots follow the fixed category master including one-handed axes and tools', () => {
  const { model } = fixture();
  assert.equal(model.equipmentSlotForItem(equipment('片手斧', ['ナイト'], 1, 1)), 'weapon');
  assert.equal(model.equipmentSlotForItem(equipment('木工道具(主道具)', ['木工師'], 1, 1)), 'mainTool');
});

test('broad job matching uses role and crafter stats without mixing arcanist healer gear', () => {
  const { model } = fixture();
  assert.equal(model.equipmentMatchesJob(equipment('胴防具', ['ソーサラー'], 1, 1, {
    recommendedRole: 'sorcerer', stats: { INT: 10, MND: 20 }
  }), '巴術士'), false);
  assert.equal(model.equipmentMatchesJob(
    equipment('胴防具', ['全クラス'], 1, 1, { stats: { CP: 5 } }), '木工師'
  ), true);
  assert.equal(model.equipmentMatchesJob(
    equipment('胴防具', ['全クラス'], 1, 1, { stats: { GP: 0 } }), '採掘師'
  ), false);
});

test('battle jobs use their primary stat and only share equal STR/DEX physical gear across roles', () => {
  const { model } = fixture();
  const sharedRanger = equipment('胴防具', ['ファイター'], 43, 43, {
    recommendedRole: 'scout_ranger', stats: { STR: 5, DEX: 5 }
  });
  const dexRanger = equipment('胴防具', ['ファイター'], 43, 43, {
    recommendedRole: 'scout_ranger', stats: { DEX: 6 }
  });
  const tankAccessory = equipment('胴防具', ['全クラス'], 43, 43, {
    recommendedRole: 'tank', stats: { STR: 5 }
  });
  const genericStrength = equipment('胴防具', ['全クラス'], 43, 43, {
    recommendedRole: 'fighter', stats: { STR: 5 }
  });

  assert.equal(model.equipmentPrimaryStatForJob('モンク'), 'STR');
  assert.equal(model.equipmentPrimaryStatForJob('忍者'), 'DEX');
  assert.equal(model.equipmentPrimaryStatForJob('白魔道士'), 'MND');
  assert.equal(model.equipmentPrimaryStatForJob('黒魔道士'), 'INT');
  assert.equal(model.equipmentMatchesJob(sharedRanger, 'モンク'), true);
  assert.equal(model.equipmentMatchesJob(dexRanger, 'モンク'), false);
  assert.equal(model.equipmentMatchesJob(tankAccessory, 'モンク'), false);
  assert.equal(model.equipmentMatchesJob(genericStrength, 'モンク'), true);
  assert.equal(model.equipmentMatchesJob(genericStrength, '忍者'), false);
});

test('equipment selection falls back per slot and chooses the strongest specialty candidate', () => {
  const { masters, model } = fixture();
  masters['高IL胴'] = equipment('胴防具', ['ナイト'], 90, 700, {
    stats: { 不屈: 0 }, performance: { physicalDefense: 100 }
  });
  masters['低IL胴'] = equipment('胴防具', ['ナイト'], 80, 690, {
    stats: { 不屈: 0 }, performance: { physicalDefense: 90 }
  });
  masters['片手斧A'] = equipment('片手斧', ['ナイト'], 80, 690, {
    stats: { 不屈: 10 }, performance: { physicalDamage: 100 }
  });
  masters['片手斧B'] = equipment('片手斧', ['ナイト'], 80, 690, {
    stats: { 不屈: 20 }, performance: { physicalDamage: 100 }
  });
  const { index } = model.buildEquipmentSearchIndex(masters);
  const result = model.selectEquipmentResults({
    index, job: 'ナイト', requestedLevel: 85, requestedItemLevel: 700, selectedSlot: 'all'
  });
  assert.deepEqual(result.results, ['片手斧B', '低IL胴']);
});

test('level 45 monk selection includes shared-role ties and ranks by level, IL, and STR', () => {
  const { masters, model } = fixture();
  Object.assign(masters, {
    ボアフィンガレスグローブ: equipment('手防具', ['ファイター'], 35, 35, {
      recommendedRole: 'fighter', stats: { STR: 4, DEX: 4 }, performance: { physicalDefense: 67 }
    }),
    ラプトルフィンガレスグローブ: equipment('手防具', ['ファイター'], 45, 45, {
      stats: { STR: 6, DEX: 6 }, performance: { physicalDefense: 93 }
    }),
    'オルタード・ウールハット': equipment('頭防具', ['ファイター'], 43, 43, {
      recommendedRole: 'fighter', stats: { STR: 5, DEX: 5 }, performance: { physicalDefense: 86 }
    }),
    レンジャーハット: equipment('頭防具', ['ファイター'], 43, 43, {
      recommendedRole: 'scout_ranger', stats: { STR: 5, DEX: 5 }, performance: { physicalDefense: 86 }
    }),
    シルバートライコーン: equipment('頭防具', ['ファイター'], 43, 46, {
      stats: { STR: 6, DEX: 6 }, performance: { physicalDefense: 95 }
    }),
    ウールチュニック: equipment('胴防具', ['ファイター'], 43, 43, {
      recommendedRole: 'fighter', stats: { STR: 9, DEX: 9 }, performance: { physicalDefense: 115 }
    }),
    レンジャーチュニック: equipment('胴防具', ['ファイター'], 43, 43, {
      recommendedRole: 'scout_ranger', stats: { STR: 9, DEX: 9 }, performance: { physicalDefense: 115 }
    }),
    ウールケクス: equipment('脚防具', ['ファイター'], 43, 43, {
      recommendedRole: 'fighter', stats: { STR: 9, DEX: 9 }, performance: { physicalDefense: 115 }
    }),
    ウールトラウザー: equipment('脚防具', ['ファイター'], 44, 44, {
      stats: { STR: 10, DEX: 10 }, performance: { physicalDefense: 120 }
    }),
    'オルタード・ウールトラウザー': equipment('脚防具', ['ファイター'], 44, 44, {
      stats: { STR: 10, DEX: 10 }, performance: { physicalDefense: 120 }
    }),
    ボアモカシン: equipment('足防具', ['ファイター'], 43, 43, {
      stats: { STR: 5, DEX: 5 }, performance: { physicalDefense: 86 }
    }),
    ガーネットチョーカー: equipment('首飾り', ['全クラス'], 38, 38, {
      recommendedRole: 'fighter', stats: { STR: 4 }
    }),
    アメジストチョーカー: equipment('首飾り', ['全クラス'], 38, 38, {
      recommendedRole: 'fighter', stats: { DEX: 4 }
    }),
    ヘリオドールチョーカー: equipment('首飾り', ['全クラス'], 38, 38, {
      recommendedRole: 'tank', stats: { STR: 4, 不屈: 5 }
    }),
    ガーネットリング: equipment('指輪', ['全クラス'], 39, 39, {
      recommendedRole: 'fighter', stats: { STR: 4 }
    }),
    アメジストリング: equipment('指輪', ['全クラス'], 39, 39, {
      recommendedRole: 'fighter', stats: { DEX: 4 }
    })
  });
  const { index } = model.buildEquipmentSearchIndex(masters);
  const result = model.selectEquipmentResults({
    index, job: 'モンク', requestedLevel: 45, requestedItemLevel: 48, selectedSlot: 'all'
  });

  assert.deepEqual(result.results, [
    'オルタード・ウールハット', 'レンジャーハット',
    'ウールチュニック', 'レンジャーチュニック',
    'ラプトルフィンガレスグローブ',
    'ウールトラウザー', 'オルタード・ウールトラウザー',
    'ボアモカシン', 'ガーネットチョーカー', 'ガーネットリング'
  ]);
  assert.deepEqual([...result.parameterDisplayNames].sort(), [
    'ウールチュニック', 'レンジャーチュニック',
    'ウールトラウザー', 'オルタード・ウールトラウザー',
    'オルタード・ウールハット', 'レンジャーハット'
  ].sort());
});
