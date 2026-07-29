const test = require('node:test');
const assert = require('node:assert/strict');
const { createCodec, decodeVarUint, encodeVarUint } = require('../site/favorite-share-codec.js');

const namesById = new Map([
  [10, 'A'],
  [20, 'B']
]);
const idsByName = new Map([...namesById].map(([id, name]) => [name, id]));
const variants = {
  A: [
    { recipeId: 'a-carpenter', craftType: 0 },
    { recipeId: 'a-smith', craftType: 1 }
  ],
  B: [{ recipeId: 'b-carpenter', craftType: 0 }]
};
const codec = createCodec({
  normalizeName: value => String(value || '').trim().slice(0, 20),
  normalizeItemIds: value =>
    Array.isArray(value) ? [...new Set(value.map(Number).filter(id => Number.isInteger(id) && id > 0))] : [],
  compactRecipeSelections: list =>
    Object.entries(list.recipeSelections || {})
      .map(([itemId, recipeId]) => {
        const name = namesById.get(Number(itemId));
        const variant = (variants[name] || []).find(entry => entry.recipeId === recipeId);
        return variant ? { itemId: Number(itemId), craftType: variant.craftType } : null;
      })
      .filter(Boolean)
      .sort((left, right) => left.itemId - right.itemId),
  itemNameForId: id => namesById.get(Number(id)) || null,
  itemIdForName: name => idsByName.get(name) || null,
  recipeNameForLegacyId: id => namesById.get(Number(id)) || null,
  recipeVariantsForName: name => variants[name] || []
});

test('variable unsigned integers round trip at encoding boundaries', () => {
  [0, 1, 127, 128, 16384, Number.MAX_SAFE_INTEGER].forEach(value => {
    const bytes = Uint8Array.from(encodeVarUint(value));
    const state = { offset: 0 };
    assert.equal(decodeVarUint(bytes, state), value);
    assert.equal(state.offset, bytes.length);
  });
  assert.throws(() => encodeVarUint(-1), RangeError);
});

test('compact favorite share codes round trip names, item ids, and recipe selections', () => {
  const code = codec.encodeFavoriteList({
    name: ' test ',
    itemIds: [10, 20, 10],
    recipeSelections: { 10: 'a-smith', 20: 'b-carpenter' }
  });
  assert.match(code, /^Y[A-Za-z0-9_-]+$/);
  assert.deepEqual(codec.decodeFavoriteShareCode(code), {
    name: 'test',
    itemIds: [10, 20],
    recipeSelections: { 10: 'a-smith', 20: 'b-carpenter' },
    needsName: false
  });
});

test('share decoder rejects corrupted compact codes and supports legacy recipe ids', () => {
  const code = codec.encodeFavoriteList({ name: 'test', itemIds: [10], recipeSelections: {} });
  assert.equal(codec.decodeFavoriteShareCode(`${code.slice(0, -1)}A`), null);
  assert.deepEqual(codec.decodeFavoriteShareCode(Number(10).toString(36).padStart(4, '0')), {
    name: '',
    itemIds: [10],
    recipeSelections: {},
    needsName: true
  });
});
