import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractLodestoneCraftInfo,
  extractLodestoneEquipmentInfo,
  extractLodestoneRecipePaths,
  extractLodestoneShopInfo,
  isConditionalLodestoneShop,
  mergeHousingShopInfo,
  mergePublishItems,
  nextLodestoneSearchUrl,
  parseCsv,
  resolveLodestoneItemDetail
} from '../pipeline/tool/pipeline-tool.mjs';

test('parseCsv handles commas, escaped quotes, and newlines in quoted fields', () => {
  const rows = parseCsv('A,B,C\r\n1,"two, too","line1\r\nline2"\r\n2,"say ""hi""",3\r\n');
  assert.deepEqual(rows, [
    ['A', 'B', 'C'],
    ['1', 'two, too', 'line1\nline2'],
    ['2', 'say "hi"', '3']
  ]);
});

test('parseCsv keeps empty trailing fields', () => {
  const rows = parseCsv('A,B,C\n1,2,\n');
  assert.deepEqual(rows, [
    ['A', 'B', 'C'],
    ['1', '2', '']
  ]);
});

test('mergePublishItems keeps existing items that are absent from the candidate', () => {
  const baseItems = [
    { ID: 1, Name: '既存A', IconFile: 'a.webp', Recipe: { Ingredients: [{ ItemID: 2, Name: '素材', Amount: 1 }] } },
    { ID: 2, Name: '既存B', IconFile: 'b.webp' }
  ];
  const candidateItems = [
    { ID: 1, ShopInfo: { price: 9, shops: [{ shopName: '素材屋' }] } }
  ];
  assert.deepEqual(mergePublishItems(baseItems, candidateItems), [
    { ID: 1, Name: '既存A', IconFile: 'a.webp', Recipe: { Ingredients: [{ ItemID: 2, Name: '素材', Amount: 1 }] }, ShopInfo: { price: 9, shops: [{ shopName: '素材屋' }] } },
    { ID: 2, Name: '既存B', IconFile: 'b.webp' }
  ]);
});

test('mergeHousingShopInfo adds housing shops without coordinates', () => {
  const items = [
    { ID: 5111, Name: '鉄鉱', ShopInfo: { price: 18, shops: [{ shopName: '甲冑師 スムルウィブ', area: 'リムサ・ロミンサ：上甲板層', x: 10.6, y: 15.1 }] } }
  ];
  const result = mergeHousingShopInfo(items, {
    '鉄鉱': {
      price: 18,
      shops: [{ shopName: '素材屋', area: 'ハウジング雇用NPC' }]
    }
  });
  assert.deepEqual(result, { matched: 1, shopAdded: 1, unmatched: 0, priceMismatch: 0 });
  assert.deepEqual(items[0].ShopInfo.shops[1], { shopName: '素材屋', area: 'ハウジング雇用NPC' });
});

test('extractLodestoneShopInfo reads gil price once and shop rows without exposing URLs', () => {
  const html = `
    <div>SHOP販売価格: 9 Gil</div>
    <table><tbody>
      <tr>
        <td><a href="/lodestone/playguide/db/shop/f26a2e04283/?item=ba7b835e608&type=gil">素材屋 エンゲランド</a></td>
        <td>リムサ・ロミンサ：下甲板層 X:8.6 Y:11.8</td>
      </tr>
    </tbody></table>`;
  assert.deepEqual(extractLodestoneShopInfo(html), {
    price: 9,
    shops: [{
      shopId: 'f26a2e04283',
      shopName: '素材屋 エンゲランド',
      area: 'リムサ・ロミンサ：下甲板層',
      x: 8.6,
      y: 11.8
    }]
  });
});

test('nextLodestoneSearchUrl follows pager hrefs without inventing page queries', () => {
  const current = 'https://jp.finalfantasyxiv.com/lodestone/playguide/db/item/?q=%E3%83%80%E3%82%AC%E3%83%BC';
  const html = `
    <a class="pager__next" href="/lodestone/playguide/db/item/?q=%E3%83%80%E3%82%AC%E3%83%BC&page=actual-token">次</a>
    <a href="/lodestone/playguide/db/item/?q=%E3%83%80%E3%82%AC%E3%83%BC&page=3">3</a>`;
  assert.equal(
    nextLodestoneSearchUrl(html, current, new Set([current])),
    'https://jp.finalfantasyxiv.com/lodestone/playguide/db/item/?q=%E3%83%80%E3%82%AC%E3%83%BC&page=actual-token'
  );
});

test('nextLodestoneSearchUrl skips already visited pager hrefs', () => {
  const current = 'https://jp.finalfantasyxiv.com/lodestone/playguide/db/item/?q=x';
  const next = 'https://jp.finalfantasyxiv.com/lodestone/playguide/db/item/?q=x&page=2';
  const html = '<a class="pager__next" href="/lodestone/playguide/db/item/?q=x&page=2">次</a>';
  assert.equal(nextLodestoneSearchUrl(html, current, new Set([current, next])), '');
});

test('resolveLodestoneItemDetail walks search pages until exact match is found', async () => {
  const urls = [];
  const pages = new Map([
    ['https://jp.finalfantasyxiv.com/lodestone/playguide/db/item/?q=%E3%83%80%E3%82%AC%E3%83%BC', '<a class="pager__next" href="/lodestone/playguide/db/item/?q=%E3%83%80%E3%82%AC%E3%83%BC&p=second">次</a>'],
    ['https://jp.finalfantasyxiv.com/lodestone/playguide/db/item/?q=%E3%83%80%E3%82%AC%E3%83%BC&p=second', '<a class="pager__next" href="/lodestone/playguide/db/item/?q=%E3%83%80%E3%82%AC%E3%83%BC&p=third">次</a>'],
    ['https://jp.finalfantasyxiv.com/lodestone/playguide/db/item/?q=%E3%83%80%E3%82%AC%E3%83%BC&p=third', '<a class="db-table__txt--detail_link" href="/lodestone/playguide/db/item/abc123/">ダガー</a>'],
    ['https://jp.finalfantasyxiv.com/lodestone/playguide/db/item/abc123/', '<title>エオルゼアデータベース「ダガー」 | FINAL FANTASY XIV, The Lodestone</title>']
  ]);
  const result = await resolveLodestoneItemDetail({ Name: 'ダガー' }, 0, {
    fetchText: async url => {
      urls.push(url);
      if (!pages.has(url)) throw new Error(`unexpected url ${url}`);
      return pages.get(url);
    }
  });
  assert.equal(result.detailUrl, 'https://jp.finalfantasyxiv.com/lodestone/playguide/db/item/abc123/');
  assert.deepEqual(urls, [...pages.keys()]);
});

test('resolveLodestoneItemDetail errors after the last search page without exact match', async () => {
  const pages = new Map([
    ['https://jp.finalfantasyxiv.com/lodestone/playguide/db/item/?q=%E3%83%80%E3%82%AC%E3%83%BC', '<a class="pager__next" href="/lodestone/playguide/db/item/?q=%E3%83%80%E3%82%AC%E3%83%BC&p=second">次</a>'],
    ['https://jp.finalfantasyxiv.com/lodestone/playguide/db/item/?q=%E3%83%80%E3%82%AC%E3%83%BC&p=second', '<p>終端</p>']
  ]);
  await assert.rejects(
    () => resolveLodestoneItemDetail({ Name: 'ダガー' }, 0, {
      fetchText: async url => pages.get(url) || ''
    }),
    /2ページ確認/
  );
});

test('isConditionalLodestoneShop detects player-state dependent shops', () => {
  assert.equal(isConditionalLodestoneShop('<p>※このショップはプレイヤーの特定条件によって販売されるアイテムが異なります。</p>'), true);
  assert.equal(isConditionalLodestoneShop('<p>通常ショップ</p>'), false);
});

test('extractLodestoneCraftInfo reads job, level, and masterbook only', () => {
  const html = '<title>エオルゼアデータベース「インダガトル・クラフターコート」 | FINAL FANTASY XIV, The Lodestone</title><main>製作手帳 裁縫師 秘伝書 秘伝書:第10巻 インダガトル・クラフターコート <section>裁縫師 Lv 90 インダガトル・クラフターコート</section></main>';
  assert.deepEqual(extractLodestoneCraftInfo(html), {
    job: '裁縫師',
    level: 90,
    masterbook: '秘伝書:第10巻'
  });
});

test('extractLodestoneCraftInfo ignores masterbook menu entries', () => {
  const html = '<title>エオルゼアデータベース「ブロンズインゴット」 | FINAL FANTASY XIV, The Lodestone</title><main>鍛冶師 Lv 1 ブロンズインゴット 製作Lv 91-95 秘伝書 秘伝書:第12巻</main>';
  assert.deepEqual(extractLodestoneCraftInfo(html), {
    job: '鍛冶師',
    level: 1
  });
});

test('extractLodestoneEquipmentInfo reads item level, equip level, jobs, and primary stats', () => {
  const html = '<section>ITEM LEVEL 9 物理防御力 魔法防御力 0 0 ファイター ソーサラー Lv 9～ Bonuses STR +1 DEX +2 VIT +3 INT +4 MND +5 クリティカル +6</section>';
  assert.deepEqual(extractLodestoneEquipmentInfo(html), {
    itemLevel: 9,
    jobs: ['ファイター', 'ソーサラー'],
    equipLevel: 9,
    stats: {
      STR: 1,
      DEX: 2,
      VIT: 3,
      INT: 4,
      MND: 5
    }
  });
});

test('extractLodestoneEquipmentInfo records zero primary stats when none are present', () => {
  const html = '<section>ITEM LEVEL 1 ブロック性能 10 全クラス Lv 1～</section>';
  assert.deepEqual(extractLodestoneEquipmentInfo(html), {
    itemLevel: 1,
    jobs: ['全クラス'],
    equipLevel: 1,
    stats: {
      STR: 0,
      DEX: 0,
      VIT: 0,
      INT: 0,
      MND: 0
    }
  });
});

test('extractLodestoneEquipmentInfo does not absorb stats as job text', () => {
  const html = '<section>ITEM LEVEL 110 魔法防御力 1 ファイター ソーサラー Lv 50～ Bonuses STR +18 VIT +18 MND +13 ソーサラー Lv 50～</section>';
  assert.deepEqual(extractLodestoneEquipmentInfo(html), {
    itemLevel: 110,
    jobs: ['ファイター', 'ソーサラー'],
    equipLevel: 50,
    stats: {
      STR: 18,
      DEX: 0,
      VIT: 18,
      INT: 0,
      MND: 13
    }
  });
});

test('extractLodestoneEquipmentInfo ignores non-equipment pages', () => {
  assert.equal(extractLodestoneEquipmentInfo('<main>ITEM Lv の高い順 製作Lv 1-5</main>'), null);
  assert.equal(extractLodestoneEquipmentInfo('<main>ITEM LEVEL 5 食事効果 VIT +1 効果時間 30:00</main>'), null);
});

test('extractLodestoneRecipePaths is limited to the item recipe section', () => {
  const html = `
    <a href="/lodestone/playguide/db/recipe/menu00000000/">menu</a>
    このアイテムの製作手帳
    <a href="/lodestone/playguide/db/recipe/5e15b6d024b/">鍛冶師</a>
    <a href="/lodestone/playguide/db/recipe/5e15b6d024b/">鍛冶師</a>
    関連製作手帳
    <a href="/lodestone/playguide/db/recipe/unrelated000/">関連</a>`;
  assert.deepEqual(extractLodestoneRecipePaths(html), ['/lodestone/playguide/db/recipe/5e15b6d024b/']);
});
