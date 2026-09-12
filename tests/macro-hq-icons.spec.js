const { expect, test } = require('@playwright/test');
const { openApp, searchFor } = require('./helpers/app.js');

test('マクロのHQ画像を選択状態に合わせて切り替え、NQと元画像を共有する', async ({ page }, testInfo) => {
  await openApp(page, 1200, 850);
  await searchFor(page, 'アリペブレ');
  await page.locator('#recipeList').getByText('アリペブレ', { exact: true }).first().click();
  const launch = page.locator('.result-root-summary .macro-launch-btn');
  await expect(launch).toBeEnabled({ timeout: 30000 });
  await launch.click();
  const macro = page.frameLocator('#macroFrame');
  await expect(macro.locator('#recipeInfo .item-icon-frame')).toHaveClass(/is-hq/);
  const ingredient = macro.locator('#ingredientList .item-row').first();
  const ingredientIcon = ingredient.locator('.item-icon-frame');
  await expect(ingredientIcon).not.toHaveClass(/is-hq/);
  await ingredient.getByRole('button', { name: /すべてHQ$/ }).click();
  await expect(ingredientIcon).toHaveClass(/is-hq/);
  await ingredient.getByRole('button', { name: /はNQ$/ }).click();
  await expect(ingredientIcon).not.toHaveClass(/is-hq/);

  for (const kind of ['food', 'medicine']) {
    await macro.getByRole('button', { name: kind === 'food' ? '食事リスト' : '薬品リスト' }).click();
    const hq = macro.locator(`#${kind}List .consumable-choice[data-id$=":hq"]`).first();
    const id = await hq.getAttribute('data-id');
    const nq = macro.locator(`#${kind}List .consumable-choice`).filter({ has: macro.locator('.item-icon-frame:not(.is-hq)') })
      .filter({ hasText: id.slice(0, -3) }).first();
    await expect(hq.locator('.item-icon-frame')).toHaveClass(/is-hq/);
    await expect(nq.locator('.item-icon-frame')).not.toHaveClass(/is-hq/);
    await expect.poll(() => hq.locator('.item-icon').evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
    expect(await nq.locator('.item-icon').getAttribute('src')).toBe(await hq.locator('.item-icon').getAttribute('src'));
    await hq.screenshot({ path: testInfo.outputPath(`${kind}-hq.png`) });
    await nq.screenshot({ path: testInfo.outputPath(`${kind}-nq.png`) });
    if (kind === 'food') {
      for (const [quality, button] of [['hq', hq], ['nq', nq]]) {
        const icon = button.locator('.item-icon-frame');
        await icon.evaluate(element => element.style.setProperty('--item-icon-size', '128px'));
        await icon.screenshot({ path: testInfo.outputPath(`food-${quality}-128.png`) });
        if (quality === 'hq') {
          await icon.evaluate(element => element.classList.remove('is-hq'));
          await icon.screenshot({ path: testInfo.outputPath('food-hq-base-128.png') });
          await icon.evaluate(element => element.classList.add('is-hq'));
        }
        await icon.evaluate(element => element.style.removeProperty('--item-icon-size'));
      }
    }
    await hq.click();
    await expect(macro.locator(`#${kind}Current .item-icon-frame`)).toHaveClass(/is-hq/);
    await macro.getByRole('button', { name: kind === 'food' ? '食事リスト' : '薬品リスト' }).click();
    await nq.click();
    await expect(macro.locator(`#${kind}Current .item-icon-frame`)).not.toHaveClass(/is-hq/);
  }
});
