(function initPwaUpdate(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PwaUpdate = api;
})(
  typeof globalThis === "undefined" ? this : globalThis,
  function createPwaUpdate() {
    "use strict";

    const ACKNOWLEDGED_VERSION_KEY = "ff14_acknowledged_release_version";
    const UPDATE_RELOAD_PENDING_KEY = "ff14_update_reload_pending";
    const TERMINAL_WORKER_STATES = new Set(["activated", "redundant"]);

    function extractAppVersion(workerSource) {
      const match = String(workerSource || "").match(
        /const\s+APP_CACHE_VERSION\s*=\s*['"][^'"]*?(v\d+(?:\.\d+)*)[^'"]*['"]/i,
      );
      return match ? match[1] : "";
    }

    function escapeRegularExpression(value) {
      return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function extractReleaseMarkdown(tipsMarkdown, version) {
      if (!version) return "";
      const normalized = String(tipsMarkdown || "").replace(/\r\n?/g, "\n");
      const headingPattern = new RegExp(
        `^##[ \\t]+${escapeRegularExpression(version)}[ \\t]*リリース[ \\t]*$`,
        "m",
      );
      const heading = headingPattern.exec(normalized);
      if (!heading) return "";

      const remainder = normalized.slice(heading.index);
      const end = remainder.search(/\n(?:---\s*|##\s+v\d)/);
      const currentRelease = end < 0 ? remainder : remainder.slice(0, end);
      return `${normalized.slice(0, heading.index)}${currentRelease}`.trim();
    }

    function shouldShowRelease({
      currentVersion,
      acknowledgedVersion,
      hadController,
      updateReloadPending,
    }) {
      if (!currentVersion || acknowledgedVersion === currentVersion)
        return false;
      return Boolean(hadController || updateReloadPending);
    }

    function waitForWorkerTerminalState(worker) {
      if (!worker || TERMINAL_WORKER_STATES.has(worker.state)) {
        return Promise.resolve(worker?.state || "");
      }
      return new Promise((resolve) => {
        const handleStateChange = () => {
          if (!TERMINAL_WORKER_STATES.has(worker.state)) return;
          worker.removeEventListener("statechange", handleStateChange);
          resolve(worker.state);
        };
        worker.addEventListener("statechange", handleStateChange);
      });
    }

    async function updateBeforeUse({
      serviceWorkerContainer,
      scriptUrl = "./sw.js",
      onStatus = () => {},
      logger = globalThis.console,
    } = {}) {
      if (!serviceWorkerContainer) {
        return { supported: false, hadController: false, updateApplied: false };
      }

      const initialController = serviceWorkerContainer.controller;
      const hadController = Boolean(initialController);
      let controllerChanged = false;
      const handleControllerChange = () => {
        controllerChanged = true;
      };
      serviceWorkerContainer.addEventListener(
        "controllerchange",
        handleControllerChange,
      );

      try {
        onStatus("更新を確認しています...");
        const registration = await serviceWorkerContainer.register(scriptUrl, {
          updateViaCache: "none",
        });
        let discoveredWorker =
          registration.installing || registration.waiting || null;
        const handleUpdateFound = () => {
          discoveredWorker = registration.installing || discoveredWorker;
        };
        registration.addEventListener("updatefound", handleUpdateFound);

        let updateError = null;
        if (!discoveredWorker) {
          try {
            await registration.update();
          } catch (error) {
            updateError = error;
          }
          discoveredWorker =
            discoveredWorker ||
            registration.installing ||
            registration.waiting ||
            null;
        }

        let workerState = "";
        if (discoveredWorker && hadController) {
          onStatus("更新を適用しています...");
          if (discoveredWorker.state === "installed") {
            discoveredWorker.postMessage?.({ type: "SKIP_WAITING" });
          }
          workerState = await waitForWorkerTerminalState(discoveredWorker);
        }
        registration.removeEventListener("updatefound", handleUpdateFound);

        if (updateError && !discoveredWorker) {
          logger?.warn?.("[SW] 更新確認失敗:", updateError);
        }

        return {
          supported: true,
          hadController,
          updateApplied:
            hadController && (controllerChanged || workerState === "activated"),
        };
      } catch (error) {
        logger?.warn?.("[SW] 登録失敗:", error);
        return { supported: true, hadController, updateApplied: false, error };
      } finally {
        serviceWorkerContainer.removeEventListener(
          "controllerchange",
          handleControllerChange,
        );
      }
    }

    function createForegroundUpdateChecker({
      serviceWorkerContainer,
      scriptUrl = "./sw.js",
      coalesceMs = 5000,
      onUpdateApplied = () => {},
      logger = globalThis.console,
      now = () => Date.now(),
      setTimer = (callback, delay) => setTimeout(callback, delay),
      clearTimer = timer => clearTimeout(timer),
    } = {}) {
      if (!serviceWorkerContainer) {
        return Object.freeze({ schedule: () => false, close: () => {} });
      }

      const hadController = Boolean(serviceWorkerContainer.controller);
      const observedWorkers = new WeakSet();
      let registration = null;
      let registrationUpdateFound = null;
      let scheduledTimer = null;
      let lastStartedAt = Number.NEGATIVE_INFINITY;
      let checkInProgress = false;
      let updateApplied = false;
      let closed = false;

      const applyUpdateOnce = () => {
        if (!hadController || updateApplied || closed) return;
        updateApplied = true;
        onUpdateApplied();
      };

      const observeWorker = worker => {
        if (!worker || observedWorkers.has(worker)) return;
        observedWorkers.add(worker);
        const handleStateChange = () => {
          if (worker.state === "installed") worker.postMessage?.({ type: "SKIP_WAITING" });
          if (worker.state === "activated") applyUpdateOnce();
          if (TERMINAL_WORKER_STATES.has(worker.state)) {
            worker.removeEventListener("statechange", handleStateChange);
          }
        };
        worker.addEventListener("statechange", handleStateChange);
        handleStateChange();
      };

      const observeRegistration = nextRegistration => {
        if (!nextRegistration) return;
        if (registration !== nextRegistration) {
          if (registration && registrationUpdateFound) {
            registration.removeEventListener("updatefound", registrationUpdateFound);
          }
          registration = nextRegistration;
          registrationUpdateFound = () => observeWorker(registration.installing || registration.waiting);
          registration.addEventListener("updatefound", registrationUpdateFound);
        }
        observeWorker(registration.installing);
        observeWorker(registration.waiting);
      };

      const runCheck = async () => {
        if (closed || checkInProgress) return;
        checkInProgress = true;
        lastStartedAt = now();
        try {
          const currentRegistration = registration || await serviceWorkerContainer.register(scriptUrl, {
            updateViaCache: "none",
          });
          if (closed) return;
          observeRegistration(currentRegistration);
          await currentRegistration.update();
          if (!closed) observeRegistration(currentRegistration);
        } catch (error) {
          logger?.warn?.("[SW] バックグラウンド更新確認失敗:", error);
        } finally {
          checkInProgress = false;
        }
      };

      const schedule = () => {
        if (closed || scheduledTimer !== null || checkInProgress) return false;
        const elapsed = now() - lastStartedAt;
        if (Number.isFinite(elapsed) && elapsed < coalesceMs) return false;
        scheduledTimer = setTimer(() => {
          scheduledTimer = null;
          void runCheck();
        }, 0);
        return true;
      };

      const handleControllerChange = () => applyUpdateOnce();
      serviceWorkerContainer.addEventListener("controllerchange", handleControllerChange);

      const close = () => {
        if (closed) return;
        closed = true;
        if (scheduledTimer !== null) clearTimer(scheduledTimer);
        scheduledTimer = null;
        serviceWorkerContainer.removeEventListener("controllerchange", handleControllerChange);
        if (registration && registrationUpdateFound) {
          registration.removeEventListener("updatefound", registrationUpdateFound);
        }
      };

      return Object.freeze({ close, schedule });
    }

    return Object.freeze({
      ACKNOWLEDGED_VERSION_KEY,
      UPDATE_RELOAD_PENDING_KEY,
      extractAppVersion,
      extractReleaseMarkdown,
      createForegroundUpdateChecker,
      shouldShowRelease,
      updateBeforeUse,
      waitForWorkerTerminalState,
    });
  },
);
