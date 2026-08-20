const { closeSync, openSync, readFileSync, readSync } = require('node:fs');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { expect } = require('@playwright/test');

let publishedItemJsonPromise;

function readFilePrefix(file, maximumBytes = 512) {
  const descriptor = openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(maximumBytes);
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0);
    return buffer.toString('utf8', 0, bytesRead);
  } finally {
    closeSync(descriptor);
  }
}

const publishedItemPath = path.resolve(__dirname, '../../site/data/Item.json');
const publishedItemPrefix = readFilePrefix(publishedItemPath);
const publishedDataVersion = publishedItemPrefix.match(/^\{"Version":"([^"]+)"/u)?.[1] || '';
const publishedServiceWorker = readFileSync(path.resolve(__dirname, '../../site/sw.js'), 'utf8');
const publishedAppVersion = publishedServiceWorker.match(
  /const\s+APP_CACHE_VERSION\s*=\s*['"][^'"]*?(v\d+(?:\.\d+)*)[^'"]*['"]/iu
)?.[1] || '';
const publishedPatchStatus = `patch ${publishedDataVersion} 対応`;

if (!publishedDataVersion || !publishedAppVersion) {
  throw new Error('公開データまたはアプリのバージョンを正本から取得できません。');
}

async function loadPublishedItems() {
  publishedItemJsonPromise ||= readFile(
    publishedItemPath,
    'utf8'
  );
  return JSON.parse(await publishedItemJsonPromise).Items;
}

async function openApp(page, width = 900, height = 700) {
  await page.setViewportSize({ width, height });
  await page.goto('/');
  await expect(page.locator('#loadStatus')).toHaveText(/patch \d+\.\d+ 対応/);
  await expect(page.locator('#loadingOverlay')).not.toHaveClass(/open/);
}

async function searchFor(page, value) {
  await page.locator('#searchBox').fill(value);
  if ([...value].length < 3) await page.locator('#searchBox').blur();
  await expect(page.locator('#recipeList li').first()).toContainText(value);
}

async function routeMirageRecipeVariants(page, { parentName = '', includeVariantMaterial = true } = {}) {
  await page.route('**/data/Item.json*', async route => {
    const items = await loadPublishedItems();
    const target = items.find(item => item.Name === 'ミラージュプリズム');
    const materials = [
      ['ウォルナット材', '0e351054234'],
      ['スチールインゴット', 'a0d2fcedeb3'],
      ['スチールリベット', 'bf5ee3e37ca'],
      ['シルバーインゴット', 'eaddf83f1d9'],
      ['ギガントードレザー', 'e333e776c67'],
      ['別珍', 'f25d440fc89'],
      ['グロースフォーミュラ・ガンマ', '169de6ea318']
    ];
    const craftInfoList = (target.Recipes || [target.Recipe]).map(recipe => recipe.CraftInfo);
    target.Recipes = craftInfoList.map((craftInfo, index) => ({
      RecipeKey: materials[index][1],
      CraftType: String(index),
      CraftInfo: craftInfo,
      AmountResult: '1',
      Ingredients: [
        { Name: 'クリアプリズム', Amount: '1' },
        ...(includeVariantMaterial
          ? [{ Name: materials[index][0], Amount: '2' }]
          : [])
      ]
    }));
    target.Recipe = target.Recipes[0];
    if (parentName) {
      const parent = items.find(item => item.Name === parentName);
      parent.Recipe.Ingredients = [{ Name: target.Name, Amount: '1' }];
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ Version: publishedDataVersion, Items: items })
    });
  });
}

async function chooseCustomOption(page, selectId, value) {
  const select = page.locator(`#${selectId}`);
  if ((await select.getAttribute('data-value')) === value) return;
  await select.locator('.custom-select-toggle').click();
  await select.locator(`.custom-select-option[data-value="${value}"]`).click();
}

async function importFavoriteFromPlaza(page, code, name) {
  await page.locator('#settingsBtn').click();
  await page.locator('#sharePlazaOpenBtn').click();
  await expect(page.locator('#sharePlazaOverlay')).toHaveClass(/open/);
  await page.evaluate(importCode => {
    const frame = document.querySelector('#sharePlazaFrame');
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'http://127.0.0.1:4174',
        source: frame.contentWindow,
        data: { type: 'ffxiv-share-code-import', code: importCode }
      })
    );
  }, code);
  await expect(page.locator('#textInputOverlay')).toHaveClass(/open/);
  await page.locator('#textInputField').fill(name);
  await page.locator('#textInputOkBtn').click();
}

async function closeSharePlaza(page) {
  await page.evaluate(() => {
    const frame = document.querySelector('#sharePlazaFrame');
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'http://127.0.0.1:4174',
        source: frame.contentWindow,
        data: { type: 'ffxiv-share-code-plaza-close' }
      })
    );
  });
  await expect(page.locator('#sharePlazaOverlay')).not.toHaveClass(/open/);
}

async function dragHandleAfter(page, handle, targetRow) {
  const handleBox = await handle.boundingBox();
  const targetBox = await targetRow.boundingBox();
  if (!handleBox || !targetBox) throw new Error('Cannot drag invisible reorder handle');

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height * 0.85, { steps: 6 });
  await page.mouse.up();
}

async function dismissInfoDialog(page) {
  const overlay = page.locator('#confirmOverlay.info.open');
  if (!(await overlay.isVisible())) return;
  await page.locator('#confirmNo').click();
  await expect(overlay).not.toBeVisible();
}

async function beginSwipe(page, locator, fromRatio, toRatio) {
  await page.waitForFunction(() => !document.querySelector('.main')?.swiper?.animating);
  const box = await locator.boundingBox();
  if (!box) throw new Error('Cannot swipe an invisible element');
  const client = page.__touchClient || await page.context().newCDPSession(page);
  page.__touchClient = client;
  const y = Math.max(box.y + 8, Math.min(box.y + box.height - 8, box.y + 120));
  const point = ratio => ({ x: box.x + box.width * ratio, y });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [point(fromRatio)]
  });
  for (let step = 1; step <= 8; step += 1) {
    const ratio = fromRatio + ((toRatio - fromRatio) * step) / 8;
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [point(ratio)]
    });
  }
}

async function endSwipe(page) {
  const client = page.__touchClient;
  if (!client) throw new Error('Cannot finish a swipe that has not started');
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: []
  });
  await page.waitForFunction(() => !document.querySelector('.main')?.swiper?.animating);
}

async function swipe(page, locator, fromRatio, toRatio) {
  await beginSwipe(page, locator, fromRatio, toRatio);
  await endSwipe(page);
}

module.exports = {
  beginSwipe,
  chooseCustomOption,
  closeSharePlaza,
  dismissInfoDialog,
  dragHandleAfter,
  endSwipe,
  importFavoriteFromPlaza,
  loadPublishedItems,
  openApp,
  publishedAppVersion,
  publishedDataVersion,
  publishedPatchStatus,
  routeMirageRecipeVariants,
  searchFor,
  swipe
};
