import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [sveltekit()],
  resolve: {
    // Tell vitest's resolver to pick the browser export of `svelte`
    // when running under jsdom — otherwise `mount()` etc. resolve to
    // the SSR build and throw `lifecycle_function_unavailable`. Only
    // affects tests; the app build picks conditions normally.
    conditions: process.env.VITEST ? ['browser'] : [],
  },
  test: {
    environment: 'jsdom',
    // Let browser tests use jsdom's storage for each test file.
    poolOptions: { forks: { execArgv: ['--no-experimental-webstorage'] } },
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
        // The import runner uses an in-memory dictionary in unit tests.
        'src/lib/server/dictionary/drizzle-repo.ts',
        // Barrels / type-only modules have no runtime to cover.
        'src/lib/server/dictionary/index.ts',
        'src/lib/server/dictionary/repo.ts',
        'src/lib/server/dictionary/types.ts',
        // Route handlers are covered by request and browser tests.
        'src/routes/**/+server.ts',
        'src/routes/**/+page.server.ts',
      ],
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
