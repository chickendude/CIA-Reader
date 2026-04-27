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
        // Thin Drizzle wrapper — tested meaningfully only against a real
        // Postgres (planned for M4's testcontainers setup). Its behavior
        // is mirrored by InMemoryDictionaryRepo, which the runner tests
        // exercise end-to-end.
        'src/lib/server/dictionary/drizzle-repo.ts',
        // Barrels / type-only modules have no runtime to cover.
        'src/lib/server/dictionary/index.ts',
        'src/lib/server/dictionary/repo.ts',
        'src/lib/server/dictionary/types.ts',
        // SvelteKit route handlers tend to be thin glue over tested helpers;
        // they're easier to cover via integration tests (separate milestone) than
        // via vitest mocks. Excluded for now so the unit-coverage floor reflects
        // pure logic that IS under test. Tighten as testcontainers lands.
        'src/routes/**/+server.ts',
        'src/routes/**/+page.server.ts',
      ],
      // Tightened in T-3.9 once M3 landed real curator logic. Actual
      // numbers at the time of the bump are ~88% lines / ~88% branches /
      // ~91% funcs across the included surface; the floor sits a few
      // points below so a small regression is allowed but a wholesale
      // drop trips CI. Tighten further as M5/M6 land reader + moderation
      // logic.
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
  server: {
    hmr: false,
  },
});
