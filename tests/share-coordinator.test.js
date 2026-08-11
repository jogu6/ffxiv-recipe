const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoordinator } = require('../site/share-coordinator.js');

class FakeChannel {
  static channels = [];
  constructor() { FakeChannel.channels.push(this); }
  postMessage(message) {
    FakeChannel.channels.filter(channel => channel !== this).forEach(channel => channel.onmessage?.({ data: message }));
  }
  close() { FakeChannel.channels = FakeChannel.channels.filter(channel => channel !== this); }
}

test('coordinator broadcasts exclusive generation and ready state', async () => {
  FakeChannel.channels = [];
  const seen = [];
  const first = createCoordinator({ BroadcastChannelClass: FakeChannel, ownerId: 'one' });
  const second = createCoordinator({ BroadcastChannelClass: FakeChannel, ownerId: 'two', onState: state => seen.push(state) });
  const execution = first.execute(async () => 'png');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(seen.at(-1).phase, 'generating');
  first.ready();
  assert.equal(second.getState().phase, 'ready');
  assert.deepEqual(await second.execute(async () => 'other'), { acquired: false });
  first.release();
  assert.deepEqual(await execution, { acquired: true, value: 'png' });
  assert.equal(second.getState().phase, 'idle');
  first.close();
  second.close();
});
