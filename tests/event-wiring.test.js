const test = require('node:test');
const assert = require('node:assert/strict');
const {
  bindKeyboardActivation,
  bindNumericInput,
  bindOverlayDismissal,
  bindStepButtons,
  vibrateInteraction
} = require('../site/event-wiring.js');

class FakeElement {
  constructor() {
    this.listeners = {};
    this.blurCount = 0;
  }

  addEventListener(name, listener) {
    (this.listeners[name] ||= []).push(listener);
  }

  emit(name, values = {}) {
    const event = { target: this, preventDefault() {}, ...values };
    (this.listeners[name] || []).forEach(listener => listener(event));
  }

  blur() {
    this.blurCount += 1;
    this.emit('blur');
  }
}

test('keyboard activation accepts click, Enter, and Space only', () => {
  const element = new FakeElement();
  let activations = 0;
  bindKeyboardActivation(element, () => {
    activations += 1;
  });
  element.emit('click');
  element.emit('keydown', { key: 'Escape' });
  element.emit('keydown', { key: 'Enter' });
  element.emit('keydown', { key: ' ' });
  assert.equal(activations, 3);
});

test('overlay dismissal accepts its close button and backdrop but not dialog content', () => {
  const overlay = new FakeElement();
  const closeButton = new FakeElement();
  let closes = 0;
  bindOverlayDismissal(overlay, () => {
    closes += 1;
  }, closeButton);
  closeButton.emit('click');
  overlay.emit('click');
  overlay.emit('click', { target: new FakeElement() });
  assert.equal(closes, 2);
});

test('numeric inputs separate live input and committed blur and commit Enter through blur', () => {
  const input = new FakeElement();
  let inputs = 0;
  let commits = 0;
  bindNumericInput(input, {
    onInput: () => {
      inputs += 1;
    },
    onCommit: () => {
      commits += 1;
    }
  });
  input.emit('input');
  input.emit('keydown', { key: 'Escape' });
  input.emit('keydown', { key: 'Enter' });
  assert.equal(inputs, 1);
  assert.equal(commits, 1);
  assert.equal(input.blurCount, 1);
});

test('step buttons retain their declared deltas', () => {
  const down = new FakeElement();
  const up = new FakeElement();
  const changes = [];
  bindStepButtons(
    [
      [down, -5],
      [up, 1]
    ],
    delta => changes.push(delta)
  );
  down.emit('click');
  up.emit('click');
  assert.deepEqual(changes, [-5, 1]);
});

test('interaction vibration is short and safely ignored when unsupported or rejected', () => {
  const patterns = [];
  assert.equal(vibrateInteraction({ vibrate: value => (patterns.push(value), true) }), true);
  assert.deepEqual(patterns, [12]);
  assert.equal(vibrateInteraction({}), false);
  assert.equal(
    vibrateInteraction({
      vibrate() {
        throw new Error('blocked');
      }
    }),
    false
  );
});
