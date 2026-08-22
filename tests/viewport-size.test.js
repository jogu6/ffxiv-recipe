const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createViewportController,
  measureViewport,
} = require("../site/viewport-size.js");

class FakeStyle {
  constructor() {
    this.values = new Map();
  }

  setProperty(name, value) {
    this.values.set(name, value);
  }

  removeProperty(name) {
    this.values.delete(name);
  }

  getPropertyValue(name) {
    return this.values.get(name) || "";
  }
}

class FakeWindow extends EventTarget {
  constructor() {
    super();
    this.innerWidth = 430;
    this.innerHeight = 800;
    this.visualViewport = new EventTarget();
    Object.assign(this.visualViewport, {
      width: 430,
      height: 720,
      offsetLeft: 0,
      offsetTop: 12,
    });
    this.document = new EventTarget();
    this.document.documentElement = {
      clientWidth: 430,
      clientHeight: 800,
      style: new FakeStyle(),
    };
    this.Event = Event;
    this.setTimeout = setTimeout;
    this.clearTimeout = clearTimeout;
    this.requestAnimationFrame = (callback) => setTimeout(callback, 0);
    this.cancelAnimationFrame = clearTimeout;
  }
}

test("uses the layout viewport until an editable control needs the keyboard viewport", () => {
  const target = new FakeWindow();
  assert.deepEqual(measureViewport(target), {
    width: 430,
    height: 800,
    layoutHeight: 800,
    visibleWidth: 430,
    visibleHeight: 720,
    visibleLeft: 0,
    visibleTop: 12,
    left: 0,
    top: 0,
    right: 430,
    bottom: 800,
    bottomInset: 68,
    useVisualViewport: false,
  });

  target.document.activeElement = { tagName: "INPUT", type: "text" };
  assert.deepEqual(measureViewport(target), {
    width: 430,
    height: 720,
    layoutHeight: 800,
    visibleWidth: 430,
    visibleHeight: 720,
    visibleLeft: 0,
    visibleTop: 12,
    left: 0,
    top: 12,
    right: 430,
    bottom: 732,
    bottomInset: 68,
    useVisualViewport: true,
  });

  target.visualViewport.height = 0;
  target.visualViewport.width = Number.NaN;
  assert.equal(measureViewport(target).height, 800);
  assert.equal(measureViewport(target).width, 430);
});

test("keeps layout and visible viewport heights separate", async () => {
  const target = new FakeWindow();
  const changes = [];
  target.addEventListener("appviewportchange", (event) =>
    changes.push(event.detail),
  );
  const controller = createViewportController(target, { delayedRefreshes: [] });
  const style = target.document.documentElement.style;

  assert.equal(style.getPropertyValue("--app-viewport-height"), "720px");
  assert.equal(style.getPropertyValue("--app-layout-viewport-height"), "800px");
  assert.equal(style.getPropertyValue("--app-viewport-width"), "430px");

  target.document.activeElement = { tagName: "INPUT", type: "text" };
  target.visualViewport.height = 460;
  target.visualViewport.dispatchEvent(new Event("resize"));
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(style.getPropertyValue("--app-viewport-height"), "460px");
  assert.equal(style.getPropertyValue("--app-layout-viewport-height"), "800px");
  assert.equal(changes.at(-1).height, 460);

  target.document.activeElement = null;
  target.document.dispatchEvent(new Event("focusout"));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(style.getPropertyValue("--app-viewport-height"), "460px");
  assert.equal(style.getPropertyValue("--app-layout-viewport-height"), "800px");
  controller.destroy();
});
