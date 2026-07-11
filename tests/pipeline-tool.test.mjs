import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractLodestoneCraftInfo,
  extractLodestoneEquipmentInfo,
  extractLodestoneRecipePaths,
  extractLodestoneShopInfo,
  applyEquipmentRoleOverrides,
  equipmentRoleDecision,
  findUnresolvedEquipmentRoleGroups,
  isConditionalLodestoneShop,
  mergeFriendlyTribeShopInfo,
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

test('mergeFriendlyTribeShopInfo adds rank-gated shops', () => {
  const items = [{ ID: 1, Name: 'バーチ樹液' }];
  const result = mergeFriendlyTribeShopInfo(items, {
    'バーチ樹液': {
      price: 468,
      shops: [{
        shopName: 'バヌバヌ族 商人のルナバヌ',
        area: 'アバラシア雲海',
        requiredRank: '1: 中立'
      }]
    }
  });
  assert.deepEqual(result, { matched: 1, shopAdded: 1, unmatched: 0, priceMismatch: 0 });
  assert.deepEqual(items[0].ShopInfo, {
    price: 468,
    shops: [{
      shopName: 'バヌバヌ族 商人のルナバヌ',
      area: 'アバラシア雲海',
      requiredRank: '1: 中立'
    }]
  });
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
  const html = '<section>ITEM LEVEL 9 <div class="db-view__item_spec"><div class="clearfix"><div class="db-view__item_spec__name db-view__item_spec__name--armor">物理防御力</div><div class="db-view__item_spec__name db-view__item_spec__name--last">魔法防御力</div></div><div class="clearfix sys_nq_element"><div><strong>12</strong></div><div><strong>8</strong></div></div><div class="clearfix sys_hq_element"><strong>13</strong><strong>9</strong></div></div> ファイター ソーサラー Lv 9～ Bonuses STR +1 DEX +2 VIT +3 INT +4 MND +5 クリティカル +6</section>';
  assert.deepEqual(extractLodestoneEquipmentInfo(html), {
    itemLevel: 9,
    jobs: ['ファイター', 'ソーサラー'],
    equipLevel: 9,
    stats: {
      STR: 1,
      DEX: 2,
      VIT: 3,
      INT: 4,
      MND: 5,
      不屈: 0,
      信仰: 0,
      スキルスピード: 0,
      スペルスピード: 0
    },
    performance: { physicalDamage: 0, magicalDamage: 0, physicalDefense: 12, magicalDefense: 8 }
  });
});

test('extractLodestoneEquipmentInfo reads base classes only from the item equipment specification', () => {
  const html = `
    <nav>剣術士 斧術士 格闘士 槍術士 双剣士 弓術士 幻術士 呪術士 巴術士</nav>
    <section>ITEM LEVEL 10 剣術士 ナイト Lv 10～ Bonuses STR +2 VIT +2</section>
  `;
  assert.deepEqual(extractLodestoneEquipmentInfo(html)?.jobs, ['剣術士', 'ナイト']);
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
      MND: 0,
      不屈: 0,
      信仰: 0,
      スキルスピード: 0,
      スペルスピード: 0
    },
    performance: { physicalDamage: 0, magicalDamage: 0, physicalDefense: 0, magicalDefense: 0 }
  });
});

test('extractLodestoneEquipmentInfo reads role and speed stats', () => {
  const html = '<section>ITEM LEVEL 90 全クラス Lv 50～ Bonuses VIT +20 不屈 +12 信仰 +11 スキルスピード +10 スペルスピード +9</section>';
  assert.deepEqual(extractLodestoneEquipmentInfo(html)?.stats, {
    STR: 0, DEX: 0, VIT: 20, INT: 0, MND: 0,
    不屈: 12, 信仰: 11, スキルスピード: 10, スペルスピード: 9
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
      MND: 13,
      不屈: 0,
      信仰: 0,
      スキルスピード: 0,
      スペルスピード: 0
    },
    performance: { physicalDamage: 0, magicalDamage: 0, physicalDefense: 0, magicalDefense: 0 }
  });
});

test('extractLodestoneEquipmentInfo reads physical and magical weapon performance', () => {
  const html = '<section>ITEM LEVEL 100 <div class="db-view__item_spec"><div class="clearfix"><div class="db-view__item_spec__name">物理基本性能</div><div class="db-view__item_spec__name">魔法基本性能</div><div class="db-view__item_spec__name">攻撃間隔</div></div><div class="clearfix sys_nq_element"><div><strong>101</strong></div><div><strong>77</strong></div><div><strong>3</strong></div></div></div> ナイト Lv 50～ Bonuses STR +10</section>';
  assert.deepEqual(extractLodestoneEquipmentInfo(html)?.performance, {
    physicalDamage: 101,
    magicalDamage: 77,
    physicalDefense: 0,
    magicalDefense: 0
  });
});

test('extractLodestoneEquipmentInfo ignores non-equipment pages', () => {
  assert.equal(extractLodestoneEquipmentInfo('<main>ITEM Lv の高い順 製作Lv 1-5</main>'), null);
  assert.equal(extractLodestoneEquipmentInfo('<main>ITEM LEVEL 5 食事効果 VIT +1 効果時間 30:00</main>'), null);
});

test('equipmentRoleDecision resolves broad equipment by name and stats', () => {
  assert.deepEqual(equipmentRoleDecision({
    Name: 'ミスライトディフェンダーネックレス',
    ItemUICategoryName: '首飾り',
    EquipmentInfo: {
      jobs: ['ファイター', 'ソーサラー'],
      equipLevel: 51,
      stats: { STR: 22, DEX: 0, VIT: 23, INT: 0, MND: 0 }
    }
  }), {
    status: 'resolved',
    role: 'tank',
    candidates: ['tank', 'healer', 'striker_slayer', 'scout_ranger', 'caster'],
    reason: 'name'
  });

  assert.deepEqual(equipmentRoleDecision({
    Name: 'スピネルリング',
    ItemUICategoryName: '指輪',
    EquipmentInfo: {
      jobs: ['全クラス'],
      equipLevel: 49,
      stats: { STR: 0, DEX: 5, VIT: 7, INT: 0, MND: 0 }
    }
  }), {
    status: 'resolved',
    role: 'scout_ranger',
    candidates: ['scout_ranger'],
    reason: 'stats'
  });
});

test('equipmentRoleDecision returns unresolved candidates for ambiguous broad equipment', () => {
  assert.deepEqual(equipmentRoleDecision({
    Name: 'アストラルリング',
    ItemUICategoryName: '指輪',
    EquipmentInfo: {
      jobs: ['全クラス'],
      equipLevel: 50,
      stats: { STR: 0, DEX: 0, VIT: 10, INT: 9, MND: 9 }
    }
  }), {
    status: 'unresolved',
    candidates: ['healer', 'caster'],
    reason: 'stats'
  });

  assert.deepEqual(equipmentRoleDecision({
    Name: 'ラプトルリストバンド',
    ItemUICategoryName: '腕輪',
    EquipmentInfo: {
      jobs: ['全クラス'],
      equipLevel: 48,
      stats: { STR: 5, DEX: 5, VIT: 6, INT: 0, MND: 0 }
    }
  }), {
    status: 'unresolved',
    candidates: ['tank', 'striker_slayer', 'scout_ranger'],
    reason: 'stats'
  });
});

test('equipmentRoleDecision uses role-specific and speed stats without over-resolving', () => {
  assert.deepEqual(equipmentRoleDecision({
    Name: '広域装備A',
    EquipmentInfo: {
      jobs: ['全クラス'],
      stats: { STR: 5, DEX: 5, VIT: 6, INT: 5, MND: 5, 不屈: 4 }
    }
  }), {
    status: 'resolved', role: 'tank', candidates: ['tank'], reason: 'role-stat'
  });
  assert.deepEqual(equipmentRoleDecision({
    Name: '広域装備B',
    EquipmentInfo: {
      jobs: ['全クラス'],
      stats: { STR: 5, DEX: 5, VIT: 6, INT: 5, MND: 5, スキルスピード: 4 }
    }
  }), {
    status: 'unresolved',
    candidates: ['tank', 'striker_slayer', 'scout_ranger'],
    reason: 'stats'
  });
  assert.deepEqual(equipmentRoleDecision({
    Name: '広域装備C',
    EquipmentInfo: {
      jobs: ['全クラス'],
      stats: { STR: 5, DEX: 5, VIT: 6, INT: 5, MND: 5, スペルスピード: 4 }
    }
  }), {
    status: 'unresolved', candidates: ['healer', 'caster'], reason: 'speed-stat'
  });
});

test('equipmentRoleDecision excludes equipment without useful primary stats', () => {
  assert.deepEqual(equipmentRoleDecision({
    Name: 'ブロンズバックラー',
    ItemUICategoryName: '盾',
    EquipmentInfo: {
      jobs: ['全クラス'],
      equipLevel: 1,
      stats: { STR: 0, DEX: 0, VIT: 0, INT: 0, MND: 0 }
    }
  }), {
    status: 'excluded',
    candidates: [],
    reason: 'no-primary-stats'
  });
});

test('findUnresolvedEquipmentRoleGroups groups unresolved equipment by level and common token', () => {
  const groups = findUnresolvedEquipmentRoleGroups([
    {
      ID: 1,
      Name: 'アストラルリング',
      ItemUICategoryName: '指輪',
      EquipmentInfo: { jobs: ['全クラス'], equipLevel: 50, stats: { VIT: 10, INT: 9, MND: 9 } }
    },
    {
      ID: 2,
      Name: 'アストラルチョーカー',
      ItemUICategoryName: '首飾り',
      EquipmentInfo: { jobs: ['全クラス'], equipLevel: 50, stats: { VIT: 10, INT: 9, MND: 9 } }
    }
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0], {
    key: '50:0:アストラル:VIT=10,INT=9,MND=9',
    equipLevel: 50,
    itemLevel: 0,
    commonToken: 'アストラル',
    statSignature: 'VIT=10,INT=9,MND=9',
    candidates: ['healer', 'caster', 'sorcerer'],
    items: [
      { id: 1, name: 'アストラルリング', category: '指輪', iconFile: '', stats: { VIT: 10, INT: 9, MND: 9 }, candidates: ['healer', 'caster'] },
      { id: 2, name: 'アストラルチョーカー', category: '首飾り', iconFile: '', stats: { VIT: 10, INT: 9, MND: 9 }, candidates: ['healer', 'caster'] }
    ]
  });
});

test('findUnresolvedEquipmentRoleGroups separates item levels and preserves significant names', () => {
  const makeItem = (id, name, equipLevel, itemLevel) => ({
    ID: id,
    Name: name,
    ItemUICategoryName: '耳飾り',
    IconFile: `${id}.webp`,
    EquipmentInfo: {
      jobs: ['全クラス'], equipLevel, itemLevel,
      stats: { STR: 4, DEX: 4, VIT: 5, INT: 0, MND: 0 }
    }
  });
  const groups = findUnresolvedEquipmentRoleGroups([
    makeItem(1, 'ミスリルイヤーカフス', 40, 40),
    makeItem(2, 'スフェーンリング', 28, 28),
    makeItem(3, 'スフェーンイヤリング', 28, 29),
    makeItem(4, 'ミスリルサークレット(ルベライト)', 38, 38)
  ]);
  assert.equal(groups.length, 4);
  assert.equal(groups.find(group => group.items[0].id === 1)?.commonToken, 'ミスリルイヤーカフス');
  assert.equal(groups.find(group => group.items[0].id === 4)?.commonToken, 'ミスリルサークレット(ルベライト)');
  assert.notEqual(
    groups.find(group => group.items[0].id === 2)?.key,
    groups.find(group => group.items[0].id === 3)?.key
  );
});

test('equipmentRoleDecision resolves equal physical and magical stat families', () => {
  assert.equal(equipmentRoleDecision({
    Name: 'ブラスゴルゲット',
    EquipmentInfo: { jobs: ['全クラス'], stats: { STR: 1, DEX: 1, VIT: 1, INT: 0, MND: 0 } }
  }).role, 'fighter');
  assert.equal(equipmentRoleDecision({
    Name: 'ホワイトコーラルアルミラ',
    EquipmentInfo: { jobs: ['全クラス'], stats: { STR: 2, DEX: 0, VIT: 2, INT: 0, MND: 0 } }
  }).role, 'fighter');
  assert.equal(equipmentRoleDecision({
    Name: 'ブラスリストレット',
    EquipmentInfo: { jobs: ['全クラス'], stats: { STR: 0, DEX: 0, VIT: 1, INT: 1, MND: 1 } }
  }).role, 'sorcerer');
  assert.equal(equipmentRoleDecision({
    Name: '物理試験装備',
    EquipmentInfo: { jobs: ['全クラス'], stats: { STR: 3, DEX: 3, VIT: 0, INT: 0, MND: 0 } }
  }).role, 'fighter');
  assert.equal(equipmentRoleDecision({
    Name: '魔法試験装備',
    EquipmentInfo: { jobs: ['全クラス'], stats: { STR: 0, DEX: 0, VIT: 0, INT: 3, MND: 3 } }
  }).role, 'sorcerer');
});

test('applyEquipmentRoleOverrides writes automatically resolved roles', () => {
  const items = [{
    ID: 1,
    Name: 'ブラスゴルゲット',
    EquipmentInfo: { jobs: ['全クラス'], stats: { STR: 1, DEX: 1, VIT: 1, INT: 0, MND: 0 } }
  }];
  const result = applyEquipmentRoleOverrides(items, {});
  assert.equal(result.automatic, 1);
  assert.equal(items[0].EquipmentInfo.recommendedRole, 'fighter');
});

test('findUnresolvedEquipmentRoleGroups separates different stat signatures', () => {
  const makeItem = (id, name, stats) => ({
    ID: id,
    Name: name,
    EquipmentInfo: { jobs: ['全クラス'], equipLevel: 30, itemLevel: 30, stats }
  });
  const groups = findUnresolvedEquipmentRoleGroups([
    makeItem(1, '試験リング', { VIT: 5, STR: 4, DEX: 4 }),
    makeItem(2, '試験イヤリング', { VIT: 5, STR: 3, DEX: 3 })
  ]);
  assert.equal(groups.length, 2);
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
