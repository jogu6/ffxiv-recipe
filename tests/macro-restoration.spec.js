const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { openApp, searchFor } = require('./helpers/app.js');
const itemDocument = JSON.parse(fs.readFileSync(path.join(__dirname, '../site/data/Item.json'), 'utf8'));
const result = {
  recipeId: 'b5cc569f3e4', dataVersion: `${itemDocument.Version}:${itemDocument.DataGeneration}`,
  engineVersion: '0.28.6.7',
  crafter: { level: 100, craftsmanship: 5655, control: 5399, cp: 664,
    manipulation: true, heartAndSoul: false, quickInnovation: false },
  selection: { foodId: 'ロネークステーキ:hq', medicineId: null,
    hqIngredientIds: ['高山食塩', 'ペリラオイル'] },
  generatedAt: '2026-09-09T10:20:30.000Z', macro: '/ac "確信" <wait.3>\n/ac "下地作業" <wait.3>'
};
async function snapshot(macro) {
  return macro.locator('body').evaluate(() => ({
    food: document.querySelector('#foodCurrent').textContent,
    medicine: document.querySelector('#medicineCurrent').textContent,
    hq: [...document.querySelectorAll('#ingredientList [aria-label$="すべてHQ"]')].map(e => e.getAttribute('aria-pressed')),
    accordions: [...document.querySelectorAll('.accordion-toggle')].map(e => [e.textContent.trim(), e.getAttribute('aria-expanded')]),
    scrollTop: document.querySelector('#macroContent').scrollTop,
    macro: document.querySelector('#macroOutput').value,
    resultVisible: !document.querySelector('#macroSection').hidden,
    savedDraft: localStorage.getItem('xivca.macro.selection.v1.b5cc569f3e4'),
    cp: document.querySelector('#cp').value,
    job: document.querySelector('#job').value
  }));
}
for (const width of [390, 1280]) test(`マクロパネルの選択・開閉・位置を復元する ${width}px`, async ({ page }, testInfo) => {
  test.setTimeout(60000);
  await page.addInitScript(result => {
    if (localStorage.getItem('audit.seeded')) return;
    localStorage.setItem('audit.seeded', '1');
    localStorage.setItem('xivca.macro.crafter-status.v1', JSON.stringify({ 調理師: result.crafter }));
    localStorage.setItem(`xivca.macro.result.v1.${result.recipeId}`, JSON.stringify(result));
  }, result);
  await openApp(page, width, 800);
  await searchFor(page, 'アリペブレ');
  await page.locator('#recipeList').getByText('アリペブレ', { exact: true }).first().click();
  await page.locator('.result-root-summary .macro-launch-btn').click();
  const macro = page.frameLocator('#macroFrame');
  await expect(macro.locator('#macroOutput')).toHaveValue(result.macro);
  const initial = await snapshot(macro);
  expect(initial.food).toContain('ロネークステーキ');
  expect(initial.hq).toEqual(['true', 'true']);
  await macro.locator('.accordion-toggle').filter({ hasText: '食事リスト' }).click();
  await macro.locator('#foodList .choice[data-id="ロネークステーキ:hq"]').click();
  await macro.locator('.accordion-toggle').filter({ hasText: '薬品リスト' }).click();
  await macro.locator('#medicineList .consumable-choice').first().click();
  for (const button of await macro.locator('#ingredientList [aria-label$="すべてHQ"]').all()) await button.click();
  await macro.locator('#crafterStatusSection .accordion-toggle').click();
  await macro.locator('#cp').fill('665');
  await macro.locator('#cp').fill('664');
  await expect(macro.locator('#macroSection')).toBeHidden();
  const edited = await snapshot(macro);
  await page.reload();
  await expect(macro.locator('#medicineCurrent')).not.toHaveText('使用しない');
  await expect(macro.locator('#macroSection')).toBeHidden();
  const restoredEdit = await snapshot(macro);
  expect(restoredEdit.food).toBe(edited.food);
  expect(restoredEdit.medicine).toBe(edited.medicine);
  expect(restoredEdit.hq).toEqual(edited.hq);
  // Returning to the result's conditions makes that result available again.
  await macro.locator('.accordion-toggle').filter({ hasText: '薬品リスト' }).click();
  await macro.locator('#medicineList .choice[data-id=""]').click();
  await expect(macro.locator('#macroSection')).toBeVisible();
  await macro.locator('#generatedStatusSection .accordion-toggle').click();
  await macro.locator('#macroSection .accordion-toggle').click();
  await macro.locator('#macroContent').evaluate(e => { e.scrollTop = e.scrollHeight; });
  await page.waitForTimeout(700);
  const before = await snapshot(macro);
  await page.reload();
  await expect(page.locator('#loadingOverlay')).not.toHaveClass(/open/);
  await expect(macro.locator('#macroOutput')).toHaveValue(result.macro);
  await page.waitForTimeout(700);
  const after = await snapshot(macro);
  expect(before.food).toContain('ロネークステーキ');
  expect(before.medicine).toBe('使用しない');
  expect(before.hq.every(value => value === 'true')).toBe(true);
  expect(after.food).toBe(before.food);
  expect(after.medicine).toBe(before.medicine);
  expect(after.hq).toEqual(before.hq);
  expect(after.savedDraft).not.toBeNull();
  expect(after.cp).toBe('664');
  expect(after.accordions).toEqual(before.accordions);
  expect(Math.abs(after.scrollTop - before.scrollTop)).toBeLessThanOrEqual(2);
  // The editor may be on a different job from the recipe.
  await macro.locator('#jobToggle').click();
  await macro.locator('#jobChoices [data-job="錬金術師"]').click();
  await macro.locator('#cp').fill('555');
  await page.reload();
  await expect(macro.locator('#job')).toHaveValue('錬金術師');
  await expect(macro.locator('#cp')).toHaveValue('555');
  const audit = { width, initial, before, after };
  fs.writeFileSync(testInfo.outputPath('restoration.json'), JSON.stringify(audit, null, 2));
});

test('未生成の選択とリスト内位置を新しいページでも復元する', async ({ page, context }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const url = '/macro-app/web/index.html?siteRoot=../..&recipe=b5cc569f3e4';
  await page.goto(url);
  await expect(page.locator('#recipeInfo')).toContainText('アリペブレ');
  await page.locator('.accordion-toggle').filter({ hasText: '食事リスト' }).click();
  await page.locator('#foodList .consumable-choice').first().click();
  await page.locator('.accordion-toggle').filter({ hasText: '薬品リスト' }).click();
  await page.locator('#medicineList .consumable-choice').first().click();
  await page.locator('#ingredientList [aria-label$="すべてHQ"]').first().click();
  await page.locator('.accordion-toggle').filter({ hasText: '食事リスト' }).click();
  await page.locator('.accordion-toggle').filter({ hasText: '薬品リスト' }).click();
  await page.locator('#foodList').evaluate(e => { e.scrollTop = 200; });
  await expect.poll(() => page.locator('#foodList').evaluate(e => e.scrollTop)).toBe(200);
  const before = await snapshot(page);
  await page.goto('about:blank');
  const nextPage = await context.newPage();
  await nextPage.goto(url);
  await expect(nextPage.locator('#foodCurrent')).toHaveText(before.food);
  await expect(nextPage.locator('#medicineCurrent')).toHaveText(before.medicine);
  await expect.poll(() => nextPage.locator('#foodList').evaluate(e => e.scrollTop)).toBe(200);
  const after = await snapshot(nextPage);
  expect(after.hq).toEqual(before.hq);
  expect(after.accordions).toEqual(before.accordions);
  await expect(nextPage.locator('#macroSection')).toBeHidden();
  await nextPage.close();
});
