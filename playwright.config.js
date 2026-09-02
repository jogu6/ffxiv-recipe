const { defineConfig, devices } = require('@playwright/test');
const os = require('node:os');

const workers = process.env.CI ? 2 : Math.min(4, Math.max(2, Math.floor(os.availableParallelism() / 2)));
const viewportTestMatch = '**/viewport-size.spec.js';
const unsupportedBrowserTestMatch = '**/unsupported-browser.spec.js';
const iPhone = devices['iPhone 13'];
const iPad = devices['iPad (gen 7)'];
const iosChromeUserAgent = userAgent => userAgent.replace(/Version\/[\d.]+/u, 'CriOS/149.0.0.0');
const iosFirefoxUserAgent = userAgent => userAgent.replace(/Version\/[\d.]+/u, 'FxiOS/149.0');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  fullyParallel: false,
  workers,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    serviceWorkers: 'block',
    trace: 'on-first-retry',
  },
  // サーバーの所有と終了保証は tools/run-e2e.mjs だけが担う。
  webServer: undefined,
  projects: [
    {
      name: 'chromium',
      testIgnore: [
        '**/app-share-pwa.spec.js',
        '**/app-share-responsive.spec.js',
        unsupportedBrowserTestMatch,
      ],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'pwa-chromium-share',
      testMatch: '**/app-share-pwa.spec.js',
      use: { ...devices['Desktop Chrome'], serviceWorkers: 'allow' },
    },
    {
      name: 'android-chromium-font-size',
      testMatch: ['**/font-size-compat.spec.js', '**/app-share-responsive.spec.js', '**/viewport-size.spec.js'],
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'iphone-webkit-font-size',
      testMatch: ['**/font-size-compat.spec.js', '**/app-share-responsive.spec.js', '**/viewport-size.spec.js'],
      use: { ...devices['iPhone 13'] },
    },
    {
      name: 'ipad-webkit-viewport',
      testMatch: '**/viewport-size.spec.js',
      use: { ...devices['iPad (gen 7)'] },
    },
    {
      name: 'firefox-viewport',
      testMatch: unsupportedBrowserTestMatch,
      use: { ...devices['Desktop Firefox'], viewport: { width: 423, height: 780 } },
    },
    {
      name: 'android-firefox-viewport',
      testMatch: unsupportedBrowserTestMatch,
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 423, height: 780 },
        deviceScaleFactor: 2.75,
        hasTouch: true,
        userAgent:
          'Mozilla/5.0 (Android 15; Mobile; rv:149.0) Gecko/149.0 Firefox/149.0',
      },
    },
    {
      name: 'iphone-chrome-webkit-viewport',
      testMatch: viewportTestMatch,
      use: { ...iPhone, userAgent: iosChromeUserAgent(iPhone.userAgent) },
    },
    {
      name: 'iphone-firefox-webkit-viewport',
      testMatch: unsupportedBrowserTestMatch,
      use: { ...iPhone, userAgent: iosFirefoxUserAgent(iPhone.userAgent) },
    },
    {
      name: 'ipad-chrome-webkit-viewport',
      testMatch: viewportTestMatch,
      use: { ...iPad, userAgent: iosChromeUserAgent(iPad.userAgent) },
    },
    {
      name: 'ipad-firefox-webkit-viewport',
      testMatch: unsupportedBrowserTestMatch,
      use: { ...iPad, userAgent: iosFirefoxUserAgent(iPad.userAgent) },
    },
  ],
});
