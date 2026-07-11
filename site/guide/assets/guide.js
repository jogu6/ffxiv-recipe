(() => {
  const viewer = document.querySelector('.image-viewer');
  const stage = document.querySelector('.image-viewer-stage');
  const viewerImg = document.querySelector('.image-viewer-img');
  const topButton = document.querySelector('.top-button');
  const licenseOverlay = document.querySelector('#licenseOverlay');
  let drag = null;

  const mobileMedia = window.matchMedia('(max-width: 720px)');
  function updateResponsiveImages() {
    document.querySelectorAll('img[data-mobile-src]').forEach(img => {
      if (!img.dataset.desktopSrc) img.dataset.desktopSrc = img.getAttribute('src');
      img.src = mobileMedia.matches ? img.dataset.mobileSrc : img.dataset.desktopSrc;
    });
  }
  updateResponsiveImages();
  mobileMedia.addEventListener('change', updateResponsiveImages);

  document.querySelectorAll('.image-grid').forEach(gallery => {
    const frames = [...gallery.querySelectorAll('.image-frame')];
    if (frames.length < 2) return;
    gallery.classList.add('gallery-ready');
    const viewport = document.createElement('div');
    viewport.className = 'gallery-viewport';
    const track = document.createElement('div');
    track.className = 'gallery-track';
    frames.forEach(frame => track.append(frame));
    viewport.append(track);
    gallery.append(viewport);
    const dots = document.createElement('div');
    dots.className = 'gallery-dots';
    frames.forEach((_, index) => {
      const dot = document.createElement('button');
      dot.type = 'button'; dot.className = `gallery-dot${index === 0 ? ' active' : ''}`;
      dot.setAttribute('aria-label', `${index + 1}枚目の画像`);
      dot.addEventListener('click', () => viewport.scrollTo({ left: viewport.clientWidth * index, behavior: 'smooth' }));
      dots.append(dot);
    });
    gallery.append(dots);
    viewport.addEventListener('scroll', () => {
      const index = Math.round(viewport.scrollLeft / viewport.clientWidth);
      [...dots.children].forEach((dot, i) => dot.classList.toggle('active', i === index));
    }, { passive: true });
  });

  function openViewer(img) {
    viewerImg.src = img.currentSrc || img.src; viewerImg.alt = img.alt;
    viewer.classList.add('open'); viewer.setAttribute('aria-hidden', 'false');
    document.body.classList.add('viewer-open'); stage.scrollTo(0, 0);
  }
  function closeViewer() {
    viewer.classList.remove('open'); viewer.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('viewer-open'); viewerImg.removeAttribute('src');
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('.zoom-button');
    if (button) openViewer(button.closest('.image-frame').querySelector('img'));
  });
  document.querySelector('.image-viewer-close').addEventListener('click', closeViewer);
  stage.addEventListener('pointerdown', event => { drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop }; stage.setPointerCapture(event.pointerId); stage.classList.add('dragging'); });
  stage.addEventListener('pointermove', event => { if (!drag || drag.id !== event.pointerId) return; stage.scrollLeft = drag.left - event.clientX + drag.x; stage.scrollTop = drag.top - event.clientY + drag.y; });
  ['pointerup', 'pointercancel'].forEach(type => stage.addEventListener(type, () => { drag = null; stage.classList.remove('dragging'); }));

  document.querySelector('#licenseBtn').addEventListener('click', () => { licenseOverlay.classList.add('open'); licenseOverlay.setAttribute('aria-hidden', 'false'); });
  document.querySelector('#licenseCloseBtn').addEventListener('click', () => { licenseOverlay.classList.remove('open'); licenseOverlay.setAttribute('aria-hidden', 'true'); });
  licenseOverlay.addEventListener('click', event => { if (event.target === licenseOverlay) document.querySelector('#licenseCloseBtn').click(); });
  document.querySelector('.toc-toggle').addEventListener('click', event => { const button = event.currentTarget; const open = button.getAttribute('aria-expanded') === 'true'; button.setAttribute('aria-expanded', String(!open)); document.querySelector('#toc-list').hidden = open; button.querySelector('.toc-arrow').textContent = open ? '▼' : '▲'; });
  window.addEventListener('scroll', () => topButton.classList.toggle('visible', scrollY > 320), { passive: true });
  topButton.addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));
  window.addEventListener('keydown', event => { if (event.key === 'Escape') closeViewer(); });
})();
