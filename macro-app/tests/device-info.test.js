import test from 'node:test';
import assert from 'node:assert/strict';
import { collectDeviceInfo, collectScreenInfo } from '../web/device-info.js';

test('型番・詳細バージョンと概算RAMを取得し、空きRAMとは区別する', async () => {
  const info = await collectDeviceInfo({ hardwareConcurrency: 8, deviceMemory: 4,
    userAgentData: { getHighEntropyValues: async () => ({ model: 'moto g66j 5G', platform: 'Android',
      platformVersion: '15.0.0', fullVersionList: [{ brand: 'Google Chrome', version: '152.0.1.2' }] }) } });
  assert.equal(info.端末型番, 'moto g66j 5G');
  assert.equal(info.ブラウザー名, 'Google Chrome');
  assert.equal(info.ブラウザーバージョン, '152.0.1.2');
  assert.equal(info['論理プロセッサ数（ブラウザー公開値）'], 8);
  assert.equal(info['搭載RAM概算（GiB・ブラウザー公開値）'], 4);
  assert.equal(info.現在の空きRAM, '取得不可');
});

test('Braveの製品バージョンにChromiumの値を流用しない', async () => {
  const info = await collectDeviceInfo({ userAgent: 'Chrome/152.0.0.0 Safari/537.36',
    brave: { isBrave: async () => true },
    userAgentData: { brands: [{ brand: 'Chromium', version: '152' }] } });
  assert.equal(info.ブラウザー名, 'Brave');
  assert.equal(info.ブラウザーバージョン, 'Chromium 152（製品バージョンは取得不可）');
  assert.match(info.ブラウザー判別方法, /概略バージョン/);
});

test('Braveブランドが返したエンジン番号を製品番号として採用しない', async () => {
  const info = await collectDeviceInfo({ userAgent: 'Chrome/152.0.0.0',
    brave: { isBrave: async () => true },
    userAgentData: { getHighEntropyValues: async () => ({ fullVersionList: [
      { brand: 'Brave', version: '152.0.0.0' }, { brand: 'Chromium', version: '152.0.0.0' }
    ] }) } });
  assert.equal(info.ブラウザー名, 'Brave');
  assert.equal(info.ブラウザーバージョン, 'Chromium 152.0.0.0（製品バージョンは取得不可）');
});

test('製品情報がなければChromiumの詳細値、次にUser-Agentを使用する', async () => {
  const nav = { userAgent: 'Chrome/152.0.0.0', brave: { isBrave: async () => true },
    userAgentData: { brands: [{ brand: 'Chromium', version: '152' }],
      getHighEntropyValues: async () => ({ fullVersionList: [{ brand: 'Chromium', version: '152.1.2.3' }] }) } };
  const detailed = await collectDeviceInfo(nav);
  assert.equal(detailed.ブラウザーバージョン, 'Chromium 152.1.2.3（製品バージョンは取得不可）');
  assert.match(detailed.ブラウザー判別方法, /詳細バージョン/);
  delete nav.userAgentData;
  const fallback = await collectDeviceInfo(nav);
  assert.equal(fallback.ブラウザーバージョン, 'Chromium 152.0.0.0（製品バージョンは取得不可）');
  assert.match(fallback.ブラウザー判別方法, /User-Agent/);
});

test('報告時の画面・親ページ・パネル寸法を別々に固定する', () => {
  const page = { document: {}, innerWidth: 590, innerHeight: 800, visualViewport: { scale: 1 } };
  const panel = { top: page, screen: { width: 1920, height: 1080 },
    innerWidth: 580, innerHeight: 700, devicePixelRatio: 2 };
  const info = collectScreenInfo(panel);
  page.innerWidth = 1000;
  assert.deepEqual(info['画面全体（CSS px）'], { 幅: 1920, 高さ: 1080 });
  assert.deepEqual(info['ページ表示領域（CSS px）'], { 幅: 590, 高さ: 800 });
  assert.deepEqual(info['パネル表示領域（CSS px）'], { 幅: 580, 高さ: 700 });
  assert.equal(info.ピクセル比, 2);
});

test('iPhoneのSafariは型番を推測せず、非対応APIや拒否を許容する', async () => {
  const info = await collectDeviceInfo({ userAgent: 'iPhone Version/18.5 Mobile/15E148 Safari/604.1',
    userAgentData: { getHighEntropyValues: async () => { throw new Error('denied'); } } });
  assert.equal(info.ブラウザー名, 'Safari');
  assert.equal(info.ブラウザーバージョン, '18.5');
  assert.equal(info.端末型番, '取得不可');
  assert.equal(info['搭載RAM概算（GiB・ブラウザー公開値）'], '取得不可');
});

test('応答しないAPIを待ち続けず、EdgeをChromeと取り違えない', async () => {
  const info = await collectDeviceInfo({ userAgent: 'Chrome/152.0.0.0 Edg/152.1.2.3',
    userAgentData: { getHighEntropyValues: () => new Promise(() => {}), brands: [
      { brand: 'Google Chrome', version: '152' }, { brand: 'Microsoft Edge', version: '152' }
    ] } }, 5);
  assert.equal(info.ブラウザー名, 'Microsoft Edge');
  assert.equal(info.端末型番, '取得不可');
});
