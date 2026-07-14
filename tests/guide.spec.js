const { expect, test } = require("@playwright/test");

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/guide/");
});

async function swipe(page, locator, fromRatio, toRatio) {
  const box = await locator.boundingBox();
  const client = await page.context().newCDPSession(page);
  const y = Math.max(80, box.y + 120);
  const point = (ratio) => ({ x: box.x + box.width * ratio, y });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point(fromRatio)],
  });
  for (let step = 1; step <= 8; step++) {
    const ratio = fromRatio + ((toRatio - fromRatio) * step) / 8;
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [point(ratio)],
    });
  }
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

test("carousel drags with a mouse in both directions without moving vertically", async ({
  page,
}) => {
  const gallery = page.locator("#search .image-grid");
  await gallery.scrollIntoViewIfNeeded();
  const viewport = gallery.locator(".gallery-viewport");
  const scrollY = await page.evaluate(() => window.scrollY);

  const box = await viewport.boundingBox();
  const y = Math.max(80, box.y + 120);
  await page.mouse.move(box.x + box.width * 0.85, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.15, y, { steps: 10 });
  await page.mouse.up();
  await expect(viewport.locator(".swiper-slide-active figcaption")).toHaveText(
    "②レシピを確認",
  );
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollY);

  await page.mouse.move(box.x + box.width * 0.15, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.85, y, { steps: 10 });
  await page.mouse.up();
  await expect(viewport.locator(".swiper-slide-active figcaption")).toHaveText(
    "①候補をタップ",
  );
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollY);
});

test("carousel swipes with touch input", async ({ page }) => {
  const gallery = page.locator("#search .image-grid");
  await gallery.scrollIntoViewIfNeeded();
  await swipe(page, gallery.locator(".gallery-viewport"), 0.85, 0.15);
  await expect(gallery.locator(".swiper-slide-active figcaption")).toHaveText(
    "②レシピを確認",
  );
});

test("arrow controls move one slide", async ({ page }) => {
  const gallery = page.locator("#favorites .image-grid").first();
  await gallery.scrollIntoViewIfNeeded();
  await gallery.locator(".gallery-arrow-next").click();
  await expect(gallery.locator(".swiper-slide-active figcaption")).toHaveText(
    "登録後の📌",
  );
  await gallery.locator(".gallery-arrow-previous").click();
  await expect(gallery.locator(".swiper-slide-active figcaption")).toHaveText(
    "登録先を選ぶ",
  );
});

test("expanded image close control communicates that it is clickable", async ({
  page,
}) => {
  await page.locator("#search .zoom-button").first().click();
  const close = page.locator(".image-viewer-close");
  await expect(close).toBeVisible();
  await expect(close).toHaveText("✕");
  await expect(close).toHaveCSS("cursor", "pointer");
  const closeBox = await close.boundingBox();
  expect(closeBox.x + closeBox.width).toBeGreaterThan(360);
  expect(closeBox.y).toBeLessThan(20);
  const stage = page.locator(".image-viewer-stage");
  const box = await stage.boundingBox();
  await page.mouse.move(box.x + 180, box.y + 180);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 80, { steps: 5 });
  await page.mouse.up();
  await expect(close).toBeVisible();
  await stage.click({ position: { x: 20, y: 20 } });
  await expect(close).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(close).not.toBeVisible();
});

test("phone image viewer pinches between fit size and natural size", async ({
  page,
}) => {
  await page.locator("#search .zoom-button").first().click();
  const stage = page.locator(".image-viewer-stage");
  const image = page.locator(".image-viewer-img");
  await expect(image).toHaveAttribute("data-scale", /.+/);
  const minimum = Number(await image.getAttribute("data-scale"));
  const expectedMinimum = await image.evaluate((element) =>
    Math.min(
      1,
      element.parentElement.clientWidth / element.naturalWidth,
      element.parentElement.clientHeight / element.naturalHeight,
    ),
  );
  expect(minimum).toBeCloseTo(expectedMinimum, 3);

  const box = await stage.boundingBox();
  const client = await page.context().newCDPSession(page);
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: centerX - 30, y: centerY },
      { x: centerX + 30, y: centerY },
    ],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: centerX - 180, y: centerY },
      { x: centerX + 180, y: centerY },
    ],
  });
  await expect.poll(async () => Number(await image.getAttribute("data-scale"))).toBe(1);
  const naturalSize = await image.evaluate((element) => ({
    renderedWidth: element.getBoundingClientRect().width,
    naturalWidth: element.naturalWidth,
  }));
  expect(naturalSize.renderedWidth).toBeCloseTo(naturalSize.naturalWidth, 0);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: centerX - 5, y: centerY },
      { x: centerX + 5, y: centerY },
    ],
  });
  await expect
    .poll(async () => Number(await image.getAttribute("data-scale")))
    .toBeGreaterThanOrEqual(minimum);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
});

test("table of contents toggle works with touch-sized mobile layout", async ({
  page,
}) => {
  const toggle = page.locator(".toc-toggle");
  const list = page.locator(".toc > ol");
  await toggle.click();
  await expect(list).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(list).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
});

test("table of contents follows the guide content without duplicate or backward links", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();

  await expect(page.locator("#toc-list > li > a")).toHaveText([
    "このアプリでできること",
    "アイテムを検索する",
    "装備を条件検索する",
    "レシピツリー画面を確認する",
    "必要素材と個数を確認する",
    "ツリー内の素材を操作する",
    "素材からレシピを逆引きする",
    "お気に入りリストを使う",
    "お気に入りリストの拡張機能",
    "複数のお気に入りリストの素材を計算する",
    "保存・共有する",
    "小窓・PWAで使う",
    "注意事項・設定",
  ]);
  await expect(page.locator(".post .step")).toHaveCount(0);

  const orderedSections = await page
    .locator(".post-list > section")
    .evaluateAll((sections) => sections.map((section) => section.id));
  expect(orderedSections).toEqual([
    "overview",
    "search",
    "equipment",
    "recipe-tree",
    "materials",
    "tree-tools",
    "reverse",
    "favorites",
    "favorite-tools",
    "combined",
    "share",
    "window",
    "notes",
  ]);

  const targets = await page
    .locator("#toc-list a")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  expect(new Set(targets).size).toBe(targets.length);

  const targetPositions = [];
  for (const target of targets) {
    await expect(page.locator(target)).toHaveCount(1);
    await expect(page.locator(target)).toBeVisible();
    targetPositions.push(
      await page.locator(target).evaluate((element) => element.offsetTop),
    );
  }
  expect(targetPositions).toEqual([...targetPositions].sort((a, b) => a - b));
});

test("desktop table of contents fits the viewport and does not clip labels", async ({
  page,
}) => {
  for (const width of [601, 840, 841, 1440, 1920]) {
    await page.setViewportSize({ width, height: 500 });
    await page.reload();
    await page.evaluate(() => document.fonts.ready);

    const toc = page.locator(".toc");
    const tocBox = await toc.boundingBox();
    const footerBox = await page.locator("footer").boundingBox();
    expect(tocBox.y + tocBox.height).toBeLessThanOrEqual(footerBox.y - 8 + 1);
    const clippedLabels = await page.locator("#toc-list a").evaluateAll((links) =>
      links.filter((link) => link.scrollWidth > link.clientWidth + 1).map((link) => link.textContent),
    );
    expect(clippedLabels).toEqual([]);
  }
});

test("top button reacts on hover", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 500 });
  await page.reload();
  await page.evaluate(() => window.scrollTo(0, 600));
  const button = page.locator(".top-button");
  await expect(button).toBeVisible();
  const before = await button.evaluate((element) => getComputedStyle(element).backgroundColor);
  await button.hover();
  await expect(button).toHaveCSS("cursor", "pointer");
  await expect
    .poll(() => button.evaluate((element) => getComputedStyle(element).backgroundColor))
    .not.toBe(before);
});

test("images switch at 600px without reloading in either direction", async ({
  page,
}) => {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    )
    .toBe(true);

  const mobileImages = await page
    .locator(".extension-sections img")
    .evaluateAll((images) =>
      images.map((image) => image.currentSrc || image.src),
    );
  expect(mobileImages).not.toHaveLength(0);
  expect(mobileImages.every((src) => /\/mobile-[^/]+\.webp$/.test(src))).toBe(
    true,
  );

  await page.setViewportSize({ width: 601, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    )
    .toBe(true);

  const desktopImages = await page
    .locator(".extension-sections img")
    .evaluateAll((images) =>
      images.map((image) => image.currentSrc || image.src),
    );
  expect(desktopImages).not.toHaveLength(0);
  expect(desktopImages.every((src) => !/\/mobile-/.test(src))).toBe(true);

  await page.setViewportSize({ width: 600, height: 844 });
  await expect
    .poll(() =>
      page
        .locator(".extension-sections img")
        .evaluateAll((images) =>
          images.every((image) =>
            /\/mobile-/.test(image.currentSrc || image.src),
          ),
        ),
    )
    .toBe(true);
});

test("responsive explanations show only text for the current layout", async ({
  page,
}) => {
  await expect(page.locator("#search .mobile-only")).toBeVisible();
  await expect(page.locator("#search .desktop-only")).toBeHidden();

  await page.setViewportSize({ width: 601, height: 844 });
  await expect(page.locator("#search .desktop-only")).toBeVisible();
  await expect(page.locator("#search .mobile-only")).toBeHidden();
});

test("guide explains the purpose, operation, and result of any-one mode", async ({
  page,
}) => {
  const section = page
    .locator("#favorite-tools")
    .getByRole("heading", {
      name: "どれでも1つ",
    })
    .locator("..");
  await expect(section).toContainText("どれか1つを作れる素材リスト");
  await expect(section).toContainText("素材リストを表示");
  await expect(section).toContainText("もしくは");
});

test("combined favorites explains list selection, both modes, and result controls", async ({
  page,
}) => {
  const combined = page.locator("#combined");
  await expect(combined).toContainText("右端の「◀」");
  await expect(combined).toContainText("チェックボックス");
  await expect(combined).toContainText(
    "どれか1リストをセット数分製作するために必要な素材リスト",
  );
  await expect(combined).toContainText(
    "チェックしたすべてのリストを製作する素材リストではありません",
  );
  await expect(combined).toContainText("リストごとに指輪の製作数を0・1つ・2つ");
  await expect(
    combined.getByRole("img", { name: "複数リスト用拡張機能の説明ウィンドウ" }),
  ).toBeVisible();
  await expect(
    combined.getByRole("img", {
      name: "どれか一つだけで表示した複数リストの素材リスト",
    }),
  ).toBeVisible();
  await expect(
    combined.getByRole("img", {
      name: "複数リストの製作内容を折り畳んだ素材リスト",
    }),
  ).toBeVisible();
});

test("guide shows equipment item-level choices and production disclosure results", async ({
  page,
}) => {
  await expect(page.locator("#equipment")).toContainText(
    "指定した装備レベルに対応する候補だけ",
  );
  await expect(
    page.getByRole("img", {
      name: "装備レベルに対応するアイテムレベルの選択肢",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "個数指定の製作内容を折り畳んだ素材リスト" }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: "どれでも1つの製作内容を折り畳んだ素材リスト",
    }),
  ).toBeVisible();
});

test("gallery image and controls fit a practical phone viewport", async ({
  page,
}) => {
  const gallery = page.locator("#favorites .image-grid").first();
  await gallery.scrollIntoViewIfNeeded();
  const box = await gallery.boundingBox();
  expect(box.height).toBeLessThanOrEqual(844);
  await expect(gallery.locator(".gallery-arrow-next")).toBeVisible();
  await expect(gallery.locator(".gallery-dots")).toBeVisible();
});

test("table of contents shrinks to its content and toggles on desktop", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  const toc = page.locator(".toc");
  const list = page.locator(".toc > ol");
  const tocBox = await toc.boundingBox();
  const listBox = await list.boundingBox();
  expect(tocBox.height - listBox.height).toBeLessThan(60);
  await page.locator(".toc-toggle").click();
  await expect(toc).toHaveClass(/collapsed/);
  await expect(list).toBeHidden();
  await expect(page.locator(".toc-toggle")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.locator(".toc-toggle").click();
  await expect(list).toBeVisible();
});

test("short desktop viewport scrolls only the table of contents list", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 500 });
  await page.reload();
  const toc = page.locator(".toc");
  const list = page.locator(".toc > ol");
  const tocBox = await toc.boundingBox();
  expect(tocBox.y + tocBox.height).toBeLessThanOrEqual(500);
  await expect(list).toHaveCSS("overflow-y", "auto");
  expect(
    await list.evaluate((element) => element.scrollHeight),
  ).toBeGreaterThan(await list.evaluate((element) => element.clientHeight));
});
