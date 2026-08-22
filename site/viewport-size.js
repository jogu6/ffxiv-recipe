(function initViewportSize(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
    return;
  }
  root.AppViewport = api;
  if (root.document && root.ff14RecipeBrowserSupported !== false) {
    root.appViewport = api.createViewportController(root);
  }
})(
  typeof globalThis === "undefined" ? this : globalThis,
  function createViewportSizeApi() {
    "use strict";

    const CSS_HEIGHT_PROPERTY = "--app-viewport-height";
    const CSS_LAYOUT_HEIGHT_PROPERTY = "--app-layout-viewport-height";
    const CSS_WIDTH_PROPERTY = "--app-viewport-width";
    const CHANGE_EVENT = "appviewportchange";

    function positiveNumber(value) {
      const number = Number(value);
      return Number.isFinite(number) && number > 0 ? number : 0;
    }

    function finiteNumber(value) {
      const number = Number(value);
      return Number.isFinite(number) ? number : 0;
    }

    function resolveDimension(primary, fallback) {
      const primaryValue = positiveNumber(primary);
      const fallbackValue = positiveNumber(fallback);
      if (primaryValue && fallbackValue)
        return Math.min(primaryValue, fallbackValue);
      return primaryValue || fallbackValue;
    }

    function usesOnScreenKeyboardViewport(target) {
      const activeElement = target?.document?.activeElement;
      if (!activeElement) return false;
      if (activeElement.isContentEditable) return true;
      const tagName = String(activeElement.tagName || "").toLowerCase();
      if (tagName === "textarea") return true;
      if (tagName !== "input") return false;
      return ![
        "button",
        "checkbox",
        "color",
        "file",
        "hidden",
        "image",
        "radio",
        "range",
        "reset",
        "submit",
      ].includes(String(activeElement.type || "text").toLowerCase());
    }

    function measureViewport(target) {
      const visualViewport = target?.visualViewport;
      const documentElement = target?.document?.documentElement;
      const innerWidth =
        positiveNumber(target?.innerWidth) ||
        positiveNumber(documentElement?.clientWidth);
      const innerHeight =
        positiveNumber(target?.innerHeight) ||
        positiveNumber(documentElement?.clientHeight);
      const visualWidth = positiveNumber(visualViewport?.width);
      const visualHeight = positiveNumber(visualViewport?.height);
      const visualTop = finiteNumber(visualViewport?.offsetTop);
      const visualLeft = finiteNumber(visualViewport?.offsetLeft);
      const visibleWidth = resolveDimension(visualWidth, innerWidth);
      const visibleHeight = resolveDimension(visualHeight, innerHeight);
      const useVisualViewport =
        usesOnScreenKeyboardViewport(target) ||
        (positiveNumber(visualViewport?.scale) || 1) !== 1;
      const width = useVisualViewport
        ? resolveDimension(visualWidth, innerWidth)
        : innerWidth || visualWidth;
      const height = useVisualViewport
        ? resolveDimension(visualHeight, innerHeight)
        : innerHeight || visualHeight;
      const left = useVisualViewport
        ? finiteNumber(visualViewport?.offsetLeft)
        : 0;
      const top = useVisualViewport ? visualTop : 0;
      const bottomInset =
        innerHeight && visualHeight
          ? Math.max(0, innerHeight - (visualTop + visualHeight))
          : 0;

      return Object.freeze({
        width,
        height,
        layoutHeight: innerHeight || height,
        visibleWidth: visibleWidth || width,
        visibleHeight: visibleHeight || height,
        visibleLeft: visualWidth ? visualLeft : 0,
        visibleTop: visualHeight ? visualTop : 0,
        left,
        top,
        right: left + width,
        bottom: top + height,
        bottomInset,
        useVisualViewport,
      });
    }

    function sameViewport(first, second) {
      return Boolean(
        first &&
        second &&
        first.width === second.width &&
        first.height === second.height &&
        first.layoutHeight === second.layoutHeight &&
        first.visibleWidth === second.visibleWidth &&
        first.visibleHeight === second.visibleHeight &&
        first.visibleLeft === second.visibleLeft &&
        first.visibleTop === second.visibleTop &&
        first.left === second.left &&
        first.top === second.top &&
        first.bottomInset === second.bottomInset &&
        first.useVisualViewport === second.useVisualViewport,
      );
    }

    function createViewportController(
      target,
      { delayedRefreshes = [80, 320] } = {},
    ) {
      const documentElement = target?.document?.documentElement;
      if (!target || !documentElement) {
        return Object.freeze({
          destroy() {},
          measure: () => measureViewport(target),
          refresh: () => measureViewport(target),
          schedule: () => false,
        });
      }

      const listeners = [];
      const timers = new Set();
      let frame = 0;
      let current = null;
      let destroyed = false;

      const listen = (eventTarget, name, listener, options) => {
        if (!eventTarget?.addEventListener) return;
        eventTarget.addEventListener(name, listener, options);
        listeners.push(() =>
          eventTarget.removeEventListener(name, listener, options),
        );
      };

      const dispatchChange = (metrics) => {
        if (!target.dispatchEvent) return;
        const EventConstructor = target.CustomEvent || target.Event;
        if (typeof EventConstructor !== "function") return;
        const event = target.CustomEvent
          ? new EventConstructor(CHANGE_EVENT, { detail: metrics })
          : new EventConstructor(CHANGE_EVENT);
        if (!("detail" in event))
          Object.defineProperty(event, "detail", { value: metrics });
        target.dispatchEvent(event);
      };

      const refresh = () => {
        frame = 0;
        if (destroyed) return current || measureViewport(target);
        const next = measureViewport(target);
        if (next.layoutHeight > 0) {
          documentElement.style.setProperty(
            CSS_LAYOUT_HEIGHT_PROPERTY,
            `${next.layoutHeight}px`,
          );
        }
        if (next.visibleHeight > 0) {
          documentElement.style.setProperty(
            CSS_HEIGHT_PROPERTY,
            `${next.visibleHeight}px`,
          );
        }
        if (next.visibleWidth > 0)
          documentElement.style.setProperty(
            CSS_WIDTH_PROPERTY,
            `${next.visibleWidth}px`,
          );
        if (!sameViewport(current, next)) {
          current = next;
          dispatchChange(next);
        }
        return next;
      };

      const schedule = () => {
        if (destroyed || frame) return false;
        const requestFrame =
          target.requestAnimationFrame ||
          ((callback) => target.setTimeout(callback, 0));
        frame = requestFrame(refresh);
        return true;
      };

      const scheduleDelayedRefreshes = () => {
        schedule();
        timers.forEach((timer) => target.clearTimeout(timer));
        timers.clear();
        delayedRefreshes.forEach((delay) => {
          const timer = target.setTimeout(() => {
            timers.delete(timer);
            schedule();
          }, delay);
          timers.add(timer);
        });
      };

      listen(target, "resize", scheduleDelayedRefreshes);
      listen(target, "orientationchange", scheduleDelayedRefreshes);
      listen(target, "pageshow", scheduleDelayedRefreshes);
      listen(target.visualViewport, "resize", scheduleDelayedRefreshes);
      listen(target.visualViewport, "scroll", scheduleDelayedRefreshes);
      listen(target.document, "focusin", scheduleDelayedRefreshes);
      listen(target.document, "focusout", scheduleDelayedRefreshes);

      refresh();

      const destroy = () => {
        if (destroyed) return;
        destroyed = true;
        listeners.splice(0).forEach((remove) => remove());
        timers.forEach((timer) => target.clearTimeout(timer));
        timers.clear();
        if (frame)
          (target.cancelAnimationFrame || target.clearTimeout)?.call(
            target,
            frame,
          );
        frame = 0;
      };

      return Object.freeze({
        destroy,
        measure: () => measureViewport(target),
        refresh,
        schedule,
      });
    }

    return Object.freeze({
      CHANGE_EVENT,
      CSS_HEIGHT_PROPERTY,
      CSS_LAYOUT_HEIGHT_PROPERTY,
      CSS_WIDTH_PROPERTY,
      createViewportController,
      measureViewport,
    });
  },
);
