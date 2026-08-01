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
    if (overlay.dataset) overlay.dataset.hapticBackdrop = 'true';
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

  function vibrateInteraction(navigatorObject = globalThis.navigator) {
    if (typeof navigatorObject?.vibrate !== 'function') return false;
    try {
      return navigatorObject.vibrate(12) === true;
    } catch {
      return false;
    }
  }

  function bindInteractionFeedback(root, navigatorObject = globalThis.navigator) {
    const selector = [
      'button:not(:disabled):not(.reorder-handle)',
      '[role="button"]',
      '[role="tab"]',
      '[role="option"]',
      'input[type="checkbox"]:not(:disabled)',
      'input[type="radio"]:not(:disabled)',
      'select:not(:disabled)',
      'summary',
      '[data-haptic-action="true"]'
    ].join(',');
    root.addEventListener(
      'click',
      event => {
        if (event.isTrusted === false) return;
        if (event.target.closest?.('#sharePlazaOverlay')) return;
        const backdrop = event.target.closest?.('[data-haptic-backdrop="true"]');
        if (backdrop && event.target === backdrop) {
          vibrateInteraction(navigatorObject);
          return;
        }
        const action = event.target.closest?.(selector);
        if (!action || action.matches?.('[aria-disabled="true"], :disabled')) return;
        vibrateInteraction(navigatorObject);
      },
      true
    );
  }

  return Object.freeze({
    bindKeyboardActivation,
    bindNumericInput,
    bindOverlayDismissal,
    bindStepButtons,
    bindInteractionFeedback,
    vibrateInteraction
  });
});
