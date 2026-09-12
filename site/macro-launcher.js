(function initMacroLauncher(root) {
  'use strict';

  let preparedData = null;
  let resolvePreparedIcon = () => '';

  async function defaultPrepareData(itemDocument) {
    const module = await import('./macro-app/web/data-loader.js');
    let consumables = null;
    try {
      consumables = await root.MacroConsumableCache?.load?.(itemDocument) || null;
    } catch (error) {
      console.warn('[Macro] 保存済みの食事・薬品リストを読み込めませんでした:', error);
    }
    if (consumables) {
      root.performance?.mark?.('macro-consumable-cache-hit');
    } else {
      consumables = module.consumableListsFromItemDocument(itemDocument);
      try {
        await root.MacroConsumableCache?.save?.(itemDocument, consumables);
      } catch (error) {
        console.warn('[Macro] 食事・薬品リストを保存できませんでした:', error);
      }
    }
    return module.macroDataFromItemDocument(itemDocument, consumables);
  }

  function create({
    panel,
    frame,
    closeButton,
    preparing,
    progressOverlay,
    progress,
    progressPercent,
    elapsedTime,
    generationStatus,
    cancelButton,
    resolveIconFile = () => '',
    onOpen = () => {},
    onClose = () => {},
    onNavigate = () => {},
    onScroll = () => {},
    prepareData = defaultPrepareData
  }) {
    if (!panel || !frame || !closeButton || !preparing || !progressOverlay || !progress || !progressPercent || !elapsedTime || !cancelButton) {
      throw new TypeError('マクロパネルの接続要素がありません');
    }
    const ownerDocument = panel.ownerDocument || root.document;
    resolvePreparedIcon = resolveIconFile;
    let generating = false;
    let preparationState = 'waiting';
    let preparationPromise = null;
    let generationStartedAt = 0;
    let elapsedTimer = 0;
    let wakeLockSentinel = null;
    let scrollState = { scrollTop: 0, scrollHeight: 0, clientHeight: 0 };
    let activeRecipeId = '';
    const waitingButtons = new Set();

    function formatElapsed(milliseconds) {
      const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    function updateElapsedTime() {
      elapsedTime.textContent = formatElapsed(Date.now() - generationStartedAt);
    }

    function startElapsedTime() {
      root.clearInterval(elapsedTimer);
      generationStartedAt = Date.now();
      updateElapsedTime();
      elapsedTimer = root.setInterval(updateElapsedTime, 1000);
    }

    function stopElapsedTime() {
      root.clearInterval(elapsedTimer);
      elapsedTimer = 0;
    }

    async function requestWakeLock() {
      if (!generating || ownerDocument.visibilityState === 'hidden'
        || !root.navigator?.wakeLock?.request || (wakeLockSentinel && !wakeLockSentinel.released)) return;
      try {
        const sentinel = await root.navigator.wakeLock.request('screen');
        if (!generating) {
          await sentinel.release();
          return;
        }
        wakeLockSentinel = sentinel;
        sentinel.addEventListener?.('release', () => {
          if (wakeLockSentinel === sentinel) wakeLockSentinel = null;
        }, { once: true });
      } catch {
        wakeLockSentinel = null;
      }
    }

    function releaseWakeLock() {
      const sentinel = wakeLockSentinel;
      wakeLockSentinel = null;
      if (sentinel && !sentinel.released) void sentinel.release().catch(() => {});
    }

    function updateButton(button) {
      const ready = preparationState === 'ready';
      button.disabled = !ready;
      button.classList?.toggle?.('preparing', !ready);
      if (ready) {
        button.title = button.dataset.readyTitle;
        button.setAttribute('aria-label', button.dataset.readyTitle);
        button.removeAttribute?.('aria-busy');
      } else {
        button.title = preparationState === 'failed'
          ? 'マクロ用データを準備できませんでした'
          : 'マクロ用データを準備しています';
        button.setAttribute('aria-label', button.title);
        button.setAttribute('aria-busy', 'true');
      }
    }

    function updateWaitingButtons() {
      waitingButtons.forEach(updateButton);
      if (preparationState === 'ready') waitingButtons.clear();
    }

    function prepare(itemDocument) {
      if (preparationState === 'ready') return Promise.resolve(preparedData);
      if (preparationPromise) return preparationPromise;
      preparationState = 'preparing';
      updateWaitingButtons();
      preparationPromise = Promise.resolve()
        .then(() => prepareData(itemDocument))
        .then(data => {
          if (!data) throw new Error('マクロ用データが空です');
          preparedData = data;
          preparationState = 'ready';
          updateWaitingButtons();
          return data;
        })
        .catch(error => {
          preparationState = 'failed';
          updateWaitingButtons();
          throw error;
        });
      return preparationPromise;
    }

    function setGenerating(value) {
      const nextGenerating = value === true;
      if (nextGenerating && !generating) startElapsedTime();
      if (!nextGenerating && generating) stopElapsedTime();
      generating = nextGenerating;
      if (generating) void requestWakeLock();
      else releaseWakeLock();
      progressOverlay.hidden = !generating;
      ownerDocument.querySelectorAll?.('[data-app-content]').forEach(element => {
        element.inert = generating;
      });
      ownerDocument.body?.classList.toggle('macro-generation-busy', generating);
      if (generating) cancelButton.focus();
    }

    function setProgress(value, detail = '') {
      const percent = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
      progress.value = percent;
      progressPercent.value = `${percent}%`;
      progressPercent.textContent = `${percent}%`;
      if (generationStatus) generationStatus.textContent = detail || '生成を準備しています';
    }

    function open(recipeId, { scrollTop = 0 } = {}) {
      if (preparationState !== 'ready') return false;
      const id = String(recipeId || '').trim();
      if (!id) throw new Error('マクロ生成対象のレシピが選択されていません');
      if (id === activeRecipeId && panel.classList.contains('open') && !frame.hidden && preparing.hidden) {
        if (panel.getAttribute?.('aria-hidden') === 'true') onNavigate('macro');
        return false;
      }
      setGenerating(false);
      const restoredScrollTop = Math.max(0, Math.floor(Number(scrollTop) || 0));
      const params = new URLSearchParams({ recipe: id, siteRoot: '../..' });
      if (restoredScrollTop > 0) params.set('scrollTop', String(restoredScrollTop));
      activeRecipeId = id;
      scrollState = { scrollTop: restoredScrollTop, scrollHeight: 0, clientHeight: 0 };
      preparing.hidden = true;
      frame.hidden = false;
      frame.src = `./macro-app/web/index.html?${params}`;
      panel.classList.add('open');
      onOpen();
      return true;
    }

    function syncRecipe(recipeId) {
      const id = String(recipeId || '').trim();
      if (!id || generating || !panel.classList.contains('open') || id === activeRecipeId) return false;
      return open(id);
    }

    function close() {
      if (generating) return false;
      frame.src = 'about:blank';
      frame.hidden = false;
      preparing.hidden = true;
      panel.classList.remove('open');
      activeRecipeId = '';
      scrollState = { scrollTop: 0, scrollHeight: 0, clientHeight: 0 };
      onClose();
      return true;
    }

    function showPending(recipeId, { scrollTop = 0 } = {}) {
      const id = String(recipeId || '').trim();
      if (!id) return false;
      activeRecipeId = id;
      scrollState = {
        scrollTop: Math.max(0, Math.floor(Number(scrollTop) || 0)),
        scrollHeight: 0,
        clientHeight: 0
      };
      frame.src = 'about:blank';
      frame.hidden = true;
      preparing.textContent = 'マクロ画面を準備しています';
      preparing.hidden = false;
      panel.classList.add('open');
      return true;
    }

    function showPreparationError() {
      if (preparing.hidden) return;
      preparing.textContent = 'マクロ画面を準備できませんでした';
    }

    function createButton(name, recipeId) {
      if (!ownerDocument) throw new Error('マクロ起動ボタンを作成できません');
      const button = ownerDocument.createElement('button');
      button.className = 'macro-launch-btn';
      button.type = 'button';
      button.textContent = '📜';
      button.dataset.readyTitle = `${name}のマクロを生成`;
      waitingButtons.add(button);
      updateButton(button);
      button.addEventListener('click', event => {
        event.stopPropagation();
        open(recipeId);
      });
      return button;
    }

    cancelButton.addEventListener('click', () => {
      if (!generating) return;
      frame.contentWindow?.postMessage({ source: 'xivca-host', type: 'cancel' }, location.origin);
    });
    closeButton.addEventListener('click', close);
    ownerDocument.addEventListener?.('visibilitychange', () => {
      if (ownerDocument.visibilityState === 'visible' && generating) {
        progressOverlay.hidden = false;
        void requestWakeLock();
      }
    });
    root.addEventListener?.('pagehide', event => {
      if (event.persisted) return;
      if (generating) {
        frame.contentWindow?.postMessage({ source: 'xivca-host', type: 'cancel' }, location.origin);
      }
      setGenerating(false);
    });
    root.addEventListener?.('pageshow', event => {
      if (event.persisted && generating) {
        progressOverlay.hidden = false;
        void requestWakeLock();
      }
    });
    window.addEventListener('message', event => {
      if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
      if (event.data?.source !== 'xivca-macro') return;
      if (event.data.type === 'busy') {
        setProgress(1);
        setGenerating(true);
      }
      if (event.data.type === 'progress') setProgress(event.data.percent, event.data.detail);
      if (event.data.type === 'idle') setGenerating(false);
      if (event.data.type === 'swipe') onNavigate(event.data.direction);
      if (event.data.type === 'scroll') {
        scrollState = {
          scrollTop: Math.max(0, Number(event.data.scrollTop) || 0),
          scrollHeight: Math.max(0, Number(event.data.scrollHeight) || 0),
          clientHeight: Math.max(0, Number(event.data.clientHeight) || 0)
        };
        onScroll(scrollState);
      }
    });

    return {
      createButton,
      open,
      syncRecipe,
      close,
      showPending,
      showPreparationError,
      prepare,
      isGenerating: () => generating,
      isReady: () => preparationState === 'ready',
      getScrollState: () => ({ ...scrollState }),
      getState: () => ({
        open: panel.classList.contains('open'),
        recipeId: activeRecipeId,
        scrollTop: scrollState.scrollTop
      })
    };
  }

  root.MacroLauncher = Object.freeze({
    create,
    getPreparedData: () => preparedData,
    resolveIcon: iconFile => resolvePreparedIcon(iconFile)
  });
})(globalThis);
