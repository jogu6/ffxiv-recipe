const test = require('node:test');
const assert = require('node:assert/strict');
const FontSizeSettings = require('../site/font-size-settings.js');

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    value: key => values.get(key) ?? null
  };
}

test('normalizes ten font levels and keeps level 3 as the fallback', () => {
  for (let level = 1; level <= 10; level += 1) assert.equal(FontSizeSettings.normalizeLevel(level), level);
  for (const value of [null, '', 0, 11, 2.5, 'invalid']) {
    assert.equal(FontSizeSettings.normalizeLevel(value), 3);
  }
});

test('reads and writes only the dedicated local storage key', () => {
  const storage = createStorage({ [FontSizeSettings.STORAGE_KEY]: '4' });
  assert.equal(FontSizeSettings.readLevel(storage), 4);
  assert.equal(FontSizeSettings.saveLevel(10, storage), 10);
  assert.equal(storage.value(FontSizeSettings.STORAGE_KEY), '10');
});

test('requires writable local storage instead of silently falling back', () => {
  const storage = {
    setItem() {
      throw new Error('storage unavailable');
    },
    removeItem() {}
  };
  assert.throws(() => FontSizeSettings.assertStorageAvailable(storage), /storage unavailable/);
});

test('applies a normalized level to the target element', () => {
  const attributes = new Map();
  const element = { setAttribute: (name, value) => attributes.set(name, value) };
  assert.equal(FontSizeSettings.applyLevel(3, element), 3);
  assert.equal(attributes.get('data-font-size-level'), '3');
  assert.equal(FontSizeSettings.scaleForLevel(3), 1);
});

test('uses a new key and maps levels 1 through 10 from 80% through 170%', () => {
  const storage = createStorage({ ff14_font_size_level_v1: '5' });
  assert.equal(FontSizeSettings.STORAGE_KEY, 'ff14_font_size_level_v2');
  assert.equal(FontSizeSettings.readLevel(storage), 3);
  assert.deepEqual(Object.values(FontSizeSettings.SCALE_BY_LEVEL), [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7]);
});
