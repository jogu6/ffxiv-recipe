const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
test('退避済みの実データを種類別に抽出して保存する', async ({ playwright }) => {
  test.setTimeout(120000);
  const root = path.resolve(__dirname, '../pipeline/reports/macro-profiles');
  const context = await playwright.chromium.launchPersistentContext(path.join(root, 'storage-sample-profile'), {
    executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', headless: true, serviceWorkers: 'block'
  });
  try {
    const page = context.pages()[0];
    await page.route('**/sample.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>退避データ計測</title>' }));
    await page.goto('http://127.0.0.1:4173/sample.html');
    const data = await page.evaluate(async () => {
      const names = (await indexedDB.databases()).filter(value => value.name.startsWith('xivca-search-'));
      const result = [];
      for (const { name } of names) {
        const database = await new Promise((resolve, reject) => { const r = indexedDB.open(name); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
        const keys = await new Promise((resolve, reject) => { const r = database.transaction('pages').objectStore('pages').getAllKeys(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
        const groups = new Map();
        for (const key of keys) { const group = Math.floor(key / 4398046511104); if (!groups.has(group)) groups.set(group, []); groups.get(group).push(key); }
        for (const [group, groupKeys] of groups) {
          const picks = Array.from({ length: Math.min(512, groupKeys.length) }, (_, i) => groupKeys[Math.floor(i * groupKeys.length / Math.min(512, groupKeys.length))]);
          const pages = await new Promise((resolve, reject) => {
            const transaction = database.transaction('pages'); const store = transaction.objectStore('pages'); const values = [];
            for (const key of picks) { const r = store.get(key); r.onsuccess = () => values.push({ key, bytes: Array.from(r.result) }); }
            transaction.oncomplete = () => resolve(values); transaction.onerror = () => reject(transaction.error);
          });
          result.push({ group, totalPages: groupKeys.length, pages });
        }
        database.close();
      }
      return result;
    });
    expect(data.length).toBeGreaterThan(0);
    for (const group of data) {
      fs.writeFileSync(path.join(root, `storage-sample-${group.group}.bin`), Buffer.concat(group.pages.map(page => Buffer.from(page.bytes))));
    }
    fs.writeFileSync(path.join(root, 'storage-sample.json'), JSON.stringify(data.map(group => ({ group: group.group, totalPages: group.totalPages, sampledKeys: group.pages.map(page => page.key) })), null, 2));
    console.log(JSON.stringify(data.map(group => ({ group: group.group, totalPages: group.totalPages, samples: group.pages.length }))));
  } finally { await context.close(); }
});
