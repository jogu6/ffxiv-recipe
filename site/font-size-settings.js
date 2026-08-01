(function initFontSizeSettings(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.FontSizeSettings = api;
    api.assertStorageAvailable();
    api.applyLevel(api.readLevel());
  }
})(typeof globalThis === 'undefined' ? this : globalThis, function createFontSizeSettings() {
  'use strict';

  const STORAGE_KEY = 'ff14_font_size_level_v2';
  const DEFAULT_LEVEL = 3;
  const MIN_LEVEL = 1;
  const MAX_LEVEL = 10;
  const SCALE_BY_LEVEL = Object.freeze({
    1: 0.8,
    2: 0.9,
    3: 1,
    4: 1.1,
    5: 1.2,
    6: 1.3,
    7: 1.4,
    8: 1.5,
    9: 1.6,
    10: 1.7
  });
  const STORAGE_TEST_KEY = `${STORAGE_KEY}_test`;

  function assertStorageAvailable(storage = globalThis.localStorage) {
    storage.setItem(STORAGE_TEST_KEY, '1');
    storage.removeItem(STORAGE_TEST_KEY);
  }

  function normalizeLevel(value) {
    const level = Number(value);
    return Number.isInteger(level) && level >= MIN_LEVEL && level <= MAX_LEVEL ? level : DEFAULT_LEVEL;
  }

  function readLevel(storage = globalThis.localStorage) {
    return normalizeLevel(storage.getItem(STORAGE_KEY));
  }

  function saveLevel(level, storage = globalThis.localStorage) {
    const normalized = normalizeLevel(level);
    storage.setItem(STORAGE_KEY, String(normalized));
    return normalized;
  }

  function applyLevel(level, element = globalThis.document?.documentElement) {
    const normalized = normalizeLevel(level);
    element?.setAttribute('data-font-size-level', String(normalized));
    return normalized;
  }

  function scaleForLevel(level) {
    return SCALE_BY_LEVEL[normalizeLevel(level)];
  }

  return Object.freeze({
    DEFAULT_LEVEL,
    MAX_LEVEL,
    MIN_LEVEL,
    SCALE_BY_LEVEL,
    STORAGE_KEY,
    applyLevel,
    assertStorageAvailable,
    normalizeLevel,
    readLevel,
    saveLevel,
    scaleForLevel
  });
});
