(function initFloatingWindow(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FloatingWindow = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function createFloatingWindowModule() {
  'use strict';

  function createFloatingWindow(
    overlay,
    { capture = () => null, restore = () => {}, schedule = callback => callback(), ariaHidden = false } = {}
  ) {
    function isOpen() {
      return overlay.classList.contains('open');
    }

    function open() {
      if (isOpen()) return false;
      const snapshot = capture();
      overlay.classList.add('open');
      if (ariaHidden) overlay.setAttribute('aria-hidden', 'false');
      if (snapshot !== null) schedule(() => restore(snapshot));
      return true;
    }

    function close() {
      if (!isOpen()) return false;
      const snapshot = capture();
      overlay.classList.remove('open');
      if (ariaHidden) overlay.setAttribute('aria-hidden', 'true');
      if (snapshot !== null) schedule(() => restore(snapshot));
      return true;
    }

    return Object.freeze({ close, isOpen, open });
  }

  return Object.freeze({ createFloatingWindow });
});
