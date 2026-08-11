const test = require('node:test');
const assert = require('node:assert/strict');
const { FOOTER_TEXT, pngFileName, shareTitle } = require('../site/share-content-model.js');

test('share titles follow the selected panel and favorite material mode', () => {
  assert.equal(shareTitle({ panel: 'left', listMode: 'search' }), '検索結果');
  assert.equal(shareTitle({ panel: 'left', listMode: 'equipment' }), '装備検索結果');
  assert.equal(shareTitle({ panel: 'left', listMode: 'fav', favoriteListName: '薬品' }), '薬品');
  assert.equal(shareTitle({ panel: 'middle', selectedItem: '剛力の幻薬' }), '剛力の幻薬の作成先');
  assert.equal(
    shareTitle({ panel: 'right', selectedItem: '剛力の幻薬', resultViewMode: 'materials' }),
    '剛力の幻薬の素材リスト'
  );
  assert.equal(shareTitle({ panel: 'right', multipleFavoriteLists: true }), '複数お気に入りの素材リスト');
  assert.match(FOOTER_TEXT, /@ff14_recipe/);
});

test('PNG names use JST seconds and replace only forbidden filename characters', () => {
  assert.equal(
    pngFileName('薬品/A:B*?', new Date('2026-08-11T09:12:34.000Z')),
    '薬品＿A＿B＿＿_20260811_181234.png'
  );
});
