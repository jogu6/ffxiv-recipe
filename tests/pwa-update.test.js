const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createForegroundUpdateChecker,
  extractAppVersion,
  extractReleaseMarkdown,
  shouldShowRelease,
} = require("../site/pwa-update.js");

class FakeWorker extends EventTarget {
  constructor(state = "installing") {
    super();
    this.state = state;
    this.messages = [];
  }

  postMessage(message) {
    this.messages.push(message);
  }

  transition(state) {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}

class FakeRegistration extends EventTarget {
  constructor({
    installing = null,
    waiting = null,
    update = async () => {},
  } = {}) {
    super();
    this.installing = installing;
    this.waiting = waiting;
    this.update = update;
  }
}

class FakeServiceWorkerContainer extends EventTarget {
  constructor({ controller = null, registration }) {
    super();
    this.controller = controller;
    this.registration = registration;
    this.registerOptions = null;
  }

  async register(_scriptUrl, options) {
    this.registerOptions = options;
    return this.registration;
  }
}

test("extracts the published app version, preceding notices, and only its release section", () => {
  const source =
    "const APP_CACHE_VERSION = 'ff14recipe-app-20260808-v3.0';";
  const tips = `**重要なお知らせ**

---

## v3.0 リリース

- 今回の変更

---

## v2.971 リリース

- 以前の変更`;

  assert.equal(extractAppVersion(source), "v3.0");
  assert.equal(
    extractReleaseMarkdown(tips, "v3.0"),
    "**重要なお知らせ**\n\n---\n\n## v3.0 リリース\n\n- 今回の変更",
  );
  assert.equal(extractReleaseMarkdown(tips, "v9.9"), "");

  const compactHeadingTips = `**重要なお知らせ**

---

## v3.01リリース

- 空白なし見出しの変更`;
  assert.equal(
    extractReleaseMarkdown(compactHeadingTips, "v3.01"),
    "**重要なお知らせ**\n\n---\n\n## v3.01リリース\n\n- 空白なし見出しの変更",
  );
});

test("shows a release only for an existing installation or an update reload", () => {
  assert.equal(
    shouldShowRelease({
      currentVersion: "v3.0",
      acknowledgedVersion: "",
      hadController: false,
      updateReloadPending: false,
    }),
    false,
  );
  assert.equal(
    shouldShowRelease({
      currentVersion: "v3.0",
      acknowledgedVersion: "",
      hadController: true,
      updateReloadPending: false,
    }),
    true,
  );
  assert.equal(
    shouldShowRelease({
      currentVersion: "v3.0",
      acknowledgedVersion: "v2.97",
      hadController: false,
      updateReloadPending: true,
    }),
    true,
  );
  assert.equal(
    shouldShowRelease({
      currentVersion: "v3.0",
      acknowledgedVersion: "v3.0",
      hadController: true,
      updateReloadPending: true,
    }),
    false,
  );
});

test("foreground update scheduling returns immediately and rejects duplicates while a check is running", async () => {
  let updateCalls = 0;
  const registration = new FakeRegistration({
    update: () => {
      updateCalls += 1;
      return new Promise(() => {});
    },
  });
  const container = new FakeServiceWorkerContainer({ controller: {}, registration });
  const checker = createForegroundUpdateChecker({
    serviceWorkerContainer: container,
    coalesceMs: 0,
  });

  const started = performance.now();
  assert.equal(checker.schedule(), true);
  assert.ok(performance.now() - started < 10);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(updateCalls, 1);

  assert.equal(checker.schedule(), false);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(updateCalls, 1);
  checker.close();
});

test("foreground checker suppresses completed checks during the coalescing interval", async () => {
  let updateCalls = 0;
  let currentTime = 1000;
  const registration = new FakeRegistration({
    update: async () => {
      updateCalls += 1;
    },
  });
  const container = new FakeServiceWorkerContainer({ controller: {}, registration });
  const checker = createForegroundUpdateChecker({
    serviceWorkerContainer: container,
    coalesceMs: 5000,
    now: () => currentTime,
  });

  assert.equal(checker.schedule(), true);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(checker.schedule(), false);
  assert.equal(updateCalls, 1);

  currentTime += 5000;
  assert.equal(checker.schedule(), true);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(updateCalls, 2);
  checker.close();
});

test("foreground checker leaves an installed update waiting while the current app is open", async () => {
  const worker = new FakeWorker();
  const registration = new FakeRegistration({
    update: async () => {
      registration.installing = worker;
      registration.dispatchEvent(new Event("updatefound"));
    },
  });
  const container = new FakeServiceWorkerContainer({ controller: {}, registration });
  let applied = 0;
  const checker = createForegroundUpdateChecker({
    serviceWorkerContainer: container,
    coalesceMs: 0,
    onUpdateApplied: () => { applied += 1; },
  });

  checker.schedule();
  await new Promise(resolve => setTimeout(resolve, 10));
  worker.transition("installed");
  assert.deepEqual(worker.messages, []);
  assert.equal(applied, 0);
  checker.close();
});

test("foreground checker does not reload for the first service-worker installation", async () => {
  const registration = new FakeRegistration();
  const container = new FakeServiceWorkerContainer({ registration });
  let applied = 0;
  const checker = createForegroundUpdateChecker({
    serviceWorkerContainer: container,
    coalesceMs: 0,
    onUpdateApplied: () => { applied += 1; },
  });

  checker.schedule();
  await new Promise(resolve => setTimeout(resolve, 10));
  container.controller = {};
  container.dispatchEvent(new Event("controllerchange"));
  assert.equal(applied, 0);
  checker.close();
});
