const { expect, test } = require('@playwright/test');
const { openApp, searchFor, chooseCustomOption } = require('./helpers/app.js');
const { writeFile } = require('node:fs/promises');

async function saveReport(testInfo, name, report) {
  const path = testInfo.outputPath(`${name}.txt`);
  await writeFile(path, report.diagnostics, 'utf8');
  await testInfo.attach(name, { path, contentType: 'text/plain' });
}

async function interceptReports(page) {
  const reports = [];
  await page.route('https://xivca-bug-report.jun1-ogu6.workers.dev/**', async route => {
    const request = route.request();
    if (request.method() === 'POST') {
      const type = request.headers()['content-type'];
      if (type.startsWith('multipart/')) {
        const form = await new Response(request.postDataBuffer(), { headers: { 'Content-Type': type } }).formData();
        const files = await Promise.all(form.getAll('screenshots').map(async file => ({
          name: file.name, type: file.type, bytes: Buffer.from(await file.arrayBuffer())
        })));
        reports.push({ description: form.get('description'), diagnostics: form.get('diagnostics'), files });
      } else reports.push({ ...request.postDataJSON(), files: [] });
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}', headers: {
      'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    } });
  });
  return reports;
}

async function settingsInquiry(page) {
  await page.locator('#settingsBtn').click();
  await page.locator('#inquiryBtn').click();
  await expect(page.locator('#bugReportDialog')).toBeVisible();
}

test('お問い合わせの本文とファイル選択欄は設定倍率に追従する', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ff14_font_size_level_v2', '1'));
  await openApp(page, 1200, 900);
  await settingsInquiry(page);
  await page.locator('#bugReportText').fill('倍率を変更しても保持する本文');
  const selectors = ['#bugReportTitle', '#bugReportText', '#bugReportFiles', '#bugReportPreview'];
  const sizes = () => page.evaluate(selectors => selectors.map(selector =>
    parseFloat(getComputedStyle(document.querySelector(selector)).fontSize)), selectors);
  const small = await sizes();
  await page.locator('[data-report-cancel]').click();
  await page.locator('#settingsDisplayTab').click();
  await page.locator('#fontSizeLevelInput').fill('10');
  await page.locator('#fontSizeApplyBtn').click();
  await settingsInquiry(page);
  const large = await sizes();
  large.forEach((size, index) => expect(size / small[index]).toBeCloseTo(1.7 / 0.8, 2));
  expect(await page.locator('#bugReportFiles').evaluate(element =>
    parseFloat(getComputedStyle(element, '::file-selector-button').fontSize)))
    .toBeCloseTo(large[2], 2);
});

async function sendReport(page, text = '表示についての問い合わせ') {
  await page.locator('#bugReportText').fill(text);
  await page.locator('#bugReportNext').click();
  await page.locator('#bugReportSubmit').click();
  await expect(page.locator('#bugReportStatus')).toContainText('送信が完了しました');
}

test('設定からマクロを開かず問い合わせでき、未使用パネルと保存済みマクロを送らない', async ({ page }, testInfo) => {
  const reports = await interceptReports(page);
  await page.addInitScript(() => localStorage.setItem('xivca.macro.result.v1.test', '保存済みマクロの識別用文字列'));
  await openApp(page);
  await settingsInquiry(page);
  await expect(page.locator('#contactBtn')).toHaveCount(0);
  const position = await page.evaluate(() => ({
    inquiry: document.getElementById('inquiryBtn').getBoundingClientRect().bottom,
    close: document.getElementById('settingsCloseBtn').getBoundingClientRect().top
  }));
  expect(position.inquiry).toBeLessThanOrEqual(position.close);
  await expect(page.locator('#bugReportTitle')).toHaveText('不具合・その他お問い合わせ');
  await expect(page.locator('#bugReportIntroduction a[href="https://x.com/ff14_recipe"]')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('inquiry-desktop.png') });
  await sendReport(page);
  expect(reports).toHaveLength(1);
  expect(reports[0].diagnostics).not.toMatch(/【左パネル】|【中央パネル】|【右パネル】|【マクロパネル】|保存済みマクロの識別用文字列/);
  expect(reports[0].files).toHaveLength(0);
  await expect(page.locator('#macroFrame')).toHaveAttribute('src', 'about:blank');
});

test('ティターニアの検索・使用先・レシピツリーを項目別に送信する', async ({ page }, testInfo) => {
  const reports = await interceptReports(page);
  await openApp(page, 1495, 718);
  await searchFor(page, 'ティターニア');
  await page.locator('#recipeList li').filter({ hasText: 'ティターニアの羽根' }).locator('.uses-list-btn').click();
  await page.locator('#usesList').getByText('フェアリーキングアクス', { exact: true }).click();
  const launch = page.locator('.result-root-summary .macro-launch-btn');
  await expect(launch).toBeEnabled({ timeout: 30000 });
  await launch.click();
  const macro = page.frameLocator('#macroFrame');
  await expect(macro.locator('#recipeInfo')).toContainText('フェアリーキングアクス', { timeout: 30000 });
  const snapshot = await page.evaluate(() => captureInquiryDiagnostics());
  expect(snapshot.左パネル.検索結果数).toBe(3);
  expect(snapshot.左パネル.検索結果.map(item => item.アイテム)).toEqual([
    'ティターニア・バード', 'ティターニアの羽根', 'ティターニアの壁掛け'
  ]);
  expect(snapshot.中央パネル.使用先).toContainEqual({
    アイテム: 'フェアリーキングアクス', レシピID: '79d9a30d97a', 選択中: true
  });
  expect(snapshot.右パネル.表示内容).toContain('・フェアリーキングアクス ×1');
  expect(snapshot.右パネル.表示内容).toContain('\n・タングステンスチールインゴット ×3');
  expect(snapshot.右パネル.製作方法の選択).toEqual(expect.arrayContaining([
    expect.objectContaining({ アイテム: 'タングステンスチールインゴット', レシピID: expect.any(String) })
  ]));
  expect(Object.values(snapshot.右パネル.ピン留め).every(value => typeof value === 'boolean')).toBe(true);
  expect(snapshot.右パネル.レシピツリーの開閉.length).toBeGreaterThan(0);
  await macro.locator('#bugReportButton').click();
  await sendReport(page);
  expect(reports[0].diagnostics).toContain('表示内容：\n  ・ティターニア・バード');
  expect(reports[0].diagnostics).toContain('\n  ・ティターニアの羽根');
  expect(reports[0].diagnostics).toContain('検索結果：\n  1. アイテム：ティターニア・バード');
  expect(reports[0].diagnostics).toContain('表示倍率：100%');
  await saveReport(testInfo, 'titania-report', reports[0]);
});

test('装備検索の結果と入力中の条件を分けて報告する', async ({ page }, testInfo) => {
  const reports = await interceptReports(page);
  await openApp(page);
  await page.locator('#equipmentSearchToggle').click();
  await chooseCustomOption(page, 'equipmentJobSelect', 'ナイト');
  await page.locator('#equipmentLevelInput').fill('100');
  await page.locator('#equipmentLevelInput').dispatchEvent('input');
  await chooseCustomOption(page, 'equipmentItemLevelSelect', '770');
  await page.locator('#equipmentSearchBtn').click();
  await expect(page.locator('#recipeList')).toContainText('コートリーラヴァー・ソード');
  const names = await page.locator('#recipeList > .item-cell-row').evaluateAll(rows => rows.map(row => row.title));
  await page.locator('#equipmentLevelInput').fill('90');
  await page.locator('#equipmentLevelInput').dispatchEvent('input');
  const snapshot = await page.evaluate(() => captureInquiryDiagnostics());
  expect(snapshot.左パネル.検索結果.map(item => item.アイテム)).toEqual(names);
  expect(snapshot.左パネル.装備検索.入力中の条件.装備レベル).toBe('90');
  expect(snapshot.左パネル.装備検索.結果の検索条件).toMatchObject({ ジョブ: 'ナイト', 装備レベル: '100', アイテムレベル: '770' });
  expect(snapshot.左パネル).not.toHaveProperty('お気に入り');
  await settingsInquiry(page);
  await sendReport(page);
  await saveReport(testInfo, 'equipment-report', reports[0]);
});

test('お気に入りの個数指定・どれか1アイテム・セット数・倍率を報告する', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const reports = await interceptReports(page);
  await openApp(page);
  await page.evaluate(() => {
    const list = createFavoriteList('診断用のお気に入り', ['アリペブレ', 'カッパーリング']);
    selectFavoriteList(list.id);
  });
  await page.locator('#recipeList').getByText('素材リストを表示', { exact: true }).click();
  await page.locator('.favorite-ring-toggle button').filter({ hasText: '2つ' }).click();
  await page.locator('.favorite-material-curtain-toggle').click();
  await page.locator('.favorite-material-curtain-actions').getByText('個数指定', { exact: true }).click();
  const aripebre = page.locator('#recipeList .fav-item-row').filter({ hasText: 'アリペブレ' });
  await aripebre.locator('input.count-input').fill('0');
  await aripebre.locator('input.count-input').dispatchEvent('change');
  let snapshot = await page.evaluate(() => captureInquiryDiagnostics());
  expect(snapshot.左パネル.お気に入り.計算モード).toBe('個数指定');
  expect(snapshot.左パネル.お気に入り.アイテム[0]).toMatchObject({ 名前: 'アリペブレ', 指定数量: 0, 計算対象: false });
  expect(snapshot.右パネル.お気に入りリスト[0].リスト名).toBe('診断用のお気に入り');
  expect(snapshot.右パネル.指輪の個数).toEqual({ カッパーリング: 2 });
  await settingsInquiry(page);
  await sendReport(page);
  await saveReport(testInfo, 'favorite-counts-report', reports[0]);
  await page.locator('[data-report-cancel]').click();
  await page.locator('#settingsCloseBtn').click();
  await page.locator('.favorite-material-curtain-actions').getByText('どれか1アイテム', { exact: true }).click();
  await page.locator('.favorite-material-curtain-actions').getByText('全てOn', { exact: true }).click();
  await aripebre.locator('input[type="checkbox"]').uncheck();
  await page.locator('#countInput').fill('2');
  await page.locator('#countInput').dispatchEvent('input');
  await page.locator('#countInput').blur();
  await page.evaluate(() => fontSizeSettings.applyLevel(5));
  snapshot = await page.evaluate(() => captureInquiryDiagnostics());
  expect(snapshot.左パネル.お気に入り.計算モード).toBe('どれか1アイテム');
  expect(snapshot.左パネル.お気に入り.アイテム[0].計算対象).toBe(false);
  expect(snapshot.左パネル.お気に入り.アイテム[1].計算対象).toBe(true);
  expect(snapshot.右パネル.製作数).toBe('2');
  expect(snapshot.アプリ情報.表示倍率).toBe('120%');
  await settingsInquiry(page);
  await sendReport(page);
  await saveReport(testInfo, 'favorite-any-item-report', reports[1]);
});

test('複数お気に入りの合算とどれか1リストの対象を報告する', async ({ page }, testInfo) => {
  const reports = await interceptReports(page);
  await openApp(page);
  await page.evaluate(() => {
    const first = createFavoriteList('対象リストA', ['アリペブレ']);
    const second = createFavoriteList('対象リストB', ['カッパーリング']);
    createFavoriteList('送らないリスト', ['ポーション']);
    selectFavoriteList(first.id);
    first.materialSelected = true;
    second.materialSelected = true;
    renderFavoriteLists();
    updateCheckedFavoriteMaterialsButton();
  });
  await page.locator('#checkedFavoriteMaterialsBtn').click();
  let snapshot = await page.evaluate(() => captureInquiryDiagnostics());
  expect(snapshot.右パネル.チェック対象計算).toBe('合算');
  expect(snapshot.右パネル.お気に入りリスト.map(list => list.リスト名)).toEqual(['対象リストA', '対象リストB']);
  await page.locator('#checkedFavoriteAnyOneModeBtn').click();
  await page.locator('#checkedFavoriteMaterialsBtn').click();
  snapshot = await page.evaluate(() => captureInquiryDiagnostics());
  expect(snapshot.右パネル.チェック対象計算).toBe('どれか1リスト');
  await settingsInquiry(page);
  await sendReport(page);
  expect(reports[0].diagnostics).not.toContain('送らないリスト');
  expect(reports[0].diagnostics).toContain('どれか1リスト');
  await saveReport(testInfo, 'favorite-any-list-report', reports[0]);
});

test('素材の購入・準備済み個数・画像チェック・折りたたみを報告する', async ({ page }, testInfo) => {
  const reports = await interceptReports(page);
  await openApp(page);
  await searchFor(page, 'カッパーリング');
  await page.locator('#recipeList').getByText('カッパーリング', { exact: true }).first().click();
  await page.locator('#materialsViewBtn').click();
  const copper = page.locator('.intermediate-tree-node').filter({ has: page.getByText('カッパーインゴット', { exact: true }) });
  await copper.locator('.shop-info-btn').click();
  await page.getByLabel('この中間素材は購入💰して用意する').check();
  await page.locator('#shopCloseBtn').click();
  const stone = page.locator('.intermediate-tree-node').filter({ has: page.getByText('砂岩砥石', { exact: true }) });
  await stone.locator('.intermediate-prepared-btn').click();
  await page.locator('#preparedCountZeroBtn').click();
  await page.locator('#preparedCountIncreaseBtn').click();
  await page.locator('#preparedCountCloseBtn').click();
  await page.locator('#treeContainer .checkable-item-icon').first().click();
  await page.locator('#treeContainer .materials-section-header').first().click();
  const snapshot = await page.evaluate(() => captureInquiryDiagnostics());
  expect(snapshot.右パネル.購入済み中間素材).toContain('カッパーインゴット');
  expect(snapshot.右パネル.準備済み中間素材).toMatchObject({ 砂岩砥石: 1 });
  expect(snapshot.右パネル.チェック済み.length).toBeGreaterThan(0);
  expect(Object.values(snapshot.右パネル.素材セクション)).toContain(true);
  await settingsInquiry(page);
  await sendReport(page);
  await saveReport(testInfo, 'material-states-report', reports[0]);
});

test('使用中パネルの情報だけを内部添付し、検索結果ゼロも診断対象にする', async ({ page }) => {
  const reports = await interceptReports(page);
  await openApp(page);
  await searchFor(page, 'ポーション');
  await page.locator('#recipeList').getByText('ポーション', { exact: true }).first().click();
  await page.evaluate(() => showUsesPanel('ブロンズインゴット', { record: false }));
  await settingsInquiry(page);
  await expect(page.locator('#bugReportDialog')).not.toContainText('ブロンズインゴット');
  await sendReport(page);
  for (const panel of ['左パネル', '中央パネル', '右パネル']) expect(reports[0].diagnostics).toContain(`【${panel}】`);
  expect(reports[0].diagnostics).not.toContain('【マクロパネル】');
  await page.locator('[data-report-cancel]').click();
  await page.locator('#settingsCloseBtn').click();
  await page.evaluate(() => returnToList());
  await page.locator('#searchBox').fill('存在しない品目xyz');
  await page.locator('#searchBox').blur();
  await expect(page.locator('#recipeList')).toContainText('条件に一致するアイテムがありません');
  await expect.poll(() => page.evaluate(() => captureInquiryDiagnostics().左パネル?.検索語)).toBe('存在しない品目xyz');
  await settingsInquiry(page);
  await sendReport(page);
  expect(reports[1].diagnostics).toContain('存在しない品目xyz');
  expect(reports[1].diagnostics).not.toContain('【中央パネル】');
  expect(reports[1].diagnostics).toContain('条件に一致するアイテムがありません\n  ⚠️ このアプリには、');
});

test('スクショをWebPに変換して確認・削除・添付でき、キャンセルでは送信しない', async ({ page }, testInfo) => {
  const reports = await interceptReports(page);
  await openApp(page, 390, 800);
  const screenshot = await page.screenshot();
  await settingsInquiry(page);
  const file = { name: 'private-original-name.png', mimeType: 'image/png', buffer: screenshot };
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '画像を選択', exact: true }).click();
  await (await chooserPromise).setFiles([file, file]);
  await expect(page.locator('#bugReportFileList img')).toHaveCount(2);
  await expect(page.locator('#bugReportFiles')).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('inquiry-mobile.png') });
  const preview = await page.locator('#bugReportFileList img').first().evaluate(async image => {
    const blob = await (await fetch(image.src)).blob();
    const bitmap = await createImageBitmap(blob);
    return { type: blob.type, width: bitmap.width, height: bitmap.height };
  });
  expect(preview.type).toBe('image/webp');
  expect(preview.width).toBe(390);
  expect(preview.height).toBe(800);
  await page.getByRole('button', { name: '1枚目のスクリーンショットを削除' }).click();
  await expect(page.locator('#bugReportFileList img')).toHaveCount(1);
  await page.locator('#bugReportText').fill('スクショを添付');
  await page.locator('#bugReportNext').click();
  expect(reports).toHaveLength(0);
  await expect(page.locator('#bugReportFileList img')).toHaveCount(1);
  await page.locator('#bugReportSubmit').click();
  await expect(page.locator('#bugReportStatus')).toContainText('送信が完了');
  expect(reports[0].files).toHaveLength(1);
  expect(reports[0].files[0].type).toBe('image/webp');
  expect(reports[0].files[0].bytes.subarray(8, 12).toString()).toBe('WEBP');
  expect(reports[0].files[0].name).toBe('screenshot-1.webp');
  await page.locator('[data-report-cancel]').click();
  await page.locator('#inquiryBtn').click();
  await page.locator('#bugReportFiles').setInputFiles(file);
  await expect(page.locator('#bugReportFileList img')).toHaveCount(1);
  await page.locator('[data-report-cancel]').click();
  expect(reports).toHaveLength(1);
  await page.locator('#inquiryBtn').click();
  await expect(page.locator('#bugReportFileList img')).toHaveCount(0);
});

test('マクロ側の問い合わせも使用中の通常パネルを含み、閉じた後はマクロを除外する', async ({ page }) => {
  const reports = await interceptReports(page);
  await openApp(page, 1200, 850);
  await searchFor(page, 'ポーション');
  await page.locator('#recipeList').getByText('ポーション', { exact: true }).first().click();
  const launch = page.locator('.result-root-summary .macro-launch-btn');
  await expect(launch).toBeEnabled({ timeout: 30000 });
  await launch.click();
  const macro = page.frameLocator('#macroFrame');
  await expect(macro.locator('#recipeInfo')).toContainText('ポーション', { timeout: 30000 });
  await macro.locator('#bugReportButton').click();
  await expect(page.locator('#bugReportDialog')).toBeVisible();
  await expect(page.locator('#bugReportDialog')).not.toContainText('製作ステータス');
  await sendReport(page);
  for (const panel of ['左パネル', '右パネル', 'マクロパネル']) expect(reports[0].diagnostics).toContain(`【${panel}】`);
  expect(reports[0].diagnostics).not.toContain('【中央パネル】');
  await page.locator('[data-report-cancel]').click();
  await page.locator('#macroPanelCloseButton').click();
  await settingsInquiry(page);
  await sendReport(page);
  expect(reports[1].diagnostics).not.toContain('【マクロパネル】');
});

for (const [view, origin] of [['tree', 'macro'], ['materials', 'settings']]) {
  test(`マクロ表示中は選択状態が欠けても各パネルの内容を収集する（${view}・${origin}）`, async ({ page }, testInfo) => {
    const reports = await interceptReports(page);
    await openApp(page, 1495, 718);
    await searchFor(page, 'アリペブレ');
    await page.locator('#recipeList').getByText('アリペブレ', { exact: true }).first().click();
    if (view === 'materials') await page.locator('#materialsViewBtn').click();
    await page.evaluate(() => showUsesPanel('高山食塩', { record: false }));
    const launch = page.locator('.result-root-summary .macro-launch-btn');
    await expect(launch).toBeEnabled({ timeout: 30000 });
    await launch.click();
    const macro = page.frameLocator('#macroFrame');
    await expect(macro.locator('#recipeInfo')).toContainText('アリペブレ', { timeout: 30000 });
    // Simulate missing selection flags while preserving the rendered panel contents.
    await page.evaluate(() => {
      setListMode('none');
      elements.searchBox.value = '';
      selectedRecipe = null;
      selectedRecipeId = '';
      selectedUsesItem = null;
      elements.panelMiddle.classList.remove('open');
      elements.panelMiddle.style.display = 'flex';
    });
    await expect(page.locator('#usesList')).toBeVisible();
    const panels = await page.evaluate(() => captureInquiryDiagnostics());
    for (const name of ['左パネル', '中央パネル', '右パネル']) {
      expect(panels[name]?.表示内容).toContain('アリペブレ');
      if (name !== '左パネル') expect(panels[name]?.表示内容.split('\n').length).toBeGreaterThan(1);
    }
    expect(panels.右パネル.表示内容).toMatch(/アリペブレ[^\n]*×\s*\d/);
    expect(panels.右パネル.表示種別).toBe(view);
    if (origin === 'macro') await macro.locator('#bugReportButton').click();
    else await settingsInquiry(page);
    await expect(page.locator('#bugReportDialog')).not.toContainText('アリペブレ');
    await sendReport(page);
    await testInfo.attach('panel-diagnostics.txt', { body: reports[0].diagnostics, contentType: 'text/plain' });
    for (const name of ['左パネル', '中央パネル', '右パネル', 'マクロパネル']) {
      expect(reports[0].diagnostics).toContain(`【${name}】`);
    }
  });
}

test('8MiBを超える元画像も圧縮後に添付でき、画像貼り付けと枚数制限が働く', async ({ page }) => {
  const reports = await interceptReports(page);
  await openApp(page);
  const screenshot = await page.screenshot();
  await settingsInquiry(page);
  await page.locator('#bugReportFiles').setInputFiles({ name: 'large.png', mimeType: 'image/png',
    buffer: Buffer.concat([screenshot, Buffer.alloc(9 * 1024 * 1024)]) });
  await expect(page.locator('#bugReportFileList img')).toHaveCount(1);
  await expect(page.locator('#bugReportFiles')).toBeEnabled();
  await page.locator('#bugReportDialog').evaluate((dialog, bytes) => {
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File([new Uint8Array(bytes)], 'paste.png', { type: 'image/png' }));
    dialog.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, [...screenshot]);
  await expect(page.locator('#bugReportFileList img')).toHaveCount(2);
  await expect(page.locator('#bugReportFiles')).toBeEnabled();
  const file = { name: 'image.png', mimeType: 'image/png', buffer: screenshot };
  await page.locator('#bugReportFiles').setInputFiles([file, file, file]);
  await expect(page.locator('#bugReportFileError')).toContainText('4枚まで');
  await expect(page.locator('#bugReportFileList img')).toHaveCount(2);
  await page.locator('#bugReportFiles').setInputFiles([file, file]);
  await expect(page.locator('#bugReportFileList img')).toHaveCount(4);
  await expect(page.locator('#bugReportChooseFiles')).toBeDisabled();
  await page.getByRole('button', { name: '1枚目のスクリーンショットを削除' }).click();
  await expect(page.locator('#bugReportFileList img')).toHaveCount(3);
  await expect(page.locator('#bugReportChooseFiles')).toBeEnabled();
  await page.locator('#bugReportFiles').setInputFiles(file);
  await expect(page.locator('#bugReportFileList img')).toHaveCount(4);
  await expect(page.locator('#bugReportChooseFiles')).toBeDisabled();
  await sendReport(page);
  expect(reports[0].files).toHaveLength(4);
  expect(reports[0].files.every(file => file.type === 'image/webp')).toBe(true);
  expect(reports[0].files.reduce((sum, file) => sum + file.bytes.length, 0)).toBeLessThan(8 * 1024 * 1024);
});

test('送信開始時に本文を最下部へスクロールし、長文と画像があっても送信中の表示が見える', async ({ page }) => {
  let finishSending;
  const sending = new Promise(resolve => { finishSending = resolve; });
  await page.route('https://xivca-bug-report.jun1-ogu6.workers.dev/**', async route => {
    if (route.request().method() === 'POST') await sending;
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}',
      headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  try {
    await openApp(page, 390, 800);
    const screenshot = await page.screenshot();
    await settingsInquiry(page);
    const file = { name: 'image.png', mimeType: 'image/png', buffer: screenshot };
    await page.locator('#bugReportFiles').setInputFiles([file, file, file, file]);
    await expect(page.locator('#bugReportFileList img')).toHaveCount(4);
    await page.locator('#bugReportText').fill('お問い合わせ内容の確認です。\n'.repeat(40));
    await page.locator('#bugReportNext').click();
    const content = page.locator('#bugReportDialog .bug-report-content');
    expect(await content.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await content.evaluate(element => { element.scrollTop = 0; });
    await page.locator('#bugReportSubmit').click();
    await expect(page.locator('#bugReportStatus')).toContainText('送信しています');
    await expect(page.locator('#bugReportSubmit')).toBeDisabled();
    await expect(page.locator('#bugReportStatus')).toBeInViewport({ ratio: 0.99 });
    expect(await content.evaluate(element =>
      Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop))).toBeLessThanOrEqual(1);
    finishSending();
    await expect(page.locator('#bugReportStatus')).toContainText('送信が完了しました');
  } finally {
    finishSending();
  }
});

test('HTTP 415では未対応の送信形式を案内し、入力と画像を保持して自動再送しない', async ({ page }) => {
  let posts = 0;
  await page.route('https://xivca-bug-report.jun1-ogu6.workers.dev/**', async route => {
    if (route.request().method() === 'POST') posts++;
    await route.fulfill({ status: 415, contentType: 'text/plain', body: 'Unsupported Media Type',
      headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await openApp(page);
  const screenshot = await page.screenshot();
  await settingsInquiry(page);
  await page.locator('#bugReportFiles').setInputFiles({ name: 'image.png', mimeType: 'image/png', buffer: screenshot });
  await expect(page.locator('#bugReportFileList img')).toHaveCount(1);
  await expect(page.locator('#bugReportChooseFiles')).toBeEnabled();
  await page.locator('#bugReportText').fill('添付した画像について');
  await page.locator('#bugReportNext').click();
  await page.locator('#bugReportSubmit').click();
  await expect(page.locator('#bugReportStatus')).toContainText('送信先がこの送信形式に対応していない');
  await expect(page.locator('#bugReportStatus')).toContainText('HTTP 415');
  await expect(page.locator('#bugReportStatus')).not.toContainText('届いている可能性');
  await page.locator('#bugReportBack').click();
  await expect(page.locator('#bugReportText')).toHaveValue('添付した画像について');
  await expect(page.locator('#bugReportFileList img')).toHaveCount(1);
  expect(posts).toBe(1);
});

test('WebP書き出し非対応でも画像を添付でき、不正画像は既存の添付を壊さない', async ({ page }) => {
  const reports = await interceptReports(page);
  await page.addInitScript(() => {
    const native = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) {
      return native.call(this, callback, type === 'image/webp' ? 'image/png' : type, quality);
    };
  });
  await openApp(page);
  const screenshot = await page.screenshot();
  await settingsInquiry(page);
  await page.locator('#bugReportFiles').setInputFiles({ name: 'image.png', mimeType: 'image/png', buffer: screenshot });
  await expect(page.locator('#bugReportFileList img')).toHaveCount(1);
  await expect(page.locator('#bugReportFiles')).toBeEnabled();
  await page.locator('#bugReportFiles').setInputFiles({ name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('<svg/>') });
  await expect(page.locator('#bugReportFileError')).toContainText('形式が一致しません');
  await expect(page.locator('#bugReportFileList img')).toHaveCount(1);
  await sendReport(page);
  expect(reports[0].files[0].type).toBe('image/png');
});
