import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for end-to-end reader tests.
 *
 * Assumes a dev server is already running at the URL below (no
 * `webServer` block here — running `pnpm dev` from this directory
 * already serves the worktree, and Playwright shouldn't fight it
 * for the port). Override the base URL via `BASE_URL` env if you
 * point at a deployed instance.
 *
 * Auth is handled via a global setup project that mints a session
 * for `crush@test.local` directly into the dev database and saves
 * the resulting cookies to `e2e/.auth/crush.json`. Specs that need
 * an authenticated viewer attach this storage state in their
 * project config below.
 */
export default defineConfig({
  testDir: './e2e',
  // Serial — tests share a single dev DB + dev server, and several
  // hit the same chapter content. Parallel runs raced on the
  // chapter caches and made the cross-text nav flaky. The whole
  // suite runs in well under a minute, so the cost is small.
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/crush.json',
      },
    },
  ],
});
