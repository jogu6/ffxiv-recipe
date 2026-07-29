const test = require('node:test');
const assert = require('node:assert/strict');
const { createFloatingWindow } = require('../site/floating-window.js');

class FakeOverlay {
  constructor() {
    this.classes = new Set();
    this.attributes = {};
    this.classList = {
      add: name => this.classes.add(name),
      remove: name => this.classes.delete(name),
      contains: name => this.classes.has(name)
    };
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }
}

test('floating windows preserve the position immediately before both open and close', () => {
  const overlay = new FakeOverlay();
  let position = 40;
  const restored = [];
  const windowController = createFloatingWindow(overlay, {
    capture: () => ({ position }),
    restore: state => restored.push(state.position)
  });

  windowController.open();
  position = 80;
  windowController.open();
  assert.equal(windowController.isOpen(), true);
  assert.equal(windowController.close(), true);
  assert.deepEqual(restored, [40, 80]);
  assert.equal(windowController.close(), false);
});

test('nested floating windows preserve current positions without restoring stale outer snapshots', () => {
  let position = 10;
  const restored = [];
  const outer = createFloatingWindow(new FakeOverlay(), {
    capture: () => position,
    restore: value => restored.push(['outer', value])
  });
  const inner = createFloatingWindow(new FakeOverlay(), {
    capture: () => position,
    restore: value => restored.push(['inner', value])
  });

  outer.open();
  position = 20;
  inner.open();
  position = 30;
  inner.close();
  outer.close();
  assert.deepEqual(restored, [
    ['outer', 10],
    ['inner', 20],
    ['inner', 30],
    ['outer', 30]
  ]);
});

test('ARIA visibility follows the open state when requested', () => {
  const overlay = new FakeOverlay();
  const windowController = createFloatingWindow(overlay, { ariaHidden: true });

  windowController.open();
  assert.equal(overlay.attributes['aria-hidden'], 'false');
  windowController.close();
  assert.equal(overlay.attributes['aria-hidden'], 'true');
});
