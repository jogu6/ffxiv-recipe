import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../web/site-style-bridge.js', import.meta.url), 'utf8');
function fixture({ parentLevel = '3', storedLevel = '3', standalone = false } = {}) {
  const attributes = {};
  const events = {};
  let callback;
  let observing = false;
  const parentRoot = { getAttribute: () => parentLevel };
  const window = { addEventListener: (name, listener) => { events[name] = listener; } };
  window.parent = standalone ? window : { document: { documentElement: parentRoot } };
  vm.runInNewContext(source, {
    window, URL, URLSearchParams,
    location: { search: '?siteRoot=../..', href: 'https://example.test/app/macro-app/web/index.html' },
    document: { documentElement: { setAttribute: (name, value) => { attributes[name] = value; } },
      createElement: () => ({}), currentScript: { before() {} } },
    localStorage: { getItem: () => storedLevel },
    MutationObserver: class {
      constructor(listener) { callback = listener; }
      observe() { observing = true; }
      disconnect() { observing = false; }
    }
  });
  return { attributes, events, isObserving: () => observing,
    changeParent(value) { parentLevel = value; if (observing) callback(); },
    changeStorage(value) { storedLevel = value; events.storage({ key: 'ff14_font_size_level_v2' }); } };
}

test('embedded macro follows its parent immediately and ignores settings from another app tab', () => {
  const view = fixture({ parentLevel: '1', storedLevel: '10' });
  assert.equal(view.attributes['data-font-size-level'], '1');
  view.changeParent('10');
  assert.equal(view.attributes['data-font-size-level'], '10');
  view.changeStorage('2');
  assert.equal(view.attributes['data-font-size-level'], '10');
});

test('observer releases the parent on unload and reconnects on page restoration', () => {
  const view = fixture();
  view.events.pagehide();
  assert.equal(view.isObserving(), false);
  view.changeParent('8');
  assert.equal(view.attributes['data-font-size-level'], '3');
  view.events.pageshow();
  assert.equal(view.attributes['data-font-size-level'], '8');
  assert.equal(view.isObserving(), true);
});

test('standalone macro reads saved settings and safely normalizes invalid values', () => {
  const view = fixture({ standalone: true, storedLevel: '7' });
  assert.equal(view.attributes['data-font-size-level'], '7');
  view.changeStorage('invalid');
  assert.equal(view.attributes['data-font-size-level'], '3');
  view.changeStorage('1');
  assert.equal(view.attributes['data-font-size-level'], '1');
});
