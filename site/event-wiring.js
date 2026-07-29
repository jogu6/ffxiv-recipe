(function initEventWiring(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EventWiring = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function createEventWiring() {
  'use strict';

  function bindKeyboardActivation(element, activate) {
    element.addEventListener('click', activate);
    element.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      activate();
    });
  }

  function bindOverlayDismissal(overlay, close, closeButton = null) {
    closeButton?.addEventListener('click', close);
    overlay.addEventListener('click', event => {
      if (event.target === overlay) close();
    });
  }

  function bindNumericInput(input, { onInput, onCommit }) {
    input.addEventListener('input', onInput);
    input.addEventListener('blur', onCommit);
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') input.blur();
    });
  }

  function bindStepButtons(steps, change) {
    steps.forEach(([button, delta]) => button.addEventListener('click', () => change(delta)));
  }

  return Object.freeze({
    bindKeyboardActivation,
    bindNumericInput,
    bindOverlayDismissal,
    bindStepButtons
  });
});
