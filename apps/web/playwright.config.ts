import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for end-to-end reader tests.
 *
 * Locally: if `pnpm dev` is already serving the worktree on the
 * configured port, Playwright reuses it (faster turnaround between
 * runs). Otherwise — and always in CI — Playwright starts its own
 * `pnpm dev` and tears it down at the end.
 *
 * Auth + test-data seeding is handled by a global setup project
 * that talks directly to the dev database (test user, sample
 * chapter-book collection if missing, session cookie). See
 * `e2e/auth.setup.ts`.
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
  webServer: {
    command: 'pnpm dev',
    url: process.env.BASE_URL ?? 'http://localhost:5173',
    // Locally we reuse a developer's already-running `pnpm dev`. In
    // CI the workspace is clean each run, so we let Playwright own
    // the dev server's lifecycle.
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
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
