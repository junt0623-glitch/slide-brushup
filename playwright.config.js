// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: /bt\d+.*\.spec\.js/,
  timeout: 30000,
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    // ローカルNode.js不要の方針に合わせ、Actions ランナー標準搭載のPythonで配信する
    command: 'python3 -m http.server 4173',
    url: 'http://127.0.0.1:4173/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 10000,
  },
});
