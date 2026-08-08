import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyDescendingSortOrder,
  createSequentialRequestQueue,
  extractLodestoneItemList,
  extractLodestoneListMeta,
  extractLodestoneRecipeList,
  exactXivapiItemIcon,
  lodestoneOrderSignature,
  crawlLodestoneList,
  normalizeLodestoneName,
  xivapiExactItemSearchUrl,
  xivapiPngAssetUrl
} from '../pipeline/tool/lodestone-source.mjs';

const meta = '<p class="db-content__title--version">Version:Patch 7.55</p><span class="total">51</span>';

test('Lodestone一覧の版・件数と名前キーの行を抽出する', () => {
  assert.deepEqual(extractLodestoneListMeta(meta), { version: '7.55', total: 51, pages: 2 });
  const html = `<tr><td><img src="https://lds-img.finalfantasyxiv.com/itemicon/a.png?n7.55"><span class="db-table__txt--type"><a>素材</a> &gt; <a>石材</a></span><a href="/lodestone/playguide/db/item/abc123/" class="db_popup db-table__txt--detail_link"> 灰重石 </a></td></tr>`;
  assert.deepEqual(extractLodestoneItemList(html), [{
    Name: '灰重石', LodestoneKey: 'abc123', DetailPath: '/lodestone/playguide/db/item/abc123/', ItemCategory: '石材', IconUrl: 'https://lds-img.finalfantasyxiv.com/itemicon/a.png?n7.55'
  }]);
});

test('Lodestone製作手帳一覧から完成品名とレシピキーを抽出する', () => {
  const html = `<tr><td><span class="db-table__txt--type"><a>木工師</a></span><a href="/lodestone/playguide/db/recipe/def456/" class="db_popup db-table__txt--detail_link">メープル材</a></td></tr>`;
  assert.deepEqual(extractLodestoneRecipeList(html), [{ Name: 'メープル材', RecipeKey: 'def456', DetailPath: '/lodestone/playguide/db/recipe/def456/', Job: '木工師' }]);
});

test('名称の実文字記号は保持し装飾用の私用領域文字だけを除く', () => {
  assert.equal(normalizeLodestoneName('素材† \uE03D'), '素材†');
});

test('SortOrderは全件数から降順で付与し順序署名は並び替えを検知する', () => {
  const items = [{ Name: 'A', LodestoneKey: 'a' }, { Name: 'B', LodestoneKey: 'b' }];
  assert.deepEqual(applyDescendingSortOrder(items, 45160).map(item => item.SortOrder), [45160, 45159]);
  assert.notEqual(lodestoneOrderSignature(items), lodestoneOrderSignature([...items].reverse()));
});

test('要求キューは同時実行せず開始間隔を守る', async () => {
  let clock = 0;
  let active = 0;
  let maxActive = 0;
  const starts = [];
  const queued = createSequentialRequestQueue({
    delayMs: 100,
    now: () => clock,
    wait: async ms => { clock += ms; },
    request: async value => {
      starts.push(clock);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return value;
    }
  });
  assert.deepEqual(await Promise.all([queued(1), queued(2), queued(3)]), [1, 2, 3]);
  assert.equal(maxActive, 1);
  assert.deepEqual(starts, [0, 100, 200]);
});

test('一覧クロールは取得済みの先頭ページを再通信しない', async () => {
  const calls = [];
  const firstHtml = `${meta}<tr><a href="/lodestone/playguide/db/item/a/" class="db-table__txt--detail_link">A</a></tr>`;
  const secondHtml = Array.from({ length: 50 }, (_, index) => `<tr><a href="/lodestone/playguide/db/item/k${index}/" class="db-table__txt--detail_link">N${index}</a></tr>`).join('');
  const result = await crawlLodestoneList({
    baseUrl: 'https://example.test/item/',
    extractEntries: extractLodestoneItemList,
    firstHtml,
    fetchText: async url => { calls.push(url); return secondHtml; }
  });
  assert.equal(result.entries.length, 51);
  assert.deepEqual(calls, ['https://example.test/item/?page=2']);
});

test('XIVAPI画像候補は日本語名の完全一致が一件のときだけ採用する', () => {
  const payload = { results: [{ sheet: 'Item', row_id: 5371, fields: { Name: 'ウォルナット材', Icon: { path: 'ui/icon/022000/022456.tex' } } }] };
  assert.deepEqual(exactXivapiItemIcon(payload, 'ウォルナット材'), { itemId: 5371, path: 'ui/icon/022000/022456.tex' });
  assert.equal(exactXivapiItemIcon({ results: [...payload.results, ...payload.results] }, 'ウォルナット材'), null);
  assert.match(xivapiExactItemSearchUrl('ウォルナット材'), /sheets=Item/);
  assert.match(xivapiPngAssetUrl('ui/icon/a.tex'), /format=png$/);
});
