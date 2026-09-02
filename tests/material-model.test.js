const test = require('node:test');
const assert = require('node:assert/strict');
const {
  accumulateSupplementSummary,
  childTreePath,
  createMaterialOrdering,
  createSupplementSummaryState,
  mergeMaterialItems,
  mergeMaterialRows,
  mergeSupplementEntries,
  supplementGroupKey
} = require('../site/material-model.js');

function createOrderingFixture() {
  const masters = {
    通常B: { uiCategory: 1, id: 20, materialSortOrder: 1 },
    通常A: { uiCategory: 2, id: 10, materialSortOrder: 2 },
    交換A: { uiCategory: 5, id: 50, craftType: '8' },
    交換B: { uiCategory: 5, id: 51, craftType: '8' },
    ファイアシャード: { uiCategory: 9, id: 90 },
    アイスクリスタル: { uiCategory: 9, id: 91 }
  };
  const recipes = {
    通常A: { craftType: '0' },
    通常B: { craftType: '1' }
  };
  return createMaterialOrdering({
    crystalNames: new Set(['ファイアシャード', 'アイスクリスタル']),
    crystalKindOrder: ['シャード', 'クリスタル', 'クラスター'],
    crystalElementOrder: ['ファイア', 'アイス'],
    exchangeCraftTypes: new Set(['8']),
    getItemMaster: name => masters[name] || {},
    getRecipeMap: () => recipes,
    getRecipeMaster: name => ({
      craftLevel: name === '通常A' ? 10 : 20,
      masterbook: ''
    })
  });
}

test('material paths are stable and unambiguous for sibling indexes', () => {
  assert.equal(childTreePath('root', '素材', 2), 'root>2:素材');
});

test('supplement merging sums names without mutating either input', () => {
  const target = [{ name: 'A', qty: 1, refinable: false }];
  const incoming = [
    { name: 'A', qty: 2, refinable: false },
    { name: 'B', qty: 3, refinable: true }
  ];
  assert.deepEqual(mergeSupplementEntries(target, incoming), [
    { name: 'A', qty: 3, refinable: false },
    { name: 'B', qty: 3, refinable: true }
  ]);
  assert.equal(target[0].qty, 1);
  assert.equal(incoming[0].qty, 2);
});

test('supplement summaries combine fixed entries and order-independent choices', () => {
  const compareNames = (left, right) => left.localeCompare(right, 'ja');
  assert.equal(
    supplementGroupKey(
      [
        { name: 'B', qty: 2 },
        { name: 'A', qty: 1, refinable: true }
      ],
      compareNames
    ),
    'A:1:1|B:2:0'
  );
  const summary = createSupplementSummaryState();
  accumulateSupplementSummary(summary, [{ name: 'A', qty: 2, refinable: false }], compareNames);
  accumulateSupplementSummary(summary, [{ name: 'A', qty: 3, refinable: false }], compareNames);
  accumulateSupplementSummary(
    summary,
    [
      { name: 'B', qty: 2, refinable: false },
      { name: 'A', qty: 1, refinable: true }
    ],
    compareNames
  );
  accumulateSupplementSummary(
    summary,
    [
      { name: 'A', qty: 1, refinable: true },
      { name: 'B', qty: 2, refinable: false }
    ],
    compareNames
  );
  assert.equal(summary.fixed.get('A:0').qty, 5);
  assert.equal(summary.choices.size, 1);
  assert.deepEqual([...summary.choices.values()][0], [
    { name: 'A', qty: 2, refinable: true },
    { name: 'B', qty: 4, refinable: false }
  ]);
});

test('material row merging clones additions and preserves separate choice rows', () => {
  const target = [{ type: 'item', name: 'A', qty: 1, supplements: [{ name: 'X', qty: 1 }] }];
  const incoming = [
    { type: 'item', name: 'A', qty: 2, supplements: [{ name: 'X', qty: 2 }] },
    { type: 'item', name: 'B', qty: 3, supplements: [] },
    { type: 'choice', options: [[{ name: 'C', qty: 4 }]] }
  ];
  mergeMaterialRows(target, incoming);
  assert.deepEqual(target, [
    { type: 'item', name: 'A', qty: 3, supplements: [{ name: 'X', qty: 3 }] },
    { type: 'item', name: 'B', qty: 3, supplements: [] },
    { type: 'choice', options: [[{ name: 'C', qty: 4 }]] }
  ]);
  incoming[1].qty = 99;
  incoming[2].options[0][0].qty = 99;
  assert.equal(target[1].qty, 3);
  assert.equal(target[2].options[0][0].qty, 4);
});

test('material item merging sums numbered rows but keeps unknown quantities separate', () => {
  assert.deepEqual(
    mergeMaterialItems([
      { name: 'A', qty: 1 },
      { name: 'A', qty: 2 },
      { name: 'A', qty: null },
      { name: 'A', qty: null }
    ]),
    [
      { name: 'A', qty: 3 },
      { name: 'A', qty: null },
      { name: 'A', qty: null }
    ]
  );
});

test('material ordering applies chronology only to normal rows and preserves exchange and crystal rules', () => {
  const ordering = createOrderingFixture();
  const choice = { type: 'choice', options: [] };
  const result = ordering.categorizeMaterialRows([
    { type: 'item', name: 'アイスクリスタル', qty: 1 },
    { type: 'item', name: '交換B', qty: 1, supplements: [{ name: '通常B', qty: 1 }] },
    choice,
    { type: 'item', name: '通常B', qty: 1 },
    { type: 'item', name: 'ファイアシャード', qty: 1 },
    { type: 'item', name: '交換A', qty: 1, supplements: [{ name: '通常A', qty: 1 }] },
    { type: 'item', name: '通常A', qty: 1 }
  ]);

  assert.deepEqual(result.normal.map(row => row.name || row.type), ['通常B', '通常A', 'choice']);
  assert.deepEqual(result.exchange.map(row => row.name), ['交換B', '交換A']);
  assert.deepEqual(result.crystals.map(row => row.name), ['ファイアシャード', 'アイスクリスタル']);
});

test('intermediate ordering favors the previous craft type and respects blocked craft dependencies', () => {
  const ordering = createOrderingFixture();
  const rows = [{ name: '通常A' }, { name: '通常B' }];
  const recipes = {
    通常A: { craftType: '0' },
    通常B: { craftType: '1' }
  };

  assert.ok(ordering.compareAvailableIntermediateRows(
    rows[0],
    rows[1],
    { name: '通常A' },
    new Map(),
    new Map(),
    recipes
  ) < 0);

  assert.ok(ordering.compareAvailableIntermediateRows(
    rows[0],
    rows[1],
    null,
    new Map([[1, 1]]),
    new Map([[0, new Set([1])]]),
    recipes
  ) > 0);
});
