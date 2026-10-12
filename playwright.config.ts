import { defineConfig } from '@playwright/test';

/** E2E: loads the real unpacked extension (dist-e2e) in Playwright's Chromium. */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
});
