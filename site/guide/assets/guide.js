(() => {
  const viewer = document.querySelector(".image-viewer");
  const stage = document.querySelector(".image-viewer-stage");
  const viewerImg = document.querySelector(".image-viewer-img");
  const topButton = document.querySelector(".top-button");
  const licenseOverlay = document.querySelector("#licenseOverlay");
  let drag = null;

  const mobileMedia = window.matchMedia("(max-width: 600px)");
  const toc = document.querySelector(".toc");

  function fitTocToViewport() {
    if (mobileMedia.matches) {
      toc.style.removeProperty("--toc-available-height");
      return;
    }
    const available = Math.max(
      180,
      window.innerHeight - toc.getBoundingClientRect().top - 12,
    );
    toc.style.setProperty("--toc-available-height", `${available}px`);
  }
  fitTocToViewport();
  window.addEventListener("resize", fitTocToViewport);
  window.addEventListener("scroll", fitTocToViewport, { passive: true });

  const galleryStates = [...document.querySelectorAll(".image-grid")].map(
    (gallery) => ({
      gallery,
      desktopFrames: [...gallery.querySelectorAll(".image-frame")].map(
        (frame) => frame.cloneNode(true),
      ),
      swiper: null,
      index: 0,
    }),
  );

  function makeFrames(state, mobile) {
    if (mobile && state.gallery.dataset.mobileSlides) {
      const template = state.desktopFrames[0];
      return state.gallery.dataset.mobileSlides.split(",").map((value) => {
        const [src, alt, caption] = value.split("|");
        const frame = template.cloneNode(true);
        const img = frame.querySelector("img");
        img.src = src;
        img.alt = alt;
        frame.querySelector("figcaption").textContent = caption;
        return frame;
      });
    }
    return state.desktopFrames.map((source) => {
      const frame = source.cloneNode(true);
      const img = frame.querySelector("img");
      if (mobile && img.dataset.mobileSrc) img.src = img.dataset.mobileSrc;
      return frame;
    });
  }

  function buildGallery(state, mobile) {
    if (state.swiper) state.swiper.destroy(true, true);
    const { gallery } = state;
    gallery.classList.remove("gallery-ready");
    const frames = makeFrames(state, mobile);
    gallery.replaceChildren(...frames);
    if (frames.length < 2) return;
    gallery.classList.add("gallery-ready");
    const viewport = document.createElement("div");
    viewport.className = "gallery-viewport swiper";
    const track = document.createElement("div");
    track.className = "gallery-track swiper-wrapper";
    frames.forEach((frame) => {
      frame.classList.add("swiper-slide");
      track.append(frame);
    });
    viewport.append(track);
    gallery.append(viewport);
    const dots = document.createElement("div");
    dots.className = "gallery-dots swiper-pagination";
    const previous = document.createElement("button");
    previous.type = "button";
    previous.className = "gallery-arrow gallery-arrow-previous";
    previous.setAttribute("aria-label", "前の画像");
    previous.textContent = "‹";
    const next = document.createElement("button");
    next.type = "button";
    next.className = "gallery-arrow gallery-arrow-next";
    next.setAttribute("aria-label", "次の画像");
    next.textContent = "›";
    gallery.append(previous, next);
    gallery.append(dots);
    state.swiper = new Swiper(viewport, {
      slidesPerView: 1,
      slidesPerGroup: 1,
      speed: 360,
      threshold: 5,
      simulateTouch: true,
      followFinger: true,
      grabCursor: true,
      resistanceRatio: 0.35,
      longSwipesRatio: 0.22,
      navigation: { previousEl: previous, prevEl: previous, nextEl: next },
      pagination: { el: dots, clickable: true },
      keyboard: { enabled: true, onlyInViewport: true },
      initialSlide: Math.min(state.index, frames.length - 1),
      on: {
        slideChange() {
          state.index = this.activeIndex;
        },
      },
    });
  }

  function rebuildResponsiveGalleries() {
    galleryStates.forEach((state) => buildGallery(state, mobileMedia.matches));
  }
  rebuildResponsiveGalleries();
  mobileMedia.addEventListener("change", () => {
    rebuildResponsiveGalleries();
    fitTocToViewport();
  });

  function openViewer(img) {
    viewerImg.src = img.currentSrc || img.src;
    viewerImg.alt = img.alt;
    viewer.classList.add("open");
    viewer.setAttribute("aria-hidden", "false");
    document.body.classList.add("viewer-open");
    stage.scrollTo(0, 0);
  }
  function closeViewer() {
    viewer.classList.remove("open");
    viewer.setAttribute("aria-hidden", "true");
    document.body.classList.remove("viewer-open");
    viewerImg.removeAttribute("src");
  }
  document.addEventListener("click", (event) => {
    const button = event.target.closest(".zoom-button");
    if (button) openViewer(button.closest(".image-frame").querySelector("img"));
  });
  document
    .querySelector(".image-viewer-close")
    .addEventListener("click", closeViewer);
  stage.addEventListener("pointerdown", (event) => {
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: stage.scrollLeft,
      top: stage.scrollTop,
    };
    stage.setPointerCapture(event.pointerId);
    stage.classList.add("dragging");
  });
  stage.addEventListener("pointermove", (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    stage.scrollLeft = drag.left - event.clientX + drag.x;
    stage.scrollTop = drag.top - event.clientY + drag.y;
  });
  ["pointerup", "pointercancel"].forEach((type) =>
    stage.addEventListener(type, () => {
      drag = null;
      stage.classList.remove("dragging");
    }),
  );

  document.querySelector("#licenseBtn").addEventListener("click", () => {
    licenseOverlay.classList.add("open");
    licenseOverlay.setAttribute("aria-hidden", "false");
  });
  document.querySelector("#licenseCloseBtn").addEventListener("click", () => {
    licenseOverlay.classList.remove("open");
    licenseOverlay.setAttribute("aria-hidden", "true");
  });
  licenseOverlay.addEventListener("click", (event) => {
    if (event.target === licenseOverlay)
      document.querySelector("#licenseCloseBtn").click();
  });
  document.querySelector(".toc-toggle").addEventListener("click", (event) => {
    const button = event.currentTarget;
    const open = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", String(!open));
    toc.classList.toggle("collapsed", open);
    button.querySelector(".toc-arrow").textContent = open ? "▼" : "▲";
    fitTocToViewport();
  });
  window.addEventListener(
    "scroll",
    () => topButton.classList.toggle("visible", scrollY > 320),
    { passive: true },
  );
  topButton.addEventListener("click", () =>
    scrollTo({ top: 0, behavior: "smooth" }),
  );
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeViewer();
  });
})();
