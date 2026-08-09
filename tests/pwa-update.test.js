const test = require("node:test");
const assert = require("node:assert/strict");
const {
  extractAppVersion,
  extractReleaseMarkdown,
  shouldShowRelease,
  updateBeforeUse,
} = require("../site/pwa-update.js");

class FakeWorker extends EventTarget {
  constructor(state = "installing") {
    super();
    this.state = state;
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

test("explicitly checks for an update without HTTP cache and waits for activation", async () => {
  const oldController = {};
  const registration = new FakeRegistration();
  const container = new FakeServiceWorkerContainer({
    controller: oldController,
    registration,
  });
  registration.update = async () => {
    const worker = new FakeWorker();
    registration.installing = worker;
    registration.dispatchEvent(new Event("updatefound"));
    queueMicrotask(() => {
      worker.transition("activated");
      container.controller = {};
      container.dispatchEvent(new Event("controllerchange"));
    });
  };

  const result = await updateBeforeUse({ serviceWorkerContainer: container });

  assert.equal(container.registerOptions.updateViaCache, "none");
  assert.deepEqual(result, {
    supported: true,
    hadController: true,
    updateApplied: true,
  });
});

test("does not block first startup while the service worker installs", async () => {
  const worker = new FakeWorker();
  const registration = new FakeRegistration({ installing: worker });
  const container = new FakeServiceWorkerContainer({ registration });
  const statuses = [];

  const result = await Promise.race([
    updateBeforeUse({
      serviceWorkerContainer: container,
      onStatus: status => statuses.push(status),
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("first startup remained blocked")), 100),
    ),
  ]);

  assert.deepEqual(result, {
    supported: true,
    hadController: false,
    updateApplied: false,
  });
  assert.deepEqual(statuses, ["更新を確認しています..."]);
});
