const assert = require('node:assert/strict');
const test = require('node:test');

const ApplicationDataCache = require('../site/application-data-cache.js');

test('application data cache falls back safely when IndexedDB is unavailable', async () => {
  assert.equal(await ApplicationDataCache.load('generation-a', null), null);
  assert.equal(await ApplicationDataCache.save('generation-a', { recipes: {} }, null), false);
});

test('application data cache ignores empty cache keys and data', async () => {
  const shouldNotOpen = { open: () => assert.fail('IndexedDB should not be opened') };
  assert.equal(await ApplicationDataCache.load('', shouldNotOpen), null);
  assert.equal(await ApplicationDataCache.save('', { recipes: {} }, shouldNotOpen), false);
  assert.equal(await ApplicationDataCache.save('generation-a', null, shouldNotOpen), false);
});
