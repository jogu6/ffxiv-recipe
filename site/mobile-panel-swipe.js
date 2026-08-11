(function initMobilePanelSwipe(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MobilePanelSwipe = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function createMobilePanelSwipeApi() {
  'use strict';

  const PANEL_ORDER = Object.freeze(['left', 'middle', 'right']);
  const WRAPPER_CLASS = 'mobile-panel-track';
  const SLIDE_CLASS = 'mobile-panel-slide';

  function availablePanelNames(middleAvailable, rightAvailable = true) {
    return PANEL_ORDER.filter(panelName =>
      panelName === 'left' ||
      (panelName === 'middle' && middleAvailable) ||
      (panelName === 'right' && rightAvailable)
    );
  }

  function createMobilePanelSwipe({
    element,
    panels,
    SwiperClass,
    isEnabled,
    reduceMotion = () => false,
    onInteractionStart = () => {},
    onLeftBoundarySwipe = () => {},
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
    let touchStartedOnLeft = false;
    let requestedSource = 'gesture';
    let suppressSlideChange = false;

    const enabled = () => (typeof isEnabled === 'function' ? isEnabled() : true);

    function setAvailableSlideClasses() {
      panels.left.classList.add(SLIDE_CLASS);
      panels.right.classList.toggle(SLIDE_CLASS, rightAvailable);
      panels.middle.classList.toggle(SLIDE_CLASS, middleAvailable);
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
      setAvailableSlideClasses();
      swiper.update();
      let targetIndex = swiper.slides.indexOf(currentElement);
      if (targetIndex < 0) {
        currentPanel = 'left';
        targetIndex = swiper.slides.indexOf(panels.left);
      }
      suppressSlideChange = true;
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
        simulateTouch: true,
        followFinger: true,
        resistanceRatio: 0.35,
        longSwipesRatio: 0.22,
        initialSlide: Math.max(0, availablePanelNames(middleAvailable, rightAvailable).indexOf(currentPanel)),
        on: {
          touchStart(instance) {
            requestedSource = 'gesture';
            touchStartedOnLeft = currentPanel === 'left' && instance?.activeIndex === 0;
            onInteractionStart();
          },
          touchEnd(instance) {
            if (touchStartedOnLeft && instance?.swipeDirection === 'prev') onLeftBoundarySwipe();
            touchStartedOnLeft = false;
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
      touchStartedOnLeft = false;
    }

    function sync({ middleOpen = middleAvailable, rightOpen = rightAvailable } = {}) {
      middleAvailable = Boolean(middleOpen);
      rightAvailable = Boolean(rightOpen);
      if (!enabled()) {
        destroy();
        return;
      }
      initialize();
      alignCurrentPanel();
    }

    function show(
      panelName,
      { animate = true, middleOpen = middleAvailable, rightOpen = rightAvailable } = {}
    ) {
      if (!PANEL_ORDER.includes(panelName)) return false;
      middleAvailable = Boolean(middleOpen);
      rightAvailable = Boolean(rightOpen);
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
      swiper.slideTo(targetIndex, duration, true);
      commitPanel(swiper);
      return true;
    }

    return Object.freeze({
      current: () => currentPanel,
      destroy,
      show,
      sync
    });
  }

  return Object.freeze({ availablePanelNames, createMobilePanelSwipe });
});
