(function initShareCoordinator(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ShareCoordinator = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function createShareCoordinatorApi() {
  'use strict';

  const CHANNEL_NAME = 'xivca-share-v1';
  const LOCK_NAME = 'xivca-share-generation-v1';

  function createCoordinator({
    BroadcastChannelClass = globalThis.BroadcastChannel,
    locks = globalThis.navigator?.locks,
    now = () => Date.now(),
    ownerId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    onState = () => {}
  } = {}) {
    const channel = BroadcastChannelClass ? new BroadcastChannelClass(CHANNEL_NAME) : null;
    let state = Object.freeze({ phase: 'idle', ownerId: '', updatedAt: now() });
    let closed = false;
    let resolveHeldLock = null;

    const publish = next => {
      state = Object.freeze({ ...state, ...next, updatedAt: now() });
      onState(state);
    };
    const broadcast = next => {
      publish(next);
      channel?.postMessage({ type: 'state', state });
    };
    if (channel) {
      channel.onmessage = event => {
        if (event.data?.type === 'query' && state.phase !== 'idle') {
          channel.postMessage({ type: 'state', state });
          return;
        }
        if (event.data?.type === 'state' && event.data.state?.ownerId !== ownerId) publish(event.data.state);
      };
      channel.postMessage({ type: 'query', ownerId });
    }

    async function execute(task) {
      if (closed || state.phase !== 'idle') return { acquired: false };
      const run = async lock => {
        if (locks && !lock) return { acquired: false };
        broadcast({ phase: 'generating', ownerId });
        try {
          const value = await task({ ownerId, setPhase: phase => broadcast({ phase, ownerId }) });
          if (state.ownerId === ownerId && state.phase !== 'idle') {
            await new Promise(resolve => { resolveHeldLock = resolve; });
            resolveHeldLock = null;
          }
          return { acquired: true, value };
        } catch (error) {
          broadcast({ phase: 'idle', ownerId: '' });
          throw error;
        }
      };
      return locks?.request
        ? locks.request(LOCK_NAME, { ifAvailable: true, mode: 'exclusive' }, run)
        : run({ name: LOCK_NAME });
    }

    function ready() { broadcast({ phase: 'ready', ownerId }); }
    function sharing() { broadcast({ phase: 'sharing', ownerId }); }
    function release() {
      broadcast({ phase: 'idle', ownerId: '' });
      resolveHeldLock?.();
    }
    function close() {
      if (state.ownerId === ownerId && state.phase !== 'idle') release();
      closed = true;
      channel?.close();
    }

    return Object.freeze({ close, execute, getOwnerId: () => ownerId, getState: () => state, ready, release, sharing });
  }

  return Object.freeze({ CHANNEL_NAME, LOCK_NAME, createCoordinator });
});
