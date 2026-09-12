(function connectSiteStyles() {
  'use strict';

  const parameters = new URLSearchParams(location.search);
  const requestedSiteRoot = parameters.get('siteRoot');
  const siteRoot = requestedSiteRoot === '../..' ? '../..' : '../../site';
  const levelAttribute = 'data-font-size-level';
  const storageKey = 'ff14_font_size_level_v2';
  let parentRoot = null;
  try {
    if (window.parent !== window) parentRoot = window.parent.document.documentElement;
  } catch {
    // A standalone or cross-origin host uses the locally saved setting.
  }

  function syncLevel() {
    let value = parentRoot?.getAttribute(levelAttribute);
    if (value == null) {
      try { value = localStorage.getItem(storageKey); } catch { value = null; }
    }
    const storedLevel = Number(value);
    const level = Number.isInteger(storedLevel) && storedLevel >= 1 && storedLevel <= 10 ? storedLevel : 3;
    document.documentElement.setAttribute(levelAttribute, String(level));
  }

  const observer = parentRoot ? new MutationObserver(syncLevel) : null;
  function connect() {
    observer?.observe(parentRoot, { attributes: true, attributeFilter: [levelAttribute] });
    syncLevel();
  }
  connect();
  window.addEventListener('storage', event => {
    if (event.key === storageKey || event.key === null) syncLevel();
  });
  window.addEventListener('pagehide', () => observer?.disconnect());
  window.addEventListener('pageshow', connect);

  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = new URL(`${siteRoot}/styles.css`, location.href).href;
  document.currentScript.before(stylesheet);
})();
