const assert = require('node:assert/strict');
const test = require('node:test');

const MacroConsumableCache = require('../site/macro-consumable-cache.js');

test('食事・薬品リストの保存キーはItem.jsonの版とデータ世代で決まる', () => {
  assert.equal(
    MacroConsumableCache.generationKey({ Version: '7.55', DataGeneration: 'lodestone-a' }),
    '7.55:lodestone-a'
  );
  assert.notEqual(
    MacroConsumableCache.generationKey({ Version: '7.55', DataGeneration: 'lodestone-a' }),
    MacroConsumableCache.generationKey({ Version: '7.55', DataGeneration: 'lodestone-b' })
  );
  assert.equal(MacroConsumableCache.generationKey({ Version: '7.55' }), '');
});

test('IndexedDBを利用できない場合だけ保存せず再生成へ戻す', async () => {
  const document = { Version: '7.55', DataGeneration: 'lodestone-a' };
  assert.equal(await MacroConsumableCache.load(document, null), null);
  assert.equal(await MacroConsumableCache.save(document, { foods: [], medicines: [] }, null), false);
});

test('食事・薬品以外を保存対象として受け付けない', async () => {
  const shouldNotOpen = { open: () => assert.fail('IndexedDBを開いてはいけません') };
  const document = { Version: '7.55', DataGeneration: 'lodestone-a' };
  assert.equal(await MacroConsumableCache.save(document, { recipes: [] }, shouldNotOpen), false);
});
