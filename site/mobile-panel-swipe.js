(function initMobilePanelSwipe(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MobilePanelSwipe = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function createMobilePanelSwipeApi() {
  'use strict';

  const PANEL_ORDER = Object.freeze(['left', 'middle', 'right', 'macro']);
  const WRAPPER_CLASS = 'mobile-panel-track';
  const SLIDE_CLASS = 'mobile-panel-slide';

  function availablePanelNames(middleAvailable, rightAvailable = true, macroAvailable = false) {
    return PANEL_ORDER.filter(panelName =>
      panelName === 'left' ||
      (panelName === 'middle' && middleAvailable) ||
      (panelName === 'right' && rightAvailable) ||
      (panelName === 'macro' && macroAvailable)
    );
  }

  function createMobilePanelSwipe({
    element,
    panels,
    SwiperClass,
    isEnabled,
    reduceMotion = () => false,
    onInteractionStart = () => {},
    onPanelChange = () => {}
  }) {
    if (!element || !panels || typeof SwiperClass !== 'function') {
      throw new Error('スワイプ対象、パネル、Swiperが必要です。');
    }
    for (const panelName of PANEL_ORDER) {
      if (!panels[panelName]) throw new Error(`パネルが見つかりません: ${panelName}`);
    }

    let swiper = null;
    let currentPanel = 'left';
    let middleAvailable = false;
    let rightAvailable = true;
    let macroAvailable = false;
    let requestedSource = 'gesture';
    let suppressSlideChange = false;
    let fallbackTouch = null;

    const enabled = () => (typeof isEnabled === 'function' ? isEnabled() : true);

    function availableNow() {
      return availablePanelNames(middleAvailable, rightAvailable, macroAvailable);
    }

    function installNativeTouchFallback() {
      element.addEventListener?.('touchstart', event => {
        if (!enabled() || event.touches?.length !== 1) {
          fallbackTouch = null;
          return;
        }
        const touch = event.touches[0];
        fallbackTouch = { x: touch.clientX, y: touch.clientY, panel: currentPanel };
      }, { passive: true, capture: true });
      element.addEventListener?.('touchend', event => {
        const start = fallbackTouch;
        fallbackTouch = null;
        const touch = event.changedTouches?.[0];
        if (!start || !touch) return;
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        if (Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
        setTimeout(() => {
          if (!enabled() || currentPanel !== start.panel) return;
          const available = availableNow();
          const index = available.indexOf(start.panel);
          const target = available[index + (dx < 0 ? 1 : -1)];
          if (target) show(target, { animate: true });
        }, 0);
      }, { passive: true, capture: true });
      element.addEventListener?.('touchcancel', () => { fallbackTouch = null; }, { passive: true, capture: true });
    }

    function setAvailableSlideClasses() {
      panels.left.classList.add(SLIDE_CLASS);
      panels.right.classList.toggle(SLIDE_CLASS, rightAvailable);
      panels.middle.classList.toggle(SLIDE_CLASS, middleAvailable);
      panels.macro.classList.toggle(SLIDE_CLASS, macroAvailable);
    }

    function removeSlideClasses() {
      PANEL_ORDER.forEach(panelName => panels[panelName].classList.remove(SLIDE_CLASS));
    }

    function panelNameAt(index, instance = swiper) {
      return instance?.slides?.[index]?.dataset.mobilePanel || '';
    }

    function commitPanel(instance = swiper) {
      if (suppressSlideChange) return;
      const panelName = panelNameAt(instance?.activeIndex, instance);
      if (!PANEL_ORDER.includes(panelName) || panelName === currentPanel) return;
      currentPanel = panelName;
      onPanelChange(panelName, { source: requestedSource });
      requestedSource = 'gesture';
    }

    function alignCurrentPanel() {
      if (!swiper) return;
      const previousPanel = currentPanel;
      const currentElement = panels[currentPanel];
      suppressSlideChange = true;
      setAvailableSlideClasses();
      swiper.update();
      swiper.allowSlidePrev = currentPanel !== 'left';
      const available = availablePanelNames(middleAvailable, rightAvailable, macroAvailable);
      swiper.allowSlideNext = currentPanel !== available.at(-1);
      let targetIndex = swiper.slides.indexOf(currentElement);
      if (targetIndex < 0) {
        currentPanel = 'left';
        targetIndex = swiper.slides.indexOf(panels.left);
      }
      swiper.slideTo(Math.max(0, targetIndex), 0, false);
      suppressSlideChange = false;
      if (currentPanel !== previousPanel) onPanelChange(currentPanel, { source: 'sync' });
    }

    function initialize() {
      if (swiper || !enabled()) return;
      setAvailableSlideClasses();
      swiper = new SwiperClass(element, {
        wrapperClass: WRAPPER_CLASS,
        slideClass: SLIDE_CLASS,
        slidesPerView: 1,
        slidesPerGroup: 1,
        speed: 360,
        threshold: 5,
        touchEventsTarget: 'container',
        simulateTouch: true,
        followFinger: true,
        resistanceRatio: 0.35,
        longSwipesRatio: 0.22,
        initialSlide: Math.max(0, availablePanelNames(middleAvailable, rightAvailable, macroAvailable).indexOf(currentPanel)),
        on: {
          touchStart(instance, event) {
            requestedSource = 'gesture';
            onInteractionStart();
          },
          slideChange(instance) {
            commitPanel(instance);
          }
        }
      });
      alignCurrentPanel();
    }

    function destroy() {
      if (swiper) swiper.destroy(true, true);
      swiper = null;
      removeSlideClasses();
      requestedSource = 'gesture';
      suppressSlideChange = false;
    }

    function sync({
      middleOpen = middleAvailable,
      rightOpen = rightAvailable,
      macroOpen = macroAvailable
    } = {}) {
      middleAvailable = Boolean(middleOpen);
      rightAvailable = Boolean(rightOpen);
      macroAvailable = Boolean(macroOpen);
      if (!enabled()) {
        destroy();
        return;
      }
      initialize();
      alignCurrentPanel();
    }

    function show(
      panelName,
      {
        animate = true,
        middleOpen = middleAvailable,
        rightOpen = rightAvailable,
        macroOpen = macroAvailable
      } = {}
    ) {
      if (!PANEL_ORDER.includes(panelName)) return false;
      middleAvailable = Boolean(middleOpen);
      rightAvailable = Boolean(rightOpen);
      macroAvailable = Boolean(macroOpen);
      if (!enabled()) return false;
      initialize();
      alignCurrentPanel();
      const targetIndex = swiper.slides.indexOf(panels[panelName]);
      if (targetIndex < 0) return false;
      if (panelName === currentPanel) {
        onPanelChange(panelName, { source: 'programmatic', changed: false });
        return true;
      }
      onInteractionStart();
      requestedSource = 'programmatic';
      const duration = animate && !reduceMotion() ? 360 : 0;
      swiper.setTransition?.(0);
      swiper.animating = false;
      swiper.allowSlidePrev = true;
      swiper.allowSlideNext = true;
      suppressSlideChange = true;
      swiper.slideTo(targetIndex, duration, true);
      suppressSlideChange = false;
      currentPanel = panelName;
      onPanelChange(panelName, { source: requestedSource });
      requestedSource = 'gesture';
      return true;
    }

    installNativeTouchFallback();

    return Object.freeze({
      current: () => currentPanel,
      destroy,
      show,
      sync
    });
  }

  return Object.freeze({ availablePanelNames, createMobilePanelSwipe });
});
