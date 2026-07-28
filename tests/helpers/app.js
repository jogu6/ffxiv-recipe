const { expect } = require('@playwright/test');

async function openApp(page, width = 900, height = 700) {
  await page.setViewportSize({ width, height });
  await page.goto('/');
  await expect(page.locator('#loadStatus')).toContainText(/patch/);
  await expect(page.locator('#loadingOverlay')).not.toHaveClass(/open/);
}

async function searchFor(page, value) {
  await page.locator('#searchBox').fill(value);
  if ([...value].length < 3) await page.locator('#searchBox').blur();
  await expect(page.locator('#recipeList li').first()).toContainText(value);
}

async function routeMirageRecipeVariants(page, { parentName = '', includeVariantMaterial = true } = {}) {
  await page.route('**/data/Item.json*', async route => {
    const response = await route.fetch();
    const items = await response.json();
    const target = items.find(item => item.Name === 'ミラージュプリズム');
    const itemId = name => items.find(item => item.Name === name).ID;
    const materials = [
      ['ウォルナット材', '0e351054234'],
      ['スチールインゴット', 'a0d2fcedeb3'],
      ['スチールリベット', 'bf5ee3e37ca'],
      ['シルバーインゴット', 'eaddf83f1d9'],
      ['ギガントードレザー', 'e333e776c67'],
      ['別珍', 'f25d440fc89'],
      ['グロースフォーミュラ・ガンマ', '169de6ea318']
    ];
    target.Recipes = target.CraftInfo.map((craftInfo, index) => ({
      RecipeID: materials[index][1],
      CraftType: String(index),
      CraftInfo: craftInfo,
      AmountResult: '1',
      Ingredients: [
        { ItemID: itemId('クリアプリズム'), Name: 'クリアプリズム', Amount: '1' },
        ...(includeVariantMaterial
          ? [{ ItemID: itemId(materials[index][0]), Name: materials[index][0], Amount: '2' }]
          : [])
      ]
    }));
    if (parentName) {
      const parent = items.find(item => item.Name === parentName);
      parent.Recipe.Ingredients = [{ ItemID: target.ID, Name: target.Name, Amount: '1' }];
    }
    await route.fulfill({ response, json: items });
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
  const appeared = await overlay
    .waitFor({ state: 'visible', timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return;
  await page.locator('#confirmNo').click();
  await expect(overlay).not.toBeVisible();
}

module.exports = {
  chooseCustomOption,
  closeSharePlaza,
  dismissInfoDialog,
  dragHandleAfter,
  importFavoriteFromPlaza,
  openApp,
  routeMirageRecipeVariants,
  searchFor
};
