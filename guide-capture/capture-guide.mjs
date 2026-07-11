import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'site', 'guide', 'assets', 'images');
await mkdir(output, { recursive: true });
const server = spawn('py', ['-m', 'http.server', '4173', '--bind', '0.0.0.0', '--directory', 'site'], { cwd: root, stdio: 'ignore', windowsHide: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitForServer() { for (let i = 0; i < 40; i++) { try { const response = await fetch('http://127.0.0.1:4173/'); if (response.ok) return; } catch {} await sleep(250); } throw new Error('ローカルサーバーを起動できませんでした'); }
async function save(page, name) { const buffer = await page.screenshot({ fullPage: false }); await sharp(buffer).webp({ quality: 86 }).toFile(path.join(output, name)); }
async function search(page, value) { await page.locator('#searchBox').fill(value); await page.locator('#searchBox').blur(); await page.locator('#recipeList li').filter({ hasText: value }).first().click(); }

async function prepare(page) {
  await page.goto('http://127.0.0.1:4173/');
  await page.locator('#loadingOverlay').waitFor({ state: 'hidden' });
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
}

async function setGuideFavorites(page) {
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('ff14_favorite_lists_v2', JSON.stringify({ version: 2, selectedListId: 'guide', lists: [{ id: 'guide', name: '制作予定', itemIds: [1607, 4422] }, { id: 'guide-2', name: '納品用', itemIds: [273] }] }));
  });
  await page.reload();
  await page.locator('#loadingOverlay').waitFor({ state: 'hidden' });
}

async function captureDesktop(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await prepare(page);
  await page.locator('#equipmentSearchToggle').click(); await save(page, '07-equipment-search.webp'); await page.locator('#equipmentSearchToggle').click();
  await search(page, 'ブラスバスタードソード'); await save(page, '01-search.webp');
  await page.locator('#countInput').fill('3'); await page.locator('#countInput').dispatchEvent('change'); await page.locator('#materialsViewBtn').click(); await save(page, '02-materials.webp');
  await page.locator('#appTitle').click(); await page.locator('#searchBox').fill('山羊乳'); await page.locator('#searchBox').blur(); await page.locator('#recipeList li').filter({ hasText: '山羊乳' }).first().click(); await save(page, '03-used-in.webp');
  await page.locator('#appTitle').click(); await setGuideFavorites(page); await page.locator('#favBtn').click(); await page.locator('#favoriteLists').getByText('制作予定').click(); await save(page, '04-favorites.webp');
  await page.locator('#recipeList').getByText(/素材リストを表示/).click(); await save(page, '05-favorite-materials.webp');
  await page.locator('#appTitle').click(); await page.locator('#favBtn').click(); await page.locator('.favorite-list-material-checkbox').nth(0).check(); await page.locator('.favorite-list-material-checkbox').nth(1).check(); await save(page, '08-combined-lists.webp');
  await page.locator('#settingsBtn').click(); await page.locator('#exportListToggle').click(); await page.locator('#exportListChoices').getByText('制作予定').click(); await save(page, '06-share.webp');
  await page.close();
}

async function captureMobile(browser) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await prepare(page);
  await page.locator('#equipmentSearchToggle').click(); await save(page, 'mobile-07-equipment-search.webp'); await page.locator('#equipmentSearchToggle').click();
  await page.locator('#searchBox').fill('ブラスバスタードソード'); await page.locator('#searchBox').blur(); await save(page, 'mobile-01-search.webp');
  await page.locator('#recipeList li').filter({ hasText: 'ブラスバスタードソード' }).first().click(); await page.locator('#countInput').fill('3'); await page.locator('#countInput').dispatchEvent('change'); await page.locator('#materialsViewBtn').click(); await save(page, 'mobile-02-materials.webp');
  await page.locator('#mobileBackBtn').click(); await page.locator('#searchBox').fill('山羊乳'); await page.locator('#searchBox').blur(); await page.locator('#recipeList li').filter({ hasText: '山羊乳' }).first().click(); await save(page, 'mobile-03-used-in.webp');
  await page.locator('#mobileBackBtn').click(); await setGuideFavorites(page); await page.locator('#favBtn').click(); await page.locator('#favoriteLists').getByText('制作予定').click(); await save(page, 'mobile-04-favorites.webp');
  await page.locator('#recipeList').getByText(/素材リストを表示/).click(); await save(page, 'mobile-05-favorite-materials.webp');
  await page.locator('#mobileBackBtn').click(); await page.locator('#appTitle').click(); await page.locator('#favBtn').click(); await page.locator('.favorite-list-material-checkbox').nth(0).check(); await page.locator('.favorite-list-material-checkbox').nth(1).check(); await save(page, 'mobile-08-combined-lists.webp');
  await page.locator('#settingsBtn').click(); await page.locator('#exportListToggle').click(); await page.locator('#exportListChoices').getByText('制作予定').click(); await save(page, 'mobile-06-share.webp');
  await page.close();
}

try {
  await waitForServer();
  const browser = await chromium.launch();
  await captureDesktop(browser);
  await captureMobile(browser);
  await browser.close();
  console.log(`ガイド画像を ${output} に生成しました。`);
} finally { server.kill(); }
