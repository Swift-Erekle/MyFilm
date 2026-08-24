import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:8094',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node server.js',
    url: 'http://127.0.0.1:8094',
    reuseExistingServer: false,
    env: {
      PORT: '8094',
      PUBLIC_ORIGIN: 'http://127.0.0.1:8094',
      ALLOWED_ORIGINS: 'http://127.0.0.1:8094',
    },
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1366, height: 768 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } },
    { name: 'tv', use: { viewport: { width: 1920, height: 1080 } } },
  ],
});
