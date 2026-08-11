import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {
  extractLodestoneCraftInfo,
  extractLodestoneEquipmentInfo,
  extractLodestoneIsEx,
  extractLodestoneRecipeData,
  extractLodestoneRecipePaths,
  extractLodestoneShopInfo,
  compressLodestoneHtml,
  decompressLodestoneHtml,
  applyEquipmentRoleOverrides,
  applyPublicationPolicy,
  equipmentRoleDecision,
  findUnresolvedEquipmentRoleGroups,
  hasExistingLodestoneInfo,
  itemIconFileName,
  itemIconNameHash,
  isConditionalLodestoneShop,
  mergeFriendlyTribeShopInfo,
  mergeHousingShopInfo,
  mergePublishItems,
  migrateLodestoneShopCache,
  nextLodestoneSearchUrl,
  openLodestoneShopCacheStore,
  parseCsv,
  projectPublicItems,
  publicationReviewItems,
  readLodestoneShopCacheEntry,
  resolveLodestoneShopCondition,
  resolveLodestoneItemDetail,
  enrichNewLodestoneCandidateItem,
  ensureLodestoneCandidateIcons,
  cleanupItemIconAssets,
  cacheLodestoneRecipeDetails,
  validateItemIconAssets,
  validateLodestoneCandidateLineage,
  validatePromotedLodestoneAuditInput,
  validateItemIconFileName,
  writeLodestoneShopCacheEntry
} from '../pipeline/tool/pipeline-tool.mjs';
import {
  completeLodestoneAuditResource,
  createLodestoneAudit,
  openLodestoneAuditStore,
  planLodestoneAuditResource,
  promoteCompletedLodestoneAudit
} from '../pipeline/tool/lodestone-audit-store.mjs';

function createPromotedTestAudit(store, id) {
  createLodestoneAudit(store, { id, catalogFingerprint: 'catalog', now: 100 });
  planLodestoneAuditResource(store, id, {
    kind: 'item-list-page',
    key: 'page:1',
    url: 'https://example.invalid/item/'
  }, { now: 101 });
  completeLodestoneAuditResource(store, id, {
    kind: 'item-list-page',
    key: 'page:1',
    artifactKey: `${id}/item-list-page/page-1.json.gz`,
    contentSha256: 'a'.repeat(64),
    rawBytes: 1
  }, { now: 102 });
  promoteCompletedLodestoneAudit(store, id, { now: 110 });
}

test('new candidate items receive required Lodestone detail data without another source', async () => {
  const calls = [];
  const item = { Name: '新素材', SortOrder: 1 };
  const result = await enrichNewLodestoneCandidateItem(item, { DetailPath: '/lodestone/playguide/db/item/newitem/' }, {
    delayMs: 125,
    fetchText: async (url, delayMs) => {
      calls.push({ url, delayMs });
      return `
        <meta property="og:title" content="新素材 | FINAL FANTASY XIV, The Lodestone">
        <div class="db-view__item__header clearfix"><h2>新素材</h2></div>
      `;
    }
  });
  assert.equal(result, item);
  assert.equal(item.IsEx, false);
  assert.deepEqual(calls, [{
    url: 'https://jp.finalfantasyxiv.com/lodestone/playguide/db/item/newitem/',
    delayMs: 125
  }]);
});

test('Lodestone recipe details are fetched sequentially for autonomous candidate generation', async () => {
  const calls = [];
  let active = 0;
  let maxActive = 0;
  const progress = [];
  const result = await cacheLodestoneRecipeDetails([
    { DetailPath: '/lodestone/playguide/db/recipe/aaa/' },
    { DetailPath: '/lodestone/playguide/db/recipe/bbb/' }
  ], {
    delayMs: 250,
    fetchText: async (url, delayMs) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      calls.push({ url, delayMs });
      await Promise.resolve();
      active -= 1;
      return '<html></html>';
    },
    onProgress: value => progress.push([value.completed, value.total])
  });
  assert.equal(maxActive, 1);
  assert.deepEqual(calls.map(call => call.delayMs), [250, 250]);
  assert.deepEqual(calls.map(call => call.url), [
    'https://jp.finalfantasyxiv.com/lodestone/playguide/db/recipe/aaa/',
    'https://jp.finalfantasyxiv.com/lodestone/playguide/db/recipe/bbb/'
  ]);
  assert.deepEqual(progress, [[1, 2], [2, 2]]);
  assert.deepEqual(result, { total: 2 });
});

test('item icon filenames combine stable item-name and WebP-content hashes', () => {
  const bytes = Buffer.from('webp-content');
  const iconFile = itemIconFileName('バスタードソード', bytes);

  assert.match(iconFile, /^[0-9a-f]{20}-[0-9a-f]{12}\.webp$/);
  assert.equal(iconFile.startsWith(itemIconNameHash('バスタードソード')), true);
  assert.equal(validateItemIconFileName('バスタードソード', iconFile, bytes), true);
  assert.equal(validateItemIconFileName('別名', iconFile, bytes), false);
  assert.equal(validateItemIconFileName('バスタードソード', iconFile, Buffer.from('changed')), false);
});

test('candidate icon generation migrates existing files, protects manual input, and rebuilds missing output', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ffxiv-name-icons-'));
  const candidatePath = path.join(root, 'candidate.json');
  const snapshotPath = path.join(root, 'snapshot.json');
  const existingPath = path.join(root, 'existing.json');
  const iconsRoot = path.join(root, 'icons');
  const manualIconsRoot = path.join(root, 'manual');
  const pngCacheRoot = path.join(root, 'cache');
  const databasePath = path.join(root, 'audit.sqlite');
  const auditStore = openLodestoneAuditStore(databasePath);
  createPromotedTestAudit(auditStore, 'audit-icons');
  auditStore.close();
  const manualBytes = await sharp({
    create: { width: 2, height: 2, channels: 4, background: '#ffcc00' }
  }).webp().toBuffer();
  const networkPng = await sharp({
    create: { width: 2, height: 2, channels: 4, background: '#335577' }
  }).png().toBuffer();
  fs.mkdirSync(path.join(iconsRoot, '065'), { recursive: true });
  fs.writeFileSync(path.join(iconsRoot, '065', '065024.webp'), manualBytes);
  fs.writeFileSync(candidatePath, JSON.stringify({
    SchemaVersion: 3,
    AuditId: 'audit-icons',
    DataGeneration: 'generation-icons',
    Version: 'test',
    Items: [
      { Name: '手動貨幣', IconFile: '065024.webp' },
      { Name: '通常素材', SortOrder: 2 },
      { Name: '画像なし' }
    ]
  }));
  fs.writeFileSync(snapshotPath, JSON.stringify({
    SchemaVersion: 3,
    AuditId: 'audit-icons',
    DataGeneration: 'generation-icons',
    Items: [{ Name: '通常素材', LodestoneKey: 'network-key', IconUrl: 'https://example.test/icon.png' }],
    Recipes: []
  }));
  fs.writeFileSync(existingPath, JSON.stringify({
    Version: 'old',
    Items: [{ Name: '手動貨幣', IconFile: '065024.webp' }]
  }));
  let requests = 0;

  try {
    const result = await ensureLodestoneCandidateIcons({
      candidatePath,
      snapshotPath,
      existingItemJsonPath: existingPath,
      iconsRoot,
      manualIconsRoot,
      pngCacheRoot,
      databasePath,
      delayMs: 0,
      size: 8,
      request: async () => {
        requests += 1;
        return new Response(networkPng, { headers: { 'content-type': 'image/png' } });
      }
    });
    const items = JSON.parse(fs.readFileSync(candidatePath, 'utf8')).Items;

    assert.equal(result.manualProtected, 1);
    assert.equal(result.downloaded, 1);
    assert.equal(result.withoutImage, 1);
    assert.equal(requests, 1);
    assert.match(items[0].IconFile, /^[0-9a-f]{20}-[0-9a-f]{12}\.webp$/);
    assert.match(items[1].IconFile, /^[0-9a-f]{20}-[0-9a-f]{12}\.webp$/);
    assert.equal(items[2].IconFile, undefined);
    assert.equal(fs.existsSync(path.join(manualIconsRoot, `${itemIconNameHash('手動貨幣')}.webp`)), true);
    assert.deepEqual(validateItemIconAssets(items, { iconsRoot }), { items: 3, icons: 2 });

    const dryRun = cleanupItemIconAssets({ items, iconsRoot, dryRun: true });
    assert.deepEqual(dryRun.removed, ['065/065024.webp']);
    assert.equal(fs.existsSync(path.join(iconsRoot, '065', '065024.webp')), true);
    const cleanup = cleanupItemIconAssets({ items, iconsRoot });
    assert.deepEqual(cleanup.removed, ['065/065024.webp']);
    assert.equal(fs.existsSync(path.join(iconsRoot, '065', '065024.webp')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('candidate lineage rejects legacy snapshots and mismatched audit generations', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ffxiv-candidate-lineage-'));
  const store = openLodestoneAuditStore(path.join(root, 'audit.sqlite'));
  try {
    createPromotedTestAudit(store, 'audit-current');
    assert.throws(
      () => validatePromotedLodestoneAuditInput({
        snapshot: { SchemaVersion: 1, Items: [], Recipes: [] },
        store
      }),
      /SchemaVersion 3/
    );
    const snapshot = {
      SchemaVersion: 3,
      AuditId: 'audit-current',
      DataGeneration: 'generation-current',
      Items: [],
      Recipes: []
    };
    assert.throws(
      () => validateLodestoneCandidateLineage({
        snapshot,
        candidate: {
          SchemaVersion: 3,
          AuditId: 'audit-current',
          DataGeneration: 'generation-old',
          Items: []
        },
        store
      }),
      /監査IDまたはデータ世代が一致しません/
    );
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('publication policy preserves unconfirmed existing data and withholds unconfirmed new items', () => {
  const baseItems = [
    { ID: '1', Name: '既存', IconFile: '000001.webp' },
    { ID: '2', Name: '除外対象', IconFile: '000002.webp' }
  ];
  const candidateItems = [
    { ID: '1', Name: '未確認の変更', IconFile: '000001.webp' },
    { ID: '2', Name: '除外対象', IconFile: '000002.webp' },
    { ID: '3', Name: '未確認の新規', IconFile: '000003.webp' },
    {
      ID: '4',
      Name: 'Lodestone確認済み',
      IconFile: '000004.webp',
      IsEx: false,
      LodestoneInfoVersion: 2,
      LodestoneInfoCheckedAt: '2026-07-28T00:00:00.000Z'
    },
    { ID: '5', Name: '明示例外', IconFile: '000005.webp' }
  ];
  const result = applyPublicationPolicy({
    baseItems,
    candidateItems,
    decisions: {
      version: 1,
      items: {
        2: { decision: 'exclude', reason: 'unused', iconSource: 'none' },
        5: { decision: 'keep', reason: 'exchange-currency', iconSource: 'xivapi' }
      }
    }
  });
  assert.deepEqual(result.published.map(item => [item.ID, item.Name]), [
    ['1', '既存'],
    ['4', 'Lodestone確認済み'],
    ['5', '明示例外']
  ]);
  assert.deepEqual(result.withheld.map(item => item.ID), ['1', '3']);
  assert.deepEqual(result.excluded.map(item => item.ID), ['2']);
});

test('publication review includes unchanged legacy items that still lack Lodestone confirmation', () => {
  const baseItems = [
    { ID: '1', Name: '同一', IconFile: '000001.webp' },
    { ID: '2', Name: '変更前', IconFile: '000002.webp' }
  ];
  const rows = publicationReviewItems({
    baseItems,
    candidateItems: [
      { ID: '1', Name: '同一', IconFile: '000001.webp' },
      { ID: '2', Name: '変更後', IconFile: '000002.webp' },
      { ID: '3', Name: '新規', IconFile: '000003.webp', Recipe: { Ingredients: [{ ItemID: '2', Amount: '1' }] } }
    ],
    decisions: {}
  });
  assert.deepEqual(rows.map(row => [row.id, row.status, row.existing]), [
    ['3', 'unreviewed', false],
    ['1', 'legacy-unverified', true],
    ['2', 'unreviewed', true]
  ]);
});

test('projectPublicItems removes pipeline-only and derivable runtime data without changing its source', () => {
  const source = [{
    ID: '1',
    Name: '完成品',
    Description: '説明',
    LevelEquip: '10',
    ItemUICategory: '1',
    ItemUICategoryName: '素材',
    ItemSearchCategory: '2',
    ItemSearchCategoryName: '検索',
    IsEx: false,
    LodestoneInfoVersion: 2,
    LodestoneInfoCheckedAt: '2026-01-01T00:00:00.000Z',
    Recipe: {
      Ingredients: [
        { ItemID: '2', Name: '素材', Amount: '3' },
        { ItemID: '0', Name: '軍票', Amount: '200' }
      ]
    },
    Recipes: [{
      Ingredients: [{ ItemID: '2', Name: '素材', Amount: '3' }]
    }],
    EquipmentInfo: {
      statsVersion: 2,
      stats: { STR: 10, VIT: 0 },
      performance: { physicalDamage: 0, magicalDamage: 0 }
    }
  }, {
    ID: '2',
    Name: '素材',
    IsEx: true
  }];

  const projected = projectPublicItems(source);

  assert.deepEqual(projected, [{
    ID: '1',
    Name: '完成品',
    ItemUICategory: '1',
    ItemUICategoryName: '素材',
    Recipe: {
      Ingredients: [
        { ItemID: '2', Amount: '3' },
        { ItemID: '0', Name: '軍票', Amount: '200' }
      ]
    },
    Recipes: [{
      Ingredients: [{ ItemID: '2', Amount: '3' }]
    }],
    EquipmentInfo: {
      stats: { STR: 10 }
    }
  }, {
    ID: '2',
    Name: '素材',
    IsEx: true
  }]);
  assert.equal(source[0].Description, '説明');
  assert.equal(source[0].Recipe.Ingredients[0].Name, '素材');
  assert.equal(source[0].EquipmentInfo.stats.VIT, 0);
  assert.deepEqual(projectPublicItems(projected), projected);
});

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

test('mergePublishItems applies EX information from a partial Lodestone candidate', () => {
  const baseItems = [
    { ID: 1, Name: 'EX素材', IconFile: 'a.webp', IsEx: true, LodestoneInfoVersion: 1 },
    { ID: 2, Name: '通常素材', IconFile: 'b.webp' }
  ];
  const candidateItems = [
    { ID: 1, IsEx: false, LodestoneInfoVersion: 1 },
    { ID: 2, IsEx: true, LodestoneInfoVersion: 1 }
  ];
  assert.deepEqual(mergePublishItems(baseItems, candidateItems), [
    { ID: 1, Name: 'EX素材', IconFile: 'a.webp', IsEx: false, LodestoneInfoVersion: 1 },
    { ID: 2, Name: '通常素材', IconFile: 'b.webp', IsEx: true, LodestoneInfoVersion: 1 }
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

test('SQLite Lodestone cache preserves Japanese HTML, verifies integrity, and rejects oversized output', () => {
  const html = `<title>エオルゼアデータベース「鉄鉱」</title>${'<p>通常ショップ</p>'.repeat(100)}`;
  const entry = compressLodestoneHtml(html);
  assert.equal(decompressLodestoneHtml({ body: entry.body, raw_bytes: entry.rawBytes, sha256: entry.sha256 }), html);
  assert.ok(entry.body.length < entry.rawBytes);
  assert.throws(() => compressLodestoneHtml('x'.repeat(1025), { maxOutputLength: 1024 }), /上限を超えています/);
  assert.throws(
    () => decompressLodestoneHtml({ body: entry.body, raw_bytes: entry.rawBytes + 1, sha256: entry.sha256 }),
    /展開サイズが一致しません/
  );
});

test('Lodestone cache migration is resumable and removes only HTML verified in SQLite', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ffxiv-recipe-migrate-'));
  const databasePath = path.join(root, 'cache.sqlite');
  const first = `${'a'.repeat(64)}.html`;
  const second = `${'b'.repeat(64)}.html`;
  try {
    fs.writeFileSync(path.join(root, first), '<p>通常ショップ</p>', 'utf8');
    fs.writeFileSync(path.join(root, second), '<p>再開対象</p>', 'utf8');

    const dryRun = migrateLodestoneShopCache({ root, databasePath, dryRun: true });
    assert.equal(dryRun.candidates, 2);
    assert.equal(dryRun.removed, 0);
    assert.ok(fs.existsSync(path.join(root, first)));

    const firstRun = migrateLodestoneShopCache({ root, databasePath, limit: 1, batchSize: 1 });
    assert.deepEqual(
      { converted: firstRun.converted, removed: firstRun.removed, failed: firstRun.failed },
      { converted: 1, removed: 1, failed: 0 }
    );
    assert.ok(!fs.existsSync(path.join(root, first)));
    assert.ok(fs.existsSync(path.join(root, second)));

    const resumed = migrateLodestoneShopCache({ root, databasePath, batchSize: 1 });
    assert.equal(resumed.removed, 1);
    assert.equal(resumed.failed, 0);
    assert.ok(!fs.existsSync(path.join(root, second)));
    const store = openLodestoneShopCacheStore(databasePath);
    try {
      assert.equal(readLodestoneShopCacheEntry(store, 'a'.repeat(64)), '<p>通常ショップ</p>');
      assert.equal(readLodestoneShopCacheEntry(store, 'b'.repeat(64)), '<p>再開対象</p>');
      assert.equal(Number(store.count.get().count), 2);
    } finally {
      store.close();
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SQLite Lodestone cache writes one keyed row and stores its source URL', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ffxiv-recipe-sqlite-'));
  const databasePath = path.join(root, 'cache.sqlite');
  const store = openLodestoneShopCacheStore(databasePath);
  try {
    const key = 'c'.repeat(64);
    const html = '<p>レシピ詳細</p>';
    writeLodestoneShopCacheEntry(store, key, html, { url: 'https://example.invalid/page' });
    assert.equal(readLodestoneShopCacheEntry(store, key), html);
    assert.equal(Number(store.count.get().count), 1);
    assert.equal(store.db.prepare('SELECT url FROM cache WHERE key = ?').get(key).url, 'https://example.invalid/page');
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('shop condition memory cache reuses decisions and stops admitting entries at its limit', async () => {
  const cache = new Map();
  let loads = 0;
  const loadConditional = async () => {
    loads += 1;
    return '<p>このショップはプレイヤーの特定条件によって販売されるアイテムが異なります。</p>';
  };
  const first = await resolveLodestoneShopCondition('shop-a', loadConditional, { cache, maxEntries: 1 });
  const reused = await resolveLodestoneShopCondition('shop-a', loadConditional, { cache, maxEntries: 1 });
  const uncached = await resolveLodestoneShopCondition('shop-b', async () => '<p>通常ショップ</p>', { cache, maxEntries: 1 });
  assert.deepEqual(first, { conditional: true, memoryHit: false, cacheError: false });
  assert.deepEqual(reused, { conditional: true, memoryHit: true, cacheError: false });
  assert.deepEqual(uncached, { conditional: false, memoryHit: false, cacheError: false });
  assert.equal(loads, 1);
  assert.equal(cache.size, 1);
});

test('extractLodestoneCraftInfo reads job, level, and masterbook only', () => {
  const html = '<title>エオルゼアデータベース「インダガトル・クラフターコート」 | FINAL FANTASY XIV, The Lodestone</title><main>製作手帳 裁縫師 秘伝書 秘伝書:第10巻 インダガトル・クラフターコート <section>裁縫師 Lv 90 <p class="db-view__recipe__text__book_name">裁縫秘伝書:第10巻</p><h2>インダガトル・クラフターコート</h2></section></main>';
  assert.deepEqual(extractLodestoneCraftInfo(html), {
    job: '裁縫師',
    level: 90,
    masterbook: '裁縫秘伝書:第10巻'
  });
});

test('extractLodestoneCraftInfo keeps non-numbered masterbook names', () => {
  const html = '<main><section><p>錬金術師 Lv 50</p><p class="db-view__recipe__text__book_name">錬成秘伝書:デミマテリア</p></section></main>';
  assert.deepEqual(extractLodestoneCraftInfo(html), {
    job: '錬金術師',
    level: 50,
    masterbook: '錬成秘伝書:デミマテリア'
  });
});

test('extractLodestoneCraftInfo ignores masterbook menu entries', () => {
  const html = '<title>エオルゼアデータベース「ブロンズインゴット」 | FINAL FANTASY XIV, The Lodestone</title><main>鍛冶師 Lv 1 ブロンズインゴット 製作Lv 91-95 秘伝書 秘伝書:第12巻</main>';
  assert.deepEqual(extractLodestoneCraftInfo(html), {
    job: '鍛冶師',
    level: 1
  });
});

test('extractLodestoneRecipeData reads a Lodestone recipe variant and resolves ingredient keys', () => {
  const html = `
    <main>
      <p>木工師 Lv 15</p>
      <p class="db-view__recipe__text__book_name">木工秘伝書:ミラージュプリズム</p>
      <span class="js__complete_craft_count">1</span>
      <div data-name="クリアプリズム" class="js__material db-tree" data-depth="1" data-num="1" data-key="clear"></div>
      <div class="db-tree js__material" data-key="lumber" data-num="2" data-depth="1" data-name="ウォルナット材"></div>
      <div class="js__material db-tree" data-key="nested" data-num="3" data-depth="2" data-name="下位素材"></div>
    </main>`;
  assert.deepEqual(
    extractLodestoneRecipeData('/lodestone/playguide/db/recipe/0e351054234/', html, {
      craftTypeByJob: new Map([['木工師', '0']]),
      itemIdByLodestoneKey: new Map([
        ['clear', '7671'],
        ['lumber', '5371']
      ])
    }),
    {
      RecipeID: '0e351054234',
      CraftType: '0',
      CraftInfo: { job: '木工師', level: 15, masterbook: '木工秘伝書:ミラージュプリズム' },
      AmountResult: '1',
      Ingredients: [
        { ItemID: '7671', Name: 'クリアプリズム', Amount: '1' },
        { ItemID: '5371', Name: 'ウォルナット材', Amount: '2' }
      ]
    }
  );
});

test('extractLodestoneIsEx reads EX only from the item header', () => {
  const exHtml = `
    <div class="related-item"><span class="ex_bind">EX</span></div>
    <div class="db-view__item__header clearfix">
      <div class="db-view__item__text">
        <div class="db-view__item__text__element ja"><span class="ex_bind">EX</span></div>
        <h2>改良用のアイアンネイル</h2>
      </div>
    </div>
  `;
  const normalHtml = `
    <div class="related-item"><span class="ex_bind">EX</span></div>
    <div class="db-view__item__header clearfix"><h2>アイアンネイル</h2></div>
    <div class="related-item"><span class="ex_bind">EX</span></div>
  `;
  assert.equal(extractLodestoneIsEx(exHtml), true);
  assert.equal(extractLodestoneIsEx(normalHtml), false);
  assert.equal(extractLodestoneIsEx('<main>EX</main>'), null);
});

test('hasExistingLodestoneInfo requires the current item flag schema', () => {
  assert.equal(hasExistingLodestoneInfo({ LodestoneInfoCheckedAt: '2026-01-01T00:00:00.000Z' }), false);
  assert.equal(
    hasExistingLodestoneInfo({
      LodestoneInfoCheckedAt: '2026-01-01T00:00:00.000Z',
      LodestoneInfoVersion: 2,
      IsEx: false
    }),
    true
  );
  assert.equal(
    hasExistingLodestoneInfo({
      LodestoneInfoCheckedAt: '2026-01-01T00:00:00.000Z',
      LodestoneInfoVersion: 2,
      IsEx: false,
      CraftInfo: [{ job: '木工師', level: 1 }]
    }),
    true
  );
  assert.equal(
    hasExistingLodestoneInfo({
      LodestoneInfoCheckedAt: '2026-01-01T00:00:00.000Z',
      LodestoneInfoVersion: 2,
      IsEx: false,
      CraftInfo: [
        { job: '鍛冶師', level: 1 },
        { job: '甲冑師', level: 1 }
      ]
    }),
    false
  );
});

test('extractLodestoneEquipmentInfo reads item level, equip level, jobs, and primary stats', () => {
  const html = '<section>ITEM LEVEL 9 <div class="db-view__item_spec"><div class="clearfix"><div class="db-view__item_spec__name db-view__item_spec__name--armor">物理防御力</div><div class="db-view__item_spec__name db-view__item_spec__name--last">魔法防御力</div></div><div class="clearfix sys_nq_element"><div><strong>12</strong></div><div><strong>8</strong></div></div><div class="clearfix sys_hq_element"><strong>13</strong><strong>9</strong></div></div> ファイター ソーサラー Lv 9～ Bonuses STR +1 DEX +2 VIT +3 INT +4 MND +5 クリティカル +6</section>';
  assert.deepEqual(extractLodestoneEquipmentInfo(html), {
    itemLevel: 9,
    jobs: ['ファイター', 'ソーサラー'],
    equipLevel: 9,
    statsVersion: 2,
    stats: {
      STR: 1,
      DEX: 2,
      VIT: 3,
      INT: 4,
      MND: 5,
      不屈: 0,
      信仰: 0,
      スキルスピード: 0,
      スペルスピード: 0,
      クリティカル: 6
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
    statsVersion: 2,
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

test('extractLodestoneEquipmentInfo reads every NQ crafter and gatherer stat', () => {
  const html = `
    <section>ITEM LEVEL 70 全クラス Lv 50～
      <div class="sys_nq_element">
        <h3>Bonuses</h3>
        <ul class="db-view__basic_bonus">
          <li><span>CP</span> +2</li>
          <li><span>作業精度</span> +89</li>
          <li><span>加工精度</span> +35</li>
          <li><span>GP</span> +3</li>
          <li><span>獲得力</span> +62</li>
          <li><span>技術力</span> +31</li>
          <li><span>将来追加ステータス</span> +7</li>
        </ul>
      </div>
      <div class="sys_hq_element">
        <h3>Bonuses</h3>
        <ul class="db-view__basic_bonus"><li><span>作業精度</span> +101</li></ul>
      </div>
    </section>`;
  const info = extractLodestoneEquipmentInfo(html);

  assert.equal(info?.statsVersion, 2);
  assert.deepEqual(
    Object.fromEntries(['CP', '作業精度', '加工精度', 'GP', '獲得力', '技術力', '将来追加ステータス']
      .map(name => [name, info?.stats?.[name]])),
    { CP: 2, 作業精度: 89, 加工精度: 35, GP: 3, 獲得力: 62, 技術力: 31, 将来追加ステータス: 7 }
  );
});

test('extractLodestoneEquipmentInfo does not absorb stats as job text', () => {
  const html = '<section>ITEM LEVEL 110 魔法防御力 1 ファイター ソーサラー Lv 50～ Bonuses STR +18 VIT +18 MND +13 ソーサラー Lv 50～</section>';
  assert.deepEqual(extractLodestoneEquipmentInfo(html), {
    itemLevel: 110,
    jobs: ['ファイター', 'ソーサラー'],
    equipLevel: 50,
    statsVersion: 2,
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
