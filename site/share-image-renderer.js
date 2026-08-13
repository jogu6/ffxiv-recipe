(function initShareImageRenderer(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ShareImageRenderer = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function createShareImageRendererApi() {
  'use strict';

  const MAX_WIDTH = 1080;
  const MAX_HEIGHT = 4630;
  const CAPTURE_CHUNK_HEIGHT = 1600;
  const CAPTURE_BACKGROUND = '#1a1a1a';
  const OMIT_SELECTOR = [
    'button', 'input', 'select', 'textarea', '[role="button"]',
    '.favorite-pin', '.pin-btn', '.mini-tree', '.mini-tree-btn', '[data-share-image="omit"]'
  ].join(',');

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('PNGエンコードがタイムアウトしました。')), 120_000);
      canvas.toBlob(blob => {
        clearTimeout(timer);
        if (blob?.type === 'image/png') resolve(blob);
        else reject(new Error('PNGを生成できませんでした。'));
      }, 'image/png');
    });
  }

  function preserveItemIcons(content) {
    content.querySelectorAll('button.checkable-item-icon').forEach(button => {
      const wrapper = document.createElement('span');
      wrapper.className = button.className;
      wrapper.append(...button.childNodes);
      button.replaceWith(wrapper);
    });
    content.querySelectorAll('.item-image-check[aria-hidden="true"]').forEach(mark => mark.removeAttribute('aria-hidden'));
  }

  function preserveItemActionMarkers(content) {
    content.querySelectorAll('button.gathering-timer-btn, button.shop-info-btn, button.intermediate-prepared-btn').forEach(button => {
      const marker = document.createElement('span');
      marker.className = button.className;
      marker.textContent = button.textContent;
      button.replaceWith(marker);
    });
  }

  function preserveExclusionReasons(content) {
    content.querySelectorAll('[data-share-exclusion-reason]').forEach(row => {
      const reason = String(row.dataset.shareExclusionReason || '');
      if (!reason) return;
      const primary = row.querySelector('.material-primary');
      if (!primary) return;
      let status = primary.querySelector('.purchase-status');
      if (!status) {
        status = document.createElement('span');
        status.className = 'purchase-status';
        primary.appendChild(status);
      }
      status.textContent = reason;
      status.hidden = false;
      status.removeAttribute('aria-hidden');
      status.dataset.shareExclusionStatus = 'true';
    });
  }

  function preserveRecipeMethodSelections(content) {
    content.querySelectorAll('.recipe-method-control').forEach(control => {
      const visual = control.querySelector('.recipe-method-summary .recipe-method-visual');
      if (!visual) {
        control.remove();
        return;
      }
      const selected = visual.cloneNode(true);
      selected.classList.add('recipe-method-share-selection');
      control.replaceWith(selected);
    });
  }

  async function render({ snapshot, html2canvas = globalThis.html2canvas, scaleFactor = 1, onProgress = () => {} }) {
    if (typeof html2canvas !== 'function') throw new Error('画像描画機能を読み込めませんでした。');
    const host = document.createElement('section');
    host.className = 'share-capture-root';
    const title = document.createElement('h1');
    title.textContent = snapshot.title;
    host.appendChild(title);
    snapshot.headingLines.forEach(line => {
      const heading = document.createElement('h2');
      heading.textContent = line;
      host.appendChild(heading);
    });
    if (snapshot.description) {
      const description = document.createElement('p');
      description.className = 'share-capture-description';
      description.textContent = snapshot.description;
      host.appendChild(description);
    }
    const content = snapshot.content.cloneNode(true);
    content.removeAttribute?.('id');
    preserveItemIcons(content);
    preserveItemActionMarkers(content);
    preserveExclusionReasons(content);
    preserveRecipeMethodSelections(content);
    content.querySelectorAll('img.job-icon[aria-hidden="true"]').forEach(image => image.removeAttribute('aria-hidden'));
    content.querySelectorAll(OMIT_SELECTOR).forEach(node => node.remove());
    content.querySelectorAll('[hidden], [aria-hidden="true"], .hidden').forEach(node => node.remove());
    content.querySelectorAll('[id]').forEach(node => {
      node.dataset.shareSourceId = node.id;
      node.removeAttribute('id');
    });
    host.appendChild(content);
    const footer = document.createElement('footer');
    footer.textContent = '© SQUARE ENIX / X: @ff14_recipe';
    host.appendChild(footer);
    document.body.appendChild(host);
    try {
      await document.fonts?.ready;
      await Promise.all([...host.querySelectorAll('img')].map(image => image.complete ? null : new Promise(resolve => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', resolve, { once: true });
      })));
      const naturalWidth = Math.min(MAX_WIDTH, Math.max(320, Math.ceil(host.scrollWidth)));
      host.style.width = `${naturalWidth}px`;
      const naturalHeight = host.scrollHeight;
      const fitScale = Math.min(1, MAX_HEIGHT / naturalHeight) * scaleFactor;
      onProgress('共有内容を配置しています', 12);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(naturalWidth * fitScale));
      canvas.height = Math.max(1, Math.min(MAX_HEIGHT, Math.round(naturalHeight * fitScale)));
      const context = canvas.getContext('2d');
      context.fillStyle = CAPTURE_BACKGROUND;
      context.fillRect(0, 0, canvas.width, canvas.height);
      for (let y = 0; y < naturalHeight; y += CAPTURE_CHUNK_HEIGHT) {
        const height = Math.min(CAPTURE_CHUNK_HEIGHT, naturalHeight - y);
        const chunk = await html2canvas(host, {
          backgroundColor: CAPTURE_BACKGROUND,
          logging: false,
          scale: fitScale,
          useCORS: false,
          width: naturalWidth,
          height,
          x: 0,
          y,
          scrollX: 0,
          scrollY: 0,
          windowWidth: naturalWidth,
          windowHeight: naturalHeight
        });
        context.drawImage(chunk, 0, Math.round(y * fitScale));
        onProgress('共有内容を描画しています', 12 + Math.round(((y + height) / naturalHeight) * 70));
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      onProgress('PNGへ変換しています', 88);
      const blob = await canvasToBlob(canvas);
      onProgress('完了しています', 100);
      return { blob, width: canvas.width, height: canvas.height };
    } finally {
      host.remove();
    }
  }

  async function renderWithRetry(options) {
    let lastError;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const result = await render({
          ...options,
          scaleFactor: (options.initialScaleFactor || 1) * (0.8 ** attempt),
          onProgress: (phase, percent) => options.onProgress?.(attempt ? `${phase}（再試行 ${attempt}/3）` : phase, percent)
        });
        return { ...result, attempts: attempt + 1 };
      } catch (error) {
        lastError = error;
        if (error?.name === 'SecurityError') break;
      }
    }
    throw lastError || new Error('共有画像を生成できませんでした。');
  }

  return Object.freeze({ CAPTURE_BACKGROUND, CAPTURE_CHUNK_HEIGHT, MAX_HEIGHT, MAX_WIDTH, render, renderWithRetry });
});
