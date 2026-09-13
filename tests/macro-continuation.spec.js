const { test: base, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

// Launch only an owned ordinary profile and attach without Playwright's focus
// emulation. A second CDP session cannot undo another session's focus override.
const test = base.extend({
  context: async ({ playwright }, use, testInfo) => {
    const executable = playwright.chromium.executablePath();
    const profile = testInfo.outputPath('profile');
    fs.mkdirSync(profile, { recursive: true });
    const child = spawn(executable, ['--remote-debugging-port=0', `--user-data-dir=${profile}`,
      '--no-first-run', '--no-default-browser-check', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
    let launchError, browser;
    child.on('error', error => { launchError = error; });
    try {
      const portFile = path.join(profile, 'DevToolsActivePort');
      await expect.poll(() => {
        if (launchError) throw launchError;
        if (child.exitCode !== null) throw new Error(`Browser exited: ${child.exitCode}`);
        return fs.existsSync(portFile);
      }, { timeout: 15000 }).toBe(true);
      const [port, endpoint] = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
      testInfo.reconnect = async () => {
        browser = await playwright.chromium.connectOverCDP(`ws://127.0.0.1:${port}${endpoint}`, { noDefaults: true });
        return browser.contexts()[0];
      };
      await use(await testInfo.reconnect());
    } finally {
      if (browser) {
        const session = await browser.newBrowserCDPSession().catch(() => null);
        await session?.send('Browser.close').catch(() => {});
        await browser.close().catch(() => {});
      }
      if (child.exitCode === null && child.signalCode === null) {
        await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 2000))]);
        if (child.exitCode === null && child.signalCode === null) spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      }
    }
  }
});

test('本番のマクロ画面もページ凍結後に同じ生成を完了し再開始しない', async ({ page, context }, testInfo) => {
  test.setTimeout(240000);
  for (const file of ['index.html', 'app.js']) await page.route(url => url.pathname === `/macro-app/web/${file}`, route => route.fulfill({
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' },
    body: fs.readFileSync(path.join(__dirname, '../site/macro-app/web', file)),
    contentType: file.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8'
  }));
  await page.addInitScript(() => {
    localStorage.setItem('xivca.macro.crafter-status.v1', JSON.stringify({ 錬金術師: {
      level: 100, craftsmanship: 5635, control: 5379, cp: 649,
      manipulation: true, heartAndSoul: false, quickInnovation: false
    } }));
    window.continuationPageId = crypto.randomUUID();
    window.continuationLifecycle = [];
    for (const name of ['freeze', 'resume']) document.addEventListener(name,
      () => continuationLifecycle.push({ name, at: performance.now() }));
  });
  await page.goto('http://127.0.0.1:4173/macro-app/web/index.html?siteRoot=../..&recipe=f86e48825e8');
  await expect(page.locator('#recipeInfo')).toContainText('フィルバートブラシ', { timeout: 30000 });
  expect(await page.evaluate(() => globalThis.__xivcaDevelopment === true)).toBe(false);
  for (const button of await page.locator('.hq-quality-choice[aria-label$="はすべてHQ"]').all()) await button.click();
  const results = [];
  for (const scenario of ['normal', 'freeze']) {
    const previousStart = await page.evaluate(() => globalThis.__xivcaMacroProfile?.startedAt);
    await page.locator('#generateButton').click();
    await expect.poll(() => page.evaluate(() => globalThis.__xivcaMacroProfile?.startedAt)).not.toBe(previousStart);
    await expect.poll(() => page.evaluate(() => globalThis.__xivcaMacroProfile?.samples.length || 0)).toBeGreaterThan(0);
    const identity = await page.evaluate(() => ({ pageId: continuationPageId, startedAt: __xivcaMacroProfile.startedAt,
      status: __xivcaMacroProfile.status }));
    expect(identity.status).toBe('running');
    if (scenario === 'freeze') {
      const cdp = await context.newCDPSession(page);
      try {
        await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
        await new Promise(resolve => setTimeout(resolve, 5000));
      } finally { await cdp.send('Page.setWebLifecycleState', { state: 'active' }); await cdp.detach(); }
    }
    await expect.poll(() => page.evaluate(() => __xivcaMacroProfile.status), { timeout: 120000 }).toBe('completed');
    await expect(page.locator('#progressOverlay')).toBeHidden();
    const result = await page.evaluate(() => ({ pageId: continuationPageId, startedAt: __xivcaMacroProfile.startedAt,
      input: __xivcaMacroProfile.input, result: __xivcaMacroProfile.result,
      elapsedMs: __xivcaMacroProfile.elapsedMs, final: __xivcaMacroProfile.samples.at(-1),
      macro: document.querySelector('#macroOutput').value, lifecycle: [...continuationLifecycle] }));
    expect(result.pageId).toBe(identity.pageId);
    expect(result.startedAt).toBe(identity.startedAt);
    expect(result.macro).toContain('/ac');
    if (scenario === 'freeze') {
      expect(result.input).toEqual(results[0].input);
      expect(result.result).toEqual(results[0].result);
      expect(result.macro).toBe(results[0].macro);
      const frozen = result.lifecycle.find(event => event.name === 'freeze');
      const resumed = result.lifecycle.find(event => event.name === 'resume');
      expect(frozen).toBeTruthy(); expect(resumed).toBeTruthy();
      expect(resumed.at - frozen.at).toBeGreaterThanOrEqual(4500);
    }
    results.push({ scenario, ...result });
    fs.writeFileSync(testInfo.outputPath('application-continuation.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ application: true, scenario, elapsedMs: result.elapsedMs, nodes: result.final.searchNodes }));
  }
});

test('実生成は試験ウィンドウの最小化・ページ凍結後も同じ結果で完了する', async ({ page: initialPage, context: initialContext }, testInfo) => {
  let page = initialPage, context = initialContext;
  test.setTimeout(180000);
  await page.route('**/continuation-test.html', route => route.fulfill({ contentType: 'text/html',
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' },
    body: '<!doctype html><title>生成の継続試験</title><script type="module" src="/continuation-harness.mjs"></script>' }));
  await page.route('**/continuation-harness.mjs', route => route.fulfill({ contentType: 'text/javascript',
    body: fs.readFileSync(path.join(__dirname, 'browser-generation-harness.mjs')) }));
  await page.goto('http://127.0.0.1:4173/continuation-test.html');
  await expect.poll(() => page.evaluate(() => typeof startGenerationTest)).toBe('function');
  const results = [];
  for (const scenario of ['normal', 'background', 'freeze']) {
    const identity = await page.evaluate(() => startGenerationTest());
    if (scenario !== 'normal') {
      await expect.poll(() => page.evaluate(() => generationTestState().samples)).toBeGreaterThan(0);
      expect(await page.evaluate(() => generationTestState().done)).toBe(false);
      const cdp = await context.newCDPSession(page);
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', newWindow: false });
      const { windowId } = await cdp.send('Browser.getWindowForTarget');
      await cdp.send('Target.activateTarget', { targetId });
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
      if (scenario === 'freeze') await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
      expect((await cdp.send('Browser.getWindowBounds', { windowId })).bounds.windowState).toBe('minimized');
      try { await new Promise(resolve => setTimeout(resolve, 5000)); }
      finally {
        if (scenario === 'freeze') await cdp.send('Page.setWebLifecycleState', { state: 'active' });
        await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
        await page.bringToFront();
        await cdp.send('Target.closeTarget', { targetId });
        await cdp.detach();
      }
    }
    await expect.poll(() => page.evaluate(() => generationTestState().done), { timeout: 120000 }).toBe(true);
    const result = await page.evaluate(() => generationTestResult());
    results.push({ scenario, browser: testInfo.project.name, browserVersion: context.browser().version(), ...result });
    fs.writeFileSync(testInfo.outputPath('continuation.json'), JSON.stringify(results, null, 2));
    expect(result.error).toBeUndefined();
    expect(result.pageId).toBe(identity.pageId);
    expect(result.requestId).toBe(identity.requestId);
    expect(result.samples.at(-1).stage).toBe('complete');
    expect(result.result.actions).toHaveLength(13);
    expect(result.samples.every((sample, index) => index === 0
      || (sample.searchNodes ?? 0) >= (result.samples[index - 1].searchNodes ?? 0))).toBe(true);
    if (scenario !== 'normal') {
      expect(result.result).toEqual(results[0].result);
      // Keep actual visibility evidence. DevTools may keep this API visible;
      // window minimization alone is not proof that visibility handlers ran.
      result.hiddenVisibilityObserved = result.visibility.some(event => event.state === 'hidden');
    }
    if (scenario === 'freeze') {
      expect(result.lifecycle.some(event => event.name === 'freeze')).toBe(true);
      expect(result.lifecycle.some(event => event.name === 'resume')).toBe(true);
      expect(result.lifecycle.find(event => event.name === 'resume').at
        - result.lifecycle.find(event => event.name === 'freeze').at).toBeGreaterThanOrEqual(4500);
    }
    await page.evaluate(() => disposeGenerationTest());
    await expect.poll(() => page.evaluate(() => generationTestState().disposed)).toBe(true);
    expect(await page.evaluate(() => generationTestStorageFiles())).toEqual([]);
    console.log(JSON.stringify({ browser: testInfo.project.name, scenario, elapsedMs: result.elapsedMs,
      nodes: result.samples.at(-1).searchNodes, lifecycle: result.lifecycle }));
  }
});
