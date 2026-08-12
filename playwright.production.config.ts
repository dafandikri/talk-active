import { defineConfig } from '@playwright/test';

import { findBrowser } from './scripts/browser-paths.mjs';

const browserPath = findBrowser();

export default defineConfig({
  testDir: './e2e/production-ui',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['line']],
  use: {
    baseURL: 'http://127.0.0.1:4183',
    browserName: 'chromium',
    headless: true,
    launchOptions: browserPath ? { executablePath: browserPath } : undefined,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm --filter @talk-active/web start --hostname 127.0.0.1 --port 4183',
    env: { ...process.env, AI_QUESTION_MODEL: 'playwright/configured-model' },
    url: 'http://127.0.0.1:4183/api/health',
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
