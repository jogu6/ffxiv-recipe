const test = require('node:test');
const assert = require('node:assert/strict');
const { HOLD_MS, MAX_COUNT, createStore } = require('../site/share-png-store.js');

class FakeChannel {
  static channels = [];
  constructor() { FakeChannel.channels.push(this); }
  postMessage(message) {
    FakeChannel.channels.filter(channel => channel !== this).forEach(channel => channel.onmessage?.({ data: message }));
  }
  close() { FakeChannel.channels = FakeChannel.channels.filter(channel => channel !== this); }
}

test('memory fallback validates, expires, and removes PNG records', async () => {
  let current = 1000;
  const store = await createStore({ indexedDB: null, BroadcastChannelClass: null, now: () => current });
  assert.equal(store.getMode(), 'memory');
  const blob = new Blob(['png'], { type: 'image/png' });
  await store.save({ id: 'one', blob, ownerId: 'tab', fileName: 'one.png', title: 'one' });
  assert.equal((await store.stats()).count, 1);
  assert.equal((await store.get('one')).blob.size, 3);
  current += HOLD_MS + 1;
  assert.equal(await store.get('one'), null);
  assert.equal((await store.stats()).count, 0);
});

test('temporary PNG store enforces the five image limit', async () => {
  const store = await createStore({ indexedDB: null, BroadcastChannelClass: null, now: () => 1000 });
  for (let index = 0; index < MAX_COUNT; index += 1) {
    await store.save({
      id: String(index),
      blob: new Blob(['x'], { type: 'image/png' }),
      ownerId: 'tab',
      fileName: `${index}.png`,
      title: String(index)
    });
  }
  await assert.rejects(
    store.save({ id: 'overflow', blob: new Blob(['x'], { type: 'image/png' }), ownerId: 'tab' }),
    error => error.code === 'SHARE_STORAGE_FULL'
  );
});

test('memory fallback shares retained PNG capacity across open tabs', async () => {
  FakeChannel.channels = [];
  const first = await createStore({ indexedDB: null, BroadcastChannelClass: FakeChannel, now: () => 1000 });
  await first.save({
    id: 'shared',
    blob: new Blob(['x'], { type: 'image/png' }),
    ownerId: 'one',
    fileName: 'shared.png',
    title: 'shared'
  });
  const second = await createStore({ indexedDB: null, BroadcastChannelClass: FakeChannel, now: () => 1000 });
  assert.equal((await second.stats()).count, 1);
  await second.remove('shared');
  assert.equal((await first.stats()).count, 0);
  await first.close();
  await second.close();
});

test('cold-start clear removes every retained PNG immediately', async () => {
  const store = await createStore({ indexedDB: null, BroadcastChannelClass: null, now: () => 1000 });
  await store.save({
    id: 'old',
    blob: new Blob(['x'], { type: 'image/png' }),
    ownerId: 'closed-tab',
    fileName: 'old.png',
    title: 'old'
  });
  await store.clear();
  assert.equal((await store.stats()).count, 0);
});
