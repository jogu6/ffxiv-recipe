const test = require('node:test');
const assert = require('node:assert/strict');

const { availablePanelNames, createMobilePanelSwipe } = require('../site/mobile-panel-swipe.js');

class FakeClassList {
  constructor() {
    this.values = new Set();
  }
  add(value) {
    this.values.add(value);
  }
  remove(value) {
    this.values.delete(value);
  }
  toggle(value, force) {
    if (force) this.add(value);
    else this.remove(value);
  }
  contains(value) {
    return this.values.has(value);
  }
}

function panel(name) {
  return { classList: new FakeClassList(), dataset: { mobilePanel: name } };
}

class FakeSwiper {
  constructor(element, options) {
    this.element = element;
    this.options = options;
    this.destroyed = false;
    this.update();
    this.activeIndex = options.initialSlide;
    element.swiper = this;
  }
  update() {
    this.slides = this.element.panels.filter(candidate => candidate.classList.contains(this.options.slideClass));
  }
  slideTo(index, duration, callbacks) {
    this.activeIndex = index;
    this.lastSlideTo = { index, duration, callbacks };
    if (callbacks) this.options.on.slideChange(this);
  }
  destroy() {
    this.destroyed = true;
  }
}

function fixture(overrides = {}) {
  const panels = { left: panel('left'), middle: panel('middle'), right: panel('right') };
  const element = { panels: [panels.left, panels.middle, panels.right] };
  const changes = [];
  let interactions = 0;
  const controller = createMobilePanelSwipe({
    element,
    panels,
    SwiperClass: FakeSwiper,
    isEnabled: () => true,
    onInteractionStart: () => { interactions += 1; },
    onPanelChange: (name, detail) => changes.push({ name, detail }),
    ...overrides
  });
  return { changes, controller, element, interactions: () => interactions, panels };
}

test('中央パネルがない場合は左と右だけを連続配置する', () => {
  assert.deepEqual(availablePanelNames(false), ['left', 'right']);
  assert.deepEqual(availablePanelNames(true), ['left', 'middle', 'right']);
  assert.deepEqual(availablePanelNames(false, false), ['left']);

  const { controller, element, panels } = fixture();
  controller.sync({ middleOpen: false });
  assert.deepEqual(element.swiper.slides, [panels.left, panels.right]);
  controller.sync({ middleOpen: true });
  assert.deepEqual(element.swiper.slides, [panels.left, panels.middle, panels.right]);
});

test('右パネルを無効化すると左だけを残し、再び有効化できる', () => {
  const { controller, element, panels } = fixture();
  controller.sync({ rightOpen: false });
  assert.deepEqual(element.swiper.slides, [panels.left]);
  assert.equal(controller.show('right', { rightOpen: false }), false);
  controller.sync({ rightOpen: true });
  assert.deepEqual(element.swiper.slides, [panels.left, panels.right]);
});

test('左端から外側へスワイプした時だけ境界操作を通知する', () => {
  let boundarySwipes = 0;
  const state = fixture({ onLeftBoundarySwipe: () => { boundarySwipes += 1; } });
  state.controller.sync();
  state.element.swiper.options.on.touchStart(state.element.swiper);
  state.element.swiper.swipeDirection = 'prev';
  state.element.swiper.options.on.touchEnd(state.element.swiper);
  assert.equal(boundarySwipes, 1);

  state.controller.show('right');
  state.element.swiper.options.on.touchStart(state.element.swiper);
  state.element.swiper.swipeDirection = 'prev';
  state.element.swiper.options.on.touchEnd(state.element.swiper);
  assert.equal(boundarySwipes, 1);
});

test('紹介サイトと同じ追従・スナップ設定を使用する', () => {
  const { controller, element } = fixture();
  controller.sync();
  assert.equal(element.swiper.options.speed, 360);
  assert.equal(element.swiper.options.threshold, 5);
  assert.equal(element.swiper.options.followFinger, true);
  assert.equal(element.swiper.options.resistanceRatio, 0.35);
  assert.equal(element.swiper.options.longSwipesRatio, 0.22);
  assert.equal(element.swiper.options.navigation, undefined);
  assert.equal(element.swiper.options.pagination, undefined);
});

test('アプリ操作は360msで移動し、復元と低減モーションでは即時表示する', () => {
  const normal = fixture();
  normal.controller.sync();
  assert.equal(normal.controller.show('right'), true);
  assert.equal(normal.element.swiper.lastSlideTo.duration, 360);
  assert.equal(normal.controller.current(), 'right');
  assert.equal(normal.changes.at(-1).detail.source, 'programmatic');

  assert.equal(normal.controller.show('left', { animate: false }), true);
  assert.equal(normal.element.swiper.lastSlideTo.duration, 0);

  const reduced = fixture({ reduceMotion: () => true });
  reduced.controller.sync();
  reduced.controller.show('right');
  assert.equal(reduced.element.swiper.lastSlideTo.duration, 0);
});

test('指操作によるスライド変更を現在パネルへ反映する', () => {
  const state = fixture();
  state.controller.sync();
  state.element.swiper.options.on.touchStart(state.element.swiper);
  state.element.swiper.activeIndex = 1;
  state.element.swiper.options.on.slideChange(state.element.swiper);
  assert.equal(state.interactions(), 1);
  assert.equal(state.controller.current(), 'right');
  assert.equal(state.changes.at(-1).detail.source, 'gesture');
});
