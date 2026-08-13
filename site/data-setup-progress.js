(function initDataSetupProgress(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DataSetupProgress = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function createDataSetupProgressApi() {
  'use strict';

  function createProgressController({
    enabled,
    onChange = () => {},
    setTimer = globalThis.setTimeout,
    clearTimer = globalThis.clearTimeout,
    requestFrame = callback => globalThis.requestAnimationFrame?.(callback) ?? setTimer(callback, 0),
    now = () => globalThis.performance?.now?.() ?? Date.now(),
    progressDelayMs = 2000,
    percentDelayMs = 7000,
    completionHoldMs = 200,
    initialPhase = 'データを準備しています'
  } = {}) {
    let detailVisible = false;
    let progressVisible = false;
    let percentVisible = false;
    let phase = initialPhase;
    let percent = 0;
    let completed = false;
    let completionPromise = null;
    const startedAt = now();
    const publish = () => onChange({ detailVisible, progressVisible, percentVisible, phase, percent });
    const timers = [];
    const hide = () => {
      detailVisible = false;
      progressVisible = false;
      percentVisible = false;
      publish();
    };
    const reconcileElapsedVisibility = () => {
      if (!enabled || completed) return;
      const elapsed = Math.max(0, now() - startedAt);
      const nextProgressVisible = progressVisible || elapsed >= progressDelayMs;
      const nextPercentVisible = percentVisible || elapsed >= percentDelayMs;
      if (nextProgressVisible === progressVisible && nextPercentVisible === percentVisible) return;
      detailVisible = true;
      progressVisible = nextProgressVisible || nextPercentVisible;
      percentVisible = nextPercentVisible;
      publish();
    };

    if (enabled) {
      const showProgress = () => {
        detailVisible = true;
        progressVisible = true;
        publish();
      };
      if (progressDelayMs <= 0) showProgress();
      else timers.push(setTimer(showProgress, progressDelayMs));
      timers.push(setTimer(() => {
        detailVisible = true;
        progressVisible = true;
        percentVisible = true;
        publish();
      }, percentDelayMs));
    }

    return Object.freeze({
      report(nextPhase, nextPercent) {
        if (completed || !enabled) return;
        if (nextPhase) phase = String(nextPhase);
        const numericPercent = Number(nextPercent);
        if (Number.isFinite(numericPercent)) percent = Math.max(0, Math.min(100, Math.round(numericPercent)));
        const wasVisible = detailVisible || progressVisible;
        reconcileElapsedVisibility();
        if (wasVisible || detailVisible || progressVisible) publish();
      },
      complete() {
        if (completionPromise) return completionPromise;
        reconcileElapsedVisibility();
        completed = true;
        timers.forEach(clearTimer);
        if (!enabled || !progressVisible) {
          hide();
          completionPromise = Promise.resolve();
          return completionPromise;
        }
        percent = 100;
        publish();
        completionPromise = new Promise(resolve => {
          requestFrame(() => {
            setTimer(() => {
              hide();
              resolve();
            }, completionHoldMs);
          });
        });
        return completionPromise;
      },
      cancel() {
        if (completed) return;
        completed = true;
        timers.forEach(clearTimer);
        hide();
      }
    });
  }

  return Object.freeze({ createProgressController });
});
