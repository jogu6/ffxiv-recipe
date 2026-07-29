const { defineConfig, devices } = require('@playwright/test');
const os = require('node:os');

const workers = process.env.CI ? 2 : Math.min(4, Math.max(2, Math.floor(os.availableParallelism() / 2)));

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
  webServer: {
    command: 'py -m http.server 4173 --bind 0.0.0.0 --directory site',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 120000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
