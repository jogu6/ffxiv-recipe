const test = require('node:test');
const assert = require('node:assert/strict');
const { createEquipmentSearchModel } = require('../site/equipment-search-model.js');

function fixture() {
  const masters = {};
  const groups = {
    ファイター: new Set(['ナイト']),
    ソーサラー: new Set(['巴術士', '白魔道士']),
    クラフター: new Set(['木工師']),
    ギャザラー: new Set(['採掘師'])
  };
  const model = createEquipmentSearchModel({
    jobOptions: ['ナイト', '巴術士', '白魔道士', '木工師', '採掘師'],
    slotOrder: ['weapon', 'shield', 'body'],
    categoryToSlot: { 片手斧: 'weapon', 盾: 'shield', 胴防具: 'body' },
    jobGroups: groups,
    roleJobs: {
      tank: new Set(['ナイト']), caster: new Set(['巴術士']),
      healer: new Set(['白魔道士']), sorcerer: groups.ソーサラー
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
