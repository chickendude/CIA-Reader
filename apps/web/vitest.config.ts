import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

/**
 * Vitest config for the web app.
 *
 * - `jsdom` for any component tests; server-only tests don't care about the env.
 * - Coverage thresholds are intentionally modest at M0 (scaffold is mostly config),
 *   then tightened per-milestone as real logic lands (auth hashing, reader state, etc.).
 * - `server.hmr` is disabled so `vitest run` doesn't hold open a port.
 */
export default defineConfig({
  plugins: [sveltekit()],
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.{test,spec}.{ts,svelte}'],
    setupFiles: ['src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/*.{test,spec}.{ts,svelte}',
        'src/**/*.svelte',
        'src/test/**',
        'src/app.html',
        'src/hooks.server.ts',
        'src/lib/server/db/schema.ts',
        'src/lib/server/db/index.ts',
        'src/lib/server/email/**',
        // SvelteKit route handlers tend to be thin glue over tested helpers;
        // they're easier to cover via integration tests (separate milestone) than
        // via vitest mocks. Excluded for now so the unit-coverage floor reflects
        // pure logic that IS under test. Tighten as testcontainers lands.
        'src/routes/**/+server.ts',
        'src/routes/**/+page.server.ts',
      ],
      thresholds: {
        lines: 40,
        functions: 40,
        branches: 60,
        statements: 40,
      },
    },
  },
  server: {
    hmr: false,
  },
});
