const test = require('node:test');
const assert = require('node:assert/strict');
const { createFavoriteListFileCodec } = require('../site/favorite-list-file.js');

const title = 'お気に入り一括';
const separator = '\n\n---\n\n';
const names = { 1: '甲', 2: '乙' };
const codes = new Map();
const codec = createFavoriteListFileCodec({
  title,
  separator,
  maxLists: 2,
  itemNameForId: id => names[id] || null,
  encodeFavoriteList: list => {
    const code = `code-${list.name}`;
    codes.set(code, { name: list.name, itemIds: [...list.itemIds], recipeSelections: {}, needsName: false });
    return code;
  },
  decodeFavoriteShareCode: code => codes.get(code) || null,
  normalizeName: value => String(value).trim()
});

test('favorite list files round trip names, displayed items, and empty lists', () => {
  const source = codec.encodeFile([
    { name: '一', itemIds: [1, 2] },
    { name: '空', itemIds: [] }
  ]);
  const decoded = codec.decodeFile(source.replace(/\n/g, '\r\n'));
  assert.deepEqual(decoded.map(list => [list.name, list.itemIds]), [
    ['一', [1, 2]],
    ['空', []]
  ]);
});

test('favorite list files reject altered display text and duplicate names', () => {
  const altered = codec.encodeFile([{ name: '一', itemIds: [1] }]).replace('・甲', '・乙');
  assert.equal(codec.decodeFile(altered), null);

  const duplicate = codec.encodeFile([
    { name: '一', itemIds: [1] },
    { name: '一', itemIds: [1] }
  ]);
  assert.equal(codec.decodeFile(duplicate), null);
});

test('favorite list files reject unsupported headers and excessive block counts', () => {
  assert.equal(codec.decodeFile('別形式\n\n'), null);
  const source = codec.encodeFile([
    { name: '一', itemIds: [1] },
    { name: '二', itemIds: [2] },
    { name: '三', itemIds: [] }
  ]);
  assert.equal(codec.decodeFile(source), null);
});
