(function initPanelLayout(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PanelLayout = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function createPanelLayout() {
  'use strict';

  function finiteNonNegative(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function resolvePanelLayout(input) {
    const viewportWidth = finiteNonNegative(input.viewportWidth);
    const handleWidth = finiteNonNegative(input.handleWidth);
    const sideBySideLeftMinimum = finiteNonNegative(input.sideBySideLeftMinimum);
    const stackedLeftMinimum = Math.min(
      sideBySideLeftMinimum,
      finiteNonNegative(input.stackedLeftMinimum, sideBySideLeftMinimum)
    );
    const middleOpen = input.middleOpen === true;
    const middleMinimumWidth = middleOpen ? finiteNonNegative(input.middleMinimumWidth) : 0;
    const middlePreferredWidth = middleOpen
      ? Math.max(middleMinimumWidth, finiteNonNegative(input.middlePreferredWidth, middleMinimumWidth))
      : 0;
    const rightMinimumWidth = finiteNonNegative(input.rightMinimumWidth);
    const widthAvailableForLeft = Math.max(
      0,
      viewportWidth - handleWidth - middleMinimumWidth - rightMinimumWidth
    );
    const equipmentStacked = widthAvailableForLeft < sideBySideLeftMinimum;
    const leftMinimumWidth = equipmentStacked ? stackedLeftMinimum : sideBySideLeftMinimum;
    const leftMaximumWidth = Math.max(leftMinimumWidth, widthAvailableForLeft);
    const preferredLeftWidth = finiteNonNegative(input.preferredLeftWidth, sideBySideLeftMinimum);
    const leftWidth = clamp(preferredLeftWidth, leftMinimumWidth, leftMaximumWidth);
    const remainingWidth = Math.max(0, viewportWidth - handleWidth - leftWidth);
    const middleWidth = middleOpen
      ? clamp(remainingWidth - rightMinimumWidth, middleMinimumWidth, middlePreferredWidth)
      : 0;
    const rightWidth = Math.max(0, remainingWidth - middleWidth);

    return Object.freeze({
      equipmentStacked,
      leftMinimumWidth,
      leftMaximumWidth,
      leftWidth,
      middleWidth,
      rightWidth,
      rightBelowMinimum: rightWidth < rightMinimumWidth
    });
  }

  return Object.freeze({ resolvePanelLayout });
});
