import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "site", "guide", "assets", "images");
const sourceOutput = path.join(root, "guide-capture", "output");
await mkdir(output, { recursive: true });
await mkdir(sourceOutput, { recursive: true });
const server = spawn(
  "py",
  ["-m", "http.server", "4173", "--bind", "0.0.0.0", "--directory", "site"],
  { cwd: root, stdio: "ignore", windowsHide: true },
);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try {
      const response = await fetch("http://127.0.0.1:4173/");
      if (response.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error("ローカルサーバーを起動できませんでした");
}
const annotationTheme = {
  gold: "#d8b95f",
  panel: "rgba(24, 22, 17, .92)",
};

function annotationSvg(width, height, annotation) {
  if (!annotation) return null;
  const x = Math.round(annotation.x * width);
  const y = Math.round(annotation.y * height);
  const labelX = Math.max(
    14,
    Math.min(width - 206, x + (annotation.labelDx ?? 24)),
  );
  const labelY = Math.max(
    14,
    Math.min(height - 54, y + (annotation.labelDy ?? -74)),
  );
  const text = annotation.text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  const targetWidth = annotation.targetWidth ?? (annotation.radius ?? 25) * 2.8;
  const targetHeight =
    annotation.targetHeight ?? (annotation.radius ?? 25) * 1.45;
  const targetLeft = x - targetWidth / 2;
  const targetTop = y - targetHeight / 2;
  const targetEdgeY = labelY > y ? targetTop + targetHeight : targetTop;
  const labelEdgeY = labelY > y ? labelY : labelY + 42;
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="shadow"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity=".65"/></filter>
      <marker id="arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${annotationTheme.gold}"/></marker>
    </defs>
    <g filter="url(#shadow)">
      <rect x="${targetLeft}" y="${targetTop}" width="${targetWidth}" height="${targetHeight}" rx="${Math.min(16, targetHeight / 3)}" fill="rgba(216,185,95,.08)" stroke="rgba(216,185,95,.32)" stroke-width="9"/>
      <rect x="${targetLeft}" y="${targetTop}" width="${targetWidth}" height="${targetHeight}" rx="${Math.min(16, targetHeight / 3)}" fill="none" stroke="${annotationTheme.gold}" stroke-width="3"/>
      <path d="M ${labelX + 96} ${labelEdgeY} C ${labelX + 96} ${(labelEdgeY + targetEdgeY) / 2}, ${x} ${(labelEdgeY + targetEdgeY) / 2}, ${x} ${targetEdgeY}" fill="none" stroke="${annotationTheme.gold}" stroke-width="3" stroke-linecap="round" marker-end="url(#arrow)"/>
      <rect x="${labelX}" y="${labelY}" width="192" height="42" rx="21" fill="${annotationTheme.panel}" stroke="${annotationTheme.gold}"/>
      <text x="${labelX + 96}" y="${labelY + 27}" text-anchor="middle" fill="#fff7df" font-family="Yu Gothic UI, Meiryo, sans-serif" font-size="15" font-weight="700">${text}</text>
    </g>
  </svg>`);
}

async function save(page, name, annotation = null) {
  await page.evaluate(async () => {
    await Promise.allSettled(
      document.getAnimations().map((animation) => animation.finished),
    );
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
  const invalidState = await page.evaluate(() => {
    const loading = document.querySelector("#loadingOverlay");
    return {
      loading:
        loading &&
        getComputedStyle(loading).display !== "none" &&
        loading.getClientRects().length > 0,
      selectedText: document.getSelection()?.isCollapsed === false,
    };
  });
  if (invalidState.loading || invalidState.selectedText) {
    throw new Error(
      `${name}: 撮影前の画面状態が不正です ${JSON.stringify(invalidState)}`,
    );
  }
  const pngName = name.replace(/\.webp$/i, ".png");
  const buffer = await page.screenshot({ fullPage: false, type: "png" });
  await sharp(buffer).png().toFile(path.join(sourceOutput, pngName));
  await sharp(buffer)
    .webp({ quality: 94, smartSubsample: true })
    .toFile(path.join(output, name));
}
async function saveElement(page, name, locator) {
  await page.evaluate(async () => {
    await Promise.allSettled(
      document.getAnimations().map((animation) => animation.finished),
    );
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
  const pngName = name.replace(/\.webp$/i, ".png");
  const buffer = await locator.screenshot({ type: "png" });
  await sharp(buffer).png().toFile(path.join(sourceOutput, pngName));
  await sharp(buffer)
    .webp({ quality: 94, smartSubsample: true })
    .toFile(path.join(output, name));
}
async function search(page, value) {
  await page.locator("#searchBox").fill(value);
  await page.locator("#searchBox").blur();
  await page
    .locator("#recipeList li")
    .filter({ hasText: value })
    .first()
    .click();
}
async function chooseOption(page, id, label) {
  const select = page.locator(`#${id}`);
  if ((await select.getAttribute("data-value")) === label) return;
  await select.locator(".custom-select-toggle").click();
  await page
    .locator(`#${id} .custom-select-option`)
    .getByText(label, { exact: true })
    .click();
}
async function dragAfter(page, handle, target) {
  const from = await handle.boundingBox();
  const to = await target.boundingBox();
  const pointer = {
    button: 0,
    buttons: 1,
    pointerId: 1,
    pointerType: "mouse",
    clientX: from.x + from.width / 2,
    clientY: from.y + from.height / 2,
  };
  await handle.dispatchEvent("pointerdown", pointer);
  await handle.dispatchEvent("pointermove", {
    ...pointer,
    clientX: to.x + to.width / 2,
    clientY: to.y + to.height * 0.85,
  });
  await handle.dispatchEvent("pointerup", {
    ...pointer,
    buttons: 0,
    clientX: to.x + to.width / 2,
    clientY: to.y + to.height * 0.85,
  });
}
async function expectFavoriteOrder(page, first, second) {
  const names = await page
    .locator("#favoriteLists .favorite-list-name")
    .allTextContents();
  if (
    names.indexOf(first) < 0 ||
    names.indexOf(first) >= names.indexOf(second)
  ) {
    throw new Error(
      `お気に入りリストの並べ替えに失敗しました: ${names.join(" / ")}`,
    );
  }
}

async function prepare(page) {
  await page.goto("http://127.0.0.1:4173/");
  await page.locator("#loadingOverlay").waitFor({ state: "hidden" });
  await page.addStyleTag({
    content:
      "*,*::before,*::after{animation:none!important;transition:none!important}",
  });
}

async function setGuideFavorites(page) {
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem(
      "ff14_favorite_lists_v2",
      JSON.stringify({
        version: 2,
        selectedListId: "guide",
        lists: [
          { id: "guide", name: "制作予定", itemIds: [1607, 4422] },
          { id: "guide-2", name: "納品用", itemIds: [273] },
        ],
      }),
    );
  });
  await page.reload();
  await page.locator("#loadingOverlay").waitFor({ state: "hidden" });
}

async function captureDesktop(browser) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  await prepare(page);
  await page.locator("#equipmentSearchToggle").click();
  await save(page, "07-equipment-search.webp", {
    x: 0.24,
    y: 0.22,
    radius: 45,
    text: "① 条件を指定",
    labelDx: 70,
    labelDy: 65,
  });
  await chooseOption(page, "equipmentJobSelect", "ナイト");
  await page.locator("#equipmentLevelInput").fill("100");
  await page.locator("#equipmentLevelInput").dispatchEvent("input");
  await chooseOption(page, "equipmentItemLevelSelect", "770");
  await page.locator("#equipmentSearchBtn").click();
  await save(page, "25-equipment-results.webp");
  await page.locator("#equipmentSearchToggle").click();
  await search(page, "ブラスバスタードソード");
  await save(page, "01-search.webp", {
    x: 0.24,
    y: 0.3,
    radius: 45,
    text: "① 候補を選択",
    labelDx: 70,
    labelDy: 65,
  });
  await page.locator('.pin-btn[title="お気に入りに追加"]').first().click();
  await save(page, "11-favorite-target.webp");
  await page.locator("#favoriteTargetCreate").getByText("新規作成").click();
  await page.locator("#textInputField").fill("制作予定");
  await page.locator("#textInputOkBtn").click();
  await save(page, "12-favorite-registered.webp");
  await page.locator(".shop-info-btn:visible").first().click();
  await save(page, "18-shop-info.webp");
  await page.locator("#shopCloseBtn").click();
  await page.locator("#countInput").fill("3");
  await page.locator("#countInput").dispatchEvent("change");
  await page.locator("#materialsViewBtn").click();
  await save(page, "02-materials.webp", {
    x: 0.73,
    y: 0.2,
    radius: 44,
    text: "② 素材を確認",
    labelDx: -250,
    labelDy: 65,
  });
  await page.locator("#appTitle").click();
  await page.locator("#searchBox").fill("山羊乳");
  await page.locator("#searchBox").blur();
  await page
    .locator("#recipeList li")
    .filter({ hasText: "山羊乳" })
    .first()
    .click();
  await save(page, "03-used-in.webp", {
    x: 0.73,
    y: 0.3,
    radius: 44,
    text: "② 使用先を確認",
    labelDx: -250,
    labelDy: 65,
  });
  await page.locator("#appTitle").click();
  await search(page, "ゴールドインゴット");
  await page
    .locator('.gathering-timer-btn[title="金鉱の採集情報"]:visible')
    .click();
  await save(page, "19-gathering-time.webp");
  await page.locator("#gatheringCloseBtn").click();
  await page.locator("#appTitle").click();
  await setGuideFavorites(page);
  await page.locator("#favBtn").click();
  const desktopList = page
    .locator("#favoriteLists li")
    .filter({ hasText: "制作予定" });
  await save(page, "26-favorite-list-overview.webp");
  await desktopList.locator(".favorite-list-curtain-toggle").click();
  await saveElement(
    page,
    "27-favorite-list-actions.webp",
    page.locator("#panelLeft"),
  );
  await desktopList.locator('[title="名前変更"]').click();
  await save(page, "33-favorite-list-rename-input.webp");
  await page.locator("#textInputField").fill("制作メモ");
  await page.locator("#textInputOkBtn").click();
  await page.locator("#favBtn").click();
  await page.locator("#favoriteLists").getByText("制作メモ").waitFor();
  await saveElement(
    page,
    "28-favorite-list-renamed.webp",
    page.locator("#panelLeft"),
  );
  const renamedDesktopList = page
    .locator("#favoriteLists li")
    .filter({ hasText: "制作メモ" });
  const desktopTargetList = page
    .locator("#favoriteLists li")
    .filter({ hasText: "納品用" });
  await renamedDesktopList.locator(".favorite-list-curtain-toggle").click();
  await dragAfter(
    page,
    renamedDesktopList.locator(".reorder-handle"),
    desktopTargetList,
  );
  await expectFavoriteOrder(page, "納品用", "制作メモ");
  await saveElement(
    page,
    "30-favorite-list-reordered.webp",
    page.locator("#panelLeft"),
  );
  const reorderedDesktopList = page
    .locator("#favoriteLists li")
    .filter({ hasText: "制作メモ" });
  await reorderedDesktopList.locator('[title="削除"]').click();
  await save(page, "29-favorite-list-delete.webp");
  await page.locator("#confirmYes").click();
  await page
    .locator("#favoriteLists")
    .getByText("制作メモ")
    .waitFor({ state: "detached" });
  await page.locator("#favBtn").click();
  await page.locator("#favoriteLists").getByText("納品用").waitFor();
  await saveElement(
    page,
    "34-favorite-list-deleted.webp",
    page.locator("#panelLeft"),
  );
  await setGuideFavorites(page);
  await page.locator("#favBtn").click();
  await page.locator("#favoriteLists").getByText("制作予定").click();
  await save(page, "04-favorites.webp", {
    x: 0.25,
    y: 0.3,
    radius: 44,
    text: "② リストを選択",
    labelDx: 70,
    labelDy: 65,
  });
  await page.locator(".favorite-material-curtain-toggle").click();
  await page.locator(".favorite-material-mode-group").waitFor();
  await sleep(250);
  await save(page, "09-favorite-extensions.webp");
  await page
    .locator(".favorite-material-mode-group")
    .getByText("並び替え")
    .click();
  await save(page, "15-favorite-reorder.webp");
  const desktopHandles = page.locator("#recipeList .reorder-handle");
  const desktopFirst = await desktopHandles.nth(0).boundingBox();
  const desktopSecond = await desktopHandles.nth(1).boundingBox();
  await page.mouse.move(
    desktopFirst.x + desktopFirst.width / 2,
    desktopFirst.y + desktopFirst.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    desktopSecond.x + desktopSecond.width / 2,
    desktopSecond.y + desktopSecond.height,
    { steps: 8 },
  );
  await page.mouse.up();
  await save(page, "16-favorite-reordered.webp");
  await page
    .locator(".favorite-material-mode-group")
    .getByText("並び替え")
    .click();
  await page
    .locator(".favorite-material-mode-group")
    .getByText("個数指定")
    .click();
  await save(page, "10-favorite-counts.webp");
  await page
    .locator("#recipeList")
    .getByText(/素材リストを表示/)
    .click();
  await save(page, "14-favorite-count-result.webp");
  await page.locator("#appTitle").click();
  await page.locator("#favBtn").click();
  await page.locator("#favoriteLists").getByText("制作予定").click();
  await page.locator(".favorite-material-curtain-toggle").click();
  await sleep(250);
  await page
    .locator(".favorite-material-mode-group")
    .getByText("どれでも1つ")
    .click();
  await save(page, "13-favorite-any-one.webp");
  await page
    .locator("#recipeList")
    .getByText(/素材リストを表示/)
    .click();
  await save(page, "17-favorite-any-one-result.webp");
  await page.locator("#appTitle").click();
  await page.locator("#favBtn").click();
  await page.locator("#favoriteLists").getByText("制作予定").click();
  await page
    .locator("#recipeList")
    .getByText(/素材リストを表示/)
    .click();
  await save(page, "05-favorite-materials.webp", {
    x: 0.73,
    y: 0.22,
    radius: 44,
    text: "④ 合算を確認",
    labelDx: -250,
    labelDy: 65,
  });
  await page.locator("#appTitle").click();
  await page.locator("#favBtn").click();
  await save(page, "08-combined-lists.webp");
  const firstCombinedDesktop = page
    .locator("#favoriteLists li")
    .filter({ hasText: "制作予定" });
  const secondCombinedDesktop = page
    .locator("#favoriteLists li")
    .filter({ hasText: "納品用" });
  await firstCombinedDesktop.locator(".favorite-list-curtain-toggle").click();
  await save(page, "31-combined-checkbox.webp");
  await page.locator(".favorite-list-material-checkbox").nth(0).check();
  await save(page, "20-combined-first-selected.webp");
  await secondCombinedDesktop.locator(".favorite-list-curtain-toggle").click();
  await save(page, "32-combined-second-checkbox.webp");
  await page.locator(".favorite-list-material-checkbox").nth(1).check();
  await save(page, "21-combined-ready.webp");
  await page.locator("#checkedFavoriteMaterialsBtn").click();
  await save(page, "22-combined-result.webp");
  await page.locator("#settingsBtn").click();
  await save(page, "23-share-settings.webp");
  await page.locator("#exportListToggle").click();
  await page.locator("#exportListChoices").getByText("制作予定").click();
  await save(page, "06-share.webp");
  const shareCode = await page.locator("#exportCode").inputValue();
  await page.locator("#importCode").fill(shareCode);
  await save(page, "24-share-import.webp");
  await page.close();
}

async function captureMobile(browser) {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  await prepare(page);
  await page.locator("#equipmentSearchToggle").click();
  await chooseOption(page, "equipmentJobSelect", "ナイト");
  await page.locator("#equipmentLevelInput").fill("100");
  await page.locator("#equipmentLevelInput").dispatchEvent("input");
  await chooseOption(page, "equipmentItemLevelSelect", "770");
  await page.locator("#equipmentSearchBtn").click();
  await save(page, "mobile-25-equipment-results.webp");
  await page.locator("#appTitle").click();
  await save(page, "mobile-07-equipment-search-01.webp", {
    x: 0.91,
    y: 0.155,
    radius: 20,
    text: "① ▼をタップ",
    labelDx: -205,
    labelDy: 32,
  });
  await page.locator("#equipmentSearchToggle").click();
  await save(page, "mobile-07-equipment-search-02.webp", {
    x: 0.5,
    y: 0.35,
    radius: 34,
    text: "② 条件を指定",
    labelDx: -96,
    labelDy: 72,
  });
  await page.locator("#equipmentSearchToggle").click();
  await page.locator("#searchBox").fill("ブラスバスタードソード");
  await page.locator("#searchBox").blur();
  await page
    .locator("#recipeList li")
    .filter({ hasText: "ブラスバスタードソード" })
    .first()
    .waitFor();
  await save(page, "mobile-01-search-01.webp", {
    x: 0.46,
    y: 0.125,
    radius: 31,
    text: "① 名前を入力",
    labelDx: -96,
    labelDy: 72,
  });
  await page
    .locator("#recipeList li")
    .filter({ hasText: "ブラスバスタードソード" })
    .first()
    .click();
  await save(page, "mobile-01-search-02.webp", {
    x: 0.5,
    y: 0.3,
    radius: 34,
    text: "② レシピを確認",
    labelDx: -96,
    labelDy: 72,
  });
  await page.locator('.pin-btn[title="お気に入りに追加"]').first().click();
  await save(page, "mobile-11-favorite-target.webp");
  await page.locator("#favoriteTargetCreate").getByText("新規作成").click();
  await page.locator("#textInputField").fill("制作予定");
  await page.locator("#textInputOkBtn").click();
  await save(page, "mobile-12-favorite-registered.webp");
  await page.locator(".shop-info-btn:visible").first().click();
  await save(page, "mobile-18-shop-info.webp");
  await page.locator("#shopCloseBtn").click();
  await page.locator("#countInput").fill("3");
  await page.locator("#countInput").dispatchEvent("change");
  await save(page, "mobile-02-materials-01.webp", {
    x: 0.53,
    y: 0.174,
    radius: 28,
    text: "① 素材リストへ",
    labelDx: -190,
    labelDy: 70,
  });
  await page.locator("#materialsViewBtn").click();
  await save(page, "mobile-02-materials-02.webp", {
    x: 0.5,
    y: 0.33,
    radius: 34,
    text: "② 必要数を確認",
    labelDx: -96,
    labelDy: 72,
  });
  await page.locator("#mobileBackBtn").click();
  await page.locator("#searchBox").fill("山羊乳");
  await page.locator("#searchBox").blur();
  await save(page, "mobile-03-used-in-01.webp", {
    x: 0.46,
    y: 0.125,
    radius: 31,
    text: "① 素材名を入力",
    labelDx: -96,
    labelDy: 72,
  });
  await page
    .locator("#recipeList li")
    .filter({ hasText: "山羊乳" })
    .first()
    .click();
  await save(page, "mobile-03-used-in-02.webp", {
    x: 0.5,
    y: 0.3,
    radius: 34,
    text: "② 使用先を確認",
    labelDx: -96,
    labelDy: 72,
  });
  await page.locator("#mobileBackBtn").click();
  await page.locator("#searchBox").fill("ゴールドインゴット");
  await page.locator("#searchBox").blur();
  await page
    .locator("#recipeList li")
    .filter({ hasText: "ゴールドインゴット" })
    .first()
    .click();
  await page
    .locator('.gathering-timer-btn[title="金鉱の採集情報"]:visible')
    .click();
  await save(page, "mobile-19-gathering-time.webp");
  await page.locator("#gatheringCloseBtn").click();
  await page.locator("#mobileBackBtn").click();
  await setGuideFavorites(page);
  await save(page, "mobile-04-favorites-01.webp", {
    x: 0.5,
    y: 0.165,
    radius: 28,
    text: "① お気に入り",
    labelDx: -205,
    labelDy: 34,
  });
  await page.locator("#favBtn").click();
  const mobileList = page
    .locator("#favoriteLists li")
    .filter({ hasText: "制作予定" });
  await save(page, "mobile-26-favorite-list-overview.webp");
  await mobileList.locator(".favorite-list-curtain-toggle").click();
  await save(page, "mobile-27-favorite-list-actions.webp");
  await mobileList.locator('[title="名前変更"]').click();
  await save(page, "mobile-33-favorite-list-rename-input.webp");
  await page.locator("#textInputField").fill("制作メモ");
  await page.locator("#textInputOkBtn").click();
  await page.locator("#favBtn").click();
  await page.locator("#favoriteLists").getByText("制作メモ").waitFor();
  await saveElement(
    page,
    "mobile-28-favorite-list-renamed.webp",
    page.locator("#panelLeft"),
  );
  const renamedMobileList = page
    .locator("#favoriteLists li")
    .filter({ hasText: "制作メモ" });
  const mobileTargetList = page
    .locator("#favoriteLists li")
    .filter({ hasText: "納品用" });
  await renamedMobileList.locator(".favorite-list-curtain-toggle").click();
  await dragAfter(
    page,
    renamedMobileList.locator(".reorder-handle"),
    mobileTargetList,
  );
  await expectFavoriteOrder(page, "納品用", "制作メモ");
  await saveElement(
    page,
    "mobile-30-favorite-list-reordered.webp",
    page.locator("#panelLeft"),
  );
  const reorderedMobileList = page
    .locator("#favoriteLists li")
    .filter({ hasText: "制作メモ" });
  await reorderedMobileList.locator('[title="削除"]').click();
  await save(page, "mobile-29-favorite-list-delete.webp");
  await page.locator("#confirmYes").click();
  await page
    .locator("#favoriteLists")
    .getByText("制作メモ")
    .waitFor({ state: "detached" });
  await page.locator("#favBtn").click();
  await page.locator("#favoriteLists").getByText("納品用").waitFor();
  await saveElement(
    page,
    "mobile-34-favorite-list-deleted.webp",
    page.locator("#panelLeft"),
  );
  await setGuideFavorites(page);
  await page.locator("#favBtn").click();
  await page.locator("#favoriteLists").getByText("制作予定").click();
  await page.locator(".favorite-material-curtain-toggle").click();
  await page.locator(".favorite-material-mode-group").waitFor();
  await sleep(250);
  await save(page, "mobile-09-favorite-extensions.webp");
  await page
    .locator(".favorite-material-mode-group")
    .getByText("並び替え")
    .click();
  await save(page, "mobile-15-favorite-reorder.webp");
  const reorderHandles = page.locator("#recipeList .reorder-handle");
  const firstHandle = await reorderHandles.nth(0).boundingBox();
  const secondHandle = await reorderHandles.nth(1).boundingBox();
  await page.mouse.move(
    firstHandle.x + firstHandle.width / 2,
    firstHandle.y + firstHandle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    secondHandle.x + secondHandle.width / 2,
    secondHandle.y + secondHandle.height,
    { steps: 8 },
  );
  await page.mouse.up();
  await save(page, "mobile-16-favorite-reordered.webp");
  await page
    .locator(".favorite-material-mode-group")
    .getByText("並び替え")
    .click();
  await page
    .locator(".favorite-material-mode-group")
    .getByText("個数指定")
    .click();
  await save(page, "mobile-10-favorite-counts.webp");
  await page
    .locator("#recipeList")
    .getByText(/素材リストを表示/)
    .click();
  await save(page, "mobile-14-favorite-count-result.webp");
  await page.locator("#mobileBackBtn").click();
  await page
    .locator(".favorite-material-mode-group")
    .getByText("個数指定")
    .click();
  await page
    .locator(".favorite-material-mode-group")
    .getByText("どれでも1つ")
    .click();
  await save(page, "mobile-13-favorite-any-one.webp");
  await page
    .locator("#recipeList")
    .getByText(/素材リストを表示/)
    .click();
  await save(page, "mobile-17-favorite-any-one-result.webp");
  await page.locator("#mobileBackBtn").click();
  await page
    .locator(".favorite-material-mode-group")
    .getByText("どれでも1つ")
    .click();
  await save(page, "mobile-05-favorite-materials-01.webp", {
    x: 0.5,
    y: 0.31,
    radius: 31,
    text: "③ 素材を合算",
    labelDx: -96,
    labelDy: 72,
  });
  await page
    .locator("#recipeList")
    .getByText(/素材リストを表示/)
    .click();
  await save(page, "mobile-05-favorite-materials-02.webp", {
    x: 0.5,
    y: 0.32,
    radius: 34,
    text: "④ 合算を確認",
    labelDx: -96,
    labelDy: 72,
  });
  await page.locator("#mobileBackBtn").click();
  await page.locator("#appTitle").click();
  await page.locator("#favBtn").click();
  await save(page, "mobile-08-combined-lists-01.webp", {
    x: 0.93,
    y: 0.245,
    radius: 19,
    text: "① 2つ選択",
    labelDx: -210,
    labelDy: 50,
  });
  const firstCombinedMobile = page
    .locator("#favoriteLists li")
    .filter({ hasText: "制作予定" });
  const secondCombinedMobile = page
    .locator("#favoriteLists li")
    .filter({ hasText: "納品用" });
  await firstCombinedMobile.locator(".favorite-list-curtain-toggle").click();
  await save(page, "mobile-31-combined-checkbox.webp");
  await page.locator(".favorite-list-material-checkbox").nth(0).check();
  await save(page, "mobile-20-combined-first-selected.webp");
  await secondCombinedMobile.locator(".favorite-list-curtain-toggle").click();
  await save(page, "mobile-32-combined-second-checkbox.webp");
  await page.locator(".favorite-list-material-checkbox").nth(1).check();
  await save(page, "mobile-08-combined-lists-02.webp");
  await page.locator("#checkedFavoriteMaterialsBtn").click();
  await save(page, "mobile-22-combined-result.webp");
  await page.locator("#settingsBtn").click();
  await save(page, "mobile-06-share-01.webp", {
    x: 0.5,
    y: 0.42,
    radius: 30,
    text: "① 共有を開く",
    labelDx: -96,
    labelDy: 72,
  });
  await page.locator("#exportListToggle").click();
  await page.locator("#exportListChoices").getByText("制作予定").click();
  await save(page, "mobile-06-share-02.webp", {
    x: 0.5,
    y: 0.48,
    radius: 34,
    text: "② コードをコピー",
    labelDx: -96,
    labelDy: 72,
  });
  const mobileShareCode = await page.locator("#exportCode").inputValue();
  await page.locator("#importCode").fill(mobileShareCode);
  await save(page, "mobile-24-share-import.webp");
  await page.close();
}

async function verifyGeneratedGuideImages() {
  const html = await readFile(
    path.join(root, "site", "guide", "index.html"),
    "utf8",
  );
  const references = [...html.matchAll(/assets\/images\/([^"|]+\.webp)/g)].map(
    (match) => match[1],
  );
  for (const name of new Set(references)) {
    const webpPath = path.join(output, name);
    const pngPath = path.join(sourceOutput, name.replace(/\.webp$/i, ".png"));
    await access(webpPath);
    await access(pngPath);
    const [webp, png] = await Promise.all([
      sharp(webpPath).metadata(),
      sharp(pngPath).metadata(),
    ]);
    if (webp.width !== png.width || webp.height !== png.height) {
      throw new Error(`${name}: PNGとWebPの寸法が一致しません`);
    }
  }
  const generated = (await readdir(output)).filter((name) =>
    name.endsWith(".webp"),
  );
  const unused = generated.filter((name) => !references.includes(name));
  if (unused.length)
    throw new Error(`未参照のガイド画像: ${unused.join(", ")}`);
}

try {
  await waitForServer();
  const browser = await chromium.launch();
  await captureDesktop(browser);
  await captureMobile(browser);
  await browser.close();
  await verifyGeneratedGuideImages();
  console.log(`ガイド画像を ${output} に生成しました。`);
} finally {
  server.kill();
}
