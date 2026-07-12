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
  await expect(close).toHaveCSS("cursor", "pointer");
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
  await expect(page.locator("#mobile")).toBeVisible();
  await expect(page.locator("#mobile")).toHaveCSS("display", "block");

  await page.setViewportSize({ width: 601, height: 844 });
  await expect(page.locator("#search .desktop-only")).toBeVisible();
  await expect(page.locator("#search .mobile-only")).toBeHidden();
  await expect(page.locator("#mobile")).toBeHidden();
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

test("combined favorites shows accordion, checkboxes, selections, and result", async ({
  page,
}) => {
  const combined = page.locator("#combined");
  await expect(combined).toContainText("右端の「◀」");
  await expect(combined).toContainText("チェックボックス");
  await expect(combined.locator(".swiper-slide")).toHaveCount(6);
  await expect(
    combined.locator(".swiper-slide").nth(1).locator("img"),
  ).toHaveAttribute("alt", "リスト操作とチェックボックス");
  await expect(combined.locator(".swiper-slide").last()).toContainText(
    "合算結果",
  );
});

test("mobile navigation description says the display switches", async ({
  page,
}) => {
  await expect(page.locator("#mobile")).toContainText(
    "表示が候補一覧からレシピツリーへ切り替わります",
  );
  await expect(page.locator("#mobile")).not.toContainText("別の画面");
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
