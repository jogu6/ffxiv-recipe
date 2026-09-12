import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: 'ui.spec.js',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4183' },
  webServer: {
    command: 'py ../tools/serve-local-app.py --port 4183 --bind 127.0.0.1 --directory ..',
    url: 'http://127.0.0.1:4183/macro-app/web/index.html',
    reuseExistingServer: false
  }
});
