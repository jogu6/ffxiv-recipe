const { test, expect } = require("@playwright/test");

const scrollSelectors = [
  "#recipeList",
  "#usesList",
  "#treeContainer",
  "#mobileTipsMsg",
];

test("the app frame keeps the overlaid footer visible at every panel scroll position", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(
    () => document.documentElement.dataset.appReady === "true",
    null,
    { timeout: 30000 },
  );

  for (const viewport of [
    { width: 390, height: 664 },
    { width: 750, height: 342 },
    { width: 810, height: 1080 },
    { width: 423, height: 560 },
  ]) {
    await page.setViewportSize(viewport);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const visibleHeight = Math.min(
            window.innerHeight,
            window.visualViewport?.height || window.innerHeight,
          );
          const body = document.body.getBoundingClientRect();
          const main = document.querySelector(".main").getBoundingClientRect();
          const footer = document
            .querySelector(".footer")
            .getBoundingClientRect();
          return {
            bodyFitsVisibleViewport:
              Math.abs(body.height - visibleHeight) < 0.5,
            footerAtVisibleBottom:
              Math.abs(footer.bottom - visibleHeight) < 0.5,
            footerOverlaysMain: footer.top < main.bottom,
            mainKeepsFullHeight: Math.abs(main.bottom - body.bottom) < 0.5,
            footerPosition: getComputedStyle(document.querySelector(".footer"))
              .position,
          };
        }),
      )
      .toEqual({
        bodyFitsVisibleViewport: true,
        footerAtVisibleBottom: true,
        footerOverlaysMain: true,
        mainKeepsFullHeight: true,
        footerPosition: "fixed",
      });
  }

  const staleVisualViewportRegression = await page.evaluate(() => {
    document.documentElement.style.setProperty(
      "--app-viewport-height",
      "300px",
    );
    document.documentElement.style.setProperty(
      "--app-layout-viewport-height",
      "560px",
    );
    const body = document.body.getBoundingClientRect();
    const main = document.querySelector(".main").getBoundingClientRect();
    const footer = document.querySelector(".footer").getBoundingClientRect();
    return {
      bodyIgnoresStaleVisualHeight: Math.abs(body.height - 560) < 0.5,
      mainUsesLayoutHeight: Math.abs(main.bottom - 560) < 0.5,
      footerUsesLayoutHeight: Math.abs(footer.bottom - 560) < 0.5,
      footerOverlaysMain: footer.top < main.bottom,
    };
  });
  expect(staleVisualViewportRegression).toEqual({
    bodyIgnoresStaleVisualHeight: true,
    mainUsesLayoutHeight: true,
    footerUsesLayoutHeight: true,
    footerOverlaysMain: true,
  });

  await page.evaluate(() => {
    document.documentElement.style.removeProperty("--app-viewport-height");
    document.documentElement.style.removeProperty(
      "--app-layout-viewport-height",
    );
    window.appViewport?.refresh?.();
  });
  await page.setViewportSize({ width: 423, height: 560 });

  const scrollResults = await page.evaluate(async (selectors) => {
    const results = [];
    const waitForLayout = () =>
      new Promise((resolve) => window.setTimeout(resolve, 220));
    for (const selector of selectors) {
      const container = document.querySelector(selector);
      const panel = container.closest(
        ".panel-left, .panel-middle, .panel-right",
      );
      const savedPanelStyle = panel?.getAttribute("style") ?? null;
      const savedContainerStyle = container.getAttribute("style");
      const savedClassName = container.className;
      const savedChildren = [...container.childNodes];

      if (panel) {
        panel.style.cssText = [
          "position:fixed",
          "inset:0",
          "display:flex",
          "flex-direction:column",
          "height:100%",
        ].join(";");
      }
      container.classList.remove("hidden");
      container.style.cssText = [
        "display:block",
        "flex:1 1 auto",
        "min-height:0",
        "overflow-y:auto",
      ].join(";");

      const content = document.createElement("div");
      content.style.height = "900px";
      content.style.flexShrink = "0";
      container.replaceChildren(content);

      const footerBottoms = [];
      for (const position of ["start", "middle", "end"]) {
        const maximum = container.scrollHeight - container.clientHeight;
        const scrollTop =
          position === "start"
            ? 0
            : position === "middle"
              ? maximum / 2
              : maximum;
        container.scrollTop = scrollTop;
        container.dispatchEvent(new Event("scroll"));
        await waitForLayout();
        if (position === "end") {
          container.scrollTop = container.scrollHeight - container.clientHeight;
        }
        footerBottoms.push(
          document.querySelector(".footer").getBoundingClientRect().bottom,
        );
      }
      const maximum = container.scrollHeight - container.clientHeight;
      const visibleHeight = Math.min(
        window.innerHeight,
        window.visualViewport?.height || window.innerHeight,
      );
      const result = {
        selector,
        isScrollable: maximum > 0,
        reachesEnd: Math.abs(container.scrollTop - maximum) < 0.5,
        footerAlwaysVisible: footerBottoms.every(
          (bottom) => Math.abs(bottom - visibleHeight) < 0.5,
        ),
        footerDoesNotMove:
          Math.max(...footerBottoms) - Math.min(...footerBottoms) < 0.5,
      };

      container.replaceChildren(...savedChildren);
      container.className = savedClassName;
      if (savedContainerStyle === null) container.removeAttribute("style");
      else container.setAttribute("style", savedContainerStyle);
      if (panel) {
        if (savedPanelStyle === null) panel.removeAttribute("style");
        else panel.setAttribute("style", savedPanelStyle);
      }
      results.push(result);
    }
    return results;
  }, scrollSelectors);

  expect(scrollResults).toEqual(
    scrollSelectors.map((selector) => ({
      selector,
      isScrollable: true,
      reachesEnd: true,
      footerAlwaysVisible: true,
      footerDoesNotMove: true,
    })),
  );

  const headerReturnsAfterViewportChangeAtScrollStart = await page.evaluate(
    async () => {
      const list = document.querySelector("#recipeList");
      list.scrollTop = 0;
      document.querySelector("header").classList.add("mobile-title-hidden");
      window.dispatchEvent(new CustomEvent("appviewportchange"));
      await new Promise((resolve) => setTimeout(resolve, 220));
      const shownAgain = !document
        .querySelector("header")
        .classList.contains("mobile-title-hidden");
      return {
        shownAgain,
        scrollTop: list.scrollTop,
      };
    },
  );
  expect(headerReturnsAfterViewportChangeAtScrollStart).toEqual({
    shownAgain: true,
    scrollTop: 0,
  });
});
