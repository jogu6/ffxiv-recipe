const assert = require('node:assert/strict');
const test = require('node:test');

function eventTarget(extra = {}) {
  const listeners = new Map();
  return {
    ...extra,
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatch(type, event = {}) { listeners.get(type)?.(event); }
  };
}

test('macro launcher disables every launch button until post-startup data preparation completes', async () => {
  const previous = {
    window: global.window,
    addEventListener: global.addEventListener,
    location: global.location,
    MacroLauncher: global.MacroLauncher,
    navigator: Object.getOwnPropertyDescriptor(global, 'navigator')
  };
  global.window = global;
  const windowListeners = new Map();
  global.addEventListener = (type, listener) => windowListeners.set(type, listener);
  global.location = { origin: 'https://example.test' };
  const wakeCounters = { requests: 0, releases: 0 };
  Object.defineProperty(global, 'navigator', {
    configurable: true,
    value: {
      wakeLock: {
        async request() {
          wakeCounters.requests += 1;
          const sentinel = eventTarget({ released: false });
          sentinel.release = async () => {
            if (sentinel.released) return;
            sentinel.released = true;
            wakeCounters.releases += 1;
            sentinel.dispatch('release');
          };
          return sentinel;
        }
      }
    }
  });
  const postedMessages = [];
  const frameWindow = { postMessage(message, origin) { postedMessages.push({ message, origin }); } };
  const frame = { src: '', contentWindow: frameWindow };
  const classes = new Set();
  const appContent = { inert: false };
  const document = {
    visibilityState: 'visible',
    body: { classList: { toggle() {} } },
    querySelectorAll() { return [appContent]; },
    createElement() {
      const attributes = new Map();
      return eventTarget({
        dataset: {},
        classList: { toggle() {} },
        setAttribute(name, value) { attributes.set(name, value); },
        getAttribute(name) { return attributes.get(name); },
        removeAttribute(name) { attributes.delete(name); }
      });
    }
  };
  const panel = eventTarget({
    ownerDocument: document,
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
      toggle(name, value) { if (value) classes.add(name); else classes.delete(name); }
    }
  });
  const progressOverlay = { hidden: true };
  const progress = { value: 0 };
  const progressPercent = { value: '', textContent: '' };
  const elapsedTime = { textContent: '' };
  const generationStatus = { textContent: '' };
  let cancelFocused = false;
  const cancelButton = eventTarget({ focus() { cancelFocused = true; } });
  const closeButton = eventTarget();
  const preparing = { hidden: true, textContent: '' };
  let opened = 0;
  let closed = 0;
  let navigationDirection = '';
  try {
    delete require.cache[require.resolve('../site/macro-launcher.js')];
    require('../site/macro-launcher.js');
    const prepared = { recipes: [{}] };
    const launcher = global.MacroLauncher.create({
      panel,
      frame,
      closeButton,
      preparing,
      progressOverlay,
      progress,
      progressPercent,
      elapsedTime,
      generationStatus,
      cancelButton,
      resolveIconFile: file => `blob:${file}`,
      onOpen: () => { opened += 1; },
      onClose: () => { closed += 1; },
      onNavigate: direction => { navigationDirection = direction; },
      prepareData: async () => prepared
    });
    const launchButton = launcher.createButton('テスト中間素材', 'material-recipe');
    assert.equal(launchButton.disabled, true);
    assert.equal(launcher.open('recipe key'), false);
    assert.equal(classes.has('open'), false);
    assert.equal(launcher.showPending('recipe key', { scrollTop: 120 }), true);
    assert.equal(classes.has('open'), true);
    assert.equal(frame.hidden, true);
    assert.equal(preparing.hidden, false);
    assert.deepEqual(launcher.getState(), { open: true, recipeId: 'recipe key', scrollTop: 120 });
    launcher.close();
    await launcher.prepare({ Items: [] });
    assert.equal(launcher.isReady(), true);
    assert.equal(launchButton.disabled, false);
    assert.equal(global.MacroLauncher.getPreparedData(), prepared);
    launcher.open('recipe key');
    assert.match(frame.src, /recipe=recipe\+key/);
    assert.equal(classes.has('open'), true);
    assert.equal(frame.hidden, false);
    assert.equal(preparing.hidden, true);
    assert.equal(opened, 1);
    assert.equal(launcher.syncRecipe('recipe key'), false);
    assert.equal(opened, 1);
    const existingSource = frame.src;
    let sourceWrites = 0;
    Object.defineProperty(frame, 'src', { configurable: true, get: () => existingSource,
      set() { sourceWrites += 1; } });
    panel.getAttribute = name => name === 'aria-hidden' ? 'true' : null;
    assert.equal(launcher.open('recipe key'), false);
    assert.equal(navigationDirection, 'macro');
    assert.equal(sourceWrites, 0);
    assert.equal(opened, 1);
    navigationDirection = '';
    panel.getAttribute = () => 'false';
    assert.equal(launcher.open('recipe key'), false);
    assert.equal(navigationDirection, '');
    assert.equal(sourceWrites, 0);
    Object.defineProperty(frame, 'src', { configurable: true, writable: true, value: existingSource });
    assert.equal(launcher.syncRecipe('next recipe'), true);
    assert.match(frame.src, /recipe=next\+recipe/);
    assert.equal(opened, 2);
    closeButton.dispatch('click');
    assert.equal(classes.has('open'), false);
    assert.equal(frame.src, 'about:blank');
    assert.equal(closed, 2);
    assert.equal(launcher.syncRecipe('closed recipe'), false);
    launcher.open('recipe key');
    assert.equal(classes.has('open'), true);
    assert.equal(global.MacroLauncher.resolveIcon('item.webp'), 'blob:item.webp');
    windowListeners.get('message')({
      origin: global.location.origin,
      source: frameWindow,
      data: { source: 'xivca-macro', type: 'busy' }
    });
    assert.equal(progressOverlay.hidden, false);
    assert.equal(progressPercent.textContent, '1%');
    assert.equal(elapsedTime.textContent, '00:00');
    assert.equal(appContent.inert, true);
    assert.equal(cancelFocused, true);
    await Promise.resolve();
    assert.deepEqual(wakeCounters, { requests: 1, releases: 0 });
    windowListeners.get('pagehide')({ persisted: true });
    windowListeners.get('pageshow')({ persisted: true });
    assert.equal(progressOverlay.hidden, false);
    assert.deepEqual(wakeCounters, { requests: 1, releases: 0 });
    windowListeners.get('message')({
      origin: global.location.origin,
      source: frameWindow,
      data: { source: 'xivca-macro', type: 'progress', percent: 37 }
    });
    assert.equal(progress.value, 37);
    assert.equal(progressPercent.textContent, '37%');
    for (const count of ['50,000', '100,000']) {
      windowListeners.get('message')({
        origin: global.location.origin,
        source: frameWindow,
        data: { source: 'xivca-macro', type: 'progress', percent: 52, detail: `マクロを探索中：${count}件確認` }
      });
      assert.equal(progressPercent.textContent, '52%');
      assert.equal(generationStatus.textContent, `マクロを探索中：${count}件確認`);
    }
    cancelButton.dispatch('click');
    assert.deepEqual(postedMessages.at(-1), {
      message: { source: 'xivca-host', type: 'cancel' },
      origin: global.location.origin
    });
    windowListeners.get('message')({
      origin: global.location.origin,
      source: frameWindow,
      data: { source: 'xivca-macro', type: 'idle' }
    });
    assert.equal(progressOverlay.hidden, true);
    assert.equal(appContent.inert, false);
    await Promise.resolve();
    assert.deepEqual(wakeCounters, { requests: 1, releases: 1 });
    windowListeners.get('pageshow')({ persisted: true });
    assert.equal(progressOverlay.hidden, true);
    assert.deepEqual(wakeCounters, { requests: 1, releases: 1 });
    windowListeners.get('message')({
      origin: global.location.origin,
      source: frameWindow,
      data: { source: 'xivca-macro', type: 'busy' }
    });
    await Promise.resolve();
    windowListeners.get('pagehide')({ persisted: false });
    await Promise.resolve();
    assert.equal(progressOverlay.hidden, true);
    assert.deepEqual(wakeCounters, { requests: 2, releases: 2 });
    assert.deepEqual(postedMessages.at(-1), {
      message: { source: 'xivca-host', type: 'cancel' },
      origin: global.location.origin
    });
    windowListeners.get('message')({
      origin: global.location.origin,
      source: frameWindow,
      data: { source: 'xivca-macro', type: 'swipe', direction: 'right' }
    });
    assert.equal(navigationDirection, 'right');
    windowListeners.get('message')({
      origin: global.location.origin,
      source: frameWindow,
      data: {
        source: 'xivca-macro', type: 'scroll',
        scrollTop: 120, scrollHeight: 900, clientHeight: 600
      }
    });
    assert.deepEqual(launcher.getScrollState(), {
      scrollTop: 120, scrollHeight: 900, clientHeight: 600
    });
    let propagationStopped = false;
    launchButton.dispatch('click', { stopPropagation() { propagationStopped = true; } });
    assert.equal(launchButton.textContent, '📜');
    assert.equal(launchButton.title, 'テスト中間素材のマクロを生成');
    assert.equal(launchButton.getAttribute('aria-label'), launchButton.title);
    assert.equal(propagationStopped, true);
    assert.match(frame.src, /recipe=material-recipe/);
  } finally {
    global.window = previous.window;
    global.addEventListener = previous.addEventListener;
    global.location = previous.location;
    if (previous.navigator) Object.defineProperty(global, 'navigator', previous.navigator);
    else delete global.navigator;
    if (previous.MacroLauncher === undefined) delete global.MacroLauncher;
    else global.MacroLauncher = previous.MacroLauncher;
  }
});
